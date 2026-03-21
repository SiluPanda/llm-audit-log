import { describe, it, expect } from 'vitest';
import { toJson, toJsonl, toCsv } from '../export.js';
import type { AuditEntry } from '../types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'test-id',
    v: 1,
    timestamp: '2026-03-19T10:00:00.000Z',
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

describe('toJson', () => {
  it('should format entries as a JSON array', () => {
    const entries = [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })];
    const result = toJson(entries);
    const parsed = JSON.parse(result);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('e1');
    expect(parsed[1].id).toBe('e2');
  });

  it('should produce pretty-printed JSON', () => {
    const entries = [makeEntry()];
    const result = toJson(entries);
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('should handle empty array', () => {
    const result = toJson([]);
    expect(JSON.parse(result)).toEqual([]);
  });

  it('should preserve all entry fields', () => {
    const entry = makeEntry({
      toolCalls: [{ name: 'fn', arguments: { x: 1 } }],
      error: { message: 'fail', code: 'err' },
      metadata: { key: 'val' },
      hmac: 'abc123',
    });
    const result = toJson([entry]);
    const parsed = JSON.parse(result)[0];

    expect(parsed.toolCalls).toEqual([{ name: 'fn', arguments: { x: 1 } }]);
    expect(parsed.error).toEqual({ message: 'fail', code: 'err' });
    expect(parsed.metadata).toEqual({ key: 'val' });
    expect(parsed.hmac).toBe('abc123');
  });
});

describe('toJsonl', () => {
  it('should format each entry on a separate line', () => {
    const entries = [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })];
    const result = toJsonl(entries);
    const lines = result.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('e1');
    expect(JSON.parse(lines[1]).id).toBe('e2');
  });

  it('should end with a newline', () => {
    const result = toJsonl([makeEntry()]);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('should return empty string for empty array', () => {
    expect(toJsonl([])).toBe('');
  });

  it('should produce compact JSON per line', () => {
    const result = toJsonl([makeEntry()]);
    const lines = result.trim().split('\n');
    // Each line should be a single line of JSON (no internal newlines)
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toBeTruthy();
  });
});

describe('toCsv', () => {
  it('should include header row', () => {
    const entries = [makeEntry()];
    const result = toCsv(entries);
    const lines = result.trim().split('\n');

    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('timestamp');
    expect(lines[0]).toContain('model');
    expect(lines[0]).toContain('provider');
  });

  it('should have one data row per entry', () => {
    const entries = [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })];
    const result = toCsv(entries);
    const lines = result.trim().split('\n');

    expect(lines).toHaveLength(3); // 1 header + 2 data rows
  });

  it('should flatten token counts', () => {
    const entries = [makeEntry({ tokens: { input: 100, output: 50, total: 150 } })];
    const result = toCsv(entries);

    expect(result).toContain('100');
    expect(result).toContain('50');
    expect(result).toContain('150');
  });

  it('should handle null cost', () => {
    const entries = [makeEntry({ cost: null })];
    const result = toCsv(entries);
    const lines = result.trim().split('\n');
    // Cost column should be empty for null
    expect(lines.length).toBe(2);
  });

  it('should escape commas in values', () => {
    const entries = [makeEntry({ input: 'Hello, world' })];
    const result = toCsv(entries);
    expect(result).toContain('"Hello, world"');
  });

  it('should escape quotes in values', () => {
    const entries = [makeEntry({ input: 'He said "hi"' })];
    const result = toCsv(entries);
    expect(result).toContain('"He said ""hi"""');
  });

  it('should return empty string for empty array', () => {
    expect(toCsv([])).toBe('');
  });

  it('should include tombstone column', () => {
    const entries = [makeEntry({ tombstone: true })];
    const result = toCsv(entries);
    expect(result).toContain('true');
  });

  it('should handle entries with complex metadata', () => {
    const entries = [makeEntry({
      metadata: { session: 'abc', nested: { key: 'val' } },
    })];
    const result = toCsv(entries);
    expect(result).toContain('session');
  });

  it('should handle null toolCalls and error', () => {
    const entries = [makeEntry({ toolCalls: null, error: null })];
    const result = toCsv(entries);
    const lines = result.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('should handle non-string input/output', () => {
    const entries = [makeEntry({
      input: [{ role: 'user', content: 'hello' }],
      output: { role: 'assistant', content: 'hi' },
    })];
    const result = toCsv(entries);
    // Should be JSON-stringified
    expect(result).toContain('role');
  });
});
