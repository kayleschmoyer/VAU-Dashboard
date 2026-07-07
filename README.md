# VAU Dashboard

Monitoring dashboard for the VAST Auto Updater (VAU) system. Replaces email notifications with a real-time web interface showing machine status across all customer sites.

## Stack

- **Backend:** Node.js + Express + SQLite (via better-sqlite3)
- **Frontend:** React (Create React App)
- **Auth:** JWT for dashboard users, API key for machine status POSTs

## Quick Start

```bash
# 1. Install dependencies
npm run install-all

# 2. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET and VAU_API_KEY to random strings

# 3. Start the server (dev mode)
npm run dev

# 4. (Optional) Seed sample data for testing
npm run seed
```

Dashboard runs at `http://localhost:3000`, API at `http://localhost:3001`.

Default login: `admin` / `changeme` (change immediately via .env or the app).

## Production Deployment

```bash
# Build the React frontend
npm run build

# Start production server
npm start
```

The server serves the built React app and the API on a single port (default 3001). Deploy to Azure App Service, IIS with iisnode, or any Node.js host.

## API Reference

### Machine Status Endpoint

VAU installations POST status updates here.

```
POST /api/status
Header: x-api-key: <your-api-key>
Content-Type: application/json

{
  "customer": "Acme Restaurant Group",
  "site": "Downtown Location",
  "hostname": "POS-REGISTER-01",
  "machineKey": "unique-machine-identifier",
  "eventType": "heartbeat",          // heartbeat | update_start | update_success | update_failure
  "version": "4.2.1",                // current VAST version
  "targetVersion": "4.3.0",          // version being updated to (optional)
  "result": "update_success",        // (optional)
  "message": "Updated successfully", // (optional)
  "osVersion": "Windows 10 Pro"      // (optional)
}
```

`machineKey` should be a stable unique identifier per machine (e.g., MAC address or machine GUID).

### Dashboard API (JWT auth required)

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | Login, returns JWT token |
| `GET /api/auth/me` | Validate token |
| `GET /api/machines` | All machines grouped by customer/site |
| `GET /api/machines/summary` | Quick counts (total, online, offline, errors) |
| `GET /api/machines/:id/history` | Status log for a single machine |

## VB.NET Integration Example

Add this to the VAU app to POST heartbeats:

```vb
Imports System.Net.Http
Imports System.Text

Private Async Function SendHeartbeat() As Task
    Using client As New HttpClient()
        client.DefaultRequestHeaders.Add("x-api-key", "your-api-key")
        Dim json = $"{{""customer"":""{customerName}"",""site"":""{siteName}"",""hostname"":""{Environment.MachineName}"",""machineKey"":""{machineGuid}"",""eventType"":""heartbeat"",""version"":""{currentVersion}""}}"
        Dim content As New StringContent(json, Encoding.UTF8, "application/json")
        Await client.PostAsync("https://your-dashboard-url/api/status", content)
    End Using
End Function
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 3001 |
| `JWT_SECRET` | Secret for JWT signing | (required) |
| `VAU_API_KEY` | API key for machine POSTs | (required) |
| `DEFAULT_ADMIN_USER` | Initial admin username | admin |
| `DEFAULT_ADMIN_PASS` | Initial admin password | changeme |
| `OFFLINE_THRESHOLD_MINUTES` | Minutes before marking offline | 30 |
