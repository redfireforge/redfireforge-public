/**
 * Replace the host (protocol + hostname + optional base path) of a test URL
 * with the given base URL, preserving {{template}} variables.
 *
 * Relative paths are joined onto the base. Absolute http(s) URLs keep their
 * path/query/hash and move to the new origin so Test Runner **Settings** /
 * **Custom** (and Mock Server) apply to harness tests promoted with a full URL.
 * Use host mode **Original** to keep a pinned absolute URL unchanged.
 */

function protectTemplates(url: string): { safe: string; placeholders: string[] } {
  const placeholders: string[] = [];
  const safe = url.replace(/\{\{(\w+)\}\}/g, (match) => {
    placeholders.push(match);
    return `__TPL_${placeholders.length - 1}__`;
  });
  return { safe, placeholders };
}

function restoreTemplates(url: string, placeholders: string[]): string {
  let out = url;
  placeholders.forEach((tpl, i) => {
    out = out.replace(`__TPL_${i}__`, tpl);
  });
  return out;
}

export function replaceHost(testUrl: string, baseUrl: string): string {
  if (!baseUrl) return testUrl;

  const { safe: safeTest, placeholders } = protectTemplates(testUrl);

  try {
    if (safeTest.startsWith('http://') || safeTest.startsWith('https://')) {
      const base = new URL(baseUrl);
      const current = new URL(safeTest);
      current.protocol = base.protocol;
      current.host = base.host;
      const basePath = base.pathname.replace(/\/$/, '');
      if (basePath && basePath !== '/' && !current.pathname.startsWith(basePath)) {
        current.pathname = `${basePath}${current.pathname.startsWith('/') ? '' : '/'}${current.pathname}`;
      }
      return restoreTemplates(current.toString(), placeholders);
    }

    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const path = safeTest.startsWith('/') ? safeTest.slice(1) : safeTest;
    return restoreTemplates(new URL(path, base).toString(), placeholders);
  } catch {
    return testUrl;
  }
}
