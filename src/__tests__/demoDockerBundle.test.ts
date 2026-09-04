/**
 * Learning Hub docker/ bundle globs must not scoop local node_modules
 * (docker/graphql/node_modules is gitignored but present after a local npm install).
 * Every glob must match at least one repo file — empty Tauri resource globs fail the build.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_TAURI = path.join(REPO_ROOT, 'src-tauri');
const DOCKER_ROOT = path.join(REPO_ROOT, 'docker');
const DEMO_CONF = path.join(REPO_ROOT, 'src-tauri/tauri.conf.demo.json');

const FORBIDDEN_GLOBS = [
  '../docker/**/*.js',
  '../docker/**/*.mjs',
  '../docker/**/*.json',
  '../docker/**/*.md',
  '../docker/**/*.txt',
  '../docker/**/*.yml',
];

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'target', '.settings']);

function globToRegExp(pattern: string): RegExp {
  let i = 0;
  let out = '^';
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (pattern.startsWith('**', i) && i + 2 === pattern.length) {
      out += '.*';
      i += 2;
      continue;
    }
    const c = pattern[i];
    if (c === '*') {
      out += '[^/]*';
    } else if ('.\\[]{}()+-^$|?'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function toTauriRel(abs: string): string {
  return path.relative(SRC_TAURI, abs).split(path.sep).join('/');
}

function toRepoRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function matchesGlob(tauriRel: string, glob: string): boolean {
  return globToRegExp(glob).test(tauriRel);
}

function expandCopyGlob(dir: string, relGlob: string): string[] {
  const parent = path.join(dir, path.dirname(relGlob));
  const pat = path.basename(relGlob);
  if (!existsSync(parent)) return [];
  const re = globToRegExp(pat);
  return readdirSync(parent)
    .filter((name) => re.test(name))
    .map((name) => path.join(parent, name))
    .filter((abs) => existsSync(abs) && !statSync(abs).isDirectory());
}

function dockerfileCopySources(dockerfileAbs: string): string[] {
  const dir = path.dirname(dockerfileAbs);
  const text = readFileSync(dockerfileAbs, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/^(?:COPY|ADD)\s+(.+)$/gm)) {
    const rest = m[1].trim();
    if (rest.startsWith('--from=')) continue;
    const parts = rest.split(/\s+/).filter((p) => !p.startsWith('--'));
    if (parts.length < 2) continue;
    for (const src of parts.slice(0, -1)) {
      if (src.includes('*')) {
        out.push(...expandCopyGlob(dir, src));
        continue;
      }
      const abs = path.join(dir, src);
      if (!existsSync(abs)) continue;
      if (statSync(abs).isDirectory()) out.push(...walkFiles(abs));
      else out.push(abs);
    }
  }
  return out;
}

/** Host paths compose bind-mounts or Dockerfiles COPY — these must be in the Learning Hub bundle. */
function collectComposeRuntimeFiles(composeAbs: string): string[] {
  const text = readFileSync(composeAbs, 'utf8');
  const composeDir = path.dirname(composeAbs);
  const required = new Set<string>();
  const resolve = (rel: string) => path.resolve(composeDir, rel.replace(/\s+#.*$/, ''));

  for (const m of text.matchAll(/^\s+-\s+(\.[^\s:]+):/gm)) {
    const abs = resolve(m[1]);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walkFiles(abs).forEach((f) => required.add(f));
    else required.add(abs);
  }

  const dockerfiles: string[] = [];
  const addDockerfile = (abs: string) => {
    if (existsSync(abs) && !statSync(abs).isDirectory()) dockerfiles.push(abs);
  };
  for (const m of text.matchAll(/^\s+build:\s+(\.\S*)/gm)) {
    const ctx = resolve(m[1]);
    addDockerfile(path.join(ctx, 'Dockerfile'));
  }
  for (const m of text.matchAll(/^\s+context:\s+(\.\S*)/gm)) {
    const ctx = resolve(m[1]);
    addDockerfile(path.join(ctx, 'Dockerfile'));
  }
  for (const m of text.matchAll(/^\s+dockerfile:\s+(\S+)/gm)) {
    const df = m[1];
    addDockerfile(df.startsWith('.') ? resolve(df) : path.join(composeDir, df));
  }
  for (const df of dockerfiles) {
    required.add(df);
    dockerfileCopySources(df).forEach((f) => required.add(f));
  }
  return [...required];
}

describe('Learning Hub docker bundle (tauri.conf.demo.json)', () => {
  const conf = JSON.parse(readFileSync(DEMO_CONF, 'utf8')) as {
    bundle: { resources: string[] };
  };
  const resources = conf.bundle.resources.filter((r) => r.startsWith('../docker/'));
  const dockerFiles = walkFiles(DOCKER_ROOT);

  it('does not bundle cert generation scripts or openssl cnf files', () => {
    expect(resources).not.toContain('../docker/**/certs/*.sh');
    expect(resources).not.toContain('../docker/**/certs/*.cnf');
    expect(resources.some((r) => /generate-.*\.sh/.test(r) || r.endsWith('/generate.sh'))).toBe(false);
  });

  it('does not use catch-all globs that match docker/**/node_modules', () => {
    for (const glob of FORBIDDEN_GLOBS) {
      expect(resources, `remove ${glob} — it matches node_modules`).not.toContain(glob);
    }
    expect(resources.some((r) => r.includes('node_modules'))).toBe(false);
  });

  it('every docker resource glob matches at least one repo file and never node_modules', () => {
    for (const glob of resources) {
      const hits = dockerFiles.filter((abs) => matchesGlob(toTauriRel(abs), glob));
      expect(hits.length, `empty glob would fail tauri:build:demo: ${glob}`).toBeGreaterThan(0);
      for (const abs of hits) {
        expect(toRepoRel(abs).includes('/node_modules/'), abs).toBe(false);
      }
    }
  });

  it('covers every compose-referenced local file and directory entry', () => {
    const composeFiles = dockerFiles.filter((abs) => /docker-compose[^/]*\.yml$/.test(abs));
    expect(composeFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const compose of composeFiles) {
      for (const abs of collectComposeRuntimeFiles(compose)) {
        const rel = toRepoRel(abs);
        const base = path.basename(rel);
        if (base === '.gitkeep' || base === '.DS_Store') continue;
        // Cert generate scripts / openssl cnf are repo-checkout only (Phase 4).
        if (rel.endsWith('.sh') || rel.endsWith('.cnf')) continue;
        const covered = resources.some((glob) => matchesGlob(toTauriRel(abs), glob));
        if (!covered) missing.push(`${rel} (from ${toRepoRel(compose)})`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('bundles every stack.json / stack-spring.json', () => {
    const manifests = dockerFiles.filter((abs) => {
      const base = path.basename(abs);
      return base === 'stack.json' || base === 'stack-spring.json';
    });
    expect(manifests.map(toRepoRel).sort()).toHaveLength(13);
    const required = [
      'stackKey',
      'sinceVersion',
      'description',
      'composeFiles',
      'buildOnStart',
      'composeProfile',
      'requiresCompanionProbe',
      'ports',
      'minMemoryMb',
      'certExpiresAt',
    ];
    for (const abs of manifests) {
      const covered = resources.some((glob) => matchesGlob(toTauriRel(abs), glob));
      expect(covered, `${toRepoRel(abs)} is not in tauri.conf.demo.json resources`).toBe(true);
      const obj = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
      for (const key of required) {
        expect(obj, `${toRepoRel(abs)} missing ${key}`).toHaveProperty(key);
      }
    }
  });

  it('bundles a CA cert for every TLS stack', () => {
    const tlsCas = [
      'docker/graphql/tls/certs/ca.crt',
      'docker/websocket/certs/ca.crt',
      'docker/kafka/tls/certs/ca.crt',
      'docker/grpc/certs/ca.crt',
    ];
    for (const rel of tlsCas) {
      const abs = path.join(REPO_ROOT, rel);
      expect(existsSync(abs), rel).toBe(true);
      const covered = resources.some((glob) => matchesGlob(toTauriRel(abs), glob));
      expect(covered, `${rel} is not in tauri.conf.demo.json resources`).toBe(true);
    }
  });

  it('bundles server or broker material each TLS compose stack mounts', () => {
    const runtime = [
      'docker/graphql/tls/certs/server.crt',
      'docker/graphql/tls/certs/server.key',
      'docker/websocket/certs/server.crt',
      'docker/websocket/certs/server.key',
      'docker/grpc/certs/server.crt',
      'docker/grpc/certs/server.key',
      'docker/kafka/tls/certs/broker.crt',
      'docker/kafka/tls/certs/broker.key',
    ];
    for (const rel of runtime) {
      const abs = path.join(REPO_ROOT, rel);
      expect(existsSync(abs), rel).toBe(true);
      const covered = resources.some((glob) => matchesGlob(toTauriRel(abs), glob));
      expect(covered, `${rel} is not in tauri.conf.demo.json resources`).toBe(true);
    }
  });

  it('labels generate-script paths in bundled READMEs as repo-checkout only', () => {
    const mentionsGenerate = /generate-(?:client-)?certs?\.sh|certs\/generate\.sh|\.\/generate\.sh/;
    const missing: string[] = [];
    for (const glob of resources.filter((r) => r.endsWith('.md'))) {
      const hits = dockerFiles.filter((abs) => matchesGlob(toTauriRel(abs), glob));
      for (const abs of hits) {
        const text = readFileSync(abs, 'utf8');
        if (!mentionsGenerate.test(text)) continue;
        if (!/repo checkout only/i.test(text)) missing.push(toRepoRel(abs));
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('keeps compose files LF-only so Docker Desktop on Windows can parse them', () => {
    const composeFiles = dockerFiles.filter((abs) => /docker-compose[^/]*\.ya?ml$/.test(abs));
    expect(composeFiles.length).toBeGreaterThan(0);
    for (const abs of composeFiles) {
      const buf = readFileSync(abs);
      expect(buf.includes(0x0d), `${toRepoRel(abs)} has CR (commit with LF)`).toBe(false);
    }
  });
});
