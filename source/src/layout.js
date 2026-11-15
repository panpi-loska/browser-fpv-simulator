// ---------------------------------------------------------------------------
// layout.js: the streets inside a superblock (the space between four avenues), and the blocks they
// leave. Every superblock gets its own network, from its own seed, so it comes out the same for
// every piece of the city that asks:
//   grid      streets crossing at right angles, ending in T junctions, blocks of many sizes
//   rotated   the same, the whole grid turned 15-35 degrees from the avenues
//   diagonal  a boulevard cutting the superblock corner to corner, grid on both sides
//   radial    a roundabout in the middle, streets out from it, then smaller streets
//   organic   old town: crooked, narrow streets at all angles
//   curvy     the suburbs: winding streets, cul-de-sacs, houses facing the street
// Blocks are convex polygons (the space between streets: every street is a straight cut across a
// polygon, so the pieces stay convex); curvy suburbs are streets with houses along them instead.
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
    if (da >= 0) out.push({ x: a.x, z: a.z, t: da >= 0 && db < 0 ? a.t : a.t });
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

// ---------- a superblock's network ----------
const STYLE_WEIGHTS = {
  downtown: [['grid', 7], ['diagonal', 1.2], ['radial', 0.8], ['rotated', 1]],
  midtown: [['grid', 4], ['rotated', 2], ['diagonal', 1.5], ['radial', 1.5]],
  residential: [['grid', 3.5], ['rotated', 3], ['diagonal', 2], ['radial', 1.5]],
  oldtown: [['organic', 1]],
  industrial: [['grid', 3], ['diagonal', 1], ['rotated', 1]],
  suburb: [['curvy', 1]],
};
const STREET = {   // street width, the area a block aims for, its smallest side
  downtown: { w: 12, area: 9000, side: 45 }, midtown: { w: 12, area: 7000, side: 40 }, residential: { w: 11, area: 5200, side: 34 },
  oldtown: { w: 8, area: 2600, side: 24 }, industrial: { w: 14, area: 22000, side: 70 }, suburb: { w: 9, area: 0, side: 0 },
};
function sbLayout(sb) {
  if (sb.layout) return sb.layout;
  const rng = mulberry32(sb.seed ^ 0x2545f491), R = (a, b) => a + (b - a) * rng();
  const half = AVE.w / 2, X0 = sb.x0 + half, X1 = sb.x1 - half, Z0 = sb.z0 + half, Z1 = sb.z1 - half;
  const L = { style: 'none', roads: [], blocks: [], patches: [], edgeJ: { x0: [], x1: [], z0: [], z1: [] }, houses: [], trees: [], round: null };
  sb.layout = L;
  if (sb.kind === 'park' || sb.river) { L.blocks.push({ poly: rect(X0, Z0, X1, Z1), whole: true }); finishBlocks(sb, L); return L; }
  // Halvard Bay's own downtown keeps its grid
  const near = Math.hypot(sb.cx - 150, sb.cz + 300) < 900;
  const W = STYLE_WEIGHTS[sb.kind] || [['grid', 1]];
  let r = rng() * W.reduce((s, [, w]) => s + w, 0), style = W[0][0];
  for (const [k, w] of W) { if ((r -= w) <= 0) { style = k; break; } }
  if (near) style = 'grid';
  L.style = style;
  const S = STREET[sb.kind] || STREET.residential;
  if (style === 'curvy') { curvySuburb(sb, L, rng, X0, Z0, X1, Z1, S.w); return L; }

  // a street along the line P + s*d, cutting polygon poly: two polygons, and the street between them
  // (null, and nothing recorded, if either side would be smaller than minArea)
  const cut = (poly, px, pz, dx, dz, w, kind = 'street', minArea = 0) => {
    const ch = chordOf(poly, px, pz, dx, dz);
    if (!ch) return null;
    const nx = -dz, nz = dx, rid = L.roads.length, tag = { rid };
    const a = clipPoly(poly, px, pz, nx, nz, w / 2, tag), b = clipPoly(poly, px, pz, -nx, -nz, w / 2, tag);
    if (!a || !b || Math.abs(polyArea(a)) < minArea || Math.abs(polyArea(b)) < minArea) return null;
    const road = { ax: px + dx * ch.lo, az: pz + dz * ch.lo, bx: px + dx * ch.hi, bz: pz + dz * ch.hi, w, kind, junc: [] };
    L.roads.push(road);
    for (const [t, x, z] of [[ch.tlo, road.ax, road.az], [ch.thi, road.bx, road.bz]]) junction(t, x, z, w);
    return [a, b];
  };
  // a street ending on another street or an avenue: the other one's lamps keep clear, a patch of plain asphalt
  const junction = (t, x, z, w) => {
    if (!t) return;
    if (t.rid !== undefined) {
      const o = L.roads[t.rid], ox = o.bx - o.ax, oz = o.bz - o.az, ol = Math.hypot(ox, oz);
      const s = ((x - o.ax) * ox + (z - o.az) * oz) / ol;
      o.junc.push(s);
      const nx = -oz / ol, nz = ox / ol, side = Math.sign((x - o.ax) * nx + (z - o.az) * nz) || 1;
      L.patches.push({ x: x - nx * side * o.w / 2, z: z - nz * side * o.w / 2, r: Math.max(w, o.w) * 0.62 });
    } else if (t.side) {
      const pos = t.side[0] === 'x' ? z : x;
      L.edgeJ[t.side].push({ pos, w });
      const px = t.side === 'x0' ? x - half : t.side === 'x1' ? x + half : x, pz = t.side === 'z0' ? z - half : t.side === 'z1' ? z + half : z;
      L.patches.push({ x: px, z: pz, r: Math.max(w, AVE.w) * 0.55 });
    }
  };
  // ---- the first cuts that give each style its shape ----
  let polys = [rect(X0, Z0, X1, Z1)], frame = 0;
  if (style === 'rotated') frame = R(0.26, 0.6) * (rng() < 0.5 ? -1 : 1);
  if (style === 'diagonal') {
    const ang = R(0.6, 0.97) * (rng() < 0.5 ? -1 : 1), cx = sb.cx + R(-40, 40), cz = sb.cz + R(-40, 40);
    const res = cut(polys[0], cx, cz, Math.cos(ang), Math.sin(ang), S.w + 4, 'boulevard');
    if (res) polys = res;
  }
  if (style === 'radial') {
    const cx = sb.cx + R(-35, 35), cz = sb.cz + R(-35, 35), n = rng() < 0.5 ? 2 : 3, a0 = R(0, Math.PI), rr = R(18, 26);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * Math.PI) / n, dx = Math.cos(a), dz = Math.sin(a), next = [];
      for (const p of polys) { const res = cut(p, cx, cz, dx, dz, S.w); if (res) next.push(...res); else next.push(p); }
      polys = next;
    }
    // the roundabout: the wedges stop short of its ring
    polys = polys.map((p) => {
      const c = polyCentroid(p), dx = c.x - cx, dz = c.z - cz, dl = Math.hypot(dx, dz) || 1;
      return clipPoly(p, cx, cz, dx / dl, dz / dl, rr + S.w / 2 + 2, { ring: true });
    }).filter(Boolean);
    L.round = { x: cx, z: cz, r: rr, w: S.w };
    // the radial streets start at the ring
    for (const road of L.roads) {
      const dx = road.bx - road.ax, dz = road.bz - road.az, dl = Math.hypot(dx, dz), s = ((cx - road.ax) * dx + (cz - road.az) * dz) / dl;
      road.split = [s - rr, s + rr];
    }
    frame = a0;
  }
  // ---- then smaller streets, recursively, until the blocks are the size this district likes ----
  const org = style === 'organic';
  const rec = (poly, depth) => {
    const A = Math.abs(polyArea(poly));
    const ux = Math.cos(frame), uz = Math.sin(frame);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of poly) { const u = p.x * ux + p.z * uz, v = -p.x * uz + p.z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const lu = u1 - u0, lv = v1 - v0;
    const target = S.area * R(0.55, 1.5);
    if (depth > 9 || A < target || Math.min(lu, lv) < S.side * 2 + S.w) { L.blocks.push({ poly }); return; }
    if (depth >= 2 && A < target * 2.6 && rng() < (org ? 0.05 : 0.1)) { L.blocks.push({ poly, big: true }); return; }
    // cut across the longer side, somewhere near its middle
    const alongU = lu >= lv, f = R(0.36, 0.64), jit = org ? R(-0.4, 0.4) : 0;
    const pu = alongU ? u0 + lu * f : (u0 + u1) / 2, pv = alongU ? (v0 + v1) / 2 : v0 + lv * f;
    const px = pu * ux - pv * uz, pz = pu * uz + pv * ux;
    const ang = frame + (alongU ? Math.PI / 2 : 0) + jit;
    const w = org ? S.w * R(0.8, 1.15) : S.w;
    const res = cut(poly, px, pz, Math.cos(ang), Math.sin(ang), w, 'street', S.side * S.side * 0.8);
    if (!res) { L.blocks.push({ poly }); return; }   // the street would leave a sliver
    rec(res[0], depth + 1); rec(res[1], depth + 1);
  };
  for (const p of polys) rec(p, 0);
  finishBlocks(sb, L);
  return L;
}
function rect(x0, z0, x1, z1) {
  return [{ x: x0, z: z0, t: { side: 'z0' } }, { x: x1, z: z0, t: { side: 'x1' } }, { x: x1, z: z1, t: { side: 'z1' } }, { x: x0, z: z1, t: { side: 'x0' } }];
}
// each block: its centre (which piece owns it), its seed, the angle its buildings line up with
function finishBlocks(sb, L) {
  L.blocks.forEach((b, i) => {
    const c = polyCentroid(b.poly);
    b.cx = c.x; b.cz = c.z;
    b.seed = pcg((sb.seed ^ pcg(i * 131 + 7)) >>> 0);
    let a = longestEdgeAngle(b.poly);
    a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (a > Math.PI / 4) a -= Math.PI / 2;
    b.angle = Math.abs(a) < 0.02 ? 0 : a;
  });
}

// ---------- the suburbs: a winding street across, side streets ending in cul-de-sacs, houses along them ----------
function curvySuburb(sb, L, rng, X0, Z0, X1, Z1, w) {
  const R = (a, b) => a + (b - a) * rng(), M = 6;
  const inRect = (x, z, m) => x > X0 + m && x < X1 - m && z > Z0 + m && z < Z1 - m;
  const lines = [];   // every street's points, for keeping houses and streets apart
  const addStreet = (pts, ends) => {
    const id = L.roads.length;
    L.roads.push({ pts, w, kind: 'curvy', junc: [], ends });
    lines.push(pts);
    return id;
  };
  const near = (x, z, d, skip) => {
    for (let k = 0; k < lines.length; k++) {
      if (k === skip) continue;
      for (const p of lines[k]) if (Math.abs(p.x - x) < d && Math.abs(p.z - z) < d && Math.hypot(p.x - x, p.z - z) < d) return true;
    }
    return false;
  };
  // the spine: across the superblock, west to east or north to south, in long bends
  const ew = rng() < 0.5, span = ew ? X1 - X0 : Z1 - Z0, cross = ew ? Z1 - Z0 : X1 - X0;
  const mid = (ew ? (Z0 + Z1) / 2 : (X0 + X1) / 2) + R(-0.15, 0.15) * cross, amp = R(0.12, 0.22) * cross, per = R(0.7, 1.3), ph = R(0, 6.28);
  const spine = [];
  for (let s = 0; s <= span + 0.01; s += 8) {
    const a = s / span, o = mid + amp * Math.sin(a * Math.PI * 2 * per + ph) * Math.sin(a * Math.PI);
    spine.push(ew ? { x: X0 + s, z: o } : { x: o, z: Z0 + s });
  }
  const sp = addStreet(spine, [ew ? 'x0' : 'z0', ew ? 'x1' : 'z1']);
  L.edgeJ[ew ? 'x0' : 'z0'].push({ pos: ew ? spine[0].z : spine[0].x, w });
  L.edgeJ[ew ? 'x1' : 'z1'].push({ pos: ew ? spine[spine.length - 1].z : spine[spine.length - 1].x, w });
  for (const p of [spine[0], spine[spine.length - 1]]) L.patches.push({ x: p.x + (ew ? (p === spine[0] ? -AVE.w / 2 : AVE.w / 2) : 0), z: p.z + (ew ? 0 : p === spine[0] ? -AVE.w / 2 : AVE.w / 2), r: AVE.w * 0.55 });
  // side streets, alternating sides, wandering off and ending in a turning circle
  let side = rng() < 0.5 ? 1 : -1;
  for (let i = 6 + Math.floor(R(0, 4)); i < spine.length - 6; i += 9 + Math.floor(R(0, 5))) {
    side = -side;
    const p = spine[i], q = spine[i + 1], tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz);
    let hx = (-tz / tl) * side, hz = (tx / tl) * side, x = p.x + hx * w / 2, z = p.z + hz * w / 2;
    const pts = [{ x, z }], len = R(70, 150), turn = R(-0.012, 0.012);
    let ok = true, bend = 0;
    for (let s = 8; s <= len; s += 8) {
      bend += turn + R(-0.004, 0.004);
      const c = Math.cos(bend * 8), sn = Math.sin(bend * 8);
      const nhx = hx * c - hz * sn, nhz = hx * sn + hz * c; hx = nhx; hz = nhz;
      x += hx * 8; z += hz * 8;
      if (!inRect(x, z, 22) || near(x, z, 36, sp) || (pts.length > 3 && near(x, z, 36, -1))) { ok = pts.length > 5; break; }
      pts.push({ x, z });
    }
    if (!ok || pts.length < 5) continue;
    const id = addStreet(pts, [null, 'circle']);
    L.roads[sp].junc.push(i);   // (curvy streets count junctions by point)
    L.patches.push({ x: p.x, z: p.z, r: w * 0.7 });
    const e = pts[pts.length - 1];
    L.patches.push({ x: e.x, z: e.z, r: 9.5, circle: true });
    void id;
  }
  // houses along every street, facing it, on both sides, clear of the other streets and of each other
  const placed = [];
  for (let k = 0; k < L.roads.length; k++) {
    const pts = L.roads[k].pts;
    for (const sd of [-1, 1]) {
      for (let i = 1; i + 1 < pts.length; i += 2 + (rng() < 0.3 ? 1 : 0)) {
        const p = pts[i], q = pts[i + 1], tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz);
        const nx = (-tz / tl) * sd, nz = (tx / tl) * sd, hw = R(4.2, 6), hd = R(3.6, 5), set = R(4, 7);
        const cx = p.x + nx * (w / 2 + set + hd), cz = p.z + nz * (w / 2 + set + hd);
        if (!inRect(cx, cz, M + Math.max(hw, hd))) continue;
        // clear of the other streets, and of its own street where it bends back
        if (lines.some((ln, j) => ln.some((pp, m) => (j !== k || Math.abs(m - i) > 3) && Math.hypot(pp.x - cx, pp.z - cz) < w / 2 + hd + 4))) continue;
        if (L.patches.some((c) => c.circle && Math.hypot(c.x - cx, c.z - cz) < c.r + hd + 3)) continue;
        if (placed.some((h) => Math.hypot(h.x - cx, h.z - cz) < Math.max(h.hw, h.hd) + Math.max(hw, hd) + 3)) continue;
        // the house's local +z faces the street
        const yaw = Math.atan2(-nx, -nz);
        const h = { x: cx, z: cz, yaw, hw, hd, H: rng() < 0.3 ? R(6, 7) : R(3.2, 3.6), seed: pcg((sb.seed ^ pcg(placed.length * 97 + 13)) >>> 0) };
        placed.push(h);
      }
    }
  }
  // round the turning circles, a few more houses
  for (const c of L.patches) {
    if (!c.circle) continue;
    for (let a = 0; a < 6.28; a += R(0.9, 1.3)) {
      const hw = R(4.2, 5.5), hd = R(3.6, 4.6), d = c.r + 5 + hd, cx = c.x + Math.cos(a) * d, cz = c.z + Math.sin(a) * d;
      if (!inRect(cx, cz, M + Math.max(hw, hd))) continue;
      if (lines.some((ln) => ln.some((pp) => Math.hypot(pp.x - cx, pp.z - cz) < w / 2 + hd + 3))) continue;
      if (placed.some((h) => Math.hypot(h.x - cx, h.z - cz) < Math.max(h.hw, h.hd) + Math.max(hw, hd) + 3)) continue;
      placed.push({ x: cx, z: cz, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), hw, hd, H: R(3.2, 3.6), seed: pcg((sb.seed ^ pcg(placed.length * 97 + 13)) >>> 0) });
    }
  }
  L.houses = placed;
  // trees in the gardens and the space between
  for (let k = 0; k < (X1 - X0) * (Z1 - Z0) / 260; k++) {
    const x = R(X0 + 4, X1 - 4), z = R(Z0 + 4, Z1 - 4);
    if (lines.some((ln) => ln.some((pp) => Math.abs(pp.x - x) < w / 2 + 3 && Math.abs(pp.z - z) < w / 2 + 3))) continue;
    if (placed.some((h) => Math.hypot(h.x - x, h.z - z) < Math.max(h.hw, h.hd) + 2)) continue;
    if (L.patches.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2)) continue;
    L.trees.push({ x, z, s: R(0.8, 1.5), c: rng() < 0.3 });
  }
}
