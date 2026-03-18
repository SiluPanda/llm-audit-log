# llm-audit-log -- Specification

## 1. Overview

`llm-audit-log` is a local-first, tamper-evident audit logger for LLM input/output that creates SOC 2, GDPR, and HIPAA-grade audit trails without requiring a hosted observability platform. It records every LLM API interaction -- the prompt sent, the response received, the model used, the actor who triggered the call, token counts, latency, cost, tool calls, and errors -- as append-only structured records with HMAC-SHA256 integrity chains. It supports PII field tagging and selective redaction, configurable retention policies with auto-purge, multiple storage backends (JSONL file and SQLite), and filtered export to JSON and CSV for auditor review and GDPR Subject Access Requests.

The gap this package fills is concrete and measurable. The existing observability platforms for LLM applications -- Langfuse, LangSmith, Helicone, Arize Phoenix -- are all hosted services. They require routing API traffic through a proxy or integrating a cloud-connected SDK, uploading interaction data to third-party servers, and paying for a SaaS subscription. For organizations operating under SOC 2 Type II, HIPAA, GDPR, or the EU AI Act, sending LLM interaction data (which routinely contains PII, protected health information, or proprietary business data) to a third-party platform creates compliance risk that must be evaluated, contracted, and continuously monitored. Many regulated organizations -- healthcare providers, financial institutions, legal firms, government agencies -- cannot or will not accept this risk. They need audit trails that stay on their own infrastructure.

Within this monorepo, `mcp-audit-log` addresses audit logging for MCP protocol traffic (tool calls, resource reads, prompt requests). That package wraps an MCP `Server` instance and records protocol-level JSON-RPC messages. `llm-audit-log` operates at a different layer: it records the LLM API interactions themselves -- the prompts sent to OpenAI, Anthropic, Google, or any other provider, and the completions received. These are complementary, not overlapping. An enterprise deploying both MCP servers and direct LLM API calls needs both audit logs. `llm-audit-log` provides the LLM I/O layer.

`llm-audit-log` provides a TypeScript/JavaScript API for programmatic use and a CLI for terminal operations. The API offers automatic SDK instrumentation (wrap an OpenAI or Anthropic client and every call is logged without code changes), manual recording for custom integrations, querying and filtering of stored entries, HMAC chain integrity verification, and export in JSON and CSV formats. The CLI provides commands for querying, verifying, exporting, purging, and viewing statistics. Both interfaces are designed for zero cloud dependency: everything runs locally, everything is stored locally, and no network connection is required.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createAuditLog(options)` factory function that returns an `AuditLog` instance encapsulating all audit logging state, configuration, and storage.
- Record every LLM API interaction as a structured `AuditEntry` containing: unique ID, timestamp, actor, model, provider, input (prompt/messages), output (completion/response), token counts, latency, estimated cost, tool calls, error details, custom metadata, PII field tags, and HMAC integrity hash.
- Provide a `log.instrument(client)` method that wraps an OpenAI or Anthropic SDK client with a Proxy that automatically records every API call without requiring the caller to modify their application code.
- Provide a `log.record(entry)` method for manually recording LLM interactions from custom integrations, non-supported SDKs, or non-standard API patterns.
- Implement HMAC-SHA256 integrity chains where each entry's HMAC covers the entry content concatenated with the previous entry's HMAC, creating a tamper-evident chain that detects insertion, deletion, modification, or reordering of entries.
- Support PII field tagging: mark which fields in each entry contain personally identifiable information, enabling PII-aware exports, selective redaction, and GDPR Subject Access Request fulfillment.
- Support configurable PII redaction: regex-based pattern matching (emails, phone numbers, SSNs) and custom redaction functions that scrub PII before it reaches the audit log.
- Support optional PII field encryption: encrypt tagged PII fields at rest with a separate key, enabling the audit log to retain PII for compliance while protecting it at rest.
- Support configurable retention policies: entries older than a specified duration are automatically purged, with optional archive-before-purge to cold storage.
- Support two storage backends: JSONL file (default, append-only, portable) and SQLite (queryable, indexed, efficient for large datasets), plus a custom backend adapter interface for user-provided storage.
- Provide a query API for searching and filtering entries by date range, actor, model, provider, token/cost thresholds, error status, and custom metadata.
- Provide export to JSON (machine-readable, full or filtered) and CSV (flattened, spreadsheet-friendly for auditor review).
- Provide GDPR Subject Access Request export: all entries associated with a specific actor, with or without PII fields, in a single operation.
- Provide a `log.verify()` method that walks the HMAC integrity chain, recomputes each HMAC, and reports the chain's status with the location of the first break if any.
- Provide a CLI (`llm-audit-log`) with commands for querying, verifying, exporting, purging, and viewing statistics.
- Support actor injection from request context via `AsyncLocalStorage`, enabling automatic actor identification in multi-user server applications.
- Keep dependencies minimal: zero mandatory runtime dependencies beyond Node.js built-ins. SQLite support requires `better-sqlite3` as an optional peer dependency.
- Target Node.js 18 and above.

### Non-Goals

- **Not a hosted observability platform.** This package does not provide a web dashboard, cloud storage, or SaaS subscription. It stores data locally and exports to local files. For hosted LLM observability, use Langfuse, LangSmith, or Helicone.
- **Not an application logger.** This package records LLM API interactions for compliance audit purposes. It does not record application-level debug/info/warning messages. Use pino, winston, or a structured logger for application logging.
- **Not a real-time monitoring system.** This package records audit entries and provides query/export capabilities after the fact. It does not stream events in real time, alert on anomalies, or provide live dashboards. For real-time monitoring, use an observability platform or build a consumer on top of the export API.
- **Not a cost tracker.** This package records estimated cost as a field on each entry, but it does not maintain running cost totals, set cost budgets, or alert on cost thresholds. For per-test cost tracking, use `llm-cost-per-test` from this monorepo.
- **Not a latency profiler.** This package records latency as a field on each entry, but it does not provide flame charts, span trees, or timing breakdowns. For latency profiling, use `llm-chain-profiler` from this monorepo.
- **Not a PII detection engine.** This package provides regex-based PII redaction and manual PII field tagging. It does not use NLP or ML to automatically detect PII in arbitrary text. For comprehensive PII detection, use a dedicated PII scanner and feed its results into the `piiFields` tags.
- **Not a protocol-level logger.** This package logs LLM API interactions (prompts and completions). It does not log HTTP headers, TCP connections, or transport-level details. For MCP protocol audit logging, use `mcp-audit-log` from this monorepo.
- **Not a content filter or policy engine.** This package records what happened; it does not control what is allowed to happen. For content policy enforcement, use `content-policy` from this monorepo.

---

## 3. Target Users and Use Cases

### Compliance Teams in Regulated Industries

Organizations in healthcare, finance, legal services, and government that deploy LLM-powered applications and must demonstrate to auditors that every AI interaction is recorded with timestamps, actor identification, and data lineage. SOC 2 Type II auditors expect immutable records proving what data was processed, when, by whom, and what the AI system produced. HIPAA requires audit controls for systems that process protected health information. The EU AI Act requires transparency and traceability for high-risk AI systems. These teams need an embeddable audit logger that runs on their own infrastructure without sending data to third parties.

### GDPR Data Protection Officers

Data protection officers responsible for fulfilling GDPR Subject Access Requests (Article 15) and Right to Erasure requests (Article 17). When a data subject requests "all data you hold about me," the DPO needs to export every LLM interaction associated with that individual -- every prompt they submitted, every response they received, every piece of their data that was processed by the AI. The actor-based query and export capabilities of `llm-audit-log` make this a single API call. For erasure requests, the tombstone mechanism enables marking entries as deleted without breaking the HMAC integrity chain.

### Enterprise AI Application Developers

Developers building internal AI tools (document analysis, code review, customer support bots, legal research assistants) who need to add audit logging to satisfy their organization's security and compliance requirements. They need a package they can `npm install`, wrap their OpenAI or Anthropic client with a single line, and get compliance-grade audit trails without building audit infrastructure from scratch.

### Security Engineers and Auditors

Security professionals conducting periodic reviews of AI system behavior -- what prompts were sent, what data was exposed to the model, whether any policy violations occurred, whether the audit trail has been tampered with. The HMAC verification capability and filtered export provide the tools needed for these reviews.

### Healthcare AI Teams

Teams building AI applications that process patient data (clinical decision support, medical coding, radiology report generation). HIPAA's audit controls requirement (45 CFR 164.312(b)) mandates recording who accessed what PHI and when. When a clinician uses an AI tool that sends patient data to an LLM, the interaction must be logged with the clinician's identity, the patient data involved (tagged as PHI), the model's response, and a timestamp. Retention policies must be configured for the HIPAA-mandated 6-year minimum.

### Financial Services AI Teams

Teams building AI applications for financial analysis, risk assessment, or customer advisory services. Financial regulations (SOX, MiFID II, SEC requirements) mandate audit trails for systems that influence financial decisions. When an AI tool produces a recommendation based on client data, the full interaction must be logged, timestamped, and attributed to the analyst who initiated it.

---

## 4. Core Concepts

### Audit Entry

An audit entry is the fundamental unit of record in `llm-audit-log`. Each entry represents a single LLM API interaction: one request sent to a model and one response received. The entry captures everything needed to reconstruct exactly what happened -- who asked, what they asked, which model answered, what it said, how many tokens were used, how long it took, and what it cost. Entries are immutable once written: they are appended to the log and never modified or deleted (except via the explicit purge mechanism, which removes entire entries outside the retention window).

### HMAC Integrity Chain

An HMAC (Hash-Based Message Authentication Code) integrity chain is a sequence of cryptographic hashes where each hash depends on the content of the current entry and the hash of the previous entry. This creates a chain where modifying, inserting, or deleting any entry breaks the chain from that point forward. The mechanism is analogous to a lightweight blockchain but without consensus or distributed state -- it is a single-writer hash chain providing tamper evidence, not tamper prevention.

The chain works as follows:

1. The first entry's HMAC is computed as `HMAC-SHA256(secret, seed + canonicalJSON(entry))`, where `seed` is a configurable initial value.
2. Each subsequent entry's HMAC is computed as `HMAC-SHA256(secret, previousHmac + canonicalJSON(entry))`.
3. Verification walks the chain from the first entry, recomputes each HMAC, and compares it to the stored value. The first mismatch indicates the location of tampering.

HMAC chains provide tamper _evidence_, not tamper _prevention_. An attacker with both filesystem access and the HMAC secret can recompute the entire chain. The defense against this is to periodically export the chain head (the latest HMAC) to an external, trusted store -- a separate database, a hardware security module, a remote logging service, or even a printed record. This package computes and verifies the chain; external anchoring is the user's responsibility.

### PII Tagging

LLM inputs routinely contain personally identifiable information: names, email addresses, phone numbers, social security numbers, medical record numbers, financial account numbers. Audit logs that record these inputs inherit the PII and become subject to data protection regulations. `llm-audit-log` addresses this through PII field tagging: each entry can declare which of its fields contain PII via the `piiFields` array. This tagging enables three capabilities:

1. **PII-aware export**: Export entries with or without PII fields, enabling auditors to review the audit trail without accessing raw PII.
2. **Selective redaction**: Replace PII values with placeholders before writing to the audit log, reducing the data protection surface area.
3. **GDPR deletion**: When a data subject exercises their right to erasure, tombstone entries can reference and logically delete all entries tagged with that subject's PII, without rewriting the HMAC chain.

### Retention Policy

A retention policy defines how long audit entries are kept before they are eligible for deletion. Compliance frameworks specify minimum retention periods: HIPAA requires 6 years, SOC 2 typically covers 12 months, GDPR requires that data not be kept longer than necessary (requiring a defined retention period). `llm-audit-log` supports configurable retention with auto-purge: entries older than the configured maximum age are automatically deleted during periodic cleanup runs. Entries can optionally be archived (exported to a file) before purging.

### Storage Backend

A storage backend is the mechanism used to persist audit entries. `llm-audit-log` supports two built-in backends and a custom adapter interface:

1. **JSONL file** (default): Append-only, one JSON object per line. Simple, portable, and compatible with Unix tools (`jq`, `grep`, `wc`). Best for smaller deployments and environments where a database dependency is undesirable.
2. **SQLite**: A local database file with indexed columns for efficient querying by actor, timestamp, model, and provider. Best for deployments with large log volumes or frequent query/export operations.
3. **Custom backend**: An adapter interface that users implement to store entries in any system (PostgreSQL, S3, Elasticsearch, etc.).

### Export

Export produces a self-contained file from the audit log, filtered by date range, actor, model, or other criteria. Two formats are supported: JSON (the complete entry objects, machine-readable) and CSV (flattened fields, one row per entry, importable into spreadsheets and auditor tools). Exports serve two compliance purposes: providing evidence to auditors during periodic reviews, and fulfilling GDPR Subject Access Requests that require producing all data held about a specific individual.

---

## 5. Audit Entry Schema

Every audit entry is a JSON object with the following structure. All fields except `hmac` and `piiFields` are populated at write time. The `hmac` field is computed by the integrity chain mechanism. The `piiFields` field is set by the caller or by automatic PII detection.

```typescript
interface AuditEntry {
  /**
   * Unique identifier for this entry. UUIDv4, generated by the audit log.
   */
  id: string;

  /**
   * Schema version for forward compatibility. Current version: 1.
   */
  v: 1;

  /**
   * ISO 8601 timestamp with millisecond precision and UTC timezone.
   * Recorded at the moment the LLM response is fully received.
   * Example: '2026-03-19T10:30:00.123Z'
   */
  timestamp: string;

  /**
   * The user, service account, or system that triggered this LLM call.
   * For multi-user applications, this identifies who is responsible for
   * the interaction. For automated systems, this identifies the service.
   *
   * Examples: 'user:jane.doe@example.com', 'service:document-analyzer',
   *           'api-key:sk-...abc' (last 3 chars only for identification).
   *
   * Null when actor identification is not configured.
   */
  actor: string | null;

  /**
   * The model name as passed to the API.
   * Examples: 'gpt-4o', 'gpt-4o-mini', 'claude-opus-4-20250514',
   *           'claude-sonnet-4-20250514', 'gemini-1.5-pro'
   */
  model: string;

  /**
   * The LLM provider.
   */
  provider: 'openai' | 'anthropic' | 'google' | 'azure-openai' | 'aws-bedrock' | 'custom';

  /**
   * The input sent to the LLM. For chat models, this is the messages array.
   * For completion models, this is the prompt string.
   * Subject to PII redaction and size truncation.
   */
  input: unknown;

  /**
   * The response received from the LLM. For chat models, this is the
   * assistant message content. For completion models, this is the
   * completion text.
   * Subject to PII redaction and size truncation.
   */
  output: unknown;

  /**
   * Token counts from the API response's usage field.
   */
  tokens: {
    /** Number of input tokens (prompt tokens). */
    input: number;
    /** Number of output tokens (completion tokens). */
    output: number;
    /** Total tokens (input + output). */
    total: number;
  };

  /**
   * Response latency in milliseconds.
   * Measured from the moment the API request is dispatched to the moment
   * the response is fully received (stream closed for streaming responses,
   * response body received for non-streaming responses).
   */
  latencyMs: number;

  /**
   * Estimated cost of this interaction in USD.
   * Computed from token counts and the model's published pricing.
   * Null when pricing data is not available for the model.
   */
  cost: number | null;

  /**
   * Tool calls made during this interaction (function calling / tool use).
   * Null when no tool calls were made.
   */
  toolCalls: Array<{
    /** Tool/function name. */
    name: string;
    /** Arguments passed to the tool (JSON object). */
    arguments: Record<string, unknown>;
    /** Tool call ID from the API response. */
    id?: string;
    /** Tool result, if available. */
    result?: unknown;
  }> | null;

  /**
   * Error details if the LLM call failed.
   * Null on success.
   */
  error: {
    /** Error message. */
    message: string;
    /** Error code (e.g., 'rate_limit_exceeded', 'context_length_exceeded'). */
    code?: string;
    /** HTTP status code, if applicable. */
    statusCode?: number;
  } | null;

  /**
   * Custom key-value pairs provided by the caller.
   * Used for application-specific context: conversation ID, session ID,
   * feature flag state, deployment environment, etc.
   */
  metadata: Record<string, unknown>;

  /**
   * List of field paths in this entry that contain PII.
   * Used for PII-aware exports, selective redaction, and GDPR compliance.
   *
   * Examples: ['input', 'output', 'metadata.customerEmail']
   * An empty array means no PII fields are tagged (not that no PII exists).
   */
  piiFields: string[];

  /**
   * HMAC-SHA256 integrity hash. Present only when integrity is configured.
   * Computed as HMAC-SHA256(secret, previousHmac + canonicalJSON(entryWithoutHmac)).
   */
  hmac?: string;

  /**
   * Integrity chain seed. Present only on the first entry when
   * integrity is configured.
   */
  hmacSeed?: string;

  /**
   * Whether this entry is a tombstone (logical deletion marker).
   * Tombstone entries reference deleted entries and preserve chain integrity.
   * Defaults to false.
   */
  tombstone?: boolean;

  /**
   * For tombstone entries: the IDs of the entries being logically deleted.
   */
  deletedEntryIds?: string[];

  /**
   * For tombstone entries: the reason for deletion.
   * Example: 'GDPR erasure request ref:DSR-2026-0042'
   */
  deletionReason?: string;
}
```

### Entry Example (JSONL Line)

```json
{"id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","v":1,"timestamp":"2026-03-19T10:30:00.123Z","actor":"user:jane.doe@example.com","model":"gpt-4o","provider":"openai","input":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Summarize the Q3 earnings report for Acme Corp."}],"output":{"role":"assistant","content":"Acme Corp reported Q3 revenue of $4.2B, up 12% year-over-year..."},"tokens":{"input":2400,"output":350,"total":2750},"latencyMs":1842,"cost":0.0385,"toolCalls":null,"error":null,"metadata":{"conversationId":"conv-789","environment":"production"},"piiFields":["input"],"hmac":"a7f3b2c1e4d5..."}
```

### Tombstone Entry Example

```json
{"id":"b2c3d4e5-f6a7-8901-bcde-f12345678901","v":1,"timestamp":"2026-03-19T14:00:00.000Z","actor":"system:gdpr-processor","model":"","provider":"custom","input":null,"output":null,"tokens":{"input":0,"output":0,"total":0},"latencyMs":0,"cost":null,"toolCalls":null,"error":null,"metadata":{"requestType":"gdpr-erasure","requestRef":"DSR-2026-0042"},"piiFields":[],"tombstone":true,"deletedEntryIds":["a1b2c3d4-...","c3d4e5f6-..."],"deletionReason":"GDPR erasure request ref:DSR-2026-0042","hmac":"b8f4c3d2e5a6..."}
```

---

## 6. HMAC Integrity Chain

### How the Chain Works

The HMAC integrity chain creates a cryptographic dependency between consecutive audit entries. Each entry's HMAC is computed over the entry's content concatenated with the previous entry's HMAC. This means that changing any entry invalidates all subsequent entries in the chain.

**Chain initialization**:

```
entry[0].hmac = HMAC-SHA256(secret, seed + canonicalJSON(entry[0] without hmac/hmacSeed fields))
```

The first entry also stores the seed in its `hmacSeed` field. The seed is either provided in the configuration or generated as a random 32-byte hex string.

**Chain continuation**:

```
entry[n].hmac = HMAC-SHA256(secret, entry[n-1].hmac + canonicalJSON(entry[n] without hmac field))
```

**Canonical JSON**: To ensure deterministic HMAC computation, `canonicalJSON` serializes the entry object with keys sorted alphabetically at every nesting level. This eliminates the non-determinism of `JSON.stringify` key ordering.

### What Breaks the Chain

| Tampering Action | Detection Mechanism |
|---|---|
| Modify an entry's content | Recomputed HMAC for that entry will not match the stored HMAC. |
| Delete an entry from the middle | The entry after the deleted one will have an HMAC computed against the wrong predecessor HMAC. |
| Insert an entry into the middle | The entry after the inserted one will have an HMAC that does not account for the inserted entry. |
| Reorder entries | HMACs depend on sequential order; reordering breaks the chain at the first displaced entry. |
| Append a forged entry | Without the HMAC secret, the attacker cannot compute a valid HMAC. |
| Recompute the entire chain | Requires the HMAC secret. Defense: export chain heads to an external trusted store. |

### Key Management

The HMAC secret is the critical security parameter. Recommendations:

- Store the secret in an environment variable, secrets manager (AWS Secrets Manager, HashiCorp Vault), or hardware security module. Never hardcode it in source code.
- Use a cryptographically random secret of at least 32 bytes.
- Rotate the secret periodically. On rotation, start a new chain segment. The verification API supports multi-segment chains where each segment uses a different secret.
- The HMAC secret provides integrity (tamper evidence), not confidentiality. The audit log content is stored in plaintext unless PII encryption is enabled.

### Verification Process

The `log.verify()` method walks the chain from the first entry to the last:

1. Read the first entry. Extract `hmacSeed`. Compute `HMAC-SHA256(secret, seed + canonicalJSON(entry))`. Compare to stored `hmac`.
2. For each subsequent entry: compute `HMAC-SHA256(secret, previousHmac + canonicalJSON(entry))`. Compare to stored `hmac`.
3. If all HMACs match, the chain is intact. If any mismatch is found, report the index and details of the first broken link.

Partial verification (`log.verify({ last: N })`) verifies only the last N entries, which is useful for quick health checks on large logs.

---

## 7. PII Handling

### PII Field Tagging

Each audit entry has a `piiFields` array that declares which fields contain personally identifiable information. This is a declarative annotation -- it does not modify the data; it labels it. The tagging enables downstream operations (export, redaction, deletion) to treat PII fields differently from non-PII fields.

Tagging is set in three ways:

1. **Manual tagging**: The caller passes `piiFields` when recording an entry via `log.record()`.
2. **Automatic tagging via configuration**: The audit log is configured with a default set of PII field paths (e.g., `['input', 'output']`), and these are applied to every entry.
3. **SDK instrumentation inference**: When using `log.instrument(client)`, the `input` and `output` fields are tagged as PII by default (since prompts and completions frequently contain user data).

### PII Redaction

Redaction replaces PII values with a placeholder before the entry is written to storage. This is a destructive operation: the original PII is not recoverable from the audit log. Redaction is appropriate when the audit trail needs to prove that an interaction occurred, with timing, model, and token data, but does not need to preserve the actual content.

Redaction is configured via the `redaction` option:

```typescript
interface RedactionConfig {
  /**
   * Regex patterns to match and replace within string values.
   * Applied to all string fields in the entry (input, output, metadata values).
   *
   * Common patterns:
   *   /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g  — email addresses
   *   /\b\d{3}-\d{2}-\d{4}\b/g                                   — US SSN
   *   /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g                           — US phone numbers
   *   /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g             — credit card numbers
   */
  patterns?: RegExp[];

  /**
   * Field paths to always redact, regardless of content.
   * Uses dot notation relative to the entry.
   *
   * Examples:
   *   'input' — redact the entire input field
   *   'metadata.customerEmail' — redact a specific metadata field
   */
  paths?: string[];

  /**
   * Custom redaction function. Receives a field path and string value,
   * returns the (possibly redacted) value.
   */
  custom?: (path: string, value: string) => string;

  /**
   * The placeholder string used to replace redacted values.
   * Defaults to '[REDACTED]'.
   */
  placeholder?: string;
}
```

Redaction is applied in-memory before HMAC computation and before writing to storage. The redacted content is what gets hashed and stored, so the HMAC chain reflects the redacted state, not the original.

### PII-Aware Export

The export API supports a `includePii` option:

- `includePii: true` (default): Export entries with all fields intact.
- `includePii: false`: Export entries with PII-tagged fields replaced by `'[PII_EXCLUDED]'`. The non-PII fields (timestamps, model, tokens, latency, cost, metadata keys) remain intact. This produces an audit trail that proves interactions occurred without exposing personal data.

### GDPR Erasure (Right to Deletion)

GDPR Article 17 gives data subjects the right to request deletion of their personal data. For an append-only, HMAC-chained audit log, deleting entries in the middle of the chain would break the chain's integrity. `llm-audit-log` resolves this conflict with tombstone entries:

1. Query all entries for the target actor: `log.query({ actor: 'user:jane.doe@example.com' })`.
2. Create a tombstone entry that references the IDs of all entries to be logically deleted: `log.erase({ actor: 'user:jane.doe@example.com', reason: 'GDPR erasure request ref:DSR-2026-0042' })`.
3. The tombstone entry is appended to the chain (preserving chain integrity) and records the deletion reason and referenced entry IDs.
4. Subsequent queries skip tombstoned entries by default. Exports exclude tombstoned entries' PII fields by default.
5. For the JSONL backend, the original entries remain in the file but are treated as logically deleted. For the SQLite backend, PII fields in tombstoned entries are overwritten with null values.

This approach satisfies GDPR's deletion requirement (the PII is no longer accessible through any standard query or export) while preserving the audit log's integrity chain and the ability to prove that interactions occurred (the non-PII metadata -- timestamp, model, token counts -- remains).

### PII Field Encryption

For environments that require PII at rest but must encrypt it separately from the rest of the audit log (defense in depth, key separation), `llm-audit-log` supports optional field-level encryption:

```typescript
interface PiiEncryptionConfig {
  /**
   * AES-256-GCM encryption key for PII fields.
   * Must be exactly 32 bytes. Stored separately from the HMAC secret.
   */
  key: Buffer;
}
```

When PII encryption is enabled:

1. Fields tagged in `piiFields` are encrypted with AES-256-GCM before storage.
2. The encrypted value and initialization vector (IV) are stored in the entry.
3. HMAC computation covers the encrypted (not plaintext) value, so the chain validates without the PII key.
4. Export and query operations decrypt PII fields using the PII key.
5. Revoking the PII key makes PII irrecoverable while the audit chain remains verifiable -- a crypto-shredding mechanism for GDPR erasure at scale.

---

## 8. Retention Policies

### Configuration

```typescript
interface RetentionPolicy {
  /**
   * Maximum age for audit entries. Entries older than this are eligible
   * for purging.
   *
   * Common values:
   *   90 * 24 * 60 * 60 * 1000         — 90 days
   *   365 * 24 * 60 * 60 * 1000        — 1 year (SOC 2 typical)
   *   6 * 365 * 24 * 60 * 60 * 1000    — 6 years (HIPAA minimum)
   *   7 * 365 * 24 * 60 * 60 * 1000    — 7 years (SOX/financial)
   */
  maxAge: number;

  /**
   * How often to run the automatic purge check, in milliseconds.
   * Defaults to 86_400_000 (24 hours).
   */
  checkIntervalMs?: number;

  /**
   * Whether to export entries to an archive file before purging.
   * When true, entries are exported to JSON before deletion.
   * Defaults to false.
   */
  archiveBeforePurge?: boolean;

  /**
   * Directory for archive files. Only used when archiveBeforePurge is true.
   * Archive files are named 'archive-{from}-{to}.json'.
   * Defaults to an 'archive' subdirectory alongside the audit log.
   */
  archiveDir?: string;
}
```

### Auto-Purge Behavior

When a retention policy is configured:

1. On startup, the audit log runs an initial purge check.
2. A periodic timer (using `setInterval` with `unref()` to avoid blocking process exit) runs the purge check at `checkIntervalMs` intervals.
3. Each purge check identifies entries with `timestamp` older than `now - maxAge`.
4. If `archiveBeforePurge` is true, matching entries are exported to a timestamped archive file in JSON format before deletion.
5. Matching entries are deleted from the storage backend.
6. For JSONL backends, purging requires rewriting the file (excluding purged entries). The HMAC chain is not recomputed -- purged entries are simply removed, and a chain gap record is written to document the purge event.
7. For SQLite backends, purging is a `DELETE FROM audit_entries WHERE timestamp < ?` query.

### Manual Purge

The `log.purge(before)` method immediately purges all entries with timestamps before the specified date, returning the count of entries purged. This bypasses the retention timer and is used for manual maintenance.

---

## 9. Storage Backends

### JSONL File Backend (Default)

The JSONL (JSON Lines) backend writes each audit entry as a single JSON object on a single line, terminated by `\n`. This format is:

- **Append-only**: New entries are added by appending lines. The file is opened with the `'a'` flag, ensuring the OS never overwrites existing content.
- **Streamable**: Entries can be read line by line without loading the entire file into memory.
- **Tool-friendly**: Compatible with `jq`, `grep`, `wc -l`, and log aggregation pipelines.
- **Portable**: A single file that can be copied, archived, or transferred.

**File rotation**: When the active log file exceeds a configurable size threshold (default 50 MiB), it is rotated. The active file is renamed with a numeric suffix (`audit.jsonl.1`, `audit.jsonl.2`, etc.) and a new active file is created. Older rotated files are optionally compressed with gzip.

**File permissions**: New files are created with mode `0o600` (owner read/write only) by default. This is configurable.

**Query performance**: For the JSONL backend, queries require scanning the file line by line (with optional index files for common queries). For small to medium deployments (up to hundreds of thousands of entries), this is adequate. For larger deployments, the SQLite backend is recommended.

```typescript
interface JsonlBackendConfig {
  type: 'jsonl';

  /** Path to the audit log file. Created if it does not exist. */
  path: string;

  /** File permissions for newly created files. Defaults to 0o600. */
  mode?: number;

  /** Maximum file size in bytes before rotation. Defaults to 52_428_800 (50 MiB). */
  maxFileSize?: number;

  /** Maximum number of rotated files to keep. Defaults to 10. */
  maxFiles?: number;

  /** Whether to compress rotated files with gzip. Defaults to false. */
  compress?: boolean;
}
```

### SQLite Backend

The SQLite backend stores audit entries in a local database file with indexed columns for efficient querying. It uses `better-sqlite3` (an optional peer dependency) for synchronous, in-process database access with no server required.

**Schema**:

```sql
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  v INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  actor TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input TEXT,         -- JSON-serialized
  output TEXT,        -- JSON-serialized
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  tokens_total INTEGER NOT NULL,
  latency_ms REAL NOT NULL,
  cost REAL,
  tool_calls TEXT,    -- JSON-serialized
  error TEXT,         -- JSON-serialized
  metadata TEXT,      -- JSON-serialized
  pii_fields TEXT,    -- JSON-serialized array
  hmac TEXT,
  hmac_seed TEXT,
  tombstone INTEGER DEFAULT 0,
  deleted_entry_ids TEXT,
  deletion_reason TEXT
);

CREATE INDEX idx_timestamp ON audit_entries(timestamp);
CREATE INDEX idx_actor ON audit_entries(actor);
CREATE INDEX idx_model ON audit_entries(model);
CREATE INDEX idx_provider ON audit_entries(provider);
CREATE INDEX idx_tombstone ON audit_entries(tombstone);
```

**Advantages over JSONL**:
- Indexed queries: filter by actor, model, date range without scanning every entry.
- Efficient counting and aggregation.
- Atomic deletes for purging (no file rewriting).
- Full-text search on input/output fields (using SQLite FTS5 extension).

**Trade-off**: Requires `better-sqlite3` as a peer dependency, which has a native C++ component that must be compiled or downloaded as a prebuilt binary. Environments that cannot install native modules should use the JSONL backend.

```typescript
interface SqliteBackendConfig {
  type: 'sqlite';

  /** Path to the SQLite database file. Created if it does not exist. */
  path: string;

  /** Whether to enable WAL mode for better concurrent read performance. Defaults to true. */
  walMode?: boolean;

  /** Whether to enable FTS5 full-text search on input and output fields. Defaults to false. */
  fullTextSearch?: boolean;
}
```

### Custom Backend Adapter

Users can implement a custom backend for any storage system. The adapter interface defines the minimum operations required:

```typescript
interface StorageBackend {
  /**
   * Initialize the backend (create tables, open connections, etc.).
   */
  init(): Promise<void>;

  /**
   * Write one or more audit entries.
   * Must not throw. Report errors via the onError callback.
   */
  write(entries: AuditEntry[]): Promise<void>;

  /**
   * Query entries matching the given filters.
   * Returns an async iterable for memory-efficient streaming of large result sets.
   */
  query(filters: QueryFilters): AsyncIterable<AuditEntry>;

  /**
   * Count entries matching the given filters.
   */
  count(filters: QueryFilters): Promise<number>;

  /**
   * Delete entries matching the given filters.
   * Returns the number of entries deleted.
   */
  delete(filters: QueryFilters): Promise<number>;

  /**
   * Close the backend and release resources.
   */
  close(): Promise<void>;
}
```

---

## 10. API Surface

### Installation

```bash
npm install llm-audit-log
```

### Optional Peer Dependency (for SQLite backend)

```json
{
  "peerDependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "peerDependenciesMeta": {
    "better-sqlite3": {
      "optional": true
    }
  }
}
```

### Core Exports

```typescript
import {
  createAuditLog,
  setActorContext,
  getActorContext,
} from 'llm-audit-log';
```

### `createAuditLog(options)`

Factory function that creates an `AuditLog` instance.

```typescript
function createAuditLog(options: AuditLogOptions): AuditLog;
```

### `AuditLogOptions`

```typescript
interface AuditLogOptions {
  /**
   * Storage backend configuration.
   * Defaults to { type: 'jsonl', path: './audit.jsonl' }.
   */
  storage?: JsonlBackendConfig | SqliteBackendConfig | { type: 'custom'; backend: StorageBackend };

  /**
   * HMAC integrity chain configuration.
   * When provided, each entry includes an `hmac` field forming
   * a tamper-evident hash chain.
   * Disabled by default.
   */
  integrity?: IntegrityConfig;

  /**
   * PII redaction configuration.
   * When provided, matching patterns and paths are redacted
   * before entries are stored.
   */
  redaction?: RedactionConfig;

  /**
   * PII field encryption configuration.
   * When provided, PII-tagged fields are encrypted at rest.
   */
  piiEncryption?: PiiEncryptionConfig;

  /**
   * Default PII field paths applied to every entry.
   * Merged with per-entry piiFields.
   * Defaults to ['input', 'output'].
   */
  defaultPiiFields?: string[];

  /**
   * Retention policy configuration.
   * When provided, entries exceeding maxAge are automatically purged.
   */
  retention?: RetentionPolicy;

  /**
   * Buffer and flush settings controlling how entries are batched
   * before writing to storage.
   */
  buffer?: BufferConfig;

  /**
   * Maximum size in bytes for any single field value in the entry.
   * Values exceeding this limit are truncated and a
   * '_truncated: true' flag is added to the entry metadata.
   * Defaults to 1_048_576 (1 MiB). Set to 0 to disable truncation.
   */
  maxFieldSize?: number;

  /**
   * Model pricing data for cost estimation.
   * Keys are model names. Values are cost per 1M tokens (input and output).
   * A default pricing table is included for common models.
   * Custom entries override defaults.
   */
  pricing?: Record<string, { inputPer1M: number; outputPer1M: number }>;

  /**
   * Called when the audit log encounters an internal error
   * (e.g., storage write failure, HMAC computation error).
   * The LLM operation continues normally regardless.
   * Defaults to console.error.
   */
  onError?: (error: Error) => void;
}
```

### `IntegrityConfig`

```typescript
interface IntegrityConfig {
  /**
   * The HMAC algorithm to use.
   * Defaults to 'sha256'.
   */
  algorithm?: 'sha256' | 'sha384' | 'sha512';

  /**
   * The secret key for HMAC computation.
   * Must be provided as a string or Buffer.
   * Required when integrity is enabled.
   */
  secret: string | Buffer;

  /**
   * The seed value for the first entry in the chain.
   * If not provided, a random 32-byte hex string is generated
   * and recorded in the first entry's hmacSeed field.
   */
  seed?: string;
}
```

### `BufferConfig`

```typescript
interface BufferConfig {
  /**
   * Maximum number of entries to buffer before flushing.
   * Defaults to 50.
   */
  maxEntries?: number;

  /**
   * Maximum time in milliseconds to wait before flushing buffered entries.
   * Defaults to 1000 (1 second).
   */
  flushIntervalMs?: number;

  /**
   * Whether to flush immediately on every entry (no buffering).
   * Useful for development/debugging but reduces throughput.
   * Defaults to false.
   */
  immediate?: boolean;
}
```

### `AuditLog` Instance

```typescript
interface AuditLog {
  /**
   * Record a single LLM interaction as an audit entry.
   * This is the manual recording API for custom integrations.
   *
   * @param entry - Partial entry. id, v, timestamp, and hmac are auto-generated.
   * @returns The complete AuditEntry with all fields populated.
   */
  record(entry: RecordInput): Promise<AuditEntry>;

  /**
   * Wrap an LLM SDK client with automatic audit logging.
   * Returns a Proxy that behaves identically to the original client
   * but records every API call as an audit entry.
   *
   * Supported clients: OpenAI SDK, Anthropic SDK.
   * For unsupported clients, use the manual record() API.
   *
   * @param client - The LLM SDK client to instrument.
   * @param options - Instrumentation options.
   * @returns A typed Proxy wrapping the original client.
   */
  instrument<T extends object>(client: T, options?: InstrumentOptions): T;

  /**
   * Query audit entries matching the given filters.
   * Returns an async iterable for memory-efficient streaming.
   */
  query(filters?: QueryFilters): AsyncIterable<AuditEntry>;

  /**
   * Verify the HMAC integrity chain.
   * Returns a verification result indicating whether the chain is intact.
   */
  verify(options?: VerifyOptions): Promise<VerificationResult>;

  /**
   * Export audit entries to JSON or CSV format.
   *
   * @param format - 'json' or 'csv'.
   * @param options - Export options (filters, PII inclusion).
   * @returns The exported data as a string (JSON/CSV) or Buffer.
   */
  export(format: ExportFormat, options?: ExportOptions): Promise<string>;

  /**
   * Purge entries older than the specified date.
   * Returns the number of entries purged.
   */
  purge(before: Date): Promise<number>;

  /**
   * Create a tombstone entry for GDPR erasure.
   * Logically deletes all entries matching the given actor.
   * Returns the tombstone entry.
   */
  erase(options: EraseOptions): Promise<AuditEntry>;

  /**
   * Get statistics about the audit log.
   */
  stats(): Promise<AuditStats>;

  /**
   * Flush all buffered entries to storage.
   */
  flush(): Promise<void>;

  /**
   * Close the audit log: flush buffers, stop retention timers,
   * and release storage resources.
   */
  close(): Promise<void>;

  /**
   * Whether the audit log is currently active (not closed).
   */
  readonly active: boolean;

  /**
   * Total number of entries written since the audit log was created.
   */
  readonly entryCount: number;
}
```

### `RecordInput`

```typescript
interface RecordInput {
  /** The actor who triggered the LLM call. */
  actor?: string;
  /** The model name. */
  model: string;
  /** The LLM provider. */
  provider: AuditEntry['provider'];
  /** The input sent to the LLM. */
  input: unknown;
  /** The output received from the LLM. */
  output: unknown;
  /** Token counts. */
  tokens: { input: number; output: number };
  /** Latency in milliseconds. */
  latencyMs: number;
  /** Estimated cost in USD. Null if unknown. */
  cost?: number | null;
  /** Tool calls, if any. */
  toolCalls?: AuditEntry['toolCalls'];
  /** Error details, if any. */
  error?: AuditEntry['error'];
  /** Custom metadata. */
  metadata?: Record<string, unknown>;
  /** PII field paths (merged with defaultPiiFields). */
  piiFields?: string[];
}
```

### `QueryFilters`

```typescript
interface QueryFilters {
  /** Filter by time range (inclusive). */
  from?: Date;
  to?: Date;

  /** Filter by actor (exact match or array of actors). */
  actor?: string | string[];

  /** Filter by model name (exact match or array). */
  model?: string | string[];

  /** Filter by provider. */
  provider?: AuditEntry['provider'] | AuditEntry['provider'][];

  /** Filter by minimum token count (total tokens). */
  minTokens?: number;

  /** Filter by minimum cost. */
  minCost?: number;

  /** Only return entries that had errors. */
  errorsOnly?: boolean;

  /** Only return entries with tool calls. */
  withToolCalls?: boolean;

  /** Exclude tombstoned entries. Defaults to true. */
  excludeTombstones?: boolean;

  /** Full-text search in input/output (SQLite backend with FTS5 only). */
  search?: string;

  /** Custom metadata filter (key-value pairs, all must match). */
  metadata?: Record<string, unknown>;

  /** Maximum number of entries to return. */
  limit?: number;

  /** Number of entries to skip (for pagination). */
  offset?: number;

  /** Sort order by timestamp. Defaults to 'asc'. */
  order?: 'asc' | 'desc';
}
```

### `VerifyOptions`

```typescript
interface VerifyOptions {
  /**
   * Verify only the last N entries instead of the entire chain.
   * Useful for quick integrity checks on large logs.
   */
  last?: number;
}
```

### `VerificationResult`

```typescript
interface VerificationResult {
  /** Whether the entire chain (or verified segment) is intact. */
  valid: boolean;

  /** Total number of entries verified. */
  entryCount: number;

  /** Total number of entries in the audit log (may be larger than entryCount for partial verification). */
  totalEntries: number;

  /** Index of the first invalid entry, if any. -1 if all valid. */
  firstInvalidIndex: number;

  /** The expected HMAC at the invalid index, if applicable. */
  expectedHmac?: string;

  /** The actual HMAC found at the invalid index, if applicable. */
  actualHmac?: string;

  /** The entry ID at the invalid index, if applicable. */
  invalidEntryId?: string;

  /** Time taken for verification in milliseconds. */
  durationMs: number;

  /** Error message if verification itself failed (e.g., storage read error). */
  error?: string;
}
```

### `ExportFormat` and `ExportOptions`

```typescript
type ExportFormat = 'json' | 'csv';

interface ExportOptions {
  /** Filters to apply before exporting. */
  filters?: QueryFilters;

  /** Whether to include PII-tagged fields. Defaults to true. */
  includePii?: boolean;

  /** For CSV: which fields to include as columns. Defaults to all top-level fields. */
  columns?: string[];

  /** For GDPR Subject Access Request: export all entries for a specific actor. */
  subjectAccessRequest?: {
    actor: string;
  };
}
```

### `EraseOptions`

```typescript
interface EraseOptions {
  /** The actor whose entries should be logically deleted. */
  actor: string;

  /** Reason for deletion (e.g., 'GDPR erasure request ref:DSR-2026-0042'). */
  reason: string;

  /** Whether to also overwrite PII fields in the storage backend (SQLite only). */
  overwritePii?: boolean;
}
```

### `AuditStats`

```typescript
interface AuditStats {
  /** Total number of entries (including tombstones). */
  totalEntries: number;

  /** Number of active (non-tombstoned) entries. */
  activeEntries: number;

  /** Number of tombstone entries. */
  tombstoneEntries: number;

  /** Timestamp of the oldest entry. */
  oldestEntry: string | null;

  /** Timestamp of the newest entry. */
  newestEntry: string | null;

  /** Storage size in bytes. */
  storageSizeBytes: number;

  /** Breakdown by provider. */
  byProvider: Record<string, { count: number; totalTokens: number; totalCost: number }>;

  /** Breakdown by model. */
  byModel: Record<string, { count: number; totalTokens: number; totalCost: number }>;

  /** Distinct actor count. */
  distinctActors: number;

  /** Total tokens across all entries. */
  totalTokens: number;

  /** Total estimated cost across all entries. */
  totalCost: number;

  /** HMAC chain status. */
  integrityStatus: 'enabled' | 'disabled' | 'unverified';
}
```

### `InstrumentOptions`

```typescript
interface InstrumentOptions {
  /**
   * The actor to attribute instrumented calls to.
   * If not provided, the actor is inferred from AsyncLocalStorage context
   * (set via setActorContext).
   */
  actor?: string;

  /**
   * Additional metadata to include on every auto-recorded entry.
   */
  metadata?: Record<string, unknown>;

  /**
   * PII fields to tag on every auto-recorded entry (merged with defaults).
   */
  piiFields?: string[];

  /**
   * Whether to capture the full input/output content.
   * When false, only metadata (model, tokens, latency, cost) is recorded.
   * Defaults to true.
   */
  captureContent?: boolean;
}
```

---

## 11. SDK Instrumentation

### Automatic Logging via `instrument()`

The `log.instrument(client)` method wraps an LLM SDK client with a `Proxy` that intercepts every API call and automatically records an audit entry. The instrumented client behaves identically to the original -- same types, same methods, same return values. The only observable difference is that an audit entry is written for each call.

```typescript
import { createAuditLog } from 'llm-audit-log';
import OpenAI from 'openai';

const log = createAuditLog({
  storage: { type: 'jsonl', path: './audit.jsonl' },
  integrity: { secret: process.env.AUDIT_HMAC_SECRET! },
});

const openai = log.instrument(new OpenAI());

// Every call is now automatically audit-logged
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
});
// An AuditEntry is written with model='gpt-4o', provider='openai',
// input=messages, output=response, tokens from usage, latency measured, cost estimated.
```

### What the Instrumentation Captures

For each intercepted API call:

1. **Before the call**: Record the start time (`performance.now()`), capture the input (messages array for chat, prompt for completion), model name, and any tool definitions.
2. **After the call** (success): Capture the output, token counts from the response's `usage` field, compute latency, estimate cost from the pricing table, and record any tool calls in the response.
3. **After the call** (error): Capture the error message, error code, and HTTP status code. The entry is still recorded with `error` populated.
4. **For streaming responses**: The instrumentation wraps the stream to measure total latency (from dispatch to stream close), accumulate token counts (from the final chunk's usage field or by counting chunks), and capture the full output text.

### Supported SDKs

**OpenAI (`openai` npm package)**:
- `client.chat.completions.create()`: Intercepted for both streaming and non-streaming calls.
- `client.completions.create()`: Intercepted (legacy completions API).
- `client.responses.create()`: Intercepted (Responses API).

**Anthropic (`@anthropic-ai/sdk` npm package)**:
- `client.messages.create()`: Intercepted for non-streaming calls.
- `client.messages.stream()`: Intercepted; stream is wrapped for latency and token measurement.

For unsupported SDKs, use the `log.record()` API to manually record entries.

### Actor Context via AsyncLocalStorage

In multi-user server applications, the actor (the user who triggered the LLM call) varies per request. `llm-audit-log` provides `setActorContext()` to set the actor for all instrumented calls within an async execution context:

```typescript
import { setActorContext, createAuditLog } from 'llm-audit-log';
import express from 'express';

const log = createAuditLog({ /* ... */ });
const openai = log.instrument(new OpenAI());

const app = express();

app.post('/chat', async (req, res) => {
  // Set the actor for all LLM calls within this request
  setActorContext(`user:${req.user.email}`, async () => {
    // This call's audit entry will have actor='user:jane@example.com'
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: req.body.messages,
    });
    res.json(response);
  });
});
```

`setActorContext` uses Node.js `AsyncLocalStorage` internally. The actor context propagates through all async operations (await, setTimeout, setImmediate, Promise chains) within the callback.

---

## 12. Querying and Filtering

### Programmatic Query API

The `log.query(filters)` method returns an `AsyncIterable<AuditEntry>` that yields entries matching the given filters. Using `AsyncIterable` enables memory-efficient processing of large result sets -- entries are streamed from storage rather than loaded into memory all at once.

```typescript
// Find all entries for a specific actor in the last 7 days
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
for await (const entry of log.query({
  actor: 'user:jane.doe@example.com',
  from: sevenDaysAgo,
  order: 'desc',
})) {
  console.log(`${entry.timestamp} ${entry.model} ${entry.tokens.total} tokens`);
}
```

```typescript
// Find all failed LLM calls using gpt-4o
for await (const entry of log.query({
  model: 'gpt-4o',
  errorsOnly: true,
})) {
  console.log(`${entry.timestamp} ERROR: ${entry.error?.message}`);
}
```

```typescript
// Find expensive calls (over $1)
for await (const entry of log.query({
  minCost: 1.0,
  order: 'desc',
  limit: 50,
})) {
  console.log(`${entry.timestamp} ${entry.model} $${entry.cost?.toFixed(4)} ${entry.tokens.total} tokens`);
}
```

### Backend-Specific Query Performance

**JSONL backend**: Queries scan the file line by line, parsing each JSON line and evaluating filters. For files with fewer than 100,000 entries, this is typically fast (under 1 second). For larger files, the scan time grows linearly. The JSONL backend maintains a lightweight in-memory index of entry timestamps for range queries, loaded at startup.

**SQLite backend**: Queries use SQL with indexed columns. Actor, model, provider, and timestamp filters use indexed lookups. Full-text search on input/output fields uses SQLite FTS5 (when enabled). Query performance is logarithmic with the number of entries for indexed fields.

---

## 13. Export and Reporting

### JSON Export

`log.export('json', options)` produces a JSON string containing an array of audit entries matching the given filters. The output is a valid JSON array that can be parsed by any JSON-capable tool.

```typescript
const json = await log.export('json', {
  filters: {
    from: new Date('2026-01-01'),
    to: new Date('2026-03-31'),
    actor: 'user:jane.doe@example.com',
  },
  includePii: false,
});
// json is a string: [{"id":"...","timestamp":"...","model":"gpt-4o",...}, ...]
// PII fields are replaced with '[PII_EXCLUDED]'
```

### CSV Export

`log.export('csv', options)` produces a CSV string with one row per entry. Complex fields (input, output, toolCalls, metadata) are JSON-serialized within their CSV cells. The first row is a header row.

```typescript
const csv = await log.export('csv', {
  filters: { from: new Date('2026-03-01') },
  columns: ['timestamp', 'actor', 'model', 'provider', 'tokens.total', 'latencyMs', 'cost'],
});
// csv is a string:
// timestamp,actor,model,provider,tokens.total,latencyMs,cost
// 2026-03-01T10:00:00.000Z,user:jane@example.com,gpt-4o,openai,2750,1842,0.0385
// ...
```

### GDPR Subject Access Request Export

A GDPR Subject Access Request (SAR) requires exporting all data held about a specific individual. The `subjectAccessRequest` option produces a complete export for a single actor:

```typescript
const sarExport = await log.export('json', {
  subjectAccessRequest: { actor: 'user:jane.doe@example.com' },
  includePii: true,
});
// sarExport contains every audit entry where actor matches,
// with full PII fields included (as required by the SAR).
```

### Date-Range Export for Auditor Review

For SOC 2 or other periodic audit reviews, export all entries within the audit period:

```typescript
const auditExport = await log.export('csv', {
  filters: {
    from: new Date('2025-04-01'),
    to: new Date('2026-03-31'),
  },
  columns: ['timestamp', 'actor', 'model', 'provider', 'tokens.total', 'latencyMs', 'cost', 'error'],
  includePii: false,
});
// Provide this CSV to the auditor along with the verification result.
```

---

## 14. Integrity Verification

### `verify()` Method

The `log.verify()` method validates the HMAC integrity chain by reading every entry in sequence, recomputing each HMAC, and comparing it to the stored value.

```typescript
const result = await log.verify();

if (result.valid) {
  console.log(`Chain intact: ${result.entryCount} entries verified in ${result.durationMs}ms.`);
} else {
  console.error(`Chain broken at entry ${result.firstInvalidIndex} (ID: ${result.invalidEntryId})`);
  console.error(`Expected HMAC: ${result.expectedHmac}`);
  console.error(`Actual HMAC:   ${result.actualHmac}`);
}
```

### Partial Verification

For large audit logs, verifying the entire chain can be time-consuming. Partial verification checks only the last N entries:

```typescript
const result = await log.verify({ last: 1000 });
// Verifies the last 1000 entries. If valid, those entries have not been tampered with.
// Does not verify entries before the last 1000.
```

### Verification Performance

HMAC-SHA256 computation is hardware-accelerated on modern CPUs. Verification speed is dominated by I/O (reading entries from storage), not by HMAC computation. Benchmarks:

- **JSONL backend**: ~100,000 entries/second (limited by file read + JSON parse).
- **SQLite backend**: ~200,000 entries/second (sequential row iteration).

A 1-million-entry audit log verifies in approximately 5-10 seconds.

---

## 15. Configuration

### Complete Default Configuration

```typescript
const defaults: AuditLogOptions = {
  storage: { type: 'jsonl', path: './audit.jsonl' },
  integrity: undefined,          // Disabled by default
  redaction: undefined,          // No redaction by default
  piiEncryption: undefined,      // No PII encryption by default
  defaultPiiFields: ['input', 'output'],
  retention: undefined,          // No auto-purge by default
  buffer: {
    maxEntries: 50,
    flushIntervalMs: 1000,
    immediate: false,
  },
  maxFieldSize: 1_048_576,       // 1 MiB
  pricing: {
    // Default pricing table (costs per 1M tokens, USD)
    'gpt-4o':           { inputPer1M: 2.50,  outputPer1M: 10.00 },
    'gpt-4o-mini':      { inputPer1M: 0.15,  outputPer1M: 0.60  },
    'gpt-4.1':          { inputPer1M: 2.00,  outputPer1M: 8.00  },
    'gpt-4.1-mini':     { inputPer1M: 0.40,  outputPer1M: 1.60  },
    'gpt-4.1-nano':     { inputPer1M: 0.10,  outputPer1M: 0.40  },
    'o3':               { inputPer1M: 2.00,  outputPer1M: 8.00  },
    'o3-mini':          { inputPer1M: 1.10,  outputPer1M: 4.40  },
    'o4-mini':          { inputPer1M: 1.10,  outputPer1M: 4.40  },
    'claude-opus-4-20250514':   { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-sonnet-4-20250514': { inputPer1M: 3.00,  outputPer1M: 15.00 },
    'claude-3-5-haiku-20241022': { inputPer1M: 0.80,  outputPer1M: 4.00  },
  },
  onError: (error) => console.error('[llm-audit-log]', error),
};
```

### Configuration Validation Rules

The following validation rules are enforced when `createAuditLog` is called. Invalid configurations throw a synchronous `TypeError`.

| Rule | Condition |
|---|---|
| Storage path must be a non-empty string | JSONL and SQLite backends require a non-empty `path` |
| Custom backend must implement StorageBackend | `type: 'custom'` requires `backend` with `init`, `write`, `query`, `count`, `delete`, `close` methods |
| Integrity secret is required when integrity is enabled | `integrity.secret` must be a non-empty string or Buffer |
| PII encryption key must be 32 bytes | `piiEncryption.key.length` must be 32 |
| Retention maxAge must be positive | `retention.maxAge` must be > 0 |
| Buffer maxEntries must be positive | `buffer.maxEntries` must be >= 1 |
| Buffer flushIntervalMs must be positive | `buffer.flushIntervalMs` must be > 0 |
| maxFieldSize must be non-negative | `maxFieldSize` must be >= 0 |

### Environment Variables

| Variable | Purpose | Values |
|---|---|---|
| `LLM_AUDIT_HMAC_SECRET` | HMAC secret (alternative to passing in options) | String |
| `LLM_AUDIT_STORAGE_PATH` | Override storage file path | File path |
| `LLM_AUDIT_RETENTION_DAYS` | Override retention maxAge in days | Number |
| `LLM_AUDIT_BUFFER_IMMEDIATE` | Force immediate flush (no buffering) | `true`, `false` |
| `LLM_AUDIT_DISABLED` | Disable audit logging entirely (no-op mode) | `true`, `false` |

Environment variables override corresponding options passed to `createAuditLog()`.

---

## 16. CLI

The `llm-audit-log` CLI provides terminal commands for operating on audit logs without writing application code.

### Installation

The CLI is available via `npx` or as a global install:

```bash
npx llm-audit-log <command> [options]
```

### Commands

#### `query` -- Search and filter entries

```bash
llm-audit-log query --path ./audit.jsonl \
  --actor "user:jane@example.com" \
  --from 2026-03-01 \
  --to 2026-03-19 \
  --model gpt-4o \
  --limit 50 \
  --format table
```

Output formats: `table` (human-readable), `json` (machine-readable), `csv`.

#### `verify` -- Verify HMAC integrity chain

```bash
llm-audit-log verify --path ./audit.jsonl --secret $AUDIT_HMAC_SECRET
```

Output:

```
Integrity verification: PASS
  Entries verified: 12,847
  Chain intact from 2026-01-15T08:00:00.000Z to 2026-03-19T16:45:00.000Z
  Duration: 142ms
```

Or on failure:

```
Integrity verification: FAIL
  Chain broken at entry #4,201 (ID: a1b2c3d4-...)
  Expected HMAC: a7f3b2c1...
  Actual HMAC:   e4d5f6a7...
  Entry timestamp: 2026-02-14T11:30:00.000Z
```

Exit codes: 0 (valid), 1 (invalid or error), 2 (usage error).

#### `export` -- Export entries to file

```bash
llm-audit-log export --path ./audit.jsonl \
  --format csv \
  --output ./audit-report-q1-2026.csv \
  --from 2026-01-01 \
  --to 2026-03-31 \
  --no-pii
```

```bash
# GDPR Subject Access Request
llm-audit-log export --path ./audit.jsonl \
  --format json \
  --output ./sar-jane-doe.json \
  --actor "user:jane.doe@example.com"
```

#### `purge` -- Delete old entries

```bash
llm-audit-log purge --path ./audit.jsonl \
  --before 2025-01-01 \
  --archive ./archive/
```

Output: `Purged 8,421 entries. Archived to ./archive/archive-2024-01-01-2024-12-31.json`

#### `stats` -- View audit log statistics

```bash
llm-audit-log stats --path ./audit.jsonl
```

Output:

```
Audit Log Statistics
════════════════════════════════════════════════
  Total entries:      12,847
  Active entries:     12,840
  Tombstones:         7
  Date range:         2026-01-15 to 2026-03-19
  Storage size:       48.3 MiB
  Integrity:          Enabled (unverified)

  By Provider:
    openai:           8,421 entries   2.1M tokens   $312.45
    anthropic:        4,426 entries   1.8M tokens   $287.20

  By Model:
    gpt-4o:           5,102 entries   1.4M tokens   $198.30
    gpt-4o-mini:      3,319 entries   0.7M tokens   $114.15
    claude-sonnet-4-20250514: 4,426 entries 1.8M tokens $287.20

  Distinct actors:    23
  Total tokens:       3.9M
  Total cost:         $599.65
```

---

## 17. Integration with the npm-master Ecosystem

### llm-chain-profiler

`llm-chain-profiler` measures where time goes in LLM chains. `llm-audit-log` records what happened in each LLM interaction for compliance. The two are complementary: profiling data tells you that a call to `gpt-4o` took 2.4 seconds; the audit log records that the call sent 4,200 tokens of patient data and received a 350-token response containing a diagnosis. Both can instrument the same SDK client:

```typescript
import { createProfiler } from 'llm-chain-profiler';
import { createAuditLog } from 'llm-audit-log';

const profiler = createProfiler({ name: 'rag-pipeline' });
const log = createAuditLog({ integrity: { secret: process.env.HMAC_SECRET! } });

// Profiler outermost (measures timing), audit log inner (records content)
const openai = profiler.instrument(log.instrument(new OpenAI()));
```

### llm-cost-per-test

`llm-cost-per-test` tracks per-test LLM API costs in CI. `llm-audit-log` records costs as part of the compliance audit trail. The cost data in audit entries can be cross-referenced with `llm-cost-per-test` reports to reconcile total spend.

### llm-sanitize

`llm-sanitize` scrubs PII from LLM inputs before they are sent to the API. When used together with `llm-audit-log`, the sanitization happens before the audit log records the input, so the audit log captures the sanitized (PII-free) version. This is the recommended pattern for environments where the audit log itself must not contain PII:

```typescript
import { sanitize } from 'llm-sanitize';
import { createAuditLog } from 'llm-audit-log';

// Sanitize before sending to LLM; audit log captures sanitized input
const sanitizedMessages = sanitize(messages);
const response = await openai.chat.completions.create({ model: 'gpt-4o', messages: sanitizedMessages });
```

### content-policy

`content-policy` enforces content policies on LLM inputs and outputs (blocking prohibited content, flagging sensitive topics). `llm-audit-log` records every interaction regardless of policy decisions. Together, the audit log provides evidence that policy enforcement was applied: entries where `content-policy` blocked a request will show an error in the audit log; entries that passed policy checks will show normal completions.

### mcp-audit-log

`mcp-audit-log` records MCP protocol-level interactions (tool calls, resource reads, prompt requests). `llm-audit-log` records LLM API-level interactions (prompts and completions). An enterprise deploying MCP servers that make LLM calls internally needs both: `mcp-audit-log` on the MCP server to record what tools were called, and `llm-audit-log` on the LLM API calls to record what prompts were sent and what completions were received. The two packages produce separate log files that can be correlated by timestamp and metadata (e.g., including the MCP correlation ID in the audit entry's metadata).

---

## 18. Testing Strategy

### Unit Tests

**Entry recording tests**:
- `log.record(entry)`: Entry is written to storage with correct id (UUID), v (1), timestamp (ISO 8601), and computed total tokens.
- `log.record(entry)` with missing optional fields: Defaults are applied (null for cost, empty array for piiFields, empty object for metadata).
- `log.record(entry)` with PII redaction configured: Redacted values are written; original values are not stored.
- `log.record(entry)` with maxFieldSize exceeded: Field is truncated; `_truncated: true` is set in metadata.
- Cost estimation: Entry with known model (gpt-4o) and token counts produces correct cost from pricing table. Entry with unknown model produces null cost.

**HMAC chain tests**:
- First entry includes `hmacSeed` and correct HMAC.
- Second entry's HMAC is computed using the first entry's HMAC as input.
- Verification of a valid 100-entry chain returns `{ valid: true, entryCount: 100 }`.
- Modification of an entry in the middle causes verification to report `{ valid: false }` with correct `firstInvalidIndex`.
- Insertion of an entry causes verification to fail.
- Deletion of an entry causes verification to fail.
- Different algorithms (sha256, sha384, sha512) produce valid chains with different hash lengths.
- Canonical JSON ordering is deterministic regardless of object key insertion order.

**PII handling tests**:
- `defaultPiiFields: ['input', 'output']`: Every entry has these in `piiFields`.
- Per-entry `piiFields` is merged with default PII fields.
- Pattern-based redaction: email addresses are replaced with `[REDACTED]`.
- Path-based redaction: `input` field is replaced entirely.
- Custom redactor function is called for every string field.
- PII-excluded export: PII fields are replaced with `[PII_EXCLUDED]`.
- PII encryption: encrypted fields can be decrypted with the correct key; encrypted fields produce garbage with wrong key.

**Retention tests**:
- Configure retention with maxAge of 1 second. Write entries. Wait. Verify old entries are purged.
- Archive-before-purge: verify archive file is created before entries are deleted.
- Manual purge: `log.purge(date)` deletes entries before the date and returns the correct count.

**Buffer tests**:
- Buffer flushes when maxEntries is reached.
- Buffer flushes when flushIntervalMs elapses.
- `immediate: true` flushes on every record.
- `log.flush()` forces immediate flush.
- `log.close()` flushes remaining entries.

**Query tests**:
- Filter by actor: only matching entries returned.
- Filter by date range: only entries within range returned.
- Filter by model: only matching entries returned.
- Filter by errorsOnly: only entries with non-null error returned.
- Filter by minCost: only entries above threshold returned.
- Pagination: limit and offset work correctly.
- Order: 'asc' returns oldest first, 'desc' returns newest first.
- Tombstone exclusion: tombstoned entries are excluded by default.

**Export tests**:
- JSON export produces valid JSON array.
- CSV export produces valid CSV with correct headers.
- PII exclusion: `includePii: false` replaces PII fields.
- Subject Access Request: all entries for a specific actor are exported.
- Column selection: only specified columns appear in CSV output.

**Tombstone/erasure tests**:
- `log.erase({ actor, reason })`: Creates a tombstone entry; subsequent queries exclude erased entries.
- Tombstone entry has correct `deletedEntryIds`, `deletionReason`, and `tombstone: true`.
- HMAC chain remains valid after tombstone entry is appended.
- Stats reflect correct active vs tombstone counts.

### Integration Tests

**End-to-end recording with JSONL backend**:
- Create an audit log with JSONL storage. Write 10 entries. Close. Reopen. Verify all 10 entries are queryable. Verify HMAC chain is intact.

**End-to-end recording with SQLite backend**:
- Create an audit log with SQLite storage. Write 10 entries. Query by actor, model, date range. Verify correct results. Verify HMAC chain.

**SDK instrumentation with mock OpenAI client**:
- Instrument a mock OpenAI client. Execute a chat completion call. Verify the audit entry has correct model, provider, input, output, tokens, and latency.
- Instrument a mock OpenAI client for streaming. Execute a streaming call. Verify the audit entry captures the full streamed output and correct latency.
- API call that throws: verify the entry is recorded with error details.

**SDK instrumentation with mock Anthropic client**:
- Same tests as OpenAI, adapted for the Anthropic SDK API surface.

**Actor context tests**:
- Call `setActorContext('user:alice', fn)` where fn makes an instrumented API call. Verify the entry has actor 'user:alice'.
- Nested async operations within the context: all entries have the correct actor.
- Concurrent requests with different actors: each entry has the correct actor.

**GDPR erasure end-to-end**:
- Write entries for multiple actors. Erase one actor. Query: erased actor's entries are excluded. Export: erased actor's entries are excluded. Verify chain is intact (tombstone preserved the chain). Stats: correct active/tombstone counts.

### Performance and Benchmark Tests

**Write throughput**:
- Measure entries per second for JSONL backend with default buffer settings. Target: at least 10,000 entries/second.
- Measure entries per second for SQLite backend. Target: at least 5,000 entries/second.

**Query performance**:
- Measure query time for 100,000 entries with actor filter. JSONL target: under 2 seconds. SQLite target: under 100ms.

**Verification speed**:
- Measure verification time for 100,000 entries. Target: under 2 seconds.

**Memory usage**:
- Measure memory growth over 100,000 entries. Verify that memory usage is bounded (buffer is flushed, no unbounded accumulation).

---

## 19. Performance

### Write Path Overhead

The audit log's write path consists of: entry construction (field copying, UUID generation), optional PII redaction (regex matching over string fields), optional HMAC computation (SHA-256, hardware-accelerated), JSON serialization, and buffer insertion. All of these are synchronous and complete in microseconds for typical entries.

- **Entry construction**: ~5 microseconds (object creation, UUID generation via `crypto.randomUUID()`).
- **PII redaction**: ~10-100 microseconds per entry, depending on regex complexity and field sizes.
- **HMAC computation**: ~1-5 microseconds (SHA-256 is hardware-accelerated via AES-NI on modern CPUs).
- **JSON serialization**: ~5-50 microseconds, depending on entry size.
- **Buffer insertion**: ~1 microsecond (array push).

Total synchronous overhead per entry: approximately 20-200 microseconds. This is negligible compared to LLM API call latencies of 200ms to 10+ seconds.

### Storage I/O

Storage writes are asynchronous and batched. With default buffer settings (50 entries, 1-second flush interval), a batch of 50 entries (~200 KB) is written in a single `fs.appendFile()` call, which takes under 1ms on a typical SSD. The LLM API call path never blocks on storage I/O.

### HMAC Chain Verification

Verification is I/O-bound: reading entries from storage dominates. HMAC computation adds negligible overhead (~5 microseconds per entry). For a JSONL file with 100,000 entries (~400 MB), verification reads the file at sequential I/O speed (~500 MB/s on SSD), completing in under 2 seconds.

### Storage Growth

Each audit entry is approximately 2-10 KB in JSONL format, depending on input/output content size. With `maxFieldSize: 1 MiB`, the maximum entry size is bounded. At 1,000 entries per day with an average size of 4 KB, the audit log grows at approximately 4 MB per day, 120 MB per month, 1.4 GB per year. File rotation at 50 MiB (default) creates a new file approximately every 12 days at this rate.

---

## 20. Dependencies

### Runtime Dependencies

None. The package uses only Node.js built-in modules:

| Module | Purpose |
|---|---|
| `node:crypto` | HMAC computation, AES-256-GCM encryption, UUID generation (`randomUUID`) |
| `node:fs/promises` | File creation, append writes, stat, rename, unlink |
| `node:path` | File path manipulation for rotation and archives |
| `node:zlib` | Gzip compression for rotated files |
| `node:async_hooks` | `AsyncLocalStorage` for actor context propagation |

### Optional Peer Dependencies

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | `^11.0.0` | Required for the SQLite storage backend |
| `openai` | `*` | Required for automatic OpenAI client instrumentation |
| `@anthropic-ai/sdk` | `*` | Required for automatic Anthropic client instrumentation |

All peer dependencies are optional. The package works fully with the JSONL backend and manual `record()` API without any peer dependencies installed.

### Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.5.0` | Type checking and compilation |
| `vitest` | `^2.0.0` | Test runner |
| `eslint` | `^9.0.0` | Linting |

### Dependency Philosophy

Zero runtime dependencies beyond Node.js built-ins. For a package whose purpose is compliance-grade audit logging, minimizing the dependency surface area is a security requirement, not just a preference. Every additional dependency is a potential supply-chain attack vector, a version conflict risk, and a maintenance burden. Node.js 18+ provides everything needed: cryptographic hashing, file I/O, UUID generation, compression, and async context propagation.

---

## 21. File Structure

```
llm-audit-log/
├── package.json
├── tsconfig.json
├── SPEC.md
├── README.md
└── src/
    ├── index.ts                  # Public API re-exports
    ├── audit-log.ts              # AuditLog class and createAuditLog() factory
    ├── types.ts                  # AuditEntry, AuditLogOptions, QueryFilters, etc.
    ├── entry-builder.ts          # Entry construction, cost estimation, field truncation
    ├── integrity.ts              # HMAC chain computation and verification
    ├── redaction.ts              # PII redaction (patterns, paths, custom)
    ├── encryption.ts             # PII field encryption (AES-256-GCM)
    ├── buffer.ts                 # Write buffer with flush timer
    ├── retention.ts              # Retention policy enforcement and auto-purge
    ├── pricing.ts                # Default model pricing table, cost calculation
    ├── context.ts                # AsyncLocalStorage-based actor context
    ├── export.ts                 # JSON and CSV export formatters
    ├── canonical-json.ts         # Deterministic JSON serialization (sorted keys)
    ├── storage/
    │   ├── index.ts              # StorageBackend interface
    │   ├── jsonl.ts              # JSONL file backend (append, rotate, query)
    │   └── sqlite.ts             # SQLite backend (better-sqlite3 wrapper)
    ├── instrument/
    │   ├── index.ts              # instrument() dispatch (detects SDK type)
    │   ├── openai.ts             # OpenAI client instrumentation proxy
    │   ├── anthropic.ts          # Anthropic client instrumentation proxy
    │   └── stream.ts             # Streaming response interception
    ├── cli/
    │   ├── index.ts              # CLI entry point, command dispatch
    │   ├── query.ts              # query command
    │   ├── verify.ts             # verify command
    │   ├── export.ts             # export command
    │   ├── purge.ts              # purge command
    │   └── stats.ts              # stats command
    └── __tests__/
        ├── audit-log.test.ts     # Core audit log unit tests
        ├── entry-builder.test.ts # Entry construction tests
        ├── integrity.test.ts     # HMAC chain tests
        ├── redaction.test.ts     # PII redaction tests
        ├── encryption.test.ts    # PII encryption tests
        ├── buffer.test.ts        # Buffer and flush tests
        ├── retention.test.ts     # Retention policy tests
        ├── export.test.ts        # Export format tests
        ├── jsonl.test.ts         # JSONL backend tests
        ├── sqlite.test.ts        # SQLite backend tests
        ├── instrument.test.ts    # SDK instrumentation tests
        ├── context.test.ts       # Actor context tests
        ├── cli.test.ts           # CLI command tests
        └── integration.test.ts   # End-to-end integration tests
```

---

## 22. Implementation Roadmap

### Phase 1: Core Entry Recording and Storage

Implement the foundational entry recording and JSONL storage. All subsequent phases depend on this.

1. **`types.ts`**: Define all TypeScript interfaces: `AuditEntry`, `AuditLogOptions`, `RecordInput`, `QueryFilters`, `VerificationResult`, `ExportFormat`, `AuditStats`, etc.

2. **`canonical-json.ts`**: Implement deterministic JSON serialization with sorted keys. Write tests verifying that key order does not affect output.

3. **`entry-builder.ts`**: Implement entry construction from `RecordInput`. Generate UUIDs, timestamps, compute total tokens, estimate cost. Write tests for all field defaults and edge cases.

4. **`pricing.ts`**: Implement the default pricing table and cost calculation function. Write tests for known models and unknown model fallback.

5. **`buffer.ts`**: Implement the write buffer with maxEntries and flushIntervalMs. Write tests for buffer flush conditions.

6. **`storage/jsonl.ts`**: Implement the JSONL file backend: append writes, line-by-line query scanning, file rotation. Write tests with temp files.

7. **`audit-log.ts`**: Implement `createAuditLog()` and the `AuditLog` class. Wire together entry builder, buffer, and JSONL backend. Implement `record()`, `query()`, `flush()`, `close()`.

Milestone: `createAuditLog()`, `log.record()`, `log.query()` work correctly with the JSONL backend.

### Phase 2: HMAC Integrity Chain

8. **`integrity.ts`**: Implement HMAC chain computation (write) and verification (read). Implement canonical JSON hashing. Write comprehensive tests for chain construction, modification detection, deletion detection, insertion detection.

9. **`audit-log.ts` update**: Integrate integrity chain into the write path. Implement `log.verify()`.

Milestone: Entries are HMAC-chained. `log.verify()` detects all forms of tampering.

### Phase 3: PII Handling

10. **`redaction.ts`**: Implement pattern-based, path-based, and custom redaction. Write tests for all redaction modes.

11. **`encryption.ts`**: Implement AES-256-GCM field-level encryption and decryption. Write tests for encrypt/decrypt round-trip and key revocation.

12. **`audit-log.ts` update**: Integrate redaction and encryption into the write path. Implement PII-aware export. Implement `log.erase()` for GDPR tombstones.

Milestone: PII is redacted/encrypted before storage. Tombstone entries work. PII-excluded exports work.

### Phase 4: SQLite Backend

13. **`storage/sqlite.ts`**: Implement the SQLite backend using `better-sqlite3`. Create table and indexes. Implement write, query (with SQL WHERE clauses), count, delete. Implement FTS5 full-text search.

14. **`audit-log.ts` update**: Support SQLite as an alternative backend via the `storage` option.

Milestone: All features work with both JSONL and SQLite backends.

### Phase 5: SDK Instrumentation

15. **`instrument/stream.ts`**: Implement streaming response interception for latency measurement and output accumulation.

16. **`instrument/openai.ts`**: Implement the OpenAI client Proxy. Intercept `chat.completions.create`, `completions.create`. Handle streaming and non-streaming.

17. **`instrument/anthropic.ts`**: Implement the Anthropic client Proxy. Intercept `messages.create`, `messages.stream()`.

18. **`context.ts`**: Implement `setActorContext()` and `getActorContext()` using `AsyncLocalStorage`.

19. **`instrument/index.ts`**: Implement `log.instrument()` with SDK auto-detection.

Milestone: `log.instrument(openaiClient)` automatically records every API call with correct content, tokens, latency, cost, and actor.

### Phase 6: Export, Retention, and Stats

20. **`export.ts`**: Implement JSON and CSV export formatters. Implement GDPR Subject Access Request export. Implement column selection for CSV.

21. **`retention.ts`**: Implement retention policy enforcement with auto-purge timer. Implement archive-before-purge.

22. **`audit-log.ts` update**: Implement `log.export()`, `log.purge()`, `log.stats()`.

Milestone: All export formats work. Retention auto-purge works. Stats are accurate.

### Phase 7: CLI

23. **`cli/index.ts`**: Implement CLI command dispatch with argument parsing.

24. **`cli/query.ts`, `verify.ts`, `export.ts`, `purge.ts`, `stats.ts`**: Implement each CLI command.

Milestone: All CLI commands work. `llm-audit-log query`, `verify`, `export`, `purge`, `stats` produce correct output.

### Phase 8: Documentation and Polish

25. **README.md**: Write the README with installation, quickstart, configuration reference, and examples.

26. **Performance benchmarks**: Implement write throughput, query performance, and verification speed benchmarks. Verify targets are met.

27. **JSDoc**: Ensure all public API methods have complete JSDoc comments.

Milestone: All phases complete. `npm run test`, `npm run lint`, and `npm run build` all pass. Package is ready for v0.1.0 publication.

---

## 23. Example Use Cases

### Example 1: Healthcare AI Compliance (HIPAA)

A hospital's clinical decision support tool uses an LLM to analyze patient data. HIPAA requires audit controls that record who accessed what PHI, when, and what the system produced.

```typescript
import { createAuditLog, setActorContext } from 'llm-audit-log';
import OpenAI from 'openai';

const log = createAuditLog({
  storage: {
    type: 'sqlite',
    path: '/var/log/clinical-ai/audit.db',
  },
  integrity: {
    secret: process.env.AUDIT_HMAC_SECRET!,
    algorithm: 'sha256',
  },
  redaction: {
    patterns: [
      /\b\d{3}-\d{2}-\d{4}\b/g,   // SSN
      /\bMRN-\d{7,10}\b/g,         // Medical record numbers
    ],
    placeholder: '[PHI_REDACTED]',
  },
  defaultPiiFields: ['input', 'output'],
  retention: {
    maxAge: 6 * 365 * 24 * 60 * 60 * 1000, // 6 years (HIPAA minimum)
    archiveBeforePurge: true,
    archiveDir: '/var/archive/clinical-ai/',
  },
});

const openai = log.instrument(new OpenAI());

// In the request handler:
app.post('/clinical/analyze', async (req, res) => {
  setActorContext(`clinician:${req.user.npiNumber}`, async () => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a clinical decision support assistant.' },
        { role: 'user', content: `Patient presents with: ${req.body.symptoms}` },
      ],
    });
    // Audit entry is automatically recorded with:
    //   actor: 'clinician:1234567890'
    //   model: 'gpt-4o'
    //   input: [messages with PHI redacted per patterns]
    //   output: [response content]
    //   piiFields: ['input', 'output']
    //   hmac: [chain-linked HMAC]
    res.json(response);
  });
});
```

### Example 2: GDPR Subject Access Request

A data protection officer receives a GDPR Article 15 request from a user asking for all data held about them.

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storage: { type: 'sqlite', path: './audit.db' },
  integrity: { secret: process.env.HMAC_SECRET! },
});

async function handleSubjectAccessRequest(userEmail: string, requestRef: string) {
  // Step 1: Verify audit log integrity before producing the export
  const verification = await log.verify();
  if (!verification.valid) {
    throw new Error(`Cannot fulfill SAR: audit log integrity compromised at entry ${verification.firstInvalidIndex}`);
  }

  // Step 2: Export all entries for this data subject
  const sarData = await log.export('json', {
    subjectAccessRequest: { actor: `user:${userEmail}` },
    includePii: true,
  });

  // Step 3: Count entries for the response
  let entryCount = 0;
  for await (const _ of log.query({ actor: `user:${userEmail}` })) {
    entryCount++;
  }

  return {
    requestRef,
    subject: userEmail,
    entriesFound: entryCount,
    integrityVerified: true,
    data: sarData,
  };
}
```

### Example 3: SOC 2 Audit Preparation

An engineering team preparing for a SOC 2 Type II audit needs to demonstrate continuous logging and log integrity over the audit period.

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storage: { type: 'jsonl', path: '/var/log/ai-platform/audit.jsonl' },
  integrity: { secret: process.env.HMAC_SECRET! },
  retention: {
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    checkIntervalMs: 24 * 60 * 60 * 1000,
  },
});

// For the auditor: verify chain integrity and export the audit period
async function prepareAuditEvidence(auditPeriodStart: Date, auditPeriodEnd: Date) {
  // Verify the entire chain
  const verification = await log.verify();
  console.log(`Chain status: ${verification.valid ? 'INTACT' : 'BROKEN'}`);
  console.log(`Total entries: ${verification.entryCount}`);

  // Export the audit period as CSV (auditor-friendly)
  const csv = await log.export('csv', {
    filters: { from: auditPeriodStart, to: auditPeriodEnd },
    columns: ['timestamp', 'actor', 'model', 'provider', 'tokens.total', 'latencyMs', 'cost', 'error'],
    includePii: false,
  });

  // Get statistics for the summary
  const stats = await log.stats();

  return {
    verification: {
      chainIntact: verification.valid,
      entriesVerified: verification.entryCount,
      verificationDurationMs: verification.durationMs,
    },
    stats: {
      totalEntries: stats.totalEntries,
      distinctActors: stats.distinctActors,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      dateRange: `${stats.oldestEntry} to ${stats.newestEntry}`,
    },
    auditPeriodExportCsv: csv,
  };
}
```

### Example 4: Financial Services Logging

A financial advisory firm uses an LLM to generate investment research summaries. Regulatory requirements mandate logging every AI-generated recommendation with the analyst who requested it.

```typescript
import { createAuditLog, setActorContext } from 'llm-audit-log';
import Anthropic from '@anthropic-ai/sdk';

const log = createAuditLog({
  storage: {
    type: 'sqlite',
    path: '/var/log/investment-ai/audit.db',
    fullTextSearch: true, // Enable searching within prompts and responses
  },
  integrity: { secret: process.env.HMAC_SECRET! },
  retention: {
    maxAge: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years (SOX/financial)
    archiveBeforePurge: true,
  },
  buffer: { immediate: true }, // Immediate flush for maximum durability
});

const anthropic = log.instrument(new Anthropic());

app.post('/research/summarize', async (req, res) => {
  setActorContext(`analyst:${req.user.employeeId}`, async () => {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Summarize the investment thesis for ${req.body.ticker} based on the following data: ${req.body.financialData}`,
      }],
    });
    // Entry recorded with analyst identity, full input/output, cost, tokens
    res.json(response);
  });
});

// Compliance officer can later search for all research related to a specific ticker:
async function findResearchByTicker(ticker: string) {
  const entries: AuditEntry[] = [];
  for await (const entry of log.query({ search: ticker })) {
    entries.push(entry);
  }
  return entries;
}
```

### Example 5: GDPR Right to Erasure

A user requests deletion of all their data. The audit log handles this without breaking the HMAC integrity chain.

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storage: { type: 'sqlite', path: './audit.db' },
  integrity: { secret: process.env.HMAC_SECRET! },
});

async function handleErasureRequest(userEmail: string, requestRef: string) {
  // Create a tombstone entry that logically deletes all entries for this user
  const tombstone = await log.erase({
    actor: `user:${userEmail}`,
    reason: `GDPR erasure request ref:${requestRef}`,
    overwritePii: true, // Overwrite PII fields in SQLite storage
  });

  console.log(`Erased entries for ${userEmail}: ${tombstone.deletedEntryIds?.length} entries tombstoned`);

  // Verify chain is still intact after erasure
  const verification = await log.verify();
  console.log(`Chain status after erasure: ${verification.valid ? 'INTACT' : 'BROKEN'}`);

  // Confirm: querying for this user returns no results
  let count = 0;
  for await (const _ of log.query({ actor: `user:${userEmail}` })) {
    count++;
  }
  console.log(`Entries visible for ${userEmail} after erasure: ${count}`); // 0

  return {
    tombstoneId: tombstone.id,
    entriesErased: tombstone.deletedEntryIds?.length,
    chainIntact: verification.valid,
  };
}
```
