import { describe, it, expect } from 'vitest';
import { detectPii, redactString, redactFields } from '../redact.js';
import type { AuditEntry } from '../types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'test-id-1',
    v: 1,
    timestamp: '2026-03-19T10:00:00.000Z',
    actor: 'user:test@example.com',
    model: 'gpt-4o',
    provider: 'openai',
    input: 'Hello, my email is jane@example.com',
    output: 'I see your email is jane@example.com',
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

describe('detectPii', () => {
  it('should detect email addresses', () => {
    const matches = detectPii('Contact us at hello@example.com for info');
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('email');
    expect(matches[0].value).toBe('hello@example.com');
  });

  it('should detect multiple email addresses', () => {
    const matches = detectPii('Send to alice@test.com and bob@test.com');
    const emails = matches.filter((m) => m.type === 'email');
    expect(emails).toHaveLength(2);
  });

  it('should detect phone numbers', () => {
    const matches = detectPii('Call me at 555-123-4567');
    const phones = matches.filter((m) => m.type === 'phone');
    expect(phones.length).toBeGreaterThanOrEqual(1);
    expect(phones.some((m) => m.value.includes('4567'))).toBe(true);
  });

  it('should detect SSNs', () => {
    const matches = detectPii('My SSN is 123-45-6789');
    const ssns = matches.filter((m) => m.type === 'ssn');
    expect(ssns).toHaveLength(1);
    expect(ssns[0].value).toBe('123-45-6789');
  });

  it('should detect credit card numbers', () => {
    const matches = detectPii('Card: 4111 1111 1111 1111');
    const cards = matches.filter((m) => m.type === 'creditCard');
    expect(cards).toHaveLength(1);
    expect(cards[0].value).toBe('4111 1111 1111 1111');
  });

  it('should detect credit card numbers with dashes', () => {
    const matches = detectPii('Card: 4111-1111-1111-1111');
    const cards = matches.filter((m) => m.type === 'creditCard');
    expect(cards).toHaveLength(1);
  });

  it('should detect IP addresses', () => {
    const matches = detectPii('Server at 192.168.1.100');
    const ips = matches.filter((m) => m.type === 'ipAddress');
    expect(ips).toHaveLength(1);
    expect(ips[0].value).toBe('192.168.1.100');
  });

  it('should detect multiple PII types in one string', () => {
    const text = 'Email: jane@test.com, SSN: 123-45-6789, IP: 10.0.0.1';
    const matches = detectPii(text);
    const types = new Set(matches.map((m) => m.type));
    expect(types.has('email')).toBe(true);
    expect(types.has('ssn')).toBe(true);
    expect(types.has('ipAddress')).toBe(true);
  });

  it('should return empty array for no PII', () => {
    const matches = detectPii('No personal data here');
    expect(matches).toHaveLength(0);
  });

  it('should include start and end positions', () => {
    const text = 'Email: hello@test.com';
    const matches = detectPii(text);
    expect(matches[0].start).toBe(7);
    expect(matches[0].end).toBe(21);
  });

  it('should sort matches by start position', () => {
    const text = 'IP: 10.0.0.1, Email: a@b.com';
    const matches = detectPii(text);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].start);
    }
  });
});

describe('redactString', () => {
  it('should redact email addresses', () => {
    const result = redactString('Email: jane@example.com');
    expect(result).toBe('Email: [REDACTED]');
    expect(result).not.toContain('jane@example.com');
  });

  it('should redact SSNs', () => {
    const result = redactString('SSN: 123-45-6789');
    expect(result).toBe('SSN: [REDACTED]');
  });

  it('should redact credit card numbers', () => {
    const result = redactString('Card: 4111 1111 1111 1111');
    expect(result).toBe('Card: [REDACTED]');
  });

  it('should redact IP addresses', () => {
    const result = redactString('IP: 192.168.1.1');
    expect(result).toBe('IP: [REDACTED]');
  });

  it('should redact multiple patterns', () => {
    const result = redactString('Email: a@b.com, SSN: 123-45-6789');
    expect(result).not.toContain('a@b.com');
    expect(result).not.toContain('123-45-6789');
  });

  it('should use custom placeholder', () => {
    const result = redactString('Email: a@b.com', '***');
    expect(result).toBe('Email: ***');
  });

  it('should apply custom patterns', () => {
    const customPattern = /CONFIDENTIAL/g;
    const result = redactString('This is CONFIDENTIAL data', '[REDACTED]', [customPattern]);
    expect(result).toBe('This is [REDACTED] data');
  });

  it('should not modify strings without PII', () => {
    const result = redactString('Hello, world');
    expect(result).toBe('Hello, world');
  });
});

describe('redactFields', () => {
  it('should redact specified PII fields', () => {
    const entry = makeEntry({
      input: 'My email is jane@test.com',
      output: 'Noted your email',
    });

    redactFields(entry, { piiFields: ['input'] });

    expect(entry.input).toBe('[REDACTED]');
    // output should NOT be redacted by field path
    expect(entry.output).toBe('Noted your email');
  });

  it('should redact nested field paths', () => {
    const entry = makeEntry({
      metadata: { customerEmail: 'secret@example.com', safe: 'ok' },
    });

    redactFields(entry, { piiFields: ['metadata.customerEmail'] });

    expect((entry.metadata as Record<string, unknown>).customerEmail).toBe('[REDACTED]');
    expect((entry.metadata as Record<string, unknown>).safe).toBe('ok');
  });

  it('should redact patterns when redactPatterns is true', () => {
    const entry = makeEntry({
      input: 'Email me at jane@example.com',
      output: 'Response with SSN 123-45-6789',
    });

    redactFields(entry, { redactPatterns: true });

    expect(entry.input).not.toContain('jane@example.com');
    expect(entry.output).not.toContain('123-45-6789');
  });

  it('should redact PII in nested objects', () => {
    const entry = makeEntry({
      input: { role: 'user', content: 'My email is test@test.com' },
    });

    redactFields(entry, { redactPatterns: true });

    const input = entry.input as Record<string, unknown>;
    expect(input.content).not.toContain('test@test.com');
  });

  it('should redact PII in arrays', () => {
    const entry = makeEntry({
      input: [
        { role: 'user', content: 'SSN is 123-45-6789' },
        { role: 'assistant', content: 'OK' },
      ],
    });

    redactFields(entry, { redactPatterns: true });

    const input = entry.input as Array<Record<string, unknown>>;
    expect(input[0].content).not.toContain('123-45-6789');
    expect(input[1].content).toBe('OK');
  });

  it('should use custom placeholder', () => {
    const entry = makeEntry({ input: 'Email: a@b.com' });
    redactFields(entry, { piiFields: ['input'], placeholder: '***' });
    expect(entry.input).toBe('***');
  });

  it('should apply custom patterns', () => {
    const entry = makeEntry({
      input: 'Patient ID: MRN-12345',
    });

    redactFields(entry, {
      redactPatterns: true,
      customPatterns: [/MRN-\d+/g],
    });

    expect(entry.input).not.toContain('MRN-12345');
  });

  it('should handle null input/output gracefully', () => {
    const entry = makeEntry({ input: null, output: null });
    expect(() => redactFields(entry, { redactPatterns: true })).not.toThrow();
  });

  it('should handle undefined metadata gracefully', () => {
    const entry = makeEntry();
    entry.metadata = undefined as unknown as Record<string, unknown>;
    expect(() => redactFields(entry, { redactPatterns: true })).not.toThrow();
  });

  it('should redact metadata values when redactPatterns is true', () => {
    const entry = makeEntry({
      metadata: { note: 'Contact: alice@test.com' },
    });

    redactFields(entry, { redactPatterns: true });

    expect((entry.metadata as Record<string, unknown>).note).not.toContain('alice@test.com');
  });

  it('should handle object values in PII fields', () => {
    const entry = makeEntry({
      input: {
        messages: [
          { role: 'user', content: 'My SSN is 111-22-3333' },
        ],
      },
    });

    redactFields(entry, { piiFields: ['input'] });

    // The entire input object's string values should be redacted
    const input = entry.input as Record<string, unknown>;
    const messages = input.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).not.toContain('111-22-3333');
  });
});
