import protobuf from 'protobufjs';
import type { GrpcDescribeRequest, GrpcProtoFileInput } from '../../src/shared/grpc/contracts.js';
import {
  buildProtoFileMap,
  type ProtoFileInput,
} from './protoImportResolver.js';
import descriptor from 'protobufjs/ext/descriptor/index.js';
import {
  cacheProtoIngestRoot,
  computeProtoIngestFingerprint,
  createRootWithBundledWkt,
  getCachedProtoIngestRoot,
  parseUserProtoFilesIntoRoot,
} from './protoFileDescriptorPool.js';
import { normalizeFileDescriptorSetForProst } from './prostDescriptorNormalizer.js';

export type { ProtoFileInput };

export { ProtoImportResolutionError } from './protoImportResolver.js';

export function normalizeDescribeProtoFilesInput(
  request: Pick<GrpcDescribeRequest, 'protoRoots' | 'importPaths'>,
): { protoFiles: GrpcProtoFileInput[]; importPaths: string[] } {
  const hasRoots = Boolean(request.protoRoots?.length);
  if (!hasRoots) {
    return {
      protoFiles: [],
      importPaths: request.importPaths ?? [],
    };
  }

  const protoFiles: GrpcProtoFileInput[] = [];
  for (const root of request.protoRoots ?? []) {
    const mountPath = root.mountPath.trim().replace(/\\/g, '/').replace(/\/+$/g, '').replace(/^\/+/, '');
    for (const file of root.files ?? []) {
      const rawPath = file.path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      const path = mountPath ? `${mountPath}/${rawPath}` : rawPath;
      protoFiles.push({
        path,
        content: file.content,
        sizeBytes: file.sizeBytes,
      });
    }
  }

  const importPaths = request.importPaths?.length
    ? request.importPaths
    : (request.protoRoots ?? []).map((root) => root.mountPath);

  return { protoFiles, importPaths };
}

export function parseProtoFiles(
  protoFiles: ProtoFileInput[],
  importPaths: string[] = [],
): protobuf.Root {
  if (!protoFiles.length) {
    throw new Error('protoFiles must contain at least one file');
  }

  const fingerprint = computeProtoIngestFingerprint(protoFiles, importPaths);
  const cached = getCachedProtoIngestRoot(fingerprint);
  if (cached) {
    return cached;
  }

  const fileMap = buildProtoFileMap({ protoFiles, importPaths, includeWktBundle: true });
  const root = createRootWithBundledWkt(fileMap, importPaths);
  parseUserProtoFilesIntoRoot(root, protoFiles, fileMap, importPaths);
  cacheProtoIngestRoot(fingerprint, root);
  return root;
}

export function parseProtosetBase64(protosetBase64: string): protobuf.Root {
  const normalizedBase64 = normalizeProtosetBase64Input(protosetBase64);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(normalizedBase64, 'base64');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid protosetBase64: ${message}`, { cause: error });
  }
  if (buffer.length === 0) {
    throw new Error('protosetBase64 decoded to an empty buffer');
  }

  let fileDescriptorSet: ReturnType<typeof descriptor.FileDescriptorSet.decode>;
  try {
    fileDescriptorSet = descriptor.FileDescriptorSet.decode(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode protoset: ${message}`, { cause: error });
  }
  if (!fileDescriptorSet.file?.length) {
    throw new Error('protoset contains no file descriptors');
  }

  try {
    const root = protobuf.Root.fromDescriptor(fileDescriptorSet);
    root.resolveAll();
    return root;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load protoset descriptor: ${message}`, { cause: error });
  }
}

function normalizeProtosetBase64Input(input: string): string {
  // Accept plain base64, data-URI payloads, base64url alphabet, and whitespace/newline wrapped payloads.
  const trimmed = input.trim();
  const dataUriPrefix = 'base64,';
  const base64Payload = trimmed.toLowerCase().includes(dataUriPrefix)
    ? trimmed.slice(trimmed.toLowerCase().lastIndexOf(dataUriPrefix) + dataUriPrefix.length)
    : trimmed;

  const compact = base64Payload
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    // Some intermediates accidentally map '+' to spaces.
    .replace(/ /g, '+');

  if (!compact) {
    return compact;
  }

  const remainder = compact.length % 4;
  if (remainder === 0) {
    return compact;
  }

  return compact.padEnd(compact.length + (4 - remainder), '=');
}

export function parseDescribeRequestSource(request: GrpcDescribeRequest): protobuf.Root {
  if (request.source === 'proto_files') {
    const normalized = normalizeDescribeProtoFilesInput(request);
    return parseProtoFiles(
      normalized.protoFiles,
      normalized.importPaths,
    );
  }
  if (request.source === 'protoset') {
    if (!request.protosetBase64?.trim()) {
      throw new Error('protosetBase64 is required when source is protoset');
    }
    return parseProtosetBase64(request.protosetBase64);
  }
  throw new Error(`Unsupported describe source: ${request.source as string}`);
}

export function encodeRootAsProtosetBase64(root: protobuf.Root): string {
  root.resolveAll();
  const fileDescriptorSet = root.toDescriptor('proto3');
  // protobufjs emits type references without a leading dot and drops per-file
  // `dependency` arrays. Restore them (+ topological order) so strict consumers
  // like prost-reflect (Tauri native) can resolve cross-file WKT references.
  normalizeFileDescriptorSetForProst(fileDescriptorSet);
  return Buffer.from(descriptor.FileDescriptorSet.encode(fileDescriptorSet).finish()).toString('base64');
}
