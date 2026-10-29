export interface KafkaHeaderClipboardRow {
  key: string;
  value: string;
}

/** JSON list copied from Message Detail so Publish can paste every header at once. */
export function formatKafkaHeadersForClipboard(
  headers: Record<string, string> | Array<[string, string]>,
): string {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return JSON.stringify(
    entries.map(([key, value]) => ({ key, value })),
    null,
    2,
  );
}

function rowFromUnknown(item: unknown): KafkaHeaderClipboardRow | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const rawKey = typeof record.key === 'string'
    ? record.key
    : typeof record.name === 'string'
      ? record.name
      : '';
  const key = rawKey.trim();
  if (!key) return null;
  const rawValue = record.value;
  const value = rawValue == null ? '' : String(rawValue);
  return { key, value };
}

function rowsFromLines(text: string): KafkaHeaderClipboardRow[] {
  const rows: KafkaHeaderClipboardRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tabParts = trimmed.split('\t');
    if (tabParts.length >= 2) {
      const key = tabParts[0].trim();
      if (!key || key.toLowerCase() === 'key') continue;
      rows.push({ key, value: tabParts.slice(1).join('\t').trim() });
      continue;
    }
    const separator = trimmed.includes('=') ? trimmed.indexOf('=') : trimmed.indexOf(':');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || key.toLowerCase() === 'key') continue;
    rows.push({ key, value: trimmed.slice(separator + 1).trim() });
  }
  return rows;
}

/** Accepts the Copy headers JSON, a `{ key: value }` object, or tab/equals lines. */
export function parseKafkaHeadersClipboard(text: string): KafkaHeaderClipboardRow[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const rows = parsed.map(rowFromUnknown).filter((row): row is KafkaHeaderClipboardRow => row !== null);
      return rows.length > 0 ? rows : null;
    }
    if (parsed && typeof parsed === 'object') {
      const rows = Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => rowFromUnknown({ key, value }))
        .filter((row): row is KafkaHeaderClipboardRow => row !== null);
      return rows.length > 0 ? rows : null;
    }
  } catch {
    // Not JSON. Fall through to line text copied from the header table.
  }
  const rows = rowsFromLines(trimmed);
  return rows.length > 0 ? rows : null;
}
