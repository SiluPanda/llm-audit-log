# llm-audit-log

Tamper-evident, compliance-ready audit logging for LLM input/output.

[![npm version](https://img.shields.io/npm/v/llm-audit-log.svg)](https://www.npmjs.com/package/llm-audit-log)
[![npm downloads](https://img.shields.io/npm/dt/llm-audit-log.svg)](https://www.npmjs.com/package/llm-audit-log)
[![license](https://img.shields.io/npm/l/llm-audit-log.svg)](https://github.com/SiluPanda/llm-audit-log/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/llm-audit-log.svg)](https://nodejs.org)

---

## Description

`llm-audit-log` creates SOC 2, GDPR, and HIPAA-grade audit trails for LLM API interactions without requiring a hosted observability platform. Every call to OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, or any custom provider is recorded as a structured, append-only entry with HMAC-SHA256 integrity chains, PII detection and redaction, JSONL file storage with automatic rotation, configurable retention policies, and multi-format export.

Everything runs locally. Everything is stored locally. No network connection is required.

**Key properties of the audit log:**

- **Tamper-evident** -- HMAC-SHA256 chains detect insertion, deletion, modification, and reordering of entries.
- **Compliance-ready** -- structured entries capture actor, model, provider, tokens, latency, cost, tool calls, errors, and custom metadata.
- **Privacy-aware** -- built-in PII detection and redaction for emails, phone numbers, SSNs, credit card numbers, and IP addresses.
- **Zero runtime dependencies** -- uses only Node.js built-ins (`node:crypto`, `node:fs`, `node:path`).

---

## Installation

```bash
npm install llm-audit-log
```

Requires Node.js 18 or later.

---

## Quick Start

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storagePath: './audit.jsonl',
  hmacSecret: process.env.AUDIT_HMAC_SECRET,
  redactPii: true,
});

// Record an LLM interaction
const entry = await log.log({
  actor: 'user:jane.doe@example.com',
  model: 'gpt-4o',
  provider: 'openai',
  input: [{ role: 'user', content: 'Summarize the Q3 report' }],
  output: 'Q3 revenue was $4.2B, up 12% YoY...',
  tokens: { input: 2400, output: 350 },
  latencyMs: 1842,
  cost: 0.0385,
  metadata: { session: 'abc-123', env: 'production' },
});

// Verify the HMAC integrity chain
const result = await log.verify();
console.log(result.valid); // true

// Query entries
const entries = await log.query({ actor: 'user:jane.doe@example.com' });

// Export as CSV for auditor review
const csv = await log.export('csv', { actor: 'user:jane.doe@example.com' });

await log.close();
```

---

## Features

### HMAC-SHA256 Integrity Chains

Each entry's HMAC is computed over its canonical JSON content concatenated with the previous entry's HMAC, forming a hash chain. Modifying, inserting, deleting, or reordering any entry breaks the chain from that point forward. The first entry in the chain uses a configurable seed value (auto-generated if not provided).

### PII Detection and Redaction

Built-in regex-based detection for five PII types: email addresses, phone numbers, US Social Security Numbers, credit card numbers, and IPv4 addresses. PII is automatically replaced with `[REDACTED]` before the entry is written to storage. Custom regex patterns can be added for domain-specific identifiers (medical record numbers, account IDs, etc.).

### JSONL Storage with File Rotation

Entries are stored as one JSON object per line in append-only `.jsonl` files. When the file exceeds the configured size limit (default 50 MiB), it is automatically rotated to a numbered archive (`audit.jsonl.1`, `audit.jsonl.2`, etc.). Queries and exports read across all rotated files transparently. Files are created with mode `0o600` (owner read/write only).

### Retention Policies

Configure automatic purging of entries older than a specified number of days. The retention manager runs an initial purge on start and schedules periodic checks at a configurable interval (default 24 hours). The timer is unreffed so it does not prevent process exit.

### Multi-Format Export

Export entries as JSON (pretty-printed array), JSONL (compact, one object per line), or CSV (flattened with proper escaping). All export formats support query filters so you can export a subset of entries -- for example, all entries for a specific actor to fulfill a GDPR Subject Access Request.

### Multi-Session Chain Continuity

The HMAC chain is automatically resumed across process restarts. When a new `AuditLogger` is created against an existing log file, it reads the last entry's HMAC and continues the chain from that point. No manual state management is required.

---

## API Reference

### Factory Function

#### `createAuditLog(options?: AuditLogOptions): AuditLogger`

Create a configured `AuditLogger` instance.

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storagePath: './audit.jsonl',
  hmacSecret: 'your-secret-key',
});
```

---

### `AuditLogger` Class

The core class that orchestrates logging, querying, verification, export, and retention.

```typescript
import { AuditLogger } from 'llm-audit-log';

const logger = new AuditLogger({
  storagePath: './audit.jsonl',
  hmacSecret: 'your-secret-key',
});
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `active` | `boolean` | Whether the logger is active (not closed). |
| `entryCount` | `number` | Total entries written since creation. |

#### `log(input: RecordInput): Promise<AuditEntry>`

Record a single LLM interaction. Automatically generates `id` (UUIDv4), `v` (schema version 1), `timestamp` (ISO 8601 UTC), computes `tokens.total`, merges PII fields, applies PII redaction if enabled, computes the HMAC if a secret is configured, and appends the entry to storage.

```typescript
const entry = await logger.log({
  actor: 'user:alice',
  model: 'gpt-4o',
  provider: 'openai',
  input: 'What is 2+2?',
  output: '2+2 equals 4.',
  tokens: { input: 10, output: 8 },
  latencyMs: 500,
  cost: 0.001,
  toolCalls: [{ name: 'calculator', arguments: { expr: '2+2' }, id: 'tc-1', result: 4 }],
  error: null,
  metadata: { session: 'xyz', tags: ['math'] },
  piiFields: ['metadata.userId'],
});
```

Throws `Error` with message `'AuditLogger is closed'` if called after `close()`.

#### `query(filters?: QueryFilters): Promise<AuditEntry[]>`

Search and filter stored entries. Returns entries matching all provided filters.

```typescript
const results = await logger.query({
  actor: 'user:alice',
  model: 'gpt-4o',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  tags: ['production'],
  limit: 50,
  offset: 0,
  excludeTombstones: true,
});
```

#### `verify(): Promise<VerificationResult>`

Walk the HMAC integrity chain, recompute each HMAC, and report the chain's status. Returns an error message if no `hmacSecret` was configured.

```typescript
const result = await logger.verify();
if (!result.valid) {
  console.error(`Chain broken at index ${result.firstInvalidIndex}`);
  console.error(`Entry ID: ${result.invalidEntryId}`);
  console.error(`Expected: ${result.expectedHmac}`);
  console.error(`Actual:   ${result.actualHmac}`);
}
console.log(`Verified ${result.entryCount} entries in ${result.durationMs}ms`);
```

#### `export(format: ExportFormat, filters?: QueryFilters): Promise<string>`

Export entries in the specified format. Supported formats: `'json'`, `'csv'`, `'jsonl'`.

```typescript
const json = await logger.export('json');
const csv = await logger.export('csv', { actor: 'user:alice' });
const jsonl = await logger.export('jsonl', { model: 'gpt-4o' });
```

#### `purge(before: Date): Promise<number>`

Remove all entries with a timestamp before the given date. Returns the count of purged entries. Rewrites the storage file with remaining entries and removes rotated archive files.

```typescript
const purged = await logger.purge(new Date('2025-01-01'));
console.log(`Purged ${purged} entries`);
```

#### `startRetention(retentionDays: number, checkIntervalMs?: number): Promise<void>`

Start the automatic retention manager. Runs an immediate purge of entries older than `retentionDays` days, then schedules periodic purge checks at `checkIntervalMs` (default: 86,400,000 ms / 24 hours).

```typescript
await logger.startRetention(365); // Purge entries older than 1 year
await logger.startRetention(90, 3_600_000); // 90 days, check every hour
```

#### `close(): Promise<void>`

Stop the retention manager, release storage resources, and mark the logger as inactive. Idempotent -- safe to call multiple times.

```typescript
await logger.close();
console.log(logger.active); // false
```

---

### HMAC Functions

#### `computeHmac(entry: AuditEntry, secret: string | Buffer, previousHmac?: string | null, seed?: string): string`

Compute the HMAC-SHA256 hex digest for a single audit entry. The `hmac` and `hmacSeed` fields on the entry are excluded from the computation. For the first entry in a chain, pass `null` for `previousHmac` and provide a `seed`. For subsequent entries, pass the previous entry's HMAC.

```typescript
import { computeHmac } from 'llm-audit-log';

const hmac = computeHmac(entry, 'secret', null, 'initial-seed');       // First entry
const hmac2 = computeHmac(entry2, 'secret', hmac);                     // Chained entry
```

#### `verifyChain(entries: AuditEntry[], secret: string | Buffer): { valid: boolean; brokenAt: number; expectedHmac?: string; actualHmac?: string }`

Verify the integrity of an ordered array of audit entries. Returns `{ valid: true, brokenAt: -1 }` for a valid chain (including an empty array). On failure, `brokenAt` is the index of the first invalid entry, and `expectedHmac`/`actualHmac` provide the mismatched values.

```typescript
import { verifyChain } from 'llm-audit-log';

const result = verifyChain(entries, 'secret');
if (!result.valid) {
  console.error(`Broken at index ${result.brokenAt}`);
}
```

#### `canonicalJSON(obj: unknown): string`

Produce a deterministic JSON string with object keys sorted alphabetically at every nesting level. Arrays preserve element order. Used internally for HMAC computation to ensure identical entries always produce identical hashes regardless of property insertion order.

```typescript
import { canonicalJSON } from 'llm-audit-log';

canonicalJSON({ z: 1, a: 2 }); // '{"a":2,"z":1}'
canonicalJSON({ b: { z: 1, a: 2 }, a: 1 }); // '{"a":1,"b":{"a":2,"z":1}}'
```

---

### PII Functions

#### `detectPii(text: string): PiiMatch[]`

Scan a string for PII patterns and return an array of matches sorted by start position. Each match includes the PII type, matched value, and character offsets.

```typescript
import { detectPii } from 'llm-audit-log';

const matches = detectPii('Email: jane@example.com, SSN: 123-45-6789');
// [
//   { type: 'email', value: 'jane@example.com', start: 7, end: 23 },
//   { type: 'ssn', value: '123-45-6789', start: 30, end: 41 },
// ]
```

Detected types: `'email'`, `'phone'`, `'ssn'`, `'creditCard'`, `'ipAddress'`.

#### `redactString(text: string, placeholder?: string, customPatterns?: RegExp[]): string`

Replace all detected PII patterns in a string with a placeholder (default: `'[REDACTED]'`). Overlapping matches are merged into a single replacement. Custom regex patterns can be provided alongside the built-in patterns.

```typescript
import { redactString } from 'llm-audit-log';

redactString('Email: jane@example.com'); // 'Email: [REDACTED]'
redactString('Card: 4111 1111 1111 1111', '***'); // 'Card: ***'
redactString('Patient MRN-12345', '[REDACTED]', [/MRN-\d+/g]); // 'Patient [REDACTED]'
```

#### `redactFields(entry: AuditEntry, options?: { piiFields?: string[]; redactPatterns?: boolean; customPatterns?: RegExp[]; placeholder?: string }): AuditEntry`

Redact PII in an audit entry (mutated in place). Two modes:

- **Field-level redaction** (`piiFields`): replaces the value at each dot-notation path with the placeholder. Works on strings, objects, and arrays.
- **Pattern-based redaction** (`redactPatterns: true`): scans all string values in `input`, `output`, and `metadata` for PII patterns and replaces matches.

```typescript
import { redactFields } from 'llm-audit-log';

redactFields(entry, { piiFields: ['input', 'metadata.email'] });
redactFields(entry, { redactPatterns: true, customPatterns: [/MRN-\d+/g] });
```

---

### Storage

#### `JsonlStorage` Class

The built-in JSONL file storage backend implementing the `StorageBackend` interface. Typically used internally by `AuditLogger`, but can be instantiated directly for advanced use cases.

```typescript
import { JsonlStorage } from 'llm-audit-log';

const storage = new JsonlStorage({
  filePath: './audit.jsonl',
  maxFileSize: 52_428_800, // 50 MiB
  autoRotate: true,
});

await storage.init();
await storage.append(entry);
const entries = await storage.read();
const count = await storage.count();
const size = await storage.size();
await storage.close();
```

**Methods:** `init()`, `append(entry)`, `read()`, `query(filters)`, `purge(before)`, `export(format, filters?)`, `count()`, `size()`, `close()`.

---

### Retention

#### `RetentionManager` Class

Manages automatic purging of old entries on a configurable schedule.

```typescript
import { RetentionManager } from 'llm-audit-log';

const manager = new RetentionManager(storageBackend, {
  maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year in ms
  checkIntervalMs: 86_400_000,         // 24 hours
});

await manager.start();   // Initial purge + schedule
await manager.runPurge(); // Manual one-off purge
manager.getCutoffDate();  // Current cutoff as Date
manager.stop();           // Cancel scheduled purges
```

---

### Export Functions

Standalone formatting functions for converting entries to different output formats.

#### `exportEntries(backend: StorageBackend, format: ExportFormat, filters?: QueryFilters): Promise<string>`

Read entries from a storage backend and export them in the given format.

#### `toJson(entries: AuditEntry[]): string`

Format entries as a pretty-printed JSON array.

#### `toJsonl(entries: AuditEntry[]): string`

Format entries as JSONL (one compact JSON object per line, trailing newline). Returns an empty string for an empty array.

#### `toCsv(entries: AuditEntry[]): string`

Format entries as CSV with a header row. Nested fields (`tokens.input`, `tokens.output`, `tokens.total`) are flattened. Complex values (`input`, `output`, `toolCalls`, `error`, `metadata`, `piiFields`) are JSON-stringified. Values containing commas, quotes, or newlines are properly escaped.

**CSV columns:** `id`, `v`, `timestamp`, `actor`, `model`, `provider`, `input`, `output`, `tokens_input`, `tokens_output`, `tokens_total`, `latencyMs`, `cost`, `toolCalls`, `error`, `metadata`, `piiFields`, `hmac`, `tombstone`.

---

## Configuration

### `AuditLogOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storagePath` | `string` | `'./audit.jsonl'` | Path to the JSONL storage file. Directories are created recursively if they do not exist. |
| `hmacSecret` | `string \| Buffer` | `undefined` | HMAC secret key. When provided, every entry receives an HMAC and the integrity chain is enabled. |
| `hmacSeed` | `string` | auto-generated (32 random hex bytes) | Seed value for the first entry in the HMAC chain. |
| `retentionDays` | `number` | `undefined` | Maximum entry age in days. Used with `startRetention()`. |
| `maxFileSize` | `number` | `52428800` (50 MiB) | Maximum file size in bytes before automatic rotation. |
| `defaultPiiFields` | `string[]` | `['input', 'output']` | Field paths tagged as containing PII on every entry. |
| `redactPii` | `boolean` | `false` | When `true`, automatically scan and redact PII patterns in `input`, `output`, and `metadata` before writing. |
| `piiPatterns` | `RegExp[]` | `undefined` | Additional regex patterns to redact alongside the built-in PII patterns. |
| `autoRotate` | `boolean` | `true` | When `true`, rotate the storage file when it exceeds `maxFileSize`. |
| `onError` | `(error: Error) => void` | `console.error` | Callback invoked on internal errors (storage failures, etc.). |

### `RecordInput`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | `string` | Yes | Model name as passed to the API (e.g., `'gpt-4o'`, `'claude-3-opus'`). |
| `provider` | `Provider` | Yes | One of `'openai'`, `'anthropic'`, `'google'`, `'azure-openai'`, `'aws-bedrock'`, `'custom'`. |
| `input` | `unknown` | Yes | The prompt or messages sent to the LLM. Can be a string, array, or object. |
| `output` | `unknown` | Yes | The response received from the LLM. Can be a string or object. |
| `tokens` | `{ input: number; output: number }` | Yes | Token counts. `total` is computed automatically. |
| `latencyMs` | `number` | Yes | Response latency in milliseconds. |
| `actor` | `string \| null` | No | The user or service that triggered the call (e.g., `'user:alice'`). Defaults to `null`. |
| `cost` | `number \| null` | No | Estimated cost in USD. Defaults to `null`. |
| `toolCalls` | `Array<{ name: string; arguments: Record<string, unknown>; id?: string; result?: unknown }>` | No | Tool/function calls made during the interaction. Defaults to `null`. |
| `error` | `{ message: string; code?: string; statusCode?: number }` | No | Error details if the call failed. Defaults to `null`. |
| `metadata` | `Record<string, unknown>` | No | Arbitrary key-value metadata. Defaults to `{}`. |
| `piiFields` | `string[]` | No | Additional PII field paths for this entry (merged with `defaultPiiFields`). |

### `QueryFilters`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `startDate` | `Date` | -- | Include entries at or after this date. |
| `endDate` | `Date` | -- | Include entries at or before this date. |
| `actor` | `string` | -- | Exact match on actor. |
| `model` | `string` | -- | Exact match on model. |
| `tags` | `string[]` | -- | All specified tags must be present in `metadata.tags`. |
| `limit` | `number` | -- | Maximum number of entries to return. |
| `offset` | `number` | -- | Number of entries to skip (for pagination). |
| `excludeTombstones` | `boolean` | `true` | Exclude tombstoned (logically deleted) entries. |

---

## Error Handling

`llm-audit-log` uses two error-handling mechanisms:

**Thrown errors** -- `log()` throws if the logger is closed or if a storage write fails. Callers should wrap `log()` calls in try/catch if uninterrupted operation is required.

```typescript
try {
  await logger.log(input);
} catch (err) {
  // Handle storage failure, closed logger, etc.
}
```

**Error callback** -- Internal errors (e.g., storage I/O failures during `log()`) are passed to the `onError` callback before being re-thrown. This allows centralized error reporting without wrapping every call.

```typescript
const logger = new AuditLogger({
  storagePath: './audit.jsonl',
  onError: (err) => {
    alerting.send(`Audit log error: ${err.message}`);
  },
});
```

**Verification errors** -- `verify()` does not throw. It returns a `VerificationResult` object with `valid: false` and an `error` string if verification itself fails (e.g., no HMAC secret configured), or with `firstInvalidIndex` pointing to the first broken entry if the chain is invalid.

**Malformed data** -- The JSONL reader silently skips malformed lines rather than failing the entire read operation. This prevents a single corrupted line from blocking access to the rest of the audit log.

---

## Advanced Usage

### Multi-Session HMAC Chain Continuity

The HMAC chain automatically resumes across process restarts. When a new `AuditLogger` is created against an existing log file with `hmacSecret` set, it reads all existing entries, recovers the last HMAC, and chains new entries from that point.

```typescript
// Session 1
const logger1 = createAuditLog({ storagePath: './audit.jsonl', hmacSecret: 'secret' });
await logger1.log(input1);
await logger1.log(input2);
await logger1.close();

// Session 2 -- chain continues seamlessly
const logger2 = createAuditLog({ storagePath: './audit.jsonl', hmacSecret: 'secret' });
await logger2.log(input3);

const result = await logger2.verify();
console.log(result.valid);      // true
console.log(result.entryCount); // 3
await logger2.close();
```

### Custom PII Patterns

Add domain-specific patterns alongside the built-in detectors:

```typescript
const logger = createAuditLog({
  storagePath: './audit.jsonl',
  redactPii: true,
  piiPatterns: [
    /MRN-\d{5,}/g,           // Medical record numbers
    /ACCT-[A-Z0-9]{8,}/g,    // Account identifiers
    /\b[A-Z]{2}\d{6,9}\b/g,  // Passport numbers
  ],
});
```

### Field-Level PII Redaction

Redact specific fields by dot-notation path, independent of pattern matching:

```typescript
import { redactFields } from 'llm-audit-log';

redactFields(entry, {
  piiFields: ['input', 'metadata.customerEmail', 'metadata.ssn'],
  placeholder: '[SCRUBBED]',
});
```

### Custom Storage Backend

Implement the `StorageBackend` interface to use a database, cloud storage, or any other persistence layer:

```typescript
import type { StorageBackend, AuditEntry, QueryFilters, ExportFormat } from 'llm-audit-log';

class PostgresStorage implements StorageBackend {
  async init(): Promise<void> { /* create tables */ }
  async append(entry: AuditEntry): Promise<void> { /* INSERT */ }
  async read(): Promise<AuditEntry[]> { /* SELECT * */ }
  async query(filters: QueryFilters): Promise<AuditEntry[]> { /* SELECT WHERE */ }
  async purge(before: Date): Promise<number> { /* DELETE */ }
  async export(format: ExportFormat, filters?: QueryFilters): Promise<string> { /* format */ }
  async count(): Promise<number> { /* COUNT */ }
  async size(): Promise<number> { /* pg_total_relation_size */ }
  async close(): Promise<void> { /* pool.end() */ }
}
```

### Standalone Integrity Verification

Verify a chain of entries without an `AuditLogger` instance:

```typescript
import { verifyChain } from 'llm-audit-log';

const entries = JSON.parse(fs.readFileSync('./audit.jsonl', 'utf-8')
  .trim().split('\n').map(line => JSON.parse(line)));

const result = verifyChain(entries, process.env.AUDIT_HMAC_SECRET!);
if (!result.valid) {
  process.exit(1);
}
```

### File Rotation Control

Disable automatic rotation for environments where a separate log rotation tool (logrotate, etc.) is used:

```typescript
const logger = createAuditLog({
  storagePath: './audit.jsonl',
  autoRotate: false,
  maxFileSize: 100_000_000, // 100 MiB -- ignored when autoRotate is false
});
```

### Filtered Export for Compliance

Export a specific actor's data for GDPR Subject Access Requests:

```typescript
const subjectData = await logger.export('json', {
  actor: 'user:jane.doe@example.com',
});

fs.writeFileSync('./sar-jane-doe.json', subjectData);
```

Export entries for a specific time window and model for an internal audit:

```typescript
const auditReport = await logger.export('csv', {
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-03-31'),
  model: 'gpt-4o',
});
```

---

## TypeScript

`llm-audit-log` is written in TypeScript and ships type declarations (`dist/index.d.ts`) alongside the compiled JavaScript. All public types are exported from the package entry point.

```typescript
import type {
  AuditEntry,
  AuditLogOptions,
  ExportFormat,
  PiiMatch,
  Provider,
  QueryFilters,
  RecordInput,
  RetentionPolicy,
  StorageBackend,
  VerificationResult,
} from 'llm-audit-log';
```

### Type Summary

| Type | Description |
|------|-------------|
| `AuditEntry` | A complete audit log entry with all fields (id, timestamp, actor, model, provider, input, output, tokens, latency, cost, tool calls, error, metadata, PII fields, HMAC, tombstone). |
| `AuditLogOptions` | Configuration for `createAuditLog()` and the `AuditLogger` constructor. |
| `RecordInput` | Partial entry accepted by `log()`. Required fields: `model`, `provider`, `input`, `output`, `tokens`, `latencyMs`. |
| `QueryFilters` | Filtering options for `query()` and `export()`. |
| `VerificationResult` | Result of HMAC chain verification including validity, entry count, break location, and timing. |
| `PiiMatch` | A single PII detection result with type, value, start, and end offsets. |
| `Provider` | Union type: `'openai' \| 'anthropic' \| 'google' \| 'azure-openai' \| 'aws-bedrock' \| 'custom'`. |
| `ExportFormat` | Union type: `'json' \| 'csv' \| 'jsonl'`. |
| `StorageBackend` | Interface for custom storage implementations. |
| `RetentionPolicy` | Configuration for the retention manager: `maxAge`, `checkIntervalMs`, `archiveBeforePurge`, `archiveDir`. |

---

## License

MIT
