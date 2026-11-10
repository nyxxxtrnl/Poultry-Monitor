# Poultry House Monitor

Responsive HTML, CSS, JavaScript, and SQLite dashboard for the ESP32-S3 poultry
temperature and humidity monitor. It uses a dark charcoal/navy theme with cyan
accents.

## Features

- Live temperature, relative humidity, and ESP32/DHT22 status
- Automatic refresh every three seconds and manual refresh
- Persistent sensor history stored in a local SQLite SQL database
- History list and a temperature chart with local received-at timestamps
- Desktop sidebar and mobile bottom navigation
- Saved ESP32 base address
- Live status for the status and history API endpoints
- Visible network and API errors, plus a stale-reading warning after 10 seconds

## Run on this computer

Install Node.js 24 or newer, then open PowerShell in this folder and run:

```powershell
node server.js
```

Open [http://localhost:8080](http://localhost:8080) in a browser. The Node.js
server reads live status from `http://192.168.4.1/api/status` and saves each
valid reading into `.data/poultry-monitor.sqlite`. The dashboard's
`/api/history` endpoint reads saved records from SQLite. The database and its
folder are created automatically and excluded from Git. The ESP32 target can
be changed with the `ESP32_URL` environment variable.

## Open on a phone

Connect both the computer running the server and the phone to the
`PoultryMonitor` Wi-Fi network. Find the computer's Wi-Fi IPv4 address with
`ipconfig`, then open `http://<computer-ip>:8080` on the phone (for example,
`http://192.168.4.2:8080`). If Windows Firewall prompts, allow Node.js on the
private network. Stop the local server with Ctrl+C when finished.

Alternatively, serve these files from the ESP32 itself and open
`http://192.168.4.1/`; same-origin API requests then work without the Node.js
proxy. The current workspace does not include ESP32 firmware or a filesystem
upload setup, so static-file hosting on the ESP32 must be added separately.

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
the dashboard UI on a phone.

**GitHub Pages does not make the current ESP32 readings public.** Pages is
served over HTTPS, and mobile browsers block it from fetching the ESP32's local
HTTP address. Live readings on the public page require an internet-connected
ESP32 firmware and a public HTTPS API/database. Do not put database service-role
keys, Wi-Fi passwords, or other private credentials in this public repository.
The static GitHub Pages site cannot reach this computer's SQLite file. Use the
local Node.js server or serve the dashboard directly from the ESP32 to see live
sensor data and local SQL history.

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

The ESP32 only needs to provide `GET /api/status`; each successful status
response is saved locally in SQLite. The dashboard server supplies
`GET /api/history` from its SQL database, so ESP32 firmware does not need a
history endpoint for the local dashboard.

`recordedAt` is the computer/server's receipt time. If an older ESP32 history
record provides `elapsedMs` instead, the dashboard displays it as device
uptime—not as a calendar date.
The dashboard records when it last received a valid status response. A reading
is marked stale if no newer status response arrives for 10 seconds. In the
Settings page, Connection diagnostics shows the latest result for each API
endpoint and the most recent connection error.
