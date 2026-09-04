/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildJsonReport, buildCiJsonReport, buildWorkflowCiJsonReport, buildDataRowSummary } from './reporters';
import { makeResult, makeConfig, makeSummary } from './reporters.test.utils';

describe('buildJsonReport', () => {
  it('builds valid JSON report structure', () => {
    const results = [makeResult()];
    const summary = makeSummary();
    const config = makeConfig();

    const report = buildJsonReport(results, summary, config, { name: 'Test', env: 'staging' });

    expect(report.id).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.config).toBe(config);
    expect(report.summary).toBe(summary);
    expect(report.results).toEqual(results);
    expect(report.envName).toBe('staging');
    expect(report.projectName).toBe('Test');
  });

  it('redacts grpc harness runner artifacts in JSON output', () => {
    const results = [makeResult({
      method: 'GRPC',
      transportType: 'grpcCall',
      responseBody: JSON.stringify({ token: 'super-secret-token' }),
      responseHeaders: {
        authorization: 'Bearer abc123',
      },
      requestLog: {
        headers: {
          authorization: 'Bearer abc123',
        },
        body: JSON.stringify({ token: 'super-secret-token' }),
      },
      grpcResultMeta: {
        service: 'echo.EchoService',
        method: 'Echo',
        target: 'localhost:50051',
        grpcStatus: 0,
        grpcStatusMessage: 'Bearer abc123',
        harnessResult: {
          scenarioId: 'scenario-1',
          status: 'error',
          callType: 'unary',
          grpcStatus: 0,
          durationMs: 10,
          attemptCount: 1,
          assertionResults: [],
          errorDetail: 'Bearer abc123',
        },
      },
      passed: false,
      errorMessage: 'Bearer abc123',
    })];

    const summary = makeSummary({ failedRequests: 1, successfulRequests: 0 });
    const config = makeConfig();
    const report = buildJsonReport(results, summary, config, {});
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('buildCiJsonReport', () => {
  it('counts pass/fail and reports the run duration', () => {
    const results = [
      makeResult({ id: 'a', scenarioName: 'A', passed: true, responseTimeMs: 10 }),
      makeResult({ id: 'b', scenarioName: 'B', passed: true, responseTimeMs: 20 }),
      makeResult({ id: 'c', scenarioName: 'C', passed: false, responseTimeMs: 30, errorMessage: 'boom' }),
    ];

    const report = buildCiJsonReport(results, 3421);

    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.total).toBe(3);
    expect(report.durationMs).toBe(3421);
    expect(report.results).toHaveLength(3);
  });

  it('emits the documented per-result shape', () => {
    const results = [
      makeResult({ scenarioName: 'Get Users', passed: true, responseTimeMs: 123.4 }),
    ];

    const report = buildCiJsonReport(results, 1000);

    expect(report.results[0]).toEqual({
      name: 'Get Users',
      status: 'pass',
      durationMs: 123,
      error: null,
    });
  });

  it('reports null error for passing tests and a message for failures', () => {
    const results = [
      makeResult({ id: 'ok', passed: true }),
      makeResult({ id: 'bad', passed: false, errorMessage: 'Connection refused' }),
    ];

    const report = buildCiJsonReport(results, 1);

    expect(report.results[0].error).toBeNull();
    expect(report.results[1].error).toBe('Connection refused');
  });

  it('falls back to the HTTP status when a failure carries no message', () => {
    const results = [
      makeResult({ passed: false, httpStatus: 503, errorMessage: undefined, failureDetails: [] }),
    ];

    const report = buildCiJsonReport(results, 1);

    expect(report.results[0].error).toBe('HTTP 503');
  });

  it('prefixes the status when an HTTP failure body is uninformative', () => {
    // A 404 from many APIs is literally `{}` — without the status that is useless in CI.
    const results = [makeResult({ passed: false, httpStatus: 404, errorMessage: '{}' })];

    const report = buildCiJsonReport(results, 1);

    expect(report.results[0].error).toBe('HTTP 404: {}');
  });

  it('does not add an HTTP prefix to a validation failure on a 200', () => {
    const results = [
      makeResult({ passed: false, httpStatus: 200, errorMessage: 'Expected name to be Ada' }),
    ];

    const report = buildCiJsonReport(results, 1);

    expect(report.results[0].error).toBe('Expected name to be Ada');
  });

  it('qualifies parameterized rows so names stay unique', () => {
    const results = [
      makeResult({ id: '1', scenarioName: 'Get User', dataRowLabel: 'Row 1', passed: true }),
      makeResult({ id: '2', scenarioName: 'Get User', dataRowLabel: 'Row 2', passed: true }),
    ];

    const report = buildCiJsonReport(results, 1);

    expect(report.results.map(r => r.name)).toEqual([
      'Get User [Row 1]',
      'Get User [Row 2]',
    ]);
  });

  it('produces output that survives a JSON round-trip', () => {
    const results = [makeResult({ passed: false, errorMessage: 'quotes " and \\ backslash' })];

    const report = buildCiJsonReport(results, 5);

    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('handles an empty result set', () => {
    const report = buildCiJsonReport([], 0);

    expect(report).toEqual({ passed: 0, failed: 0, total: 0, durationMs: 0, results: [] });
  });
});

describe('buildWorkflowCiJsonReport', () => {
  const iteration = (idx: number, steps: Array<Partial<Parameters<typeof makeResult>[0]>>) =>
    steps.map((s, i) => makeResult({ id: `i${idx}-s${i}`, iterationIndex: idx, ...s }));

  it('counts iterations, not steps, so it agrees with the JUnit reporter', () => {
    const results = [
      ...iteration(0, [{ scenarioName: 'Login', passed: true }, { scenarioName: 'Order', passed: true }]),
      ...iteration(1, [{ scenarioName: 'Login', passed: true }, { scenarioName: 'Order', passed: false }]),
    ];

    const report = buildWorkflowCiJsonReport(results, 2, 900);

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('names iterations 1-based to match the JUnit test case names', () => {
    const results = [...iteration(0, [{ passed: true }]), ...iteration(1, [{ passed: true }])];

    const report = buildWorkflowCiJsonReport(results, 2, 10);

    expect(report.results.map(r => r.name)).toEqual(['Iteration 1', 'Iteration 2']);
  });

  it('fails an iteration when any single step fails', () => {
    const results = iteration(0, [
      { scenarioName: 'Login', passed: true },
      { scenarioName: 'Order', passed: false, errorMessage: 'boom' },
      { scenarioName: 'Logout', passed: true },
    ]);

    const report = buildWorkflowCiJsonReport(results, 1, 10);

    expect(report.results[0].status).toBe('fail');
    expect(report.failed).toBe(1);
  });

  it('preserves every step under the iteration', () => {
    const results = iteration(0, [
      { scenarioName: 'Login', passed: true, responseTimeMs: 100 },
      { scenarioName: 'Order', passed: false, responseTimeMs: 50, errorMessage: 'boom' },
    ]);

    const report = buildWorkflowCiJsonReport(results, 1, 10);
    const steps = report.results[0].steps!;

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({ name: 'Login', status: 'pass', durationMs: 100, error: null });
    expect(steps[1]).toEqual({ name: 'Order', status: 'fail', durationMs: 50, error: 'boom' });
  });

  it('joins every failing step into the iteration error, like the JUnit message', () => {
    const results = iteration(0, [
      { scenarioName: 'Login', passed: false, errorMessage: 'bad creds' },
      { scenarioName: 'Order', passed: false, errorMessage: 'boom' },
    ]);

    const report = buildWorkflowCiJsonReport(results, 1, 10);

    expect(report.results[0].error).toBe('Login: bad creds; Order: boom');
  });

  it('sums step durations for the iteration duration', () => {
    const results = iteration(0, [
      { passed: true, responseTimeMs: 120 },
      { passed: true, responseTimeMs: 80 },
    ]);

    const report = buildWorkflowCiJsonReport(results, 1, 10);

    expect(report.results[0].durationMs).toBe(200);
  });

  it('reports a passing iteration with a null error', () => {
    const results = iteration(0, [{ passed: true }]);

    const report = buildWorkflowCiJsonReport(results, 1, 10);

    expect(report.results[0].error).toBeNull();
    expect(report.results[0].steps!.every(s => s.error === null)).toBe(true);
  });

  it('emits an empty placeholder for an iteration that produced no results', () => {
    // Aborted or short-circuited runs leave gaps; the count must still line up.
    const results = iteration(0, [{ passed: true }]);

    const report = buildWorkflowCiJsonReport(results, 3, 10);

    expect(report.total).toBe(3);
    expect(report.results[2].steps).toEqual([]);
    expect(report.results[2].status).toBe('pass');
  });

  it('survives a JSON round-trip with nested steps', () => {
    const results = iteration(0, [{ passed: false, errorMessage: 'quotes " here' }]);

    const report = buildWorkflowCiJsonReport(results, 1, 5);

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('buildDataRowSummary', () => {
  it('returns empty array when no data row results', () => {
    const results = [makeResult()];

    const summary = buildDataRowSummary(results);

    expect(summary).toEqual([]);
  });

  it('groups results by scenario and counts pass/fail', () => {
    const results = [
      makeResult({ dataRowId: 'r1', dataRowLabel: 'Row 1', passed: true }),
      makeResult({ id: 'r2', dataRowId: 'r2', dataRowLabel: 'Row 2', passed: true }),
      makeResult({ id: 'r3', dataRowId: 'r3', dataRowLabel: 'Row 3', passed: false, httpStatus: 500 }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary).toHaveLength(1);
    expect(summary[0].pattern).toBe('Get Users');
    expect(summary[0].totalRows).toBe(3);
    expect(summary[0].passedRows).toBe(2);
    expect(summary[0].failedRows).toBe(1);
  });

  it('includes failed row details', () => {
    const results = [
      makeResult({
        dataRowId: 'r1',
        dataRowLabel: 'Row 1',
        passed: false,
        httpStatus: 400,
        errorMessage: 'Bad Request',
      }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary[0].failedRowDetails).toHaveLength(1);
    expect(summary[0].failedRowDetails[0]).toEqual({
      row: 'r1',
      label: 'Row 1',
      status: 400,
      error: 'Bad Request',
    });
  });

  it('uses PRODUCE status label for failed Kafka produce data rows', () => {
    const results = [
      makeResult({
        dataRowId: 'r1',
        dataRowLabel: 'Row 1',
        passed: false,
        method: 'KAFKA',
        transportType: 'kafkaProduce',
        httpStatus: 0,
        errorMessage: 'Broker unreachable',
        kafkaResultMeta: { topic: 'orders', partition: 0, offset: 0 },
      }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary[0].failedRowDetails[0].status).toBe('PRODUCE');
  });

  it('uses CONSUME status label for failed Kafka consume data rows', () => {
    const results = [
      makeResult({
        dataRowId: 'r1',
        dataRowLabel: 'Row 1',
        passed: false,
        method: 'KAFKA',
        transportType: 'kafkaConsume',
        httpStatus: 0,
        errorMessage: 'No messages received',
        kafkaResultMeta: { topic: 'events', partition: 0, offset: 0 },
      }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary[0].failedRowDetails[0].status).toBe('CONSUME');
  });

  it('uses WS_CONNECT status label for failed WebSocket connect data rows', () => {
    const results = [
      makeResult({
        dataRowId: 'r1',
        dataRowLabel: 'Row 1',
        passed: false,
        method: 'WS',
        transportType: 'wsConnect',
        httpStatus: 0,
        errorMessage: 'Connection refused',
        wsResultMeta: { url: 'ws://localhost:9876' },
      }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary[0].failedRowDetails[0].status).toBe('WS_CONNECT');
  });

  it('uses WS_SEND status label for failed WebSocket send data rows', () => {
    const results = [
      makeResult({
        dataRowId: 'r1',
        dataRowLabel: 'Row 1',
        passed: false,
        method: 'WS',
        transportType: 'wsSend',
        httpStatus: 0,
        errorMessage: 'Send failed',
      }),
    ];

    const summary = buildDataRowSummary(results);

    expect(summary[0].failedRowDetails[0].status).toBe('WS_SEND');
  });
});
