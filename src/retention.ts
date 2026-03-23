/**
 * Retention policy management for audit log entries.
 *
 * Auto-purges entries older than the configured retention period.
 */
import type { StorageBackend, RetentionPolicy } from './types.js';

const DEFAULT_CHECK_INTERVAL_MS = 86_400_000; // 24 hours

export class RetentionManager {
  private readonly backend: StorageBackend;
  private readonly maxAge: number;
  private readonly checkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(backend: StorageBackend, policy: RetentionPolicy) {
    this.backend = backend;
    this.maxAge = policy.maxAge;
    this.checkIntervalMs = policy.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  /**
   * Start the retention manager.
   * Runs an initial purge check and schedules periodic checks.
   */
  async start(): Promise<void> {
    // Run initial purge
    await this.runPurge();

    // Schedule periodic purge
    this.timer = setInterval(() => {
      this.runPurge().catch(() => { /* handled by backend */ });
    }, this.checkIntervalMs);

    // Don't block process exit
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stop the retention manager and clear the timer.
   */
  stop(): void {
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single purge check.
   * Removes entries older than now - maxAge.
   *
   * @returns The number of entries purged.
   */
  async runPurge(): Promise<number> {
    if (this.closed) return 0;

    const cutoff = new Date(Date.now() - this.maxAge);
    return this.backend.purge(cutoff);
  }

  /**
   * Calculate the cutoff date for the current retention policy.
   */
  getCutoffDate(): Date {
    return new Date(Date.now() - this.maxAge);
  }
}
