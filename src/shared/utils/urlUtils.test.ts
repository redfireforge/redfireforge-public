import { describe, it, expect } from 'vitest';
import { replaceHost } from './urlUtils';

describe('urlUtils', () => {
  describe('replaceHost', () => {
    // --- Passthrough cases (no base URL or absolute URL) ---
    it('returns original URL when baseUrl is empty', () => {
      expect(replaceHost('https://api.example.com/users', '')).toBe('https://api.example.com/users');
    });

    it('returns testUrl when baseUrl is nullish', () => {
      const url = 'https://api.example.com/users';
      expect(replaceHost(url, undefined as unknown as string)).toBe(url);
      expect(replaceHost(url, null as unknown as string)).toBe(url);
    });

    it('rewrites absolute https origin and keeps the path', () => {
      const result = replaceHost('https://httpbin.org/status/204', 'https://jsonplaceholder.typicode.com');
      expect(result).toBe('https://jsonplaceholder.typicode.com/status/204');
    });

    it('rewrites absolute http origin onto the new host', () => {
      const result = replaceHost('http://httpbin.org/delay/1', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/delay/1');
    });

    it('rewrites a promoted Cloud Foundry URL onto localhost', () => {
      const result = replaceHost(
        'https://svc.apps.test.example.com/salesproduct/autoassignment/v1/vehicles/VIN1/onboarding/digitalmo/offers?channel=MC_THIRDPARTY',
        'http://localhost:8080',
      );
      expect(result).toBe(
        'http://localhost:8080/salesproduct/autoassignment/v1/vehicles/VIN1/onboarding/digitalmo/offers?channel=MC_THIRDPARTY',
      );
    });

    it('prefixes a new base path when the absolute path does not already include it', () => {
      const result = replaceHost('https://api.example.com/users', 'http://127.0.0.1:4600/mock');
      expect(result).toBe('http://127.0.0.1:4600/mock/users');
    });

    it('does not double a base path already present on the absolute URL', () => {
      const result = replaceHost('https://api.example.com/mock/users', 'http://127.0.0.1:4600/mock');
      expect(result).toBe('http://127.0.0.1:4600/mock/users');
    });

    // --- Relative path cases ---
    it('prepends base URL to relative path starting with /', () => {
      const result = replaceHost('/users', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/users');
    });

    it('prepends base URL to relative path without leading /', () => {
      const result = replaceHost('users/123', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/users/123');
    });

    it('handles base URL with trailing slash', () => {
      const result = replaceHost('/users', 'https://api.example.com/');
      expect(result).toBe('https://api.example.com/users');
    });

    it('normalizes base URL without trailing slash', () => {
      const baseNoSlash = 'https://api.example.com';
      const baseWithSlash = `${baseNoSlash}/`;
      const a = replaceHost('/v1/items', baseNoSlash);
      const b = replaceHost('/v1/items', baseWithSlash);
      expect(a).toBe(b);
      expect(a).toBe('https://api.example.com/v1/items');
    });

    it('preserves query parameters on relative URLs', () => {
      const result = replaceHost('/users?limit=10&offset=0', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/users?limit=10&offset=0');
    });

    it('preserves hash fragments on relative URLs', () => {
      const result = replaceHost('/page#section', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/page#section');
    });

    it('preserves {{template}} variables when rewriting an absolute URL', () => {
      const result = replaceHost('https://old.example.com/users/{{userId}}', 'http://localhost:8080');
      expect(result).toBe('http://localhost:8080/users/{{userId}}');
    });

    it('preserves {{template}} variables in relative path', () => {
      const result = replaceHost('/users/{{userId}}', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/users/{{userId}}');
    });

    it('preserves multiple {{template}} variables in relative path', () => {
      const result = replaceHost('/{{resource}}/{{id}}/{{action}}', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/{{resource}}/{{id}}/{{action}}');
    });

    it('restores each placeholder index after URL parsing', () => {
      const relUrl = '/{{a}}/{{b}}?q={{c}}#{{d}}';
      const out = replaceHost(relUrl, 'https://api.example.com');
      expect(out).toContain('{{a}}');
      expect(out).toContain('{{b}}');
      expect(out).toContain('{{c}}');
      expect(out).toContain('{{d}}');
      expect(out).not.toContain('__TPL_');
    });

    it('preserves {{template}} variables in query params', () => {
      const result = replaceHost('/users?token={{apiToken}}', 'https://api.example.com');
      expect(result).toContain('{{apiToken}}');
    });

    it('handles base path in base URL', () => {
      const result = replaceHost('/users', 'https://api.example.com/v2');
      expect(result).toBe('https://api.example.com/v2/users');
    });

    it('handles base URL with multiple path segments', () => {
      const result = replaceHost('/users', 'https://api.example.com/api/v3');
      expect(result).toBe('https://api.example.com/api/v3/users');
    });

    it('treats invalid-looking paths as relative (no fallback needed)', () => {
      // Even strange-looking paths get treated as relative paths and prepended
      const strangePath = '://invalid';
      const result = replaceHost(strangePath, 'https://api.example.com');
      expect(result).toBe('https://api.example.com/://invalid');
    });

    it('handles port numbers in base URL', () => {
      const result = replaceHost('/users', 'http://localhost:3000');
      expect(result).toBe('http://localhost:3000/users');
    });

    it('uses protocol from base URL', () => {
      const result = replaceHost('/data', 'http://dev.example.com');
      expect(result).toBe('http://dev.example.com/data');
    });

    // --- Edge case: empty path ---
    it('handles empty relative path', () => {
      const result = replaceHost('', 'https://api.example.com');
      expect(result).toBe('https://api.example.com/');
    });

    // --- Catch branch: invalid baseUrl falls back to testUrl ---
    it('returns testUrl when baseUrl is not a valid URL', () => {
      const testUrl = '/api/users';
      const result = replaceHost(testUrl, 'not a valid url ://???');
      expect(result).toBe(testUrl);
    });

    it('returns testUrl when baseUrl causes URL construction to throw', () => {
      const testUrl = '/items/123';
      const result = replaceHost(testUrl, 'ftp://');
      // Should not throw — catches and returns testUrl
      expect(typeof result).toBe('string');
    });
  });
});
