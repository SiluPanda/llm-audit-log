# llm-audit-log

Tamper-evident, compliance-ready audit logging for LLM I/O. Creates SOC 2, GDPR, and HIPAA-grade audit trails without a hosted observability platform.

## Features

- **HMAC-SHA256 integrity chains** -- tamper-evident hash chains that detect insertion, deletion, modification, or reordering of entries
- **PII detection and redaction** -- regex-based detection of emails, phone numbers, SSNs, credit card numbers, and IP addresses with configurable redaction
- **JSONL storage** -- append-only, line-delimited JSON files with automatic file rotation
- **Retention policies** -- auto-purge entries older than a configurable age
- **Multi-format export** -- JSON, CSV, and JSONL export with query filters
- **Zero runtime dependencies** -- uses only Node.js built-ins (`node:crypto`, `node:fs`, `node:path`, `node:os`)

## Installation

```bash
npm install llm-audit-log
```

## Quick Start

```typescript
import { createAuditLog } from 'llm-audit-log';

const log = createAuditLog({
  storagePath: './audit.jsonl',
  hmacSecret: process.env.AUDIT_HMAC_SECRET,
});

// Log an LLM interaction
const entry = await log.log({
  actor: 'user:jane.doe@example.com',
  model: 'gpt-4o',
  provider: 'openai',
  input: [{ role: 'user', content: 'Summarize the Q3 report' }],
  output: 'Q3 revenue was $4.2B, up 12% YoY...',
  tokens: { input: 2400, output: 350 },
  latencyMs: 1842,
  cost: 0.0385,
});

// Verify the HMAC integrity chain
const result = await log.verify();
console.log(result.valid); // true

// Query entries
const entries = await log.query({ actor: 'user:jane.doe@example.com' });

// Export as JSON
const json = await log.export('json');

// Export as CSV
const csv = await log.export('csv', { actor: 'user:jane.doe@example.com' });

await log.close();
```

## API

### `createAuditLog(options): AuditLogger`

Factory function that creates a configured `AuditLogger` instance.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storagePath` | `string` | `'./audit.jsonl'` | Path to the JSONL storage file |
| `hmacSecret` | `string \| Buffer` | `undefined` | HMAC secret for integrity chains (enables HMAC when set) |
| `hmacSeed` | `string` | auto-generated | Seed for the first entry in the chain |
| `retentionDays` | `number` | `undefined` | Max age in days before auto-purge |
| `maxFileSize` | `number` | `52428800` | Max file size in bytes before rotation (50 MiB) |
| `defaultPiiFields` | `string[]` | `['input', 'output']` | Default PII field paths applied to every entry |
| `redactPii` | `boolean` | `false` | Whether to auto-redact PII patterns |
| `piiPatterns` | `RegExp[]` | `undefined` | Custom PII regex patterns to redact |
| `autoRotate` | `boolean` | `true` | Whether to auto-rotate files |
| `onError` | `(error: Error) => void` | `console.error` | Error callback |

### `AuditLogger`

#### `log(input: RecordInput): Promise<AuditEntry>`

Record a single LLM interaction. Auto-generates `id`, `v`, `timestamp`, and `hmac`.

#### `query(filters?: QueryFilters): Promise<AuditEntry[]>`

Search entries by actor, model, date range, tags, with limit/offset pagination.

#### `verify(): Promise<VerificationResult>`

Verify the HMAC integrity chain. Returns whether the chain is valid and the location of the first break if any.

#### `export(format: ExportFormat, filters?: QueryFilters): Promise<string>`

Export entries as `'json'`, `'csv'`, or `'jsonl'`.

#### `purge(before: Date): Promise<number>`

Remove entries older than the given date. Returns count of purged entries.

#### `close(): Promise<void>`

Stop retention timers and release resources.

### Utility Functions

```typescript
import { computeHmac, verifyChain, detectPii, canonicalJSON } from 'llm-audit-log';
```

- `computeHmac(entry, secret, previousHmac?, seed?)` -- compute HMAC-SHA256 for an entry
- `verifyChain(entries, secret)` -- verify integrity of an entry chain
- `detectPii(text)` -- detect PII patterns (emails, phones, SSNs, credit cards, IPs)
- `canonicalJSON(obj)` -- deterministic JSON serialization with sorted keys

## PII Redaction

Enable automatic PII redaction to scrub sensitive data before it reaches the audit log:

```typescript
const log = createAuditLog({
  storagePath: './audit.jsonl',
  redactPii: true,
  piiPatterns: [/MRN-\d+/g], // Custom patterns
});

await log.log({
  model: 'gpt-4o',
  provider: 'openai',
  input: 'Patient MRN-12345, email: john@example.com',
  output: 'Noted.',
  tokens: { input: 20, output: 5 },
  latencyMs: 300,
});
// Stored input: "Patient [REDACTED], email: [REDACTED]"
```

Detected PII types: email addresses, phone numbers, US SSNs, credit card numbers, IPv4 addresses.

## HMAC Integrity Chain

Each entry's HMAC covers its content plus the previous entry's HMAC, creating a chain where tampering with any entry invalidates all subsequent entries.

```typescript
const log = createAuditLog({
  storagePath: './audit.jsonl',
  hmacSecret: 'your-secret-key',
});

// Log several entries...
await log.log({ /* ... */ });
await log.log({ /* ... */ });

// Verify the chain
const result = await log.verify();
if (!result.valid) {
  console.error(`Chain broken at entry ${result.firstInvalidIndex}`);
  console.error(`Entry ID: ${result.invalidEntryId}`);
}
```

## Retention Policy

```typescript
const log = createAuditLog({
  storagePath: './audit.jsonl',
  retentionDays: 365, // 1 year
});

// Start auto-purge (runs on startup + every 24h)
await log.startRetention(365);

// Manual purge
const purged = await log.purge(new Date('2025-01-01'));
```

## License

MIT
