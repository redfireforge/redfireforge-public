/**
 * Timestamp formatting utilities for the Kafka Consume results table.
 *
 * Kafka stores message timestamps as epoch-millisecond strings (e.g. "1750000000000").
 * The results cell shows the local date and time. Hover adds milliseconds.
 */

/** Epoch-ms string → Date. Returns null for missing / zero / non-numeric values. */
export function parseKafkaTimestamp(ts: string | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts);
  if (!isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

/**
 * Formats a Date as a human-readable relative age string.
 * Keeps it short for use inside a compact table cell.
 *
 *   < 10s  → "just now"
 *   < 60s  → "42s ago"
 *   < 60m  → "7m ago"
 *   < 24h  → "3h ago"
 *   < 30d  → "12d ago"
 *   ≥ 30d  → absolute fallback (formatAbsolute)
 */
export function formatRelativeAge(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();

  // Future timestamps (clock skew) — show the absolute time
  if (diffMs < -1000) return formatAbsolute(date);

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  return formatAbsolute(date);
}

/**
 * Local date and time for the results table.
 * Example: "2026-06-17 09:25:06"
 */
export function formatKafkaDateTime(date: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Formats a Date as a compact absolute datetime string in the user's local timezone.
 * Example: "Jun 17, 09:25:06"
 */
export function formatAbsolute(date: Date): string {
  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${month} ${day}, ${hh}:${mm}:${ss}`;
}

/**
 * Full tooltip string: absolute datetime + epoch ms for precision.
 * Example: "Jun 17 2026, 09:25:06.938 (1750161906938)"
 */
export function formatTimestampTooltip(date: Date): string {
  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${month} ${day} ${year}, ${hh}:${mm}:${ss}.${ms}`;
}
