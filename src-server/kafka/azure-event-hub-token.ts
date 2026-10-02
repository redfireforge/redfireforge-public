import { execFile } from 'node:child_process';
import { eventHubResourceFromBrokers } from '../../src/shared/kafka/azureEventHubResource.js';

const AZ_TIMEOUT_MS = 30_000;

export interface AzureCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  notFound: boolean;
}

function azProgram(): string {
  return process.platform === 'win32' ? 'az.cmd' : 'az';
}

function azEnv(): NodeJS.ProcessEnv {
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  const home = process.env.HOME;
  if (home) {
    extra.unshift(`${home}/.local/bin`, `${home}/bin`);
  }
  const current = process.env.PATH ?? '';
  const separator = process.platform === 'win32' ? ';' : ':';
  return {
    ...process.env,
    PATH: [...extra, current].filter(Boolean).join(separator),
  };
}

function sanitizeCliError(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.includes('eyJ'));
  if (!line) {
    return '';
  }
  return line.slice(0, 180);
}

/** Runs `az account get-access-token`. Exposed so tests can replace it. */
export function runAzureCli(args: string[]): Promise<AzureCliResult> {
  return new Promise((resolve) => {
    execFile(
      azProgram(),
      args,
      { timeout: AZ_TIMEOUT_MS, env: azEnv(), windowsHide: true },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? error?.message ?? ''),
          exitCode: typeof code === 'number' ? code : (error ? 1 : 0),
          notFound: code === 'ENOENT',
        });
      },
    );
  });
}

export function accessTokenFromAzJson(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Azure CLI authentication failed. The token response could not be read. Run az login, then connect again.');
  }
  const token = parsed && typeof parsed === 'object'
    ? (parsed as { accessToken?: unknown }).accessToken
    : undefined;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Azure CLI authentication failed. No access token was returned. Run az login, then connect again.');
  }
  const value = token.trim();
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value;
}

export async function acquireAzureEventHubToken(
  brokers: readonly string[],
  run: (args: string[]) => Promise<AzureCliResult> = runAzureCli,
): Promise<string> {
  const resource = eventHubResourceFromBrokers(brokers);
  if (!resource) {
    throw new Error('Azure OAUTHBEARER needs a broker on *.servicebus.windows.net.');
  }

  const result = await run([
    'account',
    'get-access-token',
    '--resource',
    resource,
    '--output',
    'json',
  ]);

  if (result.notFound) {
    throw new Error('Azure CLI authentication failed. Install the Azure CLI and run az login, then connect again.');
  }
  if (result.exitCode !== 0) {
    const detail = sanitizeCliError(result.stderr);
    const suffix = detail ? ` ${detail}` : '';
    throw new Error(`Azure CLI authentication failed. Run az login, then connect again.${suffix}`);
  }
  return accessTokenFromAzJson(result.stdout);
}
