/**
 * Phase 3 / OQ-3 — cache bundled WKT descriptors and parsed proto ingest graphs.
 */
import { createHash } from 'node:crypto';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor/index.js';
import {
  assertProtoFileImportsResolvable,
  buildProtoFileMap,
  buildProtoResolvePath,
  classifyProtoParseFailure,
  normalizeProtoPath,
  type ProtoFileInput,
} from './protoImportResolver.js';
import { PROTO_WKT_BUNDLE } from './protoWktBundle.js';

let cachedWktDescriptorBytes: Uint8Array | null = null;
const ingestRootCache = new Map<string, protobuf.Root>();

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeProtoIngestFingerprint(
  protoFiles: ProtoFileInput[],
  importPaths: string[] = [],
): string {
  const filePart = protoFiles
    .map((file) => `${normalizeProtoPath(file.path)}:${hashContent(file.content)}`)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
  const importPart = importPaths
    .map((entry) => normalizeProtoPath(entry))
    .sort((a, b) => a.localeCompare(b))
    .join(',');
  return createHash('sha256').update(`${filePart}::${importPart}`).digest('hex');
}

function buildBundledWktDescriptorBytes(): Uint8Array {
  const fileMap = buildProtoFileMap({ protoFiles: [], includeWktBundle: true });
  const root = new protobuf.Root();
  root.resolvePath = buildProtoResolvePath(fileMap, []);

  const bundlePaths = Object.keys(PROTO_WKT_BUNDLE).sort((a, b) => a.localeCompare(b));
  for (const path of bundlePaths) {
    const content = fileMap.get(path);
    if (!content) continue;
    protobuf.parse(content, root, { filename: path, keepCase: true, alternateCommentMode: true });
  }
  root.resolveAll();
  const fileDescriptorSet = root.toDescriptor('proto3');
  return descriptor.FileDescriptorSet.encode(fileDescriptorSet).finish();
}

function getBundledWktDescriptorBytes(): Uint8Array {
  if (!cachedWktDescriptorBytes) {
    cachedWktDescriptorBytes = buildBundledWktDescriptorBytes();
  }
  return cachedWktDescriptorBytes;
}

export function createRootWithBundledWkt(
  fileMap: ReadonlyMap<string, string>,
  importPaths: string[] = [],
): protobuf.Root {
  const fileDescriptorSet = descriptor.FileDescriptorSet.decode(getBundledWktDescriptorBytes());
  const root = protobuf.Root.fromDescriptor(fileDescriptorSet);
  root.resolveAll();
  root.resolvePath = buildProtoResolvePath(fileMap, importPaths);
  return root;
}

export function getCachedProtoIngestRoot(fingerprint: string): protobuf.Root | undefined {
  return ingestRootCache.get(fingerprint);
}

export function cacheProtoIngestRoot(fingerprint: string, root: protobuf.Root): void {
  ingestRootCache.set(fingerprint, root);
}

export function parseUserProtoFilesIntoRoot(
  root: protobuf.Root,
  protoFiles: ProtoFileInput[],
  fileMap: ReadonlyMap<string, string>,
  importPaths: string[] = [],
): void {
  const userPaths = protoFiles
    .map((file) => normalizeProtoPath(file.path))
    .sort((a, b) => a.localeCompare(b));

  for (const path of userPaths) {
    const content = fileMap.get(path);
    if (!content) {
      throw new Error(`Proto file not found in ingest map: ${path}`);
    }
    assertProtoFileImportsResolvable(path, content, fileMap, importPaths);
    try {
      protobuf.parse(content, root, { filename: path, keepCase: true, alternateCommentMode: true });
    } catch (error) {
      const importError = classifyProtoParseFailure(error, path, importPaths);
      if (importError) {
        throw importError;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse ${path}: ${message}`, { cause: error });
    }
  }

  root.resolveAll();
}

export function clearProtoFileDescriptorPool(): void {
  cachedWktDescriptorBytes = null;
  ingestRootCache.clear();
}
