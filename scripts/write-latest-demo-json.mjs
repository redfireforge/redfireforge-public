#!/usr/bin/env node
/**
 * Build latest-demo.json from Learning Hub updater artifacts on a shared vX.Y.Z
 * release so Standard's latest.json is not overwritten.
 *
 * Usage:
 *   node scripts/write-latest-demo-json.mjs --dir <assets> --tag vX.Y.Z --out latest-demo.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'redfireforge/redfireforge-public';

const PLATFORM_RULES = [
  { platform: 'darwin-aarch64', test: /LearningHub.*darwin-aarch64\.app\.tar\.gz$/i },
  { platform: 'darwin-x86_64', test: /LearningHub.*darwin-(x64|x86_64)\.app\.tar\.gz$/i },
  { platform: 'linux-x86_64', test: /LearningHub.*linux.*\.AppImage\.tar\.gz$/i },
  { platform: 'windows-x86_64', test: /LearningHub.*windows.*\.(nsis\.zip|exe)$/i },
];

export function parseArgs(argv) {
  const out = { dir: '', tag: '', notes: '', outFile: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1] ?? '';
    if (key === '--dir') { out.dir = val; i += 1; }
    else if (key === '--tag') { out.tag = val; i += 1; }
    else if (key === '--notes') { out.notes = val; i += 1; }
    else if (key === '--out') { out.outFile = val; i += 1; }
  }
  return out;
}

export function assetUrl(tag, fileName) {
  return `https://github.com/${REPO}/releases/download/${tag}/${fileName}`;
}

export function pickLearningHubUpdaterAssets(fileNames) {
  const names = fileNames.filter((n) => /LearningHub/i.test(n) && !n.endsWith('.sig'));
  const platforms = {};
  for (const rule of PLATFORM_RULES) {
    const file = names.find((n) => rule.test.test(n));
    if (!file) continue;
    const sig = `${file}.sig`;
    if (!fileNames.includes(sig)) continue;
    platforms[rule.platform] = { file, sig };
  }
  return platforms;
}

export function buildLatestDemoJson({ tag, notes, fileNames, readSig, pubDate }) {
  const version = tag.replace(/^v/, '');
  const picked = pickLearningHubUpdaterAssets(fileNames);
  const platforms = {};
  for (const [platform, { file, sig }] of Object.entries(picked)) {
    const signature = readSig(sig).trim();
    if (!signature) continue;
    platforms[platform] = { signature, url: assetUrl(tag, file) };
  }
  if (Object.keys(platforms).length === 0) return null;
  return {
    version,
    notes: notes || '',
    pub_date: pubDate,
    platforms,
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.dir || !args.tag || !args.outFile) {
    console.error('Usage: write-latest-demo-json.mjs --dir <dir> --tag vX.Y.Z --out <file> [--notes "..."]');
    process.exit(2);
  }
  const fileNames = readdirSync(args.dir);
  const json = buildLatestDemoJson({
    tag: args.tag,
    notes: args.notes,
    fileNames,
    readSig: (name) => readFileSync(join(args.dir, name), 'utf8'),
    pubDate: new Date().toISOString(),
  });
  if (!json) {
    console.log('No signed Learning Hub updater artifacts — skipped latest-demo.json');
    process.exit(0);
  }
  writeFileSync(args.outFile, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Wrote ${basename(args.outFile)} with ${Object.keys(json.platforms).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
