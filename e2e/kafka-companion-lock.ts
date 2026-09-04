/**
 * Cross-worker lock for live Kafka E2E specs.
 *
 * Companion :3001 keeps a single Kafka connection. kafka-live, kafka-secure,
 * and kafka-tls must not connect/disconnect at the same time (nightly uses
 * --workers=2), or Consume stays on "Consuming…" until the request dies.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { test as PlaywrightTest } from '@playwright/test';

const LOCK_PATH = join(tmpdir(), 'rff-e2e-kafka-companion.lock');
const DEFAULT_TIMEOUT_MS = 180_000;

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryReleaseStaleLock(): void {
  if (!existsSync(LOCK_PATH)) return;
  try {
    const pid = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    if (!isPidAlive(pid)) unlinkSync(LOCK_PATH);
  } catch {
    // lock disappeared between exists and read
  }
}

export async function acquireKafkaCompanionLock(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      return;
    } catch {
      tryReleaseStaleLock();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the Kafka companion lock`);
}

export function releaseKafkaCompanionLock(): void {
  try {
    const pid = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid === process.pid) unlinkSync(LOCK_PATH);
  } catch {
    // already released or owned by another worker
  }
}

/** Hold the companion exclusively for every test in this spec file. */
export function installKafkaCompanionLock(test: typeof PlaywrightTest): void {
  test.beforeAll(async () => {
    test.setTimeout(DEFAULT_TIMEOUT_MS);
    await acquireKafkaCompanionLock();
  });
  test.afterAll(() => {
    releaseKafkaCompanionLock();
  });
}
