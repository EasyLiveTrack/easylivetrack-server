const express = require('express');
const router = express.Router();
const db = require('../db');
const { extractApiKey, extractAdminToken, requireAuth } = require('../middleware/auth');
const { addSubscriber, notifySubscribers } = require('../services/sse');

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

// Start a live tracking session
router.post('/api/sessions/start', requireAuth, (req, res) => {
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

// End a live tracking session
router.post('/api/sessions/:id/end', requireAuth, (req, res) => {
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

// Get session details and recorded points
router.get('/api/sessions/:id', (req, res) => {
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

// List sessions for authenticated user
router.get('/api/sessions', requireAuth, (req, res) => {
  const list = db.getUserSessions(req.auth.user_id);
  res.json(list);
});

// Server-Sent Events (SSE) live updates stream
router.get('/api/sessions/:id/stream', (req, res) => {
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

  addSubscriber(id, res);
});

// GPX Download route
router.get('/api/sessions/:id/export.gpx', (req, res) => {
  const { id } = req.params;
  const gpx = db.generateGpx(id);
  if (!gpx) {
    return res.status(404).send('Session not found or no GPS points recorded.');
  }

  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="track-${id}.gpx"`);
  res.send(gpx);
});

module.exports = router;
