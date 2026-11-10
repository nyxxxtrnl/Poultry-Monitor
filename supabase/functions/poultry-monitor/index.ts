const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
};

const HISTORY_LIMIT = 500;
const MAX_BODY_BYTES = 16 * 1024;
const WARNING_LIMIT = 500;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isReading(value: unknown): value is {
  temperature: number | null;
  humidity: number | null;
  sensorOK: boolean;
  warning?: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reading = value as Record<string, unknown>;
  if (typeof reading.sensorOK !== 'boolean') return false;
  if (reading.warning !== undefined && reading.warning !== null &&
      (typeof reading.warning !== 'string' || reading.warning.length > WARNING_LIMIT)) {
    return false;
  }
  if (!reading.sensorOK) {
    return reading.temperature === null && reading.humidity === null;
  }
  return typeof reading.temperature === 'number' &&
    Number.isFinite(reading.temperature) &&
    reading.temperature >= -40 && reading.temperature <= 80 &&
    typeof reading.humidity === 'number' &&
    Number.isFinite(reading.humidity) &&
    reading.humidity >= 0 && reading.humidity <= 100;
}

async function databaseRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase function database configuration is missing.');
  }

  return await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const route = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
  try {
    if (route === 'ingest' && request.method === 'POST') {
      const expectedToken = Deno.env.get('DEVICE_INGEST_TOKEN');
      if (!expectedToken) {
        console.error('DEVICE_INGEST_TOKEN is not configured.');
        return jsonResponse({ error: 'Device ingestion is not configured.' }, 503);
      }
      if (request.headers.get('authorization') !== `Bearer ${expectedToken}`) {
        return jsonResponse({ error: 'Unauthorized device.' }, 401);
      }

      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Request body is too large.' }, 413);
      }
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Request body is too large.' }, 413);
      }

      let reading: unknown;
      try {
        reading = JSON.parse(body);
      } catch {
        return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
      }
      if (!isReading(reading)) {
        return jsonResponse({ error: 'Invalid sensor reading.' }, 400);
      }

      const response = await databaseRequest('sensor_readings', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          temperature: reading.temperature,
          humidity: reading.humidity,
          sensor_ok: reading.sensorOK,
          warning: typeof reading.warning === 'string' ? reading.warning.trim() || null : null,
        }),
      });
      if (!response.ok) {
        console.error('Could not save an ESP32 sensor reading:', response.status, await response.text());
        return jsonResponse({ error: 'Could not save sensor reading.' }, 502);
      }
      return jsonResponse({ ok: true }, 201);
    }

    if (route === 'status' && request.method === 'GET') {
      const response = await databaseRequest(
        'sensor_readings?select=temperature,humidity,sensor_ok,warning,recorded_at&order=recorded_at.desc&limit=1',
      );
      if (!response.ok) {
        console.error('Could not read the latest sensor reading:', response.status, await response.text());
        return jsonResponse({ error: 'Could not read sensor status.' }, 502);
      }
      const rows = await response.json();
      const latest = rows[0];
      if (!latest) {
        return jsonResponse({
          temperature: null,
          humidity: null,
          sensorOK: false,
          warning: 'Waiting for the first ESP32 reading.',
          recordedAt: null,
        });
      }
      return jsonResponse({
        temperature: latest.temperature,
        humidity: latest.humidity,
        sensorOK: latest.sensor_ok,
        warning: latest.warning,
        recordedAt: latest.recorded_at,
      });
    }

    if (route === 'history' && request.method === 'GET') {
      const response = await databaseRequest(
        `sensor_readings?select=temperature,humidity,recorded_at&sensor_ok=eq.true&order=recorded_at.desc&limit=${HISTORY_LIMIT}`,
      );
      if (!response.ok) {
        console.error('Could not read sensor history:', response.status, await response.text());
        return jsonResponse({ error: 'Could not read sensor history.' }, 502);
      }
      const rows = await response.json();
      return jsonResponse({
        history: rows.map((row: { temperature: number; humidity: number; recorded_at: string }) => ({
          temperature: row.temperature,
          humidity: row.humidity,
          recordedAt: row.recorded_at,
        })),
      });
    }

    if (route === 'warning' || route === 'stop') {
      return jsonResponse({ error: 'Remote alarm control is not available through the public dashboard.' }, 501);
    }
    return jsonResponse({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error('Poultry Monitor API request failed:', error);
    return jsonResponse({ error: 'The sensor API could not complete the request.' }, 500);
  }
});
