import { describe, expect, it } from 'vitest';
import {
  DOCKER_STACK_KEYS,
  composeProjectName,
  dockerStackSiblings,
  dockerStackSlotKey,
  isDockerStackKey,
  isRffComposeProject,
  keysSharingStartSlot,
  mergeReservedStarts,
  parseStackKey,
  rffComposeProjectNames,
  stackKeyToRelDir,
  stackLimitError,
} from './stackIds.ts';

describe('stackIds', () => {
  it('covers the 13 known keys and matches the Rust dir table', () => {
    expect(DOCKER_STACK_KEYS).toHaveLength(13);
    expect(stackKeyToRelDir('graphql')).toBe('graphql');
    expect(stackKeyToRelDir('graphql-tls')).toBe('graphql/tls');
    expect(stackKeyToRelDir('grpc')).toBe('grpc');
    expect(stackKeyToRelDir('grpc-spring')).toBe('grpc');
    expect(stackKeyToRelDir('kafka-plaintext')).toBe('kafka/plaintext');
    expect(stackKeyToRelDir('kafka-secure')).toBe('kafka/secure');
    expect(stackKeyToRelDir('kafka-tls')).toBe('kafka/tls');
    expect(stackKeyToRelDir('kafka-schema-registry')).toBe('kafka/schema-registry');
    expect(stackKeyToRelDir('ws-socketio')).toBe('websocket/socketio');
    expect(stackKeyToRelDir('ws-graphql')).toBe('websocket/graphql');
    expect(stackKeyToRelDir('ws-stomp')).toBe('websocket/stomp');
    expect(stackKeyToRelDir('ws-tls')).toBe('websocket');
    expect(stackKeyToRelDir('api-mock')).toBe('api-mock');
  });

  it('shares one compose project for the gRPC family', () => {
    expect(composeProjectName('grpc-spring')).toBe('rff-grpc-family');
    expect(composeProjectName('grpc')).toBe('rff-grpc-family');
    expect(dockerStackSlotKey('grpc')).toBe('grpc-family');
    expect(composeProjectName('graphql')).toBe('rff-graphql');
    expect(composeProjectName('ws-graphql')).toBe('rff-ws-graphql');
  });

  it('mirrors Rust STACK_LIMIT rules', () => {
    expect(stackLimitError('graphql', [])).toBeNull();
    expect(stackLimitError('kafka-plaintext', ['graphql'])).toBeNull();
    expect(stackLimitError('graphql', ['graphql', 'kafka-plaintext'])).toBeNull();
    expect(stackLimitError('ws-socketio', ['graphql', 'kafka-plaintext'])).toBe(
      'STACK_LIMIT:graphql,kafka-plaintext',
    );
    expect(stackLimitError('grpc-spring', ['grpc'])).toBeNull();
    expect(stackLimitError('grpc-spring', ['grpc', 'graphql'])).toBeNull();
    expect(stackLimitError('grpc-spring', ['graphql', 'kafka-plaintext'])).toBe(
      'STACK_LIMIT:graphql,kafka-plaintext',
    );
    expect(stackLimitError('kafka-plaintext', ['grpc', 'grpc-spring', 'graphql'])).toBe(
      'STACK_LIMIT:graphql,grpc,grpc-spring',
    );
    expect(stackLimitError('ws-tls', ['kafka-plaintext', 'graphql'])).toBe(
      'STACK_LIMIT:graphql,kafka-plaintext',
    );
  });

  it('merges reserved keys in roster order', () => {
    expect(mergeReservedStarts(['kafka-plaintext'], ['graphql'])).toEqual([
      'graphql',
      'kafka-plaintext',
    ]);
  });

  it('keeps only rff-* compose project names', () => {
    expect(rffComposeProjectNames('rff-graphql\norders-api-postgres\ngraphql\n')).toEqual([
      'rff-graphql',
    ]);
    expect(isRffComposeProject('rff-')).toBe(false);
    expect(isRffComposeProject('rff-x')).toBe(true);
  });

  it('parses allow-listed keys and lists slot siblings', () => {
    expect(isDockerStackKey('graphql')).toBe(true);
    expect(isDockerStackKey('nope')).toBe(false);
    expect(parseStackKey('grpc-spring')).toBe('grpc-spring');
    expect(parseStackKey('nope')).toBeNull();
    expect(dockerStackSiblings('grpc')).toEqual(['grpc', 'grpc-spring']);
    expect(dockerStackSiblings('graphql')).toEqual(['graphql']);
    expect(keysSharingStartSlot('grpc-spring')).toEqual(['grpc', 'grpc-spring']);
    expect(keysSharingStartSlot('graphql')).toEqual(['graphql']);
  });

  it('appends unknown reserved keys after the roster', () => {
    expect(mergeReservedStarts(['mystery'], ['graphql'])).toEqual(['graphql', 'mystery']);
    expect(stackLimitError('ws-tls', ['graphql', 'mystery'])).toBe('STACK_LIMIT:graphql,mystery');
  });
});
