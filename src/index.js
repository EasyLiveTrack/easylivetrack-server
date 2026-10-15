const app = require('./app');
const config = require('./config');
const db = require('./db');

// Initialize Admin credentials and Whitelist defaults from environment
db.initAdminDefaults(
  config.ADMIN_EMAIL,
  config.ADMIN_PASSWORD,
  config.REGISTRATION_MODE
);

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  EasyLiveTrack Server (Traccar/OsmAnd) v2.0`);
  console.log(`  Environment: ${config.NODE_ENV}`);
  console.log(`  Port: http://0.0.0.0:${config.PORT}`);
  console.log(`  Admin Dashboard: http://0.0.0.0:${config.PORT}/admin`);
  console.log(`  Registration Mode: ${db.getRegistrationMode()}`);
  console.log(`====================================================`);
});

module.exports = server;
