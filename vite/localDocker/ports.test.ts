import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  COMPANION_HOST,
  classifyPortProbeError,
  findOccupiedPorts,
  formatPortConflictError,
  isLoopbackIpv4Occupied,
  isPortOccupied,
  probeCompanionPort,
} from './ports.ts';

describe('ports', () => {
  it('formats Phase 1 PORT_CONFLICT without process names', () => {
    expect(formatPortConflictError([4010, 4443])).toBe('PORT_CONFLICT:[{"port":4010},{"port":4443}]');
  });

  it('treats connect timeouts as free so IPv6-off hosts do not look fully occupied', () => {
    expect(classifyPortProbeError('ETIMEDOUT')).toBe('free');
    expect(classifyPortProbeError('EADDRNOTAVAIL')).toBe('free');
    expect(classifyPortProbeError('ECONNREFUSED')).toBe('free');
    expect(classifyPortProbeError('EPERM')).toBe('free');
    expect(classifyPortProbeError('ENETUNREACH')).toBe('free');
    expect(classifyPortProbeError(undefined)).toBe('free');
  });

  it('collects occupied ports from the probe', async () => {
    await expect(findOccupiedPorts([4010, 18080], async (port) => port === 18080)).resolves.toEqual([18080]);
  });

  it('uses the real loopback probe when findOccupiedPorts has no override', async () => {
    await expect(findOccupiedPorts([65_534])).resolves.toEqual([]);
  });

  it('pins the companion probe to IPv4 loopback', () => {
    expect(COMPANION_HOST).toBe('127.0.0.1');
  });

  it('retries the companion probe until the budget expires', async () => {
    let now = 0;
    let attempts = 0;
    const ok = await probeCompanionPort({
      probe: async () => {
        attempts += 1;
        return attempts >= 3;
      },
      nowMs: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(ok).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  it('stops retrying when the companion budget is already spent', async () => {
    let now = 0;
    await expect(probeCompanionPort({
      probe: async () => false,
      nowMs: () => now,
      sleep: async () => {
        now += 4_900;
      },
    })).resolves.toBe(false);
  });

  it('uses Date.now when the companion is already up on the first probe', async () => {
    await expect(probeCompanionPort({
      probe: async () => true,
    })).resolves.toBe(true);
  });

  it('sleeps with the default timer when the first companion probe misses', async () => {
    const start = Date.now();
    let attempts = 0;
    await expect(probeCompanionPort({
      probe: async () => {
        attempts += 1;
        return attempts > 1;
      },
      nowMs: () => start,
    })).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it('probes the companion port with the default IPv4 helper', async () => {
    let now = 0;
    await expect(probeCompanionPort({
      nowMs: () => now,
      sleep: async () => {
        now += 10_000;
      },
    })).resolves.toBeTypeOf('boolean');
  });

  it('probes a live loopback listener as occupied', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);
    await expect(isPortOccupied(port)).resolves.toBe(true);
    await expect(isLoopbackIpv4Occupied(port)).resolves.toBe(true);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await expect(isPortOccupied(port)).resolves.toBe(false);
  });
});
