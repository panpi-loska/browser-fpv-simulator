// ---------------------------------------------------------------------------
// layout.js: the streets inside a superblock (the space between four avenues), and the blocks they
// leave. Every superblock gets its own network, from its own seed, so it comes out the same for
// every piece of the city that asks. Streets are always straight. Most superblocks have a grid lined
// up with the avenues; in some neighbourhoods (old town, part of the residential ones and the suburbs)
// the grid inside is turned by an angle the whole neighbourhood shares, as where parts of a city laid
// out at different times meet, and now and then one wide diagonal street cuts a superblock from corner
// to corner. Where a turned grid or a diagonal meets the avenues the blocks are triangles and
// trapezia. The polygon helpers below are what gen.js builds blocks with.
// ---------------------------------------------------------------------------

// ---------- convex polygons: [{ x, z, t }], t tags the edge from this point to the next ----------
// tag: { rid } a street of this superblock (its index), { side } an avenue ('x0', 'x1', 'z0', 'z1')
function polyArea(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.z - q.x * p.z; }
  return a / 2;
}
function polyCentroid(P) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], k = p.x * q.z - q.x * p.z;
    a += k; cx += (p.x + q.x) * k; cz += (p.z + q.z) * k;
  }
  if (Math.abs(a) < 1e-6) return { x: P[0].x, z: P[0].z };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}
// keeps the side where (p - P).n >= off; the new edge along the cut gets tag
function clipPoly(P, px, pz, nx, nz, off, tag) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = (a.x - px) * nx + (a.z - pz) * nz - off, db = (b.x - px) * nx + (b.z - pz) * nz - off;
    if (da >= 0) out.push({ x: a.x, z: a.z, t: a.t });
    if ((da >= 0) !== (db >= 0)) {
      const k = da / (da - db), I = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, t: null };
      // leaving: the edge from I runs along the cut; entering: the rest of the original edge
      I.t = da >= 0 ? tag : a.t;
      out.push(I);
    }
  }
  // drop points closer than 1 cm (a cut through a corner)
  const clean = [];
  for (const p of out) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.01) clean.push(p); else q.t = p.t; }
  while (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].z - clean[clean.length - 1].z) < 0.01) clean.pop();
  return clean.length >= 3 && Math.abs(polyArea(clean)) > 1 ? clean : null;
}
// where the line P + s*d crosses the polygon: the two ends, and the edges they lie on
function chordOf(P, px, pz, dx, dz) {
  let lo = Infinity, hi = -Infinity, tlo = null, thi = null;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ex = b.x - a.x, ez = b.z - a.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((a.x - px) * ez - (a.z - pz) * ex) / den, u = ((a.x - px) * dz - (a.z - pz) * dx) / den;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    if (s < lo) { lo = s; tlo = a.t; }
    if (s > hi) { hi = s; thi = a.t; }
  }
  return hi - lo > 1 ? { lo, hi, tlo, thi } : null;
}
function insidePoly(P, x, z) {
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
// every edge moved in by d; null if the polygon is too small for that
function insetPoly(P, d) {
  const ccw = polyArea(P) > 0, n = P.length, lines = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L, nx = ccw ? -tz : tz, nz = ccw ? tx : -tx;
    lines.push({ x: a.x + nx * d, z: a.z + nz * d, tx, tz, t: a.t });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n], B = lines[i], den = A.tx * B.tz - A.tz * B.tx;
    if (Math.abs(den) < 1e-6) { out.push({ x: B.x, z: B.z, t: B.t }); continue; }
    const s = ((B.x - A.x) * B.tz - (B.z - A.z) * B.tx) / den;
    out.push({ x: A.x + A.tx * s, z: A.z + A.tz * s, t: B.t });
  }
  // an edge that turned around means the polygon collapsed
  for (let i = 0; i < n; i++) {
    const a = out[i], b = out[(i + 1) % n];
    if ((b.x - a.x) * lines[i].tx + (b.z - a.z) * lines[i].tz < 0.5) return null;
  }
  return Math.abs(polyArea(out)) > 20 ? out : null;
}
function longestEdgeAngle(P) {
  let best = 0, ang = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > best) { best = L; ang = Math.atan2(b.z - a.z, b.x - a.x); }
  }
  return ang;
}

// ---------- a superblock's streets: a grid, as a real city has ----------
// Streets lie on lattices shared by the whole city (positions multiple of 30 m, a little jitter keyed
// to the line), so they carry on across the avenues, and districts whose spacings share a multiple
// share streets too. Each district has its own block size; some lattice lines are missing (longer
// blocks), and some blocks are joined (a street stops at a T): rectangles of many sizes, no odd shapes.
// The spacings nest (60 / 120 / 240 m), so where two districts meet across an avenue the sparser
// one's streets are a subset of the denser one's and carry straight on.
// keep: the share of lattice lines a district keeps (the same draw everywhere, so a line kept in a
// sparse district is kept in a dense one too); a dropped line is put back if its neighbours are gone
// too, so no stretch goes much more than one and a half blocks without a street
const GRID = {   // spacing of the streets that run north-south (sx) and east-west (sz), their width
  downtown: { sx: 120, sz: 120, w: 12, join: 0.06, keep: 0.97 },
  midtown: { sx: 120, sz: 60, w: 12, join: 0.12, keep: 0.93 },
  residential: { sx: 120, sz: 60, w: 11, join: 0.12, keep: 0.88 },
  oldtown: { sx: 60, sz: 60, w: 8, join: 0.14, keep: 0.92 },
  industrial: { sx: 240, sz: 120, w: 14, join: 0.2, keep: 0.8 },
  suburb: { sx: 120, sz: 60, w: 9, join: 0.08, keep: 0.9 },
};
const lineX = (n) => n * 30 + (ih(n, 101) - 0.5) * 6;
const lineZ = (n) => n * 30 + (ih(n, 103) - 0.5) * 6;
// the lattice lines of spacing S inside (a, b): far enough from the avenues that no block is a thin
// strip, not dropped, and never closer together than a block can be
function latticeLines(a, b, S, at, salt, keep) {
  const out = [], k = S / 30, m = Math.max(S * 0.6, 36), gap = Math.max(S * 0.55, 34);
  let last = a;
  for (let n = Math.ceil((a + m) / S) * k - k; n * 30 <= b; n += k) {
    const p = at(n);
    if (p <= a + m || p >= b - m || p - last < gap) continue;
    // kept by the shared draw, or put back after a long stretch (if it leaves room before the end)
    if (ih(n, salt) < keep || (p - last > S * 1.55 && b - p > S * 0.6)) { out.push(p); last = p; }
  }
  // a wide superblock never goes without a street: the lattice line nearest its middle (a finer
  // lattice if the district's own has none far enough from both avenues)
  if (!out.length && b - a > 260)
    for (const T of [S, 120, 60]) {
      const kk = T / 30, n = Math.round((a + b) / 2 / T) * kk, p = at(n);
      if (p > a + 90 && p < b - 90) { out.push(p); break; }
    }
  return out;
}
// ---------- neighbourhoods: which way the grid inside a superblock is turned ----------
// A neighbourhood is a cell about 1.5 km across (its edges bent by a slow noise, so they are not a
// grid themselves). All of it shares one angle: its superblocks agree, and their streets carry on
// across the avenues between them. Downtown and industry stay lined up with the avenues (towers,
// yards and the railway want that), and so does every superblock that holds a landmark tower.
const HOOD = 1500;
function hoodOf(x, z) {
  const wx = x + (vnoise(x / 1100 + 3.3, z / 1100 - 8.1) - 0.5) * 900, wz = z + (vnoise(x / 1100 - 11.7, z / 1100 + 4.9) - 0.5) * 900;
  return [Math.floor(wx / HOOD), Math.floor(wz / HOOD)];
}
// { ang: the grid's angle (radians, 0 lined up), diag: +1 / -1 a diagonal street across, 0 none }
function gridPlan(sb) {
  const none = { ang: 0, diag: 0 };
  if (sb.river || sb.special || sb.kind === 'park') return none;
  const W = sb.x1 - sb.x0, D = sb.z1 - sb.z0, k = sb.kind;
  if (W < 280 || D < 280) return none;
  for (const p of corePeaks(sb.cx, sb.cz)) if (p.px > sb.x0 - 60 && p.px < sb.x1 + 60 && p.pz > sb.z0 - 60 && p.pz < sb.z1 + 60) return none;
  const [a, b] = hoodOf(sb.cx, sb.cz), u = ih2(a, b, 110), deg = 15 + 30 * ih2(a, b, 111), sg = ih2(a, b, 112) < 0.5 ? -1 : 1;
  let ang = 0;
  if (k === 'oldtown' && u < 0.8) ang = Math.max(deg, 20);
  else if (k === 'residential' && u < 0.5) ang = Math.min(deg, 30);
  else if (k === 'suburb' && u < 0.35) ang = Math.min(deg, 25);
  if (ang) return { ang: (sg * ang * Math.PI) / 180, diag: 0 };
  if ((k === 'midtown' || k === 'residential') && W > 340 && D > 340 && ih(sb.seed, 113) < (k === 'midtown' ? 0.16 : 0.07)) return { ang: 0, diag: ih(sb.seed, 114) < 0.5 ? 1 : -1 };
  return none;
}
// The streets of a superblock whose grid is turned (ang) or cut by a diagonal (diag): every street is
// a straight cut through the polygons made so far, so the blocks are convex polygons: rectangles in
// the middle, triangles and trapezia against the avenues and along the diagonal.
function cutLayout(sb, L, G, sz, plan, rng) {
  const half = AVE.w / 2, X0 = sb.x0 + half, X1 = sb.x1 - half, Z0 = sb.z0 + half, Z1 = sb.z1 - half, w = G.w;
  const SIDE = { x0: [0, 1], x1: [0, 1], z0: [1, 0], z1: [1, 0] }, seen = new Set();
  // the end of a street on an avenue or on another street: the other one's lamps keep clear of the
  // mouth; where it does not meet it squarely the asphalt runs on to fill the corner (ext, a length)
  const meet = (road, end, t, x, z, dx, dz) => {
    if (!t) return;
    let ex, ez, ow;
    if (t.side) { [ex, ez] = SIDE[t.side]; ow = AVE.w; }
    else { const o = L.roads[t.rid], ol = Math.hypot(o.bx - o.ax, o.bz - o.az); ex = (o.bx - o.ax) / ol; ez = (o.bz - o.az) / ol; ow = o.w; }
    const sin = Math.abs(dx * ez - dz * ex), cos = Math.abs(dx * ex + dz * ez), square = sin > 0.985;
    if (!square) road[end ? 'ext1' : 'ext0'] = Math.min(30, ((road.w / 2) * cos) / Math.max(sin, 0.25));
    const mouth = road.w / Math.max(sin, 0.4);
    if (t.side) {
      const pos = t.side[0] === 'x' ? z : x;
      L.edgeJ[t.side].push({ pos, w: mouth });
      // a zebra crossing over the avenue at the mouth
      if (t.side[0] === 'x') L.crossings.push({ x: t.side === 'x0' ? sb.x0 : sb.x1, z, wx: AVE.w, wz: mouth });
      else L.crossings.push({ x, z: t.side === 'z0' ? sb.z0 : sb.z1, wx: mouth, wz: AVE.w });
    } else {
      const o = L.roads[t.rid];
      o.junc.push((x - o.ax) * ex + (z - o.az) * ez);
      road.junc.push(end ? Math.hypot(road.bx - road.ax, road.bz - road.az) : 0);
      // streets that cross squarely: one zebra-striped crossing where their centre lines meet
      const sg = end ? 1 : -1, jx = x + dx * sg * ow / 2, jz = z + dz * sg * ow / 2, key = Math.round(jx) + ',' + Math.round(jz);
      if (square && !seen.has(key)) { seen.add(key); L.crossings.push({ x: jx, z: jz, wx: o.w, wz: road.w, yaw: Math.atan2(-ez, ex) }); }
    }
  };
  // a street along the line P + s*d through polygon poly: the two polygons either side, or null (and
  // no street) if one of them would be a scrap
  const cut = (poly, px, pz, dx, dz, rw, kind, minArea) => {
    const ch = chordOf(poly, px, pz, dx, dz);
    if (!ch || ch.hi - ch.lo < 40) return null;
    const nx = -dz, nz = dx, tag = { rid: L.roads.length };
    const a = clipPoly(poly, px, pz, nx, nz, rw / 2, tag), b = clipPoly(poly, px, pz, -nx, -nz, rw / 2, tag);
    if (!a || !b || Math.abs(polyArea(a)) < minArea || Math.abs(polyArea(b)) < minArea) return null;
    const road = { ax: px + dx * ch.lo, az: pz + dz * ch.lo, bx: px + dx * ch.hi, bz: pz + dz * ch.hi, w: rw, kind, junc: [], ext0: 0, ext1: 0 };
    L.roads.push(road);
    meet(road, 0, ch.tlo, road.ax, road.az, dx, dz); meet(road, 1, ch.thi, road.bx, road.bz, dx, dz);
    return [a, b];
  };
  let polys = [rect(X0, Z0, X1, Z1)];
  if (plan.diag) {
    // from near one corner to near the opposite one, through the short sides (so it is long)
    const W = X1 - X0, D = Z1 - Z0, m = clamp(0.2 * Math.min(W, D), 55, 95), f = plan.diag > 0;
    const [ax, az, bx, bz] = W >= D ? [X0, f ? Z0 + m : Z1 - m, X1, f ? Z1 - m : Z0 + m] : [f ? X0 + m : X1 - m, Z0, f ? X1 - m : X0 + m, Z1];
    const l = Math.hypot(bx - ax, bz - az), res = cut(polys[0], ax, az, (bx - ax) / l, (bz - az) / l, w + 5, 'boulevard', 2000);
    if (res) polys = res;
  }
  // the grid: lines of constant u (one family) and of constant v (the other), u along (cos, sin) of
  // the angle; both on lattices shared by everything turned the same way
  const c = Math.cos(plan.ang), sn = Math.sin(plan.ang);
  let lu, lv;
  if (!plan.ang) { lu = latticeLines(X0, X1, G.sx, lineX, 105, G.keep); lv = latticeLines(Z0, Z1, sz, lineZ, 107, G.keep); }
  else {
    const span = (ax, az) => { const q = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]].map(([x, z]) => x * ax + z * az); return [Math.min(...q), Math.max(...q)]; };
    const family = (lo, hi, S, salt) => {
      const out = [], k = S / 30;
      let gone = false;
      for (let n = Math.ceil(lo / S) * k; n * 30 < hi; n += k) {
        if (ih(n, salt) < G.keep || gone) { out.push(n * 30 + (ih(n, salt + 1) - 0.5) * 6); gone = false; } else gone = true;
      }
      return out;
    };
    lu = family(...span(c, sn), G.sx, 115); lv = family(...span(-sn, c), sz, 117);
  }
  const minA = Math.max(260, G.sx * sz * 0.07);
  const run = (lines, px, pz, dx, dz, tee) => {
    for (const q of lines) {
      const next = [];
      for (const poly of polys) {
        // now and then a street stops at a T instead of going on through this block
        const res = tee && rng() < G.join && Math.abs(polyArea(poly)) < G.sx * sz * 2.2 ? null : cut(poly, px(q), pz(q), dx, dz, w, 'street', minA);
        if (res) next.push(...res); else next.push(poly);
      }
      polys = next;
    }
  };
  run(lu, (q) => q * c, (q) => q * sn, -sn, c, false);
  run(lv, (q) => -q * sn, (q) => q * c, c, sn, true);
  for (const poly of polys) L.blocks.push({ poly });
}
function sbLayout(sb) {
  if (sb.layout) return sb.layout;
  const half = AVE.w / 2, X0 = sb.x0 + half, X1 = sb.x1 - half, Z0 = sb.z0 + half, Z1 = sb.z1 - half;
  const L = { style: 'grid', roads: [], blocks: [], crossings: [], edgeJ: { x0: [], x1: [], z0: [], z1: [] } };
  sb.layout = L;
  if (sb.kind === 'park' || sb.river || sb.special) { L.blocks.push({ poly: rect(X0, Z0, X1, Z1) }); finishBlocks(sb, L); return L; }
  const G = GRID[sb.kind] || GRID.residential, w = G.w, rng = mulberry32(sb.seed ^ 0x2545f491);
  // residential blocks are 60 or 120 m deep, by neighbourhood (a slow field, so neighbours agree)
  const sz = sb.kind === 'residential' && vnoise(sb.cx / 2800 + 61.3, sb.cz / 2800 - 7.7) > 0.52 ? 120 : G.sz;
  const plan = gridPlan(sb);
  if (plan.ang || plan.diag) { L.style = plan.ang ? 'turned' : 'diagonal'; L.ang = plan.ang; cutLayout(sb, L, G, sz, plan, rng); finishBlocks(sb, L); return L; }
  // street centre lines; xs / zs also hold the avenue edges at both ends
  const vx = latticeLines(X0, X1, G.sx, lineX, 105, G.keep), hz = latticeLines(Z0, Z1, sz, lineZ, 107, G.keep);
  const xs = [X0, ...vx, X1], zs = [Z0, ...hz, Z1], nx = xs.length - 1, nz = zs.length - 1;
  // cells (a, b) between them; joining two cells removes the street segment between them
  const cell = (a, b) => b * nx + a, taken = new Int32Array(nx * nz).fill(-1);
  const goneV = new Set(), goneH = new Set();   // vertical segment (line i, row b) "i,b"; horizontal (line j, column a) "j,a"
  const rects = [];
  const order = [];
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) order.push([a, b, rng()]);
  order.sort((p, q) => p[2] - q[2]);
  for (const [a, b] of order) {
    if (taken[cell(a, b)] >= 0) continue;
    const r = rng(), id = rects.length;
    let a1 = a, b1 = b;
    if (r < G.join * 0.2 && a + 1 < nx && b + 1 < nz && [cell(a + 1, b), cell(a, b + 1), cell(a + 1, b + 1)].every((c) => taken[c] < 0)) {
      a1 = a + 1; b1 = b + 1;   // a big block (a mall, a hospital, a park): four joined
      goneV.add(a + 1 + ',' + b); goneV.add(a + 1 + ',' + (b + 1)); goneH.add(b + 1 + ',' + a); goneH.add(b + 1 + ',' + (a + 1));
    } else if (r < G.join) {
      // join across the shorter side, so the joined block is squarer, not a long strip
      const cw = xs[a + 1] - xs[a], ch = zs[b + 1] - zs[b], rightOk = a + 1 < nx && taken[cell(a + 1, b)] < 0, downOk = b + 1 < nz && taken[cell(a, b + 1)] < 0;
      const across = cw <= ch ? (rightOk ? 'r' : null) : (downOk ? 'd' : null);
      if (across === 'r') { a1 = a + 1; goneV.add(a + 1 + ',' + b); }
      else if (across === 'd') { b1 = b + 1; goneH.add(b + 1 + ',' + a); }
    }
    for (let bb = b; bb <= b1; bb++) for (let aa = a; aa <= a1; aa++) taken[cell(aa, bb)] = id;
    rects.push([a, b, a1, b1]);
  }
  for (const [a, b, a1, b1] of rects) {
    const x0 = a === 0 ? xs[0] : xs[a] + w / 2, x1 = a1 + 1 === nx ? xs[nx] : xs[a1 + 1] - w / 2;
    const z0 = b === 0 ? zs[0] : zs[b] + w / 2, z1 = b1 + 1 === nz ? zs[nz] : zs[b1 + 1] - w / 2;
    L.blocks.push({ poly: rect(x0, z0, x1, z1) });
  }
  // the streets: runs of segments still there, along each line
  const vHas = (i, b) => i > 0 && i < nx && b >= 0 && b < nz && !goneV.has(i + ',' + b);
  const hHas = (j, a) => j > 0 && j < nz && a >= 0 && a < nx && !goneH.has(j + ',' + a);
  for (let i = 1; i < nx; i++)
    for (let b = 0; b < nz;) {
      if (!vHas(i, b)) { b++; continue; }
      let e = b;
      while (vHas(i, e + 1)) e++;
      const road = { ax: xs[i], az: zs[b], bx: xs[i], bz: zs[e + 1], w, kind: 'street', junc: [] };
      for (let j = b; j <= e + 1; j++) if (j > 0 && j < nz && (hHas(j, i - 1) || hHas(j, i))) road.junc.push(zs[j] - zs[b]);
      L.roads.push(road);
      if (b === 0) { L.edgeJ.z0.push({ pos: xs[i], w }); L.crossings.push({ x: xs[i], z: sb.z0, wx: w, wz: AVE.w }); }
      if (e + 1 === nz) { L.edgeJ.z1.push({ pos: xs[i], w }); L.crossings.push({ x: xs[i], z: sb.z1, wx: w, wz: AVE.w }); }
      b = e + 1;
    }
  for (let j = 1; j < nz; j++)
    for (let a = 0; a < nx;) {
      if (!hHas(j, a)) { a++; continue; }
      let e = a;
      while (hHas(j, e + 1)) e++;
      const road = { ax: xs[a], az: zs[j], bx: xs[e + 1], bz: zs[j], w, kind: 'street', junc: [] };
      for (let i = a; i <= e + 1; i++) if (i > 0 && i < nx && (vHas(i, j - 1) || vHas(i, j))) road.junc.push(xs[i] - xs[a]);
      L.roads.push(road);
      if (a === 0) { L.edgeJ.x0.push({ pos: zs[j], w }); L.crossings.push({ x: sb.x0, z: zs[j], wx: AVE.w, wz: w }); }
      if (e + 1 === nx) { L.edgeJ.x1.push({ pos: zs[j], w }); L.crossings.push({ x: sb.x1, z: zs[j], wx: AVE.w, wz: w }); }
      a = e + 1;
    }
  // where streets meet inside: a crossing (with zebra crossings), at junctions and T junctions alike
  for (let i = 1; i < nx; i++)
    for (let j = 1; j < nz; j++) {
      const v = vHas(i, j - 1) || vHas(i, j), h = hHas(j, i - 1) || hHas(j, i);
      if (v && h) L.crossings.push({ x: xs[i], z: zs[j], wx: w, wz: w });
    }
  finishBlocks(sb, L);
  return L;
}
function rect(x0, z0, x1, z1) {
  return [{ x: x0, z: z0, t: { side: 'z0' } }, { x: x1, z: z0, t: { side: 'x1' } }, { x: x1, z: z1, t: { side: 'z1' } }, { x: x0, z: z1, t: { side: 'x0' } }];
}
// each block: its centre (which piece owns it), its seed; blocks line up with the avenues.
// ave: the sides that face an avenue (1 x0, 2 x1, 4 z0, 8 z1, as a lot's sides); landmark: the block
// nearest a centre's peak holds its landmark tower; square: the corner that opens onto a square
function finishBlocks(sb, L) {
  const half = AVE.w / 2, X0 = sb.x0 + half, X1 = sb.x1 - half, Z0 = sb.z0 + half, Z1 = sb.z1 - half;
  const sq = sb.river || sb.special || sb.kind === 'park' || L.style !== 'grid' ? [] : squareCorners(sb);
  L.blocks.forEach((b, i) => {
    const c = polyCentroid(b.poly), bx = polyBox(b.poly), area = Math.abs(polyArea(b.poly));
    b.cx = c.x; b.cz = c.z;
    b.seed = pcg((sb.seed ^ pcg(i * 131 + 7)) >>> 0);
    // its buildings line up with its longest side
    let a = longestEdgeAngle(b.poly);
    a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (a > Math.PI / 4) a -= Math.PI / 2;
    b.angle = Math.abs(a) < 0.02 ? 0 : a;
    b.sbKind = sb.kind;
    b.rect = b.poly.length === 4 && area > 0.985 * (bx.x1 - bx.x0) * (bx.z1 - bx.z0);
    // a small odd-shaped block left where streets meet at an angle: a little square with trees, a
    // garden, or a car park (the same draw for every piece that paints its ground)
    if (!b.rect && area < 1700 && L.style !== 'grid') { const u = ih(b.seed, 97); b.wedge = u < 0.4 ? 'largo' : u < 0.75 ? 'garden' : 'parking'; }
    b.ave = (bx.x0 <= X0 + 0.5 ? 1 : 0) | (bx.x1 >= X1 - 0.5 ? 2 : 0) | (bx.z0 <= Z0 + 0.5 ? 4 : 0) | (bx.z1 >= Z1 - 0.5 ? 8 : 0);
    for (const q of sq) {
      const qx = q.sx > 0 ? X0 : X1, qz = q.sz > 0 ? Z0 : Z1;
      if (Math.abs((q.sx > 0 ? bx.x0 : bx.x1) - qx) < 0.5 && Math.abs((q.sz > 0 ? bx.z0 : bx.z1) - qz) < 0.5) b.square = { x: qx, z: qz, sx: q.sx, sz: q.sz };
    }
  });
  if (sb.river || sb.special || sb.kind === 'park') return;
  for (const p of corePeaks(sb.cx, sb.cz)) {
    if (p.px < sb.x0 - 60 || p.px > sb.x1 + 60 || p.pz < sb.z0 - 60 || p.pz > sb.z1 + 60) continue;
    let best = null, bd = Infinity;
    for (const b of L.blocks) {
      const bx = polyBox(b.poly), d = Math.hypot(b.cx - p.px, b.cz - p.pz);
      if (bx.x1 - bx.x0 > 34 && bx.z1 - bx.z0 > 34 && d < bd) { bd = d; best = b; }
    }
    // a peak just over an avenue belongs to the superblock it is in (the other side gets none)
    const inside = p.px >= sb.x0 && p.px < sb.x1 && p.pz >= sb.z0 && p.pz < sb.z1;
    if (best && inside) best.landmark = { h: landmarkH(p) };
  }
}
// the corners of this superblock that open onto a square (where two avenues cross, now and then,
// in town: never by the river, in the suburbs or in industry)
const squareAt = (i, l) => l.kind === '' && !hasTrain(i) && !loopEndAt(i, l) && ih2(i * 7 + 3, l.k * 64 + l.m, 66) < 0.05 && ['downtown', 'midtown', 'residential', 'oldtown'].includes(districtAt(aveX(i), l.z));
function squareCorners(sb) {
  const out = [];
  for (const [i, l, sx, sz] of [[sb.i, sb.A, 1, 1], [sb.i + 1, sb.A, -1, 1], [sb.i, sb.B, 1, -1], [sb.i + 1, sb.B, -1, -1]]) if (squareAt(i, l)) out.push({ sx, sz });
  return out;
}
