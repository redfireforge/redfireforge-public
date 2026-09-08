import { describe, expect, it } from 'vitest';
import { buildConfigVariableInsertHints, collectAncestorNodeIds, collectConditionVariableHints, collectDescendantNodeIds, collectWaitForConditionVariableHints, formatNodeScopedRef, guessConditionLeftMode, guessValueType, buildWorkflowOnlyHints, httpStepDisplayLabel, isHttpWorkflowNode, mergeHttpVariableHintsWithStepInitialVars, mergeWorkflowVariableHints, parseNonGeneratorRefs, parseSingleVariableRef, validateConditionLeftRefs } from './workflowVariableHints';
import { HttpNodeData, WorkflowEdge, WorkflowNode } from '../types/workflow';

describe('collectAncestorNodeIds', () => {
  it('walks incoming edges only', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    expect(collectAncestorNodeIds(edges, 'c')).toEqual(new Set(['a', 'b']));
  });

  it('returns empty set when node has no incoming edges', () => {
    expect(collectAncestorNodeIds([], 'solo')).toEqual(new Set());
  });

  it('handles branching', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'root', target: 'x' },
      { id: 'e2', source: 'root', target: 'y' },
      { id: 'e3', source: 'x', target: 'cond' },
      { id: 'e4', source: 'y', target: 'cond' },
    ];
    expect(collectAncestorNodeIds(edges, 'cond')).toEqual(new Set(['root', 'x', 'y']));
  });
});

describe('collectConditionVariableHints', () => {
  const http = (id: string, extractions?: { name: string }[]): WorkflowNode => ({
    id,
    type: 'http',
    position: { x: 0, y: 0 },
    data: {
      label: 'H',
      scenario: {
        id: 's',
        name: 's',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
        extractions: extractions?.map((e) => ({ name: e.name, source: 'body' as const, expression: '$' })),
      },
    },
  });

  const cond = (id: string): WorkflowNode => ({
    id,
    type: 'condition',
    position: { x: 0, y: 0 },
    data: { label: 'If', left: '{{status}}', operator: '==', right: '200' },
  });

  const refs = (hints: ReturnType<typeof collectConditionVariableHints>) => hints.map((h) => h.ref);

  it('includes workflow vars, upstream extraction names, scoped refs, and status when HTTP upstream exists', () => {
    const nodes: WorkflowNode[] = [http('h1', [{ name: 'token' }]), cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', { baseUrl: 'https://x' });
    expect(refs(hints)).toContain('baseUrl');
    expect(refs(hints)).toContain('token');
    expect(refs(hints)).toContain('node:"H".token');
    expect(refs(hints)).toContain('status');
    expect(refs(hints)).toContain('httpStatus');
    expect(refs(hints)).toContain('node:"H".status');
    expect(refs(hints)).toContain('node:"H".httpStatus');
  });

  it('does not add status or httpStatus without an HTTP ancestor', () => {
    const nodes: WorkflowNode[] = [cond('c')];
    const edges: WorkflowEdge[] = [];
    const hints = collectConditionVariableHints(nodes, edges, 'c', { foo: '1' });
    expect(refs(hints)).toEqual(['foo']);
  });

  it('includes this HTTP step own initial variable names for URL/params insert picker', () => {
    const h = http('h1', [{ name: 'token' }]);
    (h.data as HttpNodeData).initialVariables = { vin: 'VINxxx' };
    const nodes: WorkflowNode[] = [h];
    const edges: WorkflowEdge[] = [];
    const hints = collectConditionVariableHints(nodes, edges, 'h1', {});
    const vin = hints.find((x) => x.ref === 'vin');
    expect(vin).toBeDefined();
    expect(vin?.label).toContain('this step');
  });

  it('does not include per-step initialVariables from HTTP nodes that are not upstream', () => {
    const h1 = http('h1');
    (h1.data as HttpNodeData).initialVariables = { upstreamOnly: '1' };
    const h2 = http('h2');
    (h2.data as HttpNodeData).initialVariables = { stale: '2' };
    const nodes: WorkflowNode[] = [h1, h2, cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', { global: 'g' });
    expect(refs(hints)).toContain('global');
    expect(refs(hints)).toContain('upstreamOnly');
    expect(refs(hints)).toContain('node:"H".upstreamOnly');
    expect(refs(hints)).not.toContain('stale');
    expect(refs(hints)).not.toContain('node:h2.upstreamOnly');
  });

  it('skips extractions with empty name', () => {
    const nodes: WorkflowNode[] = [http('h1', [{ name: '' }, { name: '  ' }, { name: 'valid' }]), cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    expect(refs(hints)).toContain('valid');
    expect(refs(hints)).not.toContain('');
  });

  it('skips upstream HTTP node with no scenario', () => {
    const noScenario: WorkflowNode = {
      id: 'h1', type: 'http', position: { x: 0, y: 0 },
      data: { label: 'NoScenario' },
    };
    const nodes: WorkflowNode[] = [noScenario, cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    // Should still have status since hasHttpAncestor is true
    expect(refs(hints)).toContain('status');
  });

  it('includes error.* hints when ErrorHandler is an ancestor', () => {
    const errHandler: WorkflowNode = {
      id: 'eh1', type: 'errorHandler', position: { x: 0, y: 0 },
      data: { label: 'API Guard', errorFilter: 'all', retryCount: 0, retryDelayMs: 1000, retryBackoff: 'fixed', retryTimeoutMs: 0, continueOnError: false },
    };
    const nodes: WorkflowNode[] = [errHandler, cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'eh1', target: 'c', sourceHandle: 'catch' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    expect(refs(hints)).toContain('error.message');
    expect(refs(hints)).toContain('error.statusCode');
    expect(refs(hints)).toContain('error.nodeId');
    expect(refs(hints)).toContain('error.nodeLabel');
    expect(refs(hints)).toContain('error.retryCount');
    expect(refs(hints)).toContain('error.type');
  });

  it('does not include error.* hints without an ErrorHandler ancestor', () => {
    const nodes: WorkflowNode[] = [http('h1'), cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    expect(refs(hints)).not.toContain('error.message');
    expect(refs(hints)).not.toContain('error.statusCode');
  });

  it('includes hints from diverse non-HTTP ancestor node types', () => {
    const nodes: WorkflowNode[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start', inputVariables: { triggerIn: '1' } } },
      { id: 'sv', type: 'setVariable', position: { x: 0, y: 0 }, data: { label: 'Set', assignments: [{ name: 'assigned', expression: '1' }] } },
      { id: 'scr', type: 'script', position: { x: 0, y: 0 }, data: { label: 'Script', code: '', outputVariables: ['scriptOut'] } },
      { id: 'agg', type: 'aggregate', position: { x: 0, y: 0 }, data: { label: 'Agg', mappings: [
        { targetVariable: 'concatVar', strategy: 'concat', sourceVariable: 'x' },
        { targetVariable: 'countVar', strategy: 'count', sourceVariable: 'x' },
        { targetVariable: 'sumVar', strategy: 'sum', sourceVariable: 'x' },
        { targetVariable: 'customVar', strategy: 'custom', sourceVariable: 'x' },
      ] } },
      { id: 'loop', type: 'loop', position: { x: 0, y: 0 }, data: { label: 'Loop', mode: 'forEach', collection: 'items', itemVariable: 'row', indexVariable: 'idx' } },
      { id: 'wait', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 100, timeoutMs: 1000 } },
      { id: 'kp', type: 'kafkaProduce', position: { x: 0, y: 0 }, data: { label: 'Produce', outputBindings: [{ targetVariable: 'prodMeta', source: 'offset', enabled: true }] } },
      { id: 'kc', type: 'kafkaConsume', position: { x: 0, y: 0 }, data: { label: 'Consume', outputBindings: [{ targetVariable: 'consMeta', source: 'key', enabled: true }] } },
      { id: 'kt', type: 'kafkaTrigger', position: { x: 0, y: 0 }, data: { label: 'KTrigger', extractVariables: [{ name: 'kExt', jsonPath: '$.id' }] } },
      { id: 'kw', type: 'kafkaWait', position: { x: 0, y: 0 }, data: { label: 'KWait', extractVariables: [{ name: 'kwExt', jsonPath: '$.ok' }] } },
      { id: 'wc', type: 'wsConnect', position: { x: 0, y: 0 }, data: { label: 'WS', url: 'ws://x', outputBindings: [{ variableName: 'wsProto', field: 'protocol', enabled: true }] } },
      { id: 'ws', type: 'wsSend', position: { x: 0, y: 0 }, data: { label: 'WSSend', connectionId: 'c1', message: 'hi', waitForResponse: true, outputBindings: [{ variableName: 'wsResp', field: 'responseBody', enabled: true }] } },
      { id: 'wr', type: 'wsReceive', position: { x: 0, y: 0 }, data: { label: 'WSRecv', connectionId: 'c1', extractionRules: [{ variableName: 'wsExt', jsonPath: '$.a' }], outputBindings: [{ variableName: 'wsBody', field: 'messageBody', enabled: true }] } },
      { id: 'wt', type: 'wsTrigger', position: { x: 0, y: 0 }, data: { label: 'WSTrig', extractionRules: [{ variableName: 'wtExt', jsonPath: '$.b' }] } },
      cond('c'),
    ];
    const edges: WorkflowEdge[] = nodes.slice(0, -1).map((n, i) => ({
      id: `e${i}`,
      source: n.id,
      target: nodes[i + 1].id,
    }));
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    const r = refs(hints);
    expect(r).toContain('triggerIn');
    expect(r).toContain('assigned');
    expect(r).toContain('scriptOut');
    expect(r).toContain('concatVar');
    expect(r).toContain('countVar');
    expect(r).toContain('sumVar');
    expect(r).toContain('customVar');
    expect(r).toContain('row');
    expect(r).toContain('idx');
    expect(r).toContain('wait.attempts');
    expect(r).toContain('prodMeta');
    expect(r).toContain('consMeta');
    expect(r).toContain('kafka.trigger.topic');
    expect(r).toContain('kExt');
    expect(r).toContain('kafka.wait.topic');
    expect(r).toContain('kwExt');
    expect(r).toContain('wsProto');
    expect(r).toContain('wsResp');
    expect(r).toContain('wsExt');
    expect(r).toContain('wsBody');
    expect(r).toContain('ws.trigger.message');
    expect(r).toContain('wtExt');
  });

  it('uses default labels and skips empty names across node types', () => {
    const nodes: WorkflowNode[] = [
      { id: 'sv', type: 'setVariable', position: { x: 0, y: 0 }, data: { assignments: [{ name: '  ', expression: '1' }, { name: 'ok', expression: '2' }] } },
      { id: 'agg', type: 'aggregate', position: { x: 0, y: 0 }, data: { mappings: [{ targetVariable: 'firstVar', strategy: 'first', sourceVariable: 'x' }] } },
      { id: 'loop', type: 'loop', position: { x: 0, y: 0 }, data: { mode: 'while', collection: '', itemVariable: 'item', indexVariable: 'i' } },
      { id: 'ws', type: 'wsSend', position: { x: 0, y: 0 }, data: { connectionId: 'c1', message: 'x', waitForResponse: false, outputBindings: [{ variableName: 'skip', field: 'responseBody', enabled: true }] } },
      cond('c'),
    ];
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'sv', target: 'agg' }, { id: 'e2', source: 'agg', target: 'loop' }, { id: 'e3', source: 'loop', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    const r = refs(hints);
    expect(r).toContain('ok');
    expect(r).toContain('firstVar');
    expect(r).not.toContain('skip');
    expect(r).not.toContain('item');
    expect(r).toContain('i');
  });

  it('deduplicates refs when push sees the same ref twice', () => {
    const nodes: WorkflowNode[] = [http('h1', [{ name: 'token' }]), cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', { token: 'dup' });
    expect(hints.filter((h) => h.ref === 'token')).toHaveLength(1);
  });

  it('covers aggregate last strategy and default label fallbacks', () => {
    const nodes: WorkflowNode[] = [
      { id: 'agg', type: 'aggregate', position: { x: 0, y: 0 }, data: { mappings: [{ targetVariable: 'lastVar', strategy: 'last', sourceVariable: 'x' }, { targetVariable: 'weirdVar', strategy: 'unknown', sourceVariable: 'y' }] } },
      { id: 'sv', type: 'setVariable', position: { x: 0, y: 0 }, data: { assignments: [{ name: 'x', expression: '1' }] } },
      { id: 'scr', type: 'script', position: { x: 0, y: 0 }, data: { code: '', outputVariables: ['out'] } },
      { id: 'wait', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1, timeoutMs: 1 } },
      { id: 'err', type: 'errorHandler', position: { x: 0, y: 0 }, data: {} },
      { id: 'st', type: 'start', position: { x: 0, y: 0 }, data: { inputVariables: { inVar: 'v' } } },
      cond('c'),
    ];
    const edges: WorkflowEdge[] = nodes.slice(0, -1).map((n, i) => ({ id: `e${i}`, source: n.id, target: nodes[i + 1].id }));
    const hints = collectConditionVariableHints(nodes, edges, 'c', { '  ': 'skip', ok: '1' });
    const r = refs(hints);
    expect(r).toContain('lastVar');
    expect(r).toContain('weirdVar');
    expect(r).toContain('out');
    expect(r).toContain('wait.attempts');
    expect(r).toContain('error.message');
    expect(r).toContain('inVar');
    expect(r).toContain('ok');
    expect(r).not.toContain('  ');
  });

  it('skips disabled kafka and ws output bindings', () => {
    const nodes: WorkflowNode[] = [
      { id: 'kp', type: 'kafkaProduce', position: { x: 0, y: 0 }, data: { outputBindings: [{ targetVariable: 'off', source: 'offset', enabled: false }, { targetVariable: 'on', source: 'key', enabled: true }] } },
      { id: 'kc', type: 'kafkaConsume', position: { x: 0, y: 0 }, data: { outputBindings: [{ targetVariable: 'off2', source: 'value', enabled: false }] } },
      { id: 'wc', type: 'wsConnect', position: { x: 0, y: 0 }, data: { url: 'ws://x', outputBindings: [{ variableName: 'off3', field: 'protocol', enabled: false }] } },
      { id: 'kt', type: 'kafkaTrigger', position: { x: 0, y: 0 }, data: { extractVariables: [{ name: '  ', jsonPath: '$.a' }, { name: 'ext', jsonPath: '$.b' }] } },
      cond('c'),
    ];
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'kp', target: 'kc' }, { id: 'e2', source: 'kc', target: 'wc' }, { id: 'e3', source: 'wc', target: 'kt' }, { id: 'e4', source: 'kt', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    const r = refs(hints);
    expect(r).toContain('on');
    expect(r).not.toContain('off');
    expect(r).not.toContain('off2');
    expect(r).not.toContain('off3');
    expect(r).toContain('ext');
    expect(r).toContain('kafka.trigger.topic');
  });

  it('includes this-step initial vars when configuring an HTTP condition node', () => {
    const h = http('h1');
    (h.data as HttpNodeData).initialVariables = { '': 'skip', stepVar: '42' };
    const nodes: WorkflowNode[] = [h];
    const hints = collectConditionVariableHints(nodes, [], 'h1', {});
    expect(refs(hints)).toContain('stepVar');
    expect(refs(hints)).not.toContain('');
  });

  it('includes upstream initial vars and scoped refs with empty extraction names skipped', () => {
    const h = http('h1', [{ name: '' }, { name: 'good' }]);
    (h.data as HttpNodeData).initialVariables = { upstreamVar: '9' };
    const nodes: WorkflowNode[] = [h, cond('c')];
    const edges: WorkflowEdge[] = [{ id: 'e', source: 'h1', target: 'c' }];
    const hints = collectConditionVariableHints(nodes, edges, 'c', {});
    const r = refs(hints);
    expect(r).toContain('upstreamVar');
    expect(r).toContain('node:"H".upstreamVar');
    expect(r).toContain('good');
    expect(r.some((x) => x.endsWith('.') && x.startsWith('node:"H".'))).toBe(false);
  });
});

describe('isHttpWorkflowNode', () => {
  it('treats nodes with scenario data as HTTP when type is missing', () => {
    const n: WorkflowNode = {
      id: 'x',
      type: 'http' as WorkflowNode['type'],
      position: { x: 0, y: 0 },
      data: { label: 'L', scenario: { id: 's', name: 'n', url: '/', method: 'GET', headers: [], body: '', auth: { type: 'none' }, validation: { mode: 'none' } } },
    };
    const loose = { ...n, type: undefined as unknown as WorkflowNode['type'] };
    expect(isHttpWorkflowNode(n)).toBe(true);
    expect(isHttpWorkflowNode(loose as WorkflowNode)).toBe(true);
  });

  it('returns false for known non-http workflow node types', () => {
    expect(isHttpWorkflowNode({ id: 'k', type: 'kafkaProduce', position: { x: 0, y: 0 }, data: {} })).toBe(false);
  });

  it('does not treat API Mock nodes as HTTP even if data has a scenario key', () => {
    expect(isHttpWorkflowNode({
      id: 'am',
      type: 'apiMockStart',
      position: { x: 0, y: 0 },
      data: { label: 'Start Mock Server', serverId: 'srv-1', scenario: { id: 'leak' } },
    })).toBe(false);
  });
});

describe('mergeWorkflowVariableHints', () => {
  it('returns workflow hints when primary list is empty', () => {
    const wf = buildWorkflowOnlyHints({ a: '1' });
    expect(mergeWorkflowVariableHints([], wf)).toEqual(wf);
  });

  it('merges without overwriting primary refs', () => {
    const primary = [{ ref: 'a', label: 'primary' }];
    const wf = [{ ref: 'b', label: 'workflow' }];
    const merged = mergeWorkflowVariableHints(primary, wf);
    expect(merged.map((h) => h.ref)).toEqual(['a', 'b']);
    expect(merged.find((h) => h.ref === 'a')?.label).toBe('primary');
  });
});

describe('mergeHttpVariableHintsWithStepInitialVars', () => {
  const minimalHttp = (): HttpNodeData => ({
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
    initialVariables: { vin: 'VIN1' },
  });

  it('adds this-step keys when base hints are empty', () => {
    const merged = mergeHttpVariableHintsWithStepInitialVars([], minimalHttp());
    expect(merged.map((h) => h.ref)).toContain('vin');
    expect(merged.find((h) => h.ref === 'vin')?.label).toContain('this step');
  });

  it('does not duplicate refs already in base hints', () => {
    const base = [{ ref: 'vin', label: 'vin (workflow)' }];
    const merged = mergeHttpVariableHintsWithStepInitialVars(base, minimalHttp());
    expect(merged.filter((h) => h.ref === 'vin')).toHaveLength(1);
  });

  it('skips empty/whitespace-only initialVariable keys', () => {
    const data = minimalHttp();
    data.initialVariables = { '': 'val1', '  ': 'val2', valid: 'val3' };
    const merged = mergeHttpVariableHintsWithStepInitialVars([], data);
    expect(merged.map(h => h.ref)).toEqual(['valid']);
  });

  it('handles httpData with no initialVariables', () => {
    const data = minimalHttp();
    delete (data as Record<string, unknown>).initialVariables;
    const merged = mergeHttpVariableHintsWithStepInitialVars([], data);
    expect(merged).toEqual([]);
  });
});

describe('parse and validate', () => {
  it('parseNonGeneratorRefs skips generators', () => {
    expect(parseNonGeneratorRefs('{{a}} and {{$uuid}}')).toEqual(['a']);
  });

  it('parseNonGeneratorRefs includes node-scoped inner keys', () => {
    expect(parseNonGeneratorRefs('{{node:"My Step".channel}}')).toEqual(['node:"My Step".channel']);
  });

  it('parseSingleVariableRef', () => {
    expect(parseSingleVariableRef('  {{ status }}  ')).toBe('status');
    expect(parseSingleVariableRef('{{node:abc-123.x}}')).toBe('node:abc-123.x');
    expect(parseSingleVariableRef('{{a}}x')).toBe(null);
  });

  it('validateConditionLeftRefs with string hints', () => {
    expect(validateConditionLeftRefs('{{status}}', ['status']).ok).toBe(true);
    expect(validateConditionLeftRefs('{{nope}}', ['status']).unknown).toEqual(['nope']);
  });

  it('validateConditionLeftRefs with WorkflowVariableHint[]', () => {
    const hints = [{ ref: 'node:"H".token', label: 't' }];
    expect(validateConditionLeftRefs('{{node:"H".token}}', hints).ok).toBe(true);
    expect(validateConditionLeftRefs('{{other}}', hints).unknown).toEqual(['other']);
  });

  it('validateConditionLeftRefs with empty hints array', () => {
    expect(validateConditionLeftRefs('{{x}}', []).ok).toBe(false);
    expect(validateConditionLeftRefs('{{x}}', []).unknown).toEqual(['x']);
  });

  it('validateConditionLeftRefs ok when no refs in template', () => {
    expect(validateConditionLeftRefs('plain text', []).ok).toBe(true);
    expect(validateConditionLeftRefs('plain text', []).unknown).toEqual([]);
  });
});

describe('httpStepDisplayLabel', () => {
  it('returns label when present', () => {
    expect(httpStepDisplayLabel({ label: 'My Step' } as HttpNodeData)).toBe('My Step');
  });
  it('returns scenario name when label is empty', () => {
    expect(httpStepDisplayLabel({ label: '', scenario: { name: 'Scenario Name' } } as unknown as HttpNodeData)).toBe('Scenario Name');
  });
  it('returns HTTP when both label and scenario name are empty', () => {
    expect(httpStepDisplayLabel({ label: '', scenario: { name: '' } } as unknown as HttpNodeData)).toBe('HTTP');
  });
  it('returns HTTP when label is whitespace only and no scenario name', () => {
    expect(httpStepDisplayLabel({ label: '  ', scenario: { name: '  ' } } as unknown as HttpNodeData)).toBe('HTTP');
  });
});

describe('formatNodeScopedRef', () => {
  it('uses label in quotes when safe', () => {
    expect(formatNodeScopedRef('n1', 'Step A', 'token')).toBe('node:"Step A".token');
  });
  it('falls back to nodeId when label contains double quote', () => {
    expect(formatNodeScopedRef('n1', 'Step "A"', 'token')).toBe('node:n1.token');
  });
  it('falls back to nodeId when label is empty', () => {
    expect(formatNodeScopedRef('n1', '', 'token')).toBe('node:n1.token');
  });
  it('falls back to nodeId when label has newline', () => {
    expect(formatNodeScopedRef('n1', 'Step\nA', 'token')).toBe('node:n1.token');
  });
});

describe('guessConditionLeftMode', () => {
  it('returns pick for single variable ref', () => {
    expect(guessConditionLeftMode('{{status}}')).toBe('pick');
  });
  it('returns expr for expression with text around ref', () => {
    expect(guessConditionLeftMode('value is {{x}}')).toBe('expr');
  });
  it('returns expr for plain text without ref', () => {
    expect(guessConditionLeftMode('plain')).toBe('expr');
  });
  it('returns expr for generator ref', () => {
    expect(guessConditionLeftMode('{{$uuid}}')).toBe('expr');
  });
});

describe('guessValueType', () => {
  it('returns boolean for "true"', () => {
    expect(guessValueType('true')).toBe('boolean');
  });
  it('returns boolean for "false"', () => {
    expect(guessValueType('false')).toBe('boolean');
  });
  it('returns number for numeric strings', () => {
    expect(guessValueType('42')).toBe('number');
    expect(guessValueType('3.14')).toBe('number');
    expect(guessValueType('-1')).toBe('number');
    expect(guessValueType('0')).toBe('number');
  });
  it('returns string for empty string', () => {
    expect(guessValueType('')).toBe('string');
  });
  it('returns string for non-numeric strings', () => {
    expect(guessValueType('hello')).toBe('string');
    expect(guessValueType('https://example.com')).toBe('string');
  });
});

describe('buildWorkflowOnlyHints', () => {
  it('returns empty array for empty input', () => {
    expect(buildWorkflowOnlyHints({})).toEqual([]);
  });

  it('returns sorted hints with type and description', () => {
    const hints = buildWorkflowOnlyHints({ zVar: 'hello', aVar: '42' });
    expect(hints.length).toBe(2);
    expect(hints[0].ref).toBe('aVar');
    expect(hints[0].type).toBe('number');
    expect(hints[0].label).toBe('aVar (workflow)');
    expect(hints[0].description).toContain('42');
    expect(hints[0].source).toEqual({ nodeLabel: 'Workflow Defaults', nodeType: 'workflow', category: 'Workflow' });
    expect(hints[0].defaultValue).toBe('42');
    expect(hints[1].ref).toBe('zVar');
    expect(hints[1].type).toBe('string');
    expect(hints[1].source?.category).toBe('Workflow');
  });

  it('skips empty/whitespace-only keys', () => {
    const hints = buildWorkflowOnlyHints({ '': 'x', '  ': 'y', valid: 'z' });
    expect(hints.length).toBe(1);
    expect(hints[0].ref).toBe('valid');
  });

  it('correctly types boolean values', () => {
    const hints = buildWorkflowOnlyHints({ flag: 'true' });
    expect(hints[0].type).toBe('boolean');
  });
});

describe('buildConfigVariableInsertHints', () => {
  const httpNode = (initialVariables?: Record<string, string>): WorkflowNode => ({
    id: 'http-1',
    type: 'http',
    position: { x: 0, y: 0 },
    data: {
      label: 'HTTP Step',
      scenario: {
        id: 'scenario-1',
        name: 'HTTP Scenario',
        url: '/',
        method: 'GET',
        headers: [],
        body: '',
        auth: { type: 'none' },
        validation: { mode: 'none' },
      },
      initialVariables,
    },
  });

  it('merges HTTP and workflow hints without duplicates', () => {
    const hints = buildConfigVariableInsertHints({
      node: httpNode({ token: 'abc' }),
      workflowVariables: { baseUrl: 'https://example.com', token: 'workflow-token' },
      httpVariableHints: [{ ref: 'status', label: 'status (latest)' }],
    });

    expect(hints.map((hint) => hint.ref)).toEqual(['baseUrl', 'status', 'token']);
    expect(hints.find((hint) => hint.ref === 'token')?.label).toContain('this step');
  });

  it('merges condition and workflow hints for non-HTTP nodes', () => {
    const hints = buildConfigVariableInsertHints({
      node: {
        id: 'log-1',
        type: 'logDebug',
        position: { x: 0, y: 0 },
        data: { label: 'Logger', message: '{{status}}', logLevel: 'info' },
      } as WorkflowNode,
      workflowVariables: { baseUrl: 'https://example.com' },
      conditionVariableHints: [{ ref: 'status', label: 'status (latest)' }],
    });

    expect(hints.map((hint) => hint.ref)).toEqual(['baseUrl', 'status']);
  });

  it('returns workflow-only hints when there is no selected node', () => {
    const hints = buildConfigVariableInsertHints({
      node: null,
      workflowVariables: { alpha: '1', beta: '2' },
    });

    expect(hints.map((hint) => hint.ref)).toEqual(['alpha', 'beta']);
  });
});

// ── collectDescendantNodeIds ──

describe('collectDescendantNodeIds', () => {
  it('collects direct descendants', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'A', target: 'C' },
    ];
    const result = collectDescendantNodeIds(edges, 'A');
    expect(result).toEqual(new Set(['B', 'C']));
  });

  it('collects transitive descendants', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'C' },
      { id: 'e3', source: 'C', target: 'D' },
    ];
    const result = collectDescendantNodeIds(edges, 'A');
    expect(result).toEqual(new Set(['B', 'C', 'D']));
  });

  it('handles cycles without infinite loop', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'C' },
      { id: 'e3', source: 'C', target: 'A' },
    ];
    const result = collectDescendantNodeIds(edges, 'A');
    expect(result).toEqual(new Set(['B', 'C']));
  });

  it('filters by sourceHandle when provided', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', target: 'B', sourceHandle: 'body' },
      { id: 'e2', source: 'A', target: 'C', sourceHandle: 'out' },
    ];
    const result = collectDescendantNodeIds(edges, 'A', 'body');
    expect(result).toEqual(new Set(['B']));
  });

  it('returns empty set when node has no outgoing edges', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'X', target: 'Y' },
    ];
    const result = collectDescendantNodeIds(edges, 'A');
    expect(result).toEqual(new Set());
  });
});

// ── collectWaitForConditionVariableHints ──

describe('collectWaitForConditionVariableHints', () => {
  it('includes built-in wait variables', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
    ];
    const edges: WorkflowEdge[] = [];
    const hints = collectWaitForConditionVariableHints(nodes, edges, 'wait-1', {});
    const refs = hints.map(h => h.ref);
    expect(refs).toContain('wait.attempts');
    expect(refs).toContain('wait.elapsed');
    expect(refs).toContain('wait.conditionMet');
  });

  it('includes HTTP step extractions from poll-body subgraph', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
      {
        id: 'http-1', type: 'http', position: { x: 0, y: 100 },
        data: {
          label: 'Check Status', method: 'GET', url: 'https://api.test/status', scenario: {
            extractions: [{ name: 'status', source: 'body', path: '$.status' }],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'wait-1', target: 'http-1', sourceHandle: 'body' },
    ];
    const hints = collectWaitForConditionVariableHints(nodes, edges, 'wait-1', {});
    const refs = hints.map(h => h.ref);
    expect(refs).toContain('status');
    expect(refs).toContain('wait.attempts');
  });

  it('includes workflow variables', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
    ];
    const hints = collectWaitForConditionVariableHints(nodes, [], 'wait-1', { baseUrl: 'https://api.test' });
    expect(hints.map(h => h.ref)).toContain('baseUrl');
  });

  it('includes poll-body initial variables from HTTP descendants', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
      {
        id: 'http-2', type: 'http', position: { x: 0, y: 100 },
        data: {
          label: 'Poll Step',
          scenario: { extractions: [] },
          initialVariables: { pollVar: '42' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    ];
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'wait-1', target: 'http-2', sourceHandle: 'body' }];
    const hints = collectWaitForConditionVariableHints(nodes, edges, 'wait-1', {});
    expect(hints.map(h => h.ref)).toContain('pollVar');
  });

  it('adds poll-body extractions and skips duplicate refs', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
      {
        id: 'http-3', type: 'http', position: { x: 0, y: 100 },
        data: {
          label: 'Poll Step',
          scenario: { extractions: [{ name: 'status', source: 'body', expression: '$.status' }, { name: '  ', source: 'body', expression: '$' }] },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    ];
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'wait-1', target: 'http-3', sourceHandle: 'body' }];
    const hints = collectWaitForConditionVariableHints(nodes, edges, 'wait-1', { status: '200' });
    const r = hints.map((h) => h.ref);
    expect(r).toContain('status');
    expect(r.filter((x) => x === 'status')).toHaveLength(1);
  });

  it('skips poll-body http nodes without scenario', () => {
    const nodes: WorkflowNode[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'wait-1', type: 'waitForCondition', position: { x: 0, y: 0 }, data: { label: 'Wait', condition: { left: '', op: 'eq', right: '' }, pollIntervalMs: 1000, timeoutMs: 30000 } as any },
      { id: 'http-4', type: 'http', position: { x: 0, y: 100 }, data: { label: 'No Scenario' } },
    ];
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'wait-1', target: 'http-4', sourceHandle: 'body' }];
    const hints = collectWaitForConditionVariableHints(nodes, edges, 'wait-1', {});
    expect(hints.map((h) => h.ref)).toContain('wait.attempts');
  });
});
