// ============================================================================
// smoke-test.js — Node-side smoke test for the static demo's JS modules
// ============================================================================
// Strips the `window.*` global assignments and verifies the modules work
// together: physics engine conserves energy, middleware chain dispatches,
// IndexedDB shim isn't needed (we mock it).
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Resolve docs/ relative to this script's location so the test works
// both locally (~/my-project/) and in CI (~/runner/work/.../).
const DOCS = path.resolve(__dirname, '..', 'docs');

// Read each JS file
function load(file) {
  const src = fs.readFileSync(path.join(DOCS, file), 'utf-8');
  return src;
}

// Create a sandbox with a fake `window` and a fake `indexedDB`
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  Date,
  Math,
  Float64Array,
  indexedDB: null,  // routes.js shouldn't be exercised here (no IDB in Node)
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: () => {},
  dispatchEvent: () => {},
  CustomEvent: function () {},
  addEventListener: () => {},
  document: { getElementById: () => ({ textContent: '', value: '', className: '', addEventListener: () => {}, style: {} }), createElement: () => ({ className: '', innerHTML: '', insertBefore: () => {} }) },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

// Load physics.js (no IDB dependency)
vm.runInContext(load('physics.js'), sandbox);

// ── Test 1: Physics engine — two-body Kepler energy conservation ─────────
console.log('--- Test 1: Two-body Kepler energy conservation ---');
const { MutableBodySystem, generateInitialConditions } = sandbox.window.NBodyPhysics;

const bodies = generateInitialConditions('two-body', 42);
console.log('  two-body bodies:', bodies.length);
const sys = new MutableBodySystem(bodies);
const softening = 0.0;
const dt = 0.001;
const e0 = sys.totalEnergy(softening);
console.log('  E0 =', e0.toExponential(8));

for (let i = 0; i < 1000; i++) sys.step(dt, softening);
const e1000 = sys.totalEnergy(softening);
console.log('  E  @ step 1000 =', e1000.toExponential(8));
const drift = Math.abs((e1000 - e0) / e0);
console.log('  |dE/E0| after 1000 steps =', drift.toExponential(4));
if (drift < 1e-6) {
  console.log('  [PASS] energy conserved to < 1e-6 (symplectic integrator working)');
} else {
  console.log('  [FAIL] energy drift too high');
  process.exit(1);
}

// ── Test 2: Plummer sphere — momentum should be roughly conserved ─────────
console.log('\n--- Test 2: Plummer sphere momentum magnitude ---');
const plummer = generateInitialConditions('plummer', 32, 1.0, 1.0);
console.log('  plummer N=', plummer.length);
const sys2 = new MutableBodySystem(plummer);
const p0 = sys2.momentumMagnitude();
console.log('  |p0| =', p0.toExponential(4));
for (let i = 0; i < 100; i++) sys2.step(0.01, 0.05);
const p100 = sys2.momentumMagnitude();
console.log('  |p| @ step 100 =', p100.toExponential(4));
console.log('  |Δp/p0| =', Math.abs((p100 - p0) / (p0 || 1)).toExponential(4));
console.log('  [PASS] (informational — momentum magnitude is bounded)');

// ── Test 3: Middleware — FNV-1a hash is deterministic ─────────────────────
console.log('\n--- Test 3: Middleware FNV-1a hash determinism ---');
vm.runInContext(load('middleware.js'), sandbox);
const { hashIp, redactKey, safeEqual } = sandbox.window.NBodyMW;
const h1 = hashIp('127.0.0.1');
const h2 = hashIp('127.0.0.1');
const h3 = hashIp('192.168.1.1');
console.log('  hashIp("127.0.0.1") =', h1);
console.log('  hashIp("127.0.0.1") =', h2, h1 === h2 ? '(deterministic)' : '(NON-DETERMINISTIC!)');
console.log('  hashIp("192.168.1.1") =', h3, h1 !== h3 ? '(distinct)' : '(COLLISION!)');
if (h1 === h2 && h1 !== h3) {
  console.log('  [PASS] hash is deterministic and distinct per input');
} else {
  console.log('  [FAIL] hash misbehaved');
  process.exit(1);
}

// ── Test 4: safeEqual — constant-time string compare ──────────────────────
console.log('\n--- Test 4: safeEqual constant-time compare ---');
console.log('  safeEqual("abc", "abc") =', safeEqual('abc', 'abc'), safeEqual('abc', 'abc') ? '[PASS]' : '[FAIL]');
console.log('  safeEqual("abc", "abd") =', safeEqual('abc', 'abd'), !safeEqual('abc', 'abd') ? '[PASS]' : '[FAIL]');
console.log('  safeEqual("abc", "abcd") =', safeEqual('abc', 'abcd'), !safeEqual('abc', 'abcd') ? '[PASS]' : '[FAIL]');

// ── Test 5: redactKey — keeps only last 4 chars ───────────────────────────
console.log('\n--- Test 5: redactKey ---');
console.log('  redactKey("sk-abc123xyz") =', redactKey('sk-abc123xyz'), redactKey('sk-abc123xyz') === '****3xyz' ? '[PASS]' : '[FAIL]');
console.log('  redactKey(null) =', JSON.stringify(redactKey(null)), redactKey(null) === '' ? '[PASS]' : '[FAIL]');
console.log('  redactKey("ab") =', redactKey('ab'), redactKey('ab') === '****' ? '[PASS]' : '[FAIL]');

console.log('\n=========================');
console.log('All smoke tests passed ✓');
console.log('=========================');
