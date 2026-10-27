import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'kafkajs');
const dest = join(root, 'src-tauri', 'resources', 'event-hubs', 'node_modules', 'kafkajs');

if (!existsSync(source)) {
  console.error('kafkajs is not installed. Run npm ci before packaging the desktop app.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(source, dest, { recursive: true, dereference: true });
console.log(`Staged KafkaJS for Event Hubs consume at ${dest}`);
