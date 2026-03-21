/**
 * AuditLogger — the core class for tamper-evident LLM audit logging.
 *
 * Orchestrates HMAC integrity chains, PII redaction, JSONL storage,
 * retention policies, and export.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import type {
  AuditEntry,
  AuditLogOptions,
  ExportFormat,
  QueryFilters,
  RecordInput,
  StorageBackend,
  VerificationResult,
} from './types.js';
import { computeHmac, verifyChain } from './hmac.js';
import { redactFields } from './redact.js';
import { JsonlStorage } from './storage/jsonl.js';
import { RetentionManager } from './retention.js';

export class AuditLogger {
  private readonly backend: StorageBackend;
  private readonly hmacSecret: string | Buffer | undefined;
  private hmacSeed: string | undefined;
  private readonly defaultPiiFields: string[];
  private readonly redactPii: boolean;
  private readonly piiPatterns: RegExp[] | undefined;
  private readonly onError: (error: Error) => void;
  private retentionManager: RetentionManager | null = null;
  private lastHmac: string | null = null;
  private isFirstEntry: boolean | null = null; // null means unknown, need to check storage
  private _active = true;
  private _entryCount = 0;
  private initialized = false;

  constructor(options: AuditLogOptions = {}) {
    const storagePath = options.storagePath ?? './audit.jsonl';
    this.backend = new JsonlStorage({
      filePath: storagePath,
      maxFileSize: options.maxFileSize,
      autoRotate: options.autoRotate ?? true,
    });

    this.hmacSecret = options.hmacSecret;
    this.hmacSeed = options.hmacSeed;
    this.defaultPiiFields = options.defaultPiiFields ?? ['input', 'output'];
    this.redactPii = options.redactPii ?? false;
    this.piiPatterns = options.piiPatterns;
    this.onError = options.onError ?? ((err) => console.error('[llm-audit-log]', err.message));
  }

  /** Whether the audit log is active (not closed). */
  get active(): boolean {
    return this._active;
  }

  /** Total entries written since creation. */
  get entryCount(): number {
    return this._entryCount;
  }

  /**
   * Initialize the logger: set up storage, load chain state, start retention.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.backend.init();

    // Load existing chain state
    if (this.hmacSecret) {
      const entries = await this.backend.read();
      if (entries.length > 0) {
        this.lastHmac = entries[entries.length - 1].hmac ?? null;
        this.isFirstEntry = false;
        this._entryCount = entries.length;
      } else {
        this.isFirstEntry = true;
      }
    }
  }

  /**
   * Start retention manager if retention options are configured.
   */
  async startRetention(retentionDays: number, checkIntervalMs?: number): Promise<void> {
    await this.ensureInitialized();

    const maxAge = retentionDays * 24 * 60 * 60 * 1000;
    this.retentionManager = new RetentionManager(this.backend, {
      maxAge,
      checkIntervalMs,
    });
    await this.retentionManager.start();
  }

  /**
   * Record a single LLM interaction as an audit entry.
   *
   * @param input - The record input (partial entry).
   * @returns The complete AuditEntry with all fields populated.
   */
  async log(input: RecordInput): Promise<AuditEntry> {
    if (!this._active) {
      throw new Error('AuditLogger is closed');
    }

    await this.ensureInitialized();

    try {
      // Build the full entry
      const entry: AuditEntry = {
        id: randomUUID(),
        v: 1,
        timestamp: new Date().toISOString(),
        actor: input.actor ?? null,
        model: input.model,
        provider: input.provider,
        input: input.input,
        output: input.output,
        tokens: {
          input: input.tokens.input,
          output: input.tokens.output,
          total: input.tokens.input + input.tokens.output,
        },
        latencyMs: input.latencyMs,
        cost: input.cost ?? null,
        toolCalls: input.toolCalls ?? null,
        error: input.error ?? null,
        metadata: input.metadata ?? {},
        piiFields: [
          ...new Set([...this.defaultPiiFields, ...(input.piiFields ?? [])]),
        ],
      };

      // Apply PII redaction
      if (this.redactPii || (this.piiPatterns && this.piiPatterns.length > 0)) {
        redactFields(entry, {
          redactPatterns: true,
          customPatterns: this.piiPatterns,
        });
      }

      // Compute HMAC
      if (this.hmacSecret) {
        if (this.isFirstEntry || this.isFirstEntry === null) {
          // First entry — use seed
          const seed = this.hmacSeed ?? randomBytes(32).toString('hex');
          entry.hmacSeed = seed;
          entry.hmac = computeHmac(entry, this.hmacSecret, null, seed);
          this.isFirstEntry = false;
        } else {
          // Subsequent entry — chain from previous HMAC
          entry.hmac = computeHmac(entry, this.hmacSecret, this.lastHmac);
        }
        this.lastHmac = entry.hmac;
      }

      // Append to storage
      await this.backend.append(entry);
      this._entryCount++;

      return entry;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError(error);
      throw error;
    }
  }

  /**
   * Query audit entries matching the given filters.
   */
  async query(filters: QueryFilters = {}): Promise<AuditEntry[]> {
    await this.ensureInitialized();
    return this.backend.query(filters);
  }

  /**
   * Verify the HMAC integrity chain.
   */
  async verify(): Promise<VerificationResult> {
    await this.ensureInitialized();

    const start = Date.now();

    if (!this.hmacSecret) {
      return {
        valid: false,
        entryCount: 0,
        firstInvalidIndex: -1,
        durationMs: Date.now() - start,
        error: 'HMAC integrity is not configured (no hmacSecret provided)',
      };
    }

    try {
      const entries = await this.backend.read();
      const result = verifyChain(entries, this.hmacSecret);

      return {
        valid: result.valid,
        entryCount: entries.length,
        firstInvalidIndex: result.brokenAt,
        expectedHmac: result.expectedHmac,
        actualHmac: result.actualHmac,
        invalidEntryId: result.brokenAt >= 0 ? entries[result.brokenAt]?.id : undefined,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        valid: false,
        entryCount: 0,
        firstInvalidIndex: -1,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Export entries in the specified format.
   */
  async export(format: ExportFormat, filters?: QueryFilters): Promise<string> {
    await this.ensureInitialized();
    return this.backend.export(format, filters);
  }

  /**
   * Purge entries older than the given date.
   *
   * @returns The number of entries purged.
   */
  async purge(before: Date): Promise<number> {
    await this.ensureInitialized();
    return this.backend.purge(before);
  }

  /**
   * Close the audit logger: stop retention, release resources.
   */
  async close(): Promise<void> {
    if (!this._active) return;
    this._active = false;

    if (this.retentionManager) {
      this.retentionManager.stop();
      this.retentionManager = null;
    }

    await this.backend.close();
  }
}
