import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { evaluateXPath, matchXPathExists, matchXPathEquals } from './xpathMatcher';

const VIN_XPATH = "//*[local-name() = 'vehicleIdentificationNumber']/text()";

const soap = (vin: string, extra = '') => `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <ns3:ActivateAccountRequest
        xmlns:ns2="http://example.com/schema/CDM.xsd"
        xmlns:ns3="http://example.com/schema/Request.xsd">
      <ns3:VehicleDetails>
        <ns3:vehicleIdentificationNumber>${vin}</ns3:vehicleIdentificationNumber>
        <ns3:make>ExampleMake</ns3:make>
      </ns3:VehicleDetails>
      ${extra}
    </ns3:ActivateAccountRequest>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

describe('evaluateXPath', () => {
  it('resolves a namespaced element via local-name()', () => {
    const res = evaluateXPath(soap('1HGCM82633AFaultCode200'), VIN_XPATH);
    expect(res.ok).toBe(true);
    expect(res.values).toEqual(['1HGCM82633AFaultCode200']);
  });

  it('reports no match when the element is absent', () => {
    const res = evaluateXPath(soap('X').replace(/vehicleIdentificationNumber/g, 'other'), VIN_XPATH);
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(false);
  });

  it('is not ok for non-XML or empty bodies', () => {
    expect(evaluateXPath('{"a":1}', VIN_XPATH).matched).toBe(false);
    expect(evaluateXPath('', VIN_XPATH).ok).toBe(false);
    expect(evaluateXPath(soap('X'), '').ok).toBe(false);
    expect(evaluateXPath(soap('X'), '   ').ok).toBe(false);
    expect(evaluateXPath(123 as unknown as string, VIN_XPATH).ok).toBe(false);
  });

  it('survives an invalid expression without throwing', () => {
    expect(evaluateXPath(soap('X'), '//[[[bad(').ok).toBe(false);
  });

  it('supports boolean and string XPath results', () => {
    expect(evaluateXPath(soap('ABC'), `contains(${VIN_XPATH}, 'ABC')`).matched).toBe(true);
    expect(evaluateXPath(soap('ABC'), `string(${VIN_XPATH})`).values).toEqual(['ABC']);
    expect(evaluateXPath(soap('ABC'), '1=2').matched).toBe(false);
    expect(evaluateXPath(soap('ABC'), 'string(//missing)').matched).toBe(false);
    expect(evaluateXPath('<root attr="v"/>', '//@attr').values).toEqual(['v']);
    expect(evaluateXPath('<root><item/></root>', 'count(//missing)').values).toEqual(['0']);
  });

  it('reuses cached parse results for identical XML bodies', () => {
    const body = soap('CACHE');
    const a = evaluateXPath(body, VIN_XPATH);
    const b = evaluateXPath(body, VIN_XPATH);
    expect(a).toEqual(b);
  });
});

describe('matchXPathExists', () => {
  it('matches only when the expression selects a node', () => {
    expect(matchXPathExists(soap('V1'), VIN_XPATH)).toBe(true);
    expect(matchXPathExists(soap('V1'), "//*[local-name() = 'nope']")).toBe(false);
    expect(matchXPathExists(soap('V1'), VIN_XPATH as unknown as string)).toBe(true);
  });
});

describe('matchXPathEquals', () => {
  const contains = (body: string, needle: string) =>
    matchXPathEquals(body, [VIN_XPATH, needle], 'subset');

  it('matches a substring of the selected node (WireMock "contains")', () => {
    expect(contains(soap('1HGCM82633AFaultCode200'), 'FaultCode200')).toBe(true);
    expect(contains(soap('1HGCM82633ASUCCESS'), 'FaultCode200')).toBe(false);
    expect(contains(soap('1HGCM82633AFaultCode200'), '')).toBe(false);
  });

  it('is scoped to the element — the whole-body approximation was not', () => {
    // The marker appears elsewhere in the document but NOT in the VIN.
    const decoy = soap('1HGCM82633APLAIN', '<ns3:note>FaultCode200 seen previously</ns3:note>');
    expect(decoy).toContain('FaultCode200');
    expect(contains(decoy, 'FaultCode200')).toBe(false);
  });

  it('compares exactly when matchStyle is not subset', () => {
    expect(matchXPathEquals(soap('EXACTVIN'), [VIN_XPATH, 'EXACTVIN'], 'exact')).toBe(true);
    expect(matchXPathEquals(soap('EXACTVIN1'), [VIN_XPATH, 'EXACTVIN'], 'exact')).toBe(false);
    expect(matchXPathEquals(soap('EXACTVIN'), [VIN_XPATH, undefined], 'exact')).toBe(false);
    expect(matchXPathEquals(soap('EXACTVIN'), [undefined, 'EXACTVIN'], 'exact')).toBe(false);
  });

  it('returns false for malformed expected values', () => {
    expect(matchXPathEquals(soap('V'), 'not-an-array')).toBe(false);
    expect(matchXPathExists(soap('V'), undefined)).toBe(false);
    expect(matchXPathExists(soap('V'), [''])).toBe(false);
  });
});

describe('evaluateXPath parser failures', () => {
  it('returns not ok when DOMParser throws', () => {
    const spy = vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => {
      throw new Error('parse failed');
    });
    expect(evaluateXPath('<root/>', '//root').ok).toBe(false);
    const body = '<cached-fail/>';
    expect(evaluateXPath(body, '//root').ok).toBe(false);
    expect(evaluateXPath(body, '//root').ok).toBe(false);
    spy.mockRestore();
  });

  it('returns not ok when parsing yields no document', () => {
    const spy = vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue(undefined as never);
    expect(evaluateXPath('<root/>', '//root').ok).toBe(false);
    spy.mockRestore();
  });

  it('returns not ok when parsing returns null', () => {
    const spy = vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue(null as never);
    expect(evaluateXPath('<root/>', '//root').ok).toBe(false);
    spy.mockRestore();
  });
});

describe('evaluateXPath mocked select branches', () => {
  const mockSelect = vi.fn();
  let evaluateXPathMocked: typeof evaluateXPath;

  beforeAll(async () => {
    vi.doMock('xpath', () => ({ select: mockSelect }));
    vi.resetModules();
    ({ evaluateXPath: evaluateXPathMocked } = await import('./xpathMatcher'));
  });

  afterAll(() => {
    vi.doUnmock('xpath');
    vi.resetModules();
  });

  it('normalizes scalar and node results', () => {
    mockSelect.mockReturnValueOnce(false);
    expect(evaluateXPathMocked('<root/>', 'expr').matched).toBe(false);

    mockSelect.mockReturnValueOnce(true);
    expect(evaluateXPathMocked('<root/>', 'expr').matched).toBe(true);

    mockSelect.mockReturnValueOnce('');
    expect(evaluateXPathMocked('<root/>', 'expr').matched).toBe(false);

    mockSelect.mockReturnValueOnce(7);
    expect(evaluateXPathMocked('<root/>', 'expr').values).toEqual(['7']);

    mockSelect.mockReturnValueOnce({ textContent: 'solo' });
    expect(evaluateXPathMocked('<root/>', 'expr').values).toEqual(['solo']);

    mockSelect.mockImplementationOnce(() => {
      throw new Error('bad xpath');
    });
    expect(evaluateXPathMocked('<root/>', 'expr').ok).toBe(false);

    mockSelect.mockReturnValueOnce([
      null,
      { nodeValue: 'n' },
      { textContent: 't', nodeValue: null },
      {},
      's',
      2,
      true,
    ]);
    expect(evaluateXPathMocked('<root/>', 'expr').values).toEqual(['n', 't', '', 's', '2', 'true']);
  });
});
