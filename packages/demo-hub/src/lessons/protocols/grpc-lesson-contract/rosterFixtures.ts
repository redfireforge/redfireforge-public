/**
 * Roster-local copies of gRPC demo fixture URLs and gate copy.
 *
 * These must not be imported from `adapters` (barrel or grpcStudioAdapter).
 * The production adapters chunk and DemoShellHost import each other, so
 * spreading live adapter bindings at module init throws
 * (`undefined is not iterable` / WebKit `n9`).
 *
 * Keep values in sync with `adapters/grpcStudioAdapter.ts` — the roster
 * validate test asserts equality.
 */
import { GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_URL } from '@shared/grpc/grpcSpringFixturePorts';

export { GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_URL };

export const GRPC_EXPRESS_HEALTH_URL = 'http://localhost:3001/health';

export const GRPC_DEMO_PREREQUISITE_ENDPOINTS = [
  'http://localhost:50052/health',
  GRPC_EXPRESS_HEALTH_URL,
] as const;

export const GRPC_TRANSPORT_MODES_PREREQUISITE_ENDPOINTS = [
  ...GRPC_DEMO_PREREQUISITE_ENDPOINTS,
  'http://localhost:50055/',
] as const;

export const GRPC_STUDIO_LESSON_ALLOWED_TABS = ['grpc-studio', 'demo-hub'] as const;

export const GRPC_DEMO_DOCKER_COMMAND = [
  '# One command — Docker echo + Envoy grpc-web (:50055) + Express proxy + Vite',
  'npm run dev:grpc',
  '',
  '# — or start each dependency yourself —',
  '# Terminal 1 — gRPC echo + Envoy sidecar (Docker)',
  'cd docker/grpc && docker compose up -d',
  '',
  '# Terminal 2 — Express gRPC proxy (browser Reflect/Send)',
  'npm run server',
].join('\n');

export const GRPC_SPRING_DOCKER_COMMAND = [
  '# Terminal 1 — Go echo + Spring gRPC servers (Docker)',
  'cd docker/grpc && docker compose --profile spring up -d',
  '',
  '# Terminal 2 — Express gRPC proxy (browser Reflect/Send)',
  'npm run server',
].join('\n');
