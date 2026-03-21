/**
 * llm-audit-log — Tamper-evident compliance-ready audit logging for LLM I/O.
 *
 * Provides HMAC-SHA256 integrity chains, PII redaction, JSONL storage,
 * configurable retention policies, and multi-format export.
 *
 * @packageDocumentation
 */

export type {
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
} from './types.js';

export { AuditLogger } from './logger.js';
export { computeHmac, verifyChain, canonicalJSON } from './hmac.js';
export { detectPii, redactString, redactFields } from './redact.js';
export { JsonlStorage } from './storage/jsonl.js';
export { RetentionManager } from './retention.js';
export { exportEntries, toJson, toJsonl, toCsv } from './export.js';

import { AuditLogger } from './logger.js';
import type { AuditLogOptions } from './types.js';

/**
 * Factory function to create a configured AuditLogger instance.
 *
 * @param options - Configuration options for the audit logger.
 * @returns A new AuditLogger instance.
 */
export function createAuditLog(options: AuditLogOptions = {}): AuditLogger {
  return new AuditLogger(options);
}
