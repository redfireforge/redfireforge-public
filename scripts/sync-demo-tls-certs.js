#!/usr/bin/env node
/**
 * Syncs bundled demo TLS PEMs into lesson constants.
 * Used by scripts/renew-demo-tls-certs.sh and safe to run alone.
 *
 * Updates only PEM / key string constants — never lesson steps or narration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

function readPem(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').trim();
}

function replaceTemplateConst(src, name, pem) {
  const re = new RegExp(`export const ${name} = \`[\\s\\S]*?\`;`);
  if (!re.test(src)) {
    throw new Error(`Could not find template const ${name}`);
  }
  return src.replace(re, `export const ${name} = \`${pem}\`;`);
}

function replaceQuotedConst(src, name, pem) {
  const re = new RegExp(`export const ${name} = "[\\s\\S]*?";`);
  if (!re.test(src)) {
    throw new Error(`Could not find quoted const ${name}`);
  }
  return src.replace(re, `export const ${name} = ${JSON.stringify(pem)};`);
}

function patch(rel, transform) {
  const full = path.join(ROOT, rel);
  const before = fs.readFileSync(full, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`unchanged: ${rel}`);
    return;
  }
  if (CHECK) {
    console.error(`out of sync: ${rel}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(full, after);
  console.log(`updated:   ${rel}`);
}

patch('packages/demo-hub/src/lessons/protocols/ws-tls-demo-certs.ts', (src) => {
  src = replaceTemplateConst(src, 'WS_TLS_DEMO_CA_CERT', readPem('docker/websocket/certs/ca.crt'));
  src = replaceTemplateConst(src, 'WS_TLS_DEMO_CLIENT_CERT', readPem('docker/websocket/certs/client.crt'));
  src = replaceTemplateConst(src, 'WS_TLS_DEMO_CLIENT_KEY', readPem('docker/websocket/certs/client.key'));
  return src;
});

patch('packages/demo-hub/src/lessons/protocols/graphql-lesson-helpers/lesson-https-tls.ts', (src) => {
  src = replaceTemplateConst(src, 'GQL_TLS_CA_CERT', readPem('docker/graphql/tls/certs/ca.crt'));
  src = replaceTemplateConst(src, 'GQL_TLS_CLIENT_CERT', readPem('docker/graphql/tls/certs/client.crt'));
  src = replaceTemplateConst(src, 'GQL_TLS_CLIENT_KEY', readPem('docker/graphql/tls/certs/client.key'));
  return src;
});

patch('packages/demo-hub/src/lessons/protocols/kafka-tls.ts', (src) =>
  replaceQuotedConst(src, 'KAFKA_TLS_DEMO_CA_PEM', readPem('docker/kafka/tls/certs/ca.crt')),
);

patch('packages/demo-hub/src/lessons/protocols/grpc-tls-helpers.ts', (src) => {
  src = replaceTemplateConst(src, 'DEMO_CA_CERT', readPem('docker/grpc/certs/ca.crt'));
  src = replaceTemplateConst(src, 'DEMO_CLIENT_CERT', readPem('docker/grpc/certs/client.crt'));
  src = replaceTemplateConst(src, 'DEMO_CLIENT_KEY', readPem('docker/grpc/certs/client.key'));
  return src;
});

if (CHECK && process.exitCode) {
  console.error('PEM constants do not match docker/*/certs/. Run: node scripts/sync-demo-tls-certs.js');
  process.exit(1);
}

console.log('Demo TLS PEM constants match docker/*/certs/.');
