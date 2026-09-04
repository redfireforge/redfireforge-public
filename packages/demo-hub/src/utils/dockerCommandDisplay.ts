/** GitHub releases list — `/releases/latest` is Standard Edition, not Learning Hub. */
export const LEARNING_HUB_DOWNLOAD_URL =
  'https://github.com/redfireforge/redfireforge-public/releases';

export const DOCKER_DESKTOP_INSTALL_URL = 'https://www.docker.com/products/docker-desktop';

export const CLONE_MARKER = 'git clone https://github.com/redfireforge/redfireforge-public.git';

const REPO_CLONE_PREAMBLE = [
  '# First time? Clone the repo:',
  `#   ${CLONE_MARKER}`,
  '#   cd redfireforge-public',
  '',
].join('\n');

/**
 * Web / unresolved desktop: compose only works after cloning the public repo.
 * Desktop with an extracted stack path skips this helper (see `dockerStack.ts`).
 * Lesson `dockerCommand` values stay compose-only.
 */
export function withRepoClonePreamble(dockerCommand: string): string {
  if (dockerCommand.includes(CLONE_MARKER)) {
    return dockerCommand;
  }
  return `${REPO_CLONE_PREAMBLE}${dockerCommand}`;
}

const CERT_GEN_STEP =
  /^(?:(?:bash|sh)\s+)?(?:\.\/|\.\\)?(?:generate-(?:client-)?certs?\.sh|certs[\\/]generate\.sh)$/;

function stripCertGenSteps(segment: string): string {
  return segment
    .split(/\s*&&\s*/)
    .map((step) => step.trim())
    .filter((step) => step.length > 0 && !CERT_GEN_STEP.test(step))
    .join(' && ');
}

/**
 * Certs are pre-bundled. Drop generate-*.sh from the command the user sees / copies.
 * Lesson `dockerCommand` strings stay as-is (inferDockerStackKey still reads them).
 */
export function stripCertGenerationFromCommand(dockerCommand: string): string {
  const out: string[] = [];
  for (const line of dockerCommand.split('\n')) {
    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    const kept = stripCertGenSteps(line);
    if (kept === '') continue;
    out.push(kept.replace(/[ \t]{2,}/g, ' '));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Desktop / browser host is Windows (not WSL). Used for command quoting + State B copy. */
export function isWindowsHost(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  platform = typeof navigator !== 'undefined'
    ? ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform
      ?? '')
    : '',
): boolean {
  if (/Windows/i.test(userAgent)) return true;
  // `^Win` — do not use /Win/i (that matches Darwin).
  return /^Win/i.test(platform);
}

/**
 * PowerShell 5 cannot paste `&&`. Split into one command per line.
 * Unix / Git Bash keep `&&`. Idempotent when there are no `&&` left.
 */
export function formatDockerCommandForHost(cmd: string, windows = isWindowsHost()): string {
  if (!windows) return cmd;
  return cmd.replace(/[ \t]*&&[ \t]*/g, '\n');
}
