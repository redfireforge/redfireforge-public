/**
 * Coverage gaps — grpcMockPredicateSandbox.ts (Phase 11D).
 */
import { describe, expect, it } from 'vitest';
import {
  GrpcMockPredicateParseError,
  GrpcMockPredicateSecurityError,
  evaluateGrpcMockPredicate,
  parseGrpcMockPredicateExpression,
} from './grpcMockPredicateSandbox';
import type { GrpcMockEvaluationContext } from './grpcMockRuleContracts';

function makeContext(overrides: Partial<GrpcMockEvaluationContext> = {}): GrpcMockEvaluationContext {
  return {
    service: 'echo.EchoService',
    method: 'Echo',
    callType: 'unary',
    metadata: { 'x-tenant': 'acme', authorization: 'Bearer token' },
    requestBody: { message: 'hello', nested: { count: 2 }, flag: true },
    ...overrides,
  };
}

describe('grpcMockPredicateSandbox coverage gaps', () => {
  it('tokenizes numeric literals including negative numbers', () => {
    const predicate = parseGrpcMockPredicateExpression('request.count == -42');
    expect(predicate).toEqual({ kind: 'body_path_equals', path: 'count', value: '-42' });
  });

  it('parses inequality operators for method and request paths', () => {
    expect(parseGrpcMockPredicateExpression('method != "Echo"')).toEqual({
      kind: 'not',
      predicate: { kind: 'method_equals', method: 'Echo' },
    });
    expect(parseGrpcMockPredicateExpression('request.message != "hello"')).toEqual({
      kind: 'not',
      predicate: { kind: 'body_path_equals', path: 'message', value: 'hello' },
    });
  });

  it('parses request existence checks without comparison operators', () => {
    const predicate = parseGrpcMockPredicateExpression('request.nested.count');
    expect(predicate).toEqual({ kind: 'body_path_exists', path: 'nested.count' });
    expect(evaluateGrpcMockPredicate(predicate, makeContext())).toBe(true);
    expect(evaluateGrpcMockPredicate(predicate, makeContext({ requestBody: {} }))).toBe(false);
  });

  it('parses metadata inequality and dotted keys', () => {
    const predicate = parseGrpcMockPredicateExpression('metadata.authorization != "Bearer token"');
    expect(predicate).toEqual({
      kind: 'not',
      predicate: { kind: 'metadata_equals', key: 'authorization', value: 'Bearer token' },
    });
    expect(evaluateGrpcMockPredicate(predicate, makeContext({ metadata: { authorization: 'other' } }))).toBe(true);
  });

  it('parses boolean and numeric literal tokens', () => {
    expect(parseGrpcMockPredicateExpression('request.flag == true')).toEqual({
      kind: 'body_path_equals',
      path: 'flag',
      value: 'true',
    });
    expect(parseGrpcMockPredicateExpression('request.count == 2')).toEqual({
      kind: 'body_path_equals',
      path: 'count',
      value: '2',
    });
  });

  it('rejects unterminated string literals and unexpected characters', () => {
    expect(() => parseGrpcMockPredicateExpression('method == "Echo')).toThrow(GrpcMockPredicateParseError);
    expect(() => parseGrpcMockPredicateExpression('method @ "Echo"')).toThrow(GrpcMockPredicateParseError);
  });

  it('rejects unsafe request and metadata path segments', () => {
    expect(() => parseGrpcMockPredicateExpression('request.__proto__ == "x"'))
      .toThrow(GrpcMockPredicateSecurityError);
    expect(() => parseGrpcMockPredicateExpression('metadata.__proto__ == "x"'))
      .toThrow(GrpcMockPredicateSecurityError);
  });

  it('evaluates expression predicates and compares object values via JSON', () => {
    expect(evaluateGrpcMockPredicate(
      { kind: 'body_path_equals', path: 'nested', value: '{"count":2}' },
      makeContext(),
    )).toBe(true);
    expect(evaluateGrpcMockPredicate(
      { kind: 'expression', expression: 'method == "Echo" AND request.nested.count == 2' },
      makeContext(),
    )).toBe(true);
  });

  it('evaluates boolean body values and null paths safely', () => {
    expect(evaluateGrpcMockPredicate(
      { kind: 'body_path_equals', path: 'flag', value: 'true' },
      makeContext(),
    )).toBe(true);
    expect(evaluateGrpcMockPredicate(
      { kind: 'body_path_exists', path: '__proto__' },
      makeContext(),
    )).toBe(false);
  });

  it('returns false for unsupported predicate kinds at evaluation time', () => {
    expect(evaluateGrpcMockPredicate(
      { kind: 'unsupported' } as unknown as Parameters<typeof evaluateGrpcMockPredicate>[0],
      makeContext(),
    )).toBe(false);
  });

  it('parses service equality and inequality', () => {
    expect(parseGrpcMockPredicateExpression('service == "echo.EchoService"')).toEqual({
      kind: 'service_equals',
      service: 'echo.EchoService',
    });
    expect(evaluateGrpcMockPredicate(
      parseGrpcMockPredicateExpression('service != "other.Service"'),
      makeContext(),
    )).toBe(true);
  });

  it('parses OR and AND combinations and parenthesized groups', () => {
    const expr = '(method == "Echo" OR method == "Other") AND request.flag == true';
    const predicate = parseGrpcMockPredicateExpression(expr);
    expect(evaluateGrpcMockPredicate(predicate, makeContext())).toBe(true);
    expect(evaluateGrpcMockPredicate(predicate, makeContext({ requestBody: { flag: false } }))).toBe(false);
  });

  it('rejects unsafe service and request path segments', () => {
    expect(() => parseGrpcMockPredicateExpression('request.constructor == "x"'))
      .toThrow(GrpcMockPredicateSecurityError);
    expect(() => parseGrpcMockPredicateExpression('request.prototype == "x"'))
      .toThrow(GrpcMockPredicateSecurityError);
  });

  it('rejects trailing tokens after a complete expression', () => {
    expect(() => parseGrpcMockPredicateExpression('method == "Echo" extra'))
      .toThrow(GrpcMockPredicateParseError);
  });
});
