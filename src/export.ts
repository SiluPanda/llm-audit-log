/**
 * Export utilities for audit log entries.
 *
 * Supports JSON, CSV, and JSONL export formats with optional filtering.
 */
import type { AuditEntry, ExportFormat, QueryFilters, StorageBackend } from './types.js';

/**
 * Export entries from the storage backend in the specified format.
 *
 * @param backend - The storage backend to read from.
 * @param format - The export format ('json', 'csv', or 'jsonl').
 * @param filters - Optional query filters to apply.
 * @returns The exported data as a string.
 */
export async function exportEntries(
  backend: StorageBackend,
  format: ExportFormat,
  filters?: QueryFilters,
): Promise<string> {
  return backend.export(format, filters);
}

/**
 * Format entries as a JSON array string.
 */
export function toJson(entries: AuditEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Format entries as JSONL (one JSON object per line).
 */
export function toJsonl(entries: AuditEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/**
 * Format entries as CSV with flattened nested fields.
 */
export function toCsv(entries: AuditEntry[]): string {
  if (entries.length === 0) return '';

  const headers = [
    'id', 'v', 'timestamp', 'actor', 'model', 'provider',
    'input', 'output',
    'tokens_input', 'tokens_output', 'tokens_total',
    'latencyMs', 'cost',
    'toolCalls', 'error',
    'metadata', 'piiFields',
    'hmac', 'tombstone',
  ];

  const rows = [headers.join(',')];

  for (const entry of entries) {
    const row = [
      csvEscape(entry.id),
      String(entry.v),
      csvEscape(entry.timestamp),
      csvEscape(entry.actor ?? ''),
      csvEscape(entry.model),
      csvEscape(entry.provider),
      csvEscape(stringifyField(entry.input)),
      csvEscape(stringifyField(entry.output)),
      String(entry.tokens.input),
      String(entry.tokens.output),
      String(entry.tokens.total),
      String(entry.latencyMs),
      entry.cost !== null ? String(entry.cost) : '',
      csvEscape(entry.toolCalls ? JSON.stringify(entry.toolCalls) : ''),
      csvEscape(entry.error ? JSON.stringify(entry.error) : ''),
      csvEscape(JSON.stringify(entry.metadata)),
      csvEscape(JSON.stringify(entry.piiFields)),
      csvEscape(entry.hmac ?? ''),
      entry.tombstone ? 'true' : 'false',
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n') + '\n';
}

function stringifyField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
