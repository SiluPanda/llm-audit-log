/**
 * PII detection and redaction utilities.
 */
import type { AuditEntry, PiiMatch } from './types.js';

/** Default placeholder for redacted values. */
const REDACTED = '[REDACTED]';

/** PII detection patterns. */
const PII_PATTERNS: Array<{ type: PiiMatch['type']; pattern: RegExp }> = [
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    // Credit card must come before phone to avoid partial matches
    type: 'creditCard',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  },
  {
    type: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    type: 'ipAddress',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
];

/**
 * Detect PII patterns in a text string.
 *
 * @param text - The text to scan for PII.
 * @returns Array of PII matches found.
 */
export function detectPii(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const { type, pattern } of PII_PATTERNS) {
    // Reset regex state
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      matches.push({
        type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/**
 * Redact PII patterns in a string by replacing them with [REDACTED].
 *
 * @param text - The text to redact.
 * @param placeholder - The replacement string. Defaults to '[REDACTED]'.
 * @param customPatterns - Additional regex patterns to redact.
 * @returns The redacted text.
 */
export function redactString(
  text: string,
  placeholder: string = REDACTED,
  customPatterns?: RegExp[],
): string {
  // Collect all matches first, then apply longest-first to avoid partial overlaps
  const allMatches: Array<{ start: number; end: number }> = [];

  for (const { pattern } of PII_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      allMatches.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (customPatterns) {
    for (const pattern of customPatterns) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        allMatches.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }

  if (allMatches.length === 0) return text;

  // Sort by start ascending, then by length descending (longer matches first)
  allMatches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Merge overlapping ranges, keeping the longest span
  const merged: Array<{ start: number; end: number }> = [];
  for (const m of allMatches) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) {
      last.end = Math.max(last.end, m.end);
    } else {
      merged.push({ start: m.start, end: m.end });
    }
  }

  // Build result by replacing merged ranges
  let result = '';
  let pos = 0;
  for (const { start, end } of merged) {
    result += text.slice(pos, start) + placeholder;
    pos = end;
  }
  result += text.slice(pos);

  return result;
}

/**
 * Recursively redact PII in a value (string, array, or object).
 */
function redactValue(
  value: unknown,
  placeholder: string,
  customPatterns?: RegExp[],
): unknown {
  if (typeof value === 'string') {
    return redactString(value, placeholder, customPatterns);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, placeholder, customPatterns));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactValue(val, placeholder, customPatterns);
    }
    return result;
  }
  return value;
}

/**
 * Get a nested field value by dot-notation path.
 */
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a nested field value by dot-notation path.
 */
function setNestedField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === null || current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Redact PII fields in an audit entry.
 *
 * If piiFields are specified, those fields are fully redacted.
 * If redactPii is true, all string fields are scanned for PII patterns.
 *
 * @param entry - The audit entry to redact (mutated in place).
 * @param options - Redaction options.
 * @returns The redacted entry.
 */
export function redactFields(
  entry: AuditEntry,
  options: {
    piiFields?: string[];
    redactPatterns?: boolean;
    customPatterns?: RegExp[];
    placeholder?: string;
  } = {},
): AuditEntry {
  const {
    piiFields = [],
    redactPatterns = false,
    customPatterns,
    placeholder = REDACTED,
  } = options;

  const entryObj = entry as unknown as Record<string, unknown>;

  // Redact specific PII fields entirely
  for (const field of piiFields) {
    const value = getNestedField(entryObj, field);
    if (value !== undefined) {
      if (typeof value === 'string') {
        setNestedField(entryObj, field, placeholder);
      } else {
        setNestedField(entryObj, field, redactValue(value, placeholder, customPatterns));
      }
    }
  }

  // Redact PII patterns across all string fields
  if (redactPatterns) {
    if (typeof entry.input === 'string') {
      entry.input = redactString(entry.input, placeholder, customPatterns);
    } else if (entry.input !== null && entry.input !== undefined) {
      entry.input = redactValue(entry.input, placeholder, customPatterns);
    }

    if (typeof entry.output === 'string') {
      entry.output = redactString(entry.output, placeholder, customPatterns);
    } else if (entry.output !== null && entry.output !== undefined) {
      entry.output = redactValue(entry.output, placeholder, customPatterns);
    }

    // Redact metadata values
    if (entry.metadata) {
      entry.metadata = redactValue(entry.metadata, placeholder, customPatterns) as Record<string, unknown>;
    }
  }

  return entry;
}
