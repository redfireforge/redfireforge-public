import { v4 as uuidv4 } from 'uuid';
import type { RequestCollection, RequestFolder } from '@shared/types';
import { findFolderDeep, collectGroupIds } from './requestTree';
import { saveJsonFile, openJsonFile } from '@shared/utils/fileSaver';
import { tryParseJson } from '@shared/utils/helpers';

export interface ToastLike {
  show: (level: 'success' | 'error' | 'warning' | 'info', title: string, subtitle?: string) => void;
}

function regenIds(folder: RequestFolder): RequestFolder {
  return {
    ...folder,
    id: uuidv4(),
    requests: folder.requests.map((r) => ({ ...r, id: uuidv4() })),
    folders: (folder.folders ?? []).map(regenIds),
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildExportPayload(type: string, data: unknown) {
  return { type, version: '1.0', exportedAt: new Date().toISOString(), data };
}

type RequestsImportPayload = {
  type?: string;
  data?: Record<string, unknown>;
};

function parseImportPayload(content: string): RequestsImportPayload | null {
  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._exportMeta && obj.data && typeof obj.data === 'object' && !obj.type) {
    const inner = obj.data as RequestsImportPayload;
    if (typeof inner.type === 'string') return inner;
  }
  return parsed as RequestsImportPayload;
}

async function pickImportFile(): Promise<string | null> {
  const result = await openJsonFile();
  return result?.content ?? null;
}

async function pickAndParseImportPayload(): Promise<{ payload: RequestsImportPayload | null; cancelled: boolean }> {
  const content = await pickImportFile();
  if (!content) return { payload: null, cancelled: true };
  return { payload: parseImportPayload(content), cancelled: false };
}

interface CommonImportArgs {
  collections: RequestCollection[];
  toast: ToastLike;
}

interface ImportCollectionArgs extends CommonImportArgs {
  colId?: string;
  targetGroupId?: string;
  /** When set, skip the file picker and parse this text (sidebar <input type=file>). */
  fileContent?: string | null;
  onImportCollection: (col: RequestCollection) => void;
  onImportFolder: (colId: string, folder: RequestFolder, parentFolderId?: string) => void;
  onAddGroup: (name: string, parentGroupId?: string) => string;
}

function importGroupData(
  group: RequestCollection,
  children: RequestCollection[],
  parentGroupId: string | undefined,
  onImportCollection: (col: RequestCollection) => void,
) {
  const idMap = new Map<string, string>();
  idMap.set(group.id, uuidv4());
  for (const child of children) {
    idMap.set(child.id, uuidv4());
  }
  const importedGroup: RequestCollection = {
    ...group,
    id: idMap.get(group.id)!,
    groupId: parentGroupId,
    requests: [],
    folders: [],
  };
  onImportCollection(importedGroup);
  for (const child of children) {
    const newGroupId = child.groupId ? idMap.get(child.groupId) ?? child.groupId : undefined;
    const imported: RequestCollection = {
      ...child,
      id: idMap.get(child.id)!,
      groupId: newGroupId,
      requests: (child.requests ?? []).map((r) => ({ ...r, id: uuidv4() })),
      folders: (child.folders ?? []).map(regenIds),
    };
    onImportCollection(imported);
  }
}

export async function handleExportAll(collections: RequestCollection[]) {
  if (collections.length === 0) return;
  const payload = buildExportPayload('requests-all', { collections });
  await saveJsonFile(payload, 'requests-all-collections.json');
}

export async function handleExportCollection(collections: RequestCollection[], colId: string) {
  const col = collections.find((c) => c.id === colId);
  if (!col) return;
  await saveJsonFile(buildExportPayload('requests-collection', col), `collection-${slugify(col.name)}.json`);
}

export async function handleExportFolder(collections: RequestCollection[], colId: string, folderId: string) {
  const col = collections.find((c) => c.id === colId);
  const folder = col ? findFolderDeep(col.folders ?? [], folderId) : null;
  if (!folder) return;
  await saveJsonFile(buildExportPayload('requests-folder', folder), `folder-${slugify(folder.name)}.json`);
}

export async function handleExportGroup(collections: RequestCollection[], groupId: string) {
  const group = collections.find((c) => c.id === groupId);
  if (!group || group.mode !== 'group') return;
  const allIds = collectGroupIds(groupId, collections);
  const children = collections.filter((c) => allIds.includes(c.id) && c.id !== groupId);
  await saveJsonFile(buildExportPayload('requests-group', { group, children }), `group-${slugify(group.name)}.json`);
}

export async function handleImportToCollection({
  collections,
  toast,
  colId,
  targetGroupId,
  fileContent,
  onImportCollection,
  onImportFolder,
  onAddGroup,
}: ImportCollectionArgs) {
  const { payload: json, cancelled } = fileContent !== undefined
    ? { payload: fileContent ? parseImportPayload(fileContent) : null, cancelled: !fileContent }
    : await pickAndParseImportPayload();
  if (cancelled) return;
  if (!json) {
    toast.show('error', 'Invalid JSON file', 'Please select a valid export file.');
    return;
  }

  try {
    if (json.type === 'requests-collection' && json.data) {
      const incoming = json.data as unknown as RequestCollection;
      if (!incoming.name || !incoming.requests) {
        toast.show('error', 'Invalid collection format', 'Missing required fields.');
        return;
      }
      const nameExists = collections.some((c) => c.name.toLowerCase() === incoming.name.toLowerCase());
      const imported: RequestCollection = {
        ...incoming,
        id: uuidv4(),
        name: nameExists ? `${incoming.name} (imported)` : incoming.name,
        groupId: targetGroupId,
        requests: incoming.requests.map((r) => ({ ...r, id: uuidv4() })),
        folders: (incoming.folders ?? []).map(regenIds),
      };
      onImportCollection(imported);
      toast.show('success', 'Imported collection', imported.name);
      return;
    }

    if (json.type === 'requests-folder' && json.data && colId) {
      const incoming = json.data as unknown as RequestFolder;
      if (!incoming.name || !incoming.requests) {
        toast.show('error', 'Invalid folder format', 'Missing required fields.');
        return;
      }
      const col = collections.find((c) => c.id === colId);
      const siblings = col?.folders ?? [];
      const nameExists = siblings.some((f) => f.name.toLowerCase() === incoming.name.toLowerCase());
      const imported = regenIds({
        ...incoming,
        name: nameExists ? `${incoming.name} (imported)` : incoming.name,
      });
      onImportFolder(colId, imported);
      toast.show('success', 'Imported folder', imported.name);
      return;
    }

    if (json.type === 'requests-group' && json.data?.group) {
      importGroupData(
        json.data.group as unknown as RequestCollection,
        (json.data.children ?? []) as unknown as RequestCollection[],
        targetGroupId,
        onImportCollection,
      );
      toast.show('success', 'Imported group');
      return;
    }

    if (json.type === 'requests-all' && json.data?.collections) {
      const incoming = json.data.collections as unknown as RequestCollection[];
      const idMap = new Map<string, string>();
      for (const inc of incoming) {
        idMap.set(inc.id, uuidv4());
      }
      let importedCount = 0;
      for (const inc of incoming) {
        if (!inc.name || (!inc.requests && inc.mode !== 'group')) continue;
        const nameExists = collections.some((c) => c.name.toLowerCase() === inc.name.toLowerCase());
        const resolvedGroupId = inc.groupId ? idMap.get(inc.groupId) ?? targetGroupId : targetGroupId;
        const imported: RequestCollection = {
          ...inc,
          id: idMap.get(inc.id)!,
          name: nameExists ? `${inc.name} (imported)` : inc.name,
          groupId: resolvedGroupId,
          requests: (inc.requests ?? []).map((r) => ({ ...r, id: uuidv4() })),
          folders: (inc.folders ?? []).map(regenIds),
        };
        onImportCollection(imported);
        importedCount++;
      }
      if (importedCount === 0) toast.show('warning', 'No valid collections found in the file');
      else toast.show('success', `Imported ${importedCount} collection${importedCount === 1 ? '' : 's'}`);
      return;
    }

    // Keep reference to onAddGroup to preserve the same dependency contract as caller-side props.
    if (typeof onAddGroup === 'function') {
      // no-op
    }
    toast.show('error', 'Unrecognized file format', 'Expected a Requests collection, folder, group, or all-collections export.');
  } catch {
    toast.show('error', 'Invalid JSON file', 'Please select a valid export file.');
  }
}

interface ImportFolderArgs extends CommonImportArgs {
  colId: string;
  parentFolderId: string;
  onImportFolder: (colId: string, folder: RequestFolder, parentFolderId?: string) => void;
}

export async function handleImportToFolder({
  collections,
  toast,
  colId,
  parentFolderId,
  onImportFolder,
}: ImportFolderArgs) {
  const { payload: json, cancelled } = await pickAndParseImportPayload();
  if (cancelled) return;
  if (!json) {
    toast.show('error', 'Invalid JSON file', 'Please select a valid export file.');
    return;
  }

  try {
    if (json.type === 'requests-folder' && json.data) {
      const incoming = json.data as unknown as RequestFolder;
      if (!incoming.name || !incoming.requests) {
        toast.show('error', 'Invalid folder format', 'Missing required fields.');
        return;
      }
      const parent = findFolderDeep(collections.find((c) => c.id === colId)?.folders ?? [], parentFolderId);
      const siblings = parent?.folders ?? [];
      const nameExists = siblings.some((f) => f.name.toLowerCase() === incoming.name.toLowerCase());
      const imported = regenIds({
        ...incoming,
        name: nameExists ? `${incoming.name} (imported)` : incoming.name,
      });
      onImportFolder(colId, imported, parentFolderId);
      return;
    }
    toast.show('error', 'Unexpected file type', 'Expected a folder/sub-collection export file.');
  } catch {
    toast.show('error', 'Invalid JSON file', 'Please select a valid export file.');
  }
}
