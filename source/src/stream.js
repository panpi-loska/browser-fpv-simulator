// ---------------------------------------------------------------------------
// stream.js: keeps the city around the camera. Pieces near it are made in full (with collision
// for libfpv and the ground light), farther ones as a skyline of buildings and lights, and the
// ones left behind are let go, so memory stays the same however far you fly. Pieces are made by
// workers (gen.js) and handed over a few per frame.
// ---------------------------------------------------------------------------

function createStreamer(Q, R, core) {
  const key = (cx, cz) => cx + ',' + cz;
  const chunks = new Map();          // key -> { cx, cz, lod, boxes, snd (what each box sounds like), marks, raster, obj }
  const inflight = new Map();        // id -> { k, lod, w }
  const want = new Map();            // key -> lod wanted right now (-1: let it go)
  const results = [], dirty = new Set();
  let nextId = 1, center = [0, 0], sync = [];

  // ---- workers: the generator's source, as a blob (one file, no separate script to fetch) ----
  const workers = [];
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    for (let i = 0, n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3); i < n; i++) {
      const w = new Worker(url);
      w.busy = 0;
      w.onmessage = (e) => { w.busy--; results.push(e.data); };
      w.onerror = (e) => console.error('city worker:', e.message);
      workers.push(w);
    }
  } catch (e) { console.warn('no workers, making the city on the main thread:', e); }

  function request(cx, cz, lod) {
    const k = key(cx, cz), id = nextId++;
    if (workers.length) {
      const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      w.busy++;
      inflight.set(id, { k, lod, w });
      w.postMessage({ id, cx, cz, lod, Q, map: MAP });
    } else {
      inflight.set(id, { k, lod });
      sync.push({ id, cx, cz, lod });
    }
  }
  const pendingFor = (k) => { for (const r of inflight.values()) if (r.k === k) return r; return null; };

  // ---- what should be loaded, around center ----
  function plan() {
    const ccx = Math.floor(center[0] / CHUNK), ccz = Math.floor(center[1] / CHUNK), rl = Math.ceil((Q.ringLite + 200) / CHUNK);
    want.clear();
    const asks = [];
    for (let dz = -rl; dz <= rl; dz++)
      for (let dx = -rl; dx <= rl; dx++) {
        const cx = ccx + dx, cz = ccz + dz, k = key(cx, cz);
        const d = Math.hypot((cx + 0.5) * CHUNK - center[0], (cz + 0.5) * CHUNK - center[1]);
        const c = chunks.get(k);
        // a little hysteresis, so pieces on the edge don't flicker between levels
        let lod = d < Q.ringFull ? 1 : d < Q.ringLite ? 0 : -1;
        if (c && c.lod === 1 && d < Q.ringFull + 160) lod = 1;
        if (c && lod < 0 && d < Q.ringLite + 200) lod = c.lod >= 0 ? 0 : -1;
        if (c && c.lod === 1 && lod === 0 && d >= Q.ringFull + 160) lod = 0;
        want.set(k, lod);
        if (lod < 0) continue;
        if (!c || c.lod !== lod) {
          const p = pendingFor(k);
          if (!p || p.lod !== lod) asks.push({ cx, cz, lod, d: d - (lod ? 4000 : 0) });
        }
      }
    // pieces no longer wanted at all go now
    for (const [k, c] of chunks) if (!want.has(k) || want.get(k) < 0) drop(k, c);
    asks.sort((a, b) => a.d - b.d);
    const room = Math.max(0, (workers.length || 1) * 3 - inflight.size);
    for (const a of asks.slice(0, room)) request(a.cx, a.cz, a.lod);
  }

  function drop(k, c) {
    R.chunkRemove(k);
    if (c.obj) core.removeObject(c.obj);
    if (c.lod === 1) R.clearTile(c.cx, c.cz);
    chunks.delete(k);
  }

  function apply(out) {
    const k = key(out.cx, out.cz), w = want.get(k);
    if (w === undefined || w < 0) return;          // left behind while it was being made
    const old = chunks.get(k);
    if (old) { R.chunkRemove(k); if (old.obj) core.removeObject(old.obj); if (old.lod === 1 && out.lod === 0) R.clearTile(out.cx, out.cz); }
    R.chunkAdd(k, out.groups);
    const c = { cx: out.cx, cz: out.cz, lod: out.lod, boxes: out.boxes, snd: out.snd, marks: out.marks, raster: out.raster || null, obj: 0 };
    if (out.lod === 1) {
      c.obj = core.addObject(out.mesh);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const n = chunks.get(key(out.cx + dx, out.cz + dz)); if (n && n.lod === 1) dirty.add(key(n.cx, n.cz)); }
      dirty.add(k);
    }
    chunks.set(k, c);
  }

  // ---- the ground under a piece: its raster and its neighbours' spill, added up, then ambient occlusion ----
  const M = 4, W = TILE + 2 * M;
  function composeTile(c) {
    const light = new Float32Array(TILE * TILE * 3), foot = new Float32Array(W * W), lay = new Uint8Array(TILE * TILE * 4);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = chunks.get(key(c.cx + dx, c.cz + dz));
        if (!n || n.lod !== 1 || !n.raster) continue;
        const { light: L, foot: F, lay: Y } = n.raster, ox = dx * TILE - TPAD, oz = dz * TILE - TPAD;
        for (let j = Math.max(0, -M - oz); j < Math.min(TP, TILE + M - oz); j++) {
          const ty = oz + j, inY = ty >= 0 && ty < TILE;
          for (let i = Math.max(0, -M - ox); i < Math.min(TP, TILE + M - ox); i++) {
            const tx = ox + i, s = j * TP + i;
            if (F[s]) foot[(ty + M) * W + tx + M] = 1;
            if (!inY || tx < 0 || tx >= TILE) continue;
            const o = ty * TILE + tx;
            light[o * 3] += L[s * 3]; light[o * 3 + 1] += L[s * 3 + 1]; light[o * 3 + 2] += L[s * 3 + 2];
            if (Y[s * 4] !== 255) lay[o * 4] = Y[s * 4];
            if (Y[s * 4 + 1] > lay[o * 4 + 1]) lay[o * 4 + 1] = Y[s * 4 + 1];
            if (Y[s * 4 + 3] > lay[o * 4 + 3]) lay[o * 4 + 3] = Y[s * 4 + 3];
          }
        }
      }
    const ao = boxBlur(boxBlur(foot, W, 3), W, 1);
    const rgba = new Uint8Array(TILE * TILE * 4);
    for (let ty = 0; ty < TILE; ty++)
      for (let tx = 0; tx < TILE; tx++) {
        const o = ty * TILE + tx;
        rgba[o * 4] = Math.min(255, light[o * 3] / 32);
        rgba[o * 4 + 1] = Math.min(255, light[o * 3 + 1] / 32);
        rgba[o * 4 + 2] = Math.min(255, light[o * 3 + 2] / 32);
        rgba[o * 4 + 3] = Math.round(255 * (1 - 0.7 * Math.min(1, ao[(ty + M) * W + tx + M] * 1.6)));
      }
    R.writeTile(c.cx, c.cz, rgba, lay);
  }
  function boxBlur(src, n, rad) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let r = 0; r < n; r++) {
      let acc = 0;
      for (let c = -rad; c < n + rad; c++) {
        if (c + rad < n) acc += src[r * n + c + rad];
        if (c - rad - 1 >= 0) acc -= src[r * n + c - rad - 1];
        if (c >= 0 && c < n) tmp[r * n + c] = acc / (2 * rad + 1);
      }
    }
    for (let c = 0; c < n; c++) {
      let acc = 0;
      for (let r = -rad; r < n + rad; r++) {
        if (r + rad < n) acc += tmp[(r + rad) * n + c];
        if (r - rad - 1 >= 0) acc -= tmp[(r - rad - 1) * n + c];
        if (r >= 0 && r < n) out[r * n + c] = acc / (2 * rad + 1);
      }
    }
    return out;
  }

  // ---- once per frame: plan, take in finished pieces (a few, to keep frames smooth), refresh ground tiles ----
  let planT = 0;
  function update(cx, cz, dt, budgetMs = 5) {
    center = [cx, cz];
    planT -= dt;
    if (planT <= 0) { plan(); planT = 0.25; }
    const t0 = performance.now();
    if (!workers.length && sync.length) {
      const s = sync.shift(), out = genChunk(s.cx, s.cz, s.lod, Q);
      if (s.lod) chunkRaster(out);
      results.push({ id: s.id, out });
    }
    // finished pieces first (at least one a frame), then the ground under them, nearest first
    // (at least one a frame too, so a busy stream of pieces never leaves the ground unlit)
    for (let n = 0; results.length && (n === 0 || performance.now() - t0 < budgetMs * 0.6); n++) {
      const { id, out } = results.shift();
      inflight.delete(id);
      apply(out);
    }
    if (dirty.size) {
      const ccx = center[0] / CHUNK - 0.5, ccz = center[1] / CHUNK - 0.5;
      const order = [...dirty].map((k) => { const c = chunks.get(k); return { k, c, d: c ? (c.cx - ccx) ** 2 + (c.cz - ccz) ** 2 : 0 }; }).sort((a, b) => a.d - b.d);
      for (let n = 0; n < order.length && (n === 0 || performance.now() - t0 < budgetMs); n++) {
        const { k, c } = order[n];
        dirty.delete(k);
        if (c && c.lod === 1 && chunks.get(k) === c) composeTile(c);
      }
    }
  }

  // ---- questions about what is loaded ----
  function eachBoxNear(x, z, r, fn) {
    for (let cz = Math.floor((z - r - 130) / CHUNK); cz <= Math.floor((z + r + 130) / CHUNK); cz++)
      for (let cx = Math.floor((x - r - 130) / CHUNK); cx <= Math.floor((x + r + 130) / CHUNK); cx++) {
        const c = chunks.get(key(cx, cz));
        if (!c) continue;
        // oriented boxes: cx, cz, hx, hz, cos, sin, bottom, top (gen.js)
        const b = c.boxes;
        for (let i = 0; i < b.length; i += 8) { const e = b[i + 2] + b[i + 3] + r; if (Math.abs(b[i] - x) <= e && Math.abs(b[i + 1] - z) <= e) fn(b, i, c.snd ? c.snd[i >> 3] : 0); }
      }
  }
  // the highest solid surface under (x, z) that is below y: a roof, a bridge deck, the street or the river
  function supportY(x, z, y) {
    let best = inRiver(x, z) ? RIVER.level : ROADY;
    eachBoxNear(x, z, 0, (b, i) => {
      const [lx, lz] = boxLocal(b, i, x, z);
      if (Math.abs(lx) <= b[i + 2] && Math.abs(lz) <= b[i + 3] && b[i + 7] <= y + 0.5) best = Math.max(best, b[i + 7]);
    });
    return best;
  }
  // the piece under (x, z) and its neighbours are in full, with collision
  function ready(x, z) {
    const ccx = Math.floor(x / CHUNK), ccz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const k = key(ccx + dx, ccz + dz), c = chunks.get(k); if (!c || c.lod !== 1 || dirty.has(k)) return false; }
    return true;
  }
  function findMark(type, x, z) {
    let best = null, bd = Infinity;
    for (const c of chunks.values()) for (const m of c.marks) if (m.type === type) { const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  // how much of what is wanted near (x, z) is in (for the loading bar)
  function progressNear(x, z, r) {
    let have = 0, all = 0;
    for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++)
      for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) { all++; const c = chunks.get(key(cx, cz)); if (c && c.lod === 1) have++; }
    return have / all;
  }
  function stats() {
    let full = 0, lite = 0;
    for (const c of chunks.values()) c.lod === 1 ? full++ : lite++;
    return { full, lite, pending: inflight.size };
  }
  return { update, supportY, eachBoxNear, ready, findMark, progressNear, stats };
}
// a point in an oriented box's own coordinates, and back
function boxLocal(b, i, x, z) { const dx = x - b[i], dz = z - b[i + 1], c = b[i + 4], s = b[i + 5]; return [dx * c - dz * s, dx * s + dz * c]; }
function boxWorld(b, i, lx, lz) { const c = b[i + 4], s = b[i + 5]; return [b[i] + lx * c + lz * s, b[i + 1] - lx * s + lz * c]; }
