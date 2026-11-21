require('dotenv').config();
const { SorobanRpc, Networks } = require('@stellar/stellar-sdk');
const { Pool } = require('pg');
const express = require('express');

const {
  HORIZON_URL,
  CONTRACT_ID,
  DATABASE_URL,
  PORT = 3001,
  START_LEDGER,
} = process.env;

const db = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/events', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  const params = [Number(limit), Number(offset)];
  let where = '';
  if (type) { where = 'WHERE event_type = $3'; params.push(type); }
  const { rows } = await db.query(
    `SELECT * FROM events ${where} ORDER BY ledger DESC LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows);
});

app.get('/events/:type', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM events WHERE event_type = $1 ORDER BY ledger DESC LIMIT 50',
    [req.params.type]
  );
  res.json(rows);
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

// ── Indexer ───────────────────────────────────────────────────────────────────

async function getLastIndexedLedger() {
  const { rows } = await db.query('SELECT MAX(ledger) AS last FROM events');
  return rows[0].last || 0;
}

/**
 * Determine which ledger to resume polling from.
 *
 * If events already exist, resume right after the last indexed ledger
 * (normal incremental behavior). If the table is empty — i.e. this is the
 * indexer's first ever run — previously this fell through to ledger 1,
 * meaning every event emitted before the indexer's first start was never
 * backfilled (and ledger 1 is typically outside RPC retention anyway, so
 * the very first poll would just error out).
 *
 * This resolves that by honoring START_LEDGER on an empty table, so
 * operators can explicitly backfill from a known ledger (e.g. the
 * contract's deployment ledger).
 */
async function resolveStartLedger() {
  const lastIndexed = await getLastIndexedLedger();
  if (lastIndexed > 0) {
    return lastIndexed + 1;
  }
  if (START_LEDGER) {
    const parsed = Number(START_LEDGER);
    if (Number.isFinite(parsed) && parsed > 0) {
      console.log(`No prior events found. Backfilling from START_LEDGER=${parsed}`);
      return parsed;
    }
    console.warn(`Ignoring invalid START_LEDGER value: ${START_LEDGER}`);
  }
  return lastIndexed + 1;
}

async function saveEvent(event) {
  await db.query(
    `INSERT INTO events (ledger, tx_hash, contract_id, event_type, topics, value)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [
      event.ledger,
      event.txHash,
      event.contractId,
      event.type,
      JSON.stringify(event.topic),
      JSON.stringify(event.value),
    ]
  );
}

async function poll() {
  const server = new SorobanRpc.Server(HORIZON_URL);
  const startLedger = await resolveStartLedger();

  console.log(`Polling events from ledger ${startLedger} for contract ${CONTRACT_ID}`);

  try {
    const response = await server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    for (const event of response.events) {
      await saveEvent({
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: event.contractId,
        type: event.topic[0]?.toString() ?? 'unknown',
        topic: event.topic.map(t => t.toString()),
        value: event.value,
      });
    }

    if (response.events.length) {
      console.log(`Indexed ${response.events.length} events`);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  setTimeout(poll, 6000); // poll every ~1 ledger close
}

poll();
