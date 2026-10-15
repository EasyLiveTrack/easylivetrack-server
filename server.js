const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5055;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Initialize Admin credentials and Whitelist defaults from environment
db.initAdminDefaults(
  process.env.ADMIN_EMAIL,
  process.env.ADMIN_PASSWORD,
  process.env.REGISTRATION_MODE
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP address, please try again later.' }
});
app.use('/api/', apiLimiter);

const ingestLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'GPS ingestion rate limit exceeded (max 5 points/sec)' }
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const sseClients = new Map();

/**
 * Extracts API key for devices/users.
 */
function extractApiKey(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  if (req.query.key) return String(req.query.key).trim();
  if (req.query.api_key) return String(req.query.api_key).trim();
  if (req.body && req.body.key) return String(req.body.key).trim();
  if (req.body && req.body.api_key) return String(req.body.api_key).trim();
  return null;
}

/**
 * Extracts Admin session token from cookies or Authorization header.
 */
function extractAdminToken(req) {
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='));
    if (match) return match.split('=')[1].trim();
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer adm_')) {
    return authHeader.substring(7).trim();
  }
  return req.headers['x-admin-token'] || null;
}

function requireAdminAuth(req, res, next) {
  const token = extractAdminToken(req);
  if (!token || !db.validateAdminSession(token)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Administrator authentication required. Please log in at /admin'
    });
  }
  req.adminToken = token;
  next();
}

function requireAuth(req, res, next) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API Key. Include Bearer token or ?key=...'
    });
  }

  const auth = db.getUserByApiKey(apiKey);
  if (!auth) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or revoked API Key.'
    });
  }

  req.auth = auth;
  next();
}

/**
 * Handle incoming location points in standard Traccar OsmAnd protocol format.
 */
function handleTraccarPoint(req, res) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).send('Unauthorized: Missing API Key (pass via Authorization: Bearer <key> or ?key=<key>)');
  }

  const auth = db.getUserByApiKey(apiKey);
  if (!auth) {
    return res.status(401).send('Unauthorized: Invalid API Key');
  }

  const data = { ...req.query, ...req.body };
  const sessionId = data.id || data.deviceid;

  if (!sessionId) {
    return res.status(400).send('Missing session ID (id or deviceid parameter)');
  }

  const lat = parseFloat(data.lat);
  const lon = parseFloat(data.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).send('Invalid coordinates');
  }

  let timestamp = Date.now();
  if (data.timestamp || data.time) {
    const rawTime = data.timestamp || data.time;
    if (!isNaN(rawTime)) {
      const numTime = Number(rawTime);
      timestamp = numTime < 1e11 ? numTime * 1000 : numTime;
    } else {
      const parsed = Date.parse(rawTime);
      if (!isNaN(parsed)) timestamp = parsed;
    }
  }

  const now = Date.now();
  if (timestamp > now + 600000 || timestamp < now - 7 * 86400000) {
    timestamp = now;
  }

  let speedKmH = 0;
  if (data.speed !== undefined && !isNaN(data.speed)) {
    speedKmH = Math.round(parseFloat(data.speed) * 1.852 * 10) / 10;
  }

  const point = {
    lat,
    lon,
    timestamp,
    altitude: data.altitude !== undefined ? Math.round(parseFloat(data.altitude)) : null,
    speed: speedKmH,
    bearing: data.bearing !== undefined ? Math.round(parseFloat(data.bearing)) : null,
    battery: data.batt !== undefined || data.battery !== undefined ? parseFloat(data.batt || data.battery) : null,
  };

  const requestedViewToken = data.token || data.view_token || null;
  const sessionResult = db.getOrCreateSession(sessionId, auth.user_id, requestedViewToken);

  if (sessionResult.error) {
    return res.status(403).send(sessionResult.error);
  }

  db.addPoint(sessionId, point);
  notifySubscribers(sessionId, { type: 'point', point });
  res.status(200).send('OK');
}

// Ingestion routes
app.get('/', (req, res, next) => {
  if (req.query.id || req.query.deviceid || req.query.lat) {
    return ingestLimiter(req, res, () => handleTraccarPoint(req, res));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/', ingestLimiter, handleTraccarPoint);
app.get('/api/location', ingestLimiter, handleTraccarPoint);
app.post('/api/location', ingestLimiter, handleTraccarPoint);

// ==========================================
// User Authentication & Whitelist Enforcement
// ==========================================

// Google Sign-In verification endpoint
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'Missing idToken' });
  }

  try {
    let payload;
    if (GOOGLE_CLIENT_ID) {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      const loginTicket = await googleAuthClient.verifySignedJwtWithCertsAsync(
        idToken,
        await googleAuthClient.getFederatedSignonCertsAsync(),
        GOOGLE_CLIENT_ID || undefined
      );
      payload = loginTicket.getPayload();
    }

    const email = (payload.email || '').toLowerCase().trim();
    const googleSub = payload.sub;
    const name = payload.name || payload.given_name || 'Google User';

    // Whitelist check
    if (!db.isEmailAllowed(email)) {
      console.warn(`[Registration Blocked] Email not in whitelist: ${email}`);
      return res.status(403).json({
        error: 'Access denied',
        message: `Email ${email} is not in the registration whitelist. Please contact the administrator.`
      });
    }

    const result = db.findOrCreateGoogleUser(googleSub, email, name);
    res.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name
      },
      apiKey: result.device.api_key,
      deviceId: result.device.id
    });
  } catch (err) {
    console.error('Google token verification error:', err.message);
    res.status(401).json({ error: 'Invalid Google token: ' + err.message });
  }
});

// Quick-Setup (Enforces Whitelist!)
app.post('/api/auth/quick-setup', (req, res) => {
  const { email, name } = req.body || {};
  const userEmail = (email && email.includes('@') ? email.trim() : 'admin@easylivetrack.local').toLowerCase();
  const userName = name ? name.trim() : 'EasyLiveTrack User';

  // Whitelist check
  if (!db.isEmailAllowed(userEmail)) {
    console.warn(`[QuickSetup Blocked] Email not in whitelist: ${userEmail}`);
    return res.status(403).json({
      error: 'Access denied',
      message: `Email ${userEmail} is not in the registration whitelist. Please contact the administrator.`
    });
  }

  const result = db.createLocalDevUser(userEmail, userName);
  res.json({
    success: true,
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name
    },
    apiKey: result.device.api_key,
    deviceId: result.device.id
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.auth.user_id,
      email: req.auth.email,
      name: req.auth.name
    },
    device: {
      id: req.auth.device_id,
      name: req.auth.device_name,
      apiKey: req.auth.api_key
    }
  });
});

// Pairing Code
app.post('/api/pairing/create', requireAuth, (req, res) => {
  const pairing = db.createPairingCode(req.auth.user_id, req.auth.api_key);
  res.json({
    success: true,
    code: pairing.code,
    expiresAt: pairing.expiresAt,
    expiresInSeconds: Math.round((pairing.expiresAt - Date.now()) / 1000)
  });
});

app.post('/api/pairing/claim', (req, res) => {
  const { code, deviceName } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: 'Missing pairing code' });
  }

  const claim = db.claimPairingCode(code.trim(), deviceName || 'Wear OS Watch');
  if (!claim) {
    return res.status(404).json({ error: 'Invalid or expired pairing code. Please generate a new one.' });
  }

  res.json({
    success: true,
    apiKey: claim.apiKey,
    deviceId: claim.deviceId,
    userEmail: claim.userEmail
  });
});

// ==========================================
// Admin APIs (Dashboard, Whitelist, Devices, GPX)
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Missing password' });
  }

  if (!db.verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const session = db.createAdminSession();
  res.setHeader('Set-Cookie', `admin_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`);
  res.json({
    success: true,
    token: session.token,
    expiresAt: session.expiresAt
  });
});

// Admin Logout
app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
  db.deleteAdminSession(req.adminToken);
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Admin System Stats
app.get('/api/admin/stats', requireAdminAuth, (req, res) => {
  res.json(db.getSystemStats());
});

// Admin Whitelist management
app.get('/api/admin/whitelist', requireAdminAuth, (req, res) => {
  res.json({
    mode: db.getRegistrationMode(),
    whitelist: db.getWhitelist()
  });
});

app.post('/api/admin/whitelist', requireAdminAuth, (req, res) => {
  const { email, notes } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  db.addEmailToWhitelist(email, notes);
  res.json({ success: true, whitelist: db.getWhitelist() });
});

app.delete('/api/admin/whitelist/:email', requireAdminAuth, (req, res) => {
  const { email } = req.params;
  db.removeEmailFromWhitelist(decodeURIComponent(email));
  res.json({ success: true, whitelist: db.getWhitelist() });
});

app.post('/api/admin/registration-mode', requireAdminAuth, (req, res) => {
  const { mode } = req.body || {};
  const newMode = db.setRegistrationMode(mode);
  res.json({ success: true, mode: newMode });
});

// Admin Device Management
app.get('/api/admin/devices', requireAdminAuth, (req, res) => {
  res.json(db.getAllDevicesWithUsers());
});

app.delete('/api/admin/devices/:id', requireAdminAuth, (req, res) => {
  db.deleteDevice(req.params.id);
  res.json({ success: true });
});

// Admin generate pairing code directly
app.post('/api/admin/pairing/create', requireAdminAuth, (req, res) => {
  const { email } = req.body || {};
  const user = db.createLocalDevUser(email || 'admin@easylivetrack.local', 'Authorized User');
  const pairing = db.createPairingCode(user.user.id, user.apiKey);
  res.json({ success: true, code: pairing.code, expiresAt: pairing.expiresAt });
});

// Admin Sessions & GPX Export
app.get('/api/admin/sessions', requireAdminAuth, (req, res) => {
  res.json(db.getAllSessionsAdmin());
});

app.delete('/api/admin/sessions/:id', requireAdminAuth, (req, res) => {
  db.deleteSession(req.params.id);
  res.json({ success: true });
});

// GPX Download route
app.get('/api/sessions/:id/export.gpx', (req, res) => {
  const { id } = req.params;
  const gpx = db.generateGpx(id);
  if (!gpx) {
    return res.status(404).send('Session not found or no GPS points recorded.');
  }

  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="track-${id}.gpx"`);
  res.send(gpx);
});

// Admin password update
app.post('/api/admin/password', requireAdminAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  db.setAdminPassword(newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

// ==========================================
// Session Management & Viewer Security APIs
// ==========================================

app.post('/api/sessions/start', requireAuth, (req, res) => {
  const { sessionId, viewToken } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const session = db.getOrCreateSession(sessionId, req.auth.user_id, viewToken);
  if (session.error) {
    return res.status(403).json({ error: session.error });
  }

  const host = req.get('host');
  const protocol = req.protocol;
  const shareUrl = `${protocol}://${host}/live/${sessionId}?token=${session.view_token}`;

  res.json({
    success: true,
    sessionId: session.id,
    viewToken: session.view_token,
    shareUrl
  });
});

app.post('/api/sessions/:id/end', requireAuth, (req, res) => {
  const { id } = req.params;
  const session = db.getSessionWithPoints(id, 1);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.userId && session.userId !== req.auth.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  db.endSession(id);
  notifySubscribers(id, { type: 'ended', timestamp: Date.now() });
  res.json({ success: true, message: 'Session ended' });
});

function checkSessionViewAccess(req, session) {
  if (!session) return false;

  const reqToken = req.query.token || req.headers['x-view-token'];
  if (reqToken && reqToken === session.viewToken) {
    return true;
  }

  const apiKey = extractApiKey(req);
  if (apiKey) {
    const auth = db.getUserByApiKey(apiKey);
    if (auth && auth.user_id === session.userId) {
      return true;
    }
  }

  const adminToken = extractAdminToken(req);
  if (adminToken && db.validateAdminSession(adminToken)) {
    return true;
  }

  return false;
}

app.get('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const session = db.getSessionWithPoints(id, 5000);

  if (!session) {
    return res.status(404).json({ error: 'Session not found', active: false, points: [] });
  }

  if (!checkSessionViewAccess(req, session)) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This LiveTrack session is private. The full URL with view token (?token=...) is required.'
    });
  }

  res.json({
    id: session.id,
    active: session.active,
    startTime: session.startTime,
    lastUpdate: session.lastUpdate,
    pointsCount: session.pointsCount,
    points: session.points
  });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const list = db.getUserSessions(req.auth.user_id);
  res.json(list);
});

app.get('/api/sessions/:id/stream', (req, res) => {
  const { id } = req.params;
  const session = db.getSessionWithPoints(id, 1);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!checkSessionViewAccess(req, session)) {
    return res.status(403).json({ error: 'Unauthorized access (missing or invalid view token)' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(id)) {
    sseClients.set(id, new Set());
  }
  sseClients.get(id).add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: id })}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(id);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(id);
      }
    }
  });
});

function notifySubscribers(sessionId, data) {
  const clients = sseClients.get(sessionId);
  if (clients) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }
}

// Serve Live Viewer page
app.get('/live/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live.html'));
});

// Serve Admin Dashboard page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  EasyLiveTrack Server (Traccar/OsmAnd) v2.0`);
  console.log(`  Port: http://0.0.0.0:${PORT}`);
  console.log(`  Admin Dashboard: http://0.0.0.0:${PORT}/admin`);
  console.log(`  Registration Mode: ${db.getRegistrationMode()}`);
  console.log(`====================================================`);
});
