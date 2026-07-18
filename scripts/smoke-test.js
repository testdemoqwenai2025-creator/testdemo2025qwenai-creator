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
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  dispatchEvent: () => {},
  CustomEvent: function () {},
  addEventListener: () => {},
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
      style: {}, checked: false, disabled: false,
      textContent_set: () => {}, appendChild: () => {}
    }),
    createElement: () => ({
      className: '', innerHTML: '', insertBefore: () => {},
      appendChild: () => {}, style: {}, getContext: () => null,
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
  vm.runInContext(load('physics.js'),  sandbox);
  vm.runInContext(load('db.js'),       sandbox);
  vm.runInContext(load('middleware.js'), sandbox);
  vm.runInContext(load('routes.js'),   sandbox);
  vm.runInContext(load('viz3d.js'),    sandbox);
  vm.runInContext(load('sonify.js'),   sandbox);
  vm.runInContext(load('tour.js'),     sandbox);
  console.log('  all 7 modules loaded');
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

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n=========================');
console.log('  ' + pass + ' passed · ' + fail + ' failed');
console.log('=========================');
if (fail > 0) process.exit(1);
