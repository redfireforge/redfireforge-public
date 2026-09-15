/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
  documentDir: vi.fn(() => Promise.resolve('/Users/docs')),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => tauriMocks.save(...args),
  open: (...args: unknown[]) => tauriMocks.open(...args),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: (...args: unknown[]) => tauriMocks.writeTextFile(...args),
  readTextFile: (...args: unknown[]) => tauriMocks.readTextFile(...args),
  mkdir: (...args: unknown[]) => tauriMocks.mkdir(...args),
  exists: (...args: unknown[]) => tauriMocks.exists(...args),
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: (...args: unknown[]) => tauriMocks.documentDir(...args),
}));

vi.mock('./platform', () => ({
  isTauri: vi.fn(() => false),
}));

import { isTauri } from './platform';
import {
  buildExportFilename,
  saveFile,
  saveJsonFile,
  saveCsvFile,
  savePngFile,
  saveSvgFile,
  openJsonFile,
} from './fileSaver';

describe('buildExportFilename', () => {
  it('builds filename with all segments', () => {
    const result = buildExportFilename({
      env: 'Dev', svc: 'My Service', level: 'results',
      name: 'Test Case', date: '2026-01-01T00-00-00',
    });
    expect(result).toBe('dev-my-service-results-test-case-2026-01-01T00-00-00.json');
  });

  it('omits undefined segments', () => {
    const result = buildExportFilename({ level: 'results', date: '2026-01-01' });
    expect(result).toBe('results-2026-01-01.json');
  });

  it('uses custom extension', () => {
    const result = buildExportFilename({ level: 'data', ext: 'csv', date: '2026-01-01' });
    expect(result).toBe('data-2026-01-01.csv');
  });

  it('defaults to json extension', () => {
    const result = buildExportFilename({ level: 'results', date: '2026-01-01' });
    expect(result.endsWith('.json')).toBe(true);
  });

  it('generates date when not provided', () => {
    const result = buildExportFilename({ level: 'results' });
    expect(result).toMatch(/^results-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
  });

  it('slugifies special characters', () => {
    const result = buildExportFilename({ env: 'My Env!', svc: 'Hello@World', level: 'results', date: 'x' });
    expect(result).toBe('my-env-hello-world-results-x.json');
  });

  it('strips leading and trailing hyphens from slugified segments', () => {
    const result = buildExportFilename({ level: '---Mixed___Case---', date: 'd' });
    expect(result).toBe('mixed-case-d.json');
  });

  it('slugifies multi-dot extension segment in name via level only edge', () => {
    const result = buildExportFilename({ level: 'export.v2', date: '2026' });
    expect(result).toBe('export-v2-2026.json');
  });
});

function mockDownloadAnchor(click: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    click,
    href: '',
    download: '',
    rel: '',
    style: { display: '' },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLAnchorElement;
}

describe('saveFile (browser fallback)', () => {
  beforeEach(() => {
    resetAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a data URL so Chrome does not name the file after a blob UUID', async () => {
    const click = vi.fn();
    const anchor = mockDownloadAnchor(click);
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    const blob = new Blob(['{"type":"requests-all"}'], { type: 'application/json' });
    await saveFile(blob, { filename: 'requests-all-collections.json', mimeType: 'application/json' });

    expect(click).toHaveBeenCalled();
    expect(anchor.href.startsWith('data:application/octet-stream;charset=utf-8,')).toBe(true);
    expect(anchor.href).not.toContain('blob:');
    expect(anchor.download).toBe('requests-all-collections.json');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('saveJsonFile', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue(mockDownloadAnchor());
  });

  it('creates a JSON blob and saves it', async () => {
    await saveJsonFile({ key: 'value' }, 'output.json');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('saveCsvFile', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue(mockDownloadAnchor());
  });

  it('creates a CSV blob and saves it', async () => {
    await saveCsvFile('a,b,c\n1,2,3', 'output.csv');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('saveFile ignores showSaveFilePicker on web', () => {
  beforeEach(() => {
    resetAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  it('downloads via an anchor even when showSaveFilePicker exists', async () => {
    const showSaveFilePicker = vi.fn();
    (window as unknown as Record<string, unknown>).showSaveFilePicker = showSaveFilePicker;
    const click = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue(mockDownloadAnchor(click));

    const blob = new Blob(['test'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'test.json', mimeType: 'application/json' });

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

describe('saveFile (Tauri)', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    tauriMocks.documentDir.mockResolvedValue('/Users/docs');
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.mkdir.mockResolvedValue(undefined);
    tauriMocks.save.mockResolvedValue('/chosen/path/out.json');
    tauriMocks.writeTextFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('writes blob text via writeTextFile when user picks a path', async () => {
    const blob = new Blob(['hello-tauri'], { type: 'application/json' });
    await saveFile(blob, { filename: 'export.json', mimeType: 'application/json', description: 'JSON export' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/RedfireForge\/export\.json$/),
        filters: [{ name: 'JSON export', extensions: ['json'] }],
      }),
    );
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/chosen/path/out.json', 'hello-tauri');
  });

  it('returns early when dialog is cancelled', async () => {
    tauriMocks.save.mockResolvedValueOnce(null as unknown as string);

    const blob = new Blob(['x'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'nope.txt', mimeType: 'text/plain' });

    expect(tauriMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it('uses filename-only defaultPath when export dir cannot be resolved', async () => {
    tauriMocks.documentDir.mockRejectedValueOnce(new Error('no doc dir'));

    const blob = new Blob(['z'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'solo.csv', mimeType: 'text/csv' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'solo.csv',
        filters: [{ name: 'File', extensions: ['csv'] }],
      }),
    );
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/chosen/path/out.json', 'z');
  });

  it('uses filename-only defaultPath when isTauri flips off inside getDefaultExportDir', async () => {
    let isTauriCalls = 0;
    vi.mocked(isTauri).mockImplementation(() => {
      isTauriCalls += 1;
      return isTauriCalls === 1;
    });

    const blob = new Blob(['q'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'edge.txt', mimeType: 'text/plain' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'edge.txt' }),
    );
    vi.mocked(isTauri).mockReturnValue(true);
  });

  it('defaults filter extension to json when filename has no dot', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    await saveFile(blob, { filename: 'data', mimeType: 'application/json' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'File', extensions: ['json'] }],
      }),
    );
  });

  it('creates export directory when missing', async () => {
    tauriMocks.exists.mockResolvedValueOnce(false);

    const blob = new Blob(['1'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'f.txt', mimeType: 'text/plain' });

    expect(tauriMocks.mkdir).toHaveBeenCalledWith(
      '/Users/docs/RedfireForge',
      { recursive: true },
    );
  });

  it('does not add extra separator when document dir ends with slash', async () => {
    tauriMocks.documentDir.mockResolvedValueOnce('/var/mobile/Documents/');

    const blob = new Blob([''], { type: 'text/plain' });
    await saveFile(blob, { filename: 'a.bin', mimeType: 'application/octet-stream' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/var/mobile/Documents/RedfireForge/a.bin',
      }),
    );
  });

  it('does not add extra separator when document dir ends with backslash', async () => {
    tauriMocks.documentDir.mockResolvedValueOnce('C:\\Users\\me\\Documents\\');

    const blob = new Blob([''], { type: 'text/plain' });
    await saveFile(blob, { filename: 'a.bin', mimeType: 'application/octet-stream' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'C:\\Users\\me\\Documents\\RedfireForge/a.bin',
      }),
    );
  });

  it('joins export dir without trailing slash using forward slash', async () => {
    tauriMocks.documentDir.mockResolvedValueOnce('/home/user/Documents');

    const blob = new Blob([''], { type: 'text/plain' });
    await saveFile(blob, { filename: 'x.dat', mimeType: 'application/octet-stream' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/home/user/Documents/RedfireForge/x.dat',
      }),
    );
  });

  it('uses forward slash between document dir and export folder name', async () => {
    tauriMocks.documentDir.mockResolvedValueOnce('/var/data');

    const blob = new Blob([''], { type: 'text/plain' });
    await saveFile(blob, { filename: 'nested.txt', mimeType: 'text/plain' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/var/data/RedfireForge/nested.txt',
      }),
    );
  });
});

describe('savePngFile and saveSvgFile (browser via anchor fallback)', () => {
  beforeEach(() => {
    resetAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:png-test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue(mockDownloadAnchor());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(new Blob(['\x89PNG'], { type: 'image/png' })),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches PNG data URLs before saving through the blob path', async () => {
    await savePngFile('data:image/png;base64,AA==', 'chart.png');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('data:image/png;base64,AA==');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('decodes svg+xml comma payloads before creating the blob', async () => {
    const payload = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await saveSvgFile('data:image/svg+xml;charset=utf-8,' + payload, 'chart.svg');

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('treats bare svg MIME prefixes as empty payloads', async () => {
    await saveSvgFile('data:image/svg+xml', 'empty.svg');

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('saveJsonFile and saveCsvFile (Tauri)', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.save.mockResolvedValue('/out/file');
    tauriMocks.writeTextFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('delegates to saveFile with JSON options', async () => {
    await saveJsonFile({ a: 1 }, 'pretty.json');
    expect(tauriMocks.save).toHaveBeenCalled();
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith(
      '/out/file',
      expect.stringContaining('"a": 1'),
    );
  });

  it('delegates to saveFile with CSV options', async () => {
    await saveCsvFile('h1,h2\n1,2', 'sheet.csv');
    expect(tauriMocks.save).toHaveBeenCalled();
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/out/file', 'h1,h2\n1,2');
  });
});

describe('openJsonFile (web)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the selected file from a hidden input', async () => {
    const file = new File(['{"ok":true}'], 'in.json', { type: 'application/json' });
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'files', { value: [file], configurable: true });
        Object.defineProperty(el, 'click', {
          value: () => (el as HTMLInputElement).onchange?.(new Event('change')),
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toEqual({ name: 'in.json', content: '{"ok":true}' });
  });

  it('returns null when the picker is cancelled after it opens', async () => {
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'click', {
          value: () => {
            queueMicrotask(() => el.dispatchEvent(new Event('cancel')));
          },
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toBeNull();
  });

  it('ignores cancel fired during programmatic click and still reads the file', async () => {
    const file = new File(['{"ok":true}'], 'in.json', { type: 'application/json' });
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'files', { value: [file], configurable: true });
        Object.defineProperty(el, 'click', {
          value: () => {
            el.dispatchEvent(new Event('cancel'));
            (el as HTMLInputElement).onchange?.(new Event('change'));
          },
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toEqual({ name: 'in.json', content: '{"ok":true}' });
  });

  it('accepts extension-less files from Chrome blob downloads', async () => {
    const file = new File(['{"type":"requests-all"}'], 'e451ae8a-6e45-4ca6-a6ed047657588ee', { type: '' });
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'files', { value: [file], configurable: true });
        Object.defineProperty(el, 'click', {
          value: () => (el as HTMLInputElement).onchange?.(new Event('change')),
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toEqual({
      name: 'e451ae8a-6e45-4ca6-a6ed047657588ee',
      content: '{"type":"requests-all"}',
    });
  });

  it('returns null when reading the selected file fails', async () => {
    const file = new File(['x'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('read fail')) });
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'files', { value: [file], configurable: true });
        Object.defineProperty(el, 'click', {
          value: () => (el as HTMLInputElement).onchange?.(new Event('change')),
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toBeNull();
  });

  it('returns null when no file is chosen', async () => {
    const realCreate = Document.prototype.createElement;
    vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tagName: string, options?: ElementCreationOptions) {
      const el = realCreate.call(this, tagName, options);
      if (tagName === 'input') {
        Object.defineProperty(el, 'files', { value: [], configurable: true });
        Object.defineProperty(el, 'click', {
          value: () => (el as HTMLInputElement).onchange?.(new Event('change')),
          configurable: true,
        });
      }
      return el;
    });

    const result = await openJsonFile();
    expect(result).toBeNull();
  });
});

describe('openJsonFile (Tauri)', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue('{"ok":true}');
    tauriMocks.open.mockResolvedValue('/data/project/config.json');
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('returns name and content when user selects a file', async () => {
    const result = await openJsonFile();
    expect(result).toEqual({ name: 'config.json', content: '{"ok":true}' });
    expect(tauriMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'JSON file', extensions: ['json'] }],
        multiple: false,
        directory: false,
      }),
    );
    expect(tauriMocks.readTextFile).toHaveBeenCalledWith('/data/project/config.json');
  });

  it('returns null when open dialog is cancelled', async () => {
    tauriMocks.open.mockResolvedValueOnce(null);

    const result = await openJsonFile();
    expect(result).toBeNull();
    expect(tauriMocks.readTextFile).not.toHaveBeenCalled();
  });

  it('derives basename when path mixes drive letter with forward slashes', async () => {
    tauriMocks.open.mockResolvedValueOnce('D:/share/backup/data.json');

    const result = await openJsonFile();
    expect(result).toEqual({ name: 'data.json', content: '{"ok":true}' });
  });

  it('passes export directory as defaultPath when available', async () => {
    tauriMocks.documentDir.mockResolvedValueOnce('/Users/me/Documents');

    await openJsonFile();

    expect(tauriMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/Users/me/Documents/RedfireForge',
      }),
    );
  });

  it('omits defaultPath when export directory cannot be resolved', async () => {
    tauriMocks.documentDir.mockRejectedValueOnce(new Error('fs'));

    await openJsonFile();

    expect(tauriMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: undefined,
      }),
    );
  });
});

describe('getDefaultExportDir failure paths (Tauri)', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    tauriMocks.documentDir.mockResolvedValue('/Users/docs');
    tauriMocks.save.mockResolvedValue('/out/chosen.txt');
    tauriMocks.writeTextFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('falls back to filename-only defaultPath when exists() throws', async () => {
    tauriMocks.exists.mockRejectedValueOnce(new Error('perm'));

    const blob = new Blob(['x'], { type: 'text/plain' });
    await saveFile(blob, { filename: 'fallback.txt', mimeType: 'text/plain' });

    expect(tauriMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'fallback.txt' }),
    );
  });
});
