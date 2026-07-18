// ============================================================================
// viz3d.js — Tiny zero-dependency 3D engine for trajectory visualization
// ============================================================================
// Phase 14 deliverable.
//
// ~180 LOC of hand-rolled 3D math: Vec3 ops, rotation matrices, perspective
// projection, mouse-drag camera control, auto-rotate. No Three.js, no WebGL,
// no external deps — just Canvas 2D + sin/cos.
//
// Public API:
//   Viz3D.Vec3(x, y, z)                    — Vec3 factory
//   Viz3D.rotX(v, a) / rotY / rotZ         — rotate Vec3 around axis
//   Viz3D.project(v, camera)               — perspective project to {x, y, scale}
//   Viz3D.Camera                            — class with yaw/pitch/dist/focal
//   Viz3D.Renderer                          — class, attaches to a canvas
//
// Renderer API:
//   const r = new Viz3D.Renderer(canvas);
//   r.setTrajectory(rows);                  // [{x,y,z,step,energy}, ...]
//   r.setBodies(bodies);                    // [{x,y,z,mass}, ...]
//   r.setAutoRotate(true);                  // slow spin when not dragging
//   r.render();                             // draw one frame
//   // Mouse drag on the canvas updates yaw/pitch automatically.
// ============================================================================

(function (global) {
  'use strict';

  // ── Vec3 ops (plain objects, no class allocation in hot loop) ─────────────
  function Vec3(x, y, z) { return { x: +x, y: +y, z: +z }; }
  function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function vScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function vDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function vCross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function vLen(a) { return Math.sqrt(vDot(a, a)); }
  function vNorm(a) { const l = vLen(a) || 1; return vScale(a, 1 / l); }

  // ── Rotation matrices (right-handed, positive = counterclockwise) ────────
  function rotX(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z };
  }
  function rotY(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
  }
  function rotZ(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z };
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  // Yaw rotates around Y axis (left/right drag), pitch around X (up/down drag).
  // `dist` is the camera distance from origin; `focal` is the perspective
  // focal length (larger = more orthographic, smaller = more fisheye).
  class Camera {
    constructor(opts) {
      opts = opts || {};
      this.yaw   = opts.yaw   ?? 0.6;     // ~34° — shows Z axis nicely
      this.pitch = opts.pitch ?? 0.3;     // ~17° — slight downward tilt
      this.dist  = opts.dist  ?? 8.0;     // pull back far enough to see orbit
      this.focal = opts.focal ?? 600;     // perspective strength
    }

    // Apply camera transform to a world-space point:
    //   1. Rotate by -yaw around Y, then -pitch around X (inverse camera rotation)
    //   2. Translate by -dist along Z (move camera to origin, push scene back)
    worldToView(v) {
      let p = rotY(v, -this.yaw);
      p = rotX(p, -this.pitch);
      p = { x: p.x, y: p.y, z: p.z + this.dist };
      return p;
    }
  }

  // Perspective projection: divide x and y by z, scale by focal length.
  // Returns null if the point is behind the camera (z <= 0).
  function project(v, camera, canvasW, canvasH) {
    const view = camera.worldToView(v);
    if (view.z <= 0.01) return null;  // behind camera, cull
    const sx = (view.x * camera.focal / view.z) + canvasW / 2;
    const sy = (-view.y * camera.focal / view.z) + canvasH / 2;  // flip Y (canvas Y grows down)
    return { x: sx, y: sy, scale: camera.focal / view.z, z: view.z };
  }

  // ── Renderer ─────────────────────────────────────────────────────────────
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.camera = new Camera();
      this.trajectory = [];    // [{x,y,z,step,energy}, ...]
      this.bodies = [];        // [{x,y,z,mass}, ...]
      this.stars = [];         // background star field
      this.autoRotate = true;
      this.dragging = false;
      this.lastMouse = null;

      // Generate a static star field (deterministic, doesn't change between frames)
      this._generateStars(180);

      // Mouse drag handlers
      canvas.addEventListener('mousedown', (e) => {
        this.dragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', () => {
        this.dragging = false;
        canvas.style.cursor = 'grab';
      });
      window.addEventListener('mousemove', (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.camera.yaw   += dx * 0.008;
        this.camera.pitch += dy * 0.008;
        // Clamp pitch to avoid gimbal lock
        const lim = Math.PI / 2 - 0.05;
        if (this.camera.pitch >  lim) this.camera.pitch =  lim;
        if (this.camera.pitch < -lim) this.camera.pitch = -lim;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      });

      // Wheel zoom
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.camera.dist *= (1 + e.deltaY * 0.001);
        if (this.camera.dist < 2)    this.camera.dist = 2;
        if (this.camera.dist > 50)   this.camera.dist = 50;
      }, { passive: false });

      canvas.style.cursor = 'grab';
    }

    _generateStars(n) {
      // Use mulberry32 from physics.js if available, else Math.random
      let rng;
      if (global.NBodyPhysics && global.NBodyPhysics.mulberry32) {
        rng = global.NBodyPhysics.mulberry32(2024);
      } else {
        rng = Math.random;
      }
      this.stars = [];
      for (let i = 0; i < n; i++) {
        // Place stars on a large sphere around the scene
        const theta = Math.acos(2 * rng() - 1);
        const phi = 2 * Math.PI * rng();
        const r = 40 + rng() * 10;
        this.stars.push({
          x: r * Math.sin(theta) * Math.cos(phi),
          y: r * Math.sin(theta) * Math.sin(phi),
          z: r * Math.cos(theta),
          brightness: 0.3 + rng() * 0.7
        });
      }
    }

    setTrajectory(rows) { this.trajectory = rows || []; }
    setBodies(bodies)   { this.bodies = bodies || []; }
    setAutoRotate(v)    { this.autoRotate = !!v; }
    resetCamera() {
      this.camera.yaw = 0.6;
      this.camera.pitch = 0.3;
      this.camera.dist = 8.0;
    }

    // Render one frame. Call from a requestAnimationFrame loop OR on demand.
    render() {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;

      // Auto-rotate when not dragging
      if (this.autoRotate && !this.dragging) {
        this.camera.yaw += 0.003;
      }

      // Pure black background (user feedback: "keep the background complete black")
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      // ── Star field (project stars, draw as faint dots) ──────────────────
      for (const s of this.stars) {
        const p = project(s, this.camera, W, H);
        if (!p) continue;
        const alpha = s.brightness * 0.6;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
        ctx.fillRect(p.x, p.y, 1, 1);
      }

      // ── Trajectory polyline ──────────────────────────────────────────────
      // Draw as gradient: green at start, fading to red at end.
      if (this.trajectory.length > 1) {
        for (let i = 1; i < this.trajectory.length; i++) {
          const a = project(this.trajectory[i - 1], this.camera, W, H);
          const b = project(this.trajectory[i], this.camera, W, H);
          if (!a || !b) continue;
          const t = i / this.trajectory.length;
          // Green (start) → Yellow → Red (end) — temperature gradient
          const r = Math.round(255 * t);
          const g = Math.round(255 * (1 - t));
          ctx.strokeStyle = 'rgb(' + r + ',' + g + ',80)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // ── Body points (current positions) ─────────────────────────────────
      // Larger bodies draw as bigger circles. Closer bodies (lower z) draw bigger.
      for (const b of this.bodies) {
        const p = project(b, this.camera, W, H);
        if (!p) continue;
        const radius = Math.max(1.5, Math.cbrt(b.mass) * 3 * (p.scale / 100));
        // Inner glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.5);
        grad.addColorStop(0, 'rgba(88,166,255,0.9)');
        grad.addColorStop(0.5, 'rgba(88,166,255,0.3)');
        grad.addColorStop(1, 'rgba(88,166,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Solid core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── HUD overlay (camera params) ─────────────────────────────────────
      ctx.fillStyle = 'rgba(139,148,158,0.8)';
      ctx.font = '10px monospace';
      ctx.fillText('yaw=' + this.camera.yaw.toFixed(2) +
                   '  pitch=' + this.camera.pitch.toFixed(2) +
                   '  dist=' + this.camera.dist.toFixed(1) +
                   (this.autoRotate ? '  [auto-rotate]' : '  [paused]'),
                   8, H - 8);
      ctx.fillText('drag to rotate · wheel to zoom · N=' + this.bodies.length +
                   ' · samples=' + this.trajectory.length,
                   8, 14);
    }

    // Start a requestAnimationFrame loop. Returns a stop() function.
    startAnimationLoop() {
      let running = true;
      const loop = () => {
        if (!running) return;
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return () => { running = false; };
    }
  }

  global.Viz3D = {
    Vec3, vAdd, vSub, vScale, vDot, vCross, vLen, vNorm,
    rotX, rotY, rotZ,
    Camera, project, Renderer
  };

})(typeof window !== 'undefined' ? window : globalThis);
