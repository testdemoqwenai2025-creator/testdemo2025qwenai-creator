// Phase 14 end-to-end test: start server, exercise /metrics + WebSocket
// streaming + 3D math via the live HTTP API. Not part of the regular
// smoke test (which stays zero-HTTP) — this is a separate integration test.
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = 3197;
const API_KEY = 'e2e-test';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: 'localhost', port: PORT, method, path,
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf), text: buf }); }
        catch (_) { resolve({ status: res.statusCode, text: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  console.log('Phase 14 end-to-end test');

  // 1. /api/health
  const h = await req('GET', '/api/health');
  console.log('  /api/health →', h.status, h.json && h.json.status);
  if (h.status !== 200 || !h.json || h.json.status !== 'ok') {
    console.error('FAIL: health'); process.exit(1);
  }

  // 2. /api/metrics (Phase 14) — Prometheus text format
  const m = await req('GET', '/api/metrics');
  console.log('  /api/metrics →', m.status, '(' + m.text.length + ' bytes)');
  if (m.status !== 200) { console.error('FAIL: metrics status'); process.exit(1); }
  if (!m.text.includes('nbody_requests_total') ||
      !m.text.includes('nbody_uptime_seconds') ||
      !m.text.includes('# HELP') || !m.text.includes('# TYPE')) {
    console.error('FAIL: metrics missing Prometheus labels');
    process.exit(1);
  }
  console.log('  ✓ Prometheus format OK');

  // 3. Create a system
  const c = await req('POST', '/api/systems', {
    name: 'e2e', dt: 0.001, softening: 1e-6,
    bodies: [
      { mass: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { mass: 0.001, x: 1, y: 0, z: 0, vx: 0, vy: 1, vz: 0 }
    ]
  });
  console.log('  create →', c.status, 'id=' + (c.json && c.json.id));
  if (c.status !== 201) { console.error('FAIL: create'); process.exit(1); }
  const id = c.json.id;

  // 4. Open WebSocket BEFORE the step call (so we receive live samples)
  // Use raw net.Socket to do the WS handshake ourselves.
  const net = require('net');
  const wsKey = crypto.randomBytes(16).toString('base64');
  let wsMessages = [];
  let wsDone = false;  // set but not currently used; left for future assertions
  const sock = net.connect(PORT, 'localhost', () => {
    sock.write(
      'GET /api/systems/' + id + '/stream HTTP/1.1\r\n' +
      'Host: localhost\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + wsKey + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      'X-Api-Key: ' + API_KEY + '\r\n' +
      '\r\n'
    );
  });
  let wsBuf = Buffer.alloc(0);
  let wsHandshakeDone = false;
  sock.on('data', (chunk) => {
    wsBuf = Buffer.concat([wsBuf, chunk]);
    if (!wsHandshakeDone) {
      const idx = wsBuf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const handshake = wsBuf.slice(0, idx).toString();
      wsBuf = wsBuf.slice(idx + 4);
      if (!handshake.includes('101 Switching Protocols')) {
        console.error('FAIL: WS handshake — got:\n' + handshake);
        process.exit(1);
      }
      wsHandshakeDone = true;
      console.log('  ✓ WebSocket handshake 101 Switching Protocols');

      // Now trigger the step on a separate HTTP connection. The server
      // will broadcast samples to this WebSocket as they're computed.
      req('POST', '/api/systems/' + id + '/step', { steps: 100, sampleEvery: 10 })
        .then((s) => {
          console.log('  POST /step →', s.status, 'drift=' + (s.json && s.json.drift));
        });
    }
    // Decode WS frames
    let safety = 0;
    while (wsBuf.length > 0 && safety++ < 1000) {
      if (wsBuf.length < 2) break;
      const b1 = wsBuf[1];
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) { len = wsBuf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = wsBuf.readUInt32BE(6); offset = 10; }
      if (wsBuf.length < offset + len) {
        console.log('  [wait] have ' + wsBuf.length + ' bytes, need ' + (offset + len));
        break;
      }
      const payload = wsBuf.slice(offset, offset + len).toString('utf8');
      wsBuf = wsBuf.slice(offset + len);
      try {
        const msg = JSON.parse(payload);
        wsMessages.push(msg);
        console.log('  [ws] ' + msg.type + (msg.sample ? ' step=' + msg.sample.step : ''));
        if (msg.type === 'done') {
          wsDone = true;
          // Give the socket a moment to flush, then close + run assertions
          setTimeout(() => {
            try { sock.end(); } catch (_) {}
            // Run the close handler directly since 'close' may not fire
            // reliably in the same tick as end()
            onClose();
          }, 50);
        }
      } catch (e) {
        console.log('  [ws] non-JSON payload: ' + payload.slice(0, 80));
      }
    }
  });

  async function onClose() {
    console.log('  WebSocket received', wsMessages.length, 'messages');
    const sampleCount = wsMessages.filter(m => m.type === 'sample').length;
    const hasStart = wsMessages.some(m => m.type === 'start');
    const hasSubscribed = wsMessages.some(m => m.type === 'subscribed');
    const hasDone = wsMessages.some(m => m.type === 'done');
    console.log('  subscribed:', hasSubscribed, ' start:', hasStart,
                ' samples:', sampleCount, ' done:', hasDone);
    if (!hasSubscribed || !hasStart || sampleCount === 0 || !hasDone) {
      console.error('FAIL: missing WS events');
      process.exit(1);
    }
    console.log('  ✓ WebSocket streaming end-to-end');

    // 5. /api/metrics after the step — drift counter should be populated
    const m2 = await req('GET', '/api/metrics');
    if (!m2.text.includes('nbody_drift_last') || !m2.text.includes('nbody_drift_avg')) {
      console.error('FAIL: /metrics missing drift gauges after step');
      process.exit(1);
    }
    console.log('  ✓ /metrics drift gauges populated');

    // 6. Cleanup: delete the system
    const d = await req('DELETE', '/api/systems/' + id);
    console.log('  delete →', d.status);
    if (d.status !== 200) { console.error('FAIL: delete'); process.exit(1); }

    console.log('\nPhase 14 end-to-end: ALL PASS');
    process.exit(0);
  }
  sock.on('close', onClose);
  sock.on('error', (e) => { console.error('WS socket error:', e.message); process.exit(1); });
}

main().catch(e => { console.error(e); process.exit(1); });
