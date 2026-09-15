/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('uuid', () => ({ v4: vi.fn(() => 'uuid-fixed') }));
vi.mock('../../../shared/utils/fileSaver', () => ({
  saveJsonFile: vi.fn().mockResolvedValue(undefined),
  openJsonFile: vi.fn(),
}));
vi.mock('../../../shared/utils/helpers', () => ({
  tryParseJson: vi.fn((content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }),
}));
vi.mock('./requestTree', () => ({
  findFolderDeep: vi.fn(),
  collectGroupIds: vi.fn(),
}));

import { saveJsonFile, openJsonFile } from '@shared/utils/fileSaver';
import { findFolderDeep, collectGroupIds } from './requestTree';
import {
  handleExportAll,
  handleExportCollection,
  handleExportFolder,
  handleExportGroup,
  handleImportToCollection,
  handleImportToFolder,
} from './requestsSidebarImportExport';

const toast = { show: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestsSidebarImportExport', () => {
  it('exports all collections when non-empty', async () => {
    await handleExportAll([{ id: 'c1', name: 'Orders' } as never]);
    expect(saveJsonFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'requests-all' }), 'requests-all-collections.json');
  });

  it('does not export all when collection list is empty', async () => {
    await handleExportAll([]);
    expect(saveJsonFile).not.toHaveBeenCalled();
  });

  it('exports one collection by id', async () => {
    await handleExportCollection([{ id: 'c1', name: 'Orders' } as never], 'c1');
    expect(saveJsonFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'requests-collection' }), 'collection-orders.json');
  });

  it('does not export collection when id is missing', async () => {
    await handleExportCollection([{ id: 'c1', name: 'Orders' } as never], 'missing');
    expect(saveJsonFile).not.toHaveBeenCalled();
  });

  it('exports folder when findFolderDeep resolves one', async () => {
    vi.mocked(findFolderDeep).mockReturnValue({ id: 'f1', name: 'Core', requests: [] } as never);
    await handleExportFolder([{ id: 'c1', folders: [] } as never], 'c1', 'f1');
    expect(saveJsonFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'requests-folder' }), 'folder-core.json');
  });

  it('does not export folder when folder cannot be resolved', async () => {
    vi.mocked(findFolderDeep).mockReturnValue(null);
    await handleExportFolder([{ id: 'c1', folders: [] } as never], 'c1', 'missing');
    expect(saveJsonFile).not.toHaveBeenCalled();
  });

  it('exports group and children when group id is valid', async () => {
    vi.mocked(collectGroupIds).mockReturnValue(['g1', 'c2']);
    const collections = [
      { id: 'g1', mode: 'group', name: 'Platform' },
      { id: 'c2', mode: 'url', name: 'Orders' },
    ] as never;
    await handleExportGroup(collections, 'g1');
    expect(saveJsonFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'requests-group' }), 'group-platform.json');
  });

  it('does not export group when collection is not group mode', async () => {
    await handleExportGroup([{ id: 'g1', mode: 'url', name: 'Platform' } as never], 'g1');
    expect(saveJsonFile).not.toHaveBeenCalled();
  });

  it('imports a requests-collection payload and rewrites ids', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-collection', data: { id: 'c-old', name: 'Orders', requests: [{ id: 'r1' }], folders: [] } }) } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [{ id: 'existing', name: 'Orders' } as never],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
      targetGroupId: 'g-target',
    });

    expect(onImportCollection).toHaveBeenCalledWith(expect.objectContaining({
      id: 'uuid-fixed',
      name: 'Orders (imported)',
      groupId: 'g-target',
    }));
    expect(toast.show).toHaveBeenCalledWith('success', 'Imported collection', 'Orders (imported)');
  });

  it('imports from fileContent without opening a picker', async () => {
    const onImportCollection = vi.fn();
    await handleImportToCollection({
      collections: [],
      toast,
      fileContent: JSON.stringify({
        type: 'requests-all',
        data: { collections: [{ id: 'c1', name: 'FromText', mode: 'direct', requests: [], folders: [] }] },
      }),
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });
    expect(openJsonFile).not.toHaveBeenCalled();
    expect(onImportCollection).toHaveBeenCalledWith(expect.objectContaining({ name: 'FromText' }));
  });

  it('unwraps _exportMeta wrappers used by other exporters', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        _exportMeta: { version: 1 },
        data: { type: 'requests-collection', data: { id: 'c-old', name: 'Wrapped', requests: [], folders: [] } },
      }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportCollection).toHaveBeenCalledWith(expect.objectContaining({ name: 'Wrapped' }));
  });

  it('shows invalid-json toast for malformed payload', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: 'not-json' } as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid JSON file', 'Please select a valid export file.');
  });

  it('returns early when import is cancelled', async () => {
    vi.mocked(openJsonFile).mockResolvedValue(null as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).not.toHaveBeenCalled();
  });

  it('imports a folder payload into a selected collection', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-folder', data: { id: 'f-old', name: 'FolderA', requests: [], folders: [] } }) } as never);
    const onImportFolder = vi.fn();

    await handleImportToCollection({
      collections: [{ id: 'c1', folders: [] } as never],
      colId: 'c1',
      toast,
      onImportCollection: vi.fn(),
      onImportFolder,
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportFolder).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'uuid-fixed', name: 'FolderA' }));
  });

  it('imports group payload and remaps ids for group and children', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        type: 'requests-group',
        data: {
          group: { id: 'g-old', mode: 'group', name: 'Platform' },
          children: [{ id: 'c-old', mode: 'url', name: 'Orders', groupId: 'g-old', requests: [{ id: 'r-old', name: 'List', method: 'GET' }], folders: [] }],
        },
      }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
      targetGroupId: 'parent-group',
    });

    expect(onImportCollection).toHaveBeenCalledTimes(2);
    expect(onImportCollection.mock.calls[0][0]).toEqual(expect.objectContaining({ mode: 'group', groupId: 'parent-group' }));
  });

  it('imports requests-all payload and warns when all entries are invalid', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-all', data: { collections: [{ id: 'x' }] } }),
    } as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith('warning', 'No valid collections found in the file');
  });

  it('handles unrecognized import type', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'mystery', data: {} }) } as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith(
      'error',
      'Unrecognized file format',
      'Expected a Requests collection, folder, group, or all-collections export.',
    );
  });

  it('reports invalid collection payload missing required fields', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-collection', data: { name: 'OnlyName' } }) } as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid collection format', 'Missing required fields.');
  });

  it('reports invalid folder payload missing required fields', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-folder', data: { name: 'OnlyName' } }) } as never);

    await handleImportToCollection({
      collections: [{ id: 'c1', folders: [] } as never],
      colId: 'c1',
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid folder format', 'Missing required fields.');
  });

  it('hits catch path when import callback throws', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-collection', data: { id: 'c-old', name: 'Orders', requests: [], folders: [] } }) } as never);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(() => {
        throw new Error('boom');
      }),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid JSON file', 'Please select a valid export file.');
  });

  it('imports folder payload in handleImportToFolder with name collision', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-folder', data: { id: 'f-old', name: 'FolderA', requests: [], folders: [] } }),
    } as never);
    vi.mocked(findFolderDeep).mockReturnValue({ id: 'parent', folders: [{ id: 's1', name: 'FolderA' }] } as never);
    const onImportFolder = vi.fn();

    await handleImportToFolder({
      collections: [{ id: 'c1', folders: [] } as never],
      toast,
      colId: 'c1',
      parentFolderId: 'parent',
      onImportFolder,
    });

    expect(onImportFolder).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'FolderA (imported)' }), 'parent');
  });

  it('reports invalid folder format in handleImportToFolder', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-folder', data: { name: 'no-requests' } }) } as never);

    await handleImportToFolder({
      collections: [],
      toast,
      colId: 'c1',
      parentFolderId: 'f1',
      onImportFolder: vi.fn(),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid folder format', 'Missing required fields.');
  });

  it('treats a cancelled file picker as a no-op', async () => {
    vi.mocked(openJsonFile).mockResolvedValueOnce(null);

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection: vi.fn(),
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(toast.show).not.toHaveBeenCalled();
  });

  it('imports a collection from the web file picker', async () => {
    vi.mocked(openJsonFile).mockResolvedValueOnce({
      name: 'in.json',
      content: JSON.stringify({
        type: 'requests-collection',
        data: { id: 'c', name: 'Orders', requests: [], folders: [] },
      }),
    });

    const onImportCollection = vi.fn();
    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportCollection).toHaveBeenCalled();
  });

  it('imports requests-all valid records with group mapping and nested folders', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        type: 'requests-all',
        data: {
          collections: [
            { id: 'g1', mode: 'group', name: 'Platform' },
            {
              id: 'c1',
              mode: 'url',
              name: 'Orders',
              groupId: 'g1',
              requests: [{ id: 'r1', name: 'Get', method: 'GET' }],
              folders: [{ id: 'f1', name: 'Core', requests: [{ id: 'r2', name: 'List', method: 'GET' }], folders: [] }],
            },
          ],
        },
      }),
    } as never);

    const onImportCollection = vi.fn();
    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
      targetGroupId: 'root',
    });

    expect(onImportCollection).toHaveBeenCalledTimes(2);
  });

  it('imports collection payload with nested folders to cover regenIds recursion', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        type: 'requests-collection',
        data: {
          id: 'c-old',
          name: 'Orders',
          requests: [{ id: 'r1' }],
          folders: [{ id: 'f1', name: 'Nested', requests: [{ id: 'rf1' }], folders: [{ id: 'f2', name: 'Leaf', requests: [{ id: 'rf2' }], folders: [] }] }],
        },
      }),
    } as never);

    const onImportCollection = vi.fn();
    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportCollection).toHaveBeenCalled();
  });

  it('imports folder payload into collection with sibling name collision', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-folder', data: { id: 'f-old', name: 'FolderA', requests: [{ id: 'r1' }], folders: [] } }),
    } as never);

    const onImportFolder = vi.fn();
    await handleImportToCollection({
      collections: [{ id: 'c1', folders: [{ id: 'f0', name: 'FolderA' }] } as never],
      colId: 'c1',
      toast,
      onImportCollection: vi.fn(),
      onImportFolder,
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportFolder).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'FolderA (imported)' }));
  });

  it('returns early when handleImportToFolder is cancelled', async () => {
    vi.mocked(openJsonFile).mockResolvedValue(null as never);
    await handleImportToFolder({
      collections: [],
      toast,
      colId: 'c1',
      parentFolderId: 'f1',
      onImportFolder: vi.fn(),
    });
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('shows invalid-json toast when handleImportToFolder payload is malformed', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: 'not-json' } as never);
    await handleImportToFolder({
      collections: [],
      toast,
      colId: 'c1',
      parentFolderId: 'f1',
      onImportFolder: vi.fn(),
    });
    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid JSON file', 'Please select a valid export file.');
  });

  it('hits catch path when handleImportToFolder callback throws', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-folder', data: { id: 'f-old', name: 'FolderA', requests: [], folders: [] } }),
    } as never);
    vi.mocked(findFolderDeep).mockReturnValue({ id: 'parent', folders: [] } as never);

    await handleImportToFolder({
      collections: [{ id: 'c1', folders: [] } as never],
      toast,
      colId: 'c1',
      parentFolderId: 'parent',
      onImportFolder: vi.fn(() => {
        throw new Error('boom');
      }),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Invalid JSON file', 'Please select a valid export file.');
  });

  it('imports group payload when children are omitted', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-group', data: { group: { id: 'g-old', mode: 'group', name: 'Platform' } } }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
      targetGroupId: 'parent-group',
    });

    expect(onImportCollection).toHaveBeenCalledTimes(1);
  });

  it('imports group child with missing groupId and missing folders', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        type: 'requests-group',
        data: {
          group: { id: 'g-old', mode: 'group', name: 'Platform' },
          children: [{ id: 'c-old', mode: 'url', name: 'Orders', requests: [{ id: 'r-old', name: 'List', method: 'GET' }] }],
        },
      }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportCollection).toHaveBeenCalledTimes(2);
  });

  it('imports requests-all with existing-name match and no groupId', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({
        type: 'requests-all',
        data: {
          collections: [
            {
              id: 'c1',
              mode: 'url',
              name: 'Orders',
              requests: [{ id: 'r1', name: 'Get', method: 'GET' }],
            },
          ],
        },
      }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [{ id: 'existing', name: 'Orders' } as never],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
      targetGroupId: 'root',
    });

    expect(onImportCollection).toHaveBeenCalledWith(expect.objectContaining({ name: 'Orders (imported)', groupId: 'root' }));
  });

  it('imports collection payload when folders is undefined', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-collection', data: { id: 'c-old', name: 'Orders', requests: [{ id: 'r1' }] } }),
    } as never);
    const onImportCollection = vi.fn();

    await handleImportToCollection({
      collections: [],
      toast,
      onImportCollection,
      onImportFolder: vi.fn(),
      onAddGroup: vi.fn(() => 'g1'),
    });

    expect(onImportCollection).toHaveBeenCalledWith(expect.objectContaining({ name: 'Orders' }));
  });

  it('does not export folder when collection is missing', async () => {
    await handleExportFolder([{ id: 'c1', folders: [] } as never], 'missing-col', 'missing');
    expect(saveJsonFile).not.toHaveBeenCalled();
  });

  it('imports folder payload in handleImportToFolder when parent is missing', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({
      content: JSON.stringify({ type: 'requests-folder', data: { id: 'f-old', name: 'FolderB', requests: [], folders: undefined } }),
    } as never);
    vi.mocked(findFolderDeep).mockReturnValue(null);
    const onImportFolder = vi.fn();

    await handleImportToFolder({
      collections: [{ id: 'c1', folders: [] } as never],
      toast,
      colId: 'c1',
      parentFolderId: 'missing',
      onImportFolder,
    });

    expect(onImportFolder).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'FolderB' }), 'missing');
  });

  it('shows unexpected type toast on folder import helper', async () => {
    vi.mocked(openJsonFile).mockResolvedValue({ content: JSON.stringify({ type: 'requests-collection', data: {} }) } as never);

    await handleImportToFolder({
      collections: [],
      toast,
      colId: 'c1',
      parentFolderId: 'f1',
      onImportFolder: vi.fn(),
    });

    expect(toast.show).toHaveBeenCalledWith('error', 'Unexpected file type', 'Expected a folder/sub-collection export file.');
  });
});
