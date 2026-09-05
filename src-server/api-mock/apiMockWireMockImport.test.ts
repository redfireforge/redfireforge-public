/**
 * End-to-end: import the reported WireMock stub, run it on a real listener, and
 * confirm the XPath-approximated body condition actually routes SOAP traffic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ApiMockNetworkListener } from './ApiMockNetworkListener';
import { parseWireMockMappings, batchToRoutes } from '../../src/shared/api-mock/importParsers';
import { DEFAULT_SETTINGS } from '../../src/shared/api-mock/defaults';
import type { ApiMockServerDefinitionV1 } from '../../src/shared/api-mock/contracts';

const ts = '2026-08-12T00:00:00.000Z';
const URL_PATH = '/api/subscriptions/v1/ActivateAccount';

const stub = (needle: string, status: number, body: string) => JSON.stringify({
  request: {
    method: 'POST',
    url: URL_PATH,
    bodyPatterns: [{
      matchesXPath: {
        contains: needle,
        expression: "//*[local-name() = 'vehicleIdentificationNumber']/text()",
      },
    }],
  },
  response: { status, headers: { 'Content-Type': 'text/xml' }, body },
});

const soap = (vin: string, extra = '') =>
  `<?xml version="1.0"?>`
  + `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"`
  + ` xmlns:ns3="http://example.com/schema/Request.xsd">`
  + `<SOAP-ENV:Body><ns3:Req>`
  + `<ns3:vehicleIdentificationNumber>${vin}</ns3:vehicleIdentificationNumber>`
  + extra
  + `</ns3:Req></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

let nextPort = 19950 + Math.floor(Math.random() * 200);

describe('WireMock SOAP fault-routing stubs', () => {
  const listeners: ApiMockNetworkListener[] = [];
  afterEach(async () => {
    for (const l of listeners) if (l.isRunning()) await l.stop();
    listeners.length = 0;
  });

  it('routes each VIN marker to its own stub response', async () => {
    // Two stubs that differ only by the magic substring in the VIN.
    const routes = [
      ...batchToRoutes(parseWireMockMappings(stub('FaultCode200', 500, '<fault>200</fault>')), { sourceKind: 'wiremock' }).routes,
      ...batchToRoutes(parseWireMockMappings(stub('SUCCESS', 200, '<ok/>')), { sourceKind: 'wiremock' }).routes,
    ].map(r => ({ ...r, enabled: true }));

    expect(routes).toHaveLength(2);

    const port = nextPort++;
    const def: ApiMockServerDefinitionV1 = {
      id: 'srv-wm', name: 'WireMock import', enabled: true, host: '127.0.0.1', port,
      basePath: '', folders: [], variables: [], samples: [], routes,
      settings: { ...DEFAULT_SETTINGS }, createdAt: ts, updatedAt: ts,
    };
    const listener = new ApiMockNetworkListener({ serverId: 'srv-wm', definition: def });
    listeners.push(listener);
    await listener.start();

    const post = async (body: string) => {
      const res = await fetch(`http://127.0.0.1:${port}${URL_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body,
      });
      return { status: res.status, body: await res.text() };
    };

    const fault = await post(soap('1HGCM82633AFaultCode200'));
    expect(fault.status).toBe(500);
    expect(fault.body).toBe('<fault>200</fault>');

    const ok = await post(soap('1HGCM82633ASUCCESS99'));
    expect(ok.status).toBe(200);
    expect(ok.body).toBe('<ok/>');

    // A VIN carrying neither marker matches no stub.
    const miss = await post(soap('1HGCM82633APLAINVIN'));
    expect(miss.status).toBe(404);

    // The marker appears in a different element — XPath is scoped to the VIN,
    // so this must NOT match (a whole-body "contains" would have).
    const decoy = await post(soap('1HGCM82633APLAINVIN', '<ns3:note>FaultCode200</ns3:note>'));
    expect(decoy.status).toBe(404);

    // Malformed XML must degrade to "no match", never crash the listener.
    const broken = await post('<Envelope><unclosed>');
    expect(broken.status).toBe(404);
    const notXml = await post('{"vin":"FaultCode200"}');
    expect(notXml.status).toBe(404);

    // The listener is still healthy after the malformed requests.
    const after = await post(soap('1HGCM82633ASUCCESS99'));
    expect(after.status).toBe(200);
  }, 30_000);
});
