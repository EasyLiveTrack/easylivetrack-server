# EasyLiveTrack Server

A lightweight, self-hosted real-time GPS tracking server inspired by **Garmin LiveTrack**, compatible with the universal **Traccar OsmAnd** protocol (`GET /?id=...&lat=...&lon=...`). Designed for Wear OS standalone smartwatches (LTE), Android smartphones, and IoT GPS trackers.

Built with **Node.js 24**, built-in SQLite (`node:sqlite`), **Leaflet.js** (OpenStreetMap, no third-party API keys required), **Server-Sent Events (SSE)**, and **Caddy** with automated Let's Encrypt HTTPS and HTTP/3 (QUIC).

---

## 🌟 Key Features

- **Traccar OsmAnd Protocol Compatible**: Natively ingests standard GPS fixes (`id`, `lat`, `lon`, `timestamp`, `speed`, `altitude`, `bearing`, `batt`). Compatible with Traccar clients, OsmAnd, GPSLogger, and custom Android/Wear OS apps.
- **Real-Time Web Viewer**: Follow live activities with smooth polyline updates, speed, altitude, elapsed time, and battery indicators via Server-Sent Events (SSE).
- **100% Free Map Layers**: Integrated map switcher between OpenStreetMap Standard, OpenTopoMap (outdoor/contours), and Esri Satellite Imagery with zero paid API keys.
- **Administrator Dashboard (`/admin`)**:
  - **Email Whitelist**: Restrict registration and GPS ingestion only to pre-approved Google/email accounts to eliminate spam.
  - **Device & API Key Management**: View connected devices, revoke keys, and generate 6-digit numeric pairing codes.
  - **GPX 1.1 Trace Export**: Download standard `.gpx` files ready to upload to **Strava**, **Garmin Connect**, or Komoot.
- **Anti-Spam & DoS Protection**: Built-in rate limiting on both API calls and ingestion endpoints.
- **Production-Ready Docker & Caddy**: Includes automatic SSL provisioning, HTTP/3 QUIC support, and zero-downtime multi-service coexistence on a single VPS.

---

## 🏗️ Architecture

```
  +-------------------------------------+
  |   Wear OS Watch / Android Phone     |
  |   - GPS Fused Location Provider     |
  |   - Offline Queue & LTE Recovery    |
  |   - Traccar OsmAnd HTTP Client      |
  +------------------+------------------+
                     |
                     | HTTPS GET / POST (with API Key)
                     v
  +-------------------------------------+
  |          Caddy Reverse Proxy        |
  |   - Automatic HTTPS (Let's Encrypt) |
  |   - HTTP/3 (QUIC) mobile streaming  |
  +------------------+------------------+
                     |
                     v
  +-------------------------------------+
  |        EasyLiveTrack Server         |
  |   - Node.js 24 Alpine (:5055)       |
  |   - Built-in SQLite Storage         |
  |   - Server-Sent Events (SSE) Hub    |
  |   - Admin Security & Whitelist      |
  +------------------+------------------+
                     |
                     v
  +-------------------------------------+
  |          Web Live Viewer            |
  |   - Leaflet.js (OSM / Topo / Sat)   |
  |   - Live HUD: Speed, Dist, Battery  |
  |   - Read-only Share Token Access    |
  +-------------------------------------+
```

---

## 📁 Project Structure

```
easylivetrack-server/
├── .github/workflows/ci.yml    # CI pipeline (Automated testing & Docker build verification)
├── Dockerfile                  # Production container definition (Node 24 Alpine)
├── docker-compose.yml          # Container orchestration (Node app + Caddy proxy)
├── Caddyfile                   # Reverse proxy configuration with auto-SSL & HTTP/3
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── .dockerignore               # Docker build ignore rules
├── package.json                # Project dependencies and npm scripts
├── README.md                   # Documentation
├── public/                     # Static frontend web viewer and assets
│   ├── admin.html              # Administrator dashboard
│   ├── index.html              # Main live track map
│   ├── live.html               # Dedicated live session viewer
│   ├── css/style.css           # Responsive dark theme styling
│   ├── js/admin.js             # Admin UI controller
│   ├── js/viewer.js            # Leaflet map and SSE real-time controller
│   └── vendor/leaflet/         # Bundled offline Leaflet library
├── src/                        # Backend application source code
│   ├── index.js                # Server entry point & startup listener
│   ├── app.js                  # Express application setup & middleware assembly
│   ├── config.js               # Centralized environment configuration
│   ├── db/
│   │   ├── database.js         # SQLite connection & schema migration
│   │   └── index.js            # Data access queries & prepared statements
│   ├── middleware/
│   │   ├── auth.js             # User API key and Admin session authentication
│   │   └── rateLimiter.js      # Anti-spam API and GPS ingestion rate limiters
│   ├── routes/
│   │   ├── ingestion.js        # Traccar OsmAnd GPS ingestion endpoint
│   │   ├── auth.js             # Google OAuth & device pairing routes
│   │   ├── admin.js            # Admin management APIs (whitelist, devices, keys)
│   │   ├── sessions.js         # Live session details, SSE stream & GPX export
│   │   └── views.js            # HTML page routes
│   └── services/
│       ├── gpx.js              # GPX 1.1 trace generator for Strava/Garmin
│       └── sse.js              # Server-Sent Events subscriber manager
└── tests/
    └── e2e.test.js             # End-to-end integration test suite
```

---

## 🚀 Quick Start with Docker & Caddy (Recommended for Production)

### 1. Clone & Configure Environment

```bash
git clone https://github.com/EasyLiveTrack/easylivetrack-server.git
cd easylivetrack-server

# Copy environment template
cp .env.example .env
```

Edit `.env` to configure your domain and administrator credentials:

```env
DOMAIN_NAME=gps.yourdomain.com
ADMIN_EMAIL=your-email@gmail.com
ADMIN_PASSWORD=YourSuperSecurePassword2026!
REGISTRATION_MODE=whitelist
```

### 2. Launch Containers

```bash
docker compose up -d --build
```

Caddy will automatically request Let's Encrypt SSL certificates for `gps.yourdomain.com` and open ports `80`, `443`, and `443/udp` (HTTP/3).

- **Live Tracking Map**: `https://gps.yourdomain.com`
- **Admin Dashboard**: `https://gps.yourdomain.com/admin`

---

## 🌐 Running Other Services on the Same VPS

EasyLiveTrack's Docker setup uses a named external bridge network called `vps-shared-network`. This allows Caddy to act as the central reverse proxy for other containers on your VPS without port conflicts.

1. In any other project's `docker-compose.yml`, join `vps-shared-network`:
   ```yaml
   networks:
     default:
       name: vps-shared-network
       external: true
   ```
2. Add your other subdomain to `Caddyfile`:
   ```caddy
   other-service.yourdomain.com {
       reverse_proxy container-name:8080
   }
   ```
3. Reload Caddy without downtime:
   ```bash
   docker exec -w /etc/caddy easylivetrack-caddy caddy reload
   ```

---

## 💻 Local Development (without Docker)

**Requirements**: Node.js >= 22.5.0 (Node 24 recommended).

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite
npm test

# 3. Start development server
npm start
```

Access locally:
- Web App: [http://localhost:5055](http://localhost:5055)
- Admin Panel: [http://localhost:5055/admin](http://localhost:5055/admin) (Default password: `admin12345`)

---

## 📡 API Reference & Ingestion Protocol

### 1. Ingest GPS Point (Traccar OsmAnd Standard)

- **Method**: `GET /` or `POST /`
- **Authentication**: `?key=<API_KEY>` or `Authorization: Bearer <API_KEY>`

**Query / Body Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` / `deviceid` | string | Yes | Unique session or device identifier (e.g. `live-9a2f1c`) |
| `lat` | float | Yes | Latitude (-90.0 to 90.0) |
| `lon` | float | Yes | Longitude (-180.0 to 180.0) |
| `timestamp` / `time` | number/string | No | Unix timestamp in seconds or ms, or ISO 8601 string |
| `speed` | float | No | Speed in knots (automatically converted to km/h) |
| `altitude` | float | No | Altitude above sea level in meters |
| `bearing` | float | No | Heading in degrees (0 - 360) |
| `batt` / `battery` | float | No | Device battery percentage (0 - 100) |
| `token` | string | No | Optional private view token for the session |

**Example HTTP Request**:
```http
GET /?id=live-run-1&lat=45.4642&lon=9.1900&altitude=120&speed=6.2&batt=85&key=gbeacon_live_xxxx HTTP/1.1
Host: gps.yourdomain.com
```

### 2. Export Track as GPX 1.1

- **Endpoint**: `GET /api/sessions/:sessionId/export.gpx`
- **Output**: Standard GPX 1.1 XML compatible with Strava, Garmin Connect, and GIS applications.

---

## 🛡️ Security & Whitelist

To prevent unauthorized usage or spam:
1. Log in to `https://gps.yourdomain.com/admin`.
2. Under the **Email Whitelist** tab, add the email addresses of authorized athletes/users.
3. When users sign in via Google Sign-In or pairing codes, the server verifies their email against the whitelist. Unlisted emails receive an immediate `403 Forbidden` response.

---

## 📄 License

MIT License. Free for personal and commercial use.
