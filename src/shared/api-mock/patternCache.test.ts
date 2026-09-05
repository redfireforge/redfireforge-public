import { describe, expect, it } from 'vitest';
import { compileRegexCached, testRegexCached, _clearPatternCache } from './patternCache';

describe('patternCache', () => {
  it('compiles, memoizes, and returns null for invalid patterns', () => {
    _clearPatternCache();
    const first = compileRegexCached('^ok$');
    const second = compileRegexCached('^ok$');
    expect(first).toBeInstanceOf(RegExp);
    expect(second).toBe(first);
    expect(compileRegexCached('[')).toBeNull();
    expect(compileRegexCached('[')).toBeNull();
  });

  it('honors flags and tests values without throwing on invalid patterns', () => {
    _clearPatternCache();
    expect(testRegexCached('^Hello$', '', 'Hello')).toBe(true);
    expect(testRegexCached('^Hello$', 'i', 'hello')).toBe(true);
    expect(testRegexCached('^Hello$', '', 'hello')).toBe(false);
    expect(testRegexCached('[', '', 'x')).toBe(false);
  });

  it('clears memoized entries so the next compile is a fresh instance', () => {
    _clearPatternCache();
    const before = compileRegexCached('^fresh$');
    _clearPatternCache();
    const after = compileRegexCached('^fresh$');
    expect(before).toBeInstanceOf(RegExp);
    expect(after).toBeInstanceOf(RegExp);
    expect(after).not.toBe(before);
  });
});
