/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { resolveOutputTarget, stdoutFormatOf } from './outputTarget';

describe('resolveOutputTarget', () => {
  it('returns null when the flag is absent or blank', () => {
    expect(resolveOutputTarget(undefined)).toBeNull();
    expect(resolveOutputTarget(null)).toBeNull();
    expect(resolveOutputTarget('')).toBeNull();
    expect(resolveOutputTarget('   ')).toBeNull();
  });

  it.each(['json', 'junit'])('treats a bare %s as a stdout format', (keyword) => {
    expect(resolveOutputTarget(keyword)).toEqual({ kind: 'stdout', format: keyword });
  });

  it('accepts format keywords case-insensitively and trims whitespace', () => {
    expect(resolveOutputTarget('JSON')).toEqual({ kind: 'stdout', format: 'json' });
    expect(resolveOutputTarget('  JUnit  ')).toEqual({ kind: 'stdout', format: 'junit' });
  });

  it.each([
    'report.json',
    'results/report.json',
    './json',
    'json.txt',
    '/tmp/junit.xml',
  ])('treats %s as a file path', (value) => {
    expect(resolveOutputTarget(value)).toEqual({ kind: 'file', path: value });
  });

  it('keeps the original casing of a file path', () => {
    expect(resolveOutputTarget('Report.JSON')).toEqual({ kind: 'file', path: 'Report.JSON' });
  });
});

describe('stdoutFormatOf', () => {
  it('extracts the format only for stdout targets', () => {
    expect(stdoutFormatOf({ kind: 'stdout', format: 'json' })).toBe('json');
    expect(stdoutFormatOf({ kind: 'stdout', format: 'junit' })).toBe('junit');
    expect(stdoutFormatOf({ kind: 'file', path: 'out.json' })).toBeNull();
    expect(stdoutFormatOf(null)).toBeNull();
  });
});
