const http = require('http');

/**
 * Simple HTTP request helper
 */
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data
          });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'object') {
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting End-to-End Tests for EasyLiveTrack Server...');

  // Start internal server if not already running
  let serverInstance = null;
  const config = require('../src/config');
  const port = config.PORT;

  try {
    const check = await request({ hostname: 'localhost', port, path: '/', method: 'GET' });
  } catch (e) {
    // Server not running, launch it in-process for testing
    serverInstance = require('../src/index');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  try {
    // 1. Health check / HTML index
    const home = await request({ hostname: 'localhost', port, path: '/', method: 'GET' });
    if (home.statusCode !== 200) throw new Error(`Home status is ${home.statusCode}`);
    console.log('✅ 1. Web UI / Home loaded successfully (HTTP 200)');

    const testEmail = `test-athlete-${Date.now()}@example.com`;

    // 2. Verify Whitelist blocking for unauthorized registration
    const unauthReg = await request({
      hostname: 'localhost',
      port,
      path: '/api/auth/quick-setup',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: testEmail, name: 'Unknown User' });

    if (unauthReg.statusCode === 403) {
      console.log('✅ 2. Whitelist enforcement active: unauthorized user blocked (HTTP 403)');
    } else {
      throw new Error(`Expected 403 for unauthorized registration, got ${unauthReg.statusCode}`);
    }

    // 3. Administrator Login
    const adminLogin = await request({
      hostname: 'localhost',
      port,
      path: '/api/admin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: config.ADMIN_PASSWORD });

    if (adminLogin.statusCode !== 200 || !adminLogin.body.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.body)}`);
    }
    const adminToken = adminLogin.body.token;
    console.log('✅ 3. Administrator login succeeded (Session token received)');

    // 4. Add email to whitelist via Admin API
    const addWhitelist = await request({
      hostname: 'localhost',
      port,
      path: '/api/admin/whitelist',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, { email: testEmail, notes: 'Authorized test athlete' });

    if (addWhitelist.statusCode !== 200) {
      throw new Error(`Add to whitelist failed: ${JSON.stringify(addWhitelist.body)}`);
    }
    console.log('✅ 4. Email added to whitelist successfully by Admin');

    // 5. Authorized registration now succeeds
    const authReg = await request({
      hostname: 'localhost',
      port,
      path: '/api/auth/quick-setup',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: testEmail, name: 'John Doe' });

    if (authReg.statusCode !== 200 || !authReg.body.apiKey) {
      throw new Error(`Authorized registration failed: ${JSON.stringify(authReg.body)}`);
    }
    const apiKey = authReg.body.apiKey;
    console.log('✅ 5. Authorized user registered successfully (API Key:', apiKey.substring(0, 14) + '...)');

    // 6. Send GPS location fix (Traccar OsmAnd protocol) with API Key
    const sessionId = 'test-session-' + Date.now();
    const ingest = await request({
      hostname: 'localhost',
      port,
      path: `/?id=${sessionId}&lat=45.4642&lon=9.1900&altitude=120&speed=15&key=${apiKey}`,
      method: 'GET'
    });

    if (ingest.statusCode !== 200 || ingest.body !== 'OK') {
      throw new Error(`GPS ingestion failed: ${ingest.statusCode} ${ingest.body}`);
    }
    console.log('✅ 6. Traccar OsmAnd GPS point ingested successfully (HTTP 200 OK)');

    // 7. GPX 1.1 Trace Export
    const gpxExport = await request({
      hostname: 'localhost',
      port,
      path: `/api/sessions/${sessionId}/export.gpx`,
      method: 'GET'
    });

    if (gpxExport.statusCode !== 200 || !gpxExport.body.includes('<gpx') || !gpxExport.body.includes('45.4642')) {
      throw new Error(`GPX Export failed: ${gpxExport.statusCode}`);
    }
    console.log('✅ 7. GPX 1.1 trace export verified (valid XML and GPS coordinates)');

    // 8. Admin system statistics
    const stats = await request({
      hostname: 'localhost',
      port,
      path: '/api/admin/stats',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`✅ 8. Admin system stats loaded: ${stats.body.usersCount} users, ${stats.body.devicesCount} devices, ${stats.body.pointsCount} points (DB size: ${stats.body.dbSizeFormatted})`);

    // 9. Admin Logout
    const logout = await request({
      hostname: 'localhost',
      port,
      path: '/api/admin/logout',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (logout.statusCode !== 200) throw new Error('Logout failed');
    console.log('✅ 9. Administrator logged out successfully');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ TEST ERROR:', err);
    process.exit(1);
  });
