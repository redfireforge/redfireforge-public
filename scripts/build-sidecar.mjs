/**
 * Builds the companion as a self-contained Tauri sidecar binary.
 *
 * The desktop app has no `node_modules` and cannot assume Node is installed, so
 * the server is bundled to a single CJS file and injected into a copy of the
 * Node runtime using Node's Single Executable Application support.
 *
 * Output: src-tauri/binaries/redfireforge-companion-<target-triple>
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, rmSync, statSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TS_EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// Resolves tsconfig path aliases (e.g. @shared/*, @engine/*) for esbuild.
function tsconfigPathsPlugin() {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.server.json'), 'utf8'));
  const paths = tsconfig.compilerOptions?.paths ?? {};
  return {
    name: 'tsconfig-paths',
    setup(build) {
      for (const [alias, [target]] of Object.entries(paths)) {
        if (!alias.endsWith('/*')) continue;
        const prefix = alias.slice(0, -2);
        const targetDir = join(ROOT, target.slice(0, -2));
        const filter = new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&')}/`);
        build.onResolve({ filter }, args => {
          const base = join(targetDir, args.path.slice(prefix.length + 1));
          for (const ext of TS_EXTS) {
            const candidate = base + ext;
            if (isFile(candidate)) return { path: candidate };
          }
          // No match — let esbuild fall back (e.g. for scoped npm packages like @grpc/grpc-js).
        });
      }
    },
  };
}

const OUT_DIR = 'src-tauri/binaries';
const WORK = 'dist-server';
const BUNDLE = join(WORK, 'companion.cjs');
const BLOB = join(WORK, 'companion.blob');
const SEA_CONFIG = join(WORK, 'sea-config.json');

function rustTargetTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = out.split('\n').find(l => l.startsWith('host:'));
  if (!host) throw new Error('Could not determine host triple from `rustc -vV`.');
  return host.replace('host:', '').trim();
}

const triple = rustTargetTriple();
const isWindows = triple.includes('windows');
const isMac = triple.includes('apple');
const binName = `redfireforge-companion-${triple}${isWindows ? '.exe' : ''}`;
const binPath = join(OUT_DIR, binName);

// node-gyp's `devdir` leaks in as npm_config_devdir and npm 11+ warns on it.
delete process.env.npm_config_devdir;

function findWindowsSignTool() {
  const candidates = [];
  try {
    for (const line of execFileSync('where.exe', ['signtool'], { encoding: 'utf8' }).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) candidates.push(trimmed);
    }
  } catch {
    // signtool is often not on PATH
  }
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  try {
    for (const ver of readdirSync(kits)) {
      const candidate = join(kits, ver, 'x64', 'signtool.exe');
      if (isFile(candidate)) candidates.push(candidate);
    }
  } catch {
    // Windows SDK not installed
  }
  return candidates.find((p) => isFile(p)) ?? null;
}

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// 1. Bundle everything — the sidecar ships without node_modules.
await build({
  entryPoints: ['src-server/sidecar.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: BUNDLE,
  minify: true,
  sourcemap: false,
  // `import.meta.url` is empty in CJS; several modules use it via createRequire.
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: { js: "const __IMPORT_META_URL__=require('url').pathToFileURL(__filename).href;" },
  plugins: [tsconfigPathsPlugin()],
  logLevel: 'warning',
});
console.log(`bundled  ${BUNDLE} (${(statSync(BUNDLE).size / 1e6).toFixed(1)} MB)`);

// 2. Generate the SEA blob.
writeFileSync(SEA_CONFIG, JSON.stringify({
  main: BUNDLE,
  output: BLOB,
  disableExperimentalSEAWarning: true,
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], { stdio: 'inherit' });

// 3. Inject the blob into a copy of the Node runtime.
rmSync(binPath, { force: true });
copyFileSync(process.execPath, binPath);
chmodSync(binPath, 0o755);

// A signed binary must have its signature dropped before the section is added.
if (isMac) execFileSync('codesign', ['--remove-signature', binPath], { stdio: 'inherit' });
if (isWindows) {
  const signtool = findWindowsSignTool();
  if (signtool) {
    execFileSync(signtool, ['remove', '/s', binPath], { stdio: 'inherit' });
  } else {
    console.warn('signtool not found; postject may warn that the copied Node.js signature looks corrupted.');
  }
}

const postject = [
  binPath, 'NODE_SEA_BLOB', BLOB,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (isMac) postject.push('--macho-segment-name', 'NODE_SEA');
const npxEnv = { ...process.env };
delete npxEnv.npm_config_devdir;
execFileSync('npx', ['--yes', 'postject', ...postject], { stdio: 'inherit', shell: isWindows, env: npxEnv });

// Ad-hoc signature keeps macOS from killing the binary; `tauri build` re-signs
// the whole bundle with the real identity afterwards.
if (isMac) execFileSync('codesign', ['--sign', '-', binPath], { stdio: 'inherit' });

rmSync(BLOB, { force: true });
console.log(`✅ sidecar ${binPath} (${(statSync(binPath).size / 1e6).toFixed(0)} MB)`);
