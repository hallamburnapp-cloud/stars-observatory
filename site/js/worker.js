/* SGP4 propagation Web Worker.
 * Uses satellite.js (UMD) to build satrecs from TLEs and propagate all objects
 * to a given UTC epoch, returning ECI positions (km) as a Float32Array.
 * The main thread applies GMST rotation for the Earth-fixed render frame,
 * so we return raw ECI here.
 */
importScripts('./satellite.min.js');
const sat = self.satellite;

let satrecs = [];      // parsed satrec objects (null if TLE failed)
let count = 0;

// Orbital-regime classification from mean motion (rev/day) -> we store per-sat
// a regime code: 0 LEO, 1 MEO, 2 GEO, 3 HEO. Derived once at init.
let regimes = new Uint8Array(0);
let ok = new Uint8Array(0); // 1 if satrec valid

function classifyRegime(satrec) {
  // no (mean motion) is in radians/min in satrec. Period minutes = 2PI/no.
  const no = satrec.no; // rad/min
  if (!no || no <= 0) return 0;
  const periodMin = (2 * Math.PI) / no;
  const ecc = satrec.ecco;
  // Semi-major axis via period: a = (mu * (T*60/2pi)^2)^(1/3), mu=398600.4418
  const Tsec = periodMin * 60;
  const mu = 398600.4418;
  const a = Math.cbrt(mu * Math.pow(Tsec / (2 * Math.PI), 2)); // km
  const Re = 6378.137;
  const apogee = a * (1 + ecc) - Re;
  const perigee = a * (1 - ecc) - Re;
  // HEO: high eccentricity with large apogee/perigee spread
  if (ecc > 0.25 && apogee > 25000) return 3; // HEO
  // GEO: near geosynchronous altitude
  if (apogee >= 33000 && apogee <= 38000 && perigee > 30000) return 2; // GEO
  if (apogee < 2000) return 0; // LEO
  if (apogee >= 2000 && apogee < 33000) return 1; // MEO
  return 3; // HEO fallback (very high)
}

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'init') {
    // msg.tles: flat array of [tle1, tle2] pairs => we receive two arrays
    const t1 = msg.tle1, t2 = msg.tle2;
    count = t1.length;
    satrecs = new Array(count);
    regimes = new Uint8Array(count);
    ok = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      try {
        const r = sat.twoline2satrec(t1[i], t2[i]);
        if (r && !r.error) {
          satrecs[i] = r;
          ok[i] = 1;
          regimes[i] = classifyRegime(r);
        } else {
          satrecs[i] = null; ok[i] = 0;
        }
      } catch (err) {
        satrecs[i] = null; ok[i] = 0;
      }
    }
    self.postMessage({ type: 'ready', count: count, regimes: regimes.buffer, ok: ok.buffer },
      [regimes.buffer, ok.buffer]);
    // regimes/ok buffers were transferred; rebuild local copies for our use
    return;
  }

  if (msg.type === 'propagate') {
    const t = msg.time; // ms since epoch (UTC)
    const date = new Date(t);
    const gmst = sat.gstime(date);
    const positions = new Float32Array(count * 3); // ECI km
    const alive = new Uint8Array(count); // 1 if valid position this frame
    for (let i = 0; i < count; i++) {
      const r = satrecs[i];
      if (!r) { continue; }
      let pv;
      try { pv = sat.propagate(r, date); } catch (err) { continue; }
      if (!pv || !pv.position || typeof pv.position.x !== 'number' ||
          isNaN(pv.position.x)) { continue; }
      const p = pv.position; // ECI km
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      alive[i] = 1;
    }
    self.postMessage({ type: 'positions', time: t, gmst: gmst,
      positions: positions.buffer, alive: alive.buffer },
      [positions.buffer, alive.buffer]);
    return;
  }

  // Propagate a small named set (for the Article IX scenario) returning ECI track
  if (msg.type === 'track') {
    const idxs = msg.indices;
    const times = msg.times; // array of ms
    const out = [];
    for (let k = 0; k < idxs.length; k++) {
      const r = satrecs[idxs[k]];
      const track = new Float32Array(times.length * 3);
      if (r) {
        for (let j = 0; j < times.length; j++) {
          try {
            const pv = sat.propagate(r, new Date(times[j]));
            if (pv && pv.position && !isNaN(pv.position.x)) {
              track[j * 3] = pv.position.x;
              track[j * 3 + 1] = pv.position.y;
              track[j * 3 + 2] = pv.position.z;
            }
          } catch (e2) {}
        }
      }
      out.push(track.buffer);
    }
    self.postMessage({ type: 'tracks', tag: msg.tag || 'scen', tracks: out }, out);
    return;
  }
};
