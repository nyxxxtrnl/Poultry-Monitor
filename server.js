'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pipeline } = require('node:stream');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const ESP32_URL = (process.env.ESP32_URL || 'http://192.168.4.1').replace(/\/+$/, '');
const ROOT = __dirname;
const DATABASE_PATH = process.env.SQLITE_PATH || path.join(ROOT, '.data', 'poultry-monitor.sqlite');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

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
  SELECT temperature, humidity, recorded_at
  FROM sensor_readings
  ORDER BY id DESC
  LIMIT 500
`);

function sendText(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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

function saveStatusReading(body) {
  let status;
  try {
    status = JSON.parse(body);
  } catch (error) {
    console.error(`ESP32 status response was not valid JSON: ${error.message}`);
    return;
  }

  if (!status || typeof status !== 'object' ||
      typeof status.temperature !== 'number' || !Number.isFinite(status.temperature) ||
      typeof status.humidity !== 'number' || !Number.isFinite(status.humidity)) {
    console.error('ESP32 status response has invalid temperature or humidity.');
    return;
  }

  const warning = typeof status.warning === 'string'
    ? status.warning
    : status.warning === true
      ? 'Hardware warning'
      : null;

  try {
    insertReading.run(
      status.temperature,
      status.humidity,
      status.sensorOK === true ? 1 : 0,
      warning,
      new Date().toISOString(),
    );
  } catch (error) {
    console.error(`Could not save ESP32 reading to SQLite: ${error.message}`);
  }
}

function handleStatusRequest(request, response) {
  const upstreamUrl = new URL('/api/status', `${ESP32_URL}/`);
  const upstreamRequest = http.get(upstreamUrl, {
    headers: { Accept: 'application/json' },
    timeout: 5000,
  }, (upstreamResponse) => {
    const chunks = [];
    let responseSize = 0;
    upstreamResponse.on('data', (chunk) => {
      responseSize += chunk.length;
      if (responseSize > 1024 * 1024) {
        upstreamResponse.destroy(new Error('ESP32 status response exceeded 1 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    upstreamResponse.on('end', () => {
      const body = Buffer.concat(chunks);
      if (upstreamResponse.statusCode >= 200 && upstreamResponse.statusCode < 300 &&
          request.method === 'GET') {
        saveStatusReading(body.toString('utf8'));
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
        sendText(response, 502, 'The ESP32 status response could not be read.');
      } else {
        response.destroy(error);
      }
    });
  });

  upstreamRequest.on('timeout', () => {
    upstreamRequest.destroy(new Error('ESP32 request timed out.'));
  });
  upstreamRequest.on('error', (error) => {
    console.error(`ESP32 status request failed: ${error.message}`);
    if (!response.headersSent) {
      sendText(response, 502, 'Could not connect to the ESP32. Check the Wi-Fi network.');
    } else {
      response.destroy(error);
    }
  });
  request.on('aborted', () => upstreamRequest.destroy());
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
  request.pipe(upstreamRequest);
}

function handleHistoryRequest(request, response) {
  try {
    const history = selectHistory.all().map((row) => ({
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

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (_) {
    sendText(response, 400, 'Invalid request path.');
    return;
  }

  if (pathname === '/api/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed.');
      return;
    }
    handleStatusRequest(request, response);
    return;
  }

  if (pathname === '/api/history') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed.');
      return;
    }
    handleHistoryRequest(request, response);
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
  console.log(`Reading ESP32 data from ${ESP32_URL}`);
  console.log(`Saving sensor readings in SQLite: ${DATABASE_PATH}`);
  console.log('For phone access, use this computer’s Wi-Fi IP on the same network.');
});
