const express = require('express');
const path = require('path');
const router = express.Router();
const { handleTraccarPoint } = require('./ingestion');
const { ingestLimiter } = require('../middleware/rateLimiter');

const publicDir = path.join(__dirname, '../../public');

// Root route: serves index.html, or processes GPS ingestion if query params are present
router.get('/', (req, res, next) => {
  if (req.query.id || req.query.deviceid || req.query.lat) {
    return ingestLimiter(req, res, () => handleTraccarPoint(req, res));
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Live viewer page
router.get('/live/:id', (req, res) => {
  res.sendFile(path.join(publicDir, 'live.html'));
});

// Admin dashboard pages
router.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

router.get('/admin/*', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

module.exports = router;
