import { describe, expect, it, vi } from 'vitest';
import * as curlParser from '@shared/utils/curlParser';
import { convertSourceToRule } from '@shared/api-mock/sourceToRule';
import {
  IMPORT_SOURCES,
  parseCurlToSource,
  responseStatusMeta,
  splitPathParams,
} from './apiMockImportReviewHelpers';

describe('apiMockImportReviewHelpers', () => {
  it('lists all import sources including HAR', () => {
    expect(IMPORT_SOURCES.map(s => s.id)).toContain('har');
    expect(IMPORT_SOURCES.length).toBe(7);
  });

  it('parses curl method, url, headers, and body', () => {
    const src = parseCurlToSource(
      "curl -X POST https://api.example.com/users?x=1 -H 'Content-Type: application/json' -H 'X-Tenant: acme' -d 'hello'",
    );
    expect(src.method).toBe('POST');
    expect(src.path).toBe('/users');
    expect(src.headers['Content-Type']).toBe('application/json');
    expect(src.headers['X-Tenant']).toBe('acme');
    expect(src.body).toBe('hello');
    expect(src.contentType).toBe('application/json');
    expect(src.query).toEqual({ x: '1' });
  });

  it('keeps query parameters and long-form headers from a multiline curl', () => {
    const src = parseCurlToSource(`curl --request GET \\
  --url 'https://sales-order.example.com/sales/order/v3/accounts/VIN123/orders?vin=VIN123&dataSync=false' \\
  --header 'Accept-Language: en-US' \\
  --header 'Authorization: Bearer test-token' \\
  --header 'Content-Type: application/json'`);
    expect(src.method).toBe('GET');
    expect(src.path).toBe('/sales/order/v3/accounts/VIN123/orders');
    expect(src.query).toEqual({ vin: 'VIN123', dataSync: 'false' });
    expect(src.headers['Accept-Language']).toBe('en-US');
    expect(src.headers.Authorization).toBe('Bearer test-token');
    expect(src.headers['Content-Type']).toBe('application/json');

    const rule = convertSourceToRule(src, { sourceKind: 'curl', sourceLabel: 'cURL import' });
    const matched = rule.route.predicates.children.filter(p => 'selector' in p);
    expect(matched.map(p => `${'source' in p ? p.source : ''}:${'selector' in p ? p.selector : ''}`)).toEqual([
      'header:accept-language',
      'header:authorization',
      'header:content-type',
      'query:vin',
      'query:dataSync',
    ]);
  });

  it('uses root path defaults when the parser omits method, url, and headers', () => {
    const spy = vi.spyOn(curlParser, 'parseCurl').mockReturnValue({
      method: undefined,
      url: undefined,
      headers: undefined,
      body: '',
    } as unknown as ReturnType<typeof curlParser.parseCurl>);
    const src = parseCurlToSource('curl');
    expect(src.method).toBe('GET');
    expect(src.path).toBe('/');
    expect(src.headers).toEqual({});
    expect(src.body).toBeUndefined();
    spy.mockRestore();
  });

  it('uses a root path for a schemeless url and skips query pairs without a name', () => {
    expect(parseCurlToSource('curl custom:').path).toBe('/');
    const src = parseCurlToSource("curl '?vin=1&orphan&='");
    expect(src.path).toBe('/');
    expect(src.query).toEqual({ vin: '1' });
  });

  it('reads a query string from a relative url', () => {
    const src = parseCurlToSource("curl '/orders?vin=VIN123&dataSync=false'");
    expect(src.path).toBe('/orders');
    expect(src.query).toEqual({ vin: 'VIN123', dataSync: 'false' });
  });

  it('defaults method to GET and falls back for relative paths', () => {
    const src = parseCurlToSource("curl '/orders/42'");
    expect(src.method).toBe('GET');
    expect(src.path).toBe('/orders/42');
  });

  it('handles unparseable absolute-looking URL via catch path', () => {
    const src = parseCurlToSource('curl http://[bad');
    expect(src.path).toBeTruthy();
  });

  it('supports --data-raw body and content-type header casing', () => {
    const src = parseCurlToSource("curl https://api.example.com/x -H 'content-type: text/plain' --data-raw 'abc'");
    expect(src.body).toBe('abc');
    expect(src.contentType).toBe('text/plain');
  });

  it('skips empty header keys and defaults missing url to /', () => {
    const src = parseCurlToSource("curl -H ':novalue' -H 'Ok: yes'");
    expect(src.path).toBe('/');
    expect(src.headers.Ok).toBe('yes');
  });

  it('classifies response status metadata', () => {
    expect(responseStatusMeta(200)).toEqual({ statusClass: 'success', statusText: 'OK' });
    expect(responseStatusMeta(301)).toEqual({ statusClass: 'warning', statusText: 'Redirect' });
    expect(responseStatusMeta(404)).toEqual({ statusClass: 'warning', statusText: 'Client Error' });
    expect(responseStatusMeta(500)).toEqual({ statusClass: 'danger', statusText: 'Server Error' });
  });

  it('splits path param tokens', () => {
    expect(splitPathParams('/users/{id}/orders')).toEqual(['/users/', '{id}', '/orders']);
  });
});
