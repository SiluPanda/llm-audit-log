import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { JsonlStorage } from '../storage/jsonl.js';
import type { AuditEntry } from '../types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    v: 1,
    timestamp: new Date().toISOString(),
    actor: 'user:test@example.com',
    model: 'gpt-4o',
    provider: 'openai',
    input: 'Hello',
    output: 'Hi there',
    tokens: { input: 10, output: 5, total: 15 },
    latencyMs: 500,
    cost: 0.01,
    toolCalls: null,
    error: null,
    metadata: {},
    piiFields: ['input', 'output'],
    ...overrides,
  };
}

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  filePath = path.join(tmpDir, 'audit.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('JsonlStorage', () => {
  describe('init', () => {
    it('should create the file if it does not exist', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should create directories recursively', async () => {
      const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'audit.jsonl');
      const storage = new JsonlStorage({ filePath: deepPath });
      await storage.init();
      expect(fs.existsSync(deepPath)).toBe(true);
    });

    it('should not overwrite existing file', async () => {
      fs.writeFileSync(filePath, '{"existing":true}\n');
      const storage = new JsonlStorage({ filePath });
      await storage.init();
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('existing');
    });
  });

  describe('append', () => {
    it('should append a single entry', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      const entry = makeEntry({ id: 'e1' });
      await storage.append(entry);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).id).toBe('e1');
    });

    it('should append multiple entries as separate lines', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));
      await storage.append(makeEntry({ id: 'e3' }));

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('should preserve entry data through serialization', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      const entry = makeEntry({
        id: 'e1',
        metadata: { key: 'value', nested: { a: 1 } },
        toolCalls: [{ name: 'search', arguments: { q: 'test' } }],
      });
      await storage.append(entry);

      const entries = await storage.read();
      expect(entries[0].id).toBe('e1');
      expect(entries[0].metadata).toEqual({ key: 'value', nested: { a: 1 } });
      expect(entries[0].toolCalls).toEqual([{ name: 'search', arguments: { q: 'test' } }]);
    });
  });

  describe('read', () => {
    it('should return empty array for empty file', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      const entries = await storage.read();
      expect(entries).toEqual([]);
    });

    it('should read all entries from the file', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));

      const entries = await storage.read();
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('e1');
      expect(entries[1].id).toBe('e2');
    });

    it('should skip malformed lines', async () => {
      fs.writeFileSync(filePath, '{"id":"e1","v":1}\nBAD LINE\n{"id":"e2","v":1}\n');
      const storage = new JsonlStorage({ filePath });

      const entries = await storage.read();
      expect(entries).toHaveLength(2);
    });
  });

  describe('query', () => {
    it('should filter by actor', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', actor: 'user:alice' }));
      await storage.append(makeEntry({ id: 'e2', actor: 'user:bob' }));
      await storage.append(makeEntry({ id: 'e3', actor: 'user:alice' }));

      const results = await storage.query({ actor: 'user:alice' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.actor === 'user:alice')).toBe(true);
    });

    it('should filter by model', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', model: 'gpt-4o' }));
      await storage.append(makeEntry({ id: 'e2', model: 'claude-3' }));

      const results = await storage.query({ model: 'gpt-4o' });
      expect(results).toHaveLength(1);
      expect(results[0].model).toBe('gpt-4o');
    });

    it('should filter by date range', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', timestamp: '2026-01-01T00:00:00.000Z' }));
      await storage.append(makeEntry({ id: 'e2', timestamp: '2026-06-15T00:00:00.000Z' }));
      await storage.append(makeEntry({ id: 'e3', timestamp: '2026-12-31T00:00:00.000Z' }));

      const results = await storage.query({
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-09-01'),
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('e2');
    });

    it('should apply limit', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      for (let i = 0; i < 10; i++) {
        await storage.append(makeEntry({ id: `e${i}` }));
      }

      const results = await storage.query({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('should apply offset', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      for (let i = 0; i < 5; i++) {
        await storage.append(makeEntry({ id: `e${i}` }));
      }

      const results = await storage.query({ offset: 2 });
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('e2');
    });

    it('should apply limit and offset together', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      for (let i = 0; i < 10; i++) {
        await storage.append(makeEntry({ id: `e${i}` }));
      }

      const results = await storage.query({ offset: 3, limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('e3');
      expect(results[1].id).toBe('e4');
    });

    it('should exclude tombstones by default', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2', tombstone: true }));
      await storage.append(makeEntry({ id: 'e3' }));

      const results = await storage.query({});
      expect(results).toHaveLength(2);
      expect(results.every((e) => !e.tombstone)).toBe(true);
    });

    it('should include tombstones when excludeTombstones is false', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2', tombstone: true }));

      const results = await storage.query({ excludeTombstones: false });
      expect(results).toHaveLength(2);
    });

    it('should filter by tags in metadata', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', metadata: { tags: ['prod', 'critical'] } }));
      await storage.append(makeEntry({ id: 'e2', metadata: { tags: ['dev'] } }));
      await storage.append(makeEntry({ id: 'e3', metadata: { tags: ['prod'] } }));

      const results = await storage.query({ tags: ['prod'] });
      expect(results).toHaveLength(2);
    });
  });

  describe('purge', () => {
    it('should remove entries older than the cutoff', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'old', timestamp: '2025-01-01T00:00:00.000Z' }));
      await storage.append(makeEntry({ id: 'new', timestamp: '2026-06-01T00:00:00.000Z' }));

      const purged = await storage.purge(new Date('2026-01-01'));
      expect(purged).toBe(1);

      const remaining = await storage.read();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('new');
    });

    it('should return 0 when nothing to purge', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', timestamp: '2026-06-01T00:00:00.000Z' }));

      const purged = await storage.purge(new Date('2025-01-01'));
      expect(purged).toBe(0);
    });

    it('should purge all entries when all are old', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', timestamp: '2024-01-01T00:00:00.000Z' }));
      await storage.append(makeEntry({ id: 'e2', timestamp: '2024-06-01T00:00:00.000Z' }));

      const purged = await storage.purge(new Date('2025-01-01'));
      expect(purged).toBe(2);

      const remaining = await storage.read();
      expect(remaining).toHaveLength(0);
    });
  });

  describe('export', () => {
    it('should export as JSON', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));

      const exported = await storage.export('json');
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('should export as CSV', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', actor: 'user:alice' }));

      const exported = await storage.export('csv');
      expect(exported).toContain('id,v,timestamp');
      expect(exported).toContain('e1');
      expect(exported).toContain('user:alice');
    });

    it('should export as JSONL', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));

      const exported = await storage.export('jsonl');
      const lines = exported.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).id).toBe('e1');
      expect(JSON.parse(lines[1]).id).toBe('e2');
    });

    it('should export with filters', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1', actor: 'user:alice' }));
      await storage.append(makeEntry({ id: 'e2', actor: 'user:bob' }));

      const exported = await storage.export('json', { actor: 'user:alice' });
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('e1');
    });

    it('should return empty for no entries', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      const exported = await storage.export('json');
      expect(JSON.parse(exported)).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return 0 for empty storage', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      expect(await storage.count()).toBe(0);
    });

    it('should return correct count', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry());
      await storage.append(makeEntry());
      await storage.append(makeEntry());

      expect(await storage.count()).toBe(3);
    });
  });

  describe('size', () => {
    it('should return 0 for empty file', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      expect(await storage.size()).toBe(0);
    });

    it('should return non-zero size after appending', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry());

      const size = await storage.size();
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('file rotation', () => {
    it('should rotate when file exceeds maxFileSize', async () => {
      // Use a very small max size to trigger rotation
      const storage = new JsonlStorage({
        filePath,
        maxFileSize: 100, // 100 bytes
        autoRotate: true,
      });
      await storage.init();

      // Each entry is ~200+ bytes, so first entry should trigger rotation on the second
      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));

      // Check that rotated file exists
      const files = fs.readdirSync(tmpDir);
      const rotatedFiles = files.filter((f) => f.match(/audit\.jsonl\.\d+$/));
      expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should read from all files including rotated', async () => {
      const storage = new JsonlStorage({
        filePath,
        maxFileSize: 100,
        autoRotate: true,
      });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));
      await storage.append(makeEntry({ id: 'e3' }));

      // Query should find all entries across files
      const entries = await storage.query({ excludeTombstones: false });
      const ids = entries.map((e) => e.id);
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
      expect(ids).toContain('e3');
    });

    it('should not rotate when autoRotate is false', async () => {
      const storage = new JsonlStorage({
        filePath,
        maxFileSize: 100,
        autoRotate: false,
      });
      await storage.init();

      await storage.append(makeEntry({ id: 'e1' }));
      await storage.append(makeEntry({ id: 'e2' }));

      const files = fs.readdirSync(tmpDir);
      const rotatedFiles = files.filter((f) => f.match(/audit\.jsonl\.\d+$/));
      expect(rotatedFiles).toHaveLength(0);
    });

    it('should read rotated files in chronological order', async () => {
      const storage = new JsonlStorage({
        filePath,
        maxFileSize: 50, // very small to force rotation on each entry
        autoRotate: true,
      });
      await storage.init();

      const entry1 = makeEntry({ id: 'e1', timestamp: '2025-01-01T00:00:00.000Z' });
      const entry2 = makeEntry({ id: 'e2', timestamp: '2025-01-02T00:00:00.000Z' });
      const entry3 = makeEntry({ id: 'e3', timestamp: '2025-01-03T00:00:00.000Z' });

      await storage.append(entry1);
      await storage.append(entry2);
      await storage.append(entry3);

      const all = await storage.query({});
      // First entry should be the oldest, last should be the newest
      expect(all[0].timestamp).toBe('2025-01-01T00:00:00.000Z');
      expect(all[all.length - 1].timestamp).toBe('2025-01-03T00:00:00.000Z');
    });
  });

  describe('CSV escaping', () => {
    it('should escape commas in CSV output', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({
        id: 'e1',
        input: 'Hello, world',
      }));

      const csv = await storage.export('csv');
      expect(csv).toContain('"Hello, world"');
    });

    it('should escape quotes in CSV output', async () => {
      const storage = new JsonlStorage({ filePath });
      await storage.init();

      await storage.append(makeEntry({
        id: 'e1',
        input: 'He said "hello"',
      }));

      const csv = await storage.export('csv');
      expect(csv).toContain('"He said ""hello"""');
    });
  });
});
