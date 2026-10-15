const path = require('path');

module.exports = {
  PORT: parseInt(process.env.PORT || '5055', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_PATH: process.env.DB_PATH || path.resolve(__dirname, '../gpsbeacon.db'),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'admin@easylivetrack.local').toLowerCase().trim(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin12345',
  REGISTRATION_MODE: process.env.REGISTRATION_MODE || 'whitelist'
};
