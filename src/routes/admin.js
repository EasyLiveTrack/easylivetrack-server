const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdminAuth } = require('../middleware/auth');

// Admin Login
router.post('/api/admin/login', (req, res) => {
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
router.post('/api/admin/logout', requireAdminAuth, (req, res) => {
  db.deleteAdminSession(req.adminToken);
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Admin System Stats
router.get('/api/admin/stats', requireAdminAuth, (req, res) => {
  res.json(db.getSystemStats());
});

// Admin Whitelist management
router.get('/api/admin/whitelist', requireAdminAuth, (req, res) => {
  res.json({
    mode: db.getRegistrationMode(),
    whitelist: db.getWhitelist()
  });
});

router.post('/api/admin/whitelist', requireAdminAuth, (req, res) => {
  const { email, notes } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  db.addEmailToWhitelist(email, notes);
  res.json({ success: true, whitelist: db.getWhitelist() });
});

router.delete('/api/admin/whitelist/:email', requireAdminAuth, (req, res) => {
  const { email } = req.params;
  db.removeEmailFromWhitelist(decodeURIComponent(email));
  res.json({ success: true, whitelist: db.getWhitelist() });
});

router.post('/api/admin/registration-mode', requireAdminAuth, (req, res) => {
  const { mode } = req.body || {};
  const newMode = db.setRegistrationMode(mode);
  res.json({ success: true, mode: newMode });
});

// Admin Device Management
router.get('/api/admin/devices', requireAdminAuth, (req, res) => {
  res.json(db.getAllDevicesWithUsers());
});

router.delete('/api/admin/devices/:id', requireAdminAuth, (req, res) => {
  db.deleteDevice(req.params.id);
  res.json({ success: true });
});

// Admin generate pairing code directly
router.post('/api/admin/pairing/create', requireAdminAuth, (req, res) => {
  const { email } = req.body || {};
  const user = db.createLocalDevUser(email || 'admin@easylivetrack.local', 'Authorized User');
  const pairing = db.createPairingCode(user.user.id, user.apiKey);
  res.json({ success: true, code: pairing.code, expiresAt: pairing.expiresAt });
});

// Admin Sessions & Management
router.get('/api/admin/sessions', requireAdminAuth, (req, res) => {
  res.json(db.getAllSessionsAdmin());
});

router.delete('/api/admin/sessions/:id', requireAdminAuth, (req, res) => {
  db.deleteSession(req.params.id);
  res.json({ success: true });
});

// Admin password update
router.post('/api/admin/password', requireAdminAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  db.setAdminPassword(newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = router;
