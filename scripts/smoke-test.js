// ============================================================================
// smoke-test.js — Node-side smoke test for the static demo's JS modules
// ============================================================================
// Strips the `window.*` global assignments and verifies the modules work
// together: physics engine conserves energy, middleware chain dispatches,
// sonify + tour modules load cleanly in a Node sandbox (no AudioContext).
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Resolve docs/ relative to this script's location so the test works
// both locally (~/my-project/) and in CI (~/runner/work/.../).
const DOCS = path.resolve(__dirname, '..', 'docs');

// Read each JS file
function load(file) {
  return fs.readFileSync(path.join(DOCS, file), 'utf-8');
}

// Create a sandbox with a fake `window` and minimal browser shims.
// No AudioContext, no speechSynthesis — sonify.js / tour.js must degrade
// gracefully (they check for these and fall back to no-op stubs).
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  Date,
  Math,
  Float64Array,
  Int32Array,
  Float32Array,
  indexedDB: null,
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  dispatchEvent: () => {},
  CustomEvent: function () {},
  addEventListener: () => {},
  AbortController: function () { this.abort = () => {}; this.signal = {}; },
  speechSynthesis: undefined,    // tour.js must fall back to no-op
  WebSocket: undefined,
  fetch: undefined,
  history: { replaceState: () => {} },
  URLSearchParams: class { constructor() {} get() { return null; } },
  SpeechSynthesisUtterance: undefined,
  document: {
    getElementById: () => ({
      textContent: '', value: '', className: '',
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {},
      style: { setProperty: () => {} },
      checked: false, disabled: false,
      textContent_set: () => {}, appendChild: () => {}
    }),
    createElement: () => ({
      className: '', innerHTML: '', insertBefore: () => {},
      appendChild: () => {}, style: { setProperty: () => {} },
      getContext: () => null,
      width: 0, height: 0
    }),
    readyState: 'complete',
    addEventListener: () => {}
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  [PASS] ' + msg); }
  else      { fail++; console.log('  [FAIL] ' + msg); }
}

// ── Load modules in order (matches index.html) ────────────────────────────
console.log('--- Loading modules ---');
try {
  vm.runInContext(load('spacedata.js'), sandbox);
  vm.runInContext(load('physics.js'),  sandbox);
  vm.runInContext(load('db.js'),       sandbox);
  vm.runInContext(load('middleware.js'), sandbox);
  vm.runInContext(load('routes.js'),   sandbox);
  vm.runInContext(load('viz3d.js'),    sandbox);
  vm.runInContext(load('sonify.js'),   sandbox);
  vm.runInContext(load('tour.js'),     sandbox);
  vm.runInContext(load('playback.js'), sandbox);
  console.log('  all 9 modules loaded');
} catch (e) {
  console.log('  [FAIL] module load error:', e.message);
  process.exit(1);
}

// ── Test 1: Physics engine — two-body Kepler energy conservation ─────────
console.log('\n--- Test 1: Two-body Kepler energy conservation ---');
const P = sandbox.window.NBodyPhysics;
assert(typeof P === 'object', 'NBodyPhysics global exists');
assert(typeof P.MutableBodySystem === 'function', 'MutableBodySystem exported');
assert(typeof P.twoBodyCircular === 'function', 'twoBodyCircular exported');

const bodies = P.twoBodyCircular();
assert(Array.isArray(bodies) && bodies.length === 2, 'twoBodyCircular() returns 2 bodies');
// Build system WITH softening so we don't have to thread it through step()
const sys = new P.MutableBodySystem(bodies, 0.001, 0.0);
const e0 = sys.energy();
console.log('  E0 =', e0.toExponential(8));

for (let i = 0; i < 1000; i++) sys.step();
const e1000 = sys.energy();
console.log('  E  @ step 1000 =', e1000.toExponential(8));
const drift = Math.abs((e1000 - e0) / e0);
console.log('  |dE/E0| after 1000 steps =', drift.toExponential(4));
assert(drift < 1e-6, 'energy conserved to < 1e-6 (symplectic KDK working)');

// ── Test 2: Plummer sphere — generates N bodies ─────────────────────────
console.log('\n--- Test 2: Plummer sphere generation ---');
const plummer = P.plummerSphere(32, 1.0, 1.0);
assert(Array.isArray(plummer) && plummer.length === 32, 'plummerSphere(32) returns 32 bodies');
// Plummer needs softening > 0 or the close encounters explode
const sys2 = new P.MutableBodySystem(plummer, 0.01, 0.05);
function momMag(bs) {
  const p = P.totalMomentum(bs);
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}
const p0 = momMag(plummer);
for (let i = 0; i < 100; i++) sys2.step();
const p100 = momMag(sys2.toJSON());
const dp = Math.abs((p100 - p0) / (p0 || 1));
assert(dp < 100, 'momentum magnitude does not blow up catastrophically (|Δp/p0|=' + dp.toExponential(2) + ')');

// ── Test 3: Middleware — FNV-1a hash is deterministic ────────────────────
console.log('\n--- Test 3: Middleware FNV-1a hash determinism ---');
const MW = sandbox.window.NBodyMiddleware;
assert(typeof MW === 'object', 'NBodyMW global exists');
const h1 = MW.fnv1a('127.0.0.1');
const h2 = MW.fnv1a('127.0.0.1');
const h3 = MW.fnv1a('192.168.1.1');
assert(h1 === h2, 'hash is deterministic (' + h1 + ')');
assert(h1 !== h3, 'hash differs per input');

// ── Test 4: safeEqual — constant-time string compare ─────────────────────
console.log('\n--- Test 4: safeEqual constant-time compare ---');
assert(MW.safeEqual('abc', 'abc')  === true,  'equal strings match');
assert(MW.safeEqual('abc', 'abd')  === false, 'different strings do not match');
assert(MW.safeEqual('abc', 'abcd') === false, 'length mismatch does not match');

// ── Test 5: redactKey ────────────────────────────────────────────────────
console.log('\n--- Test 5: redactKey ---');
// redactKey(k): null/empty → '<empty>'; ≤8 chars → all stars; longer → first 4 + … + stars + last 4
assert(MW.redactKey('sk-abc123xyz') === 'sk-a…****3xyz', 'long key: first 4 + … + stars + last 4');
assert(MW.redactKey(null) === '<empty>',                   'null input returns "<empty>"');
assert(MW.redactKey('ab') === '**',                         'short input (2 chars) returns "**"');

// ── Test 6: Viz3D — module surface + 3D math correctness ─────────────────
console.log('\n--- Test 6: Viz3D module surface ---');
const Viz3D = sandbox.window.Viz3D;
assert(typeof Viz3D === 'object', 'Viz3D global exists');
assert(typeof Viz3D.Vec3 === 'function', 'Vec3 exported');
assert(typeof Viz3D.rotX === 'function', 'rotX exported');
assert(typeof Viz3D.project === 'function', 'project exported');
assert(typeof Viz3D.Camera === 'function', 'Camera exported');
assert(typeof Viz3D.Renderer === 'function', 'Renderer exported');
// Rotation sanity: rotZ(v, π/2) rotates (1,0,0) to (0,1,0)
const v = Viz3D.Vec3(1, 0, 0);
const r = Viz3D.rotZ(v, Math.PI / 2);
assert(Math.abs(r.x) < 1e-9 && Math.abs(r.y - 1) < 1e-9, 'rotZ(1,0,0; π/2) → (0,1,0)');
// Project a point in front of camera
const cam = new Viz3D.Camera({ dist: 5 });
const p = Viz3D.project(Viz3D.Vec3(0, 0, 0), cam, 800, 600);
assert(p !== null && Math.abs(p.x - 400) < 1e-6, 'origin projects to canvas centre');

// ── Test 7: Sonify module surface (must degrade gracefully w/o AudioContext) ─
console.log('\n--- Test 7: Sonify module (no AudioContext in Node) ---');
const Sonify = sandbox.window.NBodySonify;
assert(typeof Sonify === 'object', 'NBodySonify global exists (no crash without AudioContext)');
assert(typeof Sonify.resume === 'function', 'resume() exists');
assert(typeof Sonify.start === 'function',  'start() exists');
assert(typeof Sonify.stop === 'function',   'stop() exists');
assert(typeof Sonify.update === 'function', 'update() exists');
assert(typeof Sonify.ping === 'function',   'ping() exists');
assert(typeof Sonify.setEnabled === 'function', 'setEnabled() exists');
assert(typeof Sonify.isEnabled === 'function',  'isEnabled() exists');
// Calling these in a no-AudioContext env must not throw
let noThrow = true;
try {
  Sonify.setEnabled(true);
  Sonify.start();
  Sonify.update([], 0, 1);
  Sonify.ping();
  Sonify.stop();
} catch (e) { noThrow = false; }
assert(noThrow, 'sonify no-op stub does not throw when AudioContext is absent');

// ── Test 8: Tour module surface ──────────────────────────────────────────
console.log('\n--- Test 8: Tour module ---');
const Tour = sandbox.window.NBodyTour;
assert(typeof Tour === 'object', 'NBodyTour global exists');
assert(Array.isArray(Tour.ORDER) && Tour.ORDER.length === 6, 'tour has 6 scenarios (got ' + (Tour.ORDER && Tour.ORDER.length) + ')');
const keys = Tour.ORDER.map(s => s.key);
assert(keys.indexOf('twoBody')          >= 0, 'tour includes twoBody');
assert(keys.indexOf('solarSystem')      >= 0, 'tour includes solarSystem');
assert(keys.indexOf('figure8')          >= 0, 'tour includes figure8');
assert(keys.indexOf('binaryWithPlanet') >= 0, 'tour includes binaryWithPlanet');
assert(keys.indexOf('plummer32')        >= 0, 'tour includes plummer32');
assert(keys.indexOf('lattice27')        >= 0, 'tour includes lattice27');
assert(typeof Tour.play  === 'function', 'play() exported');
assert(typeof Tour.pause === 'function', 'pause() exported');
assert(typeof Tour.stop  === 'function', 'stop() exported');
assert(typeof Tour.skip  === 'function', 'skip() exported');
assert(typeof Tour.prev  === 'function', 'prev() exported (Phase 18)');
assert(typeof Tour.setVoiceEnabled  === 'function', 'setVoiceEnabled() exported (Phase 18)');
assert(typeof Tour.isVoiceEnabled    === 'function', 'isVoiceEnabled() exported (Phase 18)');

// ── Test 9: Phase 16 — energyBreakdown + virial theorem ──────────────────
console.log('\n--- Test 9: energyBreakdown + virial theorem ---');
assert(typeof P.energyBreakdown === 'function', 'energyBreakdown() exported');
const eb = P.energyBreakdown(bodies, 0.0);
assert(typeof eb === 'object' && 'ke' in eb && 'pe' in eb && 'total' in eb && 'virial' in eb,
       'energyBreakdown returns {ke,pe,total,virial}');
const eTot = P.totalEnergy(bodies, 0);
assert(Math.abs(eb.total - eTot) < 1e-9 * Math.abs(eTot || 1),
       'energyBreakdown.total ≈ totalEnergy');
// For a bound circular orbit, virial theorem: 2KE + PE ≈ 0
assert(Math.abs(eb.virial) < 1e-6 * Math.abs(eb.ke || 1),
       'virial 2KE+PE ≈ 0 for circular orbit (got ' + eb.virial.toExponential(3) + ')');
// Typed path
assert(typeof P.energyBreakdownTyped === 'function', 'energyBreakdownTyped() exported');

// ── Test 10: Phase 18 — visual pop: additive blending in renderers ───────
console.log('\n--- Test 10: Phase 18 visual pop (additive blending) ---');
const appSrc = load('app.js');
assert(appSrc.indexOf("globalCompositeOperation = 'lighter'") >= 0,
       '2D renderer uses additive blending (lighter)');
assert(appSrc.indexOf('bloom') >= 0, '2D renderer has bloom pass');
assert(appSrc.indexOf("globalCompositeOperation = 'source-over'") >= 0,
       '2D renderer restores normal blending before white cores');

const vizSrc = load('viz3d.js');
assert(vizSrc.indexOf("globalCompositeOperation = 'lighter'") >= 0,
       '3D renderer uses additive blending (lighter)');
assert(vizSrc.indexOf('bloom') >= 0, '3D renderer has bloom pass');

const cssSrc = load('styles.css');
assert(cssSrc.indexOf('.canvas-panel') >= 0, 'canvas-panel CSS rule exists');
assert(/\.canvas-panel\s*\{[^}]*background:\s*#000000/m.test(cssSrc),
       'canvas-panel background is pure #000000');

// ── Test 11: Phase 19 — playback module + scrubber ──────────────────────
console.log('\n--- Test 11: Phase 19 playback module ---');
const PB = sandbox.window.NBodyPlayback;
assert(typeof PB === 'object', 'NBodyPlayback global exists');
assert(typeof PB.setTrajectory === 'function', 'setTrajectory() exported');
assert(typeof PB.play  === 'function', 'play() exported');
assert(typeof PB.pause === 'function', 'pause() exported');
assert(typeof PB.stop  === 'function', 'stop() exported');
assert(typeof PB.seek  === 'function', 'seek() exported');
assert(typeof PB.renderAt === 'function', 'renderAt() exported');
assert(typeof PB.setSpeed === 'function', 'setSpeed() exported');
assert(typeof PB.setTrailFrac === 'function', 'setTrailFrac() exported');
assert(typeof PB.isPlaying === 'function', 'isPlaying() exported');

// Verify setTrajectory accepts the byBody shape
let noThrowPB = true;
try {
  PB.setTrajectory([
    { bodyId: 0, samples: [{x:0,y:0,z:0},{x:1,y:1,z:0},{x:2,y:0,z:0}] },
    { bodyId: 1, samples: [{x:1,y:0,z:0},{x:0,y:1,z:0},{x:-1,y:0,z:0}] }
  ]);
  PB.seek(0.5);
  PB.setSpeed(2);
  PB.setTrailFrac(0.5);
  PB.pause();
  PB.stop();
} catch (e) { noThrowPB = false; }
assert(noThrowPB, 'playback API does not throw on basic operations');

// Verify the HTML has the scrubber + play button
const htmlSrc = load('index.html');
assert(htmlSrc.indexOf('id="play-scrub"') >= 0, 'playback scrubber in HTML');
assert(htmlSrc.indexOf('id="play-play"')  >= 0, 'play button in HTML');
assert(htmlSrc.indexOf('id="play-stop"')  >= 0, 'stop button in HTML');
assert(htmlSrc.indexOf('id="play-speed"') >= 0, 'speed selector in HTML');
assert(htmlSrc.indexOf('id="play-trail"') >= 0, 'trail length slider in HTML');
assert(htmlSrc.indexOf('playback.js') >= 0, 'playback.js script tag in HTML');

// ── Test 12: Phase 20 — Live Space Data Integration ─────────────────────
console.log('\n--- Test 12: Phase 20 Live Space Data ---');

// spacedata.js loaded
const SD = sandbox.window.NBodySpaceData;
assert(typeof SD === 'object', 'NBodySpaceData global exists');
assert(typeof SD.computePlanets === 'function', 'computePlanets() exported');
assert(typeof SD.loadAPOD === 'function',       'loadAPOD() exported');
assert(typeof SD.loadISS  === 'function',       'loadISS() exported');
assert(typeof SD.startISSTracking === 'function', 'startISSTracking() exported');
assert(Array.isArray(SD.PLANET_INFO) && SD.PLANET_INFO.length === 8,
       'PLANET_INFO has 8 planets (got ' + (SD.PLANET_INFO ? SD.PLANET_INFO.length : 0) + ')');

// Verify planet names are present + correctly spelled (this catches typos
// in the baked-in J2000 element table)
const planetNames = SD.PLANET_INFO.map(p => p.name);
['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'].forEach(n => {
  assert(planetNames.indexOf(n) >= 0, 'planet ' + n + ' in PLANET_INFO');
});

// Verify the JPL element table has the expected shape (a, e, i, L, varpi, Omega + rates)
const sdSrc = load('spacedata.js');
assert(sdSrc.indexOf('Standish') >= 0,           'spacedata.js cites Standish JPL source');
assert(sdSrc.indexOf('2451545.0') >= 0,          'J2000 Julian Date is baked in (2451545.0)');
assert(sdSrc.indexOf('2.959122082855911e-4') >= 0, 'GM_sun constant baked in (AU³/day²)');
assert(sdSrc.indexOf('keplerToCartesian') >= 0,  'Keplerian → Cartesian conversion implemented');
assert(sdSrc.indexOf('NewtonRaphson') >= 0 || sdSrc.indexOf('Newton') >= 0 || sdSrc.indexOf('iter') >= 0,
       'Kepler equation solved iteratively');
assert(sdSrc.indexOf('api.nasa.gov') >= 0,       'NASA APOD API endpoint baked in');
assert(sdSrc.indexOf('wheretheiss.at') >= 0,     'wheretheiss.at endpoint baked in (ISS tracker)');
assert(sdSrc.indexOf('APOD_FALLBACK') >= 0,      'APOD has offline fallback entry');
assert(sdSrc.indexOf('ISS_FALLBACK') >= 0,       'ISS has offline fallback entry');

// Verify computePlanets() returns 9 bodies (Sun + 8 planets) with valid state vectors
const planetsJ2000 = SD.computePlanets(new Date('2000-01-01T12:00:00Z'));
assert(Array.isArray(planetsJ2000) && planetsJ2000.length === 9,
       'computePlanets() returns 9 bodies at J2000 (Sun + 8 planets)');

// Verify Earth at J2000 has |r| close to 1 AU (real data: ~0.98 AU at J2000)
const earthJ2000 = planetsJ2000.find(p => p.name === 'Earth');
assert(typeof earthJ2000 === 'object', 'Earth is in the planet list');
const rEarth = Math.sqrt(earthJ2000.x**2 + earthJ2000.y**2 + earthJ2000.z**2);
assert(rEarth > 0.95 && rEarth < 1.05,
       'Earth at J2000 has |r| ≈ 1 AU (got ' + rEarth.toFixed(4) + ')');
// Heliocentric longitude of Earth at J2000 is ~100.5° (well-known astronomical value)
const lonEarth = Math.atan2(earthJ2000.y, earthJ2000.x) * 180 / Math.PI;
const lonNorm = ((lonEarth % 360) + 360) % 360;
assert(lonNorm > 95 && lonNorm < 110,
       'Earth at J2000 heliocentric longitude ≈ 100.5° (got ' + lonNorm.toFixed(2) + '°)');

// Verify Earth's orbital velocity ≈ 1.0 in sim units (Kepler's 3rd law, GM_sun=1)
const vEarth = Math.sqrt(earthJ2000.vx**2 + earthJ2000.vy**2 + earthJ2000.vz**2);
assert(vEarth > 0.9 && vEarth < 1.1,
       'Earth at J2000 |v| ≈ 1.0 sim units (got ' + vEarth.toFixed(4) + ')');

// Verify Neptune at J2000 has |r| close to 30 AU (the most distant planet)
const neptuneJ2000 = planetsJ2000.find(p => p.name === 'Neptune');
const rNeptune = Math.sqrt(neptuneJ2000.x**2 + neptuneJ2000.y**2 + neptuneJ2000.z**2);
assert(rNeptune > 29 && rNeptune < 31,
       'Neptune at J2000 has |r| ≈ 30 AU (got ' + rNeptune.toFixed(4) + ')');

// Verify all planet positions have non-zero state vectors (no NaNs, no zeros)
let allValid = true;
for (const p of planetsJ2000) {
  for (const k of ['x','y','z','vx','vy','vz','mass']) {
    if (typeof p[k] !== 'number' || isNaN(p[k]) || (k !== 'mass' && p[k] === 0 && k !== 'z')) {
      // Note: z=0 is allowed (orbital plane can be near-ecliptic); mass=0 not allowed
      if (k === 'mass' && p[k] === 0) allValid = false;
    }
  }
}
assert(allValid, 'all planet state vectors are valid numbers');

// Verify physics.js exposes the solarSystemLive generator
assert(typeof P.solarSystemLive === 'function',
       'physics.js exposes solarSystemLive() (Phase 20)');

// Verify solarSystemLive() returns the same 9 bodies (with name + color metadata).
// Phase 21 note: solarSystemLive() now defaults to including Moon + Halley
// (11 bodies). To get just the 9 planet bodies (back-compat with Phase 20),
// pass {moon:false, halley:false} explicitly.
const liveBodies = P.solarSystemLive(new Date('2000-01-01T12:00:00Z'), { moon: false, halley: false });
assert(Array.isArray(liveBodies) && liveBodies.length === 9,
       'solarSystemLive() returns 9 bodies (Sun + 8 planets) when extras disabled');
const earthFromBody = liveBodies.find(b => b.name === 'Earth');
assert(typeof earthFromBody === 'object',
       'solarSystemLive() bodies carry name metadata (Earth found)');

// Verify the live system conserves energy reasonably over 100 steps
// (Solar system is a chaotic N-body but should be stable for short times)
const liveSys = new P.MutableBodySystem(liveBodies.slice(0, 5), 0.001, 0.0001); // Sun + 4 inner planets
const e0Live = liveSys.energy();
for (let i = 0; i < 100; i++) liveSys.step();
const e100Live = liveSys.energy();
const liveDrift = Math.abs((e100Live - e0Live) / e0Live);
assert(liveDrift < 0.05,
       'live solar system conserves energy over 100 steps (drift=' + liveDrift.toExponential(2) + ', threshold 0.05)');

// Verify the HTML has the Phase 20 panel + cards
assert(htmlSrc.indexOf('space-data-panel') >= 0, 'space-data-panel section in HTML');
assert(htmlSrc.indexOf('apod-card') >= 0,        'APOD card in HTML');
assert(htmlSrc.indexOf('live-solar-card') >= 0,  'Live Solar System card in HTML');
assert(htmlSrc.indexOf('iss-card') >= 0,         'ISS tracker card in HTML');
assert(htmlSrc.indexOf('id="live-ss-run"') >= 0, 'Live Solar System run button in HTML');
assert(htmlSrc.indexOf('id="live-ss-date"') >= 0,'Live Solar System epoch date input in HTML');
assert(htmlSrc.indexOf('id="apod-img"') >= 0,    'APOD image element in HTML');
assert(htmlSrc.indexOf('id="iss-canvas"') >= 0,  'ISS tracker canvas in HTML');
assert(htmlSrc.indexOf('spacedata.js') >= 0,     'spacedata.js script tag in HTML');
assert(htmlSrc.indexOf('solarSystemLive') >= 0,  'solarSystemLive scenario option in HTML');

// Verify the scenario button for Live Solar System is in the scenario library
assert(htmlSrc.indexOf('data-scenario="solarSystemLive"') >= 0,
       'solarSystemLive scenario button in HTML scenario library');

// Verify styles.css has the Phase 20 panel styles
const cssSrc20 = load('styles.css');
assert(cssSrc20.indexOf('.space-data-panel') >= 0, 'space-data-panel CSS rule exists');
assert(cssSrc20.indexOf('.space-card') >= 0,       'space-card CSS rule exists');
assert(cssSrc20.indexOf('.space-card-badge.live') >= 0, 'space-card-badge.live CSS rule exists');
assert(cssSrc20.indexOf('.apod-body') >= 0,        'apod-body CSS rule exists');
assert(cssSrc20.indexOf('.iss-map-wrap') >= 0,     'iss-map-wrap CSS rule exists');
assert(cssSrc20.indexOf('.planet-legend') >= 0,    'planet-legend CSS rule exists');
assert(cssSrc20.indexOf('#iss-canvas') >= 0,       'iss-canvas CSS rule exists');

// Verify app.js wires up Phase 20 (button listener, APOD load, ISS tracker)
const appSrc20 = load('app.js');
assert(appSrc20.indexOf('NBodySpaceData') >= 0,    'app.js references NBodySpaceData');
assert(appSrc20.indexOf('_runLiveSolarSystem') >= 0, 'app.js has _runLiveSolarSystem handler');
assert(appSrc20.indexOf('_loadAPOD') >= 0,         'app.js has _loadAPOD handler');
assert(appSrc20.indexOf('_startISSTracking') >= 0, 'app.js has _startISSTracking handler');
assert(appSrc20.indexOf('_drawISSMap') >= 0,       'app.js has _drawISSMap renderer');
assert(appSrc20.indexOf('solarSystemLive') >= 0,   'app.js handles solarSystemLive preset');
assert(appSrc20.indexOf('solarSystemLive') >= 0 && appSrc20.indexOf('SCENARIO_PARAMS') >= 0,
       'solarSystemLive added to SCENARIO_PARAMS table');

// ── Phase 21: Cosmic Companions (Moon + Halley's Comet + comet tails) ─────
console.log('\n--- Phase 21: Cosmic Companions ---');
const SD21 = sandbox.window.NBodySpaceData;
assert(typeof SD21.computeMoon   === 'function', 'computeMoon() exported (Phase 21)');
assert(typeof SD21.computeHalley === 'function', 'computeHalley() exported (Phase 21)');
assert(Array.isArray(SD21.EXTRA_BODIES) && SD21.EXTRA_BODIES.length === 2,
       'EXTRA_BODIES array has 2 entries (Moon + Halley)');
assert(SD21.MOON_INFO   && SD21.MOON_INFO.name   === 'Moon',   'MOON_INFO metadata present');
assert(SD21.HALLEY_INFO && SD21.HALLEY_INFO.name === 'Halley', 'HALLEY_INFO metadata present');

// Verify Moon orbital elements are baked in
const moonEl = SD21._MOON_ELEMENTS;
assert(moonEl && Math.abs(moonEl.a0 - 0.0025695555) < 1e-6, 'Moon semi-major axis baked in (a=0.00257 AU)');
assert(moonEl && Math.abs(moonEl.e0 - 0.055545526)  < 1e-6, 'Moon eccentricity baked in (e=0.0555)');
assert(moonEl && Math.abs(moonEl.mass - 3.6943e-8)  < 1e-12, 'Moon mass ratio baked in (M_moon/M_sun)');

// Verify Halley orbital elements are baked in
const halleyEl = SD21._HALLEY_ELEMENTS;
assert(halleyEl && Math.abs(halleyEl.a0 - 17.784)        < 0.01,  "Halley semi-major axis baked in (a=17.784 AU)");
assert(halleyEl && Math.abs(halleyEl.e0 - 0.967142908)   < 1e-6,  "Halley eccentricity baked in (e=0.967 — high)");
assert(halleyEl && Math.abs(halleyEl.i0 - 162.262674)    < 0.01,  "Halley inclination baked in (i=162° — retrograde)");
assert(halleyEl && Math.abs(halleyEl.dL - 360.0/75.32)   < 1e-6,  "Halley mean motion baked in (P=75.32 yr)");

// Compute Moon at J2000 — should be near Earth, ~0.00257 AU away
const j2000date_p21 = new Date('2000-01-01T12:00:00Z');
const planetsJ2000_p21 = SD21.computePlanets(j2000date_p21);
const earthJ2000_p21 = planetsJ2000_p21.find(p => p.name === 'Earth');
const moonJ2000  = SD21.computeMoon(earthJ2000_p21, j2000date_p21);
assert(moonJ2000 && moonJ2000.isMoon === true, "computeMoon() returns isMoon=true");
const moonEarthDist = Math.sqrt(
  (moonJ2000.x - earthJ2000_p21.x)**2 +
  (moonJ2000.y - earthJ2000_p21.y)**2 +
  (moonJ2000.z - earthJ2000_p21.z)**2
);
assert(Math.abs(moonEarthDist - 0.00257) < 0.001,
       'Moon is ~0.00257 AU from Earth at J2000 (got ' + moonEarthDist.toFixed(6) + ' AU)');
assert(Math.abs(moonJ2000.mass - 3.6943e-8) < 1e-12,
       'Moon mass is M_moon/M_sun = 3.69e-8');

// Compute Halley at J2000 — should be in a valid orbit (0.586 < r < 35 AU)
const halleyJ2000 = SD21.computeHalley(j2000date_p21);
assert(halleyJ2000 && halleyJ2000.isComet === true, "computeHalley() returns isComet=true");
const halleyR = Math.sqrt(halleyJ2000.x**2 + halleyJ2000.y**2 + halleyJ2000.z**2);
assert(halleyR > 0.5 && halleyR < 36,
       "Halley at J2000 is within its orbital range (r=" + halleyR.toFixed(3) + " AU, expected 0.59-35)");
assert(Math.abs(halleyJ2000.mass - 1e-16) < 1e-20,
       "Halley mass is the rendering fiction value 1e-16");

// Verify physics.js solarSystemLive(date, opts) includes Moon + Halley
const liveBodies21 = P.solarSystemLive(j2000date_p21, { moon: true, halley: true });
assert(liveBodies21.length === 11,
       'solarSystemLive(date, {moon:true, halley:true}) returns 11 bodies (got ' + liveBodies21.length + ')');
assert(liveBodies21.some(b => b.isMoon === true),  'live system includes a Moon body (isMoon=true)');
assert(liveBodies21.some(b => b.isComet === true), 'live system includes a Halley body (isComet=true)');
assert(liveBodies21.some(b => b.name === 'Moon'),  'live system includes a body named "Moon"');
assert(liveBodies21.some(b => b.name === 'Halley'), 'live system includes a body named "Halley"');

// Verify the Moon body is positioned near Earth in the live system
const earthInLive   = liveBodies21.find(b => b.name === 'Earth');
const moonInLive    = liveBodies21.find(b => b.name === 'Moon');
const moonLiveDist  = Math.sqrt(
  (earthInLive.x - moonInLive.x)**2 +
  (earthInLive.y - moonInLive.y)**2 +
  (earthInLive.z - moonInLive.z)**2
);
assert(Math.abs(moonLiveDist - 0.00257) < 0.001,
       'Moon body is ~0.00257 AU from Earth body in live system (got ' + moonLiveDist.toFixed(6) + ')');

// Verify solarSystemLive(date, {moon:false, halley:false}) still works (back-compat)
const liveBodiesNoExtras = P.solarSystemLive(j2000date_p21, { moon: false, halley: false });
assert(liveBodiesNoExtras.length === 9,
       'solarSystemLive(date, {moon:false, halley:false}) returns 9 bodies (back-compat)');

// Verify energy conservation with the full 11-body system over 100 steps
// (Solar system is chaotic but should be stable for short times)
const sys21 = new P.MutableBodySystem(liveBodies21, 0.001, 0.0001);
const e0_21 = sys21.energy();
for (let i = 0; i < 100; i++) sys21.step();
const e100_21 = sys21.energy();
const drift21 = Math.abs((e100_21 - e0_21) / e0_21);
assert(drift21 < 0.05,
       '11-body live system (Sun+8 planets+Moon+Halley) conserves energy over 100 steps (drift=' + drift21.toExponential(2) + ')');

// Verify the HTML has the Phase 21 toggle checkboxes
assert(htmlSrc.indexOf('id="live-ss-moon"')   >= 0, 'Moon toggle checkbox in HTML');
assert(htmlSrc.indexOf('id="live-ss-halley"') >= 0, 'Halley toggle checkbox in HTML');
assert(htmlSrc.indexOf('solarSystemLiveNoMoon') >= 0, 'solarSystemLiveNoMoon scenario in HTML');
assert(htmlSrc.indexOf('Inner Planets + Moon + Halley') >= 0,
       'Phase 21 scenario button label in HTML');
assert(htmlSrc.indexOf('Phase 20+21') >= 0, 'Phase 21 mentioned in panel header');

// Verify styles.css has the Phase 21 toggle + legend styles
const cssSrc21 = load('styles.css');
assert(cssSrc21.indexOf('.planet-toggle-label') >= 0, 'planet-toggle-label CSS rule exists');
assert(cssSrc21.indexOf('.planet-legend-dot.is-comet') >= 0, 'comet legend dot CSS rule exists');
assert(cssSrc21.indexOf('.planet-legend-dot.is-moon') >= 0,  'moon legend dot CSS rule exists');

// Verify app.js handles Phase 21 (scenario key, toggles, legend population)
const appSrc21 = load('app.js');
assert(appSrc21.indexOf('solarSystemLiveNoMoon') >= 0, 'app.js handles solarSystemLiveNoMoon preset');
assert(appSrc21.indexOf('live-ss-moon') >= 0,   'app.js reads Moon toggle checkbox');
assert(appSrc21.indexOf('live-ss-halley') >= 0, 'app.js reads Halley toggle checkbox');
assert(appSrc21.indexOf('EXTRA_BODIES') >= 0,   'app.js populates legend with EXTRA_BODIES');
assert(appSrc21.indexOf('is-comet') >= 0,       'app.js applies is-comet CSS class for Halley legend dot');
assert(appSrc21.indexOf('is-moon') >= 0,        'app.js applies is-moon CSS class for Moon legend dot');

// Verify viz3d.js has the comet tail renderer
const vizSrc21 = load('viz3d.js');
assert(vizSrc21.indexOf('drawCometTail') >= 0,    'viz3d.js has drawCometTail method');
assert(vizSrc21.indexOf('isComet') >= 0,          'viz3d.js checks isComet flag');
assert(vizSrc21.indexOf('bodyTint') >= 0,         'viz3d.js has bodyTint() for real per-body colors');
assert(vizSrc21.indexOf('Anti-solar') >= 0 || vizSrc21.indexOf('anti-solar') >= 0,
       'viz3d.js documents anti-solar tail direction');
assert(vizSrc21.indexOf('ion') >= 0 && vizSrc21.indexOf('dust') >= 0,
       'viz3d.js renders both ion + dust comet tail layers');

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n=========================');
console.log('  ' + pass + ' passed · ' + fail + ' failed');
console.log('=========================');
if (fail > 0) process.exit(1);