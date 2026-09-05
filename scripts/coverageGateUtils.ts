import type { CoverageMapData } from 'istanbul-lib-coverage';

export type CoverageMetrics = {
  stmts: number;
  branches: number;
  funcs: number;
  lines: number;
};

export function pct(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

/** True for product gate source roots: src/, src-server/, cli/. */
export function isProductGateSourcePath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return normalized.includes('/src/')
    || normalized.includes('/src-server/')
    || normalized.includes('/cli/');
}

/** Short display path for gate output (src/…, src-server/…, cli/…). */
export function toProductGatePath(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  if (normalized.includes('/src-server/')) {
    return normalized.replace(/.*\/src-server\//, 'src-server/');
  }
  if (normalized.includes('/cli/')) {
    return normalized.replace(/.*\/cli\//, 'cli/');
  }
  if (normalized.includes('/src/')) {
    return normalized.replace(/.*\/src\//, 'src/');
  }
  return normalized;
}

/** @deprecated Use toProductGatePath — kept for allowlist callers. */
export function toSrcPath(file: string): string {
  return toProductGatePath(file);
}

export function shouldSkipProductGateFile(file: string): boolean {
  if (!isProductGateSourcePath(file)) return true;
  if (file.includes('/src/test-utils/')) return true;
  if (file.includes('/src/styles/')) return true;
  if (file.includes('__test-utils__')) return true;
  if (file.includes('.test-utils.')) return true;
  if (file.endsWith('shared/types/index.ts')) return true;
  if (file.includes('.test.')) return true;
  if (file.includes('.testHelpers.')) return true;
  if (file.endsWith('.css') || file.endsWith('.scss') || file.endsWith('.d.ts')) return true;
  return false;
}

export function isAllowlistedPath(file: string, allowlist: string[]): boolean {
  const srcPath = toSrcPath(file);
  return allowlist.some((pattern) => {
    if (pattern.endsWith('/')) return srcPath.startsWith(pattern);
    return srcPath === pattern || srcPath.endsWith(`/${pattern}`);
  });
}

export function computeCoverageMetrics(cov: CoverageMapData): CoverageMetrics {
  const s = cov.s ?? {};
  const f = cov.f ?? {};
  const b = cov.b ?? {};

  const stmtTotal = Object.keys(s).length;
  const stmtCovered = Object.values(s).filter((v) => v > 0).length;
  const fnTotal = Object.keys(f).length;
  const fnCovered = Object.values(f).filter((v) => v > 0).length;

  const branchArr = Object.values(b);
  const branchTotal = branchArr.reduce((a, arr) => a + arr.length, 0);
  const branchCovered = branchArr.reduce((a, arr) => a + arr.filter((v) => v > 0).length, 0);

  const stmtMap = cov.statementMap ?? {};
  const lineSet = new Set(Object.values(stmtMap).map((x) => x.start.line));
  const coveredLines = new Set<number>();
  for (const [id, count] of Object.entries(s)) {
    if (count > 0 && stmtMap[id]) coveredLines.add(stmtMap[id].start.line);
  }

  return {
    stmts: pct(stmtCovered, stmtTotal),
    branches: pct(branchCovered, branchTotal),
    funcs: pct(fnCovered, fnTotal),
    lines: pct(coveredLines.size, lineSet.size),
  };
}