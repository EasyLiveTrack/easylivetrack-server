const db = require('../db');

/**
 * Extracts API key for devices/users from Bearer token, query param, or header.
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

module.exports = {
  extractApiKey,
  extractAdminToken,
  requireAuth,
  requireAdminAuth
};
