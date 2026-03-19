# llm-audit-log -- Task Breakdown

This document tracks all implementation tasks derived from SPEC.md. Each task is granular, actionable, and grouped by phase following the implementation roadmap.

---

## Phase 0: Project Scaffolding and Setup

- [ ] **Install dev dependencies** -- Add `typescript@^5.5.0`, `vitest@^2.0.0`, and `eslint@^9.0.0` as devDependencies in package.json. | Status: not_done
- [ ] **Configure optional peer dependencies** -- Add `better-sqlite3@^11.0.0`, `openai`, and `@anthropic-ai/sdk` as optional peerDependencies in package.json with `peerDependenciesMeta` marking each as optional. | Status: not_done
- [ ] **Add CLI bin entry** -- Add a `"bin": { "llm-audit-log": "./dist/cli/index.js" }` field to package.json so the CLI is available via npx. | Status: not_done
- [ ] **Create directory structure** -- Create all directories: `src/storage/`, `src/instrument/`, `src/cli/`, `src/__tests__/`. | Status: not_done
- [ ] **Configure vitest** -- Add or update vitest config (vitest.config.ts or in package.json) for the test runner. | Status: not_done
- [ ] **Configure eslint** -- Add ESLint configuration appropriate for TypeScript. | Status: not_done

---

## Phase 1: Core Types and Utilities

### 1.1 Types (`src/types.ts`)

- [ ] **Define AuditEntry interface** -- Define the full `AuditEntry` interface with all fields: id, v, timestamp, actor, model, provider, input, output, tokens, latencyMs, cost, toolCalls, error, metadata, piiFields, hmac, hmacSeed, tombstone, deletedEntryIds, deletionReason. | Status: not_done
- [ ] **Define AuditLogOptions interface** -- Define the configuration interface with storage, integrity, redaction, piiEncryption, defaultPiiFields, retention, buffer, maxFieldSize, pricing, and onError fields. | Status: not_done
- [ ] **Define IntegrityConfig interface** -- Define with algorithm (sha256/sha384/sha512), secret (string | Buffer), and optional seed fields. | Status: not_done
- [ ] **Define RedactionConfig interface** -- Define with patterns (RegExp[]), paths (string[]), custom function, and placeholder string fields. | Status: not_done
- [ ] **Define PiiEncryptionConfig interface** -- Define with key (Buffer, must be 32 bytes) field. | Status: not_done
- [ ] **Define RetentionPolicy interface** -- Define with maxAge, checkIntervalMs, archiveBeforePurge, and archiveDir fields. | Status: not_done
- [ ] **Define BufferConfig interface** -- Define with maxEntries, flushIntervalMs, and immediate fields. | Status: not_done
- [ ] **Define RecordInput interface** -- Define the partial entry type accepted by log.record(), with optional actor, required model/provider/input/output/tokens/latencyMs, and optional cost/toolCalls/error/metadata/piiFields. | Status: not_done
- [ ] **Define QueryFilters interface** -- Define with from, to, actor, model, provider, minTokens, minCost, errorsOnly, withToolCalls, excludeTombstones, search, metadata, limit, offset, order fields. | Status: not_done
- [ ] **Define VerifyOptions and VerificationResult interfaces** -- VerifyOptions with optional `last` number; VerificationResult with valid, entryCount, totalEntries, firstInvalidIndex, expectedHmac, actualHmac, invalidEntryId, durationMs, error fields. | Status: not_done
- [ ] **Define ExportFormat type and ExportOptions interface** -- ExportFormat as 'json' | 'csv'; ExportOptions with filters, includePii, columns, and subjectAccessRequest fields. | Status: not_done
- [ ] **Define EraseOptions interface** -- Define with actor, reason, and optional overwritePii fields. | Status: not_done
- [ ] **Define AuditStats interface** -- Define with totalEntries, activeEntries, tombstoneEntries, oldestEntry, newestEntry, storageSizeBytes, byProvider, byModel, distinctActors, totalTokens, totalCost, integrityStatus fields. | Status: not_done
- [ ] **Define InstrumentOptions interface** -- Define with actor, metadata, piiFields, and captureContent fields. | Status: not_done
- [ ] **Define StorageBackend interface** -- Define with init(), write(entries), query(filters), count(filters), delete(filters), close() methods. | Status: not_done
- [ ] **Define JsonlBackendConfig interface** -- Define with type 'jsonl', path, mode, maxFileSize, maxFiles, compress fields. | Status: not_done
- [ ] **Define SqliteBackendConfig interface** -- Define with type 'sqlite', path, walMode, fullTextSearch fields. | Status: not_done
- [ ] **Define AuditLog interface** -- Define the public API surface: record(), instrument(), query(), verify(), export(), purge(), erase(), stats(), flush(), close(), active, entryCount properties. | Status: not_done

### 1.2 Canonical JSON (`src/canonical-json.ts`)

- [ ] **Implement canonicalJSON function** -- Serialize a JavaScript object to JSON with keys sorted alphabetically at every nesting level. Must handle nested objects, arrays, null, undefined, numbers, strings, and booleans deterministically. | Status: not_done
- [ ] **Test canonical JSON determinism** -- Write tests verifying that different key insertion orders produce identical JSON output. Test with nested objects, arrays, and edge cases (null, empty objects, special characters). | Status: not_done

### 1.3 Pricing (`src/pricing.ts`)

- [ ] **Implement default pricing table** -- Create the default pricing table with cost per 1M tokens (input and output) for all models listed in the spec: gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, o3, o3-mini, o4-mini, claude-opus-4-20250514, claude-sonnet-4-20250514, claude-3-5-haiku-20241022. | Status: not_done
- [ ] **Implement cost calculation function** -- Given a model name, input token count, output token count, and optional custom pricing overrides, return the estimated cost in USD. Return null for unknown models with no custom pricing. | Status: not_done
- [ ] **Test cost calculation** -- Test with known models (verify exact cost), unknown models (verify null), and custom pricing overrides. | Status: not_done

---

## Phase 2: Entry Builder and Buffer

### 2.1 Entry Builder (`src/entry-builder.ts`)

- [ ] **Implement entry construction from RecordInput** -- Accept a RecordInput and produce a complete AuditEntry. Generate UUID via crypto.randomUUID(), set v to 1, generate ISO 8601 timestamp with millisecond precision and UTC timezone, compute tokens.total from tokens.input + tokens.output, merge per-entry piiFields with defaultPiiFields, set defaults for optional fields (null for cost when not calculable, empty array for piiFields, empty object for metadata). | Status: not_done
- [ ] **Implement field size truncation** -- If any single string field value exceeds maxFieldSize bytes, truncate it and add `_truncated: true` to the entry metadata. | Status: not_done
- [ ] **Test entry builder defaults** -- Verify that missing optional fields get correct defaults. Verify UUID format, timestamp format, token total computation. | Status: not_done
- [ ] **Test field truncation** -- Verify that fields exceeding maxFieldSize are truncated and `_truncated: true` is set. Verify that maxFieldSize of 0 disables truncation. | Status: not_done

### 2.2 Buffer (`src/buffer.ts`)

- [ ] **Implement write buffer** -- Create a buffer that accumulates AuditEntry objects and flushes them to a provided write function. Implement maxEntries threshold triggering a flush, flushIntervalMs timer triggering a flush (using setInterval with unref()), and immediate mode that flushes on every push. | Status: not_done
- [ ] **Implement flush() method** -- Force an immediate flush of all buffered entries. | Status: not_done
- [ ] **Implement close() method** -- Flush remaining entries and stop the flush timer. | Status: not_done
- [ ] **Test buffer flush on maxEntries** -- Add entries up to maxEntries and verify the write function is called. | Status: not_done
- [ ] **Test buffer flush on timer** -- Add entries below maxEntries, wait for flushIntervalMs, and verify the write function is called. | Status: not_done
- [ ] **Test immediate mode** -- Configure immediate: true, add one entry, verify the write function is called immediately. | Status: not_done
- [ ] **Test explicit flush()** -- Add entries below maxEntries, call flush(), verify the write function is called. | Status: not_done
- [ ] **Test close() flushes remaining** -- Add entries, call close(), verify all remaining entries are flushed. | Status: not_done

---

## Phase 3: JSONL Storage Backend

### 3.1 JSONL Backend (`src/storage/jsonl.ts`)

- [ ] **Implement JSONL init()** -- Create the file if it does not exist with mode 0o600 (or configured mode). Build a lightweight in-memory timestamp index by scanning existing entries on init. | Status: not_done
- [ ] **Implement JSONL write()** -- Append entries as one JSON object per line (terminated by \n) using fs.appendFile with the 'a' flag. | Status: not_done
- [ ] **Implement JSONL query()** -- Scan the file line by line, parse each JSON line, evaluate QueryFilters (from, to, actor, model, provider, minTokens, minCost, errorsOnly, withToolCalls, excludeTombstones, metadata, limit, offset, order). Return an AsyncIterable<AuditEntry>. | Status: not_done
- [ ] **Implement JSONL count()** -- Scan and count entries matching the given filters. | Status: not_done
- [ ] **Implement JSONL delete()** -- Rewrite the file excluding entries matching the given filters. Return the count of deleted entries. | Status: not_done
- [ ] **Implement JSONL close()** -- Release any open file handles. | Status: not_done
- [ ] **Implement file rotation** -- When the active log file exceeds maxFileSize (default 50 MiB), rename it with a numeric suffix (audit.jsonl.1, audit.jsonl.2, etc.), create a new active file. Respect maxFiles limit and optionally compress rotated files with gzip. | Status: not_done
- [ ] **Implement file permissions** -- New files are created with mode 0o600 by default (configurable). | Status: not_done
- [ ] **Test JSONL write and read round-trip** -- Write entries, read them back via query, verify contents match. Use temp files. | Status: not_done
- [ ] **Test JSONL query filters** -- Test filtering by actor, date range, model, provider, errorsOnly, minCost, minTokens, withToolCalls, limit, offset, order, excludeTombstones, and metadata. | Status: not_done
- [ ] **Test JSONL file rotation** -- Configure a small maxFileSize, write enough data to trigger rotation, verify rotated files exist and active file is new. | Status: not_done
- [ ] **Test JSONL delete and rewrite** -- Write entries, delete some via filters, verify remaining entries are correct and file is rewritten. | Status: not_done

### 3.2 Storage Index (`src/storage/index.ts`)

- [ ] **Export StorageBackend interface** -- Re-export the StorageBackend interface from the storage module for use by custom backends. | Status: not_done

---

## Phase 4: Core Audit Log Class

### 4.1 AuditLog Class (`src/audit-log.ts`)

- [ ] **Implement createAuditLog() factory** -- Accept AuditLogOptions, validate configuration (throw TypeError for invalid configs), apply defaults, instantiate the storage backend, entry builder, buffer, and return an AuditLog instance. | Status: not_done
- [ ] **Implement configuration validation** -- Validate all rules from the spec: non-empty storage path, custom backend implements StorageBackend, integrity secret required when integrity enabled, PII encryption key must be 32 bytes, retention maxAge > 0, buffer maxEntries >= 1, buffer flushIntervalMs > 0, maxFieldSize >= 0. Throw synchronous TypeError on invalid config. | Status: not_done
- [ ] **Implement environment variable overrides** -- Read LLM_AUDIT_HMAC_SECRET, LLM_AUDIT_STORAGE_PATH, LLM_AUDIT_RETENTION_DAYS, LLM_AUDIT_BUFFER_IMMEDIATE, LLM_AUDIT_DISABLED. Environment variables override corresponding options. | Status: not_done
- [ ] **Implement no-op mode** -- When LLM_AUDIT_DISABLED=true, createAuditLog returns a no-op instance where all methods are stubs that do nothing. | Status: not_done
- [ ] **Implement record() method** -- Accept RecordInput, build the complete AuditEntry via entry builder (UUID, timestamp, cost estimation, defaults), apply PII redaction if configured, apply PII encryption if configured, compute HMAC if integrity configured, push to buffer. Return the complete AuditEntry. | Status: not_done
- [ ] **Implement query() method** -- Delegate to the storage backend's query() with the provided QueryFilters. Return AsyncIterable<AuditEntry>. Decrypt PII fields if PII encryption is configured. | Status: not_done
- [ ] **Implement flush() method** -- Delegate to buffer's flush(). | Status: not_done
- [ ] **Implement close() method** -- Flush buffer, stop retention timer, close storage backend. Set active to false. | Status: not_done
- [ ] **Implement active property** -- Track whether the audit log is open (not closed). | Status: not_done
- [ ] **Implement entryCount property** -- Track total entries written since creation. | Status: not_done
- [ ] **Test createAuditLog with default options** -- Verify JSONL backend is used, default path, default buffer settings. | Status: not_done
- [ ] **Test configuration validation errors** -- Test each validation rule throws TypeError with appropriate message. | Status: not_done
- [ ] **Test environment variable overrides** -- Set env vars, verify they override passed options. | Status: not_done
- [ ] **Test no-op mode** -- Set LLM_AUDIT_DISABLED=true, verify record/query/verify/export are no-ops. | Status: not_done
- [ ] **Test record() produces correct entry** -- Record an entry, verify all fields are correctly populated (UUID, timestamp, tokens.total, defaults). | Status: not_done
- [ ] **Test record() with cost estimation** -- Record entry with known model, verify cost is computed. Record with unknown model, verify cost is null. | Status: not_done
- [ ] **Test query() round-trip** -- Record entries, query them back, verify correct results. | Status: not_done
- [ ] **Test close() flushes and prevents further writes** -- Close the log, verify buffer is flushed and subsequent calls throw or return gracefully. | Status: not_done

### 4.2 Public API Re-exports (`src/index.ts`)

- [ ] **Export createAuditLog** -- Re-export the factory function from audit-log.ts. | Status: not_done
- [ ] **Export setActorContext and getActorContext** -- Re-export from context.ts. | Status: not_done
- [ ] **Export all public types** -- Re-export AuditEntry, AuditLogOptions, RecordInput, QueryFilters, VerificationResult, ExportFormat, ExportOptions, AuditStats, InstrumentOptions, StorageBackend, etc. from types.ts. | Status: not_done

---

## Phase 5: HMAC Integrity Chain

### 5.1 Integrity Module (`src/integrity.ts`)

- [ ] **Implement HMAC computation for first entry** -- Compute HMAC-SHA256(secret, seed + canonicalJSON(entry without hmac/hmacSeed fields)). Store seed in entry's hmacSeed field. Generate a random 32-byte hex seed if not configured. | Status: not_done
- [ ] **Implement HMAC computation for subsequent entries** -- Compute HMAC-SHA256(secret, previousHmac + canonicalJSON(entry without hmac field)). | Status: not_done
- [ ] **Support configurable algorithms** -- Support sha256, sha384, sha512 as the HMAC algorithm. | Status: not_done
- [ ] **Implement chain verification** -- Walk all entries from first to last, recompute each HMAC, compare to stored value. Return VerificationResult with valid, entryCount, totalEntries, firstInvalidIndex, expectedHmac, actualHmac, invalidEntryId, durationMs. | Status: not_done
- [ ] **Implement partial verification** -- When VerifyOptions.last is provided, verify only the last N entries. | Status: not_done
- [ ] **Track previous HMAC state** -- Maintain the last HMAC in memory for computing the next entry's HMAC without re-reading storage. Handle chain continuation after reopening a log (read last entry's HMAC from storage on init). | Status: not_done
- [ ] **Test first entry HMAC** -- Verify first entry includes hmacSeed and correct HMAC value. | Status: not_done
- [ ] **Test chain continuation** -- Verify second entry's HMAC uses first entry's HMAC as input. | Status: not_done
- [ ] **Test valid chain verification** -- Create 100-entry chain, verify returns { valid: true, entryCount: 100 }. | Status: not_done
- [ ] **Test modification detection** -- Modify an entry in the middle, verify returns { valid: false } with correct firstInvalidIndex. | Status: not_done
- [ ] **Test insertion detection** -- Insert an entry in the middle, verify the chain breaks. | Status: not_done
- [ ] **Test deletion detection** -- Delete an entry from the middle, verify the chain breaks. | Status: not_done
- [ ] **Test different algorithms** -- Verify sha256, sha384, sha512 each produce valid chains with different hash lengths. | Status: not_done
- [ ] **Test canonical JSON determinism in HMAC** -- Verify that entry objects with different key orders produce the same HMAC. | Status: not_done
- [ ] **Test partial verification** -- Create a long chain, verify only last N entries, confirm results. | Status: not_done

### 5.2 Integrate Integrity into AuditLog

- [ ] **Wire integrity into record() write path** -- After building the entry and applying redaction/encryption, compute the HMAC and attach it to the entry before buffering. | Status: not_done
- [ ] **Implement log.verify() method** -- Delegate to the integrity module's verification function, passing the storage backend's query for sequential reads. | Status: not_done
- [ ] **Initialize chain state on log open** -- On createAuditLog, if integrity is configured and the storage has existing entries, read the last entry to get the previous HMAC for chain continuation. | Status: not_done

---

## Phase 6: PII Handling

### 6.1 PII Redaction (`src/redaction.ts`)

- [ ] **Implement pattern-based redaction** -- Apply configured regex patterns to all string field values in the entry (input, output, metadata values). Replace matches with the placeholder string (default '[REDACTED]'). | Status: not_done
- [ ] **Implement path-based redaction** -- For configured field paths (e.g., 'input', 'metadata.customerEmail'), replace the entire field value with the placeholder string. Use dot notation for nested paths. | Status: not_done
- [ ] **Implement custom redaction function** -- Call the custom redactor function for every string field, passing the field path and value, using the returned value. | Status: not_done
- [ ] **Ensure redaction occurs before HMAC and storage** -- Redaction must be applied in-memory before HMAC computation and before writing to storage. | Status: not_done
- [ ] **Test email pattern redaction** -- Verify email addresses in input/output are replaced with [REDACTED]. | Status: not_done
- [ ] **Test SSN pattern redaction** -- Verify US SSN patterns (xxx-xx-xxxx) are replaced. | Status: not_done
- [ ] **Test phone number pattern redaction** -- Verify US phone number patterns are replaced. | Status: not_done
- [ ] **Test credit card pattern redaction** -- Verify credit card number patterns are replaced. | Status: not_done
- [ ] **Test path-based redaction of entire input field** -- Configure path 'input', verify the whole input is replaced. | Status: not_done
- [ ] **Test path-based redaction of nested metadata field** -- Configure path 'metadata.customerEmail', verify only that field is replaced. | Status: not_done
- [ ] **Test custom redactor function** -- Provide a custom function, verify it is called for string fields and its return value is used. | Status: not_done
- [ ] **Test custom placeholder** -- Configure a custom placeholder string, verify it is used instead of '[REDACTED]'. | Status: not_done
- [ ] **Test redaction with no config** -- Verify no redaction occurs when redaction is not configured. | Status: not_done

### 6.2 PII Encryption (`src/encryption.ts`)

- [ ] **Implement AES-256-GCM field encryption** -- Encrypt fields tagged in piiFields with AES-256-GCM. Store the encrypted value and IV in the entry. Use node:crypto for encryption. | Status: not_done
- [ ] **Implement AES-256-GCM field decryption** -- Decrypt encrypted PII fields using the configured key and stored IV. | Status: not_done
- [ ] **Ensure HMAC covers encrypted (not plaintext) value** -- The HMAC chain must hash the encrypted representation, so the chain validates without the PII decryption key. | Status: not_done
- [ ] **Test encrypt/decrypt round-trip** -- Encrypt a field, decrypt it, verify the original value is recovered. | Status: not_done
- [ ] **Test wrong key produces garbage** -- Encrypt with one key, attempt to decrypt with a different key, verify failure or garbage output. | Status: not_done
- [ ] **Test crypto-shredding** -- Encrypt fields, then verify that without the PII key, PII is irrecoverable while the HMAC chain still validates. | Status: not_done

### 6.3 PII Field Tagging

- [ ] **Implement default PII field merging** -- Merge defaultPiiFields (['input', 'output'] by default) with per-entry piiFields. Remove duplicates. | Status: not_done
- [ ] **Test PII field merging** -- Verify defaultPiiFields are present on every entry, and per-entry piiFields are merged with no duplicates. | Status: not_done

### 6.4 PII-Aware Export

- [ ] **Implement includePii: false export** -- When exporting with includePii: false, replace PII-tagged fields with '[PII_EXCLUDED]'. | Status: not_done
- [ ] **Test PII-excluded export** -- Export with includePii: false, verify PII fields are replaced. Non-PII fields (timestamp, model, tokens, etc.) remain intact. | Status: not_done

### 6.5 GDPR Erasure (`log.erase()`)

- [ ] **Implement log.erase() method** -- Query all entries for the target actor, create a tombstone entry with tombstone: true, deletedEntryIds (list of matched entry IDs), deletionReason, append it to the chain (preserving HMAC integrity). | Status: not_done
- [ ] **Implement tombstone exclusion in queries** -- Subsequent queries with excludeTombstones: true (default) skip entries whose IDs appear in any tombstone's deletedEntryIds. | Status: not_done
- [ ] **Implement overwritePii for SQLite** -- When overwritePii: true and using SQLite backend, overwrite PII fields in tombstoned entries with null values in the database. | Status: not_done
- [ ] **Test erase creates correct tombstone** -- Verify tombstone entry has correct deletedEntryIds, deletionReason, tombstone: true, and that the HMAC chain remains valid. | Status: not_done
- [ ] **Test queries exclude erased entries** -- After erase, verify queries for the erased actor return no results. | Status: not_done
- [ ] **Test exports exclude erased entries** -- After erase, verify exports exclude tombstoned entries' PII. | Status: not_done
- [ ] **Test stats reflect tombstone counts** -- After erase, verify stats show correct activeEntries and tombstoneEntries. | Status: not_done

---

## Phase 7: SQLite Storage Backend

### 7.1 SQLite Backend (`src/storage/sqlite.ts`)

- [ ] **Implement SQLite init()** -- Create the database file if it does not exist. Create the audit_entries table with all columns per the spec schema. Create indexes on timestamp, actor, model, provider, tombstone. Enable WAL mode if configured (default true). Create FTS5 virtual table on input/output if fullTextSearch is enabled. | Status: not_done
- [ ] **Implement SQLite write()** -- Insert entries using parameterized INSERT statements. JSON-serialize complex fields (input, output, tool_calls, error, metadata, pii_fields, deleted_entry_ids). | Status: not_done
- [ ] **Implement SQLite query()** -- Build SQL SELECT with WHERE clauses from QueryFilters. Use indexed columns for actor, model, provider, timestamp range. Support full-text search via FTS5 MATCH. Return AsyncIterable<AuditEntry> by iterating rows and deserializing JSON fields. | Status: not_done
- [ ] **Implement SQLite count()** -- Build SQL SELECT COUNT(*) with WHERE clauses from QueryFilters. | Status: not_done
- [ ] **Implement SQLite delete()** -- Build SQL DELETE with WHERE clauses from QueryFilters. Return the count of deleted rows. | Status: not_done
- [ ] **Implement SQLite close()** -- Close the better-sqlite3 database connection. | Status: not_done
- [ ] **Handle missing better-sqlite3 gracefully** -- If better-sqlite3 is not installed and the user configures SQLite backend, throw a clear error explaining the missing peer dependency. | Status: not_done
- [ ] **Test SQLite write and query round-trip** -- Write entries, query them back, verify correctness. | Status: not_done
- [ ] **Test SQLite query filters** -- Test filtering by actor, date range, model, provider, errorsOnly, minCost, minTokens, limit, offset, order, excludeTombstones, metadata. | Status: not_done
- [ ] **Test SQLite full-text search** -- Enable FTS5, write entries with known content, search for keywords, verify matching entries are returned. | Status: not_done
- [ ] **Test SQLite delete** -- Write entries, delete some via filters, verify remaining entries are correct. | Status: not_done
- [ ] **Test SQLite WAL mode** -- Verify WAL mode is enabled by default and can be disabled via config. | Status: not_done

### 7.2 Integrate SQLite into AuditLog

- [ ] **Wire SQLite backend into createAuditLog** -- When storage.type is 'sqlite', instantiate the SQLite backend. Ensure all AuditLog methods work identically with SQLite as with JSONL. | Status: not_done
- [ ] **Wire custom backend into createAuditLog** -- When storage.type is 'custom', use the provided backend object. | Status: not_done

---

## Phase 8: SDK Instrumentation

### 8.1 Stream Interception (`src/instrument/stream.ts`)

- [ ] **Implement streaming response wrapper** -- Wrap a streaming response (async iterable/readable stream) to accumulate output text, measure total latency (from dispatch to stream close), and capture token counts from the final chunk's usage field. | Status: not_done
- [ ] **Test stream wrapper latency measurement** -- Provide a mock stream, verify latency is measured from start to stream end. | Status: not_done
- [ ] **Test stream wrapper output accumulation** -- Provide a mock stream with multiple chunks, verify full output text is accumulated. | Status: not_done
- [ ] **Test stream wrapper token capture** -- Provide a mock stream with usage in final chunk, verify token counts are captured. | Status: not_done

### 8.2 OpenAI Instrumentation (`src/instrument/openai.ts`)

- [ ] **Implement OpenAI client Proxy** -- Create a Proxy that wraps the OpenAI SDK client. Intercept `client.chat.completions.create()` for both streaming and non-streaming calls. Intercept `client.completions.create()` (legacy API). Intercept `client.responses.create()` (Responses API). | Status: not_done
- [ ] **Capture OpenAI call metadata** -- Before the call: record start time, capture input (messages/prompt), model name, tool definitions. After success: capture output, token counts from usage, compute latency, estimate cost, capture tool calls. After error: capture error message, code, status code. | Status: not_done
- [ ] **Handle OpenAI streaming calls** -- Wrap the stream via stream.ts to measure latency and accumulate output. | Status: not_done
- [ ] **Test OpenAI non-streaming call** -- Instrument a mock OpenAI client, execute a chat completion, verify the audit entry has correct model, provider ('openai'), input, output, tokens, latency. | Status: not_done
- [ ] **Test OpenAI streaming call** -- Instrument a mock OpenAI client with streaming, verify audit entry captures full streamed output and correct latency. | Status: not_done
- [ ] **Test OpenAI error handling** -- Instrument a mock client that throws, verify the entry is recorded with error details. | Status: not_done
- [ ] **Test OpenAI legacy completions API** -- Instrument and call completions.create(), verify entry is recorded. | Status: not_done

### 8.3 Anthropic Instrumentation (`src/instrument/anthropic.ts`)

- [ ] **Implement Anthropic client Proxy** -- Create a Proxy that wraps the Anthropic SDK client. Intercept `client.messages.create()` for non-streaming calls. Intercept `client.messages.stream()` for streaming calls. | Status: not_done
- [ ] **Capture Anthropic call metadata** -- Before: record start time, capture input messages, model name. After success: capture output content, token counts from usage, compute latency, estimate cost. After error: capture error details. | Status: not_done
- [ ] **Handle Anthropic streaming** -- Wrap the Anthropic stream via stream.ts. | Status: not_done
- [ ] **Test Anthropic non-streaming call** -- Instrument a mock Anthropic client, verify audit entry correctness. | Status: not_done
- [ ] **Test Anthropic streaming call** -- Instrument a mock Anthropic client with streaming, verify audit entry. | Status: not_done
- [ ] **Test Anthropic error handling** -- Mock client that throws, verify entry with error details. | Status: not_done

### 8.4 Actor Context (`src/context.ts`)

- [ ] **Implement setActorContext()** -- Use node:async_hooks AsyncLocalStorage to set the actor string for all async operations within a callback. | Status: not_done
- [ ] **Implement getActorContext()** -- Retrieve the current actor string from the AsyncLocalStorage context. Return undefined if not set. | Status: not_done
- [ ] **Test actor context propagation** -- Call setActorContext('user:alice', fn), verify getActorContext() returns 'user:alice' within fn. | Status: not_done
- [ ] **Test nested async operations** -- Verify the actor context propagates through await, setTimeout, setImmediate, and Promise chains within the callback. | Status: not_done
- [ ] **Test concurrent contexts** -- Run multiple concurrent setActorContext calls with different actors, verify each gets the correct actor. | Status: not_done

### 8.5 Instrument Dispatch (`src/instrument/index.ts`)

- [ ] **Implement log.instrument() with SDK auto-detection** -- Detect whether the passed client is an OpenAI or Anthropic SDK instance. Dispatch to the appropriate instrumentation proxy. Throw a clear error for unsupported clients. | Status: not_done
- [ ] **Implement InstrumentOptions handling** -- Apply actor override, metadata override, piiFields override, and captureContent option. When captureContent is false, record metadata only (no input/output content). | Status: not_done
- [ ] **Integrate actor context** -- If no explicit actor is provided in InstrumentOptions, read from AsyncLocalStorage context via getActorContext(). | Status: not_done
- [ ] **Test SDK auto-detection** -- Verify OpenAI client is detected and routed correctly. Verify Anthropic client is detected. Verify unsupported client throws. | Status: not_done
- [ ] **Test captureContent: false** -- Verify input/output are not recorded when captureContent is false. | Status: not_done
- [ ] **Test actor from context** -- Instrument a client without explicit actor, set actor via setActorContext, verify the entry picks up the context actor. | Status: not_done

---

## Phase 9: Export, Retention, and Stats

### 9.1 Export (`src/export.ts`)

- [ ] **Implement JSON export** -- Produce a JSON string containing an array of AuditEntry objects matching the given filters. Support includePii option. Support subjectAccessRequest option (filter by actor). | Status: not_done
- [ ] **Implement CSV export** -- Produce a CSV string with header row. Flatten complex fields (input, output, toolCalls, metadata) as JSON-serialized strings within cells. Support column selection. Support includePii option. | Status: not_done
- [ ] **Implement GDPR Subject Access Request export** -- When subjectAccessRequest.actor is provided, export all entries for that actor with full PII (if includePii: true) or excluded PII (if false). | Status: not_done
- [ ] **Test JSON export produces valid JSON** -- Export entries, parse the result, verify it matches the expected entries. | Status: not_done
- [ ] **Test CSV export produces valid CSV with correct headers** -- Export with column selection, verify header row and data rows are correct. | Status: not_done
- [ ] **Test PII exclusion in export** -- Export with includePii: false, verify PII fields are replaced with '[PII_EXCLUDED]'. | Status: not_done
- [ ] **Test Subject Access Request export** -- Export for a specific actor, verify only that actor's entries are included. | Status: not_done

### 9.2 Retention (`src/retention.ts`)

- [ ] **Implement retention policy enforcement** -- On startup, run an initial purge check. Start a periodic timer (setInterval with unref()) at checkIntervalMs intervals. Each check identifies entries with timestamp older than now - maxAge. | Status: not_done
- [ ] **Implement archive-before-purge** -- When archiveBeforePurge is true, export matching entries to a JSON file in archiveDir (named 'archive-{from}-{to}.json') before deleting them. | Status: not_done
- [ ] **Implement chain gap record for JSONL purge** -- When entries are purged from JSONL backend, write a chain gap record documenting the purge event (since the HMAC chain is not recomputed). | Status: not_done
- [ ] **Test auto-purge with short maxAge** -- Configure 1-second maxAge, write entries, wait, verify old entries are purged. | Status: not_done
- [ ] **Test archive-before-purge** -- Verify archive file is created with correct entries before deletion occurs. | Status: not_done
- [ ] **Test manual purge** -- Call log.purge(date), verify entries before the date are deleted, return count is correct. | Status: not_done

### 9.3 Stats (`log.stats()`)

- [ ] **Implement log.stats() method** -- Query the storage backend for: totalEntries, activeEntries (non-tombstoned), tombstoneEntries, oldestEntry timestamp, newestEntry timestamp, storageSizeBytes, byProvider breakdown (count, totalTokens, totalCost per provider), byModel breakdown, distinctActors count, totalTokens, totalCost, integrityStatus. | Status: not_done
- [ ] **Test stats accuracy** -- Write entries with varied providers, models, actors, costs. Verify stats reflect correct aggregations. | Status: not_done
- [ ] **Test stats with tombstones** -- Write entries, erase some, verify active vs tombstone counts. | Status: not_done

### 9.4 Integrate into AuditLog

- [ ] **Wire log.export() into AuditLog class** -- Delegate to export.ts formatters with the storage backend's query. | Status: not_done
- [ ] **Wire log.purge() into AuditLog class** -- Implement manual purge delegating to storage backend's delete. | Status: not_done
- [ ] **Wire log.stats() into AuditLog class** -- Aggregate stats from storage backend. | Status: not_done
- [ ] **Wire retention auto-purge into AuditLog lifecycle** -- Start retention timer on init, stop on close. | Status: not_done

---

## Phase 10: CLI

### 10.1 CLI Entry Point (`src/cli/index.ts`)

- [ ] **Implement CLI entry point** -- Add shebang line (#!/usr/bin/env node). Parse command-line arguments. Dispatch to subcommands: query, verify, export, purge, stats. Handle --help and --version. Set appropriate exit codes: 0 (success), 1 (error), 2 (usage error). | Status: not_done
- [ ] **Implement argument parsing** -- Parse common flags: --path (storage file path), --format, --secret. Use a minimal argument parser (manual or small dependency). | Status: not_done

### 10.2 CLI query Command (`src/cli/query.ts`)

- [ ] **Implement query command** -- Accept --path, --actor, --from, --to, --model, --provider, --limit, --format (table/json/csv). Open the audit log, run the query, format output, print to stdout. | Status: not_done
- [ ] **Implement table output format** -- Render entries as a human-readable table with columns: timestamp, actor, model, tokens, latency, cost, error. | Status: not_done
- [ ] **Test query command output** -- Verify correct output for table, json, csv formats. | Status: not_done

### 10.3 CLI verify Command (`src/cli/verify.ts`)

- [ ] **Implement verify command** -- Accept --path and --secret. Open the audit log with integrity config, run verify(), print results. Exit 0 if valid, 1 if invalid or error. | Status: not_done
- [ ] **Test verify command pass and fail output** -- Test with a valid chain (exit 0), and a broken chain (exit 1). | Status: not_done

### 10.4 CLI export Command (`src/cli/export.ts`)

- [ ] **Implement export command** -- Accept --path, --format (json/csv), --output (file path), --from, --to, --actor, --no-pii. Run export, write to --output file or stdout. | Status: not_done
- [ ] **Implement GDPR SAR export via CLI** -- When --actor is provided, use subjectAccessRequest mode. | Status: not_done
- [ ] **Test export command** -- Verify JSON and CSV output files are created correctly. | Status: not_done

### 10.5 CLI purge Command (`src/cli/purge.ts`)

- [ ] **Implement purge command** -- Accept --path, --before (date), --archive (directory). Run purge, print count of purged entries. | Status: not_done
- [ ] **Test purge command** -- Verify entries are purged and archive is created when specified. | Status: not_done

### 10.6 CLI stats Command (`src/cli/stats.ts`)

- [ ] **Implement stats command** -- Accept --path. Open the audit log, call stats(), print formatted statistics to stdout matching the spec's output format. | Status: not_done
- [ ] **Test stats command output** -- Verify formatted output matches expected structure. | Status: not_done

---

## Phase 11: Integration Tests

- [ ] **End-to-end JSONL recording test** -- Create audit log with JSONL storage, write 10 entries, close, reopen, verify all 10 are queryable and HMAC chain is intact. | Status: not_done
- [ ] **End-to-end SQLite recording test** -- Create audit log with SQLite storage, write 10 entries, query by actor/model/date range, verify correct results and HMAC chain. | Status: not_done
- [ ] **End-to-end OpenAI instrumentation test** -- Instrument a mock OpenAI client, execute chat completion, verify audit entry has correct model, provider, input, output, tokens, latency. | Status: not_done
- [ ] **End-to-end OpenAI streaming instrumentation test** -- Instrument a mock OpenAI client for streaming, verify audit entry captures full streamed output and correct latency. | Status: not_done
- [ ] **End-to-end Anthropic instrumentation test** -- Same as OpenAI tests, adapted for Anthropic SDK API surface. | Status: not_done
- [ ] **End-to-end actor context test** -- setActorContext('user:alice', fn) where fn makes an instrumented call. Verify entry has actor 'user:alice'. Test nested async operations. Test concurrent requests with different actors. | Status: not_done
- [ ] **End-to-end GDPR erasure test** -- Write entries for multiple actors. Erase one. Verify queries exclude erased actor. Verify exports exclude erased actor. Verify chain is intact. Verify stats show correct counts. | Status: not_done
- [ ] **End-to-end PII redaction test** -- Configure redaction patterns, record entries with PII, verify stored entries have redacted values. | Status: not_done
- [ ] **End-to-end PII encryption test** -- Configure PII encryption, record entries, verify PII fields are encrypted at rest, decrypted on query. | Status: not_done
- [ ] **End-to-end retention test** -- Configure short retention, write entries, verify auto-purge removes old entries. | Status: not_done
- [ ] **End-to-end export test** -- Write entries, export as JSON and CSV with various filter/PII options, verify output correctness. | Status: not_done

---

## Phase 12: Performance and Benchmark Tests

- [ ] **JSONL write throughput benchmark** -- Measure entries per second for JSONL backend with default buffer settings. Target: at least 10,000 entries/second. | Status: not_done
- [ ] **SQLite write throughput benchmark** -- Measure entries per second for SQLite backend. Target: at least 5,000 entries/second. | Status: not_done
- [ ] **JSONL query performance benchmark** -- Measure query time for 100,000 entries with actor filter. Target: under 2 seconds. | Status: not_done
- [ ] **SQLite query performance benchmark** -- Measure query time for 100,000 entries with actor filter. Target: under 100ms. | Status: not_done
- [ ] **Verification speed benchmark** -- Measure verification time for 100,000 entries. Target: under 2 seconds. | Status: not_done
- [ ] **Memory usage benchmark** -- Measure memory growth over 100,000 entries. Verify memory is bounded (buffer flushes, no unbounded accumulation). | Status: not_done

---

## Phase 13: Documentation and Polish

- [ ] **Write README.md** -- Installation instructions, quickstart example, configuration reference, API reference, CLI usage, environment variables, storage backend comparison, PII handling guide, HMAC integrity explanation, GDPR compliance guide, ecosystem integration examples. | Status: not_done
- [ ] **Add JSDoc to all public API methods** -- Ensure createAuditLog, record, instrument, query, verify, export, purge, erase, stats, flush, close, setActorContext, getActorContext all have complete JSDoc comments matching the spec descriptions. | Status: not_done
- [ ] **Add JSDoc to all public interfaces** -- Ensure AuditEntry, AuditLogOptions, RecordInput, QueryFilters, VerificationResult, ExportOptions, AuditStats, InstrumentOptions, StorageBackend, etc. have JSDoc on every field. | Status: not_done

---

## Phase 14: Build, Lint, and Publish Preparation

- [ ] **Verify npm run build succeeds** -- Run `tsc` and confirm dist/ output is correct with declarations. | Status: not_done
- [ ] **Verify npm run lint passes** -- Run eslint on src/ and fix any issues. | Status: not_done
- [ ] **Verify npm run test passes** -- Run vitest and confirm all tests pass. | Status: not_done
- [ ] **Bump version in package.json** -- Update version as appropriate for the initial release (0.1.0 or as needed). | Status: not_done
- [ ] **Verify package.json metadata** -- Ensure name, description, keywords, author, license, engines, files, main, types, bin, publishConfig are all correct. | Status: not_done
- [ ] **Dry-run npm publish** -- Run `npm pack` to verify the package contents are correct (dist/ only, no src/ or tests). | Status: not_done
