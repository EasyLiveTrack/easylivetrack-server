/**
 * Generate standard GPX 1.1 XML string for Strava, Garmin Connect, and GIS applications.
 *
 * @param {Object} session - Session object containing points array
 * @returns {string|null} GPX XML string or null if empty
 */
function generateGpx(session) {
  if (!session || !session.points || session.points.length === 0) {
    return null;
  }

  const startTimeIso = new Date(session.startTime).toISOString();
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="EasyLiveTrack" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>EasyLiveTrack Session ${session.id}</name>
    <time>${startTimeIso}</time>
  </metadata>
  <trk>
    <name>Track ${session.id}</name>
    <trkseg>
`;

  for (const p of session.points) {
    const timeIso = new Date(p.timestamp).toISOString();
    gpx += `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">\n`;
    if (p.altitude !== null && p.altitude !== undefined) {
      gpx += `        <ele>${p.altitude}</ele>\n`;
    }
    gpx += `        <time>${timeIso}</time>\n`;
    if (p.speed !== null && p.speed !== undefined) {
      const speedMs = (p.speed / 3.6).toFixed(2);
      gpx += `        <speed>${speedMs}</speed>\n`;
    }
    gpx += `      </trkpt>\n`;
  }

  gpx += `    </trkseg>
  </trk>
</gpx>`;

  return gpx;
}

module.exports = {
  generateGpx
};
