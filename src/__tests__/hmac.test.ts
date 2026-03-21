import { describe, it, expect } from 'vitest';
import { computeHmac, verifyChain, canonicalJSON } from '../hmac.js';
import type { AuditEntry } from '../types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'test-id-1',
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

describe('canonicalJSON', () => {
  it('should sort object keys alphabetically', () => {
    const result = canonicalJSON({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('should handle nested objects with sorted keys', () => {
    const result = canonicalJSON({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('should handle arrays preserving order', () => {
    const result = canonicalJSON([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('should handle null', () => {
    expect(canonicalJSON(null)).toBe('null');
  });

  it('should handle undefined', () => {
    expect(canonicalJSON(undefined)).toBe(undefined);
  });

  it('should handle strings', () => {
    expect(canonicalJSON('hello')).toBe('"hello"');
  });

  it('should handle numbers', () => {
    expect(canonicalJSON(42)).toBe('42');
  });

  it('should handle booleans', () => {
    expect(canonicalJSON(true)).toBe('true');
    expect(canonicalJSON(false)).toBe('false');
  });

  it('should handle empty objects', () => {
    expect(canonicalJSON({})).toBe('{}');
  });

  it('should handle empty arrays', () => {
    expect(canonicalJSON([])).toBe('[]');
  });

  it('should handle mixed nested structures', () => {
    const result = canonicalJSON({
      c: [{ b: 2, a: 1 }],
      a: null,
    });
    expect(result).toBe('{"a":null,"c":[{"a":1,"b":2}]}');
  });

  it('should produce identical output regardless of key insertion order', () => {
    const a = canonicalJSON({ x: 1, y: 2, z: 3 });
    const b = canonicalJSON({ z: 3, x: 1, y: 2 });
    expect(a).toBe(b);
  });
});

describe('computeHmac', () => {
  const secret = 'test-secret-key-32-bytes-long!!!';

  it('should compute an HMAC for an entry with a seed', () => {
    const entry = makeEntry();
    const hmac = computeHmac(entry, secret, null, 'test-seed');
    expect(hmac).toBeTruthy();
    expect(typeof hmac).toBe('string');
    expect(hmac.length).toBe(64); // SHA-256 hex = 64 chars
  });

  it('should compute an HMAC for an entry with a previous HMAC', () => {
    const entry = makeEntry();
    const hmac = computeHmac(entry, secret, 'previous-hmac-value');
    expect(hmac).toBeTruthy();
    expect(hmac.length).toBe(64);
  });

  it('should produce different HMACs for different seeds', () => {
    const entry = makeEntry();
    const hmac1 = computeHmac(entry, secret, null, 'seed-1');
    const hmac2 = computeHmac(entry, secret, null, 'seed-2');
    expect(hmac1).not.toBe(hmac2);
  });

  it('should produce different HMACs for different secrets', () => {
    const entry = makeEntry();
    const hmac1 = computeHmac(entry, 'secret-1', null, 'seed');
    const hmac2 = computeHmac(entry, 'secret-2', null, 'seed');
    expect(hmac1).not.toBe(hmac2);
  });

  it('should produce different HMACs for different entries', () => {
    const entry1 = makeEntry({ id: 'id-1' });
    const entry2 = makeEntry({ id: 'id-2' });
    const hmac1 = computeHmac(entry1, secret, null, 'seed');
    const hmac2 = computeHmac(entry2, secret, null, 'seed');
    expect(hmac1).not.toBe(hmac2);
  });

  it('should produce consistent HMACs for the same input', () => {
    const entry = makeEntry();
    const hmac1 = computeHmac(entry, secret, null, 'seed');
    const hmac2 = computeHmac(entry, secret, null, 'seed');
    expect(hmac1).toBe(hmac2);
  });

  it('should not include hmac or hmacSeed fields in computation', () => {
    const entry1 = makeEntry();
    const entry2 = makeEntry({ hmac: 'some-hmac', hmacSeed: 'some-seed' });
    const hmac1 = computeHmac(entry1, secret, null, 'seed');
    const hmac2 = computeHmac(entry2, secret, null, 'seed');
    expect(hmac1).toBe(hmac2);
  });

  it('should chain from previous HMAC correctly', () => {
    const entry1 = makeEntry({ id: 'entry-1' });
    const entry2 = makeEntry({ id: 'entry-2' });

    const hmac1 = computeHmac(entry1, secret, null, 'seed');
    const hmac2 = computeHmac(entry2, secret, hmac1);

    expect(hmac2).toBeTruthy();
    // Changing entry1 should change hmac1 and therefore hmac2 if recomputed
    const modifiedEntry1 = makeEntry({ id: 'entry-1-modified' });
    const modifiedHmac1 = computeHmac(modifiedEntry1, secret, null, 'seed');
    const hmac2WithModified = computeHmac(entry2, secret, modifiedHmac1);
    expect(hmac2WithModified).not.toBe(hmac2);
  });
});

describe('verifyChain', () => {
  const secret = 'chain-verification-secret';
  const seed = 'test-chain-seed';

  function buildChain(count: number): AuditEntry[] {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < count; i++) {
      const entry = makeEntry({
        id: `entry-${i}`,
        timestamp: `2026-03-19T10:0${i}:00.000Z`,
      });

      if (i === 0) {
        entry.hmacSeed = seed;
        entry.hmac = computeHmac(entry, secret, null, seed);
      } else {
        entry.hmac = computeHmac(entry, secret, entries[i - 1].hmac);
      }

      entries.push(entry);
    }
    return entries;
  }

  it('should verify an empty chain as valid', () => {
    const result = verifyChain([], secret);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it('should verify a single entry chain', () => {
    const entries = buildChain(1);
    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it('should verify a multi-entry chain', () => {
    const entries = buildChain(5);
    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it('should detect modification of an entry', () => {
    const entries = buildChain(5);
    // Tamper with entry 2
    entries[2].input = 'TAMPERED INPUT';

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('should detect modification of the first entry', () => {
    const entries = buildChain(3);
    entries[0].model = 'tampered-model';

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('should detect deletion of a middle entry', () => {
    const entries = buildChain(5);
    // Remove entry 2
    entries.splice(2, 1);

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('should detect reordering of entries', () => {
    const entries = buildChain(5);
    // Swap entries 2 and 3
    [entries[2], entries[3]] = [entries[3], entries[2]];

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
  });

  it('should fail with wrong secret', () => {
    const entries = buildChain(3);
    const result = verifyChain(entries, 'wrong-secret');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('should detect tampered HMAC value', () => {
    const entries = buildChain(3);
    entries[1].hmac = 'forged-hmac-value';

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('should provide expected and actual HMAC on failure', () => {
    const entries = buildChain(3);
    entries[1].hmac = 'forged';

    const result = verifyChain(entries, secret);
    expect(result.valid).toBe(false);
    expect(result.expectedHmac).toBeTruthy();
    expect(result.actualHmac).toBe('forged');
  });
});
