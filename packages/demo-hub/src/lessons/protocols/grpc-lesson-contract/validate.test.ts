/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { grpcFirstCallLesson } from '../grpc-first-call';
import { grpcLessons } from '../grpc-lessons';
import { GRPC_LESSON_ROSTER } from './roster';
import {
  validateGrpcDemoLesson,
  validateGrpcLessonRegistry,
  validateGrpcLessonRoster,
} from './validate';
import { migrateGrpcLessonProgress, isGrpcLessonProgressCompatible, assertGrpcLessonMigrationsComplete } from './versioning';
import { GRPC_LESSON_SCHEMA_VERSION } from './types';
import {
  GRPC_DEMO_DOCKER_COMMAND,
  GRPC_DEMO_PREREQUISITE_ENDPOINTS,
  GRPC_EXPRESS_HEALTH_URL,
  GRPC_SPRING_DOCKER_COMMAND,
  GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_URL,
  GRPC_STUDIO_LESSON_ALLOWED_TABS,
  GRPC_TRANSPORT_MODES_PREREQUISITE_ENDPOINTS,
} from '../../../adapters/grpcStudioAdapter';

describe('validateGrpcLessonRoster', () => {
  it('keeps roster fixtures aligned with grpcStudioAdapter (no adapter import at init)', () => {
    const first = GRPC_LESSON_ROSTER[0];
    const spring = GRPC_LESSON_ROSTER.find((e) => e.id === 'grpc-spring-boot');
    const transport = GRPC_LESSON_ROSTER.find((e) => e.id === 'grpc-transport-modes');
    expect(first?.dockerEndpoints).toEqual([...GRPC_DEMO_PREREQUISITE_ENDPOINTS]);
    expect(first?.dockerCommand).toBe(GRPC_DEMO_DOCKER_COMMAND);
    expect(first?.allowedTabs).toEqual([...GRPC_STUDIO_LESSON_ALLOWED_TABS]);
    expect(spring?.dockerEndpoints).toEqual([
      GRPC_EXPRESS_HEALTH_URL,
      GRPC_SPRING_FIXTURE_ACTUATOR_HEALTH_URL,
    ]);
    expect(spring?.dockerCommand).toBe(GRPC_SPRING_DOCKER_COMMAND);
    expect(transport?.dockerEndpoints).toEqual([...GRPC_TRANSPORT_MODES_PREREQUISITE_ENDPOINTS]);
  });

  it('validates all 25 canonical roster entries', () => {
    const result = validateGrpcLessonRoster();
    expect(result.ok, result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')).toBe(true);
    expect(GRPC_LESSON_ROSTER).toHaveLength(25);
  });

  it('has unique ids and sequential numbers 1–25', () => {
    const ids = GRPC_LESSON_ROSTER.map((e) => e.id);
    const numbers = GRPC_LESSON_ROSTER.map((e) => e.number);
    expect(new Set(ids).size).toBe(25);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  });

  it('matches the published GRPC-1–25 lesson id roster from the plan', () => {
    expect(GRPC_LESSON_ROSTER.map((e) => e.id)).toEqual([
      'grpc-first-call',
      'grpc-server-reflection',
      'grpc-proto-import',
      'grpc-metadata',
      'grpc-tls',
      'grpc-server-streaming',
      'grpc-client-streaming',
      'grpc-bidi-streaming',
      'grpc-collections',
      'grpc-env-variables',
      'grpc-workflow-integration',
      'grpc-load-testing',
      'grpc-mock-server',
      'grpc-schema-diff',
      'grpc-spring-boot',
      'grpc-schema-discovery',
      'grpc-streaming',
      'grpc-metadata-auth',
      'grpc-transport-modes',
      'grpc-proto-form',
      'grpc-env-collections',
      'grpc-grpcurl',
      'grpc-tauri-desktop',
      'grpc-workflow-runner',
      'grpc-tabs',
    ]);
  });

  it('matches plan table titles and phase dependencies', () => {
    const planRows: Array<{ title: string; phases: number[]; keyConcept: string }> = [
      { title: 'Your First gRPC Call', phases: [1], keyConcept: 'Unary RPC, service explorer' },
      { title: 'Service Discovery with Reflection', phases: [1, 3], keyConcept: 'Reflection API' },
      { title: 'Importing Proto Files', phases: [3], keyConcept: 'Proto management' },
      { title: 'Request Metadata & Headers', phases: [1], keyConcept: 'Metadata key-value' },
      { title: 'TLS, mTLS & Certificate Configuration', phases: [4], keyConcept: 'TLS/mTLS modal, CA cert, client cert, secret vault' },
      { title: 'Server Streaming RPC', phases: [2], keyConcept: 'Message log' },
      { title: 'Client Streaming RPC', phases: [2], keyConcept: 'EOF / send multiple' },
      { title: 'Bidirectional Streaming', phases: [2], keyConcept: 'Full duplex' },
      { title: 'Saving & Organizing Requests', phases: [5], keyConcept: 'Collections tree' },
      { title: 'Environments & Variables', phases: [9], keyConcept: '{{grpcHost}}' },
      { title: 'gRPC in Workflows: Nodes, Assertions & Chaining', phases: [6], keyConcept: 'Workflow node' },
      { title: 'Load Testing: Concurrent Calls & Metrics', phases: [11], keyConcept: 'ghz-style metrics' },
      { title: 'Mocking gRPC APIs: Rules & Network Listener', phases: [11], keyConcept: 'Rule-based mock responses' },
      { title: 'Proto Schema Diff & Breaking Change Detection', phases: [11], keyConcept: 'Breaking-change detection' },
      { title: 'Spring Boot & Spring gRPC Integration', phases: [1, 4, 10], keyConcept: 'Netty vs Servlet transport behavior' },
      { title: 'Schema Discovery: Reflection & Proto Import', phases: [1, 3], keyConcept: 'Descriptor sources, Schema Browser' },
      { title: 'Streaming RPCs: All Four Patterns', phases: [1, 2], keyConcept: 'Server, client, and bidi streaming' },
      { title: 'Request Metadata & Authentication', phases: [1], keyConcept: 'Metadata headers, bearer/basic/API key/OAuth2 auth, conflict detection' },
      { title: 'Transport Modes: Express, gRPC-Web & Spring Servlet', phases: [1, 10], keyConcept: 'Browser proxy model, gRPC-Web/Spring Servlet browser-direct transports, Express retry fallback, per-tab config' },
      { title: 'Full Form Editor: Guided Complex Request Editing', phases: [1, 3], keyConcept: 'Open Full Form Editor modal; Form View / Focus View / JSON View; scalar/nested/repeated/map/oneof/WKT; Apply to Request' },
      { title: 'Environments, Collections & History', phases: [5, 9], keyConcept: '{{grpcHost}} target interpolation, Workspace Defaults variables, Collections tree, History replay' },
      { title: 'grpcurl Interop, Replay & Sharing', phases: [5, 9], keyConcept: 'Import grpcurl command, Studio field mapping, Copy grpcurl from History, secret filtering' },
      { title: 'Tauri Desktop: Native Transport, Diagnostics & Mock Listener', phases: [12], keyConcept: 'Tauri native tonic transport, channel pool diagnostics, mock network listener' },
      { title: 'Workflow Runner & Results', phases: [11], keyConcept: 'Workflow variables, grpcTarget override, Workflow Runner, Results Dashboard, Results Explorer' },
      { title: 'Multi-Tab gRPC Calls', phases: [5], keyConcept: 'Per-tab method binding, duplicate tab, independent responses' },
    ];
    expect(GRPC_LESSON_ROSTER.map((e) => e.title)).toEqual(planRows.map((r) => r.title));
    expect(GRPC_LESSON_ROSTER.map((e) => e.keyConcept)).toEqual(planRows.map((r) => r.keyConcept));
    GRPC_LESSON_ROSTER.forEach((entry, i) => {
      expect([...entry.phaseDependencies]).toEqual(planRows[i]!.phases);
    });
  });
});

describe('validateGrpcLessonRoster migrations', () => {
  it('defines migrations for every schema version through GRPC_LESSON_SCHEMA_VERSION', () => {
    expect(() => assertGrpcLessonMigrationsComplete()).not.toThrow();
  });
});

describe('validateGrpcDemoLesson', () => {
  it('GRPC-1 passes the frozen contract', () => {
    const result = validateGrpcDemoLesson(grpcFirstCallLesson);
    expect(result.ok, result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')).toBe(true);
  });
});

describe('validateGrpcLessonRegistry', () => {
  it('registry matches roster for all shipped lessons', () => {
    const result = validateGrpcLessonRegistry(grpcLessons);
    expect(result.ok, result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')).toBe(true);
  });
});

describe('grpc lesson versioning', () => {
  it('treats missing stored version as compatible', () => {
    expect(isGrpcLessonProgressCompatible(undefined)).toBe(true);
  });

  it('migrates v1 progress without data loss', () => {
    const stored = {
      lessonId: 'grpc-first-call',
      schemaVersion: 1,
      completedStepIds: ['grpc1-intro', 'grpc1-target'],
      completed: false,
    };
    const { progress, migrated } = migrateGrpcLessonProgress(stored);
    expect(migrated).toBe(false);
    expect(progress.schemaVersion).toBe(GRPC_LESSON_SCHEMA_VERSION);
    expect(progress.completedStepIds).toEqual(stored.completedStepIds);
  });

  it('resets progress from a future unknown schema version', () => {
    const stored = {
      lessonId: 'grpc-first-call',
      schemaVersion: 99,
      completedStepIds: ['grpc1-history'],
      completed: true,
    };
    const { progress, migrated } = migrateGrpcLessonProgress(stored);
    expect(migrated).toBe(true);
    expect(progress.completedStepIds).toEqual([]);
    expect(progress.completed).toBe(false);
  });

  it('migrates legacy v0 progress through v1 identity migration', () => {
    const stored = {
      lessonId: 'grpc-first-call',
      schemaVersion: 0,
      completedStepIds: ['grpc1-intro'],
      completed: false,
    };
    const { progress, migrated } = migrateGrpcLessonProgress(stored);
    expect(migrated).toBe(true);
    expect(progress.schemaVersion).toBe(GRPC_LESSON_SCHEMA_VERSION);
    expect(progress.completedStepIds).toEqual(['grpc1-intro']);
  });
});
