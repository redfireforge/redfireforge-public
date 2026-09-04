export type DockerDaemonState =
  | 'notInstalled'
  | 'notRunning'
  | 'outdatedCompose'
  | 'running';

export type LocalDockerStackKey =
  | 'graphql'
  | 'graphql-tls'
  | 'grpc'
  | 'grpc-spring'
  | 'kafka-plaintext'
  | 'kafka-secure'
  | 'kafka-tls'
  | 'kafka-schema-registry'
  | 'ws-socketio'
  | 'ws-graphql'
  | 'ws-stomp'
  | 'ws-tls'
  | 'api-mock';

export interface StackManifest {
  stackKey?: string;
  sinceVersion?: string;
  description?: string;
  composeFiles: string[];
  buildOnStart: boolean;
  composeProfile: string | null;
  requiresCompanionProbe: boolean;
  ports: number[];
  minMemoryMb: number | null;
  certExpiresAt: string | null;
}

export interface DockerRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

export interface DockerRunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export interface DockerRunner {
  run(args: string[], opts?: DockerRunOptions): Promise<DockerRunResult>;
}
