/**
 * API Mock echo upstream — used by the Proxy & Record-to-Drafts demo lesson.
 *
 * Any path returns JSON describing the inbound request so a blank mock can
 * proxy an unmocked route and record the exchange as a draft.
 *
 *   GET  http://localhost:4017/health      → { status: "ok", ... }
 *   GET  http://localhost:4017/widgets/42  → { service, method, path, headers, body }
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4017);
const HOST = process.env.HOST ?? '0.0.0.0';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy(new Error('payload_too_large'));
    });
    req.on('error', () => resolve(''));
    req.on('end', () => resolve(raw));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await collectBody(req);
  const echo = {
    service: 'api-mock-echo',
    method: req.method ?? 'GET',
    path: url.pathname,
    headers,
    body: body || null,
  };
  if (url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', ...echo });
    return;
  }
  sendJson(res, 200, echo);
});

server.listen(PORT, HOST, () => {
   
  console.log(`[api-mock-echo] listening on http://${HOST}:${PORT}`);
});
