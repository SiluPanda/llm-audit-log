/**
 * HMAC-SHA256 integrity chain for tamper-evident audit logging.
 */
import { createHmac } from 'node:crypto';
import type { AuditEntry } from './types.js';

/**
 * Produce a canonical JSON string with keys sorted at every level.
 * This ensures deterministic serialization for HMAC computation.
 */
export function canonicalJSON(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const items = obj.map((item) => canonicalJSON(item));
    return '[' + items.join(',') + ']';
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalJSON(val);
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Strip HMAC-related fields from an entry before hashing.
 */
function stripHmacFields(entry: AuditEntry): Record<string, unknown> {
  const copy = { ...entry } as Record<string, unknown>;
  delete copy.hmac;
  delete copy.hmacSeed;
  return copy;
}

/**
 * Compute the HMAC-SHA256 for an audit entry.
 *
 * @param entry - The audit entry (hmac and hmacSeed fields are excluded from computation).
 * @param secret - The HMAC secret key.
 * @param previousHmac - The previous entry's HMAC, or undefined/null for the first entry.
 * @param seed - The seed value for the first entry in the chain.
 * @returns The hex-encoded HMAC string.
 */
export function computeHmac(
  entry: AuditEntry,
  secret: string | Buffer,
  previousHmac?: string | null,
  seed?: string,
): string {
  const stripped = stripHmacFields(entry);
  const content = canonicalJSON(stripped);

  let prefix: string;
  if (previousHmac) {
    prefix = previousHmac;
  } else if (seed) {
    prefix = seed;
  } else {
    prefix = '';
  }

  const hmac = createHmac('sha256', secret);
  hmac.update(prefix + content);
  return hmac.digest('hex');
}

/**
 * Verify the integrity of an HMAC chain.
 *
 * @param entries - The ordered array of audit entries.
 * @param secret - The HMAC secret key.
 * @returns An object describing whether the chain is valid, and where it first breaks.
 */
export function verifyChain(
  entries: AuditEntry[],
  secret: string | Buffer,
): { valid: boolean; brokenAt: number; expectedHmac?: string; actualHmac?: string } {
  if (entries.length === 0) {
    return { valid: true, brokenAt: -1 };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let expected: string;

    if (i === 0) {
      const seed = entry.hmacSeed || '';
      expected = computeHmac(entry, secret, null, seed);
    } else {
      const prevHmac = entries[i - 1].hmac;
      expected = computeHmac(entry, secret, prevHmac);
    }

    if (expected !== entry.hmac) {
      return {
        valid: false,
        brokenAt: i,
        expectedHmac: expected,
        actualHmac: entry.hmac,
      };
    }
  }

  return { valid: true, brokenAt: -1 };
}
