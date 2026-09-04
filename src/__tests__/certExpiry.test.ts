/**
 * Ensures bundled demo TLS certs stay valid and lesson PEM constants match disk.
 *
 * If this fails: bash scripts/renew-demo-tls-certs.sh
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCKER_DIR = path.join(REPO_ROOT, 'docker');
const MIN_DAYS = 730;
const skipOpenssl = process.env.SKIP_CERT_EXPIRY_TEST === '1';

function walkKeyFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'target' || entry === 'node_modules') continue;
      results.push(...walkKeyFiles(full));
    } else if (entry.endsWith('.key')) {
      results.push(full);
    }
  }
  return results;
}

function findCerts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'target' || entry === 'node_modules') continue;
      results.push(...findCerts(full));
    } else if (entry.endsWith('.crt')) {
      results.push(full);
    }
  }
  return results;
}

function pemBody(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('-----'))
    .join('');
}

function extractNamedPem(src: string, name: string): string {
  const template = src.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
  if (template) return template[1];
  const quoted = src.match(new RegExp(`export const ${name} = "([\\s\\S]*?)";`));
  if (quoted) return quoted[1].replace(/\\n/g, '\n');
  throw new Error(`Missing export ${name}`);
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function certDaysRemaining(certPath: string): number {
  return calendarDaysBetween(utcToday(), certUtcDate(certPath));
}

const certs = findCerts(DOCKER_DIR);
const opensslDescribe = skipOpenssl ? describe.skip : describe;

describe('bundled demo TLS certs exist', () => {
  it('finds at least one docker/**/*.crt', () => {
    expect(
      certs.length,
      'No .crt files under docker/. Run: bash scripts/renew-demo-tls-certs.sh',
    ).toBeGreaterThan(0);
  });
});

opensslDescribe('TLS cert expiry — bundled demo certs', () => {
  it.each(certs.map((c) => [path.relative(REPO_ROOT, c), c]))(
    '%s must have at least %i days remaining',
    (_rel, certPath) => {
      const days = certDaysRemaining(certPath);
      expect(
        days,
        `Cert "${_rel}" expires in ${days} days (minimum ${MIN_DAYS}). Run: bash scripts/renew-demo-tls-certs.sh`,
      ).toBeGreaterThanOrEqual(MIN_DAYS);
    },
  );
});

const PEM_PAIRS: Array<[string, string, string]> = [
  ['docker/graphql/tls/certs/ca.crt', 'packages/demo-hub/src/lessons/protocols/graphql-lesson-helpers/lesson-https-tls.ts', 'GQL_TLS_CA_CERT'],
  ['docker/graphql/tls/certs/client.crt', 'packages/demo-hub/src/lessons/protocols/graphql-lesson-helpers/lesson-https-tls.ts', 'GQL_TLS_CLIENT_CERT'],
  ['docker/graphql/tls/certs/client.key', 'packages/demo-hub/src/lessons/protocols/graphql-lesson-helpers/lesson-https-tls.ts', 'GQL_TLS_CLIENT_KEY'],
  ['docker/websocket/certs/ca.crt', 'packages/demo-hub/src/lessons/protocols/ws-tls-demo-certs.ts', 'WS_TLS_DEMO_CA_CERT'],
  ['docker/websocket/certs/client.crt', 'packages/demo-hub/src/lessons/protocols/ws-tls-demo-certs.ts', 'WS_TLS_DEMO_CLIENT_CERT'],
  ['docker/websocket/certs/client.key', 'packages/demo-hub/src/lessons/protocols/ws-tls-demo-certs.ts', 'WS_TLS_DEMO_CLIENT_KEY'],
  ['docker/kafka/tls/certs/ca.crt', 'packages/demo-hub/src/lessons/protocols/kafka-tls.ts', 'KAFKA_TLS_DEMO_CA_PEM'],
  ['docker/grpc/certs/ca.crt', 'packages/demo-hub/src/lessons/protocols/grpc-tls-helpers.ts', 'DEMO_CA_CERT'],
  ['docker/grpc/certs/client.crt', 'packages/demo-hub/src/lessons/protocols/grpc-tls-helpers.ts', 'DEMO_CLIENT_CERT'],
  ['docker/grpc/certs/client.key', 'packages/demo-hub/src/lessons/protocols/grpc-tls-helpers.ts', 'DEMO_CLIENT_KEY'],
];

describe('TLS lesson PEMs match bundled cert files', () => {
  it.each(PEM_PAIRS)('%s ↔ %s (%s)', (diskRel, srcRel, constName) => {
    const disk = readFileSync(path.join(REPO_ROOT, diskRel), 'utf8');
    const src = readFileSync(path.join(REPO_ROOT, srcRel), 'utf8');
    expect(pemBody(extractNamedPem(src, constName))).toBe(pemBody(disk));
  });

  it('sync-demo-tls-certs.js covers every PEM pair', () => {
    const sync = readFileSync(path.join(REPO_ROOT, 'scripts/sync-demo-tls-certs.js'), 'utf8');
    for (const [diskRel, srcRel, constName] of PEM_PAIRS) {
      expect(sync, constName).toContain(constName);
      expect(sync, diskRel).toContain(diskRel);
      expect(sync, srcRel).toContain(srcRel);
    }
  });
});

function certUtcDate(certPath: string): string {
  const output = execSync(`openssl x509 -noout -enddate -in "${certPath}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const match = output.match(/notAfter=(.+)/);
  if (!match) throw new Error(`Cannot parse notAfter from ${certPath}`);
  const expiry = new Date(match[1].trim());
  if (Number.isNaN(expiry.getTime())) throw new Error(`Invalid notAfter in ${certPath}`);
  return expiry.toISOString().slice(0, 10);
}

const TLS_STACK_CERTS: Array<[string, string[]]> = [
  ['docker/graphql/tls/stack.json', [
    'docker/graphql/tls/certs/ca.crt',
    'docker/graphql/tls/certs/server.crt',
    'docker/graphql/tls/certs/client.crt',
  ]],
  ['docker/websocket/stack.json', [
    'docker/websocket/certs/ca.crt',
    'docker/websocket/certs/server.crt',
    'docker/websocket/certs/client.crt',
  ]],
  ['docker/kafka/tls/stack.json', [
    'docker/kafka/tls/certs/ca.crt',
    'docker/kafka/tls/certs/broker.crt',
  ]],
  ['docker/grpc/stack.json', [
    'docker/grpc/certs/ca.crt',
    'docker/grpc/certs/server.crt',
    'docker/grpc/certs/client.crt',
  ]],
  ['docker/grpc/stack-spring.json', [
    'docker/grpc/certs/ca.crt',
    'docker/grpc/certs/server.crt',
    'docker/grpc/certs/client.crt',
  ]],
];

const NON_TLS_STACKS = [
  'docker/graphql/stack.json',
  'docker/kafka/plaintext/stack.json',
  'docker/kafka/secure/stack.json',
  'docker/kafka/schema-registry/stack.json',
  'docker/websocket/socketio/stack.json',
  'docker/websocket/graphql/stack.json',
  'docker/websocket/stomp/stack.json',
  'docker/api-mock/stack.json',
];

function findStackManifests(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'target' || entry === 'node_modules') continue;
      results.push(...findStackManifests(full));
    } else if (entry === 'stack.json' || entry === 'stack-spring.json') {
      results.push(full);
    }
  }
  return results;
}

function readmeExpiresOn(rel: string): string {
  const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const match = text.match(/^Expires:\s+(\d{4}-\d{2}-\d{2})/m);
  if (!match) throw new Error(`No Expires: YYYY-MM-DD line in ${rel}`);
  return match[1];
}

function stackExpiresAt(rel: string): string | null {
  const stack = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as {
    certExpiresAt: string | null;
  };
  return stack.certExpiresAt;
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

describe('stack.json certExpiresAt matches bundled cert UTC dates', () => {
  opensslDescribe('TLS stacks', () => {
    it.each(TLS_STACK_CERTS)('%s matches shortest cert UTC date', (stackRel, certRels) => {
      const dates = certRels.map((rel) => certUtcDate(path.join(REPO_ROOT, rel)));
      const shortest = dates.reduce((a, b) => (a < b ? a : b));
      expect(stackExpiresAt(stackRel)).toBe(shortest);
    });
  });

  it.each(NON_TLS_STACKS)('%s has null certExpiresAt', (stackRel) => {
    expect(stackExpiresAt(stackRel)).toBeNull();
  });

  it('gRPC stack.json and stack-spring.json share certExpiresAt', () => {
    expect(stackExpiresAt('docker/grpc/stack.json')).toBe(
      stackExpiresAt('docker/grpc/stack-spring.json'),
    );
  });

  it('lists every docker stack.json / stack-spring.json', () => {
    const found = findStackManifests(DOCKER_DIR).map((p) => toPosix(path.relative(REPO_ROOT, p)));
    const listed = [...TLS_STACK_CERTS.map(([rel]) => rel), ...NON_TLS_STACKS];
    expect(found.sort()).toEqual([...listed].sort());
  });

  it('README Expires line matches TLS stack.json', () => {
    const pairs: Array<[string, string]> = [
      ['docker/graphql/tls/certs/README.md', 'docker/graphql/tls/stack.json'],
      ['docker/websocket/certs/README.md', 'docker/websocket/stack.json'],
      ['docker/kafka/tls/certs/README.md', 'docker/kafka/tls/stack.json'],
      ['docker/grpc/certs/README.md', 'docker/grpc/stack.json'],
    ];
    for (const [readmeRel, stackRel] of pairs) {
      expect(readmeExpiresOn(readmeRel), readmeRel).toBe(stackExpiresAt(stackRel));
    }
  });

  it('does not leave unused docker/kafka/certs/ material', () => {
    const unused = path.join(REPO_ROOT, 'docker/kafka/certs');
    const nested = findCerts(unused);
    const keys = walkKeyFiles(unused);
    expect(nested.length + keys.length, 'TLS material belongs in docker/kafka/tls/certs/').toBe(0);
  });

  it('keeps the Kafka TLS README beside generated certs', () => {
    expect(existsSync(path.join(REPO_ROOT, 'docker/kafka/tls/certs/README.md'))).toBe(true);
  });

  it('ships a certs/README.md for every TLS stack', () => {
    for (const rel of [
      'docker/graphql/tls/certs/README.md',
      'docker/websocket/certs/README.md',
      'docker/kafka/tls/certs/README.md',
      'docker/grpc/certs/README.md',
    ]) {
      expect(existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true);
    }
  });

  it('marks demo cert files as binary in .gitattributes', () => {
    const attrs = readFileSync(path.join(REPO_ROOT, '.gitattributes'), 'utf8');
    expect(attrs).toContain('docker/**/*.crt   binary');
    expect(attrs).toContain('docker/**/*.key   binary');
    expect(attrs).toContain('docker/**/*.pem   binary');
  });

  it('kafka generate-certs.sh does not rm -rf the certs directory', () => {
    const src = readFileSync(path.join(REPO_ROOT, 'docker/kafka/tls/generate-certs.sh'), 'utf8');
    expect(src).not.toMatch(/rm\s+-rf\s+"?\$CERTS_DIR/);
    expect(src).toContain('README.md');
    expect(src).toMatch(/DAYS="\$\{DAYS:-3650\}"/);
  });

  it.each([
    'docker/graphql/tls/generate-cert.sh',
    'docker/graphql/tls/generate-client-cert.sh',
    'docker/websocket/generate-cert.sh',
    'docker/websocket/generate-client-cert.sh',
    'docker/kafka/tls/generate-certs.sh',
    'docker/grpc/certs/generate.sh',
  ])('%s honors DAYS (default 3650)', (rel) => {
    const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    expect(src).toMatch(/DAYS="\$\{DAYS:-3650\}"/);
  });

  it('sync-demo-tls-certs.js --check is clean', () => {
    expect(() =>
      execSync('node scripts/sync-demo-tls-certs.js --check', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).not.toThrow();
  });
});
