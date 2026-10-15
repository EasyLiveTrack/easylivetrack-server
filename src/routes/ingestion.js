const express = require('express');
const router = express.Router();
const db = require('../db');
const { extractApiKey } = require('../middleware/auth');
const { ingestLimiter } = require('../middleware/rateLimiter');
const { notifySubscribers } = require('../services/sse');

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

// Ingestion endpoints
router.post('/', ingestLimiter, handleTraccarPoint);
router.get('/api/location', ingestLimiter, handleTraccarPoint);
router.post('/api/location', ingestLimiter, handleTraccarPoint);

module.exports = {
  router,
  handleTraccarPoint
};
