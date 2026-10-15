const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP address, please try again later.' }
});

const ingestLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'GPS ingestion rate limit exceeded (max 5 points/sec)' }
});

module.exports = {
  apiLimiter,
  ingestLimiter
};
