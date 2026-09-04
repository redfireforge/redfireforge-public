import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { checkDockerState, createDaemonStateReader } from './localDocker/daemon.ts';
import { LOCAL_DOCKER_PREFIX, handleLocalDockerRequest } from './localDocker/http.ts';
import { createLocalDockerLifecycle } from './localDocker/lifecycle.ts';
import { createLogBus } from './localDocker/logs.ts';
import { openDockerDesktopApp } from './localDocker/openDesktop.ts';

export function shouldAttachLocalDocker(
  env: NodeJS.ProcessEnv,
  dockerRootExists: boolean,
): boolean {
  if (env.VITE_LOCAL_DOCKER === '0') return false;
  return dockerRootExists;
}

export function attachLocalDockerMiddleware(server: ViteDevServer, repoRoot: string): void {
  const logs = createLogBus();
  const lifecycle = createLocalDockerLifecycle(repoRoot, { logs });
  const daemon = createDaemonStateReader(() => checkDockerState());

  server.middlewares.use(LOCAL_DOCKER_PREFIX, (req, res) => {
    void handleLocalDockerRequest(req, res, {
      lifecycle,
      checkState: daemon.refresh,
      peekDocker: daemon.peek,
      logs,
      openDesktop: () => openDockerDesktopApp(),
    }).catch(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(500);
        res.end();
      }
    });
  });
}

export function localDockerPlugin(): Plugin {
  return {
    name: 'local-docker',
    apply: 'serve',
    configureServer(server) {
      if (!shouldAttachLocalDocker(process.env, existsSync(resolve(server.config.root, 'docker')))) {
        return;
      }
      attachLocalDockerMiddleware(server, server.config.root);
    },
  };
}

export { LOCAL_DOCKER_PREFIX };
