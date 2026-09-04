import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripCertGenerationFromCommand } from './dockerCommandDisplay';
import {
  abbreviateUserHomePath,
  inferDockerStackKey,
  lessonWantsComposeBuild,
  quoteShellPath,
  rewriteDockerCommandPath,
  resolveExtractedDockerStackPath,
  DOCKER_STACK_KEYS,
  formatOtherRunningStacks,
  composeProjectName,
  injectComposeProjectFlag,
  dockerStackBlockedByRunning,
  dockerStackSiblings,
  dockerStackSlotKey,
  dockerStackStopBusy,
  markDockerStackStopped,
  MAX_CONCURRENT_DOCKER_STACKS,
  occupiedDockerSlots,
} from './dockerStack';

vi.mock('@shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
}));

import { isTauri } from '@shared/utils/platform';

describe('inferDockerStackKey', () => {
  it('maps every production dockerCommand shape', () => {
    expect(inferDockerStackKey('cd docker/graphql && docker compose up -d')).toBe('graphql');
    expect(inferDockerStackKey(
      'cd docker/graphql/tls && ./generate-cert.sh && docker compose -f docker-compose.mtls.yml up -d',
    )).toBe('graphql-tls');
    expect(inferDockerStackKey('cd docker/grpc && docker compose up -d')).toBe('grpc');
    expect(inferDockerStackKey('cd docker/grpc && docker compose --profile spring up -d')).toBe('grpc-spring');
    expect(inferDockerStackKey('cd docker/kafka/plaintext && docker compose up -d')).toBe('kafka-plaintext');
    expect(inferDockerStackKey('cd docker/kafka/secure && docker compose up -d')).toBe('kafka-secure');
    expect(inferDockerStackKey('cd docker/kafka/tls && docker compose up -d')).toBe('kafka-tls');
    expect(inferDockerStackKey('cd docker/kafka/schema-registry && docker compose up -d')).toBe('kafka-schema-registry');
    expect(inferDockerStackKey('docker compose -f docker/websocket/socketio/docker-compose.yml up -d')).toBe('ws-socketio');
    expect(inferDockerStackKey('docker compose -f docker/websocket/graphql/docker-compose.yml up -d')).toBe('ws-graphql');
    expect(inferDockerStackKey('docker compose -f docker/websocket/stomp/docker-compose.yml up -d')).toBe('ws-stomp');
    expect(inferDockerStackKey(
      'cd docker/websocket && ./generate-cert.sh && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',
    )).toBe('ws-tls');
    expect(inferDockerStackKey(
      'cd docker/websocket && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',
    )).toBe('ws-tls');
    expect(inferDockerStackKey('cd docker/api-mock && docker compose up -d')).toBe('api-mock');
  });

  it('maps the gRPC roster multi-line commands', async () => {
    const { GRPC_DEMO_DOCKER_COMMAND, GRPC_SPRING_DOCKER_COMMAND } = await import(
      '../adapters/grpcStudioAdapter'
    );
    expect(inferDockerStackKey(GRPC_DEMO_DOCKER_COMMAND)).toBe('grpc');
    expect(inferDockerStackKey(GRPC_SPRING_DOCKER_COMMAND)).toBe('grpc-spring');
  });

  it('detects lesson-level compose --build', () => {
    expect(lessonWantsComposeBuild('cd docker/graphql && docker compose up -d --build')).toBe(true);
    expect(lessonWantsComposeBuild('cd docker/graphql && docker compose up -d')).toBe(false);
    expect(lessonWantsComposeBuild()).toBe(false);
  });

  it('returns undefined for empty or unrelated commands', () => {
    expect(inferDockerStackKey()).toBeUndefined();
    expect(inferDockerStackKey('npm run server')).toBeUndefined();
  });

  it('infers a stack key for every lesson dockerCommand string', async () => {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const root = join(__dirname, '../lessons');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(full);
      }
    };
    walk(root);
    const literals: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/dockerCommand:\s*'([^']+)'/g)) literals.push(m[1]);
      for (const m of text.matchAll(/dockerCommand:\s*"([^"]+)"/g)) literals.push(m[1]);
    }
    expect(literals.length).toBeGreaterThan(10);
    for (const cmd of literals) {
      expect(inferDockerStackKey(cmd), cmd).toBeDefined();
    }
  });

  it('lists all 13 stack keys', () => {
    expect(DOCKER_STACK_KEYS).toHaveLength(13);
  });
});

describe('injectComposeProjectFlag', () => {
  it('pins the unique project and is idempotent', () => {
    expect(composeProjectName('graphql-tls')).toBe('rff-graphql-tls');
    expect(composeProjectName('grpc-spring')).toBe('rff-grpc-family');
    expect(injectComposeProjectFlag('cd docker/graphql && docker compose up -d', 'graphql'))
      .toBe('cd docker/graphql && docker compose -p rff-graphql up -d');
    expect(
      injectComposeProjectFlag(
        'docker compose -p rff-graphql up -d && docker compose -f docker-compose.mtls.yml up -d',
        'graphql',
      ),
    ).toBe('docker compose -p rff-graphql up -d && docker compose -f docker-compose.mtls.yml up -d');
  });
});

describe('formatOtherRunningStacks', () => {
  it('uses is for one stack and are for several', () => {
    expect(formatOtherRunningStacks(['kafka-plaintext'])).toBe(
      'Kafka is running in the background. You can run another stack if needed.',
    );
    expect(formatOtherRunningStacks(['ws-graphql', 'api-mock'])).toBe(
      'WebSocket GraphQL, API Mock are running in the background. You can run another stack if needed.',
    );
  });
});

describe('abbreviateUserHomePath', () => {
  it('rewrites Linux /home/<user> to $HOME', () => {
    expect(abbreviateUserHomePath('/home/wwlee/.local/share/com.redfireforge.desktop.demo/docker/grpc', false))
      .toBe('$HOME/.local/share/com.redfireforge.desktop.demo/docker/grpc');
  });

  it('rewrites macOS /Users/<user> to $HOME', () => {
    expect(abbreviateUserHomePath('/Users/me/Library/Application Support/com.redfireforge.desktop.demo/docker/graphql', false))
      .toBe('$HOME/Library/Application Support/com.redfireforge.desktop.demo/docker/graphql');
  });

  it('rewrites Windows user profile to %USERPROFILE%', () => {
    expect(abbreviateUserHomePath('C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql', true))
      .toBe('%USERPROFILE%\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql');
  });

  it('leaves non-home paths unchanged', () => {
    expect(abbreviateUserHomePath('/tmp/grpc', false)).toBe('/tmp/grpc');
  });
});

describe('rewriteDockerCommandPath', () => {
  it('replaces cd docker/<dir> and keeps the rest of a multi-line command', () => {
    const cmd = [
      '# Terminal 1',
      'cd docker/grpc && docker compose --profile spring up -d',
      '',
      'npm run server',
    ].join('\n');
    expect(rewriteDockerCommandPath(cmd, '/Users/me/Library/Application Support/com.redfireforge.desktop.demo/docker/grpc', false))
      .toContain('cd "$HOME/Library/Application Support/com.redfireforge.desktop.demo/docker/grpc" && docker compose --profile spring up -d');
    expect(rewriteDockerCommandPath(cmd, '/tmp/grpc', false)).toContain('npm run server');
  });

  it('hides the Linux username behind $HOME in displayed commands', () => {
    expect(
      rewriteDockerCommandPath(
        'cd docker/grpc && docker compose -p rff-grpc-family up -d',
        '/home/wwlee/.local/share/com.redfireforge.desktop.demo/docker/grpc',
        false,
      ),
    ).toBe(
      'cd "$HOME/.local/share/com.redfireforge.desktop.demo/docker/grpc" && docker compose -p rff-grpc-family up -d',
    );
  });

  it('rewrites -f docker/... compose files to cd extracted && docker compose …', () => {
    expect(
      rewriteDockerCommandPath(
        'docker compose -f docker/websocket/socketio/docker-compose.yml up -d',
        '/tmp/socketio',
        false,
      ),
    ).toBe('cd "/tmp/socketio" && docker compose -f docker-compose.yml up -d');
  });

  it('keeps non-default compose file names when rewriting -f docker/…', () => {
    expect(
      rewriteDockerCommandPath(
        'docker compose -f docker/websocket/docker-compose.tls.yml -f docker/websocket/docker-compose.mtls.yml up -d',
        '/tmp/ws',
        false,
      ),
    ).toBe(
      'cd "/tmp/ws" && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',
    );
  });

  it('quotes paths that contain spaces', () => {
    expect(quoteShellPath('/Application Support/docker/graphql', false)).toBe(
      '"/Application Support/docker/graphql"',
    );
  });

  it('quotes Windows paths without doubling backslashes', () => {
    expect(quoteShellPath('C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql', true))
      .toBe('"C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql"');
  });

  it('normalizes Windows forward slashes to backslashes', () => {
    expect(quoteShellPath('C:/Users/me/AppData/Roaming/x/docker/graphql', true))
      .toBe('"C:\\Users\\me\\AppData\\Roaming\\x\\docker\\graphql"');
  });

  it('strips a trailing Windows backslash so cmd.exe quoting stays closed', () => {
    expect(quoteShellPath('C:\\Users\\me\\docker\\graphql\\', true))
      .toBe('"C:\\Users\\me\\docker\\graphql"');
  });

  it('re-quotes an already-quoted Windows path so a trailing backslash cannot escape', () => {
    expect(quoteShellPath('"C:\\Users\\me\\docker\\graphql\\"', true))
      .toBe('"C:\\Users\\me\\docker\\graphql"');
  });

  it('rewrites TLS commands after cert-generation steps are stripped', () => {
    const gql = stripCertGenerationFromCommand(
      'cd docker/graphql/tls && ./generate-cert.sh && ./generate-client-cert.sh && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d',
    );
    expect(rewriteDockerCommandPath(gql, '/tmp/gql-tls', false)).toBe(
      'cd "/tmp/gql-tls" && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d',
    );
    const ws = stripCertGenerationFromCommand(
      'cd docker/websocket && ./generate-cert.sh && ./generate-client-cert.sh && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',
    );
    expect(rewriteDockerCommandPath(ws, '/tmp/ws', false)).toBe(
      'cd "/tmp/ws" && docker compose -f docker-compose.tls.yml -f docker-compose.mtls.yml up -d',
    );
  });

  it('rewrites Windows commands as two lines so PowerShell 5 can paste them', () => {
    const win = rewriteDockerCommandPath(
      'cd docker/graphql && docker compose up -d',
      'C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql',
      true,
    );
    expect(win).toBe(
      'cd "%USERPROFILE%\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql"\ndocker compose up -d',
    );
    expect(win).not.toContain('&&');
  });

  it('splits leftover compose && on Windows TLS commands', () => {
    const gql = stripCertGenerationFromCommand(
      'cd docker/graphql/tls && ./generate-cert.sh && ./generate-client-cert.sh && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d',
    );
    const win = rewriteDockerCommandPath(
      gql,
      'C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql\\tls',
      true,
    );
    expect(win).toBe(
      'cd "%USERPROFILE%\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\graphql\\tls"\ndocker compose up -d\ndocker compose -f docker-compose.mtls.yml up -d',
    );
    expect(win).not.toContain('&&');
  });

  it('rewrites multi-line gRPC commands on Windows without &&', () => {
    const cmd = [
      '# Terminal 1',
      'cd docker/grpc && docker compose --profile spring up -d',
      '',
      'npm run server',
    ].join('\n');
    const win = rewriteDockerCommandPath(
      cmd,
      'C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\grpc',
      true,
    );
    expect(win.startsWith('cd "')).toBe(true);
    expect(win).toContain(
      'cd "%USERPROFILE%\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\grpc"',
    );
    expect(win).toContain('docker compose --profile spring up -d');
    expect(win).toContain('npm run server');
    expect(win).not.toContain('&&');
    expect(win).not.toContain('# Terminal');
  });

  it('rewrites Windows -f docker/... commands as two lines', () => {
    expect(
      rewriteDockerCommandPath(
        'docker compose -f docker/websocket/socketio/docker-compose.yml up -d',
        'C:\\Users\\me\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\websocket\\socketio',
        true,
      ),
    ).toBe(
      'cd "%USERPROFILE%\\AppData\\Roaming\\com.redfireforge.desktop.demo\\docker\\websocket\\socketio"\ndocker compose -f docker-compose.yml up -d',
    );
  });
});

describe('resolveExtractedDockerStackPath', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('returns null on web', async () => {
    await expect(resolveExtractedDockerStackPath('graphql')).resolves.toBeNull();
  });
});

describe('dockerStackSiblings', () => {
  it('treats grpc and grpc-spring as one removal group', () => {
    expect(dockerStackSiblings('grpc')).toEqual(['grpc', 'grpc-spring']);
    expect(dockerStackSiblings('grpc-spring')).toEqual(['grpc', 'grpc-spring']);
    expect(dockerStackSiblings('graphql')).toEqual(['graphql']);
    const running = new Set<typeof DOCKER_STACK_KEYS[number]>(['grpc-spring']);
    expect(dockerStackBlockedByRunning('grpc', running)).toBe('grpc-spring');
    expect(dockerStackBlockedByRunning('graphql', running)).toBeUndefined();
  });

  it('markDockerStackStopped clears every sibling', () => {
    const seen: string[] = [];
    markDockerStackStopped('grpc-spring', (key, running) => {
      seen.push(`${key}:${running}`);
    });
    expect(seen).toEqual(['grpc:false', 'grpc-spring:false']);
    const single: string[] = [];
    markDockerStackStopped('graphql', (key, running) => {
      single.push(`${key}:${running}`);
    });
    expect(single).toEqual(['graphql:false']);
  });

  it('dockerStackStopBusy covers siblings, Stop all, and image remove', () => {
    expect(dockerStackStopBusy('graphql', null)).toBe(false);
    expect(dockerStackStopBusy('graphql', 'all')).toBe(true);
    expect(dockerStackStopBusy('graphql', 'rmi-graphql')).toBe(true);
    expect(dockerStackStopBusy('graphql', 'rmi-all')).toBe(true);
    expect(dockerStackStopBusy('grpc-spring', 'grpc')).toBe(true);
    expect(dockerStackStopBusy('graphql', 'grpc')).toBe(false);
    expect(dockerStackStopBusy('graphql', 'graphql')).toBe(true);
  });
});

describe('occupiedDockerSlots', () => {
  it('collapses grpc siblings into one slot', () => {
    expect(dockerStackSlotKey('grpc')).toBe('grpc-family');
    expect(dockerStackSlotKey('graphql')).toBe('graphql');
    expect(occupiedDockerSlots(['grpc', 'grpc-spring', 'graphql'])).toEqual([
      'grpc-family',
      'graphql',
    ]);
    expect(occupiedDockerSlots(['graphql', 'kafka-plaintext'])).toHaveLength(
      MAX_CONCURRENT_DOCKER_STACKS,
    );
  });
});
