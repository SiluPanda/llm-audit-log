/**
 * JSONL (JSON Lines) storage backend for audit entries.
 *
 * Each entry is stored as one JSON object per line in a .jsonl file.
 * Supports file rotation when maxFileSize is exceeded.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditEntry, ExportFormat, QueryFilters, StorageBackend } from '../types.js';

const DEFAULT_MAX_FILE_SIZE = 52_428_800; // 50 MiB

export interface JsonlStorageOptions {
  /** Path to the JSONL file. */
  filePath: string;
  /** Maximum file size in bytes before rotation. Defaults to 50 MiB. */
  maxFileSize?: number;
  /** Whether to auto-rotate when maxFileSize is exceeded. Defaults to true. */
  autoRotate?: boolean;
}

export class JsonlStorage implements StorageBackend {
  private readonly filePath: string;
  private readonly maxFileSize: number;
  private readonly autoRotate: boolean;

  constructor(options: JsonlStorageOptions) {
    this.filePath = path.resolve(options.filePath);
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.autoRotate = options.autoRotate ?? true;
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Create the file if it doesn't exist
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', { mode: 0o600 });
    }
  }

  async append(entry: AuditEntry): Promise<void> {
    // Check for rotation
    if (this.autoRotate) {
      await this.rotateIfNeeded();
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.filePath, line, { mode: 0o600 });
  }

  async read(): Promise<AuditEntry[]> {
    return this.readFile(this.filePath);
  }

  async query(filters: QueryFilters): Promise<AuditEntry[]> {
    const entries = await this.readAllFiles();
    return this.applyFilters(entries, filters);
  }

  async purge(before: Date): Promise<number> {
    const entries = await this.readAllFiles();
    const cutoff = before.getTime();
    const kept: AuditEntry[] = [];
    let purged = 0;

    for (const entry of entries) {
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime < cutoff) {
        purged++;
      } else {
        kept.push(entry);
      }
    }

    if (purged > 0) {
      // Rewrite the main file with kept entries
      const content = kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : '');
      fs.writeFileSync(this.filePath, content, { mode: 0o600 });

      // Remove rotated files since we consolidated
      this.removeRotatedFiles();
    }

    return purged;
  }

  async export(format: ExportFormat, filters?: QueryFilters): Promise<string> {
    let entries: AuditEntry[];
    if (filters) {
      entries = await this.query(filters);
    } else {
      entries = await this.readAllFiles();
    }

    switch (format) {
      case 'json':
        return JSON.stringify(entries, null, 2);
      case 'csv':
        return this.toCsv(entries);
      case 'jsonl':
        return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  async count(): Promise<number> {
    const entries = await this.readAllFiles();
    return entries.length;
  }

  async size(): Promise<number> {
    let totalSize = 0;
    if (fs.existsSync(this.filePath)) {
      totalSize += fs.statSync(this.filePath).size;
    }
    // Include rotated files
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath);
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(baseName + '.') && /\.\d+$/.test(file)) {
        totalSize += fs.statSync(path.join(dir, file)).size;
      }
    }
    return totalSize;
  }

  async close(): Promise<void> {
    // No resources to release for file-based storage
  }

  // --- Private methods ---

  private readFile(filePath: string): AuditEntry[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) {
      return [];
    }
    const lines = content.trim().split('\n');
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line) as AuditEntry);
        } catch {
          // Skip malformed lines
        }
      }
    }
    return entries;
  }

  private readAllFiles(): AuditEntry[] {
    const entries: AuditEntry[] = [];

    // Read rotated files first (oldest first)
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const rotatedFiles = files
        .filter((f) => f.startsWith(baseName + '.') && /\.\d+$/.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.split('.').pop()!, 10);
          const numB = parseInt(b.split('.').pop()!, 10);
          return numB - numA; // Higher numbers are older
        });

      for (const file of rotatedFiles) {
        entries.push(...this.readFile(path.join(dir, file)));
      }
    }

    // Read current file
    entries.push(...this.readFile(this.filePath));

    return entries;
  }

  private applyFilters(entries: AuditEntry[], filters: QueryFilters): AuditEntry[] {
    let result = entries;

    const excludeTombstones = filters.excludeTombstones !== false;
    if (excludeTombstones) {
      result = result.filter((e) => !e.tombstone);
    }

    if (filters.startDate) {
      const start = filters.startDate.getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() >= start);
    }

    if (filters.endDate) {
      const end = filters.endDate.getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    if (filters.actor) {
      result = result.filter((e) => e.actor === filters.actor);
    }

    if (filters.model) {
      result = result.filter((e) => e.model === filters.model);
    }

    if (filters.tags && filters.tags.length > 0) {
      result = result.filter((e) => {
        const entryTags = e.metadata?.tags;
        if (!Array.isArray(entryTags)) return false;
        return filters.tags!.every((tag) => entryTags.includes(tag));
      });
    }

    if (filters.offset !== undefined && filters.offset > 0) {
      result = result.slice(filters.offset);
    }

    if (filters.limit !== undefined && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!fs.existsSync(this.filePath)) return;

    const stat = fs.statSync(this.filePath);
    if (stat.size < this.maxFileSize) return;

    // Find the next rotation number
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath);
    const files = fs.readdirSync(dir);
    let maxNum = 0;
    for (const file of files) {
      const match = file.match(new RegExp(`^${escapeRegex(baseName)}\\.(\\d+)$`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const rotatedPath = this.filePath + '.' + (maxNum + 1);
    fs.renameSync(this.filePath, rotatedPath);
    fs.writeFileSync(this.filePath, '', { mode: 0o600 });
  }

  private removeRotatedFiles(): void {
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(baseName + '.') && /\.\d+$/.test(file)) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  }

  private toCsv(entries: AuditEntry[]): string {
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

    const csvRows = [headers.join(',')];

    for (const entry of entries) {
      const row = [
        csvEscape(entry.id),
        String(entry.v),
        csvEscape(entry.timestamp),
        csvEscape(entry.actor ?? ''),
        csvEscape(entry.model),
        csvEscape(entry.provider),
        csvEscape(typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input)),
        csvEscape(typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output)),
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
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n') + '\n';
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
