import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  accessTokenFromAzJson,
  acquireAzureEventHubToken,
  runAzureCli,
  type AzureCliResult,
} from './azure-event-hub-token';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_program: string, _args: string[], _opts: unknown, callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void) => {
    callback(Object.assign(new Error('spawn az ENOENT'), { code: 'ENOENT' }), '', '');
  }),
}));

function cliResult(overrides: Partial<AzureCliResult> = {}): AzureCliResult {
  return {
    stdout: JSON.stringify({ accessToken: 'header.payload.sig' }),
    stderr: '',
    exitCode: 0,
    notFound: false,
    ...overrides,
  };
}

describe('accessTokenFromAzJson', () => {
  it('reads accessToken and strips a Bearer prefix', () => {
    expect(accessTokenFromAzJson('{"accessToken":"header.payload.sig"}')).toBe('header.payload.sig');
    expect(accessTokenFromAzJson('{"accessToken":"Bearer header.payload.sig"}')).toBe('header.payload.sig');
  });

  it('rejects an unreadable or empty token response', () => {
    expect(() => accessTokenFromAzJson('not-json')).toThrow(/could not be read/);
    expect(() => accessTokenFromAzJson('{"accessToken":""}')).toThrow(/No access token/);
    expect(() => accessTokenFromAzJson('null')).toThrow(/No access token/);
    expect(() => accessTokenFromAzJson('{"accessToken":1}')).toThrow(/No access token/);
  });
});

describe('acquireAzureEventHubToken', () => {
  it('requests a token for the Event Hubs namespace resource', async () => {
    const run = vi.fn(async () => cliResult());
    const token = await acquireAzureEventHubToken(
      ['a218876-t01-musea2-evhns.servicebus.windows.net:9093'],
      run,
    );
    expect(token).toBe('header.payload.sig');
    expect(run).toHaveBeenCalledWith([
      'account',
      'get-access-token',
      '--resource',
      'https://a218876-t01-musea2-evhns.servicebus.windows.net',
      '--output',
      'json',
    ]);
  });

  it('refuses brokers that are not Event Hubs namespaces', async () => {
    await expect(acquireAzureEventHubToken(['127.0.0.1:9092'], vi.fn())).rejects.toThrow(
      /\*\.servicebus\.windows\.net/,
    );
  });

  it('reports a missing Azure CLI and a failed login', async () => {
    await expect(acquireAzureEventHubToken(
      ['ns.servicebus.windows.net:9093'],
      async () => cliResult({ notFound: true, exitCode: 1, stdout: '' }),
    )).rejects.toThrow(/Install the Azure CLI/);

    await expect(acquireAzureEventHubToken(
      ['ns.servicebus.windows.net:9093'],
      async () => cliResult({
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: Please run az login\neyJshould-not-leak',
      }),
    )).rejects.toThrow(/Please run az login/);
  });

  it('omits an empty Azure CLI error detail', async () => {
    await expect(acquireAzureEventHubToken(
      ['ns.servicebus.windows.net:9093'],
      async () => cliResult({ exitCode: 1, stdout: '', stderr: '   \n' }),
    )).rejects.toThrow(/Run az login, then connect again\.$/);
  });
});

describe('runAzureCli', () => {
  it('reports a missing az binary as not found', async () => {
    const result = await runAzureCli(['account', 'show']);
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('returns the token text when az succeeds and keeps a numeric exit code', async () => {
    const mocked = vi.mocked(execFile);
    mocked.mockImplementationOnce((_program, _args, _opts, callback) => {
      (callback as (error: null, stdout: string, stderr: string) => void)(null, '{"accessToken":"tok"}', '');
      return undefined as never;
    });
    const ok = await runAzureCli(['account', 'get-access-token']);
    expect(ok.notFound).toBe(false);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain('tok');

    mocked.mockImplementationOnce((_program, _args, _opts, callback) => {
      const error = Object.assign(new Error('az failed'), { code: 2 });
      (callback as (error: NodeJS.ErrnoException, stdout: string | undefined, stderr: string | undefined) => void)(
        error,
        undefined,
        undefined,
      );
      return undefined as never;
    });
    const failed = await runAzureCli(['account', 'show']);
    expect(failed.exitCode).toBe(2);
    expect(failed.notFound).toBe(false);
    expect(failed.stderr).toContain('az failed');
  });

  it('still builds a path when HOME and PATH are unset', async () => {
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    delete process.env.HOME;
    delete process.env.PATH;
    try {
      const result = await runAzureCli(['account', 'show']);
      expect(result.notFound).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});
