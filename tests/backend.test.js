'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('backend APIs validate status, persist history, and protect static files', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poultry-monitor-test-'));
  let statusBody = '{"temperature": 28.5, "humidity": 67.2, "sensorOK": true}';
  let stopCalled = false;
  const mockRequests = [];
  const esp32 = http.createServer((req, res) => {
    mockRequests.push(`${req.method} ${req.url}`);
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(statusBody);
      return;
    }
    if (req.url === '/api/warning/stop' && req.method === 'POST') {
      stopCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"stopped":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const esp32Port = await listen(esp32);
  const portProbe = http.createServer();
  const port = await listen(portProbe);
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ESP32_URL: `http://127.0.0.1:${esp32Port}`,
      SQLITE_PATH: path.join(tempDir, 'backend.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendLogs = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { backendLogs += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { backendLogs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await new Promise((resolve) => esp32.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let health;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) assert.fail(`Backend exited with code ${child.exitCode}`);
    try {
      health = await request(port, '/api/health');
      break;
    } catch (error) {
      if (attempt === 49) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok', database: 'ok' });

  statusBody = '{"temperature": null, "humidity": null, "sensorOK": false}';
  const unavailableSensor = await request(port, '/api/status');
  assert.equal(unavailableSensor.status, 200);
  assert.deepEqual(JSON.parse(unavailableSensor.body), {
    temperature: null,
    humidity: null,
    sensorOK: false,
  });
  assert.deepEqual(JSON.parse((await request(port, '/api/history')).body), { history: [] });

  statusBody = '{"temperature": "hot", "humidity": 67.2}';
  const invalidStatus = await request(port, '/api/status');
  assert.equal(invalidStatus.status, 502);
  assert.deepEqual(
    JSON.parse(invalidStatus.body),
    { error: 'The ESP32 returned invalid sensor data.' },
    `${backendLogs}\nMock requests: ${mockRequests.join(', ')}`,
  );
  assert.deepEqual(JSON.parse((await request(port, '/api/history')).body), { history: [] });

  statusBody = '{"temperature": 28.5, "humidity": 67.2, "sensorOK": true, "warning": null}';
  const status = await request(port, '/api/status');
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).temperature, 28.5);

  const history = await request(port, '/api/history');
  const record = JSON.parse(history.body).history[0];
  assert.equal(record.temperature, 28.5);
  assert.equal(record.humidity, 67.2);
  assert.equal(record.sensorOK, true);
  assert.equal(record.warning, null);
  assert.ok(Number.isFinite(Date.parse(record.recordedAt)));
  assert.equal(record.elapsedMs, null);

  const head = await request(port, '/api/history', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request(port, '/api/history', { method: 'POST' })).status, 405);

  const stop = await request(port, '/api/warning/stop', { method: 'POST' });
  assert.equal(stop.status, 200);
  assert.equal(stopCalled, true);

  assert.equal((await request(port, '/')).status, 200);
  const manifestResponse = await request(port, '/manifest.webmanifest');
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers['content-type'], /application\/manifest\+json/);
  assert.equal(JSON.parse(manifestResponse.body).short_name, 'Coop Care');
  const workerResponse = await request(port, '/service-worker.js');
  assert.equal(workerResponse.status, 200);
  assert.match(workerResponse.headers['content-type'], /text\/javascript/);
  const cloudConfigResponse = await request(port, '/cloud-config.js');
  assert.equal(cloudConfigResponse.status, 200);
  assert.match(cloudConfigResponse.headers['content-type'], /text\/javascript/);
  for (const iconName of ['app-icon-192.png', 'app-icon-512.png']) {
    const iconResponse = await request(port, `/${iconName}`);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers['content-type'], /image\/png/);
  }
  assert.equal((await request(port, '/.gitignore')).status, 404);
  assert.equal((await request(port, '/README.md')).status, 404);
  assert.equal((await request(port, '/.data/poultry-monitor.sqlite')).status, 404);
});
