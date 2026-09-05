import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { LOCAL_DOCKER_PREFIX } from './localDocker/prefix.ts';

export function shouldAttachLocalDocker(
  env: NodeJS.ProcessEnv,
  dockerRootExists: boolean,
): boolean {
  if (env.VITE_LOCAL_DOCKER === '0') return false;
  return dockerRootExists;
}

function attachModuleHref(): string {
  return pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), 'localDocker', 'attach.ts'),
  ).href;
}

/** Loaded at request time so edits under `vite/localDocker/` do not restart Vite (EADDRINUSE → 504 Outdated Request). */
export async function attachLocalDockerMiddleware(
  server: ViteDevServer,
  repoRoot: string,
): Promise<void> {
  const { attachLocalDockerMiddleware: attach } = await import(attachModuleHref());
  attach(server, repoRoot);
}

export function localDockerPlugin(): Plugin {
  return {
    name: 'local-docker',
    apply: 'serve',
    async configureServer(server) {
      if (!shouldAttachLocalDocker(process.env, existsSync(resolve(server.config.root, 'docker')))) {
        return;
      }
      await attachLocalDockerMiddleware(server, server.config.root);
    },
  };
}

export { LOCAL_DOCKER_PREFIX };
