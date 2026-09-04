import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { isLoopbackUrl, preferLocalhostHostname, resolveLoopbackUrl } from './src/shared/utils/loopbackUrl'
import { withKeepAliveConnection } from './src/shared/utils/outboundRequestHeaders'
import { probeApiMockEcho } from './src/shared/api-mock/echoHealthProbe'
import { demoHubRootImportsPlugin } from './vite/demoHubRootImports'
import { demoLiveGuardPlugin } from './vite/demoLiveGuardPlugin'
import { localDockerPlugin } from './vite/localDockerPlugin'
import { createMonacoAwareLogger, monacoDevNoisePlugin } from './vite/monacoDevNoisePlugin'

const PROXY_RETRY_CODES = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
  'UND_ERR_ABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
  // Zscaler / BlueCoat forward-proxy error codes (UN2_*, UN_*)
  // e.g. UN2_FPR_INVALID_400 returned when the proxy rejects the request
  'UN2_FPR_INVALID_400', 'UN2_FPR_DENIED', 'UN2_FPR_TIMEOUT',
]);

/**
 * When localhost:3001 is down, Vite's default proxy emits empty HTTP 502s.
 * Kafka status polls that every few seconds → DevTools "Failed to load resource"
 * spam. Return HTTP 200 JSON instead so the browser stays quiet and the app can
 * treat the backend as disconnected / unreachable.
 */
function writeSseUnavailable(
  res: import('http').ServerResponse | import('net').Socket | undefined,
): void {
  if (!res) return;
  if ('headersSent' in res && (res as import('http').ServerResponse).headersSent) {
    if (!res.writableEnded) (res as import('http').ServerResponse).end();
    return;
  }
  // EventSource reconnects on empty/network errors. HTTP 204 stops the browser retry.
  if ('writeHead' in res) {
    const serverRes = res as import('http').ServerResponse;
    serverRes.writeHead(204, { 'Cache-Control': 'no-cache' });
    serverRes.end();
    return;
  }
  if ('end' in res) {
    (res as import('net').Socket).end(
      'HTTP/1.1 204 No Content\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n',
    );
  }
}

function writeSoftBackendFallback(
  req: import('http').IncomingMessage | undefined,
  res: import('http').ServerResponse | import('net').Socket | undefined,
): void {
  const url = req?.url ?? '';
  if (url.includes('/logs/stream')) {
    writeSseUnavailable(res);
    return;
  }
  if (!res || !('writeHead' in res)) return;
  const serverRes = res as import('http').ServerResponse;
  if (serverRes.headersSent || serverRes.writableEnded) return;

  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const timestamp = new Date().toISOString();

  // Kafka connection indicator polls this continuously — soft-disconnected.
  if (url.startsWith('/api/kafka/status')) {
    let clusterId: string | undefined;
    try {
      clusterId = new URL(url, 'http://localhost').searchParams.get('clusterId') ?? undefined;
    } catch { /* ignore malformed URL */ }
    serverRes.writeHead(200, headers);
    serverRes.end(JSON.stringify({
      ok: true,
      op: 'status',
      data: {
        state: 'disconnected',
        ...(clusterId ? { clusterId } : {}),
        subscriptionCount: 0,
      },
      meta: { timestamp },
    }));
    return;
  }

  // Demo Hub health proxies expect HTTP 200 + { status: 'ok' | 'down' }.
  if (url.startsWith('/health/')) {
    serverRes.writeHead(200, headers);
    serverRes.end(JSON.stringify({ status: 'down', reason: 'backend unreachable' }));
    return;
  }

  // Other /api calls: 200 + ok:false so clients classify as retryable failure
  // without Chrome logging a 502 network error on every attempt.
  const kafkaOp = url.match(/^\/api\/kafka\/([^/?]+)/)?.[1];
  serverRes.writeHead(200, headers);
  serverRes.end(JSON.stringify({
    ok: false,
    op: kafkaOp ?? 'unknown',
    error: {
      code: 'BACKEND_UNREACHABLE',
      message: 'Backend server is not running on localhost:3001. Start it with npm run server:dev.',
      retryable: true,
    },
    meta: { timestamp },
  }));
}

function isProxyError(err: unknown): boolean {
  const codes = new Set<string>();
  const messages: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code;
      if (code) codes.add(code);
      messages.push(cur.message);
      cur = cur.cause;
    } else break;
  }
  if ([...codes].some(c => PROXY_RETRY_CODES.has(c))) return true;
  // Zscaler and similar proxies may embed their error code in the message
  // (e.g. "invalid onRequestStart method (UN2_FPR_INVALID_400)") rather than
  // setting a Node error code.  Match both the known Zscaler code prefix and
  // the undici dispatcher hook name to avoid false positives.
  if (messages.some(m => /\bUN[0-9]_[A-Z_]+\b/.test(m))) return true;
  if (messages.some(m => /onRequestStart/i.test(m))) return true;
  return messages.some(m => /Proxy response \(\d+\) !== 200 when HTTP Tunneling/i.test(m));
}

function proxyRound2(n: number): number { return Math.round(n * 100) / 100; }

function proxyPlugin(): Plugin {
  let pooledDispatcher: import('undici').Dispatcher | undefined;
  let isProxyDispatcher = false;

  async function getDispatcher(): Promise<{ dispatcher: import('undici').Dispatcher | undefined; isProxy: boolean }> {
    if (pooledDispatcher) return { dispatcher: pooledDispatcher, isProxy: isProxyDispatcher };
    try {
      const undici = await import('undici');
      const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
        || process.env.HTTP_PROXY || process.env.http_proxy;
      if (proxy) {
        pooledDispatcher = undici.EnvHttpProxyAgent
          ? new undici.EnvHttpProxyAgent()
          : new undici.ProxyAgent(proxy);
        isProxyDispatcher = true;
      } else {
        pooledDispatcher = new undici.Agent({
          keepAliveTimeout: 30_000,
          keepAliveMaxTimeout: 60_000,
          connect: { timeout: 10_000 },
          connections: 512,
          pipelining: 10,
        });
        isProxyDispatcher = false;
      }
    } catch { /* undici not available — fall back to default dispatcher */ }
    return { dispatcher: pooledDispatcher, isProxy: isProxyDispatcher };
  }

  function attachProxyMiddleware(server: ViteDevServer | PreviewServer) {
    server.httpServer?.on('close', () => {
      pooledDispatcher?.close?.();
      pooledDispatcher = undefined;
    });

    // AM-17 PrerequisiteGate — same-origin 200 so Chrome never logs :4017
    // CONNECTION_REFUSED. Uses Node http (no corporate HTTP_PROXY).
    server.middlewares.use('/health/api-mock-echo', async (_req, res) => {
      const probe = await probeApiMockEcho();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(probe.ok
        ? { status: 'ok', source: 'api-mock-echo', httpStatus: probe.statusCode }
        : { status: 'down', source: 'api-mock-echo', reason: probe.reason ?? 'unreachable' }));
    });

    server.middlewares.use('/__proxy', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method not allowed');
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');

        let payload: {
          url: string;
          method: string;
          headers: Record<string, string>;
          body?: string;
          /** When true, TLS certificate validation is skipped (self-signed / dev endpoints) */
          skipTlsVerify?: boolean;
          caCert?: string;
          clientCert?: string;
          clientKey?: string;
        };
        try {
          payload = JSON.parse(rawBody);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }

        try {
          // HTTPS loopback: keep localhost for Docker TLS/mTLS lesson stacks; plain HTTP
          // still resolves to 127.0.0.1 for Node/undici corporate-proxy quirks.
          if (payload.url.startsWith('https://')) {
            payload.url = preferLocalhostHostname(payload.url);
          } else {
            payload.url = resolveLoopbackUrl(payload.url);
          }
          // Drop journal `connection`/`host` first — a second Connection key
          // (any casing) makes undici throw invalid connection header.
          payload.headers = withKeepAliveConnection(payload.headers ?? {});
          // Browser abort of POST /__proxy must cancel the upstream fetch.
          // Without this, a timeout-fault mock holds the socket for the 1h
          // safety cap and never journals — the lesson then clicks an old 503.
          const ac = new AbortController();
          const abortUpstream = () => {
            if (!ac.signal.aborted) ac.abort();
          };
          req.on('close', abortUpstream);

          const fetchOpts: Record<string, unknown> = {
            method: payload.method,
            headers: payload.headers,
            signal: ac.signal,
          };
          if (payload.body && payload.method !== 'GET') {
            fetchOpts.body = payload.body;
          }

          // TLS: create a one-off Agent when skip-cert, CA, or mTLS client creds are set.
          let isProxy = false;
          const loopback = isLoopbackUrl(payload.url);
          const isHttps = payload.url.startsWith('https://');
          // A self-signed localhost mock cert (API Mock Studio "Generate self-signed")
          // can never chain to a public CA, so the default fetch rejects the handshake
          // and the live GET never journals. Loopback is not a MITM surface, so treat
          // any loopback HTTPS request as skip-verify even without explicit TLS opts.
          const loopbackHttps = isHttps && loopback;
          const hasCustomTls =
            (payload.skipTlsVerify && isHttps) ||
            !!payload.caCert?.trim() ||
            !!payload.clientCert?.trim() ||
            !!payload.clientKey?.trim();
          if ((hasCustomTls || loopbackHttps) && isHttps) {
            try {
              const { Agent } = await import('undici');
              const connect: Record<string, unknown> = {};
              if (payload.skipTlsVerify) {
                connect.rejectUnauthorized = false;
              } else if (loopback && !payload.caCert?.trim()) {
                connect.rejectUnauthorized = false;
              }
              if (payload.caCert?.trim()) connect.ca = payload.caCert;
              if (payload.clientCert?.trim()) connect.cert = payload.clientCert;
              if (payload.clientKey?.trim()) connect.key = payload.clientKey;
              fetchOpts.dispatcher = new Agent({ connect });
            } catch { /* undici unavailable — fall through to global default */ }
          } else if (!loopback) {
            const dispatched = await getDispatcher();
            if (dispatched.dispatcher) fetchOpts.dispatcher = dispatched.dispatcher;
            isProxy = dispatched.isProxy;
          }

          const MAX_PROXY_BODY = 2 * 1024 * 1024; // 2 MB cap to prevent pathological responses

          /** Perform the fetch and format the result.
           *
           * Node 22's global `fetch` does not support the undici `dispatcher`
           * option — passing one causes `UND_ERR_INVALID_ARG: invalid onRequestStart
           * method`.  Use `undici.fetch` when a custom dispatcher is present;
           * fall back to global `fetch` for plain requests (no dispatcher).
           */
          const doFetch = async (opts: Record<string, unknown>) => {
            const t0 = performance.now();
            const fetchFn: typeof fetch = opts.dispatcher
              ? (await import('undici')).fetch as unknown as typeof fetch
              : fetch;
            const response = await fetchFn(payload.url, opts as RequestInit);
            const tFirstByte = performance.now();
            const rawBody = await response.text();
            const responseBody = rawBody.length > MAX_PROXY_BODY ? rawBody.slice(0, MAX_PROXY_BODY) : rawBody;
            const tDone = performance.now();
            const resHeaders: Record<string, string> = {};
            response.headers.forEach((v, k) => { resHeaders[k] = v; });
            return {
              status: response.status,
              statusText: response.statusText,
              headers: resHeaders,
              body: responseBody,
              timing: {
                dnsLookup: 0, tcpConnect: 0, tlsHandshake: 0,
                ttfb: proxyRound2(tFirstByte - t0),
                download: proxyRound2(tDone - tFirstByte),
                total: proxyRound2(tDone - t0),
              },
            };
          };

          let result;
          try {
            result = await doFetch(fetchOpts);
          } catch (proxyErr) {
            if (ac.signal.aborted) throw proxyErr;
            if (isProxy && isProxyError(proxyErr)) {
              // Known proxy error (Zscaler, CONNECT tunnel, network codes) — retry direct.
              const directOpts = { ...fetchOpts };
              delete directOpts.dispatcher;
              result = await doFetch(directOpts);
            } else if (isProxy) {
              // Unknown error while a proxy dispatcher is active.  Try direct once
              // before surfacing the failure — covers VPN scenarios where the proxy
              // env var is set but the VPN tunnel bypasses the proxy.
              try {
                const directOpts = { ...fetchOpts };
                delete directOpts.dispatcher;
                result = await doFetch(directOpts);
              } catch {
                throw proxyErr; // both failed — surface the original proxy error
              }
            } else {
              throw proxyErr;
            }
          } finally {
            req.off('close', abortUpstream);
          }

          if (res.writableEnded || res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          // Walk the cause chain for detailed network errors (DNS, TLS, timeout, etc.)
          const parts: string[] = [];
          let cur: unknown = err;
          const seen = new Set<unknown>();
          while (cur && !seen.has(cur)) {
            seen.add(cur);
            if (cur instanceof Error) {
              const code = (cur as NodeJS.ErrnoException).code;
              parts.push(code ? `${cur.message} [${code}]` : cur.message);
              cur = cur.cause;
            } else {
              parts.push(String(cur));
              break;
            }
          }
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 0,
            statusText: '',
            headers: {},
            body: '',
            error: parts.join(' — '),
          }));
        }
      });
  }

  return {
    name: 'api-proxy',
    configureServer(server) {
      attachProxyMiddleware(server);
    },
    configurePreviewServer(server) {
      attachProxyMiddleware(server);
    },
  };
}

function docsPlugin(): Plugin {
  const docsRoot = resolve(__dirname, 'docs');

  function attachDocsMiddleware(server: ViteDevServer | PreviewServer) {
    server.middlewares.use('/docs', (req, res, next) => {
      const urlPath = (req.url ?? '/').split('?')[0];
      const filePath = join(docsRoot, decodeURIComponent(urlPath));
      if (!filePath.startsWith(docsRoot) || !existsSync(filePath)) {
        next();
        return;
      }
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const mimeTypes: Record<string, string> = {
        html: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', png: 'image/png', svg: 'image/svg+xml',
        jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
  }

  return {
    name: 'docs-static',
    configureServer(server) { attachDocsMiddleware(server); },
    configurePreviewServer(server) { attachDocsMiddleware(server); },
  };
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [demoHubRootImportsPlugin(), monacoDevNoisePlugin(), react(), proxyPlugin(), demoLiveGuardPlugin(), localDockerPlugin(), docsPlugin()],
  customLogger: createMonacoAwareLogger(),
  build: {
    chunkSizeWarningLimit: 10000,
  },
  define: {
    'process.env': '{}',
    '__dirname': '"/"',
    '__filename': '"/index.js"',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  optimizeDeps: {
    exclude: [
      // Node-only networking library — must not be pre-bundled for the browser
      'undici',
    ],
    include: [
      '@scalar/openapi-upgrader',
      '@scalar/openapi-upgrader/2.0-to-3.0',
      'openapi-format',
      'swagger2openapi',
      'oas-validator',
    ],
    rolldownOptions: {
      transform: {
        define: {
          'process.env': '{}',
          '__dirname': '"/"',
          '__filename': '"/index.js"',
        },
      },
    },
  },
  resolve: {
    alias: {
      '@redfireforge/demo-hub': resolve(__dirname, 'packages/demo-hub/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@graphql': resolve(__dirname, 'src/features/graphql'),
      '@grpc': resolve(__dirname, 'src/features/grpc'),
      '@workflow': resolve(__dirname, 'src/features/workflow'),
      '@engine': resolve(__dirname, 'src/engine'),
      '@engine/core': resolve(__dirname, 'src/engine/core'),
      '@engine/grpc': resolve(__dirname, 'src/engine/grpc'),
      '@engine/load': resolve(__dirname, 'src/engine/load'),
      '@test-utils': resolve(__dirname, 'src/test-utils'),
      '@app': resolve(__dirname, 'src/app'),
      'fs/promises': resolve(__dirname, 'src/shims/fs-promises-browser.ts'),
      fs: resolve(__dirname, 'src/shims/fs-browser.ts'),
      'node:fs/promises': resolve(__dirname, 'src/shims/fs-promises-browser.ts'),
      'node:fs': resolve(__dirname, 'src/shims/fs-browser.ts'),
      stream: resolve(__dirname, 'src/shims/stream-browser.ts'),
      'node:stream': resolve(__dirname, 'src/shims/stream-browser.ts'),
      // openapi-format (pretty-YAML normalization) eagerly requires these at load
      // time for remote-$ref support we never use; stub them for the browser bundle.
      path: resolve(__dirname, 'src/shims/path-browser.ts'),
      'node:path': resolve(__dirname, 'src/shims/path-browser.ts'),
      http: resolve(__dirname, 'src/shims/http-browser.ts'),
      'node:http': resolve(__dirname, 'src/shims/http-browser.ts'),
      https: resolve(__dirname, 'src/shims/https-browser.ts'),
      'node:https': resolve(__dirname, 'src/shims/https-browser.ts'),
      url: resolve(__dirname, 'src/shims/url-browser.ts'),
      'node:url': resolve(__dirname, 'src/shims/url-browser.ts'),
    },
  },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 5173,
    // Vite 8 turns this on inside Cursor (`determineAgent().isAgent`). When the
    // HMR websocket drops, forward-console send() rejects and the same
    // unhandledrejection listener re-sends — an infinite console loop
    // (vitejs/vite#22407). Keep log forwarding off until that is patched.
    forwardConsole: false,
    hmr: process.env.PHASE8_E2E_SWEEP !== '1',
    watch: {
      // Runtime writes (repo-root `data/` sqlite, E2E artifacts) must not trigger
      // full reloads. Do not ignore `**/data/**` — that also matches `src/data`
      // galleries and `src/features/*/data`, so catalog edits never HMR.
      ignored: [
        (id: string) => {
          const n = id.replace(/\\/g, '/');
          const root = resolve(__dirname, 'data').replace(/\\/g, '/');
          return n === root || n.startsWith(`${root}/`);
        },
        '**/*.db',
        '**/*.db-journal',
        '**/.cursor/**',
        '**/coverage/**',
        '**/e2e/screenshots/**',
        '**/playwright-report/**',
        '**/test-results/**',
        // Windows: watching cargo output DLLs under src-tauri/target races
        // MSVC (`EBUSY` on `tauri_plugin_mcp_bridge-*.dll`) and kills Vite.
        '**/src-tauri/target/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE (`/api/logs/stream`) stays open with no events until a log line.
        // A finite timeout closes it as ERR_EMPTY_RESPONSE and EventSource retries.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('error', (_err, req, res) => {
            writeSoftBackendFallback(req, res);
          });
        },
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 5000,
        configure: (proxy) => {
          proxy.on('error', (_err, req, res) => {
            writeSoftBackendFallback(req, res);
          });
        },
      },
    },
  },
  preview: {
    strictPort: true,
  },
})
