import { describe, it, expect } from 'vitest';
import { parseWireMockMappings, batchToRoutes } from './importParsers';

// The stub from the report: a single mapping object with an XPath body matcher
// and a bodyFileName the paste cannot carry.
const SINGLE_STUB = JSON.stringify({
  request: {
    method: 'POST',
    url: '/api/subscriptions/v1/ActivateAccount',
    bodyPatterns: [{
      matchesXPath: {
        contains: 'FaultCode200',
        expression: "//*[local-name() = 'vehicleIdentificationNumber']/text()",
      },
    }],
  },
  response: {
    status: 500,
    headers: { 'Content-Type': 'text/xml' },
    bodyFileName: 'SOAPResponseRetriable200BeginningFaultEnvelop.xml',
  },
});

describe('parseWireMockMappings — single stub file', () => {
  it('accepts a bare stub object (WireMock mappings/*.json layout)', () => {
    const batch = parseWireMockMappings(SINGLE_STUB);
    expect(batch.diagnostics.some(d => d.severity === 'error')).toBe(false);
    expect(batch.sources).toHaveLength(1);
    expect(batch.sources[0].method).toBe('POST');
    expect(batch.sources[0].path).toBe('/api/subscriptions/v1/ActivateAccount');
    expect(batch.sources[0].status).toBe(500);
  });

  it('maps matchesXPath/contains to a scoped XPath condition', () => {
    const batch = parseWireMockMappings(SINGLE_STUB);
    const preds = batch.sources[0].predicates ?? [];
    expect(preds).toHaveLength(1);
    expect(preds[0]).toMatchObject({
      source: 'body',
      operator: 'xpath_equals',
      expected: ["//*[local-name() = 'vehicleIdentificationNumber']/text()", 'FaultCode200'],
      options: { matchStyle: 'subset' },
    });
  });

  it('maps a bare matchesXPath expression to an existence check', () => {
    const batch = parseWireMockMappings(JSON.stringify({
      request: { method: 'POST', url: '/x', bodyPatterns: [{ matchesXPath: '//vin' }] },
      response: { status: 200 },
    }));
    expect(batch.sources[0].predicates?.[0]).toMatchObject({ operator: 'xpath_exists', expected: '//vin' });
  });

  it('replaces an unresolvable bodyFileName with a placeholder and warns', () => {
    const batch = parseWireMockMappings(SINGLE_STUB);
    expect(batch.sources[0].responseBody).toContain('SOAPResponseRetriable200BeginningFaultEnvelop.xml');
    expect(batch.sources[0].responseContentType).toBe('text/xml');
    expect(batch.diagnostics.some(d => d.code === 'AMS-IMPORT-WIREMOCK-BODYFILE')).toBe(true);
  });

  it('carries the body condition onto the generated route', () => {
    const batch = parseWireMockMappings(SINGLE_STUB);
    const { routes } = batchToRoutes(batch, { sourceKind: 'wiremock' });
    expect(routes).toHaveLength(1);
    const leaf = routes[0].predicates.children.find(c => !('combinator' in c));
    expect(leaf).toMatchObject({ source: 'body', operator: 'xpath_equals' });
  });

  it('still accepts arrays and { mappings: [] }', () => {
    const stub = JSON.parse(SINGLE_STUB);
    expect(parseWireMockMappings(JSON.stringify([stub])).sources).toHaveLength(1);
    expect(parseWireMockMappings(JSON.stringify({ mappings: [stub] })).sources).toHaveLength(1);
    expect(parseWireMockMappings(JSON.stringify({ mappings: stub })).sources).toHaveLength(1);
  });

  it('accepts a YAML stub', () => {
    const yaml = [
      'request:',
      '  method: GET',
      '  url: /health',
      'response:',
      '  status: 200',
      '  body: ok',
    ].join('\n');
    const batch = parseWireMockMappings(yaml);
    expect(batch.sources).toHaveLength(1);
    expect(batch.sources[0].responseBody).toBe('ok');
  });

  it('reports a parse error only when the text is neither JSON nor YAML', () => {
    const batch = parseWireMockMappings('{ this is: [not valid');
    expect(batch.sources).toHaveLength(0);
    expect(batch.diagnostics[0].code).toBe('AMS-IMPORT-PARSE');
  });
});

describe('parseWireMockMappings — body matcher coverage', () => {
  const withPattern = (pattern: unknown) => parseWireMockMappings(JSON.stringify({
    request: { method: 'POST', url: '/x', bodyPatterns: [pattern] },
    response: { status: 200 },
  }));

  it('maps the directly supported matchers', () => {
    expect(withPattern({ equalTo: 'a' }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'exact', expected: 'a' });
    expect(withPattern({ contains: 'a' }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'contains', expected: 'a' });
    expect(withPattern({ matches: '^a.*' }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'regex', expected: '^a.*' });
    expect(withPattern({ matchesJsonPath: '$.a' }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'jsonPath_exists', expected: '$.a' });
    expect(withPattern({ matchesJsonPath: { expression: '$.a', equalTo: 'b' } }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'jsonPath_equals', expected: ['$.a', 'b'] });
  });

  it('honours ignoreExtraElements for equalToJson', () => {
    expect(withPattern({ equalToJson: { a: 1 } }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'json_strict' });
    expect(withPattern({ equalToJson: { a: 1 }, ignoreExtraElements: true }).sources[0].predicates?.[0])
      .toMatchObject({ operator: 'json_subset' });
  });

  it('drops matchers it cannot express instead of emitting dead rules', () => {
    const negated = withPattern({ doesNotMatch: 'a' });
    expect(negated.sources[0].predicates).toBeUndefined();
    expect(negated.lossReport.join(' ')).toMatch(/Negated body matcher/);
  });
});
