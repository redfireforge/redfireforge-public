export interface TextMatch {
  start: number;
  end: number;
}

/** Case-insensitive matches of a trimmed query. Overlapping hits are not returned. */
export function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return matches;
}

/** Scroll a textarea so the line containing `start` sits near the top of the box. */
export function scrollTextareaToMatch(area: HTMLTextAreaElement, start: number) {
  const line = area.value.slice(0, start).split('\n').length;
  const parsed = Number.parseFloat(getComputedStyle(area).lineHeight);
  const lineHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  const target = (line - 1) * lineHeight - area.clientHeight / 3;
  area.scrollTop = Math.max(0, target);
}
