(function() {
  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const btnFollow = document.getElementById('btnFollow');
  const btnShare = document.getElementById('btnShare');
  const btnSimulate = document.getElementById('btnSimulate');
  const btnHelp = document.getElementById('btnHelp');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const infoModal = document.getElementById('infoModal');
  const sessionSelect = document.getElementById('sessionSelect');
  const waitingBanner = document.getElementById('waitingBanner');

  const valSpeed = document.getElementById('valSpeed');
  const valDistance = document.getElementById('valDistance');
  const valAltitude = document.getElementById('valAltitude');
  const valBattery = document.getElementById('valBattery');
  const valDuration = document.getElementById('valDuration');
  const valSessionId = document.getElementById('valSessionId');
  const valLastUpdate = document.getElementById('valLastUpdate');

  let currentToken = new URLSearchParams(window.location.search).get('token') || '';
  let currentSessionId = getInitialSessionId();
  let followUser = true;
  let points = [];
  let totalDistanceMeters = 0;
  let sessionStartTime = null;
  let map, marker, polyline;
  let eventSource = null;
  let simInterval = null;

  function getInitialSessionId() {
    const path = window.location.pathname;
    if (path.startsWith('/live/')) {
      const parts = path.split('/');
      const id = parts[parts.length - 1];
      if (id && id.trim()) return id.trim();
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('id')) return params.get('id');
    return null;
  }

  // Initialize Leaflet Map with 100% Free Layers (No API Key Required)
  function initMap() {
    // Default view: Center on Europe / Italy initially
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true
    }).setView([45.4642, 9.1900], 13);

    // Zoom controls at top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Base Maps definition (All free, Open-Source, NO API KEY)
    const osmStandard = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    const openTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: 'Mappa: OpenTopoMap (CC-BY-SA)'
    });

    const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Immagini &copy; Esri'
    });

    // Default to OpenStreetMap Standard
    osmStandard.addTo(map);

    // Layer control (Switcher between OSM, Topo, Satellite)
    const baseMaps = {
      "🗺️ OpenStreetMap": osmStandard,
      "⛰️ OpenTopoMap (Outdoor)": openTopo,
      "🛰️ Satellite (Esri)": esriSatellite
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    // Live Track Polyline (Garmin orange)
    polyline = L.polyline([], {
      color: '#ff5722',
      weight: 5,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(map);

    // Custom pulsing marker for live watch position
    const liveIcon = L.divIcon({
      className: 'live-marker-icon',
      html: '<div class="live-marker-pulse"></div><div class="live-marker-circle"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    marker = L.marker([0, 0], { icon: liveIcon, opacity: 0 }).addTo(map);

    // Disable follow mode if user drags map manually
    map.on('dragstart', () => {
      followUser = false;
      btnFollow.style.backgroundColor = 'var(--surface-alt)';
    });
  }

  // Haversine formula to compute distance between coordinates in meters
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function addPoint(p) {
    const latLng = [p.lat, p.lon];

    if (waitingBanner) {
      waitingBanner.style.display = 'none';
    }

    if (points.length > 0) {
      const prev = points[points.length - 1];
      const dist = calculateDistance(prev.lat, prev.lon, p.lat, p.lon);
      if (dist > 1.5) {
        totalDistanceMeters += dist;
      }
    } else {
      if (!sessionStartTime) sessionStartTime = p.timestamp;
      map.setView(latLng, 16);
      marker.setOpacity(1);
    }

    points.push(p);
    polyline.addLatLng(latLng);
    marker.setLatLng(latLng);

    if (followUser) {
      map.panTo(latLng, { animate: true, duration: 0.8 });
    }

    // Update HUD metrics
    valSpeed.textContent = (p.speed !== null && p.speed !== undefined) ? p.speed : '0';
    valDistance.textContent = (totalDistanceMeters / 1000).toFixed(2);
    valAltitude.textContent = (p.altitude !== null && p.altitude !== undefined) ? p.altitude : '--';
    valBattery.textContent = (p.battery !== null && p.battery !== undefined) ? Math.round(p.battery) : '--';

    const date = new Date(p.timestamp);
    valLastUpdate.textContent = `Last fix: ${date.toLocaleTimeString()}`;
  }

  // Update timer HUD
  setInterval(() => {
    if (!sessionStartTime || points.length === 0) return;
    const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    const hrs = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    valDuration.textContent = `Time: ${hrs}:${mins}:${secs}`;
  }, 1000);

  function setSessionStatus(status) {
    if (status === 'live') {
      statusBadge.className = 'badge-live';
      statusBadge.innerHTML = '<span class="pulse-dot"></span> Live';
    } else if (status === 'ended') {
      statusBadge.className = 'badge-live badge-ended';
      statusBadge.innerHTML = 'Ended';
    } else {
      statusBadge.className = 'badge-live badge-waiting';
      statusBadge.innerHTML = 'Waiting';
    }
  }

  function resetSessionView(sessionId) {
    currentSessionId = sessionId;
    points = [];
    totalDistanceMeters = 0;
    sessionStartTime = null;
    polyline.setLatLngs([]);
    marker.setOpacity(0);

    valSpeed.textContent = '--';
    valDistance.textContent = '0.00';
    valAltitude.textContent = '--';
    valBattery.textContent = '--';
    valDuration.textContent = 'Time: 00:00:00';
    valSessionId.textContent = `ID: ${sessionId || '--'}`;
    valLastUpdate.textContent = 'Last fix: Waiting...';

    if (waitingBanner) {
      waitingBanner.style.display = 'flex';
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (sessionId) {
      loadSession(sessionId);
      connectSSE(sessionId);
    }
  }

  async function loadSession(id) {
    try {
      const url = `/api/sessions/${encodeURIComponent(id)}` + (currentToken ? `?token=${encodeURIComponent(currentToken)}` : '');
      const res = await fetch(url);
      if (res.status === 403) {
        if (waitingBanner) {
          waitingBanner.style.display = 'flex';
          waitingBanner.innerHTML = '🔒 <strong>Private Session:</strong> Viewing this LiveTrack session requires the full URL with access token sent by the tracker.';
        }
        setSessionStatus('waiting');
        return;
      }
      if (!res.ok) {
        setSessionStatus('waiting');
        return;
      }
      const data = await res.json();
      setSessionStatus(data.active ? 'live' : 'ended');
      if (data.startTime) sessionStartTime = data.startTime;

      if (data.points && data.points.length > 0) {
        data.points.forEach(p => addPoint(p));
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      }
    } catch (err) {
      console.error('Error fetching session:', err);
    }
  }

  function connectSSE(id) {
    if (eventSource) eventSource.close();
    const url = `/api/sessions/${encodeURIComponent(id)}/stream` + (currentToken ? `?token=${encodeURIComponent(currentToken)}` : '');
    eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'point') {
          addPoint(msg.point);
          setSessionStatus('live');
        } else if (msg.type === 'ended') {
          setSessionStatus('ended');
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      console.warn('SSE connection closed, will retry automatically...');
    };
  }

  // Populate session dropdown & check for new active sessions
  async function refreshSessionsList() {
    try {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();

      const prevValue = sessionSelect.value;
      sessionSelect.innerHTML = '';

      if (sessions.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No active sessions';
        sessionSelect.appendChild(opt);
        return;
      }

      sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        const stateStr = s.active ? '🟢 [LIVE]' : '⚪ [ENDED]';
        opt.textContent = `${stateStr} ${s.id} (${s.pointsCount} pt)`;
        sessionSelect.appendChild(opt);
      });

      // If current session not selected, select first active or previous
      if (currentSessionId && sessions.some(s => s.id === currentSessionId)) {
        sessionSelect.value = currentSessionId;
      } else if (!currentSessionId && sessions.length > 0) {
        // Auto select first session
        const first = sessions[0];
        sessionSelect.value = first.id;
        resetSessionView(first.id);
      }
    } catch (e) {
      console.error('Error fetching sessions list:', e);
    }
  }

  sessionSelect.addEventListener('change', (e) => {
    const selected = e.target.value;
    if (selected) {
      resetSessionView(selected);
      // Update browser URL without reloading
      window.history.pushState({}, '', `/live/${selected}`);
    }
  });

  // Follow button
  btnFollow.addEventListener('click', () => {
    followUser = !followUser;
    btnFollow.style.backgroundColor = followUser ? 'var(--primary)' : 'var(--surface-alt)';
    if (followUser && points.length > 0) {
      const last = points[points.length - 1];
      map.setView([last.lat, last.lon], 16);
    }
  });

  // Share button
  btnShare.addEventListener('click', async () => {
    let url = currentSessionId ? `${window.location.origin}/live/${currentSessionId}` : window.location.href;
    if (currentToken && !url.includes('token=')) {
      url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(currentToken)}`;
    }
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        btnShare.textContent = '✓ Copied!';
      } else {
        prompt('Copy this link:', url);
      }
    } catch (e) {
      prompt('Copy this link:', url);
    }
    setTimeout(() => {
      btnShare.textContent = '🔗 Share';
    }, 2500);
  });

  // Help Modal
  btnHelp.addEventListener('click', () => {
    infoModal.classList.add('active');
  });

  btnCloseModal.addEventListener('click', () => {
    infoModal.classList.remove('active');
  });

  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.remove('active');
  });

  // Test Simulation generator
  btnSimulate.addEventListener('click', async () => {
    if (simInterval) {
      clearInterval(simInterval);
      simInterval = null;
      btnSimulate.textContent = '▶ Simulate Demo';
      btnSimulate.classList.remove('btn-primary');
      return;
    }

    // Obtain demo API key and token via quick-setup
    let demoApiKey = '';
    try {
      const authRes = await fetch('/api/auth/quick-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@easylivetrack.local', name: 'Demo Runner' })
      });
      const authData = await authRes.json();
      demoApiKey = authData.apiKey;
    } catch (err) {
      console.warn('Could not auto-generate demo apiKey:', err);
    }

    const testId = 'demo-' + Math.random().toString(36).substring(2, 7);
    const demoToken = 'tok_' + Math.random().toString(36).substring(2, 8);
    currentToken = demoToken;

    resetSessionView(testId);
    window.history.pushState({}, '', `/live/${testId}?token=${demoToken}`);

    btnSimulate.textContent = '⏹ Stop Demo';
    btnSimulate.classList.add('btn-primary');

    // Start with coordinates in Central Park / NYC or Milan
    let lat = 45.4720;
    let lon = 9.1770;
    let speed = 12.0; // km/h
    let batt = 98;
    let alt = 125;
    let count = 0;

    simInterval = setInterval(async () => {
      count++;
      // Move in a gentle curve
      lat += 0.00025 + Math.sin(count * 0.2) * 0.0001;
      lon += 0.00035 + Math.cos(count * 0.2) * 0.0001;
      batt = Math.max(10, batt - 0.1);
      alt += (Math.random() - 0.5) * 2;
      const speedKnots = (speed / 1.852).toFixed(2);

      try {
        const query = new URLSearchParams({
          id: testId,
          lat: lat.toFixed(6),
          lon: lon.toFixed(6),
          speed: speedKnots,
          altitude: alt.toFixed(0),
          batt: Math.round(batt).toString(),
          timestamp: Date.now().toString(),
          token: demoToken
        });
        if (demoApiKey) query.set('key', demoApiKey);
        await fetch(`/?${query.toString()}`);
      } catch (e) {
        console.error(e);
      }

      if (count >= 50) {
        clearInterval(simInterval);
        simInterval = null;
        btnSimulate.textContent = '▶ Simulate Demo';
      }
    }, 2000);
  });

  // Start initialization
  initMap();
  btnFollow.style.backgroundColor = 'var(--primary)';

  if (currentSessionId) {
    valSessionId.textContent = `ID: ${currentSessionId}`;
    resetSessionView(currentSessionId);
  }

  refreshSessionsList();
  setInterval(refreshSessionsList, 5000);

})();
