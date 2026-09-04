import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formatDockerCommandForHost,
  isWindowsHost,
  stripCertGenerationFromCommand,
  withRepoClonePreamble,
} from './dockerCommandDisplay';

const COMPOSE = 'cd docker/graphql && docker compose up -d';
const CLONE = 'git clone https://github.com/redfireforge/redfireforge-public.git';

describe('withRepoClonePreamble', () => {
  it('prepends clone comments and keeps the compose line', () => {
    const displayed = withRepoClonePreamble(COMPOSE);
    expect(displayed).toContain('# First time? Clone the repo:');
    expect(displayed).toContain(CLONE);
    expect(displayed).toContain('#   cd redfireforge-public');
    expect(displayed.endsWith(COMPOSE)).toBe(true);
  });

  it('is idempotent when the clone URL is already present', () => {
    const once = withRepoClonePreamble(COMPOSE);
    expect(withRepoClonePreamble(once)).toBe(once);
  });
});

describe('stripCertGenerationFromCommand', () => {
  it('removes generate-cert scripts and leaves compose', () => {
    expect(stripCertGenerationFromCommand(
      'cd docker/graphql/tls && ./generate-cert.sh && ./generate-client-cert.sh && docker compose up -d',
    )).toBe('cd docker/graphql/tls && docker compose up -d');
    expect(stripCertGenerationFromCommand(
      'cd docker/websocket && ./generate-cert.sh && docker compose -f docker-compose.tls.yml up -d',
    )).toBe('cd docker/websocket && docker compose -f docker-compose.tls.yml up -d');
  });

  it('leaves commands that have no generate scripts', () => {
    expect(stripCertGenerationFromCommand(COMPOSE)).toBe(COMPOSE);
  });

  it('strips the gRPC certs/generate.sh prefix', () => {
    expect(stripCertGenerationFromCommand(
      'cd docker/grpc && ./certs/generate.sh && docker compose up -d',
    )).toBe('cd docker/grpc && docker compose up -d');
    expect(stripCertGenerationFromCommand(
      'cd docker/grpc && .\\certs\\generate.sh && docker compose up -d',
    )).toBe('cd docker/grpc && docker compose up -d');
  });

  it('strips bash-prefixed kafka generate-certs.sh', () => {
    expect(stripCertGenerationFromCommand(
      'cd docker/kafka/tls && bash generate-certs.sh && docker compose up -d',
    )).toBe('cd docker/kafka/tls && docker compose up -d');
  });

  it('strips generate scripts on their own lines and sh / .\\ prefixes', () => {
    expect(stripCertGenerationFromCommand([
      'cd docker/websocket',
      './generate-cert.sh',
      'sh generate-client-cert.sh',
      '.\\generate-cert.sh',
      'docker compose -f docker-compose.tls.yml up -d',
    ].join('\n'))).toBe([
      'cd docker/websocket',
      'docker compose -f docker-compose.tls.yml up -d',
    ].join('\n'));
  });

  it('keeps blank lines in a multi-line command that has no generate scripts', () => {
    expect(stripCertGenerationFromCommand([
      'cd docker/grpc && docker compose up -d',
      '',
      'npm run server',
    ].join('\n'))).toBe([
      'cd docker/grpc && docker compose up -d',
      '',
      'npm run server',
    ].join('\n'));
  });

  it('still prepends the clone preamble after stripping cert scripts', () => {
    const displayed = withRepoClonePreamble(stripCertGenerationFromCommand(
      'cd docker/graphql/tls && ./generate-cert.sh && docker compose up -d',
    ));
    expect(displayed).toContain(CLONE);
    expect(displayed).toContain('cd docker/graphql/tls && docker compose up -d');
    expect(displayed).not.toContain('generate-cert');
  });
});

const LESSONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lessons');
const CERT_GEN_SCRIPT = /generate-(?:client-)?certs?\.sh|certs\/generate\.sh/;

function walkLessonSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkLessonSources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function viewerFacingLessonText(src: string): string {
  const withoutCmd = src
    .replace(/dockerCommand:\s*'[^']*'/g, '')
    .replace(/dockerCommand:\s*`[^`]*`/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const chunks: string[] = [];
  for (const match of withoutCmd.matchAll(/body:\s*`([\s\S]*?)`/g)) {
    chunks.push(match[1]);
  }
  for (const match of withoutCmd.matchAll(/description:\s*'([^']*)'/g)) {
    chunks.push(match[1]);
  }
  for (const match of withoutCmd.matchAll(/description:\s*`([\s\S]*?)`/g)) {
    chunks.push(match[1]);
  }
  return chunks.join('\n');
}

describe('TLS lesson viewer copy', () => {
  it('does not tell viewers to run cert generation scripts', () => {
    for (const file of walkLessonSources(LESSONS_DIR)) {
      const text = viewerFacingLessonText(readFileSync(file, 'utf8'));
      expect(text, path.relative(LESSONS_DIR, file)).not.toMatch(CERT_GEN_SCRIPT);
    }
  });
});

describe('formatDockerCommandForHost', () => {
  it('splits && onto new lines on Windows and leaves Unix unchanged', () => {
    const cmd = 'cd docker/graphql/tls && docker compose up -d && docker compose -f docker-compose.mtls.yml up -d';
    expect(formatDockerCommandForHost(cmd, true)).toBe(
      'cd docker/graphql/tls\ndocker compose up -d\ndocker compose -f docker-compose.mtls.yml up -d',
    );
    expect(formatDockerCommandForHost(cmd, false)).toBe(cmd);
  });
});

describe('isWindowsHost', () => {
  it('detects Windows user agents', () => {
    expect(isWindowsHost('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')).toBe(true);
    expect(isWindowsHost('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe(false);
    expect(isWindowsHost('', 'Win32')).toBe(true);
    expect(isWindowsHost('', 'Windows')).toBe(true);
    expect(isWindowsHost('', 'MacIntel')).toBe(false);
    expect(isWindowsHost('', 'Darwin')).toBe(false);
  });
});
