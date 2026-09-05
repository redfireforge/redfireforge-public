import { describe, it, expect } from 'vitest';
import { HttpNodeData } from '../types/workflow';
import { mergeWorkflowNodeData, stripEphemeralNodeDataFields, cloneWorkflowNodeDataForStorage } from './workflowNodeMerge';

describe('mergeWorkflowNodeData', () => {
  it('does not wipe initialVariables when patch spreads initialVariables: undefined', () => {
    const base: HttpNodeData = {
      label: 'S',
      scenario: {
        id: '1',
        name: 'n',
        url: 'https://x/?vin={{vin}}',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: 'ABC' },
    };
    const dataProp = { ...base, initialVariables: undefined as Record<string, string> | undefined };
    const patch = { ...dataProp, scenario: { ...base.scenario, url: 'https://y/' } };
    const out = mergeWorkflowNodeData(base, patch) as HttpNodeData;
    expect(out.initialVariables).toEqual({ vin: 'ABC' });
  });

  it('preserves initialVariables when patch only updates scenario (HttpConfig partial patch)', () => {
    const base: HttpNodeData = {
      label: 'L',
      scenario: {
        id: '1',
        name: 'n',
        url: 'https://x/?vin={{vin}}',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: 'REALVIN' },
    };
    const patch: Partial<HttpNodeData> = {
      scenario: { ...base.scenario, url: 'https://y/other?vin={{vin}}' },
    };
    const out = mergeWorkflowNodeData(base, patch) as HttpNodeData;
    expect(out.initialVariables).toEqual({ vin: 'REALVIN' });
    expect(out.scenario.url).toContain('https://y/other');
  });

  it('allows clearing with initialVariables: {}', () => {
    const base: HttpNodeData = {
      label: 'S',
      scenario: {
        id: '1',
        name: 'n',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: 'x' },
    };
    const out = mergeWorkflowNodeData(base, { initialVariables: {} }) as HttpNodeData;
    expect(out.initialVariables).toEqual({});
  });

  it('does not wipe label when patch spreads label: undefined', () => {
    const base: HttpNodeData = {
      label: 'Keep',
      scenario: {
        id: '1',
        name: 'n',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
    };
    const patch = { ...base, label: undefined as unknown as string };
    const out = mergeWorkflowNodeData(base, patch) as HttpNodeData;
    expect(out.label).toBe('Keep');
  });

  it('still clears host fields when patch sets host keys to undefined', () => {
    const base: HttpNodeData = {
      label: 'S',
      scenario: {
        id: '1',
        name: 'n',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      hostEnvironmentId: 'env1',
      hostMicroserviceId: 'svc1',
    };
    const out = mergeWorkflowNodeData(base, {
      hostEnvironmentId: undefined,
      hostMicroserviceId: undefined,
      hostBaseUrl: undefined,
    }) as HttpNodeData;
    expect(out.hostEnvironmentId).toBeUndefined();
    expect(out.hostMicroserviceId).toBeUndefined();
    expect(out.hostBaseUrl).toBeUndefined();
  });

  it('stripEphemeralNodeDataFields removes runStatus from HTTP node data', () => {
    const data = {
      label: 'S',
      scenario: {
        id: '1',
        name: 'n',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: 'X' },
      runStatus: { state: 'fail' as const, error: 'bad' },
    } as HttpNodeData & { runStatus: { state: 'fail'; error: string } };
    const out = stripEphemeralNodeDataFields(data) as HttpNodeData;
    expect('runStatus' in out).toBe(false);
    expect(out.initialVariables).toEqual({ vin: 'X' });
  });

  it('cloneWorkflowNodeDataForStorage preserves initialVariables for JSON persistence', () => {
    const data: HttpNodeData = {
      label: 'H',
      scenario: {
        id: '1',
        name: 'n',
        url: 'https://x/?vin={{vin}}',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: '1HGCM82633A004748' },
    };
    const cloned = cloneWorkflowNodeDataForStorage(data) as HttpNodeData;
    const roundTrip = JSON.parse(JSON.stringify(cloned)) as HttpNodeData;
    expect(roundTrip.initialVariables).toEqual({ vin: '1HGCM82633A004748' });
  });

  it('cloneWorkflowNodeDataForStorage strips default Kafka node fields before persistence', () => {
    const data = {
      label: 'Kafka Produce',
      clusterId: 'cluster-a',
      topic: 'orders.created',
      keyTemplate: '',
      headers: [],
      bodyTemplate: '',
      ackMode: 'all',
      timeoutMs: 10000,
      outputBindings: [],
    } as HttpNodeData & Record<string, unknown>;

    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;

    expect(cloned.keyTemplate).toBeUndefined();
    expect(cloned.headers).toBeUndefined();
    expect(cloned.bodyTemplate).toBeUndefined();
    expect(cloned.ackMode).toBeUndefined();
    expect(cloned.timeoutMs).toBeUndefined();
    expect(cloned.outputBindings).toBeUndefined();
    expect(cloned.clusterId).toBe('cluster-a');
    expect(cloned.topic).toBe('orders.created');
  });

  it('cloneWorkflowNodeDataForStorage preserves a non-default produce timeout', () => {
    const data = {
      label: 'Kafka Produce',
      clusterId: 'cluster-a',
      topic: 'orders.created',
      keyTemplate: '',
      headers: [],
      bodyTemplate: '',
      ackMode: 'all',
      timeoutMs: 30000,
      outputBindings: [],
    } as HttpNodeData & Record<string, unknown>;

    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;

    expect(cloned.timeoutMs).toBe(30000);
  });

  it('cloneWorkflowNodeDataForStorage strips the default consume timeout only when the node looks like consume', () => {
    const data = {
      label: 'Kafka Consume',
      clusterId: 'cluster-a',
      topic: 'orders.created',
      keyRegex: '',
      headerFilters: [],
      jsonPathFilters: [],
      timeoutMs: 30000,
      maxMessages: 1,
      startPosition: 'latest',
      loadTestBehavior: { mode: 'wait-for-real' },
      outputBindings: [],
    } as HttpNodeData & Record<string, unknown>;

    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;

    expect(cloned.timeoutMs).toBeUndefined();
    expect(cloned.maxMessages).toBeUndefined();
    expect(cloned.startPosition).toBeUndefined();
    expect(cloned.loadTestBehavior).toBeUndefined();
    expect(cloned.keyRegex).toBeUndefined();
  });

  it('cloneWorkflowNodeDataForStorage preserves a non-empty keyRegex on a consume node', () => {
    const data = {
      label: 'Kafka Consume',
      clusterId: 'cluster-a',
      topic: 'orders.created',
      keyRegex: 'order-\\d+',
      headerFilters: [],
      jsonPathFilters: [],
    } as HttpNodeData & Record<string, unknown>;

    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;

    expect(cloned.keyRegex).toBe('order-\\d+');
  });

  it('cloneWorkflowNodeDataForStorage returns cleaned data when JSON round-trip throws', () => {
    const data: HttpNodeData = {
      label: 'H',
      scenario: {
        id: '1',
        name: 'n',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables: { vin: 'X' },
      runStatus: { state: 'pass' as const },
    } as HttpNodeData & { runStatus: { state: 'pass' } };
    const stringify = JSON.stringify;
    JSON.stringify = () => {
      throw new Error('circular');
    };
    try {
      const cloned = cloneWorkflowNodeDataForStorage(data) as HttpNodeData;
      expect('runStatus' in cloned).toBe(false);
      expect(cloned.initialVariables).toEqual({ vin: 'X' });
    } finally {
      JSON.stringify = stringify;
    }
  });

  // ── Kafka produce node — strip default values ──
  it('cloneWorkflowNodeDataForStorage strips default Kafka produce fields', () => {
    const data = {
      label: 'Produce',
      clusterId: 'c1',
      topic: 'orders',
      keyTemplate: '',
      bodyTemplate: '',
      ackMode: 'all',
      timeoutMs: 10000,
      headers: [],
      outputBindings: [],
      partition: null,
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect('keyTemplate' in cloned).toBe(false);
    expect('bodyTemplate' in cloned).toBe(false);
    expect('ackMode' in cloned).toBe(false);
    expect('timeoutMs' in cloned).toBe(false);
    expect('headers' in cloned).toBe(false);
    expect('outputBindings' in cloned).toBe(false);
    expect('partition' in cloned).toBe(false);
  });

  it('cloneWorkflowNodeDataForStorage preserves non-default Kafka produce fields', () => {
    const data = {
      label: 'Produce',
      clusterId: 'c1',
      topic: 'orders',
      keyTemplate: '{{orderId}}',
      bodyTemplate: '{"id":"{{orderId}}"}',
      ackMode: 'leader',
      timeoutMs: 5000,
      headers: [{ key: 'x-req', value: '1' }],
      partition: 2,
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect(cloned.keyTemplate).toBe('{{orderId}}');
    expect(cloned.bodyTemplate).toBe('{"id":"{{orderId}}"}');
    expect(cloned.ackMode).toBe('leader');
    expect(cloned.timeoutMs).toBe(5000);
    expect(cloned.partition).toBe(2);
  });

  // ── Kafka consume node — strip default values ──
  it('cloneWorkflowNodeDataForStorage strips default Kafka consume fields', () => {
    const data = {
      label: 'Consume',
      clusterId: 'c1',
      topic: 'orders',
      keyRegex: '',
      timeoutMs: 30000,
      maxMessages: 1,
      startPosition: 'latest',
      headerFilters: [],
      jsonPathFilters: [],
      loadTestBehavior: { mode: 'wait-for-real' },
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect('keyRegex' in cloned).toBe(false);
    expect('timeoutMs' in cloned).toBe(false);
    expect('maxMessages' in cloned).toBe(false);
    expect('startPosition' in cloned).toBe(false);
    expect('headerFilters' in cloned).toBe(false);
    expect('jsonPathFilters' in cloned).toBe(false);
    expect('loadTestBehavior' in cloned).toBe(false);
  });

  it('cloneWorkflowNodeDataForStorage preserves non-default Kafka consume fields', () => {
    const data = {
      label: 'Consume',
      clusterId: 'c1',
      topic: 'orders',
      keyRegex: 'order-\\d+',
      timeoutMs: 10000,
      maxMessages: 5,
      startPosition: 'earliest',
      loadTestBehavior: { mode: 'auto-resume' },
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect(cloned.keyRegex).toBe('order-\\d+');
    expect(cloned.timeoutMs).toBe(10000);
    expect(cloned.maxMessages).toBe(5);
    expect(cloned.startPosition).toBe('earliest');
    expect((cloned.loadTestBehavior as Record<string, unknown>)?.mode).toBe('auto-resume');
  });

  // ── Kafka trigger node — strip default values ──
  it('cloneWorkflowNodeDataForStorage strips default Kafka trigger fields', () => {
    const data = {
      label: 'Trigger',
      clusterId: 'c1',
      topic: 'orders',
      maxConcurrentRuns: 10,
      startPosition: 'latest',
      keyRegex: '',
      extractVariables: [],
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect('startPosition' in cloned).toBe(false);
    expect('maxConcurrentRuns' in cloned).toBe(false);
    expect('keyRegex' in cloned).toBe(false);
    expect('extractVariables' in cloned).toBe(false);
  });

  it('cloneWorkflowNodeDataForStorage preserves non-default Kafka trigger fields', () => {
    const data = {
      label: 'Trigger',
      clusterId: 'c1',
      topic: 'orders',
      maxConcurrentRuns: 5,
      startPosition: 'earliest',
      keyRegex: 'pattern',
      extractVariables: [{ name: 'orderId', jsonPath: '$.id' }],
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect(cloned.maxConcurrentRuns).toBe(5);
    expect(cloned.startPosition).toBe('earliest');
    expect(cloned.keyRegex).toBe('pattern');
    expect(Array.isArray(cloned.extractVariables)).toBe(true);
  });

  // ── Kafka wait node — strip default values ──
  it('cloneWorkflowNodeDataForStorage strips default Kafka wait fields', () => {
    const data = {
      label: 'Wait',
      clusterId: 'c1',
      topic: 'orders',
      correlationIdExpression: '{{orderId}}',
      correlationSource: 'value',
      timeoutMs: 60000,
      correlationJsonPath: '$.correlationId',
      keyRegex: '',
      extractVariables: [],
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect('timeoutMs' in cloned).toBe(false);
    expect('correlationJsonPath' in cloned).toBe(false);
    expect('keyRegex' in cloned).toBe(false);
    expect('extractVariables' in cloned).toBe(false);
  });

  it('cloneWorkflowNodeDataForStorage preserves non-default Kafka wait fields', () => {
    const data = {
      label: 'Wait',
      clusterId: 'c1',
      topic: 'orders',
      correlationIdExpression: '{{txId}}',
      correlationSource: 'value',
      timeoutMs: 20000,
      correlationJsonPath: '$.txId',
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect(cloned.timeoutMs).toBe(20000);
    expect(cloned.correlationJsonPath).toBe('$.txId');
  });

  it('cloneWorkflowNodeDataForStorage does not modify non-Kafka node data missing clusterId', () => {
    const data = {
      label: 'Script',
      code: 'return 1;',
    } as unknown as HttpNodeData;
    const cloned = cloneWorkflowNodeDataForStorage(data) as Record<string, unknown>;
    expect(cloned.code).toBe('return 1;');
  });

  it('cloneWorkflowNodeDataForStorage handles null data gracefully', () => {
    const cloned = cloneWorkflowNodeDataForStorage(null as unknown as HttpNodeData);
    expect(cloned).toBeNull();
  });

  it('cloneWorkflowNodeDataForStorage handles non-object primitive gracefully', () => {
    const cloned = cloneWorkflowNodeDataForStorage('string-data' as unknown as HttpNodeData);
    expect(cloned).toBe('string-data');
  });
});
