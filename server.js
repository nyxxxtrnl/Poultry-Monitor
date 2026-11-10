'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pipeline } = require('node:stream');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const ESP32_URL = new URL(process.env.ESP32_URL || 'http://192.168.4.1');
const ROOT = __dirname;
const DATABASE_PATH = path.resolve(
  process.env.SQLITE_PATH || path.join(ROOT, '.data', 'poultry-monitor.sqlite'),
);
const REQUEST_TIMEOUT_MS = 5000;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROXY_REQUEST_BYTES = 16 * 1024;
const HISTORY_LIMIT = 500;
const STATIC_FILES = new Set([
  'index.html',
  'styles.css',
  'cloud-config.js',
  'app.js',
  'manifest.webmanifest',
  'service-worker.js',
  'app-icon-192.png',
  'app-icon-512.png',
]);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

if (!['http:', 'https:'].includes(ESP32_URL.protocol) ||
    ESP32_URL.username || ESP32_URL.password || ESP32_URL.search || ESP32_URL.hash ||
    !['/', ''].includes(ESP32_URL.pathname)) {
  throw new Error('ESP32_URL must be an HTTP(S) base URL without credentials, path, query, or fragment.');
}
ESP32_URL.pathname = '';
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    sensor_ok INTEGER NOT NULL,
    warning TEXT,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sensor_readings_recorded_at
    ON sensor_readings (recorded_at DESC);
`);

const insertReading = database.prepare(`
  INSERT INTO sensor_readings
    (temperature, humidity, sensor_ok, warning, recorded_at)
  VALUES (?, ?, ?, ?, ?)
`);
const selectHistory = database.prepare(`
  SELECT temperature, humidity, sensor_ok, warning, recorded_at
  FROM sensor_readings
  ORDER BY id DESC
  LIMIT ?
`);
const selectHealth = database.prepare('SELECT 1 AS healthy');

function sendText(response, status, message, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(message);
}

function sendJson(response, status, value, method = 'GET') {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function normalizeWarning(value) {
  if (typeof value === 'string') return value.trim() || null;
  return value === true ? 'Hardware warning' : null;
}

function parseStatus(body) {
  let status;
  try {
    status = JSON.parse(body);
  } catch (error) {
    throw new Error(`ESP32 status response was not valid JSON: ${error.message}`);
  }

  const hasValidReadings = typeof status?.temperature === 'number' &&
    Number.isFinite(status.temperature) &&
    typeof status?.humidity === 'number' &&
    Number.isFinite(status.humidity);
  const hasUnavailableReadings = status?.sensorOK === false &&
    status.temperature === null && status.humidity === null;

  if (!status || typeof status !== 'object' || Array.isArray(status) ||
      (!hasValidReadings && !hasUnavailableReadings) ||
      (status.sensorOK !== undefined && typeof status.sensorOK !== 'boolean') ||
      (status.warning !== undefined && status.warning !== null &&
        typeof status.warning !== 'string' && typeof status.warning !== 'boolean')) {
    throw new Error('ESP32 status response has invalid sensor values.');
  }

  return {
    temperature: hasValidReadings ? status.temperature : null,
    humidity: hasValidReadings ? status.humidity : null,
    sensorOK: status.sensorOK === true,
    warning: normalizeWarning(status.warning),
  };
}

function saveStatusReading(status) {
  insertReading.run(
    status.temperature,
    status.humidity,
    status.sensorOK ? 1 : 0,
    status.warning,
    new Date().toISOString(),
  );
}

function upstreamRequest(pathname, method, requestBody, callback) {
  const transport = ESP32_URL.protocol === 'https:' ? https : http;
  const upstreamUrl = new URL(pathname, ESP32_URL);
  const headers = { Accept: 'application/json' };
  if (requestBody.length) {
    headers['Content-Length'] = requestBody.length;
    headers['Content-Type'] = 'application/json';
  }

  const upstream = transport.request(upstreamUrl, {
    method,
    headers,
    timeout: REQUEST_TIMEOUT_MS,
  }, callback);

  upstream.on('timeout', () => upstream.destroy(new Error('ESP32 request timed out.')));
  return upstream;
}

function handleStatusRequest(request, response) {
  let upstream;
  try {
    upstream = upstreamRequest('/api/status', 'GET', Buffer.alloc(0), (upstreamResponse) => {
      const chunks = [];
      let responseSize = 0;
      upstreamResponse.on('data', (chunk) => {
        responseSize += chunk.length;
        if (responseSize > MAX_UPSTREAM_RESPONSE_BYTES) {
          upstreamResponse.destroy(new Error('ESP32 status response exceeded 1 MB.'));
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on('end', () => {
        const body = Buffer.concat(chunks);
        let status;
        if (upstreamResponse.statusCode >= 200 && upstreamResponse.statusCode < 300) {
          try {
            status = parseStatus(body.toString('utf8'));
          } catch (error) {
            console.error(`Invalid ESP32 status response: ${error.message}`);
            sendJson(response, 502, { error: 'The ESP32 returned invalid sensor data.' }, request.method);
            return;
          }
          if (request.method === 'GET' && status.temperature !== null) {
            try {
              saveStatusReading(status);
            } catch (error) {
              console.error(`Could not save ESP32 reading to SQLite: ${error.message}`);
              sendJson(response, 500, { error: 'Could not save sensor reading to SQLite.' });
              return;
            }
          }
        }

        response.writeHead(upstreamResponse.statusCode || 502, {
          'Content-Type': upstreamResponse.headers['content-type'] || 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      });
      upstreamResponse.on('error', (error) => {
        console.error(`ESP32 status response error: ${error.message}`);
        if (!response.headersSent) {
          sendJson(response, 502, { error: 'The ESP32 status response could not be read.' }, request.method);
        } else {
          response.destroy(error);
        }
      });
    });
  } catch (error) {
    console.error(`Could not create ESP32 status request: ${error.message}`);
    sendJson(response, 502, { error: 'Could not create the ESP32 request.' }, request.method);
    return;
  }

  upstream.on('error', (error) => {
    console.error(`ESP32 status request failed: ${error.message}`);
    if (!response.headersSent) {
      sendJson(response, 502, { error: 'Could not connect to the ESP32. Check the Wi-Fi network.' }, request.method);
    } else {
      response.destroy(error);
    }
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {
    if (!response.writableEnded) upstream.destroy();
  });
  upstream.end();
}

function proxyEsp32(request, response, pathname) {
  const chunks = [];
  let requestSize = 0;
  let requestTooLarge = false;
  request.on('data', (chunk) => {
    requestSize += chunk.length;
    if (requestSize > MAX_PROXY_REQUEST_BYTES) {
      if (!requestTooLarge) {
        requestTooLarge = true;
        chunks.length = 0;
        sendText(response, 413, 'Request body is too large.');
      }
      return;
    }
    if (!requestTooLarge) chunks.push(chunk);
  });
  request.on('end', () => {
    if (response.writableEnded || requestTooLarge) return;
    const body = Buffer.concat(chunks);
    let upstream;
    try {
      upstream = upstreamRequest(pathname, request.method, body, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, {
          'Content-Type': upstreamResponse.headers['content-type'] || 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        pipeline(upstreamResponse, response, (error) => {
          if (error && !response.headersSent) {
            sendJson(response, 502, { error: 'The ESP32 response could not be forwarded.' });
          }
        });
      });
    } catch (error) {
      console.error(`Could not create ESP32 proxy request: ${error.message}`);
      sendJson(response, 502, { error: 'Could not create the ESP32 request.' });
      return;
    }

    upstream.on('error', (error) => {
      console.error(`ESP32 proxy error for ${pathname}: ${error.message}`);
      if (!response.headersSent) {
        sendJson(response, 502, { error: 'Could not connect to the ESP32. Check the Wi-Fi network.' });
      } else {
        response.destroy(error);
      }
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => {
      if (!response.writableEnded) upstream.destroy();
    });
    upstream.end(body);
  });
}

function handleHistoryRequest(request, response) {
  try {
    const history = selectHistory.all(HISTORY_LIMIT).map((row) => ({
      temperature: row.temperature,
      humidity: row.humidity,
      sensorOK: row.sensor_ok === 1,
      warning: row.warning,
      recordedAt: row.recorded_at,
      elapsedMs: null,
    }));
    sendJson(response, 200, { history }, request.method);
  } catch (error) {
    console.error(`Could not read sensor history from SQLite: ${error.message}`);
    sendJson(response, 500, { error: 'Could not read sensor history from SQLite.' }, request.method);
  }
}

function serveStaticFile(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendText(response, 403, 'Forbidden.');
    return;
  }
  if (filePath === ROOT || path.dirname(filePath) !== ROOT ||
      !STATIC_FILES.has(path.basename(filePath))) {
    sendText(response, 404, 'Not found.');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(response, 404, 'Not found.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
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
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (_) {
    sendText(response, 400, 'Invalid request path.');
    return;
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    try {
      selectHealth.get();
      sendJson(response, 200, { status: 'ok', database: 'ok' }, request.method);
    } catch (error) {
      console.error(`Backend health check failed: ${error.message}`);
      sendJson(response, 503, { status: 'error', database: 'error' }, request.method);
    }
    return;
  }

  if (pathname === '/api/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    handleStatusRequest(request, response);
    return;
  }

  if (pathname === '/api/history') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    handleHistoryRequest(request, response);
    return;
  }

  if (pathname === '/api/warning/stop') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed.', { Allow: 'POST' });
      return;
    }
    proxyEsp32(request, response, pathname);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    return;
  }

  serveStaticFile(request, response, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Poultry monitor dashboard: http://localhost:${PORT}`);
  console.log(`Reading ESP32 data from ${ESP32_URL.origin}`);
  console.log(`Saving sensor readings in SQLite: ${DATABASE_PATH}`);
  console.log(`Backend health check: http://localhost:${PORT}/api/health`);
  console.log('For phone access, use this computer’s Wi-Fi IP on the same network.');
});

function closeDatabase() {
  if (database.isOpen) database.close();
}

process.once('SIGINT', () => {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});
process.once('SIGTERM', () => {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});
