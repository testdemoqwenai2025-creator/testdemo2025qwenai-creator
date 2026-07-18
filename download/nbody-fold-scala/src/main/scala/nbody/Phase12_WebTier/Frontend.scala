// ============================================================================
// Frontend.scala — Single-file HTML/JS frontend served by the Scala backend
// ============================================================================
// Phase 12 deliverable.
//
// To preserve Pillar 1 (Zero-Dependency Sovereignty), the frontend is a
// single self-contained HTML file with vanilla JS — no React, no Vue, no
// Tailwind, no build step. It is served from memory by the Scala backend
// (no static file IO needed).
//
// The frontend:
//   1. Lets the user create a system from a body list (default: Plummer-like
//      8-body cluster).
//   2. Lets the user step the simulation forward.
//   3. Renders the trajectory as a 2D x-y projection on a <canvas>.
//   4. Shows the energy drift over steps in a second <canvas>.
//   5. Polls /api/health every 5s to show uptime + DB row counts.
//
// All API calls go through window.fetch — the same code path a Next.js
// frontend would use. This proves the Scala backend is HTTP-correct.
// ============================================================================

package nbody.Phase12_WebTier

object Frontend:

  // The HTML is a single String constant — embedded in the .scala file so
  // there are no static assets to ship. We use triple-quoted Scala strings
  // and escape ${} interpolations by using #{...} which JS ignores.
  val html: String = raw"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>nbody-fold-scala — Phase 12 Web Tier</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
           background: #0b1021; color: #d4e1ff; margin: 0; padding: 0; }
    header { background: #1a2444; padding: 14px 24px; border-bottom: 1px solid #2c3a6b; }
    header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    header span { color: #6b7fb3; font-size: 12px; margin-left: 12px; }
    .grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; padding: 16px; }
    .panel { background: #131a36; border: 1px solid #2c3a6b; border-radius: 8px; padding: 16px; }
    .panel h2 { margin: 0 0 12px 0; font-size: 14px; color: #8aa3ff; text-transform: uppercase; letter-spacing: 1px; }
    label { display: block; margin: 8px 0 4px; font-size: 12px; color: #6b7fb3; }
    input, textarea, button, select { width: 100%; padding: 6px 8px;
      background: #0b1021; color: #d4e1ff; border: 1px solid #2c3a6b; border-radius: 4px; font-family: inherit; }
    button { background: #3b5bdb; border-color: #3b5bdb; cursor: pointer; margin-top: 8px; font-weight: 600; }
    button:hover { background: #4c6bff; }
    button.danger { background: #c92a2a; border-color: #c92a2a; }
    pre { background: #0b1021; padding: 8px; border-radius: 4px; overflow: auto;
          font-family: "SFMono-Regular", Menlo, monospace; font-size: 11px; max-height: 200px; }
    .row { display: flex; gap: 16px; }
    .row > div { flex: 1; }
    .stat { display: inline-block; padding: 4px 10px; background: #0b1021; border-radius: 4px;
            margin-right: 8px; font-size: 12px; }
    .stat b { color: #8aa3ff; }
    canvas { background: #0b1021; border: 1px solid #2c3a6b; border-radius: 4px; display: block; }
    .log { font-size: 11px; line-height: 1.5; color: #6b7fb3; max-height: 120px; overflow: auto; }
    .log div { padding: 2px 0; border-bottom: 1px dashed #1a2444; }
    .log div.error { color: #ff6b6b; }
    .log div.ok { color: #51cf66; }
  </style>
</head>
<body>
<header>
  <h1>nbody-fold-scala <span>Phase 12 — Zero-Dependency Scala Web Tier (JDK HttpServer)</span></h1>
  <div style="margin-top:8px;">
    <span class="stat"><b>uptime</b> <span id="uptime">—</span></span>
    <span class="stat"><b>systems</b> <span id="sys-count">—</span></span>
    <span class="stat"><b>bodies</b> <span id="body-count">—</span></span>
    <span class="stat"><b>trajectories</b> <span id="traj-count">—</span></span>
  </div>
</header>

<div class="grid">
  <div class="panel">
    <h2>Create System</h2>
    <label>Name</label>
    <input id="name" value="plummer8">
    <label>dt</label>
    <input id="dt" type="number" step="0.001" value="0.01">
    <label>softening</label>
    <input id="softening" type="number" step="0.001" value="0.05">
    <label>Bodies (JSON)</label>
    <textarea id="bodies" rows="6">[
  {"mass":1.0,"x":0,"y":0,"z":0,"vx":0,"vy":0,"vz":0},
  {"mass":0.001,"x":1,"y":0,"z":0,"vx":0,"vy":1,"vz":0},
  {"mass":0.001,"x":-1,"y":0,"z":0,"vx":0,"vy":-1,"vz":0},
  {"mass":0.001,"x":0,"y":1,"z":0,"vx":-1,"vy":0,"vz":0},
  {"mass":0.001,"x":0,"y":-1,"z":0,"vx":1,"vy":0,"vz":0},
  {"mass":0.001,"x":0.707,"y":0.707,"z":0,"vx":-0.707,"vy":0.707,"vz":0},
  {"mass":0.001,"x":-0.707,"y":0.707,"z":0,"vx":-0.707,"vy":-0.707,"vz":0},
  {"mass":0.001,"x":0,"y":0,"z":1,"vx":0,"vy":0,"vz":0.5}
]</textarea>
    <button onclick="createSystem()">Create</button>

    <h2 style="margin-top:24px;">Step</h2>
    <label>System ID</label>
    <input id="sysid" type="number" value="1">
    <label>Steps</label>
    <input id="steps" type="number" value="100">
    <label>Sample every</label>
    <input id="sample" type="number" value="10">
    <button onclick="stepSystem()">Step</button>
    <button class="danger" onclick="deleteSystem()">Delete</button>

    <h2 style="margin-top:24px;">Audit Log</h2>
    <div class="log" id="log"></div>
  </div>

  <div class="panel">
    <h2>Trajectory (x-y projection)</h2>
    <canvas id="traj-canvas" width="800" height="400"></canvas>
    <h2 style="margin-top:16px;">Energy Drift</h2>
    <canvas id="energy-canvas" width="800" height="200"></canvas>
    <h2 style="margin-top:16px;">Last Response</h2>
    <pre id="resp">—</pre>
  </div>
</div>

<script>
const API = "";
const log = (msg, cls) => {
  const el = document.getElementById("log");
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = new Date().toISOString().substr(11, 8) + " " + msg;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 50) el.removeChild(el.lastChild);
};
const show = (id, txt) => { document.getElementById(id).textContent = txt; };

async function fetchJSON(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, json: j, text: t };
}

async function pollHealth() {
  try {
    const r = await fetchJSON("GET", "/api/health");
    if (r.json) {
      show("uptime", r.json.uptimeSec + "s");
      show("sys-count", r.json.systems);
      show("body-count", r.json.bodies);
      show("traj-count", r.json.trajectories);
    }
  } catch (e) { log("health poll failed: " + e.message, "error"); }
}
setInterval(pollHealth, 5000);
pollHealth();

async function createSystem() {
  const name = document.getElementById("name").value;
  const dt = parseFloat(document.getElementById("dt").value);
  const softening = parseFloat(document.getElementById("softening").value);
  const bodies = JSON.parse(document.getElementById("bodies").value);
  const r = await fetchJSON("POST", "/api/systems", { name, dt, softening, bodies });
  document.getElementById("resp").textContent = JSON.stringify(r.json || r.text, null, 2);
  if (r.status === 201 && r.json) {
    document.getElementById("sysid").value = r.json.id;
    log("created system id=" + r.json.id + " bodies=" + r.json.bodies + " E0=" + r.json.energy0, "ok");
  } else {
    log("create failed: " + r.status, "error");
  }
}

async function stepSystem() {
  const id = document.getElementById("sysid").value;
  const steps = parseInt(document.getElementById("steps").value);
  const sample = parseInt(document.getElementById("sample").value);
  const r = await fetchJSON("POST", "/api/systems/" + id + "/step", { steps, sampleEvery: sample });
  document.getElementById("resp").textContent = JSON.stringify(r.json || r.text, null, 2);
  if (r.status === 200) {
    log("stepped id=" + id + " steps=" + r.json.step + " drift=" + r.json.drift, "ok");
    await renderTrajectory(id);
  } else {
    log("step failed: " + r.status, "error");
  }
}

async function deleteSystem() {
  const id = document.getElementById("sysid").value;
  const r = await fetchJSON("DELETE", "/api/systems/" + id);
  log("deleted id=" + id + " (" + r.status + ")", "ok");
}

async function renderTrajectory(id) {
  const r = await fetchJSON("GET", "/api/systems/" + id + "/trajectories");
  if (!r.json || !r.json.trajectories) return;
  drawTrajectory(r.json.trajectories);
  drawEnergy(r.json.trajectories);
}

function drawTrajectory(trajs) {
  const c = document.getElementById("traj-canvas");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b1021";
  ctx.fillRect(0, 0, c.width, c.height);
  // Auto-scale
  let max = 2.0;
  for (const t of trajs) {
    max = Math.max(max, Math.abs(t.x), Math.abs(t.y));
  }
  const scale = (c.width / 2 - 20) / max;
  const cx = c.width / 2, cy = c.height / 2;
  ctx.strokeStyle = "#3b5bdb";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < trajs.length; i++) {
    const x = cx + trajs[i].x * scale;
    const y = cy + trajs[i].y * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Start + end markers
  if (trajs.length > 0) {
    ctx.fillStyle = "#51cf66";
    ctx.beginPath();
    ctx.arc(cx + trajs[0].x * scale, cy + trajs[0].y * scale, 4, 0, 2*Math.PI);
    ctx.fill();
    ctx.fillStyle = "#ff6b6b";
    const last = trajs[trajs.length - 1];
    ctx.beginPath();
    ctx.arc(cx + last.x * scale, cy + last.y * scale, 4, 0, 2*Math.PI);
    ctx.fill();
  }
  // Axes
  ctx.strokeStyle = "#2c3a6b";
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(c.width, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, c.height); ctx.stroke();
}

function drawEnergy(trajs) {
  const c = document.getElementById("energy-canvas");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b1021";
  ctx.fillRect(0, 0, c.width, c.height);
  if (trajs.length < 2) return;
  const e0 = parseFloat(trajs[0].energy);
  const energies = trajs.map(t => parseFloat(t.energy));
  let minE = Math.min(...energies), maxE = Math.max(...energies);
  if (maxE - minE < 1e-12) { minE -= 1e-6; maxE += 1e-6; }
  const xStep = c.width / (trajs.length - 1);
  ctx.strokeStyle = "#51cf66";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < trajs.length; i++) {
    const x = i * xStep;
    const y = c.height - ((energies[i] - minE) / (maxE - minE)) * c.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = "#6b7fb3";
  ctx.font = "10px monospace";
  ctx.fillText("min=" + minE.toExponential(3), 4, 12);
  ctx.fillText("max=" + maxE.toExponential(3), 4, c.height - 4);
}

log("frontend ready — create a system to begin", "ok");
</script>
</body>
</html>"""

end Frontend
