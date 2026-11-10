# Poultry House Monitor

Responsive HTML, CSS, JavaScript, and SQLite dashboard for the ESP32-S3 poultry
temperature and humidity monitor. It uses a distinctive teal-and-sea-glass
palette with coral sensor accents, and offers dark and light themes with the
selected theme saved in the browser.

## Features

- Live temperature, relative humidity, and ESP32/DHT22 status
- Direct live readings from the ESP32-S3 over Bluetooth Low Energy
- Automatic refresh every three seconds and manual refresh
- Persistent sensor history stored in a local SQLite SQL database
- History list and a temperature chart with local received-at timestamps
- Desktop sidebar and mobile bottom navigation
- Installable home-screen app with an offline dashboard shell
- Saved ESP32 base address
- Live status for the status and history API endpoints
- Visible network and API errors, plus a stale-reading warning after 10 seconds

## Run on this computer

Install Node.js 24 or newer, then open PowerShell in this folder and run:

```powershell
npm start
```

Open [http://localhost:8080](http://localhost:8080) in a browser. The Node.js
dashboard proxies `/api/status` to `http://192.168.4.1/api/status` and saves
each valid reading into `.data/poultry-monitor.sqlite`. The browser then reads
`/api/history` from that same Node.js server, which returns the saved SQL
records. The database and its folder are created automatically and excluded
from Git. Keep the dashboard open and the server running to collect readings.

Configure the backend before starting it with optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Network interface used by the dashboard server |
| `PORT` | `8080` | HTTP port, from 1 to 65535 |
| `ESP32_URL` | `http://192.168.4.1` | ESP32 HTTP(S) base URL |
| `SQLITE_PATH` | `.data/poultry-monitor.sqlite` | SQLite database file location |

For example, in PowerShell:

```powershell
$env:ESP32_URL = "http://192.168.4.1"
$env:SQLITE_PATH = ".data/poultry-monitor.sqlite"
npm start
```

Check that the server and its SQLite database are available at
`http://localhost:8080/api/health`. Run the backend integration tests with
`npm test`. The server only publishes the dashboard, install manifest, service
worker, cloud API configuration, and app icons; other files in the project
directory are not served.

## Install the app on a phone or computer

Open the site over HTTPS on GitHub Pages or use `http://localhost:8080` for the
local server, then open **Settings → Install app**. Chrome and Edge show the
native install prompt when available; the browser menu also has an **Install
app** option. On iPhone or iPad, open the site in Safari, tap **Share**, then
choose **Add to Home Screen**. The first visit needs an internet connection to
download the app shell. Its dashboard files can then open offline. Bluetooth
live readings need the ESP32 and Android Chrome; local SQL history still needs
the ESP32 and local server.

The public GitHub Pages copy can show live readings through Bluetooth or the
public cloud API configured below. Use Android Chrome over HTTPS for Bluetooth.

## Open on a phone

Connect both the computer running the server and the phone to the
`PoultryMonitor` Wi-Fi network. Find the computer's Wi-Fi IPv4 address with
`ipconfig`, then open `http://<computer-ip>:8080` on the phone (for example,
`http://192.168.4.2:8080`). If Windows Firewall prompts, allow Node.js on the
private network. Stop the local server with Ctrl+C when finished.

Alternatively, the ESP32-S3 sketch in `firmware/sketch_oct26a/` serves the
dashboard and its assets directly from flash. Copy that folder to
`C:\Arduino\sketch_oct26a`, copy `wifi_secrets.example.h` to
`wifi_secrets.h`, then set the router Wi-Fi name, router password, and device
token in the local secrets file. Open `sketch_oct26a.ino` in Arduino IDE,
choose the same ESP32-S3 board and port used for the monitor, then click
**Upload**. The access point is named `PoultryMonitor` and its configured
password is `PoultryMonitor123`. After upload, connect the phone to that
network and open `http://192.168.4.1/`; the page uses the ESP32's same-origin
live API and does not require the Node.js server. Do not commit or share the
local `wifi_secrets.h` file.

SQLite history belongs to the computer running `node server.js`. It is not
shared with a different computer or saved on GitHub Pages. While the ESP32 is
connected, leave the dashboard server running so successful status checks can
be added to local history.

## Publish the dashboard on GitHub Pages

Pushing the `main` branch runs the GitHub Actions workflow and publishes the
static dashboard at
`https://nyxxxtrnl.github.io/Poultry-Monitor/`. The repository must allow GitHub
Actions to deploy Pages (Repository **Settings → Pages → Build and deployment →
Source: GitHub Actions**). After the workflow succeeds, this public link opens
the installable dashboard UI on a phone.

GitHub Pages is static HTTPS hosting; it cannot reach the ESP32's local HTTP
address or this computer's SQLite database. The Supabase integration in
`supabase/` provides a public HTTPS read API and a token-protected sensor
ingest endpoint. The dashboard is configured for the Supabase project URL
provided for this setup. To activate the API:

1. In that Supabase project's SQL Editor, run the SQL in
   `supabase/migrations/20261110000000_create_sensor_readings.sql`, or link
   the project and run `supabase db push`.
2. Deploy the Edge Function with the Supabase CLI:

   ```powershell
   supabase link --project-ref nwdnkasjrucrpysbjbcc
   supabase functions deploy poultry-monitor
   ```

3. Generate a 32-byte device token locally in PowerShell:

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
   ```

   Configure the token as the Supabase function secret named
   `DEVICE_INGEST_TOKEN` (Supabase Dashboard → Edge Functions → Secrets).
   Keep the token private; do not paste it into chat or commit it.
4. The public API URL is already set in `cloud-config.js` and the local ESP32
   secrets template. It is public configuration, not a secret.
5. Copy `firmware/sketch_oct26a/wifi_secrets.example.h` to
   `firmware/sketch_oct26a/wifi_secrets.h` (or to the local sketch folder) and
   set the router Wi-Fi name and password, plus `DEVICE_INGEST_TOKEN` to the
   same token configured in Supabase. Do not commit or share this private
   file. The firmware keeps the `PoultryMonitor` access point active while
   connecting to the router to upload sensor readings every 10 seconds over
   verified HTTPS.
6. Compile and upload the sketch to the ESP32-S3. Push dashboard changes to
   `main` and wait for the Pages deployment to succeed.

The GitHub Pages dashboard reads the latest public status and up to 500 public
history records from the Edge Function. Only sensor measurements, warning
state, and timestamps are exposed; the database service-role key stays on
Supabase. The phone needs its own internet connection to open GitHub Pages and
the public API. Connecting to the ESP32 access point alone does not provide
internet to the phone; the local dashboard at `http://192.168.4.1/` continues
to work on that Wi-Fi without cloud access. Remote alarm control is not
available from the public cloud dashboard.

## Live readings over Bluetooth

The ESP32-S3 firmware also advertises a Bluetooth Low Energy (BLE) service.
On an Android phone, open the GitHub Pages dashboard in Chrome over HTTPS, tap
**Connect ESP32 via Bluetooth**, and choose **PoultryMonitor**. Chrome reads the
live sensor status directly from the ESP32 every three seconds. The phone can
keep mobile data enabled while its Wi-Fi and hotspot are off; Bluetooth mode
does not require the phone to join an ESP32 or router Wi-Fi network.

Bluetooth mode provides live readings only. It does not upload to Supabase or
save cloud history while the ESP32 has no internet connection. If the page was
not installed or cached already, mobile data is needed to load GitHub Pages.
Use Android Chrome over HTTPS; the browser-hosted Bluetooth connection is not
available from the ESP32's plain-HTTP dashboard or Safari on iPhone.

Until the migration and Edge Function are deployed and the device token and
router Wi-Fi settings are configured, public cloud readings will not be
available. Bluetooth live readings do not depend on those cloud settings. Do not
put database service-role keys, router Wi-Fi passwords, or device tokens in this
public repository.

## API format

`GET /api/status`:

```json
{
  "temperature": 28.5,
  "humidity": 67.2,
  "sensorOK": true,
  "warning": null
}
```

When `sensorOK` is `false`, the ESP32 may return `null` for both measurements;
the dashboard then reports the sensor warning without presenting invalid
readings.

The optional `warning` field mirrors an alert raised by the hardware. Set it
to a human-readable string to show that warning in the dashboard, or to `true`
to show a generic hardware warning. Use `null`, `false`, or omit the field when
there is no active warning. A false `sensorOK` value also raises a dashboard
warning even if `warning` is omitted. When a new warning arrives, supported
mobile browsers vibrate for up to 10 seconds. The dashboard needs to remain
open and connected to receive the warning.

The dashboard's **Stop hardware alarm** button sends
`POST /api/warning/stop`. The ESP32 firmware must implement this endpoint to
silence/acknowledge its active alarm while continuing to report the warning in
`GET /api/status`; the warning should remain visible in the dashboard until
the hardware condition clears. The local Node.js proxy forwards this POST to
the ESP32. Without firmware support, the button reports that the command
failed rather than pretending the hardware alarm was stopped.

`GET /api/health` verifies that the backend can query its SQLite database:

```json
{
  "status": "ok",
  "database": "ok"
}
```

`GET /api/history` (dashboard server reads its local SQLite database):

```json
{
  "history": [
    {
      "temperature": 28.5,
      "humidity": 67.2,
      "recordedAt": "2026-11-10T12:00:00.000Z",
      "elapsedMs": null
    }
  ]
}
```

The Node.js dashboard only requires ESP32 `GET /api/status`; successful
readings are saved locally in SQLite, and the Node.js server supplies its own
`GET /api/history`. When the dashboard is served directly from the ESP32, the
firmware also supplies `GET /api/history` in the same `{ "history": [...] }`
shape; those device records use `elapsedMs` to show uptime rather than a
calendar date.

`recordedAt` is the computer/server's receipt time. If an older ESP32 history
record provides `elapsedMs` instead, the dashboard displays it as device
uptime—not as a calendar date.
The dashboard records when it last received a valid status response. A reading
is marked stale if no newer status response arrives for 10 seconds. In the
Settings page, Connection diagnostics shows the latest result for each API
endpoint and the most recent connection error.
