# Pulsar Frontend — Payer Dashboard

React + Vite UI for payers to view payment history and track refund status.

## Setup

```bash
cd frontend
cp .env.example .env        # fill in CONTRACT_ID
npm install
npm run dev
```

## Component catalogue (Storybook)

```bash
npm install
npm run storybook
```

Opens an interactive catalogue of the UI components at `localhost:6006`,
including stories for `CopyButton`, `ContractCallStatus`
(Spinner/ErrorMessage/SuccessBanner), and `NotificationCenter`. Config lives
in `.storybook/`; add a `*.stories.tsx` file next to a component to document
it.

## Features
- Freighter wallet connection
- Paginated payment history table (cursor-based)
- Filter by status, amount range
- Sort by date or amount (ascending/descending)
- Refund status displayed inline per payment

## Contract Type Generation

`frontend/src/contract.ts` is **auto-generated** from the deployed contract's ABI using the Stellar CLI. **Do not edit it by hand** — any manual changes will be overwritten the next time the types are regenerated, and CI will fail if the committed file drifts from the generated output.

### Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) installed and available on your `PATH`.
- The contract deployed to the target network (or its WASM available locally).

### Required environment variables

| Variable      | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `CONTRACT_ID` | The deployed contract ID (e.g. `C...`) to generate bindings from.  |
| `NETWORK`     | The Stellar network the contract is deployed to (`testnet`, `mainnet`, `futurenet`, or a custom RPC URL). |

Set these in `frontend/.env` (see `.env.example`) or export them in your shell before running the command.

### Generation command

From the `frontend/` directory, run:

```bash
stellar contract bindings typescript \
  --network "$NETWORK" \
  --contract-id "$CONTRACT_ID" \
  --output-dir ./src \
  --overwrite
```

This writes the generated TypeScript types (including `PaymentRecord` and other ABI-derived types) to `frontend/src/contract.ts`.

> **Note:** If your Stellar CLI version emits the file under a different name (e.g. `index.ts`), rename or re-export it as `contract.ts` so the rest of the app keeps importing from `./contract`.

### Regenerating after a contract change

Whenever the contract ABI changes (new fields, renamed types, etc.):

1. Redeploy the contract and update `CONTRACT_ID` / `NETWORK` if needed.
2. Run the generation command above.
3. Review the diff in `frontend/src/contract.ts` and fix any downstream type errors in the app.
4. Commit the regenerated `contract.ts` together with the contract change.

### CI drift check

CI regenerates `contract.ts` from the deployed ABI and compares it against the committed file. If they differ, the build **fails** — this catches cases where the contract schema changed but the frontend types were not regenerated. To fix a failing check, run the generation command locally and commit the result.
