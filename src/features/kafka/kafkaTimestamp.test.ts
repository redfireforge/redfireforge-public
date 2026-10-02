import { describe, it, expect } from 'vitest';
import {
  parseKafkaTimestamp,
  formatRelativeAge,
  formatAbsolute,
  formatKafkaDateTime,
  formatTimestampTooltip,
} from './kafkaTimestamp';

// Fixed "now" for deterministic tests: 2026-06-17T13:00:00.000Z
const NOW = new Date('2026-06-17T13:00:00.000Z');

// Helper: Date N seconds before NOW
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

describe('parseKafkaTimestamp', () => {
  it('returns null for undefined', () => {
    expect(parseKafkaTimestamp(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseKafkaTimestamp('')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseKafkaTimestamp('0')).toBeNull();
  });

  it('returns null for negative', () => {
    expect(parseKafkaTimestamp('-1000')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseKafkaTimestamp('not-a-number')).toBeNull();
  });

  it('parses a valid epoch ms string', () => {
    const ts = '1750161600000';
    const result = parseKafkaTimestamp(ts);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(1750161600000);
  });
});

describe('formatRelativeAge', () => {
  it('shows "just now" for < 10s ago', () => {
    expect(formatRelativeAge(new Date(NOW.getTime() - 5000), NOW)).toBe('just now');
  });

  it('shows seconds for 10–59s ago', () => {
    expect(formatRelativeAge(ago(30), NOW)).toBe('30s ago');
    expect(formatRelativeAge(ago(10), NOW)).toBe('10s ago');
    expect(formatRelativeAge(ago(59), NOW)).toBe('59s ago');
  });

  it('shows minutes for 1–59m ago', () => {
    expect(formatRelativeAge(ago(60), NOW)).toBe('1m ago');
    expect(formatRelativeAge(ago(7 * 60), NOW)).toBe('7m ago');
    expect(formatRelativeAge(ago(59 * 60), NOW)).toBe('59m ago');
  });

  it('shows hours for 1–23h ago', () => {
    expect(formatRelativeAge(ago(3600), NOW)).toBe('1h ago');
    expect(formatRelativeAge(ago(3 * 3600), NOW)).toBe('3h ago');
    expect(formatRelativeAge(ago(23 * 3600), NOW)).toBe('23h ago');
  });

  it('shows days for 1–29d ago', () => {
    expect(formatRelativeAge(ago(24 * 3600), NOW)).toBe('1d ago');
    expect(formatRelativeAge(ago(12 * 24 * 3600), NOW)).toBe('12d ago');
    expect(formatRelativeAge(ago(29 * 24 * 3600), NOW)).toBe('29d ago');
  });

  it('falls back to absolute for >= 30d ago', () => {
    const result = formatRelativeAge(ago(31 * 24 * 3600), NOW);
    // Should not contain "ago" for very old dates
    expect(result).not.toMatch(/ago$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles future timestamps gracefully (clock skew)', () => {
    const future = new Date(NOW.getTime() + 5000);
    const result = formatRelativeAge(future, NOW);
    // Returns absolute time for future dates
    expect(result).not.toBe('just now');
  });

  it('shows "just now" for exactly 0ms diff', () => {
    expect(formatRelativeAge(NOW, NOW)).toBe('just now');
  });
});

describe('formatKafkaDateTime', () => {
  it('shows the local date and time', () => {
    const d = new Date(2026, 5, 17, 9, 5, 6);
    expect(formatKafkaDateTime(d)).toBe('2026-06-17 09:05:06');
  });
});

describe('formatAbsolute', () => {
  it('returns a string with month, day, and time', () => {
    // 2026-06-17T13:00:00 UTC → local time (depends on TZ, just check format)
    const d = new Date('2026-06-17T09:25:06.938-04:00'); // EDT
    const result = formatAbsolute(d);
    // Should contain a month abbreviation and time-like pattern
    expect(result).toMatch(/\w{3} \d{1,2}, \d{2}:\d{2}:\d{2}/);
  });
});

describe('formatTimestampTooltip', () => {
  it('includes year, milliseconds', () => {
    const d = new Date('2026-06-17T09:25:06.938-04:00');
    const result = formatTimestampTooltip(d);
    expect(result).toContain('2026');
    expect(result).toMatch(/\d{3}$/); // ends with ms
  });

  it('zero-pads hours, minutes, seconds, milliseconds', () => {
    // Create a date where h/m/s/ms would all be single digits
    const d = new Date(0); // 1970-01-01T00:00:00.000Z
    // adjust for local timezone offset so getHours()===0
    const localOffset = d.getTimezoneOffset() * 60 * 1000;
    const epoch = new Date(localOffset); // midnight local
    const result = formatTimestampTooltip(epoch);
    expect(result).toMatch(/00:00:00\.000/);
  });
});
