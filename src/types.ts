/**
 * Core types for llm-audit-log.
 */

/** Provider of the LLM API. */
export type Provider = 'openai' | 'anthropic' | 'google' | 'azure-openai' | 'aws-bedrock' | 'custom';

/** Export format options. */
export type ExportFormat = 'json' | 'csv' | 'jsonl';

/**
 * A single audit log entry representing one LLM API interaction.
 */
export interface AuditEntry {
  /** Unique identifier (UUIDv4). */
  id: string;
  /** Schema version. */
  v: 1;
  /** ISO 8601 timestamp with millisecond precision (UTC). */
  timestamp: string;
  /** The actor who triggered the LLM call. */
  actor: string | null;
  /** The model name as passed to the API. */
  model: string;
  /** The LLM provider. */
  provider: Provider;
  /** The input sent to the LLM. */
  input: unknown;
  /** The response received from the LLM. */
  output: unknown;
  /** Token counts. */
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  /** Response latency in milliseconds. */
  latencyMs: number;
  /** Estimated cost in USD, or null. */
  cost: number | null;
  /** Tool calls made during this interaction. */
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    id?: string;
    result?: unknown;
  }> | null;
  /** Error details if the LLM call failed. */
  error: {
    message: string;
    code?: string;
    statusCode?: number;
  } | null;
  /** Custom key-value metadata. */
  metadata: Record<string, unknown>;
  /** Field paths containing PII. */
  piiFields: string[];
  /** HMAC-SHA256 integrity hash. */
  hmac?: string;
  /** Integrity chain seed (first entry only). */
  hmacSeed?: string;
  /** Whether this entry is a tombstone (logical deletion). */
  tombstone?: boolean;
  /** IDs of entries being logically deleted (tombstone only). */
  deletedEntryIds?: string[];
  /** Reason for deletion (tombstone only). */
  deletionReason?: string;
}

/**
 * Input for recording a new audit entry (partial — id, v, timestamp, hmac are auto-generated).
 */
export interface RecordInput {
  actor?: string | null;
  model: string;
  provider: Provider;
  input: unknown;
  output: unknown;
  tokens: { input: number; output: number };
  latencyMs: number;
  cost?: number | null;
  toolCalls?: AuditEntry['toolCalls'];
  error?: AuditEntry['error'];
  metadata?: Record<string, unknown>;
  piiFields?: string[];
}

/**
 * Options for creating an AuditLogger.
 */
export interface AuditLogOptions {
  /** Path to the storage directory/file. Defaults to './audit.jsonl'. */
  storagePath?: string;
  /** HMAC secret for integrity chain. When provided, integrity is enabled. */
  hmacSecret?: string | Buffer;
  /** HMAC seed for the first entry. Auto-generated if not provided. */
  hmacSeed?: string;
  /** Retention in days. Entries older than this are eligible for purge. */
  retentionDays?: number;
  /** Maximum file size in bytes before rotation. Defaults to 52_428_800 (50 MiB). */
  maxFileSize?: number;
  /** Default PII field paths applied to every entry. Defaults to ['input', 'output']. */
  defaultPiiFields?: string[];
  /** Whether to auto-redact PII patterns in string fields. Defaults to false. */
  redactPii?: boolean;
  /** Custom PII regex patterns to redact. */
  piiPatterns?: RegExp[];
  /** Whether to auto-rotate files when maxFileSize is exceeded. Defaults to true. */
  autoRotate?: boolean;
  /** Called on internal errors. Defaults to console.error. */
  onError?: (error: Error) => void;
}

/**
 * Query filters for searching audit entries.
 */
export interface QueryFilters {
  /** Filter by start date (inclusive). */
  startDate?: Date;
  /** Filter by end date (inclusive). */
  endDate?: Date;
  /** Filter by actor (exact match). */
  actor?: string;
  /** Filter by model name (exact match). */
  model?: string;
  /** Filter by tags in metadata. */
  tags?: string[];
  /** Maximum number of entries to return. */
  limit?: number;
  /** Number of entries to skip. */
  offset?: number;
  /** Exclude tombstoned entries. Defaults to true. */
  excludeTombstones?: boolean;
}

/**
 * Storage backend interface.
 */
export interface StorageBackend {
  /** Initialize the backend. */
  init(): Promise<void>;
  /** Append a single entry. */
  append(entry: AuditEntry): Promise<void>;
  /** Read all entries. */
  read(): Promise<AuditEntry[]>;
  /** Query entries with filters. */
  query(filters: QueryFilters): Promise<AuditEntry[]>;
  /** Purge entries older than the given date. Returns count of purged entries. */
  purge(before: Date): Promise<number>;
  /** Export entries in the given format. */
  export(format: ExportFormat, filters?: QueryFilters): Promise<string>;
  /** Get the total count of entries. */
  count(): Promise<number>;
  /** Get storage size in bytes. */
  size(): Promise<number>;
  /** Close the backend and release resources. */
  close(): Promise<void>;
}

/**
 * Retention policy configuration.
 */
export interface RetentionPolicy {
  /** Maximum age in milliseconds. */
  maxAge: number;
  /** How often to run purge checks (ms). Defaults to 86_400_000 (24h). */
  checkIntervalMs?: number;
  /** Whether to archive entries before purging. */
  archiveBeforePurge?: boolean;
  /** Directory for archive files. */
  archiveDir?: string;
}

/**
 * Result of HMAC chain verification.
 */
export interface VerificationResult {
  /** Whether the chain is intact. */
  valid: boolean;
  /** Total entries verified. */
  entryCount: number;
  /** Index of first invalid entry (-1 if all valid). */
  firstInvalidIndex: number;
  /** Expected HMAC at invalid index. */
  expectedHmac?: string;
  /** Actual HMAC at invalid index. */
  actualHmac?: string;
  /** Entry ID at invalid index. */
  invalidEntryId?: string;
  /** Verification duration in ms. */
  durationMs: number;
  /** Error message if verification itself failed. */
  error?: string;
}

/**
 * PII detection result.
 */
export interface PiiMatch {
  /** Type of PII found. */
  type: 'email' | 'phone' | 'ssn' | 'creditCard' | 'ipAddress';
  /** The matched value. */
  value: string;
  /** Start index in the text. */
  start: number;
  /** End index in the text. */
  end: number;
}
