import { describe, expect, it } from 'vitest';
import {
  computeCoverageMetrics,
  isAllowlistedPath,
  isProductGateSourcePath,
  pct,
  shouldSkipProductGateFile,
  toProductGatePath,
  toSrcPath,
} from '../../../scripts/coverageGateUtils';

describe('coverageGateUtils', () => {
  it('normalizes absolute src path to workspace-relative src path', () => {
    expect(toSrcPath('/tmp/work/redfire/src/features/demo.ts')).toBe('src/features/demo.ts');
    expect(toSrcPath('src/features/demo.ts')).toBe('src/features/demo.ts');
    expect(toProductGatePath('/tmp/work/redfire/src-server/routes/demo.ts')).toBe('src-server/routes/demo.ts');
    expect(toProductGatePath('/tmp/work/redfire/cli/runner.ts')).toBe('cli/runner.ts');
    expect(toProductGatePath('/tmp/work/redfire/docs/notes.md')).toBe('/tmp/work/redfire/docs/notes.md');
  });

  it('computes pct with zero-total fallback', () => {
    expect(pct(0, 0)).toBe(100);
    expect(pct(1, 4)).toBe(25);
  });

  it('detects product source roots', () => {
    expect(isProductGateSourcePath('/repo/src/foo.ts')).toBe(true);
    expect(isProductGateSourcePath('/repo/src-server/foo.ts')).toBe(true);
    expect(isProductGateSourcePath('/repo/cli/foo.ts')).toBe(true);
    expect(isProductGateSourcePath('/repo/scripts/foo.ts')).toBe(false);
  });

  it('skips expected product gate helper/test paths', () => {
    expect(shouldSkipProductGateFile('/repo/scripts/foo.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/__test-utils__/x.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/demo.test-utils.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/types/index.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/foo.test.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/foo.testHelpers.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/styles/data-mapper.css')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/features/foo.css')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/test-utils/factories.ts')).toBe(true);
    expect(shouldSkipProductGateFile('/repo/src/shared/foo.ts')).toBe(false);
  });

  it('matches both prefix and exact allowlist patterns', () => {
    const allowlist = ['src/features/grpc/', 'src/shared/utils/helpers.ts'];

    expect(isAllowlistedPath('/repo/src/features/grpc/panel.tsx', allowlist)).toBe(true);
    expect(isAllowlistedPath('/repo/src/shared/utils/helpers.ts', allowlist)).toBe(true);
    expect(isAllowlistedPath('/repo/src/shared/utils/other.ts', allowlist)).toBe(false);
  });

  it('computes per-metric coverage percentages correctly', () => {
    const cov = {
      path: '/repo/src/demo.ts',
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 1 } },
      },
      fnMap: {},
      branchMap: {},
      s: { '0': 1, '1': 0 },
      f: { '0': 1, '1': 0 },
      b: { '0': [1, 0] },
      _coverageSchema: '',
      hash: '',
    };

    const metrics = computeCoverageMetrics(cov);
    expect(metrics.stmts).toBe(50);
    expect(metrics.funcs).toBe(50);
    expect(metrics.branches).toBe(50);
    expect(metrics.lines).toBe(50);
  });

  it('handles missing coverage maps and missing statement map entries', () => {
    const cov = {
      path: '/repo/src/demo2.ts',
      statementMap: {
        '0': { start: { line: 10, column: 0 }, end: { line: 10, column: 1 } },
      },
      s: { '0': 1, 'missing': 1 },
      _coverageSchema: '',
      hash: '',
    };

    const metrics = computeCoverageMetrics(cov as never);
    expect(metrics.stmts).toBe(100);
    expect(metrics.funcs).toBe(100);
    expect(metrics.branches).toBe(100);
    expect(metrics.lines).toBe(100);
  });
});
