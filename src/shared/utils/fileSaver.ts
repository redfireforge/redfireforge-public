import { isTauri } from './platform';

const EXPORT_DIR_NAME = 'RedfireForge';

async function getDefaultExportDir(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  try {
    const { documentDir } = await import('@tauri-apps/api/path');
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const docDir = await documentDir();
    const sep = docDir.endsWith('/') || docDir.endsWith('\\') ? '' : '/';
    const exportDir = `${docDir}${sep}${EXPORT_DIR_NAME}`;
    if (!(await exists(exportDir))) {
      await mkdir(exportDir, { recursive: true });
    }
    return exportDir;
  } catch {
    return undefined;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function buildExportFilename(parts: {
  env?: string;
  svc?: string;
  level: string;
  name?: string;
  date?: string;
  ext?: string;
}): string {
  const date = parts.date || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = parts.ext || 'json';
  const segments = [
    parts.env && slugify(parts.env),
    parts.svc && slugify(parts.svc),
    slugify(parts.level),
    parts.name && slugify(parts.name),
    date,
  ].filter(Boolean);
  return `${segments.join('-')}.${ext}`;
}

interface SaveOptions {
  filename: string;
  mimeType: string;
  description?: string;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

export async function saveFile(blob: Blob, opts: SaveOptions): Promise<void> {
  if (isTauri()) {
    return tauriSaveFile(blob, opts);
  }
  return browserSaveFile(blob, opts);
}

async function tauriSaveFile(blob: Blob, opts: SaveOptions): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const ext = getExtension(opts.filename).replace('.', '') || 'json';
  const exportDir = await getDefaultExportDir();
  const sep = exportDir?.endsWith('/') || exportDir?.endsWith('\\') ? '' : '/';
  const defaultPath = exportDir ? `${exportDir}${sep}${opts.filename}` : opts.filename;
  const path = await save({
    defaultPath,
    filters: [{ name: opts.description ?? 'File', extensions: [ext] }],
  });
  if (!path) return;
  const text = await blob.text();
  await writeTextFile(path, text);
}

const BROWSER_DOWNLOAD_REVOKE_MS = 2000;
const TEXT_DOWNLOAD_MAX_BYTES = 1_500_000;

function isTextDownload(mimeType: string, filename: string): boolean {
  if (/^(application\/(json|xml)|text\/|image\/svg)/i.test(mimeType)) return true;
  return /\.(json|csv|svg|txt|xml|ya?ml)$/i.test(filename);
}

function clickDownloadAnchor(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.setAttribute('download', filename);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function browserSaveFile(blob: Blob, opts: SaveOptions): Promise<void> {
  // Chrome's download history names blob: URLs after the blob UUID
  // (`blob:http://localhost:5173/<uuid>`). Text exports use a data: URL so the
  // `download` filename is what the user sees.
  if (isTextDownload(opts.mimeType, opts.filename) && blob.size <= TEXT_DOWNLOAD_MAX_BYTES) {
    const text = await blob.text();
    clickDownloadAnchor(
      `data:application/octet-stream;charset=utf-8,${encodeURIComponent(text)}`,
      opts.filename,
    );
    return;
  }
  const named = new File([blob], opts.filename, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(named);
  clickDownloadAnchor(url, opts.filename);
  window.setTimeout(() => URL.revokeObjectURL(url), BROWSER_DOWNLOAD_REVOKE_MS);
}

function browserOpenJsonFile(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // No accept filter — Chrome blob downloads often have no .json suffix.
    input.style.position = 'fixed';
    input.style.left = '0';
    input.style.top = '0';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    let settled = false;
    let ignoreCancel = true;
    const finish = (value: { name: string; content: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void file.text().then(
        (content) => finish({ name: file.name, content }),
        () => finish(null),
      );
    };
    // Chrome can fire `cancel` synchronously during programmatic click().
    input.addEventListener('cancel', () => {
      if (ignoreCancel) return;
      finish(null);
    });
    document.body.appendChild(input);
    input.click();
    ignoreCancel = false;
  });
}

export async function saveJsonFile(data: unknown, filename: string): Promise<void> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  await saveFile(blob, { filename, mimeType: 'application/json', description: 'JSON file' });
}

export async function saveCsvFile(content: string, filename: string): Promise<void> {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  await saveFile(blob, { filename, mimeType: 'text/csv', description: 'CSV file' });
}

export async function savePngFile(dataUrl: string, filename: string): Promise<void> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  await saveFile(blob, { filename, mimeType: 'image/png', description: 'PNG image' });
}

export async function saveSvgFile(dataUrl: string, filename: string): Promise<void> {
  const decoded = decodeURIComponent(dataUrl.split(',')[1] || '');
  const blob = new Blob([decoded], { type: 'image/svg+xml' });
  await saveFile(blob, { filename, mimeType: 'image/svg+xml', description: 'SVG image' });
}

export async function openJsonFile(): Promise<{ name: string; content: string } | null> {
  if (!isTauri()) return browserOpenJsonFile();
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const exportDir = await getDefaultExportDir();
  const path = await open({
    defaultPath: exportDir ?? undefined,
    filters: [{ name: 'JSON file', extensions: ['json'] }],
    multiple: false,
    directory: false,
  });
  if (!path) return null;
  const content = await readTextFile(path as string);
  const name = (path as string).split('/').pop() || (path as string).split('\\').pop() || 'import.json';
  return { name, content };
}
