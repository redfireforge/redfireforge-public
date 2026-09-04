import { describe, it, expect } from 'vitest';
import { cliReportsCiLesson } from './cli-reports-ci';

describe('cli-reports-ci lesson', () => {
  it('has valid lesson structure', () => {
    expect(cliReportsCiLesson.id).toBe('cli-reports-ci');
    expect(cliReportsCiLesson.domainId).toBe('cli');
    expect(cliReportsCiLesson.category).toBe('data-and-ci');
    expect(cliReportsCiLesson.estimatedMinutes).toBe(8);
    expect(cliReportsCiLesson.desktopOnly).toBe(false);
    expect(cliReportsCiLesson.initialTab).toBeUndefined();
    expect(cliReportsCiLesson.steps.map(s => s.id)).toEqual([
      'cli6-json-report',
      'cli6-json-stdout',
      'cli6-json-pipe',
      'cli6-junit',
      'cli6-markdown',
      'cli6-quiet',
      'cli6-github-actions',
      'cli6-recap',
    ]);
  });

  it('has a concept slide with key terms and a diagram', () => {
    expect(cliReportsCiLesson.concept.title).toBe('Reports & CI/CD Integration');
    expect(cliReportsCiLesson.concept.keyTerms?.length).toBe(4);
    expect(cliReportsCiLesson.concept.diagram).toContain('<svg');
  });

  it('every step is a terminal step (no DOM highlight/action)', () => {
    for (const step of cliReportsCiLesson.steps) {
      expect(step.highlight).toBeUndefined();
      expect(step.action).toBeUndefined();
      expect(Boolean(step.terminalCommand || step.terminalOutput)).toBe(true);
    }
  });

  it('every terminalHighlightLines range is within bounds of its own terminalOutput', () => {
    for (const step of cliReportsCiLesson.steps) {
      if (!step.terminalHighlightLines) continue;
      const lineCount = step.terminalOutput?.split('\n').length ?? 0;
      for (const [start, end] of step.terminalHighlightLines) {
        expect(start).toBeGreaterThanOrEqual(1);
        expect(end).toBeGreaterThanOrEqual(start);
        expect(end).toBeLessThanOrEqual(lineCount);
      }
    }
  });

  it('each report format step shows its distinct real output shape', () => {
    const json = cliReportsCiLesson.steps.find(s => s.id === 'cli6-json-report');
    expect(json?.terminalOutput).toContain('"summary"');
    expect(json?.terminalOutput).toContain('"results"');

    const junit = cliReportsCiLesson.steps.find(s => s.id === 'cli6-junit');
    expect(junit?.terminalOutput).toContain('<testsuites');
    expect(junit?.terminalOutput).toContain('<testcase');

    const markdown = cliReportsCiLesson.steps.find(s => s.id === 'cli6-markdown');
    expect(markdown?.terminalOutput).toContain('## Result: PASSED ✅');
  });

  it('quiet-mode step contrasts header lines present vs absent', () => {
    const quiet = cliReportsCiLesson.steps.find(s => s.id === 'cli6-quiet');
    expect(quiet?.terminalOutput).toContain('Loading:');
    expect(quiet?.terminalOutput).toContain('Suite:');
  });

  it('github actions step reflects the real cli-ci-cd.md guide content', () => {
    const gha = cliReportsCiLesson.steps.find(s => s.id === 'cli6-github-actions');
    expect(gha?.terminalOutput).toContain('mikepenz/action-junit-report@v4');
    expect(gha?.terminalOutput).toContain('if: always()');
  });

  it('recap step has no live command, only a comment cheat sheet', () => {
    const recap = cliReportsCiLesson.steps.find(s => s.id === 'cli6-recap');
    expect(recap?.terminalCommand).toBeUndefined();
    expect(recap?.terminalOutput).toContain('--data-rows-summary');
  });

  it('stdout-json step shows the flat CI shape and a preserved exit code', () => {
    const step = cliReportsCiLesson.steps.find(s => s.id === 'cli6-json-stdout');
    // The flat CI schema, not the rich TestRun export.
    expect(step?.terminalOutput).toContain('"passed": 20');
    expect(step?.terminalOutput).toContain('"total": 25');
    expect(step?.terminalOutput).toContain('"status": "fail"');
    // The status prefix is what makes an empty 404 body actionable in CI.
    expect(step?.terminalOutput).toContain('HTTP 404');
    expect(step?.terminalOutput).toContain('exit: 1');
    expect(step?.terminalCommand).toContain('--output json');
  });

  it('pipe step demonstrates stdout being consumed by jq', () => {
    const step = cliReportsCiLesson.steps.find(s => s.id === 'cli6-json-pipe');
    expect(step?.terminalCommand).toContain('| jq');
    expect(step?.terminalOutput).toContain('9/9 passed');
    // Workflow results nest their steps under the iteration.
    expect(step?.terminalOutput).toContain('Iteration 1');
    expect(step?.terminalOutput).toContain('"steps"');
  });

  it('recap distinguishes the stdout stream from the file artifact', () => {
    const recap = cliReportsCiLesson.steps.find(s => s.id === 'cli6-recap');
    expect(recap?.terminalOutput).toContain('--output json');
    expect(recap?.terminalOutput).toContain('owns stdout');
  });
});
