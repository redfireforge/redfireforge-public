import protobuf from 'protobufjs';
import type { GrpcEnumSchema, GrpcFieldSchema, GrpcMessageSchema } from '../../src/shared/grpc/contracts.js';
import { collectMessageSchemas } from './descriptorUtils.js';
import type { GrpcDescriptor } from '../../src/shared/grpc/contracts.js';
import { getDescriptorRootCache } from './descriptorRootCache.js';

const WIDE_LONG_FIELD_TYPES = new Set([
  'int64',
  'uint64',
  'sint64',
  'fixed64',
  'sfixed64',
]);

function isUnsignedWideLongFieldType(fieldType: string): boolean {
  return fieldType === 'uint64' || fieldType === 'fixed64';
}

function longFromDecimalString(value: string, fieldType: string): protobuf.util.Long {
  try {
    return protobuf.util.Long.fromString(value.trim(), isUnsignedWideLongFieldType(fieldType));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid 64-bit integer "${value}": ${message}`, { cause: error });
  }
}

function coerceWideLongForEncode(value: unknown, fieldType: string): unknown {
  if (typeof value === 'string') {
    return longFromDecimalString(value, fieldType);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return longFromDecimalString(String(value), fieldType);
  }
  return value;
}

function protobufCamelToSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const TIMESTAMP_TYPE_FULL_NAME = '.google.protobuf.Timestamp';

function isTimestampType(type: protobuf.Type): boolean {
  return type.fullName === TIMESTAMP_TYPE_FULL_NAME;
}

/**
 * The Proto Form Builder renders `google.protobuf.Timestamp` as a plain RFC3339/ISO8601
 * string input (see `GrpcProtoWktRows.tsx`). The dynamically-synthesized WKT stub is a
 * plain `{ seconds, nanos }` message, so an ISO string must be converted before
 * `Type.verify`/`Type.fromObject` — otherwise protobufjs rejects it with
 * "<field>.object expected". Objects already in `{ seconds, nanos }` shape pass through
 * unchanged for backward compatibility with callers that build the wire shape directly.
 */
function timestampInputToWireObject(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid RFC3339/ISO8601 timestamp: "${raw}"`);
  }
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  return { seconds: String(seconds), nanos };
}

/** Reverse of {@link timestampInputToWireObject} — used when decoding a response body. */
function timestampWireObjectToIso(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const seconds = Number(record.seconds ?? 0);
  const nanos = Number(record.nanos ?? 0);
  if (Number.isNaN(seconds) || Number.isNaN(nanos)) return value;
  return new Date(seconds * 1000 + nanos / 1e6).toISOString();
}

/** Map schema/snake_case JSON bodies onto protobufjs field names (reflection roots use camelCase). */
function alignBodyToProtobufFieldNames(
  type: protobuf.Type,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };

  for (const field of type.fieldsArray) {
    const protoName = field.name;
    const schemaName = protobufCamelToSnake(protoName);
    if (schemaName !== protoName && next[schemaName] !== undefined && next[protoName] === undefined) {
      next[protoName] = next[schemaName];
      delete next[schemaName];
    }

    const value = next[protoName];
    if (value === undefined || value === null) continue;

    if (field.resolvedType instanceof protobuf.Type) {
      if (field.repeated && Array.isArray(value)) {
        next[protoName] = value.map((item) => (
          typeof item === 'object' && item && !Array.isArray(item)
            ? alignBodyToProtobufFieldNames(field.resolvedType as protobuf.Type, item as Record<string, unknown>)
            : item
        ));
      } else if (!field.repeated && !field.map && typeof value === 'object' && !Array.isArray(value)) {
        next[protoName] = alignBodyToProtobufFieldNames(
          field.resolvedType as protobuf.Type,
          value as Record<string, unknown>,
        );
      }
    }
  }

  return next;
}

/** Normalize decoded protobufjs objects back to schema/snake_case field names. */
function alignDecodedBodyToSchemaNames(
  type: protobuf.Type,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };

  for (const field of type.fieldsArray) {
    const protoName = field.name;
    const schemaName = protobufCamelToSnake(protoName);
    const hasProto = Object.prototype.hasOwnProperty.call(next, protoName);
    const hasSchema = Object.prototype.hasOwnProperty.call(next, schemaName);
    if (!hasProto && !hasSchema) continue;

    let value = hasProto ? next[protoName] : next[schemaName];

    if (field.resolvedType instanceof protobuf.Type) {
      const isTimestampField = isTimestampType(field.resolvedType);
      if (field.map && typeof value === 'object' && value && !Array.isArray(value)) {
        if (isTimestampField) {
          value = Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .map(([key, item]) => [key, timestampWireObjectToIso(item)]),
          );
        }
      } else if (field.repeated && Array.isArray(value)) {
        value = value.map((item) => (
          isTimestampField
            ? timestampWireObjectToIso(item)
            : (typeof item === 'object' && item && !Array.isArray(item)
              ? alignDecodedBodyToSchemaNames(field.resolvedType as protobuf.Type, item as Record<string, unknown>)
              : item)
        ));
      } else if (!field.repeated && !field.map && typeof value === 'object' && value && !Array.isArray(value)) {
        value = isTimestampField
          ? timestampWireObjectToIso(value)
          : alignDecodedBodyToSchemaNames(
            field.resolvedType as protobuf.Type,
            value as Record<string, unknown>,
          );
      }
    }

    next[schemaName] = value;
    if (schemaName !== protoName) {
      delete next[protoName];
    }
  }

  return next;
}

function normalizeBodyForEncode(type: protobuf.Type, body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };

  for (const field of type.fieldsArray) {
    if (!Object.prototype.hasOwnProperty.call(next, field.name)) continue;
    const raw = next[field.name];
    if (raw === undefined || raw === null) continue;

    const fieldType = String(field.type);

    const isTimestampField = field.resolvedType instanceof protobuf.Type
      && isTimestampType(field.resolvedType);

    if (field.map) {
      if (typeof raw !== 'object' || Array.isArray(raw)) continue;
      if (isTimestampField) {
        const mapNext: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
          mapNext[key] = normalizeBodyForEncode(
            field.resolvedType as protobuf.Type,
            timestampInputToWireObject(item) as Record<string, unknown>,
          );
        }
        next[field.name] = mapNext;
        continue;
      }
      if (!WIDE_LONG_FIELD_TYPES.has(fieldType)) continue;
      const mapNext: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
        mapNext[key] = coerceWideLongForEncode(item, fieldType);
      }
      next[field.name] = mapNext;
      continue;
    }

    if (field.repeated) {
      if (!Array.isArray(raw)) continue;
      if (WIDE_LONG_FIELD_TYPES.has(fieldType)) {
        next[field.name] = raw.map((item) => coerceWideLongForEncode(item, fieldType));
      } else if (isTimestampField) {
        next[field.name] = raw.map((item) => normalizeBodyForEncode(
          field.resolvedType as protobuf.Type,
          timestampInputToWireObject(item) as Record<string, unknown>,
        ));
      } else if (field.resolvedType instanceof protobuf.Type) {
        next[field.name] = raw.map((item) => (
          typeof item === 'object' && item && !Array.isArray(item)
            ? normalizeBodyForEncode(field.resolvedType as protobuf.Type, item as Record<string, unknown>)
            : item
        ));
      }
      continue;
    }

    if (field.resolvedType instanceof protobuf.Type) {
      if (isTimestampField) {
        next[field.name] = normalizeBodyForEncode(
          field.resolvedType,
          timestampInputToWireObject(raw) as Record<string, unknown>,
        );
      } else if (typeof raw === 'object' && raw && !Array.isArray(raw)) {
        next[field.name] = normalizeBodyForEncode(field.resolvedType, raw as Record<string, unknown>);
      }
      continue;
    }

    if (WIDE_LONG_FIELD_TYPES.has(fieldType)) {
      next[field.name] = coerceWideLongForEncode(raw, fieldType);
    }
  }

  return next;
}

const PROTO_TYPE_MAP: Record<string, string> = {
  bool: 'bool',
  bytes: 'bytes',
  string: 'string',
  int32: 'int32',
  int64: 'int64',
  uint32: 'uint32',
  uint64: 'uint64',
  sint32: 'sint32',
  sint64: 'sint64',
  fixed32: 'fixed32',
  fixed64: 'fixed64',
  sfixed32: 'sfixed32',
  sfixed64: 'sfixed64',
  float: 'float',
  double: 'double',
  enum: 'int32',
  message: 'string',
};

const WKT_PROTO_TYPE: Record<string, string> = {
  'google.protobuf.Timestamp': 'google.protobuf.Timestamp',
  'google.protobuf.Duration': 'google.protobuf.Duration',
  'google.protobuf.Any': 'google.protobuf.Any',
  'google.protobuf.Struct': 'google.protobuf.Struct',
  'google.protobuf.Value': 'google.protobuf.Value',
  'google.protobuf.BoolValue': 'google.protobuf.BoolValue',
  'google.protobuf.StringValue': 'google.protobuf.StringValue',
  'google.protobuf.Int32Value': 'google.protobuf.Int32Value',
  'google.protobuf.Int64Value': 'google.protobuf.Int64Value',
};

const WKT_STUB_MESSAGE: Record<string, string> = {
  'google.protobuf.Timestamp': 'message Timestamp {\n  int64 seconds = 1;\n  int32 nanos = 2;\n}',
  'google.protobuf.Duration': 'message Duration {\n  int64 seconds = 1;\n  int32 nanos = 2;\n}',
  'google.protobuf.Any': 'message Any {\n  string type_url = 1;\n  bytes value = 2;\n}',
  'google.protobuf.Struct': 'message Struct {\n  map<string, Value> fields = 1;\n}',
  'google.protobuf.Value': 'message Value {\n  oneof kind {\n    int32 null_value = 1;\n    double number_value = 2;\n    string string_value = 3;\n    bool bool_value = 4;\n    Struct struct_value = 5;\n    ListValue list_value = 6;\n  }\n}',
  'google.protobuf.BoolValue': 'message BoolValue {\n  bool value = 1;\n}',
  'google.protobuf.StringValue': 'message StringValue {\n  string value = 1;\n}',
  'google.protobuf.Int32Value': 'message Int32Value {\n  int32 value = 1;\n}',
  'google.protobuf.Int64Value': 'message Int64Value {\n  int64 value = 1;\n}',
};

function packageForTypeName(typeName: string, fallbackPackage: string): string {
  if (!typeName.includes('.')) {
    return fallbackPackage;
  }
  return typeName.split('.').slice(0, -1).join('.');
}

function resolveProtoType(field: GrpcFieldSchema, owningPackage: string): string {
  const wktType = WKT_PROTO_TYPE[field.type];
  if (wktType) {
    return wktType;
  }
  if (field.type === 'message' && field.messageTypeName) {
    const fieldPackage = packageForTypeName(field.messageTypeName, owningPackage);
    const shortName = field.messageTypeName.split('.').pop() ?? field.messageTypeName;
    return fieldPackage === owningPackage ? shortName : field.messageTypeName;
  }
  if (field.type === 'enum' && field.enumTypeName) {
    const fieldPackage = packageForTypeName(field.enumTypeName, owningPackage);
    const shortName = field.enumTypeName.split('.').pop() ?? 'int32';
    return fieldPackage === owningPackage ? shortName : field.enumTypeName;
  }
  return PROTO_TYPE_MAP[field.type] ?? 'string';
}

function fieldLine(field: GrpcFieldSchema, owningPackage: string): string {
  const protoType = resolveProtoType(field, owningPackage);
  const labelPrefix = field.label === 'repeated' ? 'repeated ' : '';
  return `${labelPrefix}${protoType} ${field.name} = ${field.number};`;
}

function mapFieldLine(field: GrpcFieldSchema, owningPackage: string): string {
  const keyType = PROTO_TYPE_MAP[field.mapKeyType ?? 'string'] ?? 'string';
  const valueType = resolveProtoType(field, owningPackage);
  return `map<${keyType}, ${valueType}> ${field.name} = ${field.number};`;
}

function groupMessageFields(fields: GrpcFieldSchema[]): {
  regular: GrpcFieldSchema[];
  oneofGroups: Map<string, GrpcFieldSchema[]>;
} {
  const regular: GrpcFieldSchema[] = [];
  const oneofGroups = new Map<string, GrpcFieldSchema[]>();
  for (const field of fields) {
    if (field.isOneofMember && field.oneofName) {
      const members = oneofGroups.get(field.oneofName) ?? [];
      members.push(field);
      oneofGroups.set(field.oneofName, members);
    } else {
      regular.push(field);
    }
  }
  return { regular, oneofGroups };
}

function messageBlock(schema: GrpcMessageSchema, fallbackPackage: string): string {
  const owningPackage = packageForTypeName(schema.typeName, fallbackPackage);
  const { regular, oneofGroups } = groupMessageFields(schema.fields);
  const lines: string[] = [];
  for (const field of regular) {
    lines.push(field.isMap
      ? mapFieldLine(field, owningPackage)
      : fieldLine(field, owningPackage));
  }
  for (const [oneofName, members] of oneofGroups) {
    const memberLines = members.map((member) => fieldLine(member, owningPackage)).join('\n    ');
    lines.push(`oneof ${oneofName} {\n    ${memberLines}\n  }`);
  }
  const shortName = schema.typeName.split('.').pop() ?? schema.typeName;
  return `message ${shortName} {\n  ${lines.join('\n  ')}\n}`;
}

function enumBlock(schema: GrpcEnumSchema): string {
  const shortName = schema.typeName.split('.').pop() ?? schema.typeName;
  const values = schema.values
    .map((value) => `  ${value.name} = ${value.number};`)
    .join('\n');
  return `enum ${shortName} {\n${values}\n}`;
}

function collectAllMessageSchemas(descriptor: GrpcDescriptor): GrpcMessageSchema[] {
  const schemaMap = new Map<string, GrpcMessageSchema>();
  for (const schema of descriptor.messageTypes ?? []) {
    schemaMap.set(schema.typeName, schema);
  }
  for (const schema of collectMessageSchemas(descriptor).values()) {
    schemaMap.set(schema.typeName, schema);
  }
  return [...schemaMap.values()];
}

function buildProtoSourceSections(descriptor: GrpcDescriptor): string[] {
  const fallbackPackage = descriptor.services[0]?.fullName.split('.').slice(0, -1).join('.') ?? 'grpcstudio';
  const schemas = collectAllMessageSchemas(descriptor);
  const byPackage = new Map<string, GrpcMessageSchema[]>();
  for (const schema of schemas) {
    const pkg = packageForTypeName(schema.typeName, fallbackPackage);
    const list = byPackage.get(pkg) ?? [];
    list.push(schema);
    byPackage.set(pkg, list);
  }
  const enumsByPackage = new Map<string, GrpcEnumSchema[]>();
  for (const enumSchema of descriptor.enumTypes ?? []) {
    const pkg = packageForTypeName(enumSchema.typeName, fallbackPackage);
    const list = enumsByPackage.get(pkg) ?? [];
    list.push(enumSchema);
    enumsByPackage.set(pkg, list);
  }
  const packageNames = new Set([...byPackage.keys(), ...enumsByPackage.keys()]);
  return [...packageNames].map((pkg) => {
    const enumBlocks = (enumsByPackage.get(pkg) ?? []).map(enumBlock).join('\n\n');
    const messageBlocks = (byPackage.get(pkg) ?? [])
      .map((schema) => messageBlock(schema, pkg))
      .join('\n\n');
    const blocks = [enumBlocks, messageBlocks].filter(Boolean).join('\n\n');
    return `package ${pkg};\n\n${blocks}`;
  });
}

function collectRequiredWktTypes(descriptor: GrpcDescriptor): Set<string> {
  const types = new Set<string>();
  for (const schema of collectAllMessageSchemas(descriptor)) {
    for (const field of schema.fields) {
      if (WKT_PROTO_TYPE[field.type]) {
        types.add(field.type);
      }
    }
  }
  return types;
}

function buildWktStubSection(descriptor: GrpcDescriptor): string | null {
  const wktTypes = collectRequiredWktTypes(descriptor);
  if (wktTypes.size === 0) {
    return null;
  }
  const messages = [...wktTypes]
    .map((typeName) => WKT_STUB_MESSAGE[typeName])
    .filter(Boolean)
    .join('\n\n');
  return `package google.protobuf;\n\n${messages}`;
}

const rootCache = new Map<string, protobuf.Root>();

function parseDescriptorRoot(descriptor: GrpcDescriptor): protobuf.Root {
  try {
    const wktSection = buildWktStubSection(descriptor);
    const sections = [
      ...(wktSection ? [wktSection] : []),
      ...buildProtoSourceSections(descriptor),
    ];
    // Each section has its own `package` declaration; parse all into the same
    // root so cross-package type references resolve correctly. Passing the root
    // as the second argument to protobuf.parse is required — creating separate
    // roots and calling root.add() nests them instead of merging namespaces.
    const root = new protobuf.Root();
    for (const section of sections) {
      protobuf.parse(`syntax = "proto3";\n\n${section}\n`, root, { keepCase: true });
    }
    root.resolveAll();
    return root;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid descriptor schema for key ${descriptor.key}: ${message}`, { cause: error });
  }
}

function getRoot(descriptor: GrpcDescriptor): protobuf.Root {
  const sourceRoot = getDescriptorRootCache(descriptor.key);
  if (sourceRoot) {
    return sourceRoot;
  }
  const cached = rootCache.get(descriptor.key);
  if (cached) return cached;
  const root = parseDescriptorRoot(descriptor);
  rootCache.set(descriptor.key, root);
  return root;
}

function lookupMessageType(root: protobuf.Root, typeName: string): protobuf.Type {
  const lookupCandidates = [
    typeName,
    typeName.startsWith('.') ? typeName.slice(1) : `.${typeName}`,
    typeName.split('.').pop() ?? typeName,
  ];
  const seen = new Set<string>();
  for (const candidate of lookupCandidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return root.lookupType(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Type ${typeName} not found in descriptor`);
}

export function clearDynamicProtoCodecCache(): void {
  rootCache.clear();
}

export function encodeProtoMessage(
  descriptor: GrpcDescriptor,
  typeName: string,
  body: Record<string, unknown>,
): Buffer {
  const root = getRoot(descriptor);
  const Type = lookupMessageType(root, typeName);
  const alignedBody = alignBodyToProtobufFieldNames(Type, body);
  const normalizedBody = normalizeBodyForEncode(Type, alignedBody);
  const err = Type.verify(normalizedBody);
  if (err) {
    throw new Error(`Invalid request body for ${typeName}: ${err}`);
  }
  const message = Type.create(normalizedBody);
  return Buffer.from(Type.encode(message).finish());
}

export function decodeProtoMessage(
  descriptor: GrpcDescriptor,
  typeName: string,
  buffer: Buffer,
): Record<string, unknown> {
  const root = getRoot(descriptor);
  const Type = lookupMessageType(root, typeName);
  const decoded = Type.decode(buffer);
  const object = Type.toObject(decoded, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true,
  }) as Record<string, unknown>;
  return alignDecodedBodyToSchemaNames(Type, object);
}
