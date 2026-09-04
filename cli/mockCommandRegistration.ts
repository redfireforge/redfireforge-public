import type { Command } from 'commander';
import {
  runMockSimulate,
  runMockStart,
  runMockStop,
  runMockVerify,
  runMockVerifyAllRoutes,
  runMockWaitReady,
} from './mockCommands';

export function registerMockCommands(program: Command): void {
  // API Mock Studio commands (Phase 8)
  const mock = program.command('mock').description('API Mock Studio headless commands');

  mock
    .command('simulate')
    .description('Run saved simulation samples against a mock definition (side-effect-free)')
    .argument('<file>', 'Workspace / server JSON or YAML (or native export envelope)')
    .option('--server <id>', 'Server id (defaults to activeServerId or first)')
    .option('-o, --output <path|json|junit>', 'Write JSON results to file, or print `json`/`junit` to stdout')
    .option('--junit <path>', 'Write JUnit XML results to file')
    .action(async (file: string, opts: { server?: string; output?: string; junit?: string }) => {
      const code = await runMockSimulate({ file, serverId: opts.server, output: opts.output, junit: opts.junit });
      process.exit(code);
    });

  mock
    .command('start')
    .description('Start mock listeners (companion, or in-process when companion is down)')
    .argument('<file>', 'Workspace / server JSON or YAML')
    .option('--port <n|auto>', 'Override listen port (first server; later servers increment). Use "auto" to pick a free OS port.')
    .option('--port-file <path>', 'Write the bound port number to this file after start (e.g. .rff-mock-port)')
    .option('--env-file <path>', 'Write API_MOCK_PORT=<port> to this file after start (e.g. .env.mock)')
    .option('--control-base <url>', 'Companion base URL', 'http://127.0.0.1:3001')
    .option('--wait-ready', 'Keep process alive until SIGINT/SIGTERM, then stop listeners (implied for --standalone)')
    .option('--standalone', 'Start in-process listeners without the companion')
    .action(async (file: string, opts: { port?: string; portFile?: string; envFile?: string; controlBase?: string; waitReady?: boolean; standalone?: boolean }) => {
      // Accept 'auto' or a numeric string.
      const portArg: number | 'auto' | undefined =
        opts.port === 'auto' ? 'auto'
        : opts.port != null ? parseInt(opts.port, 10)
        : undefined;
      const code = await runMockStart({
        file,
        port: portArg,
        portFile: opts.portFile,
        envFile: opts.envFile,
        controlBase: opts.controlBase,
        waitReady: opts.waitReady,
        standalone: opts.standalone,
      });
      process.exit(code);
    });

  mock
    .command('wait-ready')
    .description('Poll /__rff/health/ready until the mock server is ready (Kubernetes readiness probe)')
    .option('--port <n>', 'Port number to poll', parseInt)
    .option('--port-file <path>', 'Read port from a file written by mock start --port-file')
    .option('--env-file <path>', 'Read API_MOCK_PORT=<n> from a file written by mock start --env-file')
    .option('--host <host>', 'Host to poll (default: 127.0.0.1)')
    .option('--health-path <path>', 'Health endpoint path (default: /__rff/health/ready). Use / to accept any HTTP response.')
    .option('--timeout <secs>', 'Max seconds to wait (default: 30)', parseInt)
    .action(async (opts: { port?: number; portFile?: string; envFile?: string; host?: string; healthPath?: string; timeout?: number }) => {
      const code = await runMockWaitReady({
        port: opts.port,
        portFile: opts.portFile,
        envFile: opts.envFile,
        host: opts.host,
        healthPath: opts.healthPath,
        timeoutSecs: opts.timeout,
      });
      process.exit(code);
    });

  mock
    .command('stop')
    .description('Stop one or all mock servers defined in a workspace file (requires companion)')
    .argument('<file>', 'Workspace / server JSON or YAML')
    .option('--server <id>', 'Server id to stop (defaults to activeServerId or first)')
    .option('--all', 'Stop all servers in the workspace')
    .option('--control-base <url>', 'Companion base URL', 'http://127.0.0.1:3001')
    .action(async (file: string, opts: { server?: string; all?: boolean; controlBase?: string }) => {
      const code = await runMockStop({
        file,
        serverId: opts.server,
        all: opts.all,
        controlBase: opts.controlBase,
      });
      process.exit(code);
    });

  mock
    .command('coverage')
    .description('Verify every enabled route in the definition was called (contract coverage gate)')
    .argument('<file>', 'Workspace / server JSON or YAML')
    .option('--server <id>', 'Server id (defaults to activeServerId or first)')
    .option('--min-calls <n>', 'Minimum calls required per route (default: 1)', parseInt)
    .option('--control-base <url>', 'Companion base URL', 'http://127.0.0.1:3001')
    .action(async (file: string, opts: { server?: string; minCalls?: number; controlBase?: string }) => {
      const code = await runMockVerifyAllRoutes({
        file,
        serverId: opts.server,
        minCallsPerRoute: opts.minCalls,
        controlBase: opts.controlBase,
      });
      process.exit(code);
    });

  // Also available as: mock verify --all-routes (extends existing verify command)
  mock
    .command('verify')
    .description('Verify live journal assertions (or --simulate for offline corpus; or --all-routes for contract coverage)')
    .argument('<file>', 'Workspace / server JSON or YAML')
    .option('--server <id>', 'Server id')
    .option('--min-calls <n>', 'Require at least N matching journal calls (or N calls per route with --all-routes)', parseInt)
    .option('--expect-outcome <outcome>', 'Require matching calls to have this outcome (e.g. matched)')
    .option('--route <id>', 'Restrict assertions to a route id')
    .option('--last-call-within-ms <n>', 'Require the last matching call within N ms', parseInt)
    .option('--body-contains <text>', 'Require the last matching response body to contain text')
    .option('--control-base <url>', 'Companion base URL', 'http://127.0.0.1:3001')
    .option('--simulate', 'Offline corpus simulation instead of live journal')
    .option('--all-routes', 'Check that every enabled route was called (contract coverage gate; implies live journal)')
    .action(async (file: string, opts: {
      server?: string;
      minCalls?: number;
      expectOutcome?: string;
      route?: string;
      lastCallWithinMs?: number;
      bodyContains?: string;
      controlBase?: string;
      simulate?: boolean;
      allRoutes?: boolean;
    }) => {
      if (opts.allRoutes) {
        const code = await runMockVerifyAllRoutes({
          file,
          serverId: opts.server,
          minCallsPerRoute: opts.minCalls,
          controlBase: opts.controlBase,
        });
        process.exit(code);
      }
      const code = await runMockVerify({
        file,
        serverId: opts.server,
        minCalls: opts.minCalls,
        expectOutcome: opts.expectOutcome,
        routeId: opts.route,
        lastCallWithinMs: opts.lastCallWithinMs,
        bodyContains: opts.bodyContains,
        controlBase: opts.controlBase,
        simulate: opts.simulate,
      });
      process.exit(code);
    });
}