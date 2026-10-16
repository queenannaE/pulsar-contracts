/// Data export service — streaming CSV / JSON export.
///
/// # Architecture
///
/// The previous implementation loaded every record into memory before
/// serialising the output, causing OOM errors and timeouts for large
/// merchant histories.
///
/// This rewrite introduces:
///
/// * **Chunked streaming** — records are read and serialised in pages of
///   [`CHUNK_SIZE`] rows; only one chunk lives in memory at a time.
/// * **Progress reporting** — callers receive [`ExportProgress`] updates
///   after each chunk via a synchronous callback, suitable for surfacing via
///   Server-Sent Events or a polling endpoint.
/// * **Maximum export size** — requests that would exceed
///   [`MAX_EXPORT_RECORDS`] are rejected upfront with
///   [`DataExportError::ExportTooLarge`].
///
/// The public API surface is intentionally kept minimal so a future HTTP
/// layer can wrap it without changes.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::Write;
use thiserror::Error;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Number of records processed per chunk.
pub const CHUNK_SIZE: usize = 500;

/// Hard upper bound on records per export request.
/// Requests exceeding this limit are rejected before any I/O begins.
/// Documented: callers that need more data should use date-range
/// pagination to split the export into multiple smaller requests.
pub const MAX_EXPORT_RECORDS: usize = 100_000;

// ─── Error ────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum DataExportError {
    #[error("serialization failed: {0}")]
    Serialization(String),
    #[error("invalid filter")]
    InvalidFilter,
    #[error("storage error")]
    StorageError,
    #[error(
        "export too large: {record_count} records exceed the maximum of {max} — \
         use date-range filtering to narrow the export"
    )]
    ExportTooLarge { record_count: usize, max: usize },
    #[error("internal error")]
    Internal,
}

pub type Result<T> = std::result::Result<T, DataExportError>;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExportFilter {
    pub date_start: Option<DateTime<Utc>>,
    pub date_end: Option<DateTime<Utc>>,
    pub merchant_address: Option<String>,
    pub payer_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PaymentRecord {
    pub order_id: String,
    pub merchant_address: String,
    pub payer_address: String,
    pub token_address: String,
    pub amount: i128,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

/// Progress snapshot emitted after each chunk is processed.
///
/// Callers can forward these values to a Server-Sent Events endpoint or
/// store them in a polling table so clients can track long-running exports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProgress {
    /// Number of records written so far.
    pub records_written: usize,
    /// Total records to be exported (after filtering).
    pub total_records: usize,
    /// Approximate completion percentage (0–100).
    pub percent: u8,
}

impl ExportProgress {
    fn new(written: usize, total: usize) -> Self {
        let percent = if total == 0 {
            100
        } else {
            ((written as f64 / total as f64) * 100.0).min(100.0) as u8
        };
        ExportProgress {
            records_written: written,
            total_records: total,
            percent,
        }
    }
}

// ─── Data source trait ────────────────────────────────────────────────────────

/// Abstraction over the underlying record source.
///
/// The default implementation ([`VecRecordSource`]) wraps an in-memory
/// `Vec`, which is convenient for testing. Production code should provide
/// an implementation backed by a database cursor or paginated RPC calls.
pub trait RecordSource {
    /// Return the total number of records matching `filter` without
    /// materialising them.  Used for the size-limit pre-check.
    fn count(&self, filter: &ExportFilter) -> Result<usize>;

    /// Iterate over matching records in chunks.
    ///
    /// `f` is called once per chunk with a slice of owned records.  The
    /// implementation must guarantee that `chunk.len() <= chunk_size` and
    /// that chunks are non-overlapping and exhaustive.
    fn for_each_chunk<F>(&self, filter: &ExportFilter, chunk_size: usize, f: F) -> Result<()>
    where
        F: FnMut(&[PaymentRecord]) -> Result<()>;
}

// ─── Default in-memory source ─────────────────────────────────────────────────

/// In-memory [`RecordSource`] backed by a `Vec<PaymentRecord>`.
///
/// For production deployments, replace this with a database-backed
/// implementation that fetches records page-by-page using LIMIT/OFFSET
/// or a cursor so only `chunk_size` rows are live in memory at once.
#[derive(Debug, Default)]
pub struct VecRecordSource {
    records: Vec<PaymentRecord>,
}

impl VecRecordSource {
    pub fn new(records: Vec<PaymentRecord>) -> Self {
        Self { records }
    }

    fn matches(record: &PaymentRecord, filter: &ExportFilter) -> bool {
        if let Some(start) = filter.date_start {
            if record.created_at < start {
                return false;
            }
        }
        if let Some(end) = filter.date_end {
            if record.created_at > end {
                return false;
            }
        }
        if let Some(ref merchant) = filter.merchant_address {
            if &record.merchant_address != merchant {
                return false;
            }
        }
        if let Some(ref payer) = filter.payer_address {
            if &record.payer_address != payer {
                return false;
            }
        }
        true
    }
}

impl RecordSource for VecRecordSource {
    fn count(&self, filter: &ExportFilter) -> Result<usize> {
        Ok(self.records.iter().filter(|r| Self::matches(r, filter)).count())
    }

    fn for_each_chunk<F>(&self, filter: &ExportFilter, chunk_size: usize, mut f: F) -> Result<()>
    where
        F: FnMut(&[PaymentRecord]) -> Result<()>,
    {
        let mut chunk: Vec<PaymentRecord> = Vec::with_capacity(chunk_size);
        for record in self.records.iter().filter(|r| Self::matches(r, filter)) {
            chunk.push(record.clone());
            if chunk.len() == chunk_size {
                f(&chunk)?;
                chunk.clear();
            }
        }
        if !chunk.is_empty() {
            f(&chunk)?;
        }
        Ok(())
    }
}

// ─── Export service ───────────────────────────────────────────────────────────

/// Streaming export service.
///
/// Use [`ExportServiceBuilder`] to construct an instance with a custom
/// chunk size or record source.
pub struct ExportService<S: RecordSource> {
    source: S,
    chunk_size: usize,
    max_records: usize,
}

impl ExportService<VecRecordSource> {
    /// Convenience constructor using the in-memory record source.
    pub fn new(records: Vec<PaymentRecord>) -> Self {
        ExportService {
            source: VecRecordSource::new(records),
            chunk_size: CHUNK_SIZE,
            max_records: MAX_EXPORT_RECORDS,
        }
    }
}

impl<S: RecordSource> ExportService<S> {
    /// Create with a custom [`RecordSource`].
    pub fn with_source(source: S) -> Self {
        ExportService {
            source,
            chunk_size: CHUNK_SIZE,
            max_records: MAX_EXPORT_RECORDS,
        }
    }

    /// Override the chunk size (useful for testing).
    pub fn chunk_size(mut self, n: usize) -> Self {
        self.chunk_size = n.max(1);
        self
    }

    /// Override the maximum export size (useful for testing).
    pub fn max_records(mut self, n: usize) -> Self {
        self.max_records = n;
        self
    }

    /// Stream-export records to `writer`.
    ///
    /// * Checks the record count upfront and returns
    ///   [`DataExportError::ExportTooLarge`] if it exceeds `max_records`.
    /// * Reads and serialises records in chunks of `chunk_size`.
    /// * Calls `on_progress` after each chunk with an [`ExportProgress`]
    ///   snapshot — suitable for forwarding to SSE or a polling table.
    ///
    /// # Example
    /// ```rust
    /// use data_export_service::*;
    /// use std::io::sink;
    ///
    /// let svc = ExportService::new(vec![]);
    /// let filter = ExportFilter { date_start: None, date_end: None,
    ///                             merchant_address: None, payer_address: None };
    /// svc.export_streaming(ExportFormat::Json, filter, &mut sink(), |_| {}).unwrap();
    /// ```
    pub fn export_streaming<W, F>(
        &self,
        format: ExportFormat,
        filter: ExportFilter,
        writer: &mut W,
        mut on_progress: F,
    ) -> Result<()>
    where
        W: Write,
        F: FnMut(ExportProgress),
    {
        // ── Pre-flight: size check ──
        let total = self.source.count(&filter)?;
        if total > self.max_records {
            return Err(DataExportError::ExportTooLarge {
                record_count: total,
                max: self.max_records,
            });
        }

        match format {
            ExportFormat::Csv => self.stream_csv(filter, total, writer, on_progress),
            ExportFormat::Json => self.stream_json(filter, total, writer, on_progress),
        }
    }

    // ── CSV streaming ──────────────────────────────────────────────────────

    fn stream_csv<W, F>(
        &self,
        filter: ExportFilter,
        total: usize,
        writer: &mut W,
        mut on_progress: F,
    ) -> Result<()>
    where
        W: Write,
        F: FnMut(ExportProgress),
    {
        let mut csv_writer = csv::Writer::from_writer(writer);
        csv_writer
            .write_record(&[
                "order_id",
                "merchant_address",
                "payer_address",
                "token_address",
                "amount",
                "status",
                "created_at",
            ])
            .map_err(|e| DataExportError::Serialization(e.to_string()))?;

        let mut written = 0usize;
        self.source
            .for_each_chunk(&filter, self.chunk_size, |chunk| {
                for record in chunk {
                    csv_writer
                        .serialize(record)
                        .map_err(|e| DataExportError::Serialization(e.to_string()))?;
                }
                written += chunk.len();
                on_progress(ExportProgress::new(written, total));
                Ok(())
            })?;

        csv_writer
            .flush()
            .map_err(|e| DataExportError::Serialization(e.to_string()))?;
        Ok(())
    }

    // ── JSON streaming ─────────────────────────────────────────────────────

    fn stream_json<W, F>(
        &self,
        filter: ExportFilter,
        total: usize,
        writer: &mut W,
        mut on_progress: F,
    ) -> Result<()>
    where
        W: Write,
        F: FnMut(ExportProgress),
    {
        writer
            .write_all(b"[\n")
            .map_err(|e| DataExportError::Serialization(e.to_string()))?;

        let mut first = true;
        let mut written = 0usize;

        self.source
            .for_each_chunk(&filter, self.chunk_size, |chunk| {
                for record in chunk {
                    if !first {
                        writer
                            .write_all(b",\n")
                            .map_err(|e| DataExportError::Serialization(e.to_string()))?;
                    }
                    let json = serde_json::to_vec(record)
                        .map_err(|e| DataExportError::Serialization(e.to_string()))?;
                    writer
                        .write_all(&json)
                        .map_err(|e| DataExportError::Serialization(e.to_string()))?;
                    first = false;
                }
                written += chunk.len();
                on_progress(ExportProgress::new(written, total));
                Ok(())
            })?;

        writer
            .write_all(b"\n]")
            .map_err(|e| DataExportError::Serialization(e.to_string()))?;
        Ok(())
    }

    // ── Legacy convenience method (kept for backwards compatibility) ────────

    /// Collect the entire export into a `String`.
    ///
    /// **Not recommended for large datasets** — use [`export_streaming`]
    /// with a real writer instead.  This helper is retained for callers
    /// that only need small test exports.
    ///
    /// [`export_streaming`]: ExportService::export_streaming
    pub fn export(&self, format: ExportFormat, filter: ExportFilter) -> Result<String> {
        let mut buf: Vec<u8> = Vec::new();
        self.export_streaming(format, filter, &mut buf, |_| {})?;
        String::from_utf8(buf).map_err(|e| DataExportError::Serialization(e.to_string()))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_record(order_id: &str, created_at: DateTime<Utc>) -> PaymentRecord {
        PaymentRecord {
            order_id:         order_id.into(),
            merchant_address: "MERCHANT_001".into(),
            payer_address:    "PAYER_001".into(),
            token_address:    "TOKEN_001".into(),
            amount:           500,
            status:           "Completed".into(),
            created_at,
        }
    }

    fn d(y: i32, m: u32, d: u32) -> DateTime<Utc> {
        #[allow(deprecated)]
        Utc.ymd(y, m, d).and_hms(0, 0, 0)
    }

    // ── Existing behaviour (backwards-compat) ───────────────────────────────

    #[test]
    fn export_json_filters_by_date() {
        let svc = ExportService::new(vec![
            make_record("ORDER_001", d(2026, 6, 1)),
            make_record("ORDER_002", d(2026, 7, 1)),
        ]);
        let result = svc
            .export(
                ExportFormat::Json,
                ExportFilter {
                    date_start:       Some(d(2026, 6, 15)),
                    date_end:         None,
                    merchant_address: None,
                    payer_address:    None,
                },
            )
            .unwrap();

        assert!(result.contains("ORDER_002"), "should include ORDER_002");
        assert!(!result.contains("ORDER_001"), "should exclude ORDER_001");
    }

    #[test]
    fn export_csv_generates_header() {
        let svc = ExportService::new(vec![make_record("ORDER_001", d(2026, 6, 1))]);
        let result = svc
            .export(
                ExportFormat::Csv,
                ExportFilter {
                    date_start: None, date_end: None,
                    merchant_address: None, payer_address: None,
                },
            )
            .unwrap();

        assert!(result.contains("order_id,merchant_address,payer_address"));
        assert!(result.contains("ORDER_001"));
    }

    // ── Streaming-specific tests ────────────────────────────────────────────

    #[test]
    fn streaming_csv_progress_called_per_chunk() {
        // 11 records, chunk_size = 5 → 3 chunks (5+5+1)
        let records: Vec<_> = (0..11)
            .map(|i| make_record(&format!("O_{i}"), d(2026, 1, 1)))
            .collect();
        let svc = ExportService::new(records).chunk_size(5);

        let mut progress_snapshots: Vec<ExportProgress> = Vec::new();
        let mut buf = Vec::new();
        svc.export_streaming(
            ExportFormat::Csv,
            ExportFilter { date_start: None, date_end: None, merchant_address: None, payer_address: None },
            &mut buf,
            |p| progress_snapshots.push(p),
        )
        .unwrap();

        assert_eq!(progress_snapshots.len(), 3, "3 chunks expected");
        assert_eq!(progress_snapshots[0].records_written, 5);
        assert_eq!(progress_snapshots[1].records_written, 10);
        assert_eq!(progress_snapshots[2].records_written, 11);
        assert_eq!(progress_snapshots[2].percent, 100);
    }

    #[test]
    fn streaming_json_output_is_valid_array() {
        let records: Vec<_> = (0..3)
            .map(|i| make_record(&format!("O_{i}"), d(2026, 1, 1)))
            .collect();
        let svc = ExportService::new(records);
        let output = svc
            .export(ExportFormat::Json, ExportFilter { date_start: None, date_end: None, merchant_address: None, payer_address: None })
            .unwrap();

        let parsed: Vec<serde_json::Value> = serde_json::from_str(&output)
            .expect("output should be a valid JSON array");
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn size_limit_enforced() {
        let records: Vec<_> = (0..5)
            .map(|i| make_record(&format!("O_{i}"), d(2026, 1, 1)))
            .collect();
        let svc = ExportService::new(records).max_records(3);

        let err = svc
            .export(
                ExportFormat::Json,
                ExportFilter { date_start: None, date_end: None, merchant_address: None, payer_address: None },
            )
            .unwrap_err();

        assert!(
            matches!(err, DataExportError::ExportTooLarge { record_count: 5, max: 3 }),
            "expected ExportTooLarge, got: {err}"
        );
    }

    #[test]
    fn empty_source_produces_empty_json_array() {
        let svc = ExportService::new(vec![]);
        let output = svc
            .export(ExportFormat::Json, ExportFilter { date_start: None, date_end: None, merchant_address: None, payer_address: None })
            .unwrap();
        assert_eq!(output.trim(), "[\n]", "empty export should be an empty JSON array");
    }

    #[test]
    fn streaming_respects_filter_when_counting() {
        let records = vec![
            make_record("O_1", d(2026, 1, 1)),
            make_record("O_2", d(2026, 6, 1)),
        ];
        // max_records=1 — only one record matches the filter, so it should succeed
        let svc = ExportService::new(records).max_records(1);
        let result = svc.export(
            ExportFormat::Json,
            ExportFilter {
                date_start:       Some(d(2026, 5, 1)),
                date_end:         None,
                merchant_address: None,
                payer_address:    None,
            },
        );
        assert!(result.is_ok(), "filtered count should be within limit");
    }
}
