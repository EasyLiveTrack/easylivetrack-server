const crypto = require('crypto');
const fs = require('fs');
const db = require('./database');
const config = require('../config');
const { generateGpx: buildGpx } = require('../services/gpx');

// Prepared statements
const stmtGetUserByApiKey = db.prepare(`
  SELECT d.api_key, d.id as device_id, d.device_name, d.user_id, u.email, u.name
  FROM devices d
  JOIN users u ON d.user_id = u.id
  WHERE d.api_key = ?
`);

const stmtUpdateDeviceLastSeen = db.prepare(`
  UPDATE devices SET last_seen = ? WHERE api_key = ?
`);

const stmtGetUserByGoogleSub = db.prepare(`
  SELECT * FROM users WHERE google_sub = ?
`);

const stmtGetUserByEmail = db.prepare(`
  SELECT * FROM users WHERE email = ?
`);

const stmtGetUserById = db.prepare(`
  SELECT * FROM users WHERE id = ?
`);

const stmtInsertUser = db.prepare(`
  INSERT INTO users (id, email, name, google_sub, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtInsertDevice = db.prepare(`
  INSERT INTO devices (id, user_id, api_key, device_name, created_at, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetDevicesByUser = db.prepare(`
  SELECT id, device_name, api_key, created_at, last_seen
  FROM devices
  WHERE user_id = ?
`);

const stmtCleanExpiredPairingCodes = db.prepare(`
  DELETE FROM pairing_codes WHERE expires_at < ?
`);

const stmtInsertPairingCode = db.prepare(`
  INSERT OR REPLACE INTO pairing_codes (code, user_id, api_key, expires_at)
  VALUES (?, ?, ?, ?)
`);

const stmtGetPairingCode = db.prepare(`
  SELECT * FROM pairing_codes WHERE code = ? AND expires_at > ?
`);

const stmtDeletePairingCode = db.prepare(`
  DELETE FROM pairing_codes WHERE code = ?
`);

const stmtInsertSession = db.prepare(`
  INSERT OR REPLACE INTO sessions (id, user_id, view_token, active, start_time, last_update)
  VALUES (?, ?, ?, 1, ?, ?)
`);

const stmtGetSession = db.prepare(`
  SELECT * FROM sessions WHERE id = ?
`);

const stmtUpdateSession = db.prepare(`
  UPDATE sessions SET active = 1, last_update = ? WHERE id = ?
`);

const stmtEndSession = db.prepare(`
  UPDATE sessions SET active = 0, last_update = ? WHERE id = ?
`);

const stmtInsertPoint = db.prepare(`
  INSERT INTO points (session_id, lat, lon, timestamp, altitude, speed, bearing, battery)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetPointsBySession = db.prepare(`
  SELECT lat, lon, timestamp, altitude, speed, bearing, battery
  FROM points
  WHERE session_id = ?
  ORDER BY timestamp ASC
  LIMIT ?
`);

const stmtGetPointsCount = db.prepare(`
  SELECT COUNT(*) as count FROM points WHERE session_id = ?
`);

const stmtGetSessionsByUser = db.prepare(`
  SELECT s.*, 
    (SELECT COUNT(*) FROM points WHERE session_id = s.id) as pointsCount,
    (SELECT json_object('lat', lat, 'lon', lon, 'timestamp', timestamp, 'speed', speed, 'battery', battery)
     FROM points WHERE session_id = s.id ORDER BY timestamp DESC LIMIT 1) as latestPointJson
  FROM sessions s
  WHERE s.user_id = ?
  ORDER BY s.last_update DESC
`);

const stmtPruneOldPoints = db.prepare(`
  DELETE FROM points WHERE session_id = ? AND id NOT IN (
    SELECT id FROM points WHERE session_id = ? ORDER BY timestamp DESC LIMIT 5000
  )
`);

// Admin & Settings statements
const stmtGetSetting = db.prepare(`SELECT value FROM admin_settings WHERE key = ?`);
const stmtSetSetting = db.prepare(`INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)`);

const stmtInsertAdminSession = db.prepare(`INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)`);
const stmtGetAdminSession = db.prepare(`SELECT * FROM admin_sessions WHERE token = ? AND expires_at > ?`);
const stmtDeleteAdminSession = db.prepare(`DELETE FROM admin_sessions WHERE token = ?`);
const stmtCleanExpiredAdminSessions = db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`);

const stmtGetWhitelist = db.prepare(`SELECT email, added_at, notes FROM email_whitelist ORDER BY added_at DESC`);
const stmtIsEmailInWhitelist = db.prepare(`SELECT 1 FROM email_whitelist WHERE LOWER(email) = LOWER(?)`);
const stmtInsertWhitelist = db.prepare(`INSERT OR REPLACE INTO email_whitelist (email, added_at, notes) VALUES (LOWER(?), ?, ?)`);
const stmtDeleteWhitelist = db.prepare(`DELETE FROM email_whitelist WHERE LOWER(email) = LOWER(?)`);

const stmtGetAllDevicesWithUsers = db.prepare(`
  SELECT d.id as device_id, d.device_name, d.api_key, d.created_at, d.last_seen,
         u.id as user_id, u.email as user_email, u.name as user_name
  FROM devices d
  JOIN users u ON d.user_id = u.id
  ORDER BY d.last_seen DESC
`);

const stmtDeleteDevice = db.prepare(`DELETE FROM devices WHERE id = ?`);

const stmtGetAllSessionsAdmin = db.prepare(`
  SELECT s.*, u.email as user_email, u.name as user_name,
    (SELECT COUNT(*) FROM points WHERE session_id = s.id) as pointsCount
  FROM sessions s
  LEFT JOIN users u ON s.user_id = u.id
  ORDER BY s.last_update DESC
`);

const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);

const stmtCountUsers = db.prepare(`SELECT COUNT(*) as count FROM users`);
const stmtCountDevices = db.prepare(`SELECT COUNT(*) as count FROM devices`);
const stmtCountActiveSessions = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE active = 1`);
const stmtCountTotalSessions = db.prepare(`SELECT COUNT(*) as count FROM sessions`);
const stmtCountPoints = db.prepare(`SELECT COUNT(*) as count FROM points`);

// -------------------------------------------------------------
// Helper Functions
// -------------------------------------------------------------

function generateApiKey() {
  return 'gbeacon_live_' + crypto.randomBytes(20).toString('hex');
}

function generateViewToken() {
  return crypto.randomBytes(12).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function initAdminDefaults(envEmail, envPassword, envRegMode) {
  const currentEmail = stmtGetSetting.get('admin_email')?.value;
  const adminEmail = (envEmail || currentEmail || config.ADMIN_EMAIL).toLowerCase().trim();

  stmtSetSetting.run('admin_email', adminEmail);

  // Registration mode: 'whitelist' (default), 'open', or 'closed'
  const currentMode = stmtGetSetting.get('registration_mode')?.value;
  if (!currentMode) {
    stmtSetSetting.run('registration_mode', envRegMode || config.REGISTRATION_MODE);
  }

  // Manage Admin Password
  const targetPass = envPassword || config.ADMIN_PASSWORD;
  const currentHash = stmtGetSetting.get('admin_password_hash')?.value;
  const lastAppliedEnvPass = stmtGetSetting.get('last_applied_env_pass')?.value;

  if (!currentHash || !lastAppliedEnvPass || (envPassword && lastAppliedEnvPass !== envPassword)) {
    setAdminPassword(targetPass);
    stmtSetSetting.run('last_applied_env_pass', targetPass);
    console.log(`[Admin Setup] Administrator password configured (email: ${adminEmail})`);
  }

  // Ensure admin email is always in whitelist
  if (adminEmail) {
    stmtInsertWhitelist.run(adminEmail, Date.now(), 'Primary Administrator');
  }
}

function verifyAdminPassword(password) {
  if (!password) return false;
  const salt = stmtGetSetting.get('admin_password_salt')?.value;
  const expectedHash = stmtGetSetting.get('admin_password_hash')?.value;
  if (!salt || !expectedHash) return false;

  const actualHash = hashPassword(password, salt);
  const actualBuf = Buffer.from(actualHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function setAdminPassword(newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  stmtSetSetting.run('admin_password_salt', salt);
  stmtSetSetting.run('admin_password_hash', hash);
}

function createAdminSession() {
  stmtCleanExpiredAdminSessions.run(Date.now());
  const token = 'adm_' + crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 3600 * 1000; // 7 days
  stmtInsertAdminSession.run(token, now, expiresAt);
  return { token, expiresAt };
}

function validateAdminSession(token) {
  if (!token) return false;
  stmtCleanExpiredAdminSessions.run(Date.now());
  const row = stmtGetAdminSession.get(token, Date.now());
  return Boolean(row);
}

function deleteAdminSession(token) {
  if (token) stmtDeleteAdminSession.run(token);
}

function getRegistrationMode() {
  return stmtGetSetting.get('registration_mode')?.value || 'whitelist';
}

function setRegistrationMode(mode) {
  const valid = ['whitelist', 'open', 'closed'].includes(mode) ? mode : 'whitelist';
  stmtSetSetting.run('registration_mode', valid);
  return valid;
}

function isEmailAllowed(email) {
  if (!email) return false;
  const cleanEmail = email.toLowerCase().trim();
  const mode = getRegistrationMode();

  if (mode === 'open') return true;

  const adminEmail = stmtGetSetting.get('admin_email')?.value;
  if (adminEmail && adminEmail.toLowerCase() === cleanEmail) {
    return true;
  }

  if (mode === 'closed') return false;

  // In 'whitelist' mode
  const row = stmtIsEmailInWhitelist.get(cleanEmail);
  return Boolean(row);
}

function getWhitelist() {
  return stmtGetWhitelist.all();
}

function addEmailToWhitelist(email, notes = '') {
  if (!email || !email.includes('@')) return false;
  stmtInsertWhitelist.run(email.toLowerCase().trim(), Date.now(), notes || '');
  return true;
}

function removeEmailFromWhitelist(email) {
  if (!email) return false;
  stmtDeleteWhitelist.run(email.toLowerCase().trim());
  return true;
}

function getUserByApiKey(apiKey) {
  if (!apiKey) return null;
  const row = stmtGetUserByApiKey.get(apiKey);
  if (row) {
    stmtUpdateDeviceLastSeen.run(Date.now(), apiKey);
  }
  return row;
}

function findOrCreateGoogleUser(googleSub, email, name) {
  let user = stmtGetUserByGoogleSub.get(googleSub);
  if (!user && email) {
    user = stmtGetUserByEmail.get(email.toLowerCase().trim());
  }

  const now = Date.now();
  if (!user) {
    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    stmtInsertUser.run(userId, email.toLowerCase().trim(), name || 'User', googleSub, now);
    user = { id: userId, email: email.toLowerCase().trim(), name, google_sub: googleSub, created_at: now };
  }

  const devices = stmtGetDevicesByUser.all(user.id);
  let defaultDevice = devices[0];
  if (!defaultDevice) {
    const deviceId = 'dev_' + crypto.randomBytes(6).toString('hex');
    const apiKey = generateApiKey();
    stmtInsertDevice.run(deviceId, user.id, apiKey, 'Primary Device', now, now);
    defaultDevice = { id: deviceId, user_id: user.id, api_key: apiKey, device_name: 'Primary Device' };
  }

  return { user, device: defaultDevice };
}

function createLocalDevUser(email = 'admin@easylivetrack.local', name = 'Administrator') {
  let user = stmtGetUserByEmail.get(email.toLowerCase().trim());
  const now = Date.now();
  if (!user) {
    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    stmtInsertUser.run(userId, email.toLowerCase().trim(), name, 'local_dev_' + userId, now);
    user = { id: userId, email: email.toLowerCase().trim(), name, created_at: now };
  }

  const devices = stmtGetDevicesByUser.all(user.id);
  let defaultDevice = devices[0];
  if (!defaultDevice) {
    const deviceId = 'dev_' + crypto.randomBytes(6).toString('hex');
    const apiKey = generateApiKey();
    stmtInsertDevice.run(deviceId, user.id, apiKey, 'Primary Device', now, now);
    defaultDevice = { id: deviceId, user_id: user.id, api_key: apiKey, device_name: 'Primary Device' };
  }

  return { user, device: defaultDevice };
}

function createPairingCode(userId, apiKey) {
  const now = Date.now();
  stmtCleanExpiredPairingCodes.run(now);

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = now + 10 * 60 * 1000;

  stmtInsertPairingCode.run(code, userId, apiKey, expiresAt);
  return { code, expiresAt };
}

function claimPairingCode(code, deviceName = 'Smartwatch') {
  const now = Date.now();
  stmtCleanExpiredPairingCodes.run(now);

  const row = stmtGetPairingCode.get(code, now);
  if (!row) return null;

  stmtDeletePairingCode.run(code);

  const newDeviceId = 'dev_' + crypto.randomBytes(6).toString('hex');
  const newApiKey = generateApiKey();
  stmtInsertDevice.run(newDeviceId, row.user_id, newApiKey, deviceName, now, now);

  const user = stmtGetUserById.get(row.user_id);
  return {
    userId: row.user_id,
    apiKey: newApiKey,
    deviceId: newDeviceId,
    userEmail: user ? user.email : ''
  };
}

function getOrCreateSession(sessionId, userId, requestedViewToken) {
  let session = stmtGetSession.get(sessionId);
  const now = Date.now();

  if (!session) {
    const viewToken = requestedViewToken || generateViewToken();
    stmtInsertSession.run(sessionId, userId, viewToken, now, now);
    session = {
      id: sessionId,
      user_id: userId,
      view_token: viewToken,
      active: 1,
      start_time: now,
      last_update: now
    };
  } else {
    if (session.user_id && userId && session.user_id !== userId) {
      return { error: 'Session ID belongs to another user' };
    }
    stmtUpdateSession.run(now, sessionId);
    session.active = 1;
    session.last_update = now;
  }

  return session;
}

function addPoint(sessionId, point) {
  stmtInsertPoint.run(
    sessionId,
    point.lat,
    point.lon,
    point.timestamp,
    point.altitude,
    point.speed,
    point.bearing,
    point.battery
  );
  stmtUpdateSession.run(point.timestamp, sessionId);
  stmtPruneOldPoints.run(sessionId, sessionId);
}

function getSessionWithPoints(sessionId, maxPoints = 5000) {
  const session = stmtGetSession.get(sessionId);
  if (!session) return null;

  const points = stmtGetPointsBySession.all(sessionId, maxPoints);
  const countRow = stmtGetPointsCount.get(sessionId);

  return {
    id: session.id,
    userId: session.user_id,
    viewToken: session.view_token,
    active: Boolean(session.active),
    startTime: session.start_time,
    lastUpdate: session.last_update,
    pointsCount: countRow ? countRow.count : points.length,
    points: points
  };
}

function endSession(sessionId) {
  const now = Date.now();
  stmtEndSession.run(now, sessionId);
}

function getUserSessions(userId) {
  const rows = stmtGetSessionsByUser.all(userId);
  return rows.map(r => ({
    id: r.id,
    active: Boolean(r.active),
    viewToken: r.view_token,
    startTime: r.start_time,
    lastUpdate: r.last_update,
    pointsCount: r.pointsCount,
    latestPoint: r.latestPointJson ? JSON.parse(r.latestPointJson) : null
  }));
}

function getAllDevicesWithUsers() {
  return stmtGetAllDevicesWithUsers.all();
}

function deleteDevice(deviceId) {
  stmtDeleteDevice.run(deviceId);
}

function getAllSessionsAdmin() {
  return stmtGetAllSessionsAdmin.all();
}

function deleteSession(sessionId) {
  stmtDeleteSession.run(sessionId);
}

function getSystemStats() {
  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(config.DB_PATH)) {
      dbSizeBytes = fs.statSync(config.DB_PATH).size;
    }
  } catch (e) {}

  return {
    usersCount: stmtCountUsers.get()?.count || 0,
    devicesCount: stmtCountDevices.get()?.count || 0,
    activeSessionsCount: stmtCountActiveSessions.get()?.count || 0,
    totalSessionsCount: stmtCountTotalSessions.get()?.count || 0,
    pointsCount: stmtCountPoints.get()?.count || 0,
    dbSizeBytes: dbSizeBytes,
    dbSizeFormatted: (dbSizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
    registrationMode: getRegistrationMode(),
    adminEmail: stmtGetSetting.get('admin_email')?.value || ''
  };
}

function generateGpx(sessionId) {
  const session = getSessionWithPoints(sessionId, 50000);
  if (!session) return null;
  return buildGpx(session);
}

module.exports = {
  db,
  initAdminDefaults,
  verifyAdminPassword,
  setAdminPassword,
  createAdminSession,
  validateAdminSession,
  deleteAdminSession,
  getRegistrationMode,
  setRegistrationMode,
  isEmailAllowed,
  getWhitelist,
  addEmailToWhitelist,
  removeEmailFromWhitelist,
  getUserByApiKey,
  findOrCreateGoogleUser,
  createLocalDevUser,
  createPairingCode,
  claimPairingCode,
  getOrCreateSession,
  getSessionWithPoints,
  addPoint,
  endSession,
  getUserSessions,
  getAllDevicesWithUsers,
  deleteDevice,
  getAllSessionsAdmin,
  deleteSession,
  getSystemStats,
  generateGpx,
  generateApiKey,
  generateViewToken
};
