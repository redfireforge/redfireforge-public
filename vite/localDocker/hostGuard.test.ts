import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  assertLocalDockerRequest,
  isLoopbackHostHeader,
  isLoopbackRemoteAddress,
  stripHostPort,
} from './hostGuard.ts';

function req(remoteAddress: string, host?: string, extras?: Record<string, string>): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: {
      host,
      ...extras,
    },
  } as unknown as IncomingMessage;
}

describe('hostGuard', () => {
  it('strips Host port and IPv6 brackets', () => {
    expect(stripHostPort('localhost:5176')).toBe('localhost');
    expect(stripHostPort('127.0.0.1:5173')).toBe('127.0.0.1');
    expect(stripHostPort('[::1]:5176')).toBe('::1');
  });

  it('allows loopback Host values', () => {
    expect(isLoopbackHostHeader('localhost')).toBe(true);
    expect(isLoopbackHostHeader('localhost:5176')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1:5173')).toBe(true);
    expect(isLoopbackHostHeader('app.localhost')).toBe(true);
    expect(isLoopbackHostHeader('[::1]:5176')).toBe(true);
  });

  it('denies hosted and LAN Host values', () => {
    expect(isLoopbackHostHeader('app.redfireforge.com')).toBe(false);
    expect(isLoopbackHostHeader('192.168.1.10:5176')).toBe(false);
  });

  it('treats IPv4-mapped loopback remotes as local', () => {
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
    expect(isLoopbackRemoteAddress('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:7f00:1')).toBe(true);
    expect(isLoopbackRemoteAddress('127.0.0.1%lo0')).toBe(true);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
    expect(isLoopbackRemoteAddress('192.168.1.10')).toBe(false);
    expect(isLoopbackHostHeader('127.0.0.1.')).toBe(true);
    expect(isLoopbackHostHeader('256.0.0.1')).toBe(false);
    expect(isLoopbackHostHeader('localhost:notaport')).toBe(false);
    expect(stripHostPort('[unclosed')).toBe('[unclosed');
    expect(isLoopbackRemoteAddress('::ffff:c0a8:1')).toBe(false);
    expect(isLoopbackRemoteAddress('0:0:0:0:0:ffff:c0a8:1')).toBe(false);
    expect(isLoopbackHostHeader('::ffff:127.0.0.1')).toBe(true);
  });

  it('reads the first Host header when the value is an array', () => {
    const incoming = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: ['localhost:5173', 'evil.example'] },
    } as unknown as IncomingMessage;
    expect(assertLocalDockerRequest(incoming)).toBe(true);
  });

  it('allows 127.0.0.1 + Host localhost', () => {
    expect(assertLocalDockerRequest(req('127.0.0.1', 'localhost'))).toBe(true);
    expect(assertLocalDockerRequest(req('127.0.0.1', 'localhost:5176'))).toBe(true);
  });

  it('denies LAN remote even when Host is localhost', () => {
    expect(assertLocalDockerRequest(req('192.168.1.10', 'localhost'))).toBe(false);
  });

  it('denies loopback remote when Host is hosted', () => {
    expect(assertLocalDockerRequest(req('127.0.0.1', 'app.redfireforge.com'))).toBe(false);
  });

  it('ignores X-Forwarded-Host spoofing from a LAN remote', () => {
    expect(assertLocalDockerRequest(req('192.168.1.10', 'evil.example', {
      'x-forwarded-host': 'localhost',
    }))).toBe(false);
  });

  it('denies missing Host', () => {
    expect(assertLocalDockerRequest(req('127.0.0.1'))).toBe(false);
  });
});
