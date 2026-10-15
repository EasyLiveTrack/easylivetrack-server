const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const googleAuthClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

// Google Sign-In verification endpoint
router.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'Missing idToken' });
  }

  try {
    let payload;
    if (config.GOOGLE_CLIENT_ID) {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken,
        audience: config.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      const loginTicket = await googleAuthClient.verifySignedJwtWithCertsAsync(
        idToken,
        await googleAuthClient.getFederatedSignonCertsAsync(),
        config.GOOGLE_CLIENT_ID || undefined
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
router.post('/api/auth/quick-setup', (req, res) => {
  const { email, name } = req.body || {};
  const userEmail = (email && email.includes('@') ? email.trim() : config.ADMIN_EMAIL).toLowerCase();
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

router.get('/api/auth/me', requireAuth, (req, res) => {
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

// Pairing Code endpoints
router.post('/api/pairing/create', requireAuth, (req, res) => {
  const pairing = db.createPairingCode(req.auth.user_id, req.auth.api_key);
  res.json({
    success: true,
    code: pairing.code,
    expiresAt: pairing.expiresAt,
    expiresInSeconds: Math.round((pairing.expiresAt - Date.now()) / 1000)
  });
});

router.post('/api/pairing/claim', (req, res) => {
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

module.exports = router;
