import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AuditLogger } from '../logger.js';
import type { RecordInput } from '../types.js';

function makeInput(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    model: 'gpt-4o',
    provider: 'openai',
    input: 'What is 2+2?',
    output: '2+2 equals 4',
    tokens: { input: 10, output: 8 },
    latencyMs: 500,
    ...overrides,
  };
}

let tmpDir: string;
let storagePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-logger-'));
  storagePath = path.join(tmpDir, 'audit.jsonl');
});

afterEach(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AuditLogger', () => {
  describe('constructor and state', () => {
    it('should create a logger with default options', () => {
      const logger = new AuditLogger({ storagePath });
      expect(logger.active).toBe(true);
      expect(logger.entryCount).toBe(0);
    });

    it('should create a logger with custom options', () => {
      const logger = new AuditLogger({
        storagePath,
        hmacSecret: 'test-secret',
        redactPii: true,
        defaultPiiFields: ['input'],
      });
      expect(logger.active).toBe(true);
    });
  });

  describe('log', () => {
    it('should log an entry and return a complete AuditEntry', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput());

      expect(entry.id).toBeTruthy();
      expect(entry.v).toBe(1);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.model).toBe('gpt-4o');
      expect(entry.provider).toBe('openai');
      expect(entry.input).toBe('What is 2+2?');
      expect(entry.output).toBe('2+2 equals 4');
      expect(entry.tokens.input).toBe(10);
      expect(entry.tokens.output).toBe(8);
      expect(entry.tokens.total).toBe(18);
      expect(entry.latencyMs).toBe(500);
      expect(entry.cost).toBeNull();
      expect(entry.toolCalls).toBeNull();
      expect(entry.error).toBeNull();

      await logger.close();
    });

    it('should auto-generate UUID for id', async () => {
      const logger = new AuditLogger({ storagePath });
      const e1 = await logger.log(makeInput());
      const e2 = await logger.log(makeInput());

      expect(e1.id).toBeTruthy();
      expect(e2.id).toBeTruthy();
      expect(e1.id).not.toBe(e2.id);

      await logger.close();
    });

    it('should auto-generate ISO timestamp', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput());

      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();

      await logger.close();
    });

    it('should compute total tokens', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({
        tokens: { input: 100, output: 50 },
      }));

      expect(entry.tokens.total).toBe(150);

      await logger.close();
    });

    it('should apply default PII fields', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput());

      expect(entry.piiFields).toContain('input');
      expect(entry.piiFields).toContain('output');

      await logger.close();
    });

    it('should merge custom PII fields with defaults', async () => {
      const logger = new AuditLogger({
        storagePath,
        defaultPiiFields: ['input'],
      });

      const entry = await logger.log(makeInput({
        piiFields: ['metadata.email'],
      }));

      expect(entry.piiFields).toContain('input');
      expect(entry.piiFields).toContain('metadata.email');

      await logger.close();
    });

    it('should set actor when provided', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({ actor: 'user:alice' }));

      expect(entry.actor).toBe('user:alice');

      await logger.close();
    });

    it('should set actor to null when not provided', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput());

      expect(entry.actor).toBeNull();

      await logger.close();
    });

    it('should include metadata', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({
        metadata: { session: 'abc', env: 'test' },
      }));

      expect(entry.metadata).toEqual({ session: 'abc', env: 'test' });

      await logger.close();
    });

    it('should include tool calls', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({
        toolCalls: [{ name: 'search', arguments: { q: 'test' } }],
      }));

      expect(entry.toolCalls).toHaveLength(1);
      expect(entry.toolCalls![0].name).toBe('search');

      await logger.close();
    });

    it('should include error details', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({
        error: { message: 'Rate limit exceeded', code: 'rate_limit' },
      }));

      expect(entry.error).toEqual({ message: 'Rate limit exceeded', code: 'rate_limit' });

      await logger.close();
    });

    it('should include cost', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput({ cost: 0.0385 }));

      expect(entry.cost).toBe(0.0385);

      await logger.close();
    });

    it('should increment entry count', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput());
      expect(logger.entryCount).toBe(1);

      await logger.log(makeInput());
      expect(logger.entryCount).toBe(2);

      await logger.close();
    });

    it('should throw when logger is closed', async () => {
      const logger = new AuditLogger({ storagePath });
      await logger.close();

      await expect(logger.log(makeInput())).rejects.toThrow('AuditLogger is closed');
    });

    it('should persist entries to JSONL file', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput({ actor: 'user:alice' }));
      await logger.log(makeInput({ actor: 'user:bob' }));

      const content = fs.readFileSync(storagePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).actor).toBe('user:alice');
      expect(JSON.parse(lines[1]).actor).toBe('user:bob');

      await logger.close();
    });
  });

  describe('HMAC integrity', () => {
    const secret = 'test-hmac-secret-key';

    it('should compute HMAC when secret is provided', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });
      const entry = await logger.log(makeInput());

      expect(entry.hmac).toBeTruthy();
      expect(typeof entry.hmac).toBe('string');
      expect(entry.hmac!.length).toBe(64);

      await logger.close();
    });

    it('should set hmacSeed on the first entry', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });
      const entry = await logger.log(makeInput());

      expect(entry.hmacSeed).toBeTruthy();

      await logger.close();
    });

    it('should not set hmacSeed on subsequent entries', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });
      await logger.log(makeInput());
      const entry2 = await logger.log(makeInput());

      expect(entry2.hmacSeed).toBeUndefined();

      await logger.close();
    });

    it('should chain HMACs between entries', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });
      const e1 = await logger.log(makeInput());
      const e2 = await logger.log(makeInput());

      expect(e1.hmac).toBeTruthy();
      expect(e2.hmac).toBeTruthy();
      expect(e1.hmac).not.toBe(e2.hmac);

      await logger.close();
    });

    it('should not compute HMAC when no secret', async () => {
      const logger = new AuditLogger({ storagePath });
      const entry = await logger.log(makeInput());

      expect(entry.hmac).toBeUndefined();

      await logger.close();
    });

    it('should use provided seed', async () => {
      const logger = new AuditLogger({
        storagePath,
        hmacSecret: secret,
        hmacSeed: 'custom-seed',
      });
      const entry = await logger.log(makeInput());

      expect(entry.hmacSeed).toBe('custom-seed');

      await logger.close();
    });
  });

  describe('PII redaction', () => {
    it('should redact PII when redactPii is true', async () => {
      const logger = new AuditLogger({
        storagePath,
        redactPii: true,
        defaultPiiFields: [],
      });

      const entry = await logger.log(makeInput({
        input: 'My email is jane@example.com',
        output: 'Your SSN is 123-45-6789',
      }));

      expect(entry.input).not.toContain('jane@example.com');
      expect(entry.output).not.toContain('123-45-6789');

      await logger.close();
    });

    it('should not redact when redactPii is false', async () => {
      const logger = new AuditLogger({
        storagePath,
        redactPii: false,
      });

      const entry = await logger.log(makeInput({
        input: 'My email is jane@example.com',
      }));

      expect(entry.input).toContain('jane@example.com');

      await logger.close();
    });

    it('should apply custom PII patterns', async () => {
      const logger = new AuditLogger({
        storagePath,
        redactPii: true,
        piiPatterns: [/MRN-\d+/g],
        defaultPiiFields: [],
      });

      const entry = await logger.log(makeInput({
        input: 'Patient MRN-12345',
      }));

      expect(entry.input).not.toContain('MRN-12345');

      await logger.close();
    });
  });

  describe('query', () => {
    it('should query entries by actor', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput({ actor: 'user:alice' }));
      await logger.log(makeInput({ actor: 'user:bob' }));
      await logger.log(makeInput({ actor: 'user:alice' }));

      const results = await logger.query({ actor: 'user:alice' });
      expect(results).toHaveLength(2);

      await logger.close();
    });

    it('should query all entries with empty filters', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput());
      await logger.log(makeInput());

      const results = await logger.query();
      expect(results).toHaveLength(2);

      await logger.close();
    });
  });

  describe('verify', () => {
    const secret = 'verify-secret';

    it('should verify a valid chain', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });

      await logger.log(makeInput());
      await logger.log(makeInput());
      await logger.log(makeInput());

      const result = await logger.verify();
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(3);
      expect(result.firstInvalidIndex).toBe(-1);

      await logger.close();
    });

    it('should detect tampering', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });

      await logger.log(makeInput());
      await logger.log(makeInput());
      await logger.close();

      // Tamper with the file
      const content = fs.readFileSync(storagePath, 'utf-8');
      const lines = content.trim().split('\n');
      const entry = JSON.parse(lines[0]);
      entry.input = 'TAMPERED';
      lines[0] = JSON.stringify(entry);
      fs.writeFileSync(storagePath, lines.join('\n') + '\n');

      const logger2 = new AuditLogger({ storagePath, hmacSecret: secret });
      const result = await logger2.verify();
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);

      await logger2.close();
    });

    it('should report error when no HMAC secret configured', async () => {
      const logger = new AuditLogger({ storagePath });
      const result = await logger.verify();

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not configured');

      await logger.close();
    });

    it('should verify empty chain as valid', async () => {
      const logger = new AuditLogger({ storagePath, hmacSecret: secret });
      const result = await logger.verify();

      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(0);

      await logger.close();
    });
  });

  describe('export', () => {
    it('should export as JSON', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput());
      await logger.log(makeInput());

      const exported = await logger.export('json');
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(2);

      await logger.close();
    });

    it('should export as CSV', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput({ actor: 'user:alice' }));

      const exported = await logger.export('csv');
      expect(exported).toContain('id,v,timestamp');
      expect(exported).toContain('user:alice');

      await logger.close();
    });

    it('should export as JSONL', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput());
      await logger.log(makeInput());

      const exported = await logger.export('jsonl');
      const lines = exported.trim().split('\n');
      expect(lines).toHaveLength(2);

      await logger.close();
    });

    it('should export with filters', async () => {
      const logger = new AuditLogger({ storagePath });

      await logger.log(makeInput({ actor: 'user:alice' }));
      await logger.log(makeInput({ actor: 'user:bob' }));

      const exported = await logger.export('json', { actor: 'user:bob' });
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(1);

      await logger.close();
    });
  });

  describe('purge', () => {
    it('should purge entries before a given date', async () => {
      const logger = new AuditLogger({ storagePath });

      // Log entries — they all get "now" timestamps
      // We need to manually write old entries
      await logger.close();

      // Write entries manually with specific timestamps
      const lines = [
        JSON.stringify(makeEntry('2025-01-01T00:00:00.000Z', 'old-1')),
        JSON.stringify(makeEntry('2025-06-01T00:00:00.000Z', 'old-2')),
        JSON.stringify(makeEntry('2026-06-01T00:00:00.000Z', 'new-1')),
      ].join('\n') + '\n';
      fs.writeFileSync(storagePath, lines);

      const logger2 = new AuditLogger({ storagePath });
      const purged = await logger2.purge(new Date('2026-01-01'));

      expect(purged).toBe(2);

      const remaining = await logger2.query({ excludeTombstones: false });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('new-1');

      await logger2.close();
    });
  });

  describe('close', () => {
    it('should set active to false after close', async () => {
      const logger = new AuditLogger({ storagePath });
      expect(logger.active).toBe(true);

      await logger.close();
      expect(logger.active).toBe(false);
    });

    it('should be idempotent', async () => {
      const logger = new AuditLogger({ storagePath });
      await logger.close();
      await logger.close(); // should not throw
      expect(logger.active).toBe(false);
    });
  });

  describe('chain resumption', () => {
    it('should resume HMAC chain from existing entries', async () => {
      const secret = 'resume-secret';

      // First logger session
      const logger1 = new AuditLogger({ storagePath, hmacSecret: secret });
      await logger1.log(makeInput());
      await logger1.log(makeInput());
      await logger1.close();

      // Second logger session
      const logger2 = new AuditLogger({ storagePath, hmacSecret: secret });
      await logger2.log(makeInput());

      // Verify the complete chain
      const result = await logger2.verify();
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(3);

      await logger2.close();
    });
  });
});

function makeEntry(timestamp: string, id: string): Record<string, unknown> {
  return {
    id,
    v: 1,
    timestamp,
    actor: null,
    model: 'gpt-4o',
    provider: 'openai',
    input: 'test',
    output: 'test',
    tokens: { input: 10, output: 5, total: 15 },
    latencyMs: 500,
    cost: null,
    toolCalls: null,
    error: null,
    metadata: {},
    piiFields: ['input', 'output'],
  };
}
