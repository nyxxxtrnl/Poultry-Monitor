'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const ESP32_URL = (process.env.ESP32_URL || 'http://192.168.4.1').replace(/\/+$/, '');
const ROOT = __dirname;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendText(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

function proxyEsp32(request, response, pathname) {
  const upstreamUrl = new URL(pathname, `${ESP32_URL}/`);
  const upstreamRequest = http.request(upstreamUrl, {
    method: request.method,
    headers: { Accept: 'application/json' },
    timeout: 5000,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, {
      'Content-Type': upstreamResponse.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    pipeline(upstreamResponse, response, (error) => {
      if (error && !response.headersSent) {
        sendText(response, 502, 'The ESP32 response could not be forwarded.');
      }
    });
  });

  upstreamRequest.on('timeout', () => {
    upstreamRequest.destroy(new Error('ESP32 request timed out.'));
  });
  upstreamRequest.on('error', (error) => {
    console.error(`ESP32 proxy error for ${pathname}: ${error.message}`);
    if (!response.headersSent) {
      sendText(response, 502, 'Could not connect to the ESP32. Check the Wi-Fi network.');
    } else {
      response.destroy(error);
    }
  });
  request.on('aborted', () => upstreamRequest.destroy());
  upstreamRequest.end();
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (_) {
    sendText(response, 400, 'Invalid request path.');
    return;
  }

  if (pathname === '/api/status' || pathname === '/api/history') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed.');
      return;
    }
    proxyEsp32(request, response, pathname);
    return;
  }

  if (pathname === '/api/warning/stop') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendText(response, 405, 'Method not allowed.');
      return;
    }
    proxyEsp32(request, response, pathname);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Method not allowed.');
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendText(response, 403, 'Forbidden.');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(response, 404, 'Not found.');
      return;
    }

    const headers = {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    pipeline(fs.createReadStream(filePath), response, (error) => {
      if (error && !response.headersSent) {
        sendText(response, 500, 'Could not read the dashboard file.');
      }
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Poultry monitor dashboard: http://localhost:${PORT}`);
  console.log(`Serving ESP32 API from ${ESP32_URL}`);
  console.log('For phone access, use this computer’s Wi-Fi IP on the same network.');
});
