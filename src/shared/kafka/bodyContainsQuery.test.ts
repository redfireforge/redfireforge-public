import { describe, expect, it } from 'vitest';
import { kafkaBodyHasText } from './bodyContainsQuery';

describe('kafkaBodyHasText', () => {
  const body = '{"orderId":"ORD-100","type":"SHIPPED","status":"open","note":"say \\"hi\\""}';

  it('matches every body when the query is blank', () => {
    expect(kafkaBodyHasText(body, '')).toBe(true);
    expect(kafkaBodyHasText(body, '   ')).toBe(true);
  });

  it('treats a value with no AND or OR as one phrase', () => {
    expect(kafkaBodyHasText('status is ready', 'status is ready')).toBe(true);
    expect(kafkaBodyHasText('status is ready', 'is ready now')).toBe(false);
    expect(kafkaBodyHasText(body, 'ORD-100')).toBe(true);
  });

  it('matches AND and OR with parentheses', () => {
    expect(kafkaBodyHasText(body, 'status AND SHIPPED')).toBe(true);
    expect(kafkaBodyHasText(body, 'status AND missing-word')).toBe(false);
    expect(kafkaBodyHasText(body, 'missing-word OR SHIPPED')).toBe(true);
    expect(kafkaBodyHasText(body, 'missing-word OR other')).toBe(false);
    expect(kafkaBodyHasText(body, 'missing-word OR status AND SHIPPED')).toBe(true);
    expect(kafkaBodyHasText(body, '(ORD-100 OR other-id) AND SHIPPED')).toBe(true);
    expect(kafkaBodyHasText(body, '(missing OR other) AND SHIPPED')).toBe(false);
  });

  it('strips quotes around a phrase that contains AND', () => {
    expect(kafkaBodyHasText('status is AND ready', '"is AND ready"')).toBe(true);
    expect(kafkaBodyHasText('status is AND ready', '\u201cis AND ready\u201d')).toBe(true);
    expect(kafkaBodyHasText(body, '"say \\"hi\\""')).toBe(true);
  });

  it('falls back to a literal search when the query is not valid', () => {
    expect(kafkaBodyHasText('status AND', 'status AND')).toBe(true);
    expect(kafkaBodyHasText(body, 'status AND')).toBe(false);
    expect(kafkaBodyHasText(body, '(status')).toBe(false);
    expect(kafkaBodyHasText(body, 'status AND OR ready')).toBe(false);
    expect(kafkaBodyHasText(body, '"unterminated')).toBe(false);
    expect(kafkaBodyHasText('"unterminated', '"unterminated')).toBe(true);
  });

  it('ignores case and matches text after JSON unescape', () => {
    const escaped = '{"event":{"body":"{\\"accountType\\":\\"PN\\"}"}}';
    expect(kafkaBodyHasText(escaped, '"accountType":"PN"')).toBe(true);
    expect(kafkaBodyHasText('line1\\nline2', 'line1\nline2')).toBe(true);
    expect(kafkaBodyHasText('a\\tb', 'a\tb')).toBe(true);
    expect(kafkaBodyHasText('a\\rb', 'a\rb')).toBe(true);
    expect(kafkaBodyHasText('a\\/b', 'a/b')).toBe(true);
    expect(kafkaBodyHasText('a\\\\b', 'a\\b')).toBe(true);
    expect(kafkaBodyHasText(body, 'shipped')).toBe(true);
  });

  it('treats tabs and newlines in the query as spaces', () => {
    expect(kafkaBodyHasText(body, 'status\tAND\nSHIPPED')).toBe(true);
    expect(kafkaBodyHasText(body, 'status\rOR\nmissing')).toBe(true);
  });

  it('matches an empty quoted phrase', () => {
    expect(kafkaBodyHasText(body, '""')).toBe(true);
  });
});
