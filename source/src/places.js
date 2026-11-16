// places.js: the squares where two avenues cross, and the places that fill a whole superblock
// (a stadium, a rail yard, a hospital, a university, a cemetery, a golf course). Each draws its plan
// from the superblock's seed, so every piece can paint the ground under it; the piece that holds the
// centre makes the rest.

// ---------- a corner of a block opening onto a square ----------
// the plaza's size in a block (its inner box b), or 0 if the block is too small for one
const squareSize = (b) => { const S = Math.min(26, (b.x1 - b.x0) * 0.45, (b.z1 - b.z0) * 0.45); return S < 16 ? 0 : S; };
// its paving, lighter than the pavements, painted by every piece that reaches it
function squareGround(K, blk) {
  const inner = insetPoly(blk.poly, 3.6);
  if (!inner) return;
  const b = polyBox(inner), q = blk.square, S = squareSize(b);
  if (!S) return;
  const cx = q.sx > 0 ? b.x0 : b.x1, cz = q.sz > 0 ? b.z0 : b.z1;
  K.layRect(Math.min(cx - q.sx * 4, cx + q.sx * S), Math.min(cz - q.sz * 4, cz + q.sz * S), Math.max(cx - q.sx * 4, cx + q.sx * S), Math.max(cz - q.sz * 4, cz + q.sz * S), 6);
}
// b: the block's inner box. Returns the L-shaped rest of the block, for the buildings.
function squareCorner(K, sb, blk, b, lc) {
  const q = blk.square, S = squareSize(b);
  if (!S) return null;
  const C = { x: q.sx > 0 ? b.x0 : b.x1, z: q.sz > 0 ? b.z0 : b.z1 };
  const corners = [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];
  const k = corners.findIndex((p) => p.x === C.x && p.z === C.z), P = corners[(k + 3) % 4], N = corners[(k + 1) % 4];
  const toward = (A) => { const dx = A.x - C.x, dz = A.z - C.z, l = Math.hypot(dx, dz); return { x: C.x + (dx / l) * S, z: C.z + (dz / l) * S }; };
  const A1 = toward(P), A3 = toward(N), A2 = { x: A1.x + A3.x - C.x, z: A1.z + A3.z - C.z };
  const lp = [];
  corners.forEach((p, i) => { if (i === k) lp.push(A1, A2, A3); else lp.push(p); });

  const { G, Rd } = K;
  const mx = (C.x + A2.x) / 2 - q.sx * 1.5, mz = (C.z + A2.z) / 2 - q.sz * 1.5, pick = ih(blk.seed, 97), town = sb.kind === 'downtown' || sb.kind === 'midtown';
  // a tree at the inner corner, lamps along the two sides the buildings stand on, benches
  K.tree(A2.x - q.sx * 3, A2.z - q.sz * 3, Rd(1, 1.3));
  for (const [x, z] of [[A1.x - q.sx * 2, A1.z + q.sz * 2], [A3.x + q.sx * 2, A3.z - q.sz * 2]]) K.streetLamp(x, z, 0, 0, lc, 5);
  if (K.full) for (const [x, z, a] of [[mx + q.sx * 6, mz + q.sz * 8, 0], [mx + q.sx * 8, mz + q.sz * 6, Math.PI / 2]]) K.basic(G.cube, TM.yaw(x, 0.45, z, 1.8, 0.12, 0.5, a), [0.25, 0.16, 0.1]);
  const stone = [0.46, 0.44, 0.4], bronze = [0.12, 0.16, 0.12];
  if (pick < 0.45) {
    if (town) {
      // an obelisk on a stepped base, lit from below
      K.basic(G.cube, TM.box(mx, 0.5, mz, 8, 1, 8), stone); K.basic(G.cube, TM.box(mx, 1.4, mz, 5, 0.8, 5), stone);
      K.basic(G.cube, TM.box(mx, 1.8 + 13, mz, 2.6, 26, 2.6), [0.5, 0.48, 0.44]);
      K.basic(G.cone, TM.box(mx, 27.8 + 1.4, mz, 2.7, 2.8, 2.7), [0.55, 0.52, 0.45]);
      K.collider(mx - 4, 0, mz - 4, mx + 4, 1.8, mz + 4); K.collider(mx - 1.3, 1.8, mz - 1.3, mx + 1.3, 30.6, mz + 1.3);
    } else {
      // a figure on a tall plinth
      K.basic(G.cube, TM.box(mx, 0.4, mz, 7, 0.8, 7), stone); K.basic(G.cube, TM.box(mx, 2.8, mz, 4.2, 4, 4.2), stone);
      K.basic(G.cube, TM.box(mx, 6.6, mz, 1.5, 3.4, 1.1), bronze);
      K.basic(G.sphere, TM.box(mx, 8.75, mz, 0.9, 1, 0.9), bronze);
      K.basic(G.cube, TM.box(mx + 0.9, 7.6, mz, 1.6, 0.4, 0.4), bronze);
      K.collider(mx - 3.5, 0, mz - 3.5, mx + 3.5, 0.8, mz + 3.5); K.collider(mx - 2.1, 0.8, mz - 2.1, mx + 2.1, 9.3, mz + 2.1);
    }
    for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) K.sprite(mx + dx, 0.4, mz + dz, [1, 0.88, 0.7], 4, 0.5);
    K.splat(mx, mz, 1.1, 0.95, 0.7, 7);
  } else if (pick < 0.8) {
    // a fountain: a stone rim, dark water, a lit jet and its spray
    K.basic(G.cyl, TM.box(mx, 0.45, mz, 15, 0.9, 15), stone);
    K.basic(G.cyl, TM.box(mx, 0.5, mz, 13.6, 0.9, 13.6), [0.03, 0.06, 0.09]);
    K.basic(G.cyl, TM.box(mx, 1.2, mz, 3, 2.4, 3), stone);
    K.emissive(G.cyl, TM.box(mx, 2.4 + 2.5, mz, 0.5, 5, 0.5), [0.75, 0.9, 1.0], 1.6);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; K.sprite(mx + Math.cos(a) * 2.2, 2.6 + (k % 2), mz + Math.sin(a) * 2.2, [0.7, 0.9, 1.0], 3, 0.6); }
    K.sprite(mx, 7.6, mz, [0.75, 0.9, 1.0], 5, 1.3);
    K.splat(mx, mz, 0.35, 0.55, 0.8, 7);
    K.collider(mx - 7.5, 0, mz - 7.5, mx + 7.5, 0.9, mz + 7.5);
  } else {
    // a green: trees in a ring, a bench in the middle
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; K.tree(mx + Math.cos(a) * 7, mz + Math.sin(a) * 7, Rd(1, 1.3)); }
  }
  return { lp };
}

// ---------- shared pieces ----------
// rows of parked cars in a box, and lamps on tall poles; skip(x, z) keeps them off other things
function carPark(K, x0, z0, x1, z1, lc, fill = 0.45, skip = () => false) {
  const { G, rd, pickd } = K;
  if (K.full)
    for (let z = z0 + 4; z < z1 - 7; z += 13)
      for (let x = x0 + 2; x < x1 - 2; x += 2.7)
        for (const zz of [z, z + 5.6]) {
          if (rd() > fill || skip(x, zz)) continue;
          K.basic(G.cube, TM.yaw(x, 0.72, zz, 4.4, 0.78, 1.86, Math.PI / 2), rd() < 0.06 ? [0.75, 0.55, 0.05] : pickd(CARS));
          K.basic(G.cube, TM.yaw(x, 1.38, zz + 0.3, 2.3, 0.58, 1.62, Math.PI / 2), [0.02, 0.022, 0.026]);
        }
  for (let x = x0 + 20; x < x1 - 10; x += 45)
    for (let z = z0 + 20; z < z1 - 10; z += 45) {
      if (skip(x, z)) continue;
      K.basic(G.cyl, TM.box(x, 5, z, 0.3, 10, 0.3), [0.12, 0.12, 0.13]);
      K.sprite(x, 10, z, lc, 6, 1.0);
      K.splat(x, z, lc[0] * 0.7, lc[1] * 0.7, lc[2] * 0.7, 12);
    }
}
// lamps along a path from (ax, az) to (bx, bz)
function pathLamps(K, ax, az, bx, bz, step, lc) {
  const L = Math.hypot(bx - ax, bz - az), nx = (bz - az) / L, nz = -(bx - ax) / L;
  for (let t = step / 2; t < L; t += step) {
    const x = ax + ((bx - ax) * t) / L + nx * 3, z = az + ((bz - az) * t) / L + nz * 3;
    if (K.full) { K.basic(K.G.cyl, TM.box(x, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]); K.emissive(K.G.sphere, TM.box(x, 4.2, z, 0.55, 0.55, 0.55), lc, 2.5); }
    K.sprite(x, 4.2, z, lc, 4, 0.7);
    K.splat(x, z, lc[0] * 0.75, lc[1] * 0.75, lc[2] * 0.75, 5);
  }
}
const ellipse = (cx, cz, rx, rz, n) => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return [cx + rx * Math.cos(a), cz + rz * Math.sin(a)]; });
// a pitch with its lines, long side along x if along (u along the length, v across)
function pitch(K, cx, cz, along, len, wid, lit) {
  const { G } = K, P = (u, v) => (along ? [cx + u, cz + v] : [cx + v, cz + u]);
  const box = (u, v, lu, lv, y, h, col, em) => {
    const [x, z] = P(u, v), m = TM.box(x, y, z, along ? lu : lv, h, along ? lv : lu);
    if (em) K.emissive(G.cube, m, col, em); else K.basic(G.cube, m, col);
  };
  box(0, 0, len + 6, wid + 6, 0.07, 0.12, [0.03, 0.12, 0.04]);
  const L = lit ? 0.9 : 0.25, W = [0.9, 0.95, 0.9];
  for (const s of [-1, 1]) {
    box(0, (s * wid) / 2, len, 0.15, 0.15, 0.04, W, L);
    box((s * len) / 2, 0, 0.15, wid, 0.15, 0.04, W, L);
    box(s * (len / 2 - 16.5), 0, 0.15, 40, 0.15, 0.04, W, L);
    for (const t of [-1, 1]) box(s * (len / 2 - 8.25), t * 20, 16.5, 0.15, 0.15, 0.04, W, L);
  }
  box(0, 0, 0.15, wid, 0.15, 0.04, W, L);
}

// ---------- the plans ----------
function specialPlan(sb, b) {
  if (sb.plan) return sb.plan;
  const rng = mulberry32(sb.seed ^ 0x51ed2701), R = (a, c) => a + (c - a) * rng(), w = b.x1 - b.x0, d = b.z1 - b.z0;
  const P = { along: w >= d, lit: rng() < 0.65 };
  if (sb.special === 'stadium') {
    Object.assign(P, { cx: b.cx + R(-15, 15), cz: b.cz + R(-15, 15), team: [[0.55, 0.06, 0.05], [0.06, 0.16, 0.5], [0.05, 0.35, 0.12], [0.6, 0.42, 0.04]][Math.floor(rng() * 4)] });
    P.rx = P.along ? 64 : 50; P.rz = P.along ? 50 : 64;
  } else if (sb.special === 'hospital') {
    P.cx = b.cx + R(10, 40); P.cz = b.cz + R(-30, 30);
    P.parkX = Math.min(b.x0 + 95, P.cx - 32 - 60 - 14);
  } else if (sb.special === 'campus') {
    P.qx0 = b.cx - w * 0.22; P.qx1 = b.cx + w * 0.22; P.qz0 = b.cz - d * 0.2; P.qz1 = b.cz + d * 0.2;
    P.fieldLeft = rng() < 0.5;
  } else if (sb.special === 'golf') {
    P.ponds = []; P.bunkers = []; P.greens = [];
    // the clubhouse and its driving range keep the middle of the west side
    const range = (x, z, m) => x < b.x0 + 230 + m && Math.abs(z - b.cz) < 45 + m;
    for (let k = 0; k < 3; k++) {
      const p = { x: R(b.x0 + 140, b.x1 - 60), z: R(b.z0 + 60, b.z1 - 60), rx: R(14, 30), rz: R(10, 22) };
      if (!range(p.x, p.z, p.rx + 10)) P.ponds.push(p);
    }
    for (let k = 0; k < 7; k++) {
      const g = { x: R(b.x0 + 110, b.x1 - 30), z: R(b.z0 + 30, b.z1 - 30) };
      if (P.ponds.some((p) => Math.hypot((g.x - p.x) / (p.rx + 12), (g.z - p.z) / (p.rz + 12)) < 1)) continue;
      // the fairway: from a tee 140-230 m away to the green, kept inside the course
      const a = rng() * Math.PI * 2, len = R(140, 230);
      const tx = clamp(g.x + Math.cos(a) * len, b.x0 + 100, b.x1 - 20), tz = clamp(g.z + Math.sin(a) * len, b.z0 + 20, b.z1 - 20);
      const L = Math.hypot(tx - g.x, tz - g.z);
      if (L < 90) continue;
      let clear = true;
      for (let t = 0; t <= 1; t += 0.05) if (range(g.x + (tx - g.x) * t, g.z + (tz - g.z) * t, 20)) clear = false;
      if (!clear) continue;
      const nx = ((tz - g.z) / L) * 17, nz = (-(tx - g.x) / L) * 17;
      g.fair = [[g.x + nx, g.z + nz], [tx + nx, tz + nz], [tx - nx, tz - nz], [g.x - nx, g.z - nz]];
      g.tee = { x: tx, z: tz };
      P.greens.push(g);
      for (let n = 0; n < 2; n++) P.bunkers.push({ x: g.x + R(-16, 16), z: g.z + R(-16, 16), r: R(4, 7) });
    }
    P.club = { x: b.x0 + 40, z: b.cz };
  }
  sb.plan = P;
  return P;
}

// ---------- the ground, painted by every piece it reaches ----------
function specialGround(K, sb, b) {
  const P = specialPlan(sb, b);
  switch (sb.special) {
    case 'stadium':
      K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
      K.layPoly(ellipse(P.cx, P.cz, P.rx + 122, P.rz + 122, 48), 0);
      K.layPoly(ellipse(P.cx, P.cz, P.rx + 60, P.rz + 60, 40), 8);
      K.footPoly(ellipse(P.cx, P.cz, P.rx + 40, P.rz + 40, 40));
      break;
    case 'railyard':
      K.layRect(b.x0, b.z0, b.x1, b.z1, 1);
      break;
    case 'hospital':
      K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
      K.layRect(P.cx - 96, P.cz - 70, P.cx + 96, P.cz + 70, 8);
      K.layRect(b.x0 + 4, Math.max(b.z0 + 4, P.cz - 110), P.parkX + 2, Math.min(b.z1 - 4, P.cz + 110), 0);
      break;
    case 'campus':
      K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
      K.layRect((P.qx0 + P.qx1) / 2 - 2.5, b.z0 + 4, (P.qx0 + P.qx1) / 2 + 2.5, b.z1 - 4, 8);
      K.layRect(b.x0 + 4, (P.qz0 + P.qz1) / 2 - 2.5, b.x1 - 4, (P.qz0 + P.qz1) / 2 + 2.5, 8);
      K.layRect(P.qx0 - 4, P.qz0 - 4, P.qx1 + 4, P.qz0 + 1, 8); K.layRect(P.qx0 - 4, P.qz1 - 1, P.qx1 + 4, P.qz1 + 4, 8);
      K.layRect(b.x1 - 110, b.z0 + 4, b.x1 - 4, b.z0 + 70, 0);
      break;
    case 'cemetery':
      K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
      for (let x = b.x0 + 64; x < b.x1 - 30; x += 60) K.layRect(x - 2, b.z0 + 6, x + 2, b.z1 - 6, 8);
      for (let z = b.z0 + 64; z < b.z1 - 30; z += 60) K.layRect(b.x0 + 6, z - 2, b.x1 - 6, z + 2, 8);
      K.layRect(b.cx - 3, b.z0 + 4, b.cx + 3, b.z1 - 4, 8); K.layRect(b.x0 + 4, b.cz - 3, b.x1 - 4, b.cz + 3, 8);
      K.layRect(b.cx - 22, b.z0 + 18, b.cx + 16, b.z0 + 64, 8);
      break;
    case 'golf':
      K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
      for (const g of P.greens) { K.layPoly(g.fair, 9); K.layPoly(ellipse(g.x, g.z, 14, 14, 16), 9); }
      K.layRect(b.x0 + 90, P.club.z - 45, b.x0 + 230, P.club.z + 45, 9);
      for (const p of P.ponds) K.layPond(p.x, p.z, p.rx, p.rz);
      for (const s of P.bunkers) K.layDisk(s.x, s.z, s.r, 1);
      K.layRect(b.x0 + 4, P.club.z - 50, b.x0 + 80, P.club.z + 50, 0);
      break;
  }
}

// ---------- the place itself ----------
function specialPlace(K, sb, b) {
  K.reseed(sb.seed ^ 0x2c1b3c6d);
  const P = specialPlan(sb, b), lc = sb.special === 'railyard' ? MERCURY : sb.special === 'stadium' || sb.special === 'hospital' ? LED : LAMP;
  if (sb.special !== 'railyard') { sidewalk(K, b.x0, b.z0, b.x1, b.z0 + 4); sidewalk(K, b.x0, b.z1 - 4, b.x1, b.z1); sidewalk(K, b.x0, b.z0 + 4, b.x0 + 4, b.z1 - 4); sidewalk(K, b.x1 - 4, b.z0 + 4, b.x1, b.z1 - 4); }
  return ({ stadium, railyard, hospital, campus, cemetery, golf })[sb.special](K, sb, b, P, lc);
}

// a bowl of three tiers round a pitch, a roof ring with a ring of floodlights under it, car parks
function stadium(K, sb, b, P, lc) {
  const { G } = K, N = 44, lit = P.lit, H = [8, 16, 25], grey = [0.17, 0.17, 0.18];
  const seg = (off, fn) => {
    for (let j = 0; j < N; j++) {
      const a0 = (j / N) * Math.PI * 2, a1 = ((j + 1) / N) * Math.PI * 2;
      const p0x = P.cx + (P.rx + off) * Math.cos(a0), p0z = P.cz + (P.rz + off) * Math.sin(a0);
      const p1x = P.cx + (P.rx + off) * Math.cos(a1), p1z = P.cz + (P.rz + off) * Math.sin(a1);
      const dx = p1x - p0x, dz = p1z - p0z;
      fn((p0x + p1x) / 2, (p0z + p1z) / 2, Math.hypot(dx, dz) + 0.6, Math.atan2(-dz, dx), j);
    }
  };
  for (let k = 0; k < 3; k++)
    seg(6.5 + 13 * k, (x, z, L, yaw) => {
      K.basic(G.cube, TM.yaw(x, H[k] / 2, z, L, H[k], 13, yaw), k < 2 ? [P.team[0] * 0.45 + 0.04, P.team[1] * 0.45 + 0.04, P.team[2] * 0.45 + 0.04] : grey);
      K.obb(x, z, L / 2, 6.5, yaw, 0, H[k]);
    });
  // the roof over the upper tiers, the floodlight ring under its inner edge, a lit band round the outside
  seg(26.5, (x, z, L, yaw) => { K.basic(G.cube, TM.yaw(x, 28.5, z, L, 1.4, 26, yaw), [0.08, 0.08, 0.09]); K.obb(x, z, L / 2, 13, yaw, 27.8, 29.2); });
  seg(14, (x, z, L, yaw, j) => {
    K.emissive(G.cube, TM.yaw(x, 27.6, z, L, 0.5, 0.9, yaw), [1, 0.97, 0.9], lit ? 4 : 0.4);
    if (lit && j % 4 === 0) K.sprite(x, 27.4, z, [1, 0.97, 0.9], 9, 2.2);
  });
  seg(39.4, (x, z, L, yaw) => K.emissive(G.cube, TM.yaw(x, 11, z, L, 1.2, 0.3, yaw), P.team, 1.4));
  pitch(K, P.cx, P.cz, P.along, 105, 68, lit);
  if (lit) for (const [u, v] of [[-35, -20], [0, -20], [35, -20], [-35, 20], [0, 20], [35, 20]]) K.splat(P.cx + (P.along ? u : v), P.cz + (P.along ? v : u), 1.3, 1.3, 1.2, 26);
  // entrance lights round the outside
  seg(42, (x, z, L, yaw, j) => { if (j % 6 === 0) { K.sprite(x, 4, z, [1, 0.9, 0.75], 5, 1); K.splat(x, z, 0.7, 0.6, 0.45, 8); } });
  const inE = (x, z, r) => ((x - P.cx) / (P.rx + r)) ** 2 + ((z - P.cz) / (P.rz + r)) ** 2 < 1;
  carPark(K, b.x0 + 6, b.z0 + 6, b.x1 - 6, b.z1 - 6, lc, lit ? 0.3 : 0.05, (x, z) => inE(x, z, 64) || !inE(x, z, 116));
  for (let k = 0; k < 110; k++) {
    const x = K.R(b.x0 + 8, b.x1 - 8), z = K.R(b.z0 + 8, b.z1 - 8);
    if (!inE(x, z, 130)) K.tree(x, z, K.R(0.9, 1.4), K.rd() < 0.2);
  }
  return { x: P.cx, z: P.cz, top: 29, H: 29 };
}

// tracks side by side along the line, trains parked on them, a shed, floodlight masts
function railyard(K, sb, b, P, lc) {
  const { G, R, rng, pickd } = K, zA = b.z0 + 14, zB = b.z1 - 14, shedZ = zB - 80;
  const xs = [];
  for (let x = b.x0 + 24; x < b.x1 - 24; x += 5.4) xs.push(x);
  const sx0 = xs[Math.floor(xs.length * 0.3)] - 3, sx1 = xs[Math.floor(xs.length * 0.62)] + 3;
  for (const x of xs) {
    if (K.full) for (const s of [-0.75, 0.75]) K.basic(G.cube, TM.box(x + s, 0.14, (zA + zB) / 2, 0.12, 0.16, zB - zA), [0.3, 0.28, 0.26]);
    if (rng() < 0.4) continue;
    const under = x > sx0 && x < sx1, end = under ? shedZ - 6 : zB - 4, n = Math.floor(R(4, 15)), passenger = rng() < 0.25, lit = passenger && rng() < 0.6;
    let z = R(zA + 4, Math.max(zA + 5, end - n * 23));
    const z0 = z, col = passenger ? [0.5, 0.52, 0.55] : null;
    for (let k = 0; k < n && z + 22 < end; k++, z += 23) {
      K.basic(G.cube, TM.box(x, 2.45, z + 11, 3.0, 3.7, 22), col || pickd([[0.35, 0.12, 0.07], [0.1, 0.18, 0.32], [0.3, 0.3, 0.31], [0.12, 0.2, 0.12], [0.4, 0.3, 0.08]]));
      if (lit) for (const s of [-1, 1]) K.emissive(G.cube, TM.box(x + s * 1.52, 2.9, z + 11, 0.05, 0.8, 20), [1, 0.92, 0.75], 1.3);
    }
    if (z > z0) K.collider(x - 1.6, 0, z0, x + 1.6, 4.3, z - 1);
    K.sprite(x + 2, 3, zA - 2, rng() < 0.7 ? [1, 0.1, 0.05] : [0.2, 1, 0.3], 3, 0.4);
  }
  // the shed the middle tracks run into
  K.building(sx0, shedZ, sx1, zB + 6, R(13, 17), 15, 0.05, 15, { style: 3, wall: [0.28, 0.29, 0.3], wx: 0.35, shop: 0.05, tiers: false, fh: R(4.5, 6) });
  // floodlight masts
  for (const x of [xs[Math.floor(xs.length * 0.2)] + 2.7, xs[Math.floor(xs.length * 0.8)] + 2.7])
    for (let z = zA + 40; z < shedZ - 20; z += 95) {
      K.basic(G.cyl, TM.box(x, 15, z, 0.6, 30, 0.6), [0.15, 0.15, 0.16]);
      K.basic(G.cube, TM.box(x, 30, z, 4, 1.2, 1.2), [0.15, 0.15, 0.16]);
      K.collider(x - 0.5, 0, z - 0.5, x + 0.5, 30.6, z + 0.5);
      for (const s of [-1.4, 0, 1.4]) K.sprite(x + s, 29.6, z, MERCURY, 7, 1.3);
      K.splat(x, z, 0.75, 1.0, 0.85, 32);
      K.sprite(x, 31, z, [1, 0.08, 0.04], 4, 0.6, ANIM.blink, 0, K.rd());
    }
  return null;
}

// a ward tower with a helipad, low wings, a red cross, ambulances, a car park
function hospital(K, sb, b, P, lc) {
  const { G, R, rd } = K, wall = [0.62, 0.62, 0.6], tw = 64, td = 30, H = R(60, 85);
  const t = K.building(P.cx - tw / 2, P.cz - td / 2, P.cx + tw / 2, P.cz + td / 2, H, 15, 0.1, H, { style: 4, wall, wx: 0.85, shop: 0.12, tiers: false, roof: false });
  for (const s of [-1, 1]) K.building(P.cx + s * (tw / 2 + 30) - 30, P.cz - 22, P.cx + s * (tw / 2 + 30) + 30, P.cz + 22, R(16, 22), 15, 0.1, 20, { style: 4, wall, wx: 0.8, shop: 0.1, tiers: false });
  // the helipad
  const top = t.top;
  K.basic(G.cyl, TM.box(P.cx, top + 0.3, P.cz, 22, 0.6, 22), [0.14, 0.14, 0.15]);
  K.collider(P.cx - 11, top, P.cz - 11, P.cx + 11, top + 0.6, P.cz + 11);
  for (const dx of [-2.6, 2.6]) K.emissive(G.cube, TM.box(P.cx + dx, top + 0.65, P.cz, 1.1, 0.06, 8), [0.95, 0.95, 0.9], 1.6);
  K.emissive(G.cube, TM.box(P.cx, top + 0.65, P.cz, 4.2, 0.06, 1.1), [0.95, 0.95, 0.9], 1.6);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; K.sprite(P.cx + Math.cos(a) * 10.4, top + 0.8, P.cz + Math.sin(a) * 10.4, [0.25, 1, 0.35], 4, 0.45); }
  // red crosses near the top of the long faces
  for (const s of [-1, 1]) {
    const z = P.cz + s * (td / 2 + 0.25);
    K.emissive(G.cube, TM.box(P.cx, top - 7, z, 3, 9, 0.3), [1, 0.08, 0.06], 3.5);
    K.emissive(G.cube, TM.box(P.cx, top - 7, z, 9, 3, 0.3), [1, 0.08, 0.06], 3.5);
  }
  // the emergency entrance: a canopy, a lit sign, ambulances with their lights going
  const ex = P.cx + tw / 2 + 30, ez = P.cz + 22 + 7;
  K.basic(G.cube, TM.box(ex, 4.2, ez, 24, 0.5, 12), [0.75, 0.75, 0.74]);
  K.emissive(G.cube, TM.box(ex, 5, ez + 6.1, 16, 1.2, 0.2), [1, 0.15, 0.1], 2.2);
  K.splat(ex, ez, 0.9, 0.85, 0.8, 9);
  for (let k = 0; k < 3; k++) {
    if (rd() < 0.25) continue;
    const x = ex - 8 + k * 8;
    K.basic(G.cube, TM.box(x, 1.4, ez + 2, 2.4, 2.6, 6.2), [0.85, 0.85, 0.82]);
    K.sprite(x - 0.7, 2.9, ez + 0.2, [1, 0.1, 0.05], 4, 0.5, ANIM.blink, 0, rd());
    K.sprite(x + 0.7, 2.9, ez + 0.2, [0.15, 0.3, 1], 4, 0.5, ANIM.blink, 0, rd());
  }
  carPark(K, b.x0 + 6, Math.max(b.z0 + 6, P.cz - 108), P.parkX, Math.min(b.z1 - 6, P.cz + 108), lc, 0.25);
  for (let k = 0; k < 160; k++) {
    const x = R(b.x0 + 8, b.x1 - 8), z = R(b.z0 + 8, b.z1 - 8);
    if ((Math.abs(x - P.cx) < 100 && Math.abs(z - P.cz) < 77) || (x < P.parkX + 6 && Math.abs(z - P.cz) < 112)) continue;
    K.tree(x, z, R(0.9, 1.4), rd() < 0.2);
  }
  // a path with lamps round the forecourt
  pathLamps(K, P.cx - 98, P.cz - 72, P.cx + 98, P.cz - 72, 20, LAMP); pathLamps(K, P.cx + 98, P.cz + 72, P.cx - 98, P.cz + 72, 20, LAMP);
  pathLamps(K, P.cx + 98, P.cz - 72, P.cx + 98, P.cz + 72, 20, LAMP); pathLamps(K, P.cx - 98, P.cz + 72, P.cx - 98, P.cz - 72, 20, LAMP);
  if (P.cx - 98 > P.parkX + 30) pathLamps(K, P.parkX + 4, P.cz, P.cx - 98, P.cz, 22, LAMP);
  return { x: P.cx, z: P.cz, top: top + 1, H: top };
}

// brick halls round a green quad, a library with a dome, a clock tower, a sports field, a car park
function campus(K, sb, b, P, lc) {
  const { G, R, rd } = K, brick = () => [R(0.3, 0.42), R(0.14, 0.2), R(0.08, 0.12)];
  const hall = (x0, z0, x1, z1) => {
    if (x1 - x0 < 12 || z1 - z0 < 12) return null;
    return K.building(x0, z0, x1, z1, R(13, 22), 15, 0.1, 18, { style: 2, wall: brick(), wx: 0.6, shop: 0.04, tiers: false });
  };
  // halls along the quad's long sides, three each, with gaps between
  for (const [za, zb] of [[P.qz0 - 30, P.qz0 - 8], [P.qz1 + 8, P.qz1 + 30]]) {
    const n = 3, w = (P.qx1 - P.qx0 - 2 * 14) / n;
    for (let k = 0; k < n; k++) hall(P.qx0 + k * (w + 14), za, P.qx0 + k * (w + 14) + w, zb);
  }
  // the library at the head of the quad, with a dome; a hall at the foot
  const lib = hall(P.qx1 + 10, (P.qz0 + P.qz1) / 2 - 30, P.qx1 + 50, (P.qz0 + P.qz1) / 2 + 30);
  if (lib) { K.basic(G.sphere, TM.box(lib.x, lib.top, lib.z, 22, 22, 22), [0.18, 0.3, 0.26]); K.collider(lib.x - 8, lib.top, lib.z - 8, lib.x + 8, lib.top + 9, lib.z + 8); }
  hall(P.qx0 - 46, (P.qz0 + P.qz1) / 2 - 28, P.qx0 - 10, (P.qz0 + P.qz1) / 2 + 28);
  // the clock tower on the quad
  const tx = (P.qx0 + P.qx1) / 2 + (P.qx1 - P.qx0) * 0.3, tz = (P.qz0 + P.qz1) / 2;
  K.basic(G.cube, TM.box(tx, 19, tz, 7, 38, 7), [0.36, 0.17, 0.1]);
  K.basic(G.cone, TM.box(tx, 38 + 5, tz, 7.6, 10, 7.6), [0.15, 0.22, 0.2]);
  K.collider(tx - 3.5, 0, tz - 3.5, tx + 3.5, 38, tz + 3.5);
  for (const [dx, dz, a] of [[0, 3.55, 0], [0, -3.55, 0], [3.55, 0, Math.PI / 2], [-3.55, 0, Math.PI / 2]]) K.emissive(G.cube, TM.yaw(tx + dx, 32, tz + dz, 4.2, 4.2, 0.1, a), [1, 0.9, 0.65], 1.6);
  K.splat(tx, tz, 0.6, 0.5, 0.35, 10);
  K.sprite(tx, 48.5, tz, [1, 0.08, 0.04], 4, 0.6, ANIM.blink, 0, rd());
  // trees round the quad and along the paths, lamps on the paths
  for (let x = P.qx0 + 6; x < P.qx1 - 4; x += 12) for (const z of [P.qz0 + 4, P.qz1 - 4]) K.tree(x, z, R(1, 1.3));
  const mx = (P.qx0 + P.qx1) / 2, mz = (P.qz0 + P.qz1) / 2;
  pathLamps(K, mx, b.z0 + 6, mx, b.z1 - 6, 24, lc);
  pathLamps(K, b.x0 + 6, mz, b.x1 - 6, mz, 24, lc);
  pathLamps(K, P.qx0, P.qz0, P.qx1, P.qz0, 20, lc); pathLamps(K, P.qx1, P.qz1, P.qx0, P.qz1, 20, lc);
  for (let k = 0; k < 140; k++) {
    const x = R(b.x0 + 8, b.x1 - 8), z = R(b.z0 + 8, b.z1 - 8);
    if ((x > P.qx0 - 60 && x < P.qx1 + 60 && z > P.qz0 - 40 && z < P.qz1 + 40) || Math.abs(x - mx) < 6 || Math.abs(z - mz) < 6) continue;
    if (x > b.x1 - 115 && z < b.z0 + 75) continue;
    if ((P.fieldLeft ? x < b.x0 + 130 : x > b.x1 - 130) && z > b.z1 - 100) continue;
    K.tree(x, z, R(0.9, 1.4), rd() < 0.15);
  }
  // a sports field in a far corner, a car park in another
  const fx = P.fieldLeft ? b.x0 + 70 : b.x1 - 70, fz = b.z1 - 52;
  pitch(K, fx, fz, true, 100, 64, false);
  for (const [dx, dz] of [[-55, -38], [55, -38], [-55, 38], [55, 38]]) { K.basic(G.cyl, TM.box(fx + dx, 9, fz + dz, 0.4, 18, 0.4), [0.15, 0.15, 0.16]); K.collider(fx + dx - 0.3, 0, fz + dz - 0.3, fx + dx + 0.3, 18, fz + dz + 0.3); }
  carPark(K, b.x1 - 110, b.z0 + 4, b.x1 - 4, b.z0 + 70, lc, 0.35);
  return lib;
}

// a walled field of graves in rows, cypresses along the paths, a chapel, a few dim lamps
function cemetery(K, sb, b, P, lc) {
  const { G, R, rd } = K, stone = [0.3, 0.3, 0.29];
  // the wall, with gates in the middle of each side
  const mxw = (b.x0 + b.x1) / 2, mzw = (b.z0 + b.z1) / 2;
  for (const [x0, z0, x1, z1] of [[b.x0 + 4, b.z0 + 4, mxw - 6, b.z0 + 4.6], [mxw + 6, b.z0 + 4, b.x1 - 4, b.z0 + 4.6], [b.x0 + 4, b.z1 - 4.6, mxw - 6, b.z1 - 4], [mxw + 6, b.z1 - 4.6, b.x1 - 4, b.z1 - 4],
    [b.x0 + 4, b.z0 + 4, b.x0 + 4.6, mzw - 6], [b.x0 + 4, mzw + 6, b.x0 + 4.6, b.z1 - 4], [b.x1 - 4.6, b.z0 + 4, b.x1 - 4, mzw - 6], [b.x1 - 4.6, mzw + 6, b.x1 - 4, b.z1 - 4]]) {
    K.basic(G.cube, TM.box((x0 + x1) / 2, 1.2, (z0 + z1) / 2, x1 - x0, 2.4, z1 - z0), [0.22, 0.21, 0.2]);
    K.collider(x0, 0, z0, x1, 2.4, z1);
  }
  // graves: rows of headstones in each plot between the paths, clear of the main paths, the chapel
  // and the tombs
  const xs = [b.x0 + 6]; for (let x = b.x0 + 64; x < b.x1 - 30; x += 60) xs.push(x); xs.push(b.x1 - 6);
  const zs = [b.z0 + 6]; for (let z = b.z0 + 64; z < b.z1 - 30; z += 60) zs.push(z); zs.push(b.z1 - 6);
  const tombs = [];
  for (let k = 0; k < 5; k++) {
    const x = R(b.x0 + 40, b.x1 - 40), z = R(b.z0 + 90, b.z1 - 40);
    if (!xs.some((v) => Math.abs(v - x) < 8) && !zs.some((v) => Math.abs(v - z) < 8) && Math.abs(x - mxw) > 9 && Math.abs(z - mzw) > 9) tombs.push([x, z]);
  }
  const clear = (x, z) => Math.abs(x - mxw) < 8 || Math.abs(z - mzw) < 8 || (x > mxw - 24 && x < mxw + 18 && z < b.z0 + 66) || tombs.some(([tx, tz]) => Math.abs(tx - x) < 6.5 && Math.abs(tz - z) < 5);
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < zs.length; j++) {
      const x0 = xs[i] + 6, x1 = xs[i + 1] - 6, z0 = zs[j] + 6, z1 = zs[j + 1] - 6;
      if (K.full) for (let z = z0 + 2; z < z1 - 1; z += 4.5) for (let x = x0 + 3; x < x1 - 3; x += 7) if (rd() < 0.85 && !clear(x, z)) K.basic(G.cube, TM.box(x, 0.45, z, 5.2, 0.9, 0.35), stone);
      for (const x of [x0 - 3, x1 + 3]) for (let z = z0 + 4; z < z1; z += 14) if (!clear(x, z)) K.tree(x, z, R(0.9, 1.1), true);
    }
  // the chapel by the main gate, and a few mausoleums
  const cz = b.z0 + 40;
  K.reseed(sb.seed ^ 0x6a09e667);
  house(K, mxw, cz, 7, 12, 9, 0, [0.42, 0.41, 0.4]);
  K.basic(G.cube, TM.box(mxw - 9, 9, cz, 4, 18, 4), [0.42, 0.41, 0.4]);
  K.basic(G.cone, TM.box(mxw - 9, 22, cz, 4.4, 8, 4.4), [0.12, 0.12, 0.13]);
  K.collider(mxw - 11, 0, cz - 2, mxw - 7, 18, cz + 2);
  K.emissive(G.cube, TM.box(mxw, 4, cz - 12.05, 2, 3, 0.1), [1, 0.75, 0.45], 1.2);
  for (const [x, z] of tombs) {
    K.basic(G.cube, TM.box(x, 2, z, 5, 4, 6), [0.36, 0.35, 0.34]);
    K.collider(x - 2.5, 0, z - 3, x + 2.5, 4, z + 3);
  }
  pathLamps(K, mxw, b.z0 + 70, mxw, b.z1 - 8, 45, LAMP);
  return null;
}

// lawns and fairways, ponds and bunkers, flags on the greens, trees in clumps, a clubhouse
function golf(K, sb, b, P, lc) {
  const { G, R, rd } = K;
  for (const g of P.greens) {
    K.basic(G.cyl, TM.box(g.x, 1.2, g.z, 0.06, 2.4, 0.06), [0.85, 0.85, 0.85]);
    K.basic(G.cube, TM.box(g.x + 0.35, 2.15, g.z, 0.7, 0.45, 0.04), [0.8, 0.08, 0.05]);
  }
  // rows of trees along the fairways (not on another one, or in a pond), a marker at each tee
  const onFair = (x, z) => P.greens.some((g) => insidePoly(g.fair.map(([px, pz]) => ({ x: px, z: pz })), x, z));
  const inPond = (x, z) => P.ponds.some((p) => Math.hypot((x - p.x) / (p.rx + 4), (z - p.z) / (p.rz + 4)) < 1);
  for (const g of P.greens) {
    const L = Math.hypot(g.tee.x - g.x, g.tee.z - g.z), ux = (g.tee.x - g.x) / L, uz = (g.tee.z - g.z) / L;
    for (let t = 20; t < L; t += 13)
      for (const s of [-1, 1]) {
        const x = g.x + ux * t + uz * 24 * s + R(-2, 2), z = g.z + uz * t - ux * 24 * s + R(-2, 2);
        if (rd() < 0.6 && x > b.x0 + 8 && x < b.x1 - 8 && z > b.z0 + 8 && z < b.z1 - 8 && !onFair(x, z) && !inPond(x, z) && !(x < b.x0 + 235 && Math.abs(z - P.club.z) < 50)) K.tree(x, z, R(1, 1.5), rd() < 0.3);
      }
    for (const s of [-1, 1]) K.basic(G.cube, TM.box(g.tee.x + uz * 4 * s, 0.3, g.tee.z - ux * 4 * s, 0.5, 0.6, 0.5), [0.8, 0.8, 0.78]);
    // the cart path along the fairway, lit by low bollards; the green lit for night golf
    for (let t = 10; t < L; t += 26) {
      const x = g.x + ux * t + uz * 19, z = g.z + uz * t - ux * 19;
      if (inPond(x, z)) continue;
      K.sprite(x, 0.9, z, [1, 0.85, 0.6], 3, 0.45);
      K.splat(x, z, 0.5, 0.42, 0.3, 5);
    }
    K.splat(g.x, g.z, 0.45, 0.55, 0.4, 12);
  }
  // a floodlit driving range by the clubhouse
  {
    const rx0 = b.x0 + 90, rz0 = P.club.z - 45, rx1 = b.x0 + 230, rz1 = P.club.z + 45;
    for (const [x, z] of [[rx0, rz0], [rx0, rz1]]) {
      K.basic(G.cyl, TM.box(x, 7, z, 0.4, 14, 0.4), [0.15, 0.15, 0.16]);
      K.collider(x - 0.3, 0, z - 0.3, x + 0.3, 14, z + 0.3);
      K.sprite(x, 14, z, LED, 8, 1.6);
    }
    for (let x = rx0 + 25; x < rx1; x += 35) K.splat(x, (rz0 + rz1) / 2, 0.75, 0.85, 0.75, 30);
    for (let z = rz0 + 6; z < rz1 - 4; z += 6) K.basic(G.cube, TM.box(rx0 + 1, 0.06, z, 2.5, 0.12, 2.5), [0.06, 0.16, 0.06]);
  }
  for (let k = 0; k < 22; k++) {
    const x = R(b.x0 + 20, b.x1 - 20), z = R(b.z0 + 20, b.z1 - 20);
    if (onFair(x, z)) continue;
    if (P.ponds.some((p) => Math.hypot((x - p.x) / (p.rx + 10), (z - p.z) / (p.rz + 10)) < 1) || P.greens.some((g) => Math.hypot(x - g.x, z - g.z) < 30) || x < b.x0 + 90 || (x < b.x0 + 245 && Math.abs(z - P.club.z) < 60)) continue;
    for (let n = 0, m = 3 + Math.floor(rd() * 6); n < m; n++) K.tree(x + R(-12, 12), z + R(-12, 12), R(1, 1.6), rd() < 0.35);
  }
  // the clubhouse and its car park by the road
  const c = P.club;
  K.reseed(sb.seed ^ 0x3c6ef372);
  house(K, c.x + 20, c.z, 16, 10, 7, 2, [0.4, 0.37, 0.33]);
  K.emissive(G.cube, TM.box(c.x + 20, 2.2, c.z - 10.05, 18, 1.6, 0.1), [1, 0.78, 0.5], 1.2);
  K.splat(c.x + 20, c.z - 14, 0.7, 0.55, 0.35, 10);
  carPark(K, b.x0 + 4, c.z - 50, b.x0 + 80, c.z - 14, lc, 0.4);
  pathLamps(K, b.x0 + 8, c.z + 16, b.x0 + 80, c.z + 16, 20, LAMP);
  return null;
}
