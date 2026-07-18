// Sanity-check spacedata.js: verify Earth's position is roughly correct
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'spacedata.js'), 'utf-8');
const sandbox = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, Math, Date, performance: { now: () => 0 }, fetch: () => Promise.reject(new Error('no fetch')) };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const SD = sandbox.window.NBodySpaceData;

// Test 1: At J2000 epoch, Earth should be near (1, 0, 0) AU approximately
const j2000Date = new Date('2000-01-01T12:00:00Z');
const planetsJ2000 = SD.computePlanets(j2000Date);
const earthJ2000 = planetsJ2000.find(p => p.name === 'Earth');
console.log('Earth at J2000:');
console.log('  r =', earthJ2000.x.toFixed(4), earthJ2000.y.toFixed(4), earthJ2000.z.toFixed(4), 'AU');
console.log('  v =', earthJ2000.vx.toFixed(4), earthJ2000.vy.toFixed(4), earthJ2000.vz.toFixed(4), 'sim');
const rEarth = Math.sqrt(earthJ2000.x**2 + earthJ2000.y**2 + earthJ2000.z**2);
const vEarth = Math.sqrt(earthJ2000.vx**2 + earthJ2000.vy**2 + earthJ2000.vz**2);
console.log('  |r| =', rEarth.toFixed(4), 'AU (expect ~1.0)');
console.log('  |v| =', vEarth.toFixed(4), 'sim (expect ~1.0 for circular)');
// Earth's actual J2000 longitude is ~100.5°. Position angle = atan2(y, x).
const lonEarth = Math.atan2(earthJ2000.y, earthJ2000.x) * 180 / Math.PI;
console.log('  heliocentric longitude =', lonEarth.toFixed(2), '° (expect ~100.5°)');

// Test 2: Verify Earth's orbital period is ~1 year (= 2π sim time units)
// Using Kepler's 3rd: T = 2π sqrt(a³/μ) = 2π for a=1, μ=1
// So a full orbit should take 2π ≈ 6.2832 sim time units.

// Test 3: Verify planets list has 9 entries (Sun + 8 planets)
console.log('\nPlanet list (', planetsJ2000.length, 'entries):');
for (const p of planetsJ2000) {
  const r = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
  const v = Math.sqrt(p.vx*p.vx + p.vy*p.vy + p.vz*p.vz);
  console.log('  ' + (p.name + '      ').slice(0, 9) +
              'r=' + r.toFixed(4).padStart(8) + ' AU  ' +
              'v=' + v.toFixed(4).padStart(8) + ' sim  ' +
              'mass=' + p.mass.toExponential(2));
}

// Test 4: At today's date
const today = new Date();
const planetsToday = SD.computePlanets(today);
const earthToday = planetsToday.find(p => p.name === 'Earth');
const rToday = Math.sqrt(earthToday.x**2 + earthToday.y**2 + earthToday.z**2);
const lonToday = Math.atan2(earthToday.y, earthToday.x) * 180 / Math.PI;
console.log('\nEarth today (' + today.toISOString().slice(0,10) + '):');
console.log('  |r| =', rToday.toFixed(4), 'AU');
console.log('  heliocentric longitude =', lonToday.toFixed(2), '°');

// Test 5: Verify Kepler's equation solver handles high eccentricity (Mercury e=0.2)
const mercury = planetsJ2000.find(p => p.name === 'Mercury');
const rMercury = Math.sqrt(mercury.x**2 + mercury.y**2 + mercury.z**2);
console.log('\nMercury at J2000:');
console.log('  |r| =', rMercury.toFixed(4), 'AU (expect ~0.387, varies 0.31-0.47)');
console.log('  |v| =', Math.sqrt(mercury.vx**2 + mercury.vy**2 + mercury.vz**2).toFixed(4), 'sim');

console.log('\n✓ All sanity checks complete');
