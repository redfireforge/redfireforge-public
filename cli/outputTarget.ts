/**
 * Resolves the `--output` value for the `run` command.
 *
 * `--output json` / `--output junit` stream a machine-readable report to stdout
 * (CI use). Any other value stays a file path, preserving the original
 * `-o <path>` behaviour.
 */

export type StdoutFormat = 'json' | 'junit';

export type OutputTarget =
  | { kind: 'stdout'; format: StdoutFormat }
  | { kind: 'file'; path: string };

const STDOUT_FORMATS: readonly StdoutFormat[] = ['json', 'junit'];

/**
 * A bare `json` / `junit` is treated as a format keyword. To write to a file
 * literally named `json`, qualify it with a path separator or extension
 * (`./json`, `json.txt`).
 */
export function resolveOutputTarget(value?: string | null): OutputTarget | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const keyword = trimmed.toLowerCase();
  if ((STDOUT_FORMATS as readonly string[]).includes(keyword)) {
    return { kind: 'stdout', format: keyword as StdoutFormat };
  }

  return { kind: 'file', path: trimmed };
}

/** Stdout formats own the stream, so every human-readable line must be muted. */
export function stdoutFormatOf(target: OutputTarget | null): StdoutFormat | null {
  return target?.kind === 'stdout' ? target.format : null;
}
