import type { ViteDevServer } from 'vite';
import { checkDockerState, createDaemonStateReader } from './daemon.ts';
import { handleLocalDockerRequest } from './http.ts';
import { createLocalDockerLifecycle } from './lifecycle.ts';
import { createLogBus } from './logs.ts';
import { openDockerDesktopApp } from './openDesktop.ts';
import { LOCAL_DOCKER_PREFIX } from './prefix.ts';

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
