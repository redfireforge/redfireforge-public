import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 50560);
const HOST = process.env.HOST ?? '0.0.0.0';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function parseFormBody(raw) {
  const params = new URLSearchParams(raw);
  return {
    grantType: params.get('grant_type')?.trim() ?? '',
    clientId: params.get('client_id')?.trim() ?? '',
    clientSecret: params.get('client_secret')?.trim() ?? '',
    scope: params.get('scope')?.trim() ?? '',
  };
}

const server = createServer((req, res) => {
  if (!req.url) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'grpc-oauth2-mock',
      tokenEndpoint: '/oauth2/token',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/oauth2/token') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy(new Error('payload_too_large'));
      }
    });

    req.on('error', () => {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'Could not read request body.',
      });
    });

    req.on('end', () => {
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.includes('application/x-www-form-urlencoded')) {
        sendJson(res, 415, {
          error: 'invalid_request',
          error_description: 'Expected application/x-www-form-urlencoded body.',
        });
        return;
      }

      const form = parseFormBody(body);
      if (form.grantType !== 'client_credentials') {
        sendJson(res, 400, {
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials is supported by this mock endpoint.',
        });
        return;
      }
      if (!form.clientId || !form.clientSecret) {
        sendJson(res, 401, {
          error: 'invalid_client',
          error_description: 'client_id and client_secret are required.',
        });
        return;
      }

      sendJson(res, 200, {
        access_token: `rf-demo-${form.clientId}-token`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: form.scope || 'read write',
      });
    });
    return;
  }

  sendJson(res, 404, {
    error: 'not_found',
    error_description: 'Use POST /oauth2/token or GET /health.',
  });
});

server.listen(PORT, HOST, () => {
   
  console.log(`[grpc-oauth2-mock] listening on http://${HOST}:${PORT}`);
});
