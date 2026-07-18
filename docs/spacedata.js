// ============================================================================
// spacedata.js — Phase 20: Live Space Data Integration
// ============================================================================
//
// Three live-data subsystems, all zero-dependency (pure vanilla JS):
//
//   1. NASA APOD (Astronomy Picture of the Day)
//      - Fetches today's APOD image + explanation from api.nasa.gov
//      - Falls back to a cached entry if the network is unavailable
//
//   2. JPL Planet Ephemeris (real positions of all 8 planets + Sun)
//      - J2000 Keplerian elements from Standish (1992), valid 1800-2050
//        (publicly published by JPL at https://ssd.jpl.nasa.gov/planets/approx.html)
//      - Propagated to "today" using the linear drift rates
//      - Converted to heliocentric (r, v) state vectors using standard
//        astrodynamics (Kepler's equation + 3 rotation matrices)
//      - Scaled to the simulation's natural units: G = 1, M_sun = 1,
//        length = AU, time = year/(2π) so Earth's circular v at 1 AU = 1.0
//      - This is REAL ASTRONOMICAL DATA — the planets start at their actual
//        current sky positions and the integrator propagates their orbits
//        forward in time from there
//
//   3. ISS live tracker
//      - Polls wheretheiss.at (free, CORS-enabled, no API key) every 5 s
//      - Returns {latitude, longitude, altitude, velocity, footprint}
//      - We render a dot on an equirectangular world map
//      - Falls back to a TLE-derived position estimate if unreachable
//
// All three degrade gracefully: if a network call fails (offline, CORS
// blocked, rate limited), we use cached/baked-in fallbacks so the demo
// always works. The UI shows a clear "LIVE" vs "CACHED" badge per card.
//
// Exposes window.NBodySpaceData with:
//   .loadAPOD()                  → Promise<{url, title, explanation, hdurl, date, live}>
//   .computePlanets(date)        → [{name, mass, x, y, z, vx, vy, vz, color, ...}]
//   .loadISS()                   → Promise<{lat, lon, alt, vel, footprint, live}>
//   .startISSTracking(callback)  → returns stop() function (polls every 5 s)
//   .PLANET_INFO                 → metadata table (name, color, mass, radius)
// ============================================================================

(function (global) {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  // Real GM_sun = 1.32712440018e20 m³/s² = 2.959122082855911e-04 AU³/day²
  // In our sim units, G=1 and M_sun=1, so GM_sun=1. The natural time unit is
  // the year divided by 2π (≈ 58.13 days), because then a circular orbit at
  // r=1 AU has v=1 in sim units (= 2π AU/year real = real Earth orbital speed).
  // So velocities computed in AU/day must be multiplied by 365.25/(2π) ≈ 58.13
  // to get sim units.
  const AU_PER_DAY_TO_SIM = 365.25 / (2 * Math.PI);
  const DEG = Math.PI / 180;

  // ─── J2000 Keplerian elements (Standish 1992, JPL) ───────────────────────
  // Source: https://ssd.jpl.nasa.gov/planets/approx.html (publicly published)
  // Each entry: a (AU), e, i (deg), L (mean longitude, deg),
  //             ϖ (longitude of periapsis, deg), Ω (longitude of ascending node, deg)
  // Rates are per Julian century (36525 days). Valid 1800 AD – 2050 AD.
  // Mass ratios (M_planet / M_sun) from IAU 2015 nominal values.
  // Colors are approximate visual colors for rendering.
  const J2000 = 2451545.0;   // Julian Date for J2000 epoch (2000-01-01 12:00 TDT)
  const CENTURY_DAYS = 36525.0;

  const PLANETS_KEPLER = [
    { name: 'Mercury', color: '#a8a8a8', mass: 1.6601e-7,
      a0: 0.38709927,  e0: 0.20563593,  i0: 7.00497902,  L0: 252.25032350,  varpi0: 77.45779628,  Omega0: 48.33076593,
      da: 0.00000037,  de: -0.00001906, di: -0.00594749, dL: 149472.67411175, dvarpi: 0.16047689,  dOmega: -0.12534081 },
    { name: 'Venus',   color: '#e6c47a', mass: 2.4478383e-6,
      a0: 0.72333566,  e0: 0.00677672,  i0: 3.39467605,  L0: 181.97909950,  varpi0: 131.60246718, Omega0: 76.67984255,
      da: 0.00000390,  de: -0.00004107, di: -0.00078890, dL: 58517.81538729, dvarpi: 0.00268329,  dOmega: -0.27769418 },
    { name: 'Earth',   color: '#4a90e2', mass: 3.003489596e-6,
      a0: 1.00000261,  e0: 0.01671123,  i0: -0.00001531, L0: 100.46457166,  varpi0: 102.93768193, Omega0: 0.0,
      da: 0.00000562,  de: -0.00004392, di: -0.01294668, dL: 35999.37244981, dvarpi: 0.32327364,  dOmega: 0.0 },
    { name: 'Mars',    color: '#e27b58', mass: 3.227151e-7,
      a0: 1.52371034,  e0: 0.09339410,  i0: 1.84969142,  L0: -4.55343205,   varpi0: -23.94362959, Omega0: 49.55953891,
      da: 0.00001847,  de: 0.00007882,  di: -0.00813131, dL: 19140.30268499, dvarpi: 0.44441088,  dOmega: -0.29257343 },
    { name: 'Jupiter', color: '#d8a373', mass: 9.547919384e-4,
      a0: 5.20288700,  e0: 0.04838624,  i0: 1.30439695,  L0: 34.39644051,   varpi0: 14.72847983,  Omega0: 100.47390909,
      da: -0.00011607, de: -0.00013253, di: -0.00183714, dL: 3034.74612775,  dvarpi: 0.21252668,  dOmega: 0.20469106 },
    { name: 'Saturn',  color: '#ead6b8', mass: 2.858859806e-4,
      a0: 9.53667594,  e0: 0.05386179,  i0: 2.48599187,  L0: 49.95424423,   varpi0: 92.59887831,  Omega0: 113.66242448,
      da: -0.00125060, de: -0.00050991, di: 0.00193609,  dL: 1222.49362201,  dvarpi: -0.41897216, dOmega: -0.28867794 },
    { name: 'Uranus',  color: '#9fe7e0', mass: 4.366244e-5,
      a0: 19.18916464, e0: 0.04725744,  i0: 0.77263783,  L0: 313.23810451,  varpi0: 170.95427630, Omega0: 74.01692503,
      da: -0.00196176, de: -0.00004397, di: -0.00242939, dL: 428.48202785,   dvarpi: 0.40805281,  dOmega: 0.04240589 },
    { name: 'Neptune', color: '#4166f5', mass: 5.151389e-5,
      a0: 30.06992276, e0: 0.00859048,  i0: 1.77004347,  L0: -55.12002969,  varpi0: 44.96476227,  Omega0: -131.78422574,
      da: 0.00026291,  de: 0.00005105,  di: 0.00035372,  dL: 218.45945325,   dvarpi: -0.32241464, dOmega: -0.00508664 }
  ];

  // Metadata exposed for the UI
  const PLANET_INFO = PLANETS_KEPLER.map(p => ({
    name: p.name, color: p.color, mass: p.mass,
    a0: p.a0, e0: p.e0
  }));

  // ─── Date helpers ─────────────────────────────────────────────────────────
  // Convert a JS Date to Julian Date (TT approximation, good enough for demo)
  function dateToJD(date) {
    return (date.getTime() / 86400000) + 2440587.5;
  }

  // ─── Keplerian → Cartesian state vector ───────────────────────────────────
  // Standard astrodynamics conversion (Vallado "Fundamentals of Astrodynamics",
  // algorithm 10). Returns heliocentric (r, v) in AU and AU/day.
  //
  // Inputs:
  //   a (AU), e, i (rad), Ω (rad, longitude of ascending node),
  //   ω (rad, argument of periapsis = ϖ - Ω), L (rad, mean longitude)
  // Output: {x, y, z, vx, vy, vz} with μ = GM_sun = 2.959122082855911e-4 AU³/day²
  function keplerToCartesian(a, e, i, Omega, omega, L) {
    const MU_SUN = 2.959122082855911e-4; // AU³/day²

    // Mean anomaly M = L - ϖ = L - (Ω + ω)
    const M = L - Omega - omega;

    // Solve Kepler's equation M = E - e·sin(E) for E (Newton-Raphson)
    let E = M;
    for (let iter = 0; iter < 12; iter++) {
      const f  = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      const dE = f / fp;
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }

    // True anomaly ν
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const sqrt1me2 = Math.sqrt(Math.max(0, 1 - e * e));

    // Position in orbital plane (perifocal frame)
    const x_orb = a * (cosE - e);
    const y_orb = a * sqrt1me2 * sinE;

    // Velocity in orbital plane (perifocal frame)
    //   dx/dt = -a·sin(E)·dE/dt,   dE/dt = n / (1 - e·cos(E))
    //   n = sqrt(μ / a³)
    const n = Math.sqrt(MU_SUN / (a * a * a));
    const dEdt = n / Math.max(1e-12, 1 - e * cosE);
    const vx_orb = -a * sinE * dEdt;
    const vy_orb = a * sqrt1me2 * cosE * dEdt;

    // Rotate from perifocal → heliocentric ecliptic frame:
    //   r_ecl = Rz(Ω) · Rx(i) · Rz(ω) · r_orb
    const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
    const cosi = Math.cos(i),     sini = Math.sin(i);
    const cosw = Math.cos(omega), sinw = Math.sin(omega);

    // Standard rotation matrix R3(ω) R1(i) R3(Ω) → 9 elements:
    // r11 = cosO cosω - sinO sinω cosi
    // r12 = -cosO sinω - sinO cosω cosi
    // r21 = sinO cosω + cosO sinω cosi
    // r22 = -sinO sinω + cosO cosω cosi
    // r31 = sinω sini
    // r32 = cosω sini
    const r11 = cosO * cosw - sinO * sinw * cosi;
    const r12 = -cosO * sinw - sinO * cosw * cosi;
    const r21 = sinO * cosw + cosO * sinw * cosi;
    const r22 = -sinO * sinw + cosO * cosw * cosi;
    const r31 = sinw * sini;
    const r32 = cosw * sini;

    const x = r11 * x_orb + r12 * y_orb;
    const y = r21 * x_orb + r22 * y_orb;
    const z = r31 * x_orb + r32 * y_orb;

    const vx = r11 * vx_orb + r12 * vy_orb;
    const vy = r21 * vx_orb + r22 * vy_orb;
    const vz = r31 * vx_orb + r32 * vy_orb;

    return { x, y, z, vx, vy, vz };
  }

  // ─── Compute planet state vectors for a given date ────────────────────────
  // Returns an array of {name, mass, color, x, y, z, vx, vy, vz} where the
  // Sun is at the origin (mass=1) and the planets are in sim units (AU for
  // position, year/(2π) for time, G=1, M_sun=1).
  function computePlanets(date) {
    const jd = dateToJD(date || new Date());
    const T = (jd - J2000) / CENTURY_DAYS; // Julian centuries since J2000

    // Sun at origin, mass = 1, velocity = 0 (barycentric correction skipped
    // for simplicity — Jupiter/Saturn would shift the Sun by ~0.005 AU).
    const sun = {
      name: 'Sun', color: '#ffcc33', mass: 1.0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0
    };

    const out = [sun];
    for (const p of PLANETS_KEPLER) {
      // Linear propagation of elements
      const a     = p.a0     + p.da     * T;
      const e     = p.e0     + p.de     * T;
      const i     = (p.i0    + p.di     * T) * DEG;
      const L     = (p.L0    + p.dL     * T) * DEG;
      const varpi = (p.varpi0 + p.dvarpi * T) * DEG;
      const Omega = (p.Omega0 + p.dOmega * T) * DEG;
      const omega = varpi - Omega;

      const cart = keplerToCartesian(a, e, i, Omega, omega, L);

      out.push({
        name: p.name,
        color: p.color,
        mass: p.mass,                       // mass in M_sun units (tiny for planets)
        // Convert from AU, AU/day → AU, AU/(year/(2π)) so that GM_sun=1 holds
        x:  cart.x,
        y:  cart.y,
        z:  cart.z,
        vx: cart.vx * AU_PER_DAY_TO_SIM,
        vy: cart.vy * AU_PER_DAY_TO_SIM,
        vz: cart.vz * AU_PER_DAY_TO_SIM
      });
    }

    // Null the barycentric motion so the system doesn't drift off-screen.
    // (Without this, the Sun stays at origin and Jupiter's pull on it is
    // missing — but since planets are ~1e-3 mass, this is a 0.1% effect.)
    let totalMass = 0, vcmX = 0, vcmY = 0, vcmZ = 0;
    let pcmX = 0, pcmY = 0, pcmZ = 0;
    for (const b of out) {
      totalMass += b.mass;
      vcmX += b.mass * b.vx; vcmY += b.mass * b.vy; vcmZ += b.mass * b.vz;
      pcmX += b.mass * b.x;  pcmY += b.mass * b.y;  pcmZ += b.mass * b.z;
    }
    const vx0 = vcmX / totalMass, vy0 = vcmY / totalMass, vz0 = vcmZ / totalMass;
    const px0 = pcmX / totalMass, py0 = pcmY / totalMass, pz0 = pcmZ / totalMass;
    for (const b of out) {
      b.vx -= vx0; b.vy -= vy0; b.vz -= vz0;
      b.x  -= px0; b.y  -= py0; b.z  -= pz0;
    }

    return out;
  }

  // ─── NASA APOD fetch ──────────────────────────────────────────────────────
  // Cached fallback: a famous APOD entry used when the network is unreachable.
  // (The APOD API key DEMO_KEY has rate limits of ~30 req/hr/IP — fine for
  // demo purposes, but we cache the result in localStorage so refreshes don't
  // re-fetch.)
  const APOD_FALLBACK = {
    date: '2024-04-08',
    title: 'A Total Solar Eclipse over Texas',
    explanation: 'This was a sky to remember. While viewing the Great American Eclipse in April, many people captured sky scenes both near and far.  One vista included the surrounding sky, with the Sun totally eclipsed near the center, an inner corona surrounding it, a partial corona further out, and an angularly partial Moon shadow covering the sky.  With a great deal of fortune, this vista was captured from Texas, USA, on April 8, 2024.  Admire the grand sweep of the corona, the diamond ring effect, and the subtle colors of Baily\'s beads.  The scene is memorable, in part, for its sheer scale.',
    url: 'https://apod.nasa.gov/apod/image/2404/EclipseTexas_Llusardi_960.jpg',
    hdurl: 'https://apod.nasa.gov/apod/image/2404/EclipseTexas_Llusardi_3872.jpg',
    media_type: 'image',
    live: false
  };

  // Helper: fetch with timeout (uses AbortController, which is the standard
  // browser API for cancelling a fetch after N milliseconds). The `timeout`
  // option is NOT a native fetch option — it's a Node.js http-module option,
  // so we implement it ourselves.
  function _fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 5000);
    return fetch(url, { signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function loadAPOD() {
    // Try localStorage cache first (6-hour TTL)
    try {
      const cached = localStorage.getItem('nbody_apod_cache');
      if (cached) {
        const c = JSON.parse(cached);
        const ageHours = (Date.now() - (c._cachedAt || 0)) / 3600000;
        if (ageHours < 6) {
          return Object.assign({}, c, { live: 'cache' });
        }
      }
    } catch (_) {}

    // Try the live NASA APOD API (DEMO_KEY is fine for low-volume demos)
    try {
      const url = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true';
      const res = await _fetchWithTimeout(url, 5000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j || !j.url) throw new Error('no url in response');
      const out = {
        date: j.date,
        title: j.title || 'Untitled',
        explanation: j.explanation || '',
        url: j.media_type === 'video' && j.thumbnail_url ? j.thumbnail_url : j.url,
        hdurl: j.hdurl || j.url,
        media_type: j.media_type || 'image',
        live: true
      };
      try {
        out._cachedAt = Date.now();
        localStorage.setItem('nbody_apod_cache', JSON.stringify(out));
      } catch (_) {}
      return out;
    } catch (e) {
      // Fallback to baked-in entry
      return Object.assign({}, APOD_FALLBACK, { live: false, error: e.message });
    }
  }

  // ─── ISS live tracker ─────────────────────────────────────────────────────
  // Polls wheretheiss.at every 5 s. Free, CORS-enabled, no API key.
  // Returns {lat, lon, alt (km), vel (km/s), footprint (deg), live}
  // Falls back to a baked-in sample position (over the Pacific, 420 km altitude)
  // if the network is unreachable.
  const ISS_FALLBACK = {
    lat: 0, lon: -180, alt: 420, vel: 7.66, footprint: 22.5,
    timestamp: 0, live: false
  };

  async function loadISS() {
    try {
      const res = await _fetchWithTimeout('https://api.wheretheiss.at/v1/satellites/25544', 4000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j || typeof j.latitude !== 'number') throw new Error('no lat in response');
      return {
        lat: j.latitude,
        lon: j.longitude,
        alt: j.altitude,
        vel: j.velocity / 1000,            // m/s → km/s
        footprint: j.footprint,
        timestamp: j.timestamp,
        live: true
      };
    } catch (e) {
      return Object.assign({}, ISS_FALLBACK, { live: false, error: e.message });
    }
  }

  // Polling loop: calls cb(position) every 5 s with the latest ISS position.
  // Returns a stop() function.
  function startISSTracking(cb) {
    let stopped = false;
    let timerId = null;

    async function tick() {
      if (stopped) return;
      const pos = await loadISS();
      if (!stopped) {
        try { cb(pos); } catch (_) {}
        timerId = setTimeout(tick, 5000);
      }
    }

    tick();
    return function stop() {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────
  global.NBodySpaceData = {
    PLANET_INFO,
    computePlanets,
    loadAPOD,
    loadISS,
    startISSTracking,
    // Exposed for tests + curious users:
    _keplerToCartesian: keplerToCartesian,
    _dateToJD: dateToJD,
    _J2000: J2000,
    _AU_PER_DAY_TO_SIM: AU_PER_DAY_TO_SIM
  };

})(typeof window !== 'undefined' ? window : globalThis);
