# VAU Dashboard

Monitoring dashboard for the VAST Auto Updater (VAU) system. Replaces email notifications with a real-time web interface showing machine status across all customer sites.

## Stack

- **Backend:** Node.js 18+ / Express / SQLite (better-sqlite3, WAL mode, versioned migrations)
- **Frontend:** React (Create React App), Klipboard brand palette, self-hosted Inter
- **Auth:** JWT (HS256, issuer/audience-pinned) for dashboard users; API key for machine status POSTs
- **Observability:** structured JSON logs (pino), request correlation ids, liveness + readiness probes
- **API docs:** OpenAPI 3.1 at `/api/v1/openapi.json`, interactive docs at `/api/v1/docs`

## Quick Start

```bash
# 1. Install dependencies
npm run install-all

# 2. Configure environment
cp .env.example .env
# Set JWT_SECRET (32+ chars) and VAU_API_KEY (16+ chars):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Start the server (dev mode)
npm run dev
```

The dashboard shows only real data reported by VAU installations — machines appear as soon as they POST their first status update.

Dashboard runs at `http://localhost:3000`, API at `http://localhost:3001`.

In development, missing secrets are replaced with ephemeral random values (logged at startup). In **production the server refuses to start** with missing, short, or placeholder secrets.

## Tests

```bash
npm test
```

Runs the API integration suite (Node's built-in test runner + supertest) against an in-memory database — no setup required.

## Production Deployment

```bash
npm run build   # build the React frontend
npm start       # serve the app + API on one port (default 3001)
```

Deploy to Azure App Service, IIS with iisnode, or any Node.js host. When running behind a reverse proxy, set `TRUST_PROXY=true` so client IPs and rate limiting are correct. The server shuts down gracefully on `SIGTERM`/`SIGINT` (drains connections, closes the database).

**Probes:** liveness `GET /api/v1/health`, readiness `GET /api/v1/health/ready` (verifies database connectivity, returns 503 when unavailable).

## API Reference

Canonical base path: **`/api/v1`**. The unversioned `/api` prefix is a permanent compatibility alias — existing VAU installations and the bundled dashboard keep working unchanged.

Full, always-current reference: **`/api/v1/docs`** (Swagger UI) or **`/api/v1/openapi.json`**.

### Error format

All errors are JSON and include a stable machine-readable code and the request correlation id (also echoed in the `x-request-id` response header):

```json
{ "error": "Validation failed", "code": "BAD_REQUEST", "requestId": "…", "details": [ { "path": "eventType", "message": "…" } ] }
```

### Machine Status Endpoint

VAU installations POST status updates here. All writes (customer/site/machine upsert + event log) are applied in a single transaction; payloads are validated and size-limited.

```
POST /api/v1/status
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

Response: `{ "success": true, "machineId": 42 }`

`machineKey` should be a stable unique identifier per machine (e.g., MAC address or machine GUID).

### Dashboard API (JWT auth required)

| Endpoint | Description |
|---|---|
| `POST /api/v1/auth/login` | Login, returns JWT (rate-limited: 10 attempts / 15 min per IP) |
| `GET /api/v1/auth/me` | Validate token |
| `POST /api/v1/auth/change-password` | Change password (min 8 chars) |
| `GET /api/v1/machines` | Machines (name, IP, version, status, error reason) — errors listed first |
| `GET /api/v1/machines/summary` | Fleet counts (total, online, offline, errors, customers, sites) |
| `GET /api/v1/machines/:id/history` | Paginated status log (`?limit=100&offset=0`, max 500) |
| `GET /api/v1/health` | Liveness probe |
| `GET /api/v1/health/ready` | Readiness probe (checks database) |

Machine `status` semantics: `error` (last update failed) takes precedence, then `online`/`offline` by heartbeat recency (`OFFLINE_THRESHOLD_MINUTES`), `unknown` when no heartbeat was ever received.

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
        Await client.PostAsync("https://your-dashboard-url/api/v1/status", content)
    End Using
End Function
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 3001 |
| `JWT_SECRET` | Secret for JWT signing (32+ chars) | **required in production** |
| `JWT_EXPIRES_IN` | JWT lifetime | 24h |
| `VAU_API_KEY` | API key for machine POSTs (16+ chars) | **required in production** |
| `DEFAULT_ADMIN_USER` | Initial admin username (first run only) | admin |
| `DEFAULT_ADMIN_PASS` | Initial admin password (first run only) | changeme |
| `OFFLINE_THRESHOLD_MINUTES` | Minutes before marking offline | 30 |
| `DB_PATH` | SQLite database file | ./vau-dashboard.db |
| `LOG_LEVEL` | pino log level | info |
| `TRUST_PROXY` | Trust reverse-proxy headers (`true` = one hop) | false |
| `CORS_ORIGINS` | Comma-separated cross-origin allowlist | (same-origin only) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Global API rate limit per IP | 60000 / 600 |
| `LOGIN_RATE_LIMIT_WINDOW_MS` / `LOGIN_RATE_LIMIT_MAX` | Login rate limit per IP | 900000 / 10 |
| `BCRYPT_ROUNDS` | bcrypt cost factor | 10 |

## Security Notes

- Production startup **fails fast** on placeholder/missing/short secrets.
- API key comparison is constant-time; login timing is equalized to prevent user enumeration.
- JWTs are pinned to HS256 with issuer/audience claims and unique `jti`.
- Helmet CSP enabled, JSON bodies limited to 256 KB, `Cache-Control: no-store` on all API responses.
- Structured logs redact `Authorization`, `x-api-key`, and `Cookie` headers.
