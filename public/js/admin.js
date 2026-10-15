(function() {
  const loginView = document.getElementById('loginView');
  const dashboardView = document.getElementById('dashboardView');
  const formLogin = document.getElementById('formLogin');
  const inputPassword = document.getElementById('inputPassword');
  const loginError = document.getElementById('loginError');
  const btnLogout = document.getElementById('btnLogout');

  const statDevices = document.getElementById('statDevices');
  const statActiveSessions = document.getElementById('statActiveSessions');
  const statPoints = document.getElementById('statPoints');
  const statDbSize = document.getElementById('statDbSize');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const selectRegMode = document.getElementById('selectRegMode');
  const btnSaveMode = document.getElementById('btnSaveMode');
  const formAddWhitelist = document.getElementById('formAddWhitelist');
  const inputNewEmail = document.getElementById('inputNewEmail');
  const inputNewNotes = document.getElementById('inputNewNotes');
  const whitelistTableBody = document.getElementById('whitelistTableBody');

  const btnCreatePairing = document.getElementById('btnCreatePairing');
  const pairingBox = document.getElementById('pairingBox');
  const pairingCodeVal = document.getElementById('pairingCodeVal');
  const devicesTableBody = document.getElementById('devicesTableBody');

  const sessionsTableBody = document.getElementById('sessionsTableBody');

  const formChangePassword = document.getElementById('formChangePassword');
  const inputNewPassword = document.getElementById('inputNewPassword');
  const passwordMsg = document.getElementById('passwordMsg');

  // Check login state on initial load
  checkAuth();

  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const stats = await res.json();
        showDashboard(stats);
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    loginView.style.display = 'block';
    dashboardView.style.display = 'none';
    btnLogout.style.display = 'none';
  }

  function showDashboard(stats) {
    loginView.style.display = 'none';
    dashboardView.style.display = 'block';
    btnLogout.style.display = 'inline-block';

    updateStats(stats);
    loadWhitelist();
    loadDevices();
    loadSessions();
  }

  function updateStats(stats) {
    if (!stats) return;
    statDevices.textContent = stats.devicesCount || '0';
    statActiveSessions.textContent = stats.activeSessionsCount || '0';
    statPoints.textContent = stats.pointsCount || '0';
    statDbSize.textContent = stats.dbSizeFormatted || '--';
    if (stats.registrationMode) {
      selectRegMode.value = stats.registrationMode;
    }
  }

  // Handle Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: inputPassword.value })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        inputPassword.value = '';
        checkAuth();
      } else {
        loginError.textContent = data.error || 'Incorrect password';
        loginError.style.display = 'block';
      }
    } catch (err) {
      loginError.textContent = 'Server connection error';
      loginError.style.display = 'block';
    }
  });

  // Handle Logout
  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    showLogin();
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // Load Whitelist
  async function loadWhitelist() {
    try {
      const res = await fetch('/api/admin/whitelist');
      if (!res.ok) return;
      const data = await res.json();
      selectRegMode.value = data.mode || 'whitelist';

      if (!data.whitelist || data.whitelist.length === 0) {
        whitelistTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">No email addresses in whitelist.</td></tr>';
        return;
      }

      whitelistTableBody.innerHTML = data.whitelist.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.email)}</strong></td>
          <td>${new Date(item.added_at).toLocaleString()}</td>
          <td style="color:var(--text-secondary);">${escapeHtml(item.notes || '--')}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="removeWhitelistEmail('${encodeURIComponent(item.email)}')">Remove</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error(err);
    }
  }

  // Add to Whitelist
  formAddWhitelist.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = inputNewEmail.value.trim();
    const notes = inputNewNotes.value.trim();

    try {
      const res = await fetch('/api/admin/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, notes })
      });
      if (res.ok) {
        inputNewEmail.value = '';
        inputNewNotes.value = '';
        loadWhitelist();
      }
    } catch (err) {
      alert('Error adding email to whitelist');
    }
  });

  // Global helper for remove button in whitelist table
  window.removeWhitelistEmail = async function(encodedEmail) {
    if (!confirm('Are you sure you want to remove this email address from the whitelist?')) return;
    try {
      const res = await fetch(`/api/admin/whitelist/${encodedEmail}`, { method: 'DELETE' });
      if (res.ok) loadWhitelist();
    } catch (e) {
      alert('Error removing email');
    }
  };

  // Save Registration Mode
  btnSaveMode.addEventListener('click', async () => {
    const mode = selectRegMode.value;
    try {
      const res = await fetch('/api/admin/registration-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      if (res.ok) {
        alert('Registration mode updated to: ' + mode);
      }
    } catch (e) {
      alert('Error saving registration mode');
    }
  });

  // Load Devices
  async function loadDevices() {
    try {
      const res = await fetch('/api/admin/devices');
      if (!res.ok) return;
      const devices = await res.json();

      if (!devices || devices.length === 0) {
        devicesTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">No devices registered.</td></tr>';
        return;
      }

      devicesTableBody.innerHTML = devices.map(d => {
        const lastSeenStr = d.last_seen ? new Date(d.last_seen).toLocaleString() : 'Never connected';
        const maskedKey = d.api_key ? d.api_key.substring(0, 14) + '...' + d.api_key.slice(-6) : '--';
        return `
          <tr>
            <td><strong>${escapeHtml(d.device_name || 'Device')}</strong><br><small style="color:var(--text-secondary);">${escapeHtml(d.device_id)}</small></td>
            <td>${escapeHtml(d.user_email || '--')}</td>
            <td><code>${maskedKey}</code></td>
            <td>${lastSeenStr}</td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="revokeDevice('${encodeURIComponent(d.device_id)}')">Revoke Key</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  }

  window.revokeDevice = async function(deviceId) {
    if (!confirm('Are you sure you want to revoke this API key? The device will not be able to transmit data until re-paired.')) return;
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}`, { method: 'DELETE' });
      if (res.ok) loadDevices();
    } catch (e) {
      alert('Error revoking device key');
    }
  };

  // Create Pairing Code
  btnCreatePairing.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/pairing/create', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.code) {
        pairingCodeVal.textContent = data.code;
        pairingBox.style.display = 'block';
      }
    } catch (e) {
      alert('Error creating pairing code');
    }
  });

  // Load Sessions
  async function loadSessions() {
    try {
      const res = await fetch('/api/admin/sessions');
      if (!res.ok) return;
      const sessions = await res.json();

      if (!sessions || sessions.length === 0) {
        sessionsTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary);">No tracks recorded yet.</td></tr>';
        return;
      }

      sessionsTableBody.innerHTML = sessions.map(s => {
        const startStr = s.start_time ? new Date(s.start_time).toLocaleString() : '--';
        const statusBadge = s.active ? '<span class="badge badge-green">LIVE</span>' : '<span class="badge" style="background:#455A64; color:#fff;">ENDED</span>';
        const viewLink = `/live/${encodeURIComponent(s.id)}?token=${encodeURIComponent(s.view_token)}`;

        return `
          <tr>
            <td>
              <a href="${viewLink}" target="_blank" style="color:var(--primary); font-weight:700; text-decoration:none;">${escapeHtml(s.id)} ↗</a>
            </td>
            <td>${escapeHtml(s.user_email || 'Anonymous')}</td>
            <td>${s.pointsCount || 0} pt</td>
            <td>${startStr}</td>
            <td>${statusBadge}</td>
            <td>
              <a href="/api/sessions/${encodeURIComponent(s.id)}/export.gpx" class="btn btn-success btn-sm" style="text-decoration:none; display:inline-block; padding:4px 8px; font-size:0.75rem;">⬇ GPX</a>
              <button class="btn btn-danger btn-sm" onclick="deleteTrackSession('${encodeURIComponent(s.id)}')">🗑</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  }

  window.deleteTrackSession = async function(sessionId) {
    if (!confirm('Permanently delete this session and all its recorded GPS points?')) return;
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) loadSessions();
    } catch (e) {
      alert('Error deleting session');
    }
  };

  // Change Admin Password
  formChangePassword.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordMsg.textContent = '';
    const newPassword = inputNewPassword.value.trim();

    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        inputNewPassword.value = '';
        passwordMsg.style.color = '#00E676';
        passwordMsg.textContent = '✓ Password updated successfully!';
      } else {
        passwordMsg.style.color = '#FF5252';
        passwordMsg.textContent = data.error || 'Update failed';
      }
    } catch (err) {
      passwordMsg.style.color = '#FF5252';
      passwordMsg.textContent = 'Connection error';
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
