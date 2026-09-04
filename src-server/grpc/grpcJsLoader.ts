import { createRequire } from 'node:module';

let cachedGrpc: typeof import('@grpc/grpc-js') | null = null;

/** Test-only reset for loader cache between isolated coverage cases. */
export function resetGrpcJsLoaderCacheForTests(): void {
  cachedGrpc = null;
}

function resolveGrpcJs(): typeof import('@grpc/grpc-js') {
  if (cachedGrpc) return cachedGrpc;
  try {
    const require = createRequire(import.meta.url);
    cachedGrpc = require('@grpc/grpc-js') as typeof import('@grpc/grpc-js');
    return cachedGrpc;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `@grpc/grpc-js is required for server gRPC transport features. Install dependencies and retry. (${message})`,
      { cause: error },
    );
  }
}

export const grpc = new Proxy({} as typeof import('@grpc/grpc-js'), {
  get(_target, prop) {
    return (resolveGrpcJs() as Record<PropertyKey, unknown>)[prop];
  },
});
