/**
 * @vitest-environment jsdom
 *
 * Regression for Vitest 5 + jsdom 30: createObjectURL used to throw
 * `Cannot read properties of undefined (reading '_buffer')`.
 */
import { describe, expect, it } from 'vitest';

describe('jsdom URL.createObjectURL compat', () => {
  it('creates and revokes a blob URL from a jsdom Blob', () => {
    const url = URL.createObjectURL(new Blob(['{"ok":true}'], { type: 'application/json' }));
    expect(url).toMatch(/^blob:/);
    expect(() => URL.revokeObjectURL(url)).not.toThrow();
  });
});
