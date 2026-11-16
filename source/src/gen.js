// ---------------------------------------------------------------------------
// gen.js: one 256 m piece of the endless city, from the formulas in city.js. Runs in a worker.
// A piece owns what is centred in it (a block, a lamp, a stretch of road) so neighbours never
// draw the same thing twice, and every block draws from its own seeded random numbers, so a
// piece comes out the same every time it is made.
//   lod 1: everything, with collision and the ground light; lod 0: a distant piece, buildings,
//   roads and lights only.
// ---------------------------------------------------------------------------

class InstList {
  constructor() { this.a = new Float32Array(24 * 1024); this.n = 0; }
  push(m, c, p, q = [0, 0, 0, 0]) {
    if ((this.n + 1) * 24 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, o = this.n * 24;
    for (let i = 0; i < 12; i++) a[o + i] = m[i];
    a[o + 12] = c[0]; a[o + 13] = c[1]; a[o + 14] = c[2]; a[o + 15] = c[3];
    a[o + 16] = p[0]; a[o + 17] = p[1]; a[o + 18] = p[2]; a[o + 19] = p[3];
    a[o + 20] = q[0]; a[o + 21] = q[1]; a[o + 22] = q[2]; a[o + 23] = q[3];
    this.n++;
  }
  data() { return this.a.slice(0, this.n * 24); }
}
const GROUPS = ['cube', 'cyl', 'sphere', 'cone', 'beam', 'sprite'];
const LAMP = [1.0, 0.72, 0.44], LED = [0.78, 0.86, 1.0], MERCURY = [0.72, 1.0, 0.86];
const NEON = [[0.2, 0.9, 1.0], [1.0, 0.2, 0.75], [1.0, 0.55, 0.15], [0.5, 0.35, 1.0], [0.3, 1.0, 0.5], [1.0, 0.15, 0.2], [1.0, 0.9, 0.4]];

// ---------- the toolkit a piece is built with ----------
// A block can be turned to line up with its street: K.setFrame puts the kit in that block's own
// coordinates (local x along the street), and everything placed is turned and moved with it.
// Colliders are oriented boxes, 8 floats: centre x, z, half sizes x, z, cos, sin, bottom, top
// (local to world: x = cx + lx*c + lz*s, z = cz - lx*s + lz*c, as TM.yaw turns things).
function makeKit(Q, full) {
  let rng = mulberry32(1), rd = mulberry32(2), seedN = 1, frame = null;
  const R = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const Rd = (a, b) => a + (b - a) * rd(), pickd = (arr) => arr[Math.floor(rd() * arr.length)];
  const G = {}; for (const g of GROUPS) G[g] = new InstList();
  const boxes = [], splats = [], foot = [], lay = [], polys = [], marks = [];
  const wx = (x, z) => (frame ? frame.ox + x * frame.c + z * frame.s : x);
  const wz = (x, z) => (frame ? frame.oz - x * frame.s + z * frame.c : z);
  const xf = (m) => {
    if (!frame) return m;
    const { c, s: sn, ox, oz } = frame, r = m.slice();
    for (let k = 0; k < 4; k++) { r[k] = c * m[k] + sn * m[8 + k]; r[8 + k] = -sn * m[k] + c * m[8 + k]; }
    r[3] += ox; r[11] += oz;
    return r;
  };
  const K = {
    G, boxes, splats, foot, lay, polys, marks, full, Q,
    // every block (and every road) reseeds, so it comes out the same whichever piece asks
    reseed(s) { rng = mulberry32(s); rd = mulberry32((s ^ 0x5bd1e995) >>> 0); seedN = (s % 100000) * 64 + 1; },
    rng: () => rng(), rd: () => rd(), R, pick, Rd, pickd,
    seed: () => (seedN = (seedN + 1) % 16000000),
    setFrame(ox, oz, yaw) { frame = yaw ? { ox, oz, c: Math.cos(yaw), s: Math.sin(yaw) } : null; },
    clearFrame() { frame = null; },
    get framed() { return !!frame; },
    toLocal(x, z) { if (!frame) return [x, z]; const dx = x - frame.ox, dz = z - frame.oz; return [dx * frame.c - dz * frame.s, dx * frame.s + dz * frame.c]; },
    toWorld(x, z) { return [wx(x, z), wz(x, z)]; },
    push(list, m, c, p, q) { list.push(xf(m), c, p, q); },
    // the ground light, ambient occlusion and ground types (rasterised in chunkRaster)
    splat(x, z, r, g, b, sigma) { if (full) splats.push(wx(x, z), wz(x, z), r, g, b, sigma); },
    footRect(x0, z0, x1, z1) { if (full) K.footPoly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [wx(x, z), wz(x, z)])); },
    footPoly(pts) { if (full) polys.push(1, 255, pts.length, ...pts.flat()); },
    layRect(x0, z0, x1, z1, type) { if (full) K.layPoly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [wx(x, z), wz(x, z)]), type); },
    // pts in world coordinates
    layPoly(pts, type) { if (full) polys.push(0, type, pts.length, ...pts.flat()); },
    layDisk(x, z, rad, ch) { if (full) lay.push(1, wx(x, z), wz(x, z), rad, ch, 0); },
    layPond(x, z, rx, rz) { if (full) lay.push(2, wx(x, z), wz(x, z), rx, rz, 0); },
    collider(x0, y0, z0, x1, y1, z1) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      boxes.push(wx(cx, cz), wz(cx, cz), (x1 - x0) / 2, (z1 - z0) / 2, frame ? frame.c : 1, frame ? frame.s : 0, y0, y1);
    },
    // an oriented box straight in world coordinates, turned by yaw (as TM.yaw)
    obb(cx, cz, hx, hz, yaw, y0, y1) { boxes.push(cx, cz, hx, hz, Math.cos(yaw), Math.sin(yaw), y0, y1); },
  };
  K.sprite = (x, y, z, col, inten, size, anim = 0, dir = 0, phase = 0, q = [0, 0, 0, 0]) =>
    G.sprite.push([1, 0, 0, wx(x, z), 0, 1, 0, y, 0, 0, 1, wz(x, z)], [col[0], col[1], col[2], inten], [size, anim, dir, phase], q);
  K.basic = (list, m, col, anim = 0, q, phase = 0) => list.push(xf(m), [col[0], col[1], col[2], 0], [MAT.basic, anim, K.seed(), phase], q);
  K.emissive = (list, m, col, inten, anim = 0, q, phase = 0) => list.push(xf(m), [col[0], col[1], col[2], inten], [MAT.emissive, anim, K.seed(), phase], q);
  K.streetLamp = (x, z, ox, oz, col = LAMP, h = 7) => {
    // pole at (x, z); the head reaches out over the road along (ox, oz). Far away only the light shows.
    // (unframed: (ox, oz) are world directions, the arm is turned to them)
    const hx = x + ox * 1.4, hz = z + oz * 1.4;
    if (full) {
      const yaw = Math.atan2(-oz, ox);
      K.basic(G.cyl, TM.box(x, h / 2, z, 0.22, h, 0.22), [0.06, 0.06, 0.07]);
      K.basic(G.cube, TM.yaw(x + ox * 0.7, h - 0.05, z + oz * 0.7, Math.hypot(ox, oz) * 1.4 + 0.12, 0.1, 0.12, yaw), [0.06, 0.06, 0.07]);
      K.emissive(G.cube, TM.yaw(hx, h - 0.15, hz, 0.7, 0.14, 0.4, yaw), col, 2.5);
    }
    K.sprite(hx, h - 0.3, hz, col, 5, 0.75);
    K.splat(hx, hz, col[0] * 0.95, col[1] * 0.95, col[2] * 0.95, 6.5);
  };
  K.tree = (x, z, s = 1, conifer = false) => {
    if (!full) return;
    const tint = pickd([[0.06, 0.1, 0.045], [0.05, 0.085, 0.05], [0.08, 0.1, 0.04], [0.045, 0.075, 0.06]]);
    K.basic(G.cyl, TM.box(x, 1.5 * s, z, 0.35 * s, 3 * s, 0.35 * s), [0.06, 0.04, 0.03]);
    if (conifer) K.push(G.cone, TM.box(x, 6 * s, z, 4.5 * s, 9 * s, 4.5 * s), [...tint, 0], [MAT.foliage, 0, K.seed(), 0]);
    else { const w = Rd(3.6, 5.2) * s; K.push(G.sphere, TM.box(x, 4.4 * s, z, w, w * Rd(0.8, 1.0), w), [...tint, 0], [MAT.foliage, 0, K.seed(), 0]); }
  };
  K.building = (x0, z0, x1, z1, H, sides, nl, H0, opt = {}) => building(K, x0, z0, x1, z1, H, sides, nl, H0, opt);
  return K;
}

// opt: style, wall [r,g,b], shop (0..1), roof (rooftop gear and signs), tiers (setbacks), fh (floor height)
function building(K, x0, z0, x1, z1, H, sides, nl, H0, opt) {
  const { G, R, pick, rd, Rd, pickd, rng, Q, full } = K;
  const seed = Math.floor(rng() * 16000000);
  const style = opt.style ?? (H > 90 ? pick([1, 1, 3, 4, 0]) : H > 35 ? pick([0, 1, 3, 4, 0, 2]) : pick([0, 2, 2, 0, 3]));
  const WALL = [
    () => { const g = R(0.25, 0.5); return [g, g * R(0.92, 1), g * R(0.82, 0.95)]; },
    () => [R(0.02, 0.05), R(0.04, 0.07), R(0.06, 0.1)],
    () => [R(0.3, 0.45), R(0.12, 0.2), R(0.07, 0.12)],
    () => (rng() < 0.5 ? [0.55, 0.55, 0.56] : [0.06, 0.06, 0.07]),
    () => [R(0.5, 0.65), R(0.48, 0.6), R(0.42, 0.52)],
  ];
  const wall = opt.wall || WALL[style]();
  const refl = [0.3, 0.85, 0.2, 0.65, 0.4][style];
  const fh = opt.fh || (style === 0 || style === 2 ? R(3.0, 3.4) : R(3.7, 4.2));
  const cw = style === 2 ? R(2.3, 2.9) : style === 1 ? R(1.6, 2.8) : R(2.6, 4.2);
  const wx = Math.min(1, (opt.wx ?? [0.55, 0.92, 0.45, 1.0, 0.62][style]) * R(0.9, 1.08));
  const shop = opt.shop ?? clamp(nl * 0.9 + (H0 > 100 ? 0.3 : 0) + R(-0.2, 0.2), 0.05, 1);
  H = Math.max(fh * 2, Math.round(H / fh) * fh);
  const tiers = [];
  if (opt.tiers !== false && H > 70 && rng() < 0.75) {
    const fr = H > 180 ? [0.45, 0.3, 0.25] : [0.6, 0.4];
    let yb = 0, f = [x0, z0, x1, z1];
    for (let k = 0; k < fr.length; k++) {
      const yt = k === fr.length - 1 ? H : Math.round((yb + H * fr[k] * R(0.85, 1.15)) / fh) * fh;
      tiers.push([...f, yb, yt]);
      const sx = (f[2] - f[0]) * R(0.06, 0.16), sz = (f[3] - f[1]) * R(0.06, 0.16), ax = R(0.3, 1.7), az = R(0.3, 1.7);
      const n = [f[0] + sx * ax, f[1] + sz * az, f[2] - sx * (2 - ax), f[3] - sz * (2 - az)];
      if (n[2] - n[0] < 9 || n[3] - n[1] < 9) { tiers[tiers.length - 1][5] = H; break; }
      f = n; yb = yt;
    }
  } else tiers.push([x0, z0, x1, z1, 0, H]);
  tiers.forEach(([a, b, c, d, yb, yt], k) => {
    K.push(G.cube, TM.box((a + c) / 2, (yb + yt) / 2, (b + d) / 2, c - a, yt - yb, d - b), [...wall, refl], [MAT.building, 0, seed, k === 0 ? shop : 0], [style, fh, cw, wx]);
    K.collider(a, yb, b, c, yt, d);
  });
  K.footRect(x0, z0, x1, z1);
  if (shop > 0.3) {
    const spill = (x, z) => K.splat(x, z, 0.5 * shop, 0.36 * shop, 0.22 * shop, 3.5);
    if (sides & 4) for (let x = x0 + 3; x < x1 - 2; x += 7) spill(x, z0 - 2);
    if (sides & 8) for (let x = x0 + 3; x < x1 - 2; x += 7) spill(x, z1 + 2);
    if (sides & 1) for (let z = z0 + 3; z < z1 - 2; z += 7) spill(x0 - 2, z);
    if (sides & 2) for (let z = z0 + 3; z < z1 - 2; z += 7) spill(x1 + 2, z);
  }
  const [tx0, tz0, tx1, tz1, , top] = tiers[tiers.length - 1];
  const tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2, tw = tx1 - tx0, td = tz1 - tz0;
  const res = { x: tcx, z: tcz, top, H };
  if (H > 40) K.sprite(tcx, top + 0.6, tcz, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
  if (opt.roof === false) return res;
  // rooftops: LED crowns, corner strips, spires, warning lights, water tanks, machinery, billboards
  const lm = !!opt.landmark;
  if ((H > 140 && rd() < 0.6) || lm) {
    const c = lm ? pickd([[0.9, 0.95, 1.0], [1.0, 0.8, 0.45], [0.45, 0.75, 1.0]]) : pickd(NEON.slice(0, 4).concat([[0.9, 0.95, 1.0]])), it = lm ? 6 : Rd(3, 6);
    // a landmark's top storeys glow: a lantern that can be seen from anywhere in town
    if (lm) K.emissive(G.cube, TM.box(tcx, top - 5, tcz, tw + 0.4, 7, td + 0.4), c, 3.6);
    for (const s of [-1, 1]) {
      K.emissive(G.cube, TM.box(tcx, top - 0.4, tcz + s * td / 2, tw + 0.3, 0.5, 0.3), c, it);
      K.emissive(G.cube, TM.box(tcx + s * tw / 2, top - 0.4, tcz, 0.3, 0.5, td + 0.3), c, it);
    }
    if (rd() < 0.5 || lm) {
      const yb = tiers[tiers.length - 1][4];
      for (const [cx, cz] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) K.emissive(G.cube, TM.box(cx, (yb + top) / 2, cz, 0.35, top - yb, 0.35), c, it * 0.6);
    }
  }
  if ((H > 200 && rd() < 0.75) || (lm && H > 200)) {
    const sh = lm ? Rd(50, 80) : Rd(25, 70);
    K.basic(G.cyl, TM.box(tcx, top + sh / 2, tcz, 1.4, sh, 1.4), [0.3, 0.3, 0.32]);
    K.sprite(tcx, top + sh + 0.6, tcz, [1, 0.08, 0.04], 8, 1.2, ANIM.blink, 0, rd());
    // a landmark's beacon: a white light on the spire, seen from across town
    if (lm) { K.sprite(tcx, top + sh * 0.55, tcz, [1, 1, 1], 14, 3.2, ANIM.blink, 0, 0.5); K.sprite(tcx, top + 1.5, tcz, [1, 0.97, 0.9], 10, 6); }
  }
  if (H > 90) for (const [cx, cz] of [[tx0 + 0.5, tz0 + 0.5], [tx1 - 0.5, tz1 - 0.5]]) K.sprite(cx, top + 0.6, cz, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
  if (!full) return res;
  if (H > 12 && H < 95 && rd() < 0.35 * Q.details) {
    const x = Rd(tx0 + 3, tx1 - 3), z = Rd(tz0 + 3, tz1 - 3), r = Rd(3.5, 5);
    K.basic(G.cyl, TM.box(x, top + 3.2, z, r, 4.2, r), [0.22, 0.14, 0.09]);
    K.basic(G.cone, TM.box(x, top + 6.0, z, r * 1.05, 1.4, r * 1.05), [0.18, 0.12, 0.08]);
    for (const [a, b] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) K.basic(G.cube, TM.box(x + a * r * 0.3, top + 0.6, z + b * r * 0.3, 0.25, 1.2, 0.25), [0.1, 0.1, 0.1]);
  }
  if (rd() < 0.6 * Q.details) {
    for (let k = 0, n = 1 + Math.floor(rd() * 3); k < n; k++) {
      const sx = Rd(2, Math.min(6, tw * 0.3)), sz = Rd(2, Math.min(6, td * 0.3)), sy = Rd(1.2, 2.6);
      K.basic(G.cube, TM.box(Rd(tx0 + sx, tx1 - sx), top + sy / 2, Rd(tz0 + sz, tz1 - sz), sx, sy, sz), [0.16, 0.16, 0.17]);
    }
  }
  if (H > 25 && H < 120 && rd() < 0.1 * Q.details) {
    const ah = Rd(8, 20), x = Rd(tx0 + 2, tx1 - 2), z = Rd(tz0 + 2, tz1 - 2);
    K.basic(G.cyl, TM.box(x, top + ah / 2, z, 0.3, ah, 0.3), [0.25, 0.25, 0.27]);
    K.sprite(x, top + ah, z, [1, 0.1, 0.05], 3, 0.5, ANIM.blink, 0, rd());
  }
  // a billboard on the roof, facing a street
  if (H > 12 && H < 55 && nl > 0.55 && rd() < 0.18 * Q.details && sides) {
    const c = pickd(NEON), bw = Math.min(16, Math.max(tw, td) * 0.7), bh = Rd(5, 8);
    let m;
    if (sides & 4) m = TM.yaw(tcx, top + 2 + bh / 2, tz0 + 1, bw, bh, 0.4, 0);
    else if (sides & 8) m = TM.yaw(tcx, top + 2 + bh / 2, tz1 - 1, bw, bh, 0.4, 0);
    else if (sides & 1) m = TM.yaw(tx0 + 1, top + 2 + bh / 2, tcz, bw, bh, 0.4, Math.PI / 2);
    else m = TM.yaw(tx1 - 1, top + 2 + bh / 2, tcz, bw, bh, 0.4, Math.PI / 2);
    K.push(G.cube, m, [...c, Rd(2, 3.5)], [MAT.neon, 0, K.seed(), 1]);
    K.basic(G.cube, TM.box(m[3], top + 1, m[11], 0.3, 2, 0.3), [0.1, 0.1, 0.1]);
  }
  // blade signs sticking out over the pavement
  if (H > 8 && H < 80 && nl > 0.45 && rd() < 0.6 * Q.details) {
    const c = pickd(NEON), sh = Rd(4, 9), y = Rd(5.5, Math.min(14, H - sh / 2 - 1)) + sh / 2;
    if (y + sh / 2 < H) {
      let m;
      if (sides & 4) m = TM.yaw(Rd(x0 + 2, x1 - 2), y, z0 - 0.9, 1.7, sh, 0.35, Math.PI / 2);
      else if (sides & 8) m = TM.yaw(Rd(x0 + 2, x1 - 2), y, z1 + 0.9, 1.7, sh, 0.35, Math.PI / 2);
      else if (sides & 1) m = TM.yaw(x0 - 0.9, y, Rd(z0 + 2, z1 - 2), 1.7, sh, 0.35, 0);
      else if (sides & 2) m = TM.yaw(x1 + 0.9, y, Rd(z0 + 2, z1 - 2), 1.7, sh, 0.35, 0);
      if (m) { K.push(G.cube, m, [...c, Rd(2.5, 4.5)], [MAT.neon, 0, K.seed(), 0]); K.splat(m[3], m[11], c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 4); }
    }
  }
  return res;
}

function splitLots(K, x0, z0, x1, z1, maxLot, depth, sides, out, irregular = 0) {
  const w = x1 - x0, d = z1 - z0;
  if ((w <= maxLot && d <= maxLot) || depth > 6) { out.push({ x0, z0, x1, z1, sides }); return; }
  const a = 0.5 - 0.15 - irregular, b = 0.5 + 0.15 + irregular;
  if (w >= d) {
    const s = x0 + w * K.R(a, b);
    splitLots(K, x0, z0, s, z1, maxLot, depth + 1, sides & ~2, out, irregular); splitLots(K, s, z0, x1, z1, maxLot, depth + 1, sides & ~1, out, irregular);
  } else {
    const s = z0 + d * K.R(a, b);
    splitLots(K, x0, z0, x1, s, maxLot, depth + 1, sides & ~8, out, irregular); splitLots(K, x0, s, x1, z1, maxLot, depth + 1, sides & ~4, out, irregular);
  }
}
const sidewalk = (K, x0, z0, x1, z1) => K.G.cube.push(TM.box((x0 + x1) / 2, 0.09, (z0 + z1) / 2, x1 - x0, 0.18, z1 - z0), [0, 0, 0, 0], [MAT.sidewalk, 0, 0, 0]);
const nightlife = (x, z) => vnoise(x * 0.004 + 3.1, z * 0.004 - 1.7) * 0.8 + 0.5 * Math.exp(-((x - 150) ** 2 + (z + 380) ** 2) / 500 ** 2);
const lampColor = (sb) => (sb.kind === 'industrial' || sb.kind === 'docks' ? MERCURY : sb.kind === 'midtown' && ih(sb.seed, 43) < 0.4 ? LED : LAMP);

// ---------- one block of a superblock, by district ----------
// How much each kind of district wants a place, from smooth fields: near an edge between two kinds
// the blocks mix and buildings grade in height, instead of changing from one street to the next.
function blockMix(x, z) {
  const c = coreField(x, z), urban = 1 - smooth(0.06, 0.3, c);
  return {
    c,
    ind: smooth(0.62, 0.78, industryField(x, z)) * urban,
    old: smooth(0.61, 0.77, vnoise(x / 1500 - 41.7, z / 1500 + 9.2)) * urban,
    sub: smooth(0.46, 0.66, vnoise(x / 2600 + 5.5, z / 2600 + 77.1)) * (1 - smooth(0.0, 0.08, c)),
  };
}
// what a block becomes (the same draw for the piece that builds it and the ones that paint its ground).
// A neighbourhood is one thing or the other with a clean edge between (a little give either side, so
// the edge follows the streets, not a line): heights still grade gently across it.
function blockKind(blk) {
  if (blk.landmark) return 'apartments';
  const mx = blockMix(blk.cx, blk.cz), j = (ih(blk.seed, 95) - 0.5) * 0.24;
  if (ih(blk.seed, 94) < 0.045 && mx.c < 0.35 && !blk.square) return 'park';   // now and then a small park
  if (mx.ind > 0.5 + j) return 'industrial';
  if ((blk.sbKind === 'suburb' ? Math.max(mx.sub, 0.88) : mx.sub) > 0.5 + j) return 'houses';
  if (mx.old > 0.5 + j) return 'old';
  return 'apartments';
}
// its ground, painted by every piece it reaches: paving, concrete for industry, lawns round houses
function blockGround(K, blk) {
  const kind = blockKind(blk), pts = blk.poly.map((p) => [p.x, p.z]);
  K.layPoly(pts, kind === 'industrial' ? 0 : 8);
  if (kind === 'houses' || kind === 'park') { const inner = insetPoly(blk.poly, 3.6); if (inner) K.layPoly(inner.map((p) => [p.x, p.z]), 2); }
  if (kind === 'park') { const c = polyBox(blk.poly); K.layRect((c.x0 + c.x1) / 2 - 1.6, c.z0 + 3.6, (c.x0 + c.x1) / 2 + 1.6, c.z1 - 3.6, 8); K.layRect(c.x0 + 3.6, (c.z0 + c.z1) / 2 - 1.6, c.x1 - 3.6, (c.z0 + c.z1) / 2 + 1.6, 8); }
  if (blk.square && (kind === 'apartments' || kind === 'old')) squareGround(K, blk);
}
// a kerb along every edge of a block, and the edge's direction inwards
function kerbs(K, poly) {
  if (!K.full) return;
  const ccw = polyArea(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    K.basic(K.G.cube, TM.yaw((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2, L + 0.3, 0.16, 0.3, Math.atan2(-dz, dx)), [0.15, 0.145, 0.14]);
    void ccw;
  }
}
// points along a polygon's edges, d in from them, every step metres
function alongEdges(poly, d, step, fn) {
  const ccw = polyArea(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const nx = (ccw ? -dz : dz) / L, nz = (ccw ? dx : -dx) / L;
    for (let t = 6; t < L - 5; t += step) fn(a.x + (dx / L) * t + nx * d, a.z + (dz / L) * t + nz * d);
  }
}
// lots: rectangles in the block's frame that fit inside its (local) polygon, shrunk if they must
function fitLot(lot, lp) {
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  for (const f of [1, 0.88, 0.76, 0.64]) {
    const hx = ((lot.x1 - lot.x0) / 2) * f, hz = ((lot.z1 - lot.z0) / 2) * f;
    if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => insidePoly(lp, cx + a * hx, cz + b * hz))) {
      const r = { x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz };
      // sides facing the street: the edge of the block is within 5 m
      r.sides = (insidePoly(lp, r.x0 - 5, cz) ? 0 : 1) | (insidePoly(lp, r.x1 + 5, cz) ? 0 : 2) | (insidePoly(lp, cx, r.z0 - 5) ? 0 : 4) | (insidePoly(lp, cx, r.z1 + 5) ? 0 : 8);
      return r;
    }
  }
  return null;
}
function polyBox(P) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}

function genBlock(K, sb, blk) {
  K.reseed(blk.seed);
  const { R, rd, Rd, Q } = K;
  const kind = blockKind(blk), mx = blockMix(blk.cx, blk.cz), c = mx.c, nlBase = nightlife(blk.cx, blk.cz);
  K.clearFrame();
  kerbs(K, blk.poly);
  const inner = insetPoly(blk.poly, 3.6);
  if (!inner) {   // a sliver between streets: paving, a tree
    if (Math.abs(polyArea(blk.poly)) > 60) K.tree(blk.cx, blk.cz, Rd(0.8, 1.2));
    return null;
  }
  if (kind === 'park') { pocketPark(K, inner, lampColor(sb)); return null; }
  // apartments: towers downtown, falling off smoothly towards the suburbs
  const old = kind === 'old', lc = lampColor(sb);
  const resH = (16 + vnoise(blk.cx * 0.006, blk.cz * 0.006) * 22) * (1 - 0.6 * mx.sub);
  const towers = 12 + 320 * Math.pow(c, 1.5) + vnoise(blk.cx * 0.01, blk.cz * 0.01) * 12;
  const H0 = old ? 12 + vnoise(blk.cx * 0.02, blk.cz * 0.02) * 6 : Math.max(resH, towers);
  const trees = kind === 'apartments' && H0 < 70;
  if (trees && rd() < 0.8) alongEdges(blk.poly, 1.6, 13, (x, z) => { if (rd() < 0.8 * Q.trees) K.tree(x + Rd(-1, 1), z + Rd(-1, 1), Rd(0.8, 1.1)); });
  // the block's own frame: local x along its longest street
  K.setFrame(blk.cx, blk.cz, -blk.angle);
  let lp = inner.map((p) => { const [x, z] = K.toLocal(p.x, p.z); return { x, z }; });
  // a corner opening onto a square: the buildings stand back from it, round an L
  const sq = blk.square && (kind === 'apartments' || old) ? squareCorner(K, sb, blk, polyBox(lp), lc) : null;
  if (sq) lp = sq.lp;
  const bx = polyBox(lp), rectish = Math.abs(polyArea(lp)) > 0.97 * (bx.x1 - bx.x0) * (bx.z1 - bx.z0);
  const placed = [];
  let res = null;
  if (kind === 'industrial') industrialLots(K, lp, bx, placed);
  else if (kind === 'houses') houseLots(K, blk, lp, bx, placed);
  else res = apartmentLots(K, sb, blk, lp, bx, rectish, old, H0, nlBase, c, lc, placed);
  const special = res === 'site' || res === 'plaza' || !!sq;
  if (special) res = null;
  // what the rectangles left (the corners of an odd-shaped block): parking, or trees, more of them
  // the less of the block the buildings took
  const area = Math.abs(polyArea(lp)), used = placed.reduce((t, r) => t + (r.x1 - r.x0) * (r.z1 - r.z0), 0) / area;
  if (!special && (!rectish || used < 0.3) && K.full) {
    if (used < 0.12 && area > 500 && kind !== 'houses') parkingLot(K, lp, bx, lc);
    else for (let k = 0, n = Math.min(30, (area * (1 - used)) / 300); k < n; k++) {
      const x = R(bx.x0, bx.x1), z = R(bx.z0, bx.z1);
      if (insidePoly(lp, x, z) && !placed.some((r) => x > r.x0 - 2 && x < r.x1 + 2 && z > r.z0 - 2 && z < r.z1 + 2)) K.tree(x, z, Rd(0.8, 1.3), rd() < 0.15);
    }
  }
  K.clearFrame();
  return res;
}

function apartmentLots(K, sb, blk, lp, bx, rectish, old, H0, nlBase, c, lc, placed) {
  const { R, rd, Rd, Q } = K;
  const sub = blockMix(blk.cx, blk.cz).sub;
  // among the houses it is quiet: a corner shop or two, warm windows, no neon or billboards
  const quiet = sb.kind === 'suburb' || sub > 0.5, calm = quiet || sub > 0.25;
  const nl0 = old ? 0.55 + nlBase * 0.6 : H0 > 30 ? nlBase + (c > 0.42 ? 0.15 : 0) : 0.15 + nlBase * 0.35;
  const nl = quiet ? Math.min(nl0, 0.2) : calm ? Math.min(nl0, 0.4) : nl0;
  const maxLot = old ? 17 : H0 > 170 ? 70 : H0 > 70 ? 40 : 28 - 6 * sub, capH = towerCap(blk.cx, blk.cz);
  const styleOpt = old ? { style: rd() < 0.7 ? 2 : 0, tiers: false } : {};
  // the landmark tower at the peak of a centre: alone in its block, with a little plaza round it
  if (blk.landmark) {
    const s = Math.min(blk.landmark.h > 300 ? 50 : 38, (bx.x1 - bx.x0) * 0.72, (bx.z1 - bx.z0) * 0.72), cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2;
    const lot = { x0: cx - s / 2, z0: cz - s / 2, x1: cx + s / 2, z1: cz + s / 2 };
    const bld = K.building(lot.x0, lot.z0, lot.x1, lot.z1, blk.landmark.h, 15, Math.max(nl, 0.6), blk.landmark.h, { style: K.pick([1, 3, 4]), landmark: true, shop: 0.8 });
    placed.push(lot);
    for (const [x, z] of [[lot.x0 - 6, lot.z0 - 6], [lot.x1 + 6, lot.z0 - 6], [lot.x0 - 6, lot.z1 + 6], [lot.x1 + 6, lot.z1 + 6]]) {
      K.sprite(x, 0.6, z, [1, 0.92, 0.8], 5, 0.8);
      K.splat(x, z, 0.8, 0.7, 0.55, 7);
    }
    const [wx, wz] = K.toWorld(bld.x, bld.z);
    return { x: wx, z: wz, top: bld.top, H: bld.H };
  }
  // a plaza, or a building site with its tower crane (one is always beside Halvard Bay's downtown),
  // in blocks that are plain rectangles lined up with the avenues
  const plain = rectish && !K.framed;
  if (plain && K.rng() < 0.035 && H0 < 200) { plaza(K, bx.x0, bx.z0, bx.x1, bx.z1, lc); return 'plaza'; }
  const forced = 430 >= bx.x0 && 430 <= bx.x1 && -430 >= bx.z0 && -430 <= bx.z1;
  if (plain && (forced || (K.rng() < 0.07 && H0 > 45)) && !old && c > 0.12 && bx.x1 - bx.x0 > 30 && bx.z1 - bx.z0 > 30) {
    const s = constructionSite(K, bx.x0, bx.z0, Math.min(bx.x1, bx.x0 + 75), Math.min(bx.z1, bx.z0 + 75), H0);
    K.marks.push({ type: 'crane', x: s.x, y: s.top, z: s.z });
    return 'site';
  }
  const lots = [];
  splitLots(K, bx.x0, bx.z0, bx.x1, bx.z1, maxLot, 0, 15, lots, old ? 0.12 : 0);
  let tallest = null;
  for (const lot0 of lots) {
    const r1 = K.rng(), r2 = K.rng(), r3 = K.rng(), r4 = K.rng(), r5 = K.rng();
    const lot = fitLot(lot0, lp);
    if (!lot) continue;
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 6 || d < 6) continue;
    if (r1 < 0.05) { if (rd() < Q.trees) K.tree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, Rd(0.9, 1.3)); continue; }
    let H = H0 * (0.3 + 0.95 * Math.pow(r2, 1.3));
    if (H0 > 120 && r3 < 0.06) H *= 1.4;
    H = Math.min(H, capH);
    // along an avenue the buildings are a little taller and have shops (a main street)
    const front = !!(lot.sides & blk.ave);
    if (front && H0 < 120) H *= 1.25;
    H = Math.max(Math.min(H, Math.max(w, d) * 7.5), old ? 9 + r4 * 3 : 7 + r4 * 6);
    // low-rise where it should be: old town, and next to the houses
    H = Math.min(H, old || sb.kind === 'oldtown' ? 18 : sb.kind === 'suburb' || sub > 0.5 ? 10 : sub > 0.25 ? 16 : Infinity);
    const g = old ? 0 : H0 > 60 ? 1.5 + r5 * 2.5 : r5 < 0.5 ? 0 : 1 + r5 * 1.5;
    const opt = { ...styleOpt };
    if (old) opt.shop = clamp(nl + R(-0.2, 0.3), 0.2, 1);
    else if (quiet) opt.shop = front ? R(0.18, 0.32) : R(0.03, 0.14);
    else if (calm) opt.shop = front ? R(0.25, 0.4) : R(0.08, 0.3);
    else if (front) opt.shop = clamp(nl * 0.9 + 0.2 + (r4 - 0.5) * 0.3, 0.1, 1);
    const bld = K.building(lot.x0 + g / 2, lot.z0 + g / 2, lot.x1 - g / 2, lot.z1 - g / 2, H, lot.sides, nl, H0, opt);
    placed.push(lot);
    if (bld) {
      const [wx, wz] = K.toWorld(bld.x, bld.z);
      if (!tallest || bld.H > tallest.H) tallest = { x: wx, z: wz, top: bld.top, H: bld.H };
    }
  }
  return tallest;
}

// a small park in one block: lawn, two crossing paths with lamps, trees round the edge, a bench or two
function pocketPark(K, inner, lc) {
  const { G, rd, Rd, Q } = K, b = polyBox(inner), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  for (let x = b.x0 + 4; x < b.x1 - 3; x += 9) for (const z of [b.z0 + 3, b.z1 - 3]) if (rd() < 0.85 * Q.trees + 0.15) K.tree(x + Rd(-1, 1), z, Rd(0.9, 1.3));
  for (let z = b.z0 + 12; z < b.z1 - 10; z += 9) for (const x of [b.x0 + 3, b.x1 - 3]) if (rd() < 0.85 * Q.trees + 0.15) K.tree(x, z + Rd(-1, 1), Rd(0.9, 1.3));
  for (const [x, z] of [[cx + 6, cz + 6], [cx - 6, cz - 6], [cx + 6, cz - 6], [cx - 6, cz + 6]]) {
    if (K.full) { K.basic(G.cyl, TM.box(x, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]); K.emissive(G.sphere, TM.box(x, 4.2, z, 0.55, 0.55, 0.55), lc, 2.5); }
    K.sprite(x, 4.2, z, lc, 4, 0.7);
    K.splat(x, z, lc[0] * 0.75, lc[1] * 0.75, lc[2] * 0.75, 6);
  }
  if (K.full) for (const [x, z, a] of [[cx + 3.5, cz + 9, 0], [cx - 9, cz - 3.5, Math.PI / 2]]) K.basic(G.cube, TM.yaw(x, 0.45, z, 1.8, 0.12, 0.5, a), [0.25, 0.16, 0.1]);
  K.basic(G.cyl, TM.box(cx, 0.35, cz, 3.2, 0.7, 3.2), [0.3, 0.29, 0.28]);
}

function plaza(K, x0, z0, x1, z1, lc) {
  const { G } = K, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  K.basic(G.cyl, TM.box(cx, 0.45, cz, 12, 0.6, 12), [0.16, 0.15, 0.14]);
  K.emissive(G.cyl, TM.box(cx, 0.6, cz, 11, 0.5, 11), [0.25, 0.55, 0.8], 0.6);
  K.emissive(G.cyl, TM.box(cx, 2.2, cz, 0.8, 3.6, 0.8), [0.6, 0.85, 1.0], 1.5);
  K.sprite(cx, 4.2, cz, [0.6, 0.85, 1.0], 6, 1.6);
  K.splat(cx, cz, 0.3, 0.55, 0.8, 9);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; K.tree(cx + Math.cos(a) * 16, cz + Math.sin(a) * 16, 0.9); }
  for (const [x, z] of [[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3]]) K.streetLamp(x, z, 0, 0, lc, 5);
}

// a car park: rows of parked cars, lamps on tall poles (in the block's frame)
function parkingLot(K, lp, bx, lc) {
  const { G, rd, pickd } = K;
  K.layPoly(lp.map((p) => K.toWorld(p.x, p.z)), 0);
  for (let z = bx.z0 + 4; z < bx.z1 - 4; z += 13)
    for (let x = bx.x0 + 2; x < bx.x1 - 2; x += 2.7)
      for (const zz of [z, z + 5.6]) {
        const take = rd() < 0.65, col = rd() < 0.06 ? [0.75, 0.55, 0.05] : pickd(CARS);
        if (!take || !insidePoly(lp, x - 1.2, zz - 2.4) || !insidePoly(lp, x + 1.2, zz + 2.4)) continue;
        K.basic(G.cube, TM.yaw(x, 0.72, zz, 4.4, 0.78, 1.86, Math.PI / 2), col);
        K.basic(G.cube, TM.yaw(x, 1.38, zz + 0.3, 2.3, 0.58, 1.62, Math.PI / 2), [0.02, 0.022, 0.026]);
      }
  const c = polyCentroid(lp);
  for (const [x, z] of [[c.x, c.z], [(c.x + bx.x0) / 2, (c.z + bx.z0) / 2]]) {
    if (!insidePoly(lp, x, z)) continue;
    K.basic(G.cyl, TM.box(x, 5, z, 0.3, 10, 0.3), [0.12, 0.12, 0.13]);
    K.sprite(x, 10, z, lc, 6, 1.0);
    K.splat(x, z, lc[0] * 0.7, lc[1] * 0.7, lc[2] * 0.7, 12);
  }
}

// a park: lawns, winding paths with lamps, a pond, trees. The plan is drawn from the superblock's
// seed, so every piece can paint the lawn and paths under it; the piece at the centre adds the rest.
function parkPlan(sb, b) {
  if (sb.parkPlan) return sb.parkPlan;
  const rng = mulberry32(sb.seed ^ 0x7f4a7c15), R = (a, c) => a + (c - a) * rng();
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const pond = { x: b.cx + R(-0.15, 0.15) * w, z: b.cz + R(-0.15, 0.15) * d, rx: w * R(0.12, 0.22), rz: d * R(0.12, 0.22) };
  const inPond = (x, z) => ((x - pond.x) / pond.rx) ** 2 + ((z - pond.z) / pond.rz) ** 2 < 1.3;
  const paths = [];
  for (let k = 0; k < 4; k++) {
    const horizontal = k % 2 === 0, ph = R(0, 6), amp = R(10, 30), off = R(-0.3, 0.3) * (horizontal ? d : w);
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = lerp(horizontal ? b.x0 + 4 : b.z0 + 4, horizontal ? b.x1 - 4 : b.z1 - 4, t);
      const v = (horizontal ? b.cz : b.cx) + off + Math.sin(t * 7 + ph) * amp;
      const [x, z] = horizontal ? [u, v] : [v, u];
      if (!inPond(x, z)) paths.push([x, z, Math.round(t * 50) % 5 === 0]);
    }
  }
  sb.parkPlan = { pond, paths, inPond };
  return sb.parkPlan;
}
function parkGround(K, sb, b) {
  const P = parkPlan(sb, b);
  K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
  K.layPond(P.pond.x, P.pond.z, P.pond.rx, P.pond.rz);
  for (const [x, z] of P.paths) K.layDisk(x, z, 2.0, 1);
}
function park(K, sb, b) {
  K.reseed(sb.seed ^ 0x1b873593);
  const { G, rd, Rd, Q } = K, P = parkPlan(sb, b);
  sidewalk(K, b.x0, b.z0, b.x1, b.z0 + 4); sidewalk(K, b.x0, b.z1 - 4, b.x1, b.z1);
  sidewalk(K, b.x0, b.z0 + 4, b.x0 + 4, b.z1 - 4); sidewalk(K, b.x1 - 4, b.z0 + 4, b.x1, b.z1 - 4);
  for (const [x, z, lamp] of P.paths) {
    if (!lamp) continue;
    if (K.full) { K.basic(G.cyl, TM.box(x + 3, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]); K.emissive(G.sphere, TM.box(x + 3, 4.2, z, 0.55, 0.55, 0.55), LAMP, 2.5); }
    K.sprite(x + 3, 4.2, z, LAMP, 4, 0.7);
    K.splat(x + 3, z, 0.75, 0.55, 0.34, 5);
  }
  const n = (((b.x1 - b.x0) * (b.z1 - b.z0)) / 140) * Q.trees;
  for (let k = 0; k < n; k++) {
    const x = Rd(b.x0 + 7, b.x1 - 7), z = Rd(b.z0 + 7, b.z1 - 7), s = Rd(0.9, 1.6), con = rd() < 0.25;
    if (P.inPond(x, z) || P.paths.some(([px, pz]) => Math.abs(px - x) < 4 && Math.abs(pz - z) < 4)) continue;
    K.tree(x, z, s, con);
  }
}

// industry: warehouses and sheds, tanks, chimneys, yards under white mercury lamps (in the block's frame)
function industrialLots(K, lp, bx, placed) {
  const { G, R, rd, Rd, pickd } = K;
  const lots = [];
  splitLots(K, bx.x0, bx.z0, bx.x1, bx.z1, 75, 0, 15, lots, 0.05);
  for (const lot0 of lots) {
    const r = K.rng(), g = R(4, 9), H = R(8, 17), H2 = R(14, 26), ch = R(38, 75);
    const lot = fitLot(lot0, lp);
    if (!lot) continue;
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0, cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    if (w < 14 || d < 14) continue;
    placed.push(lot);
    if (r < 0.55) {
      // a warehouse: long, low, few windows, a lit loading door or two
      const wall = pickd([[0.32, 0.33, 0.34], [0.22, 0.26, 0.3], [0.35, 0.3, 0.24], [0.15, 0.17, 0.2]]);
      K.building(lot.x0 + g, lot.z0 + g, lot.x1 - g, lot.z1 - g, H, lot.sides, 0.05, H, { style: 3, wall, wx: 0.3, shop: 0.05, tiers: false, fh: R(4.5, 6) });
      for (const sz of [lot.z0 + g, lot.z1 - g]) if (rd() < 0.5) {
        const dx = Rd(lot.x0 + g + 4, lot.x1 - g - 4);
        K.emissive(G.cube, TM.box(dx, 2.4, sz, 4.5, 4.8, 0.3), [0.9, 0.85, 0.7], 0.8);
        K.splat(dx, sz + (sz > cz ? 4 : -4), 0.45, 0.5, 0.45, 6);
      }
      K.basic(G.cyl, TM.box(lot.x0 + 2, 6, lot.z0 + 2, 0.3, 12, 0.3), [0.12, 0.12, 0.13]);
      K.sprite(lot.x0 + 2, 12, lot.z0 + 2, MERCURY, 6, 1.0);
      K.splat(lot.x0 + 4, lot.z0 + 4, 0.6, 0.85, 0.72, 11);
    } else if (r < 0.78) {
      // storage tanks with a ring of lights
      const n = w > 40 && d > 40 ? 4 : 1, rad = Math.min(w, d) / (n > 1 ? 4.4 : 2.4);
      for (let k = 0; k < n; k++) {
        const x = n > 1 ? cx + (k % 2 ? 1 : -1) * w / 4 : cx, z = n > 1 ? cz + (k < 2 ? 1 : -1) * d / 4 : cz, h = R(10, 18);
        K.basic(G.cyl, TM.box(x, h / 2, z, rad * 2, h, rad * 2), [0.62, 0.62, 0.6]);
        K.basic(G.cone, TM.box(x, h + 1, z, rad * 2, 2, rad * 2), [0.55, 0.55, 0.53]);
        K.collider(x - rad * 0.8, 0, z - rad * 0.8, x + rad * 0.8, h + 1.5, z + rad * 0.8);
        K.footRect(x - rad, z - rad, x + rad, z + rad);
        K.sprite(x, h + 2.2, z, [1, 0.08, 0.04], 4, 0.6, ANIM.blink, 0, rd());
        if (rd() < 0.5) K.sprite(x + rad, h * 0.6, z, MERCURY, 3, 0.6);
      }
    } else {
      // a works building with a tall chimney
      K.building(lot.x0 + g, lot.z0 + g, lot.x1 - g, lot.z1 - g, H2, lot.sides, 0.05, H2, { style: 2, wall: [0.28, 0.17, 0.12], wx: 0.5, shop: 0.05, tiers: false, roof: false });
      const x = lot.x1 - g - 3, z = lot.z0 + g + 3;
      K.basic(G.cyl, TM.box(x, ch / 2, z, 3.2, ch, 3.2), [0.3, 0.22, 0.18]);
      for (const y of [ch * 0.5, ch - 2]) K.basic(G.cyl, TM.box(x, y, z, 3.5, 0.6, 3.5), [0.6, 0.6, 0.6]);
      K.collider(x - 1.4, 0, z - 1.4, x + 1.4, ch, z + 1.4);
      K.sprite(x, ch + 0.6, z, [1, 0.08, 0.04], 7, 1.0, ANIM.blink, 0, rd());
      K.sprite(x, ch * 0.5, z + 1.8, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
    }
  }
}

// a house with a gabled roof, centred at (cx, cz) in the current frame, ridge along x
function house(K, cx, cz, hw, hd, H, style, wall) {
  const { G, R, pickd } = K;
  K.push(G.cube, TM.box(cx, H / 2, cz, hw * 2, H, hd * 2), [...wall, 0.25], [MAT.building, 0, Math.floor(K.rng() * 16000000), 0], [style, H > 5 ? H / 2 : H, R(2.6, 3.4), 0.45]);
  K.collider(cx - hw, 0, cz - hd, cx + hw, H, cz + hd);
  K.footRect(cx - hw, cz - hd, cx + hw, cz + hd);
  // the roof: a box turned 45 degrees about its ridge and squashed to a gable, its top half above the
  // walls (eaves a little over them), its lower half hidden inside: the ends sit just within the walls
  const eave = hd + 0.45, rh = Math.min(hd * 0.75, H * 0.8), sq = eave * Math.SQRT2;
  const roof = pickd([[0.18, 0.08, 0.06], [0.12, 0.12, 0.13], [0.25, 0.12, 0.08], [0.08, 0.09, 0.1]]);
  const m = TM.pitch(cx, H, cz, hw * 2 - 0.04, sq, sq, Math.SQRT1_2, Math.SQRT1_2);
  m[5] *= rh / eave; m[6] *= rh / eave;
  K.basic(G.cube, m, roof);
  K.collider(cx - hw, H, cz - hd * 0.5, cx + hw, H + rh * 0.55, cz + hd * 0.5);
}
const houseWall = (K, style) => (style ? [K.R(0.3, 0.42), K.R(0.14, 0.2), K.R(0.08, 0.12)] : [K.R(0.38, 0.55), K.R(0.36, 0.5), K.R(0.32, 0.44)]);
// a block of houses where the suburbs reach into town (in the block's frame). Half of the blocks on an
// avenue have a row of low shops along it instead of houses (a main street), the houses behind.
function houseLots(K, blk, lp, bx, placed) {
  const { R, rd, Rd, Q } = K;
  const lots = [], shops = blk.ave && ih(blk.seed, 96) < 0.5 ? blk.ave : 0;
  splitLots(K, bx.x0, bx.z0, bx.x1, bx.z1, 22, 0, 15, lots, 0.05);
  for (const lot0 of lots) {
    const r = K.rng(), hwR = R(8, 12), hdR = R(7, 10), two = K.rng() < 0.3, Hh = two ? R(6, 7) : R(3.2, 3.6), j1 = R(-1, 1), j2 = R(-1, 1), style = K.rng() < 0.5 ? 0 : 2;
    const lot = fitLot(lot0, lp);
    if (!lot) continue;
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 9 || d < 9) continue;
    if (lot.sides & shops) {
      K.building(lot.x0 + 0.8, lot.z0 + 0.8, lot.x1 - 0.8, lot.z1 - 0.8, R(6.5, 10), lot.sides, 0.15, 10, { style: rd() < 0.5 ? 0 : 2, tiers: false, shop: R(0.22, 0.4) });
      placed.push(lot);
      continue;
    }
    // a lot with no street in front is a back garden
    if (r < 0.12 || !lot.sides) { K.tree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, Rd(1, 1.5), rd() < 0.4); continue; }
    const hw = Math.min(w - 4, hwR) / 2, hd = Math.min(d - 4, hdR) / 2, cx = (lot.x0 + lot.x1) / 2 + j1, cz = (lot.z0 + lot.z1) / 2 + j2;
    house(K, cx, cz, hw, hd, Hh, style, houseWall(K, style));
    placed.push(lot);
    if (rd() < 0.3) K.splat(cx, cz + hd + 2, 0.35, 0.25, 0.15, 3);
    if (rd() < 0.7 * Q.trees) K.tree(lot.x0 + Rd(1.5, 3), lot.z0 + Rd(1.5, 3), Rd(0.8, 1.3), rd() < 0.3);
  }
}

// ---------- the riverside row: promenade and gardens, or docks with containers, cranes and ships ----------
function riverRow(K, sb, X0, X1, Z0, Z1, own) {
  const r = sb.river, rz = (x) => riverZk(r, x), half = AVE.w / 2;
  const x0 = sb.x0 + half, x1 = sb.x1 - half, z0 = sb.z0 + half, z1 = sb.z1 - half;
  K.reseed(sb.seed ^ 0x9e3779b9);
  const { G, R, rd, Rd, pick, Q } = K;
  // embankment walls and promenade lamps, owned by position
  for (let x = Math.ceil(Math.max(x0, X0) / 8) * 8; x < Math.min(x1, X1); x += 8)
    for (const s of [-1, 1]) {
      const za = rz(x) + s * (r.hw + 0.75), zb = rz(x + 8) + s * (r.hw + 0.75), zc = (za + zb) / 2;
      if (zc < Z0 || zc >= Z1) continue;
      K.basic(G.cube, TM.yaw(x + 4, -1.2, zc, 8.3, 4.0, 1.5, -Math.atan2(zb - za, 8)), [0.12, 0.11, 0.1]);
    }
  if (sb.kind === 'riverside') {
    for (let x = Math.ceil((Math.max(x0, X0) - 8) / 24) * 24 + 8; x < Math.min(x1 - 4, X1); x += 24)
      for (const s of [-1, 1]) {
        const z = rz(x) + s * (r.hw + 3);
        if (z < Z0 || z >= Z1 || x < x0 + 4) continue;
        if (K.full) { K.basic(G.cyl, TM.box(x, 2.2, z, 0.16, 4.4, 0.16), [0.05, 0.05, 0.06]); K.emissive(G.sphere, TM.box(x, 4.6, z, 0.6, 0.6, 0.6), LAMP, 2.5); }
        K.sprite(x, 4.6, z, LAMP, 4.5, 0.7);
        K.splat(x, z, 0.8, 0.58, 0.36, 5.5);
      }
  }
  // its ground, painted by every piece it reaches; the rest belongs to the piece holding the row's centre
  K.layRect(x0, z0, x1, z1, sb.kind === 'docks' ? 0 : 2);
  if (!own(sb.cx, r.zc)) return;
  K.reseed(sb.seed ^ 0x51ed270b);
  sidewalk(K, x0, z0, x1, z0 + 4);
  sidewalk(K, x0, z1 - 4, x1, z1);
  if (sb.kind === 'riverside') {
    for (let k = 0, n = ((x1 - x0) / 9) * Q.trees; k < n; k++) {
      const x = Rd(x0 + 3, x1 - 3), s = rd() < 0.5 ? -1 : 1, zr = rz(x);
      const z = s < 0 ? Rd(z0 + 7, zr - r.hw - 14) : Rd(zr + r.hw + 14, z1 - 7);
      K.tree(x, z, Rd(0.9, 1.4), rd() < 0.2);
    }
    const wheelHere = r.k === 0 ? x0 < 430 && x1 > 430 : ih(sb.seed, 44) < 0.12;
    if (wheelHere) {
      const px = (x0 + x1) / 2, pz = (z0 + 4 + rz(px) - r.hw - 11) / 2;
      ferrisWheel(K, px, pz);
      K.marks.push({ type: 'wheel', x: px, y: 38, z: pz });
    }
    return;
  }
  // docks: quays both sides, container stacks, gantry cranes along the water, a ship or two
  for (const s of [-1, 1]) {
    const edge = (x) => rz(x) + s * (r.hw + 1.5), back = s < 0 ? z0 + 6 : z1 - 6;
    // gantry cranes on the quay edge
    for (let x = x0 + 30; x < x1 - 30; x += R(70, 110)) {
      const zq = edge(x), zi = zq - s * 26, h = R(38, 48), col = pick([[0.75, 0.2, 0.08], [0.15, 0.35, 0.6], [0.8, 0.6, 0.1]]);
      for (const dx of [-7, 7]) for (const zz of [zq, zi]) { K.basic(G.cube, TM.box(x + dx, h / 2, zz, 1.4, h, 1.4), col); K.collider(x + dx - 0.7, 0, zz - 0.7, x + dx + 0.7, h, zz + 0.7); }
      const za = zq + s * 32, zb = zi - s * 8;
      K.basic(G.cube, TM.box(x, h + 1.2, (za + zb) / 2, 3, 2.4, Math.abs(za - zb)), col);
      K.collider(x - 1.5, h, Math.min(za, zb), x + 1.5, h + 2.4, Math.max(za, zb));
      K.basic(G.cube, TM.box(x, h - 2, zq - s * 4, 4, 3, 4), [0.2, 0.2, 0.22]);
      K.sprite(x, h + 3, za, [1, 0.08, 0.04], 6, 0.9, ANIM.blink, 0, rd());
      K.sprite(x, h + 3, zb, [1, 0.08, 0.04], 6, 0.9, ANIM.blink, 0, rd());
      K.sprite(x, h - 0.5, zq, MERCURY, 5, 1.2);
      K.splat(x, zq - s * 8, 0.55, 0.8, 0.7, 14);
    }
    // container stacks between the quay edge and the drive (the bank winds: measured at each column)
    for (let x = x0 + 8; x < x1 - 14; x += 14) {
      const e = s < 0 ? Math.min(edge(x), edge(x + 12)) : Math.max(edge(x), edge(x + 12)), zq = e + s * 8;
      const zA = Math.min(zq, back), zB = Math.max(zq, back);
      if ((back - zq) * s > 0) for (let z = zA + 2; z < zB - 4; z += 3.2) {
        if (K.rng() < 0.25) continue;
        const n = 1 + Math.floor(K.rng() * 4), col = pick([[0.5, 0.08, 0.05], [0.08, 0.25, 0.45], [0.55, 0.4, 0.05], [0.12, 0.35, 0.15], [0.45, 0.45, 0.47], [0.6, 0.2, 0.05]]);
        for (let k = 0; k < n; k++) K.basic(G.cube, TM.box(x + 6, 1.3 + k * 2.6, z, 12, 2.55, 2.45), [col[0] * (0.8 + 0.3 * rd()), col[1] * (0.8 + 0.3 * rd()), col[2] * (0.8 + 0.3 * rd())]);
        K.collider(x, 0, z - 1.2, x + 12, n * 2.6, z + 1.2);
      }
      if (Math.round(x) % 56 < 14) { K.basic(G.cyl, TM.box(x, 9, back, 0.4, 18, 0.4), [0.12, 0.12, 0.13]); K.sprite(x, 18, back, MERCURY, 7, 1.3); K.splat(x, back - s * 10, 0.55, 0.8, 0.7, 16); }
    }
    // a ship moored at the quay, clear of the bridges
    // (lined up with the bank where it lies, and only where the bend is gentle enough for the hull)
    const shipRoll = K.rng(), L = R(90, Math.min(140, x1 - x0 - 90)), cx = (x0 + x1) / 2 + R(-20, 20), hull = pick([[0.12, 0.13, 0.15], [0.35, 0.08, 0.06], [0.08, 0.15, 0.25]]);
    const zc0 = rz(cx) + s * (r.hw - 14), slope = (rz(cx + 10) - rz(cx - 10)) / 20;
    let fits = shipRoll < 0.7 && x1 - x0 > 240;
    for (let t = -L / 2; fits && t <= L / 2; t += 10) fits = s * (rz(cx + t) + s * r.hw - (zc0 + slope * t + s * 9)) > 1.5;
    if (fits) {
      K.setFrame(cx, zc0, -Math.atan(slope) || 1e-9);
      const zc = 0;
      { const cx = 0;
      K.basic(G.cube, TM.box(cx, 2, zc, L, 9, 16), hull);
      K.collider(cx - L / 2, -3, zc - 8, cx + L / 2, 6.5, zc + 8);
      K.basic(G.cube, TM.box(cx - L * 0.38, 11, zc, 16, 12, 13), [0.75, 0.75, 0.72]);
      K.collider(cx - L * 0.38 - 8, 6.5, zc - 6.5, cx - L * 0.38 + 8, 17, zc + 6.5);
      for (let y = 8; y < 16; y += 3) K.emissive(G.cube, TM.box(cx - L * 0.38, y, zc - s * 6.55, 14, 0.8, 0.1), [1, 0.85, 0.6], 1.2);
      for (let x = cx - L * 0.25; x < cx + L * 0.45; x += 13) {
        const n = 1 + Math.floor(K.rng() * 3), col = pick([[0.5, 0.08, 0.05], [0.08, 0.25, 0.45], [0.55, 0.4, 0.05], [0.45, 0.45, 0.47]]);
        for (let k = 0; k < n; k++) K.basic(G.cube, TM.box(x, 7.8 + k * 2.6, zc, 12, 2.55, 12), col);
      }
      for (const dx of [-L / 2, L / 2]) K.sprite(cx + dx, 8, zc, dx < 0 ? [1, 0.1, 0.05] : [0.2, 1, 0.3], 4, 0.6);
      K.sprite(cx - L * 0.38, 19, zc, [1, 1, 1], 5, 0.7, ANIM.blink, 0, rd());
      }
      K.clearFrame();
    }
  }
}

function ferrisWheel(K, px, pz) {
  const { G, pick } = K, py = 38, rad = 30, w = 0.055, piv = [px, py, pz, w], ring = 56, spokes = 16;
  for (const side of [-1.6, 1.6]) {
    for (let k = 0; k < ring; k++) {
      const a0 = (k / ring) * Math.PI * 2, a1 = ((k + 1) / ring) * Math.PI * 2;
      K.basic(G.cube, TM.seg(px + Math.cos(a0) * rad, py + Math.sin(a0) * rad, pz + side, px + Math.cos(a1) * rad, py + Math.sin(a1) * rad, pz + side, 0.55), [0.55, 0.55, 0.6], ANIM.wheel, piv);
      K.sprite(px + Math.cos(a0) * rad, py + Math.sin(a0) * rad, pz + side * 1.2, [1, 1, 1], 7, 0.75, ANIM.wheel, 0, k / ring, piv);
    }
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      K.basic(G.cube, TM.seg(px, py, pz + side, px + Math.cos(a) * rad, py + Math.sin(a) * rad, pz + side, 0.22), [0.5, 0.5, 0.55], ANIM.wheel, piv);
      for (let r = 6; r < rad - 2; r += 6) K.sprite(px + Math.cos(a) * r, py + Math.sin(a) * r, pz + side * 1.2, [1, 1, 1], 5, 0.6, ANIM.wheel, 0, 0.5 + r / rad / 3, piv);
    }
  }
  K.basic(G.cyl, TM.seg(px, py, pz - 3.5, px, py, pz + 3.5, 3), [0.4, 0.4, 0.45]);
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2, c = pick(NEON);
    G.cube.push(TM.box(0, -1.7, 0, 2.6, 2.4, 2.4), [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0], [MAT.basic, ANIM.gondola, rad, a], piv);
    G.sprite.push([1, 0, 0, 0, 0, 1, 0, -1.7, 0, 0, 1, 0], [1, 0.75, 0.5, 2], [0.9, ANIM.gondola, rad, a], piv);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.basic(G.cube, TM.seg(px + sx * 16, 0, pz + sz * 5, px, py, pz + sz * 2.4, 1.1), [0.32, 0.32, 0.36]);
  K.splat(px, pz, 0.6, 0.5, 0.6, 22);
}

// ---------- roads: strips, crossings, lamps and the cars on them ----------
const CARS = [[0.5, 0.05, 0.04], [0.06, 0.07, 0.09], [0.6, 0.6, 0.62], [0.12, 0.2, 0.35], [0.03, 0.03, 0.03], [0.35, 0.35, 0.37], [0.05, 0.18, 0.12], [0.55, 0.38, 0.05]];
// Traffic on the avenues, which run on forever: every lane is a conveyor of slots CAR_STEP m apart
// moving at the lane's own speed, the same in every piece; a piece draws the slots inside its own
// stretch [lo, hi), and the shader decides which slots hold a car (and its colour) from the slot's
// global number, so a car leaving one piece is already in the next. Nothing loops or pops.
// axis 0 runs along x at z = coord, axis 1 along z at x = coord; dir +1 / -1
const CAR_STEP = 12;
function lane(K, axis, coord, dir, lo, hi, code = 0) {
  const { G } = K, speed = 9 + 7 * ih(Math.round(coord * 4), dir > 0 ? 81 : 82), v = dir * (speed + 1000 * code);
  const q = axis === 0 ? [coord, lo, hi, v] : [coord, hi, lo, v];
  for (let i = 0, n = Math.ceil((hi - lo) / CAR_STEP) + 1; i < n; i++) {
    // body (p.z = 1: coloured by the shader), cabin, headlights, tail lights
    G.cube.push(TM.box(0, 0.72, 0, 4.4, 0.78, 1.86), [0.3, 0.3, 0.3, 0], [MAT.basic, ANIM.car, 1, i], q);
    G.cube.push(TM.box(-0.3, 1.38, 0, 2.3, 0.58, 1.62), [0.02, 0.022, 0.026, 0], [MAT.basic, ANIM.car, 0, i], q);
    for (const z of [-0.62, 0.62]) { K.sprite(2.22, 0.78, z, [1, 0.92, 0.8], 4, 0.35, ANIM.car, 1, i, q); K.sprite(-2.22, 0.85, z, [1, 0.06, 0.03], 3, 0.3, ANIM.car, -1, i, q); }
  }
}
// The four lanes of a north-south avenue over [lo, hi) of this piece, on the stretch [e0, e1] between
// port gates (aveStretch): q holds the lane's x, the ends and its speed with the lane's code; the
// instances sit at the piece's centre (cpx, cpz), so the shader knows which piece draws which cars.
function nsLanes(K, x, lo, hi, e0, e1, cpx, cpz) {
  if (!K.full || hi - lo < 1) return;
  const { G } = K;
  for (const o of [2.2, 5.8])
    for (const [lx, dir, code] of [[x - o, 1, o > 3 ? 1 : 2], [x + o, -1, o > 3 ? 4 : 3]]) {
      const speed = 9 + 7 * ih(Math.round(lx * 4), dir > 0 ? 81 : 82), q = [lx, e0, e1, dir * (speed + 1000 * code)];
      for (let i = 0, n = Math.ceil((hi - lo + Math.PI * o) / CAR_STEP) + 1; i < n; i++) {
        G.cube.push(TM.box(cpx, 0.72, cpz, 4.4, 0.78, 1.86), [0.3, 0.3, 0.3, 0], [MAT.basic, ANIM.car, 1, i], q);
        G.cube.push(TM.box(cpx - 0.3, 1.38, cpz, 2.3, 0.58, 1.62), [0.02, 0.022, 0.026, 0], [MAT.basic, ANIM.car, 0, i], q);
        for (const z of [-0.62, 0.62]) { K.sprite(cpx + 2.22, 0.78, cpz + z, [1, 0.92, 0.8], 4, 0.35, ANIM.car, 1, i, q); K.sprite(cpx - 2.22, 0.85, cpz + z, [1, 0.06, 0.03], 3, 0.3, ANIM.car, -1, i, q); }
      }
    }
}
// both directions of an east-west avenue over [lo, hi); right-hand traffic: driving +x keeps to +z
function lanes(K, axis, coord, lo, hi) {
  if (!K.full || hi - lo < 1) return;
  for (const o of [2.2, 5.8]) {
    if (axis === 0) { lane(K, 0, coord + o, 1, lo, hi); lane(K, 0, coord - o, -1, lo, hi); }
    // north-south: the lane's code (see carPose): which of the four lanes it is
    else { lane(K, 1, coord - o, 1, lo, hi, o > 3 ? 1 : 2); lane(K, 1, coord + o, -1, lo, hi, o > 3 ? 4 : 3); }
  }
}
// ---------- the streets inside a superblock (layout.js), in any direction ----------
// a piece of asphalt from (ax, az) to (bx, bz): local x along the street (shadeRoad works in it)
function streetPiece(K, ax, az, bx, bz, w, lanesN, extra = 0) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  K.G.cube.push(TM.yaw((ax + bx) / 2, ROADY - 0.15, (az + bz) / 2, L + extra, 0.3, w, Math.atan2(-dz, dx)), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, w, lanesN, 0]);
}
// a straight street: its pieces (each owned by the piece of city its middle is in), lamps both
// sides on its own lattice, cars parked along the kerbs, clear of every junction
function straightStreet(K, road, own, lc, step, seed) {
  const dx = road.bx - road.ax, dz = road.bz - road.az, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const lanesN = 1, at = (s, o) => [road.ax + ux * s + nx * o, road.az + uz * s + nz * o];
  const gap = road.split, inGap = (s, m) => gap && s > gap[0] - m && s < gap[1] + m;
  const n = Math.max(1, Math.ceil(len / 32));
  for (let k = 0; k < n; k++) {
    let s0 = (len * k) / n, s1 = (len * (k + 1)) / n;
    if (gap) { if (s0 >= gap[0] && s1 <= gap[1]) continue; if (s0 < gap[0] && s1 > gap[0]) s1 = gap[0]; else if (s0 < gap[1] && s1 > gap[1]) s0 = gap[1]; }
    const [cx, cz] = at((s0 + s1) / 2, 0);
    if (!own(cx, cz) || s1 - s0 < 0.5) continue;
    const [ax, az] = at(s0, 0), [bx, bz] = at(s1, 0);
    streetPiece(K, ax, az, bx, bz, road.w, lanesN, 0.04);
  }
  const clear = (s, m) => s < m || s > len - m || inGap(s, m) || road.junc.some((j) => Math.abs(s - j) < m);
  for (let s = 10; s < len - 10; s += step) {
    if (clear(s, 9)) continue;
    for (const sd of [-1, 1]) {
      const [x, z] = at(s, sd * (road.w / 2 + 0.8));
      if (own(x, z)) K.streetLamp(x, z, -nx * sd, -nz * sd, lc);
    }
  }
  if (!K.full) return;
  K.reseed(seed);
  const every = K.Q.carGap * 0.35 + 6, yaw = Math.atan2(-uz, ux);
  for (const sd of [-1, 1]) {
    for (let s = 9 + K.Rd(0, every); s < len - 9; s += every * K.Rd(0.5, 1.5) + 5.5) {
      const skip = K.rd() < 0.25, col = K.rd() < 0.08 ? [0.75, 0.55, 0.05] : K.pickd(CARS);
      const [x, z] = at(s, sd * (road.w / 2 - 1.2));
      if (skip || !own(x, z) || clear(s, road.w / 2 + 7)) continue;
      K.basic(K.G.cube, TM.yaw(x, 0.72, z, 4.4, 0.78, 1.86, yaw), col);
      const [x2, z2] = at(s - 0.3, sd * (road.w / 2 - 1.2));
      K.basic(K.G.cube, TM.yaw(x2, 1.38, z2, 2.3, 0.58, 1.62, yaw), [0.02, 0.022, 0.026]);
    }
  }
}
// the strip of a road, clipped to the piece; lamps on a lattice so neighbours line up
function roadStrip(K, axis, coord, w, lanesN, lo, hi) {
  if (hi - lo < 0.5) return;
  const c = (lo + hi) / 2, L = hi - lo;
  K.G.cube.push(axis === 0 ? TM.box(c, ROADY - 0.15, coord, L, 0.3, w) : TM.box(coord, ROADY - 0.15, c, w, 0.3, L), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [axis, w, lanesN, 0]);
}
function crossing(K, x, z, wx, wz) { K.G.cube.push(TM.box(x, ROADY - 0.12, z, wx, 0.3, wz), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, wx, wz, 1]); }
function roadLamps(K, axis, coord, w, lo, hi, own, crosses, col, step) {
  const off = ih(Math.round(coord), 51) * step;
  for (let s = Math.ceil((lo + 8 - off) / step) * step + off; s < hi - 8; s += step) {
    if (crosses.some((c) => Math.abs(s - c.pos) < c.w / 2 + 3)) continue;
    for (const side of [-1, 1]) {
      const p = coord + side * (w / 2 + 0.8);
      const [x, z] = axis === 0 ? [s, p] : [p, s];
      if (!own(x, z)) continue;
      if (axis === 0) K.streetLamp(x, z, 0, -side, col); else K.streetLamp(x, z, -side, 0, col);
    }
  }
}

// some avenues are boulevards: a raised median with trees and double lamps down the middle, broken
// at the crossings with other avenues (the lanes either side, at 2.2 m and more, stay clear)
const boulevardX = (i) => i !== 0 && !hasTrain(i) && ih(i, 63) < 0.3;
const boulevardZ = (l) => l.kind === '' && ih2(l.k, l.m, 64) < 0.3;
function median(K, axis, coord, lo, hi, own, lc, step) {
  const a = lo + AVE.w / 2 + 3, b = hi - AVE.w / 2 - 3;
  if (b - a < 10) return;
  const n = Math.ceil((b - a) / 32), at = (s) => (axis === 0 ? [s, coord] : [coord, s]);
  for (let k = 0; k < n; k++) {
    const s0 = a + ((b - a) * k) / n, s1 = a + ((b - a) * (k + 1)) / n, [x, z] = at((s0 + s1) / 2);
    if (!own(x, z)) continue;
    K.basic(K.G.cube, axis === 0 ? TM.box(x, 0.12, z, s1 - s0, 0.24, 1.2) : TM.box(x, 0.12, z, 1.2, 0.24, s1 - s0), [0.15, 0.145, 0.14]);
    if (K.full) K.push(K.G.cube, axis === 0 ? TM.box(x, 0.25, z, s1 - s0 - 0.4, 0.04, 0.8) : TM.box(x, 0.25, z, 0.8, 0.04, s1 - s0 - 0.4), [0.04, 0.07, 0.03, 0], [MAT.foliage, 0, K.seed(), 0]);
  }
  for (let s = Math.ceil(a / 16) * 16 + 8; s < b - 4; s += 16) {
    const [x, z] = at(s);
    if (!own(x, z)) continue;
    if (Math.round(s / 16) % Math.max(1, Math.round(step / 16)) === 0) { K.streetLamp(x, z, axis === 0 ? 0 : 1, axis === 0 ? 1 : 0, lc, 8); K.streetLamp(x, z, axis === 0 ? 0 : -1, axis === 0 ? -1 : 0, lc, 8); }
    else K.tree(x, z, 0.75);
  }
}

// ---------- bridges and the elevated train ----------
// type: 'girder' (piers every 30 m), 'arch' (a steel arch over the whole span), 'cable' (cable-stayed
// from one pylon), 'suspension' (two towers, main cables)
function bridge(K, x, r, w, type, own) {
  const grand = type === 'suspension';
  const { G } = K, W = w + 2.4, rz = riverZk(r, x), zA = rz - r.hw - RIVER.ramp, zB = rz + r.hw + RIVER.ramp;
  const n = Math.ceil((zB - zA) / 5);
  for (let k = 0; k < n; k++) {
    const z0 = zA + ((zB - zA) * k) / n, z1 = zA + ((zB - zA) * (k + 1)) / n;
    if (!own(x, (z0 + z1) / 2)) continue;
    const y0 = bridgeH(x, z0), y1 = bridgeH(x, z1), len = Math.hypot(z1 - z0, y1 - y0), sn = (y1 - y0) / len, cs = (z1 - z0) / len;
    const cy = ROADY + (y0 + y1) / 2 - 0.6, cz = (z0 + z1) / 2;
    G.cube.push(TM.pitch(x, cy, cz, W, 1.2, len + 0.25, sn, cs), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [1, w, 2, 0]);
    for (const s of [-1, 1]) K.basic(G.cube, TM.pitch(x + s * (W / 2 - 0.15), cy + 1.1, cz, 0.3, 1.0, len + 0.25, sn, cs), [0.13, 0.13, 0.15]);
    const yLo = ROADY + Math.min(y0, y1), yHi = ROADY + Math.max(y0, y1);
    if (yHi > ROADY + 0.3) {
      K.collider(x - W / 2, yLo - 1.2, z0, x + W / 2, yHi, z1);
      for (const s of [-1, 1]) K.collider(x + s * (W / 2 - 0.15) - 0.15, yLo, z0, x + s * (W / 2 - 0.15) + 0.15, yHi + 1.0, z1);
    }
  }
  for (let z = rz - r.hw + 14; z < rz + r.hw - 10 && (type === 'girder' || grand); z += grand ? 200 : 30) {
    if (!own(x, z)) continue;
    K.basic(G.cyl, TM.box(x, (ROADY + RIVER.h - 1.2 - 3) / 2, z, 3.2, ROADY + RIVER.h - 1.2 + 3, 5), [0.1, 0.1, 0.1]);
    K.collider(x - 1.4, -3, z - 2.3, x + 1.4, ROADY + RIVER.h - 1.2, z + 2.3);
  }
  const lampC = grand ? [0.75, 0.85, 1.0] : type === 'cable' ? LED : LAMP;
  for (let z = zA + 20; z < zB - 10; z += 26)
    for (const s of [-1, 1]) {
      const lxp = x + s * (W / 2 - 0.2), y = ROADY + bridgeH(x, z);
      if (!own(lxp, z)) continue;
      if (K.full) { K.basic(G.cyl, TM.box(lxp, y + 2.6, z, 0.16, 5.2, 0.16), [0.08, 0.08, 0.09]); K.emissive(G.sphere, TM.box(lxp - s * 0.2, y + 5.1, z, 0.5, 0.5, 0.5), lampC, 2); }
      K.sprite(lxp - s * 0.4, y + 5.1, z, lampC, 4, 0.6);
    }
  if (type === 'arch' && own(x, rz)) archSpan(K, x, r, W);
  if (type === 'cable' && own(x, rz)) cableStayed(K, x, r, W);
  if (!grand || !own(x, rz)) return;
  // the suspension bridge: two towers, main cables strung with lights, suspenders down to the deck
  const deckY = ROADY + RIVER.h, top = 58, zt = [rz - r.hw + 10, rz + r.hw - 10], legX = [x - W / 2 - 1.3, x + W / 2 + 1.3];
  for (const z of zt) {
    for (const lxp of legX) { K.basic(G.cube, TM.box(lxp, (top - 3) / 2, z, 2.4, top + 3, 3.4), [0.2, 0.19, 0.2]); K.collider(lxp - 1.2, -3, z - 1.7, lxp + 1.2, top, z + 1.7); }
    for (const y of [deckY + 10, 40, top - 1]) { K.basic(G.cube, TM.box(x, y, z, W + 5, 2.2, 2.6), [0.2, 0.19, 0.2]); K.collider(x - (W + 5) / 2, y - 1.1, z - 1.3, x + (W + 5) / 2, y + 1.1, z + 1.3); }
    for (const lxp of legX) K.sprite(lxp, top + 0.8, z, [1, 0.1, 0.05], 6, 0.9, ANIM.blink, 0, K.rd());
    for (const lxp of legX) for (let y = 4; y < top; y += 6) K.sprite(lxp - Math.sign(lxp - x) * 1.3, y, z, [0.7, 0.8, 1], 1.6, 0.5);
  }
  for (let s = 0; s < 2; s++) {
    const pts = [], xx = legX[s], anchorA = zA + 8, anchorB = zB - 8, zm = (zt[0] + zt[1]) / 2, half = (zt[1] - zt[0]) / 2, low = deckY + 2.5;
    for (let z = anchorA; z <= zt[0] + 0.01; z += (zt[0] - anchorA) / 10) pts.push([xx, lerp(ROADY + bridgeH(x, anchorA) + 1, top, (z - anchorA) / (zt[0] - anchorA)), z]);
    for (let k = 1; k <= 30; k++) { const z = zt[0] + (2 * half * k) / 30, t = (z - zm) / half; pts.push([xx, low + (top - low) * t * t, z]); }
    for (let k = 1; k <= 10; k++) { const z = zt[1] + ((anchorB - zt[1]) * k) / 10; pts.push([xx, lerp(top, ROADY + bridgeH(x, anchorB) + 1, (z - zt[1]) / (anchorB - zt[1])), z]); }
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      K.basic(G.cube, TM.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.55), [0.3, 0.3, 0.33]);
      K.sprite(a[0], a[1] + 0.5, a[2], [0.8, 0.88, 1.0], 3.2, 0.45);
      if (a[2] > zt[0] + 1 && a[2] < zt[1] - 1) K.basic(G.cube, TM.seg(a[0], deckY + 0.8, a[2], a[0], a[1], a[2], 0.12), [0.3, 0.3, 0.33]);
    }
  }
}
// the end of an avenue at the riverside (zd, s: +1 the river lies towards +z): a kerb with bollards
// across the road, a railing and benches facing the water, lamps; a lawn with trees from there to the
// promenade (lookoutGround)
function lookout(K, x, zd, s, r, own) {
  if (!own(x, zd)) return;
  const { G, rd } = K, W = AVE.w;
  K.basic(G.cube, TM.box(x, 0.18, zd + s * 0.3, W, 0.36, 0.6), [0.32, 0.32, 0.33]);
  K.collider(x - W / 2, 0, zd + s * 0.3 - 0.3, x + W / 2, 0.36, zd + s * 0.3 + 0.3);
  for (let dx = -W / 2 + 1; dx <= W / 2 - 1; dx += 2.4) {
    K.basic(G.cyl, TM.box(x + dx, 0.55, zd + s * 1.2, 0.28, 1.1, 0.28), [0.2, 0.2, 0.22]);
    K.sprite(x + dx, 1.12, zd + s * 1.2, [1, 0.82, 0.55], 1.4, 0.25);
  }
  K.collider(x - W / 2, 0, zd + s * 1.2 - 0.15, x + W / 2, 1.1, zd + s * 1.2 + 0.15);
  for (const dx of [-W / 2 - 1.5, W / 2 + 1.5]) K.streetLamp(x + dx, zd + s * 2, -Math.sign(dx), 0, LAMP, 5.5);
  // the railing at the bank, a bench or two facing the river
  const rz = riverZk(r, x), zb = rz - s * (r.hw + 2.5);
  if ((zb - zd) * s > 8) {
    K.basic(G.cube, TM.box(x, 1, zb, W + 4, 0.08, 0.08), [0.6, 0.6, 0.62]);
    for (let dx = -W / 2 - 2; dx <= W / 2 + 2; dx += 2) K.basic(G.cube, TM.box(x + dx, 0.5, zb, 0.06, 1, 0.06), [0.4, 0.4, 0.42]);
    K.collider(x - W / 2 - 2, 0, zb - 0.1, x + W / 2 + 2, 1.05, zb + 0.1);
    if (K.full) for (const dx of [-5, 5]) if (rd() < 0.8) K.basic(G.cube, TM.box(x + dx, 0.45, zb - s * 2.5, 2, 0.12, 0.5), [0.25, 0.16, 0.1]);
    for (let t = 6; (zb - (zd + s * t)) * s > 5; t += 9) for (const dx of [-7, 7]) K.tree(x + dx, zd + s * t, 1);
  }
}
function lookoutGround(K, x, zd, s, r) {
  const rz = riverZk(r, x), zb = rz - s * r.hw;
  if ((zb - zd) * s > 1) K.layRect(x - AVE.w / 2, Math.min(zd, zb), x + AVE.w / 2, Math.max(zd, zb), 2);
}
// a port's gate at the end of an avenue: the terminal building (dark doorways, a lit band over them,
// D m deep: it keeps off the quay), a canopy over the gate lanes with a booth and closed barriers;
// the traffic turns round in front of it. s: +1 the building lies towards +z of its doors, -1 -z
function portGate(K, x, zd, s, D, own) {
  if (!own(x, zd)) return;
  const { G } = K, W = 32, H = 10, zb = zd + (s * D) / 2, wall = [0.26, 0.28, 0.3];
  K.basic(G.cube, TM.box(x, H / 2, zb, W, H, D), wall);
  K.collider(x - W / 2, 0, zb - D / 2, x + W / 2, H, zb + D / 2);
  K.footRect(x - W / 2, zb - D / 2, x + W / 2, zb + D / 2);
  // the doorways, one each way, and the lit band over them
  for (const dx of [-5, 5]) K.basic(G.cube, TM.box(x + dx, 2.6, zd - s * 0.04, 9, 5.2, 0.1), [0.015, 0.015, 0.018]);
  K.emissive(G.cube, TM.box(x, 6.4, zd - s * 0.06, W - 6, 0.9, 0.1), [0.35, 0.75, 1.0], 2.4);
  for (let dx = -12; dx <= 12; dx += 6) K.sprite(x + dx, H + 0.6, zb, [1, 0.08, 0.04], 3, 0.5, ANIM.blink, 0, K.rd());
  // the canopy over the gate lanes, on four posts, lit beneath; booths and barriers under it
  const zc = zd - s * 6.5;
  K.basic(G.cube, TM.box(x, 6.3, zc, W - 4, 0.6, 12), [0.7, 0.7, 0.72]);
  K.collider(x - W / 2 + 2, 6, zc - 6, x + W / 2 - 2, 6.6, zc + 6);
  for (const dx of [-13, 13]) for (const dz of [-5, 5]) { K.basic(G.cube, TM.box(x + dx, 3, zc + dz, 0.5, 6, 0.5), [0.6, 0.6, 0.62]); K.collider(x + dx - 0.25, 0, zc + dz - 0.25, x + dx + 0.25, 6, zc + dz + 0.25); }
  K.emissive(G.cube, TM.box(x, 6.3, zc - s * 6.05, W - 6, 0.5, 0.08), [0.35, 0.75, 1.0], 2);
  for (const dx of [-8, 0, 8]) { K.sprite(x + dx, 5.8, zc, LED, 6, 1.4); K.splat(x + dx, zc, 0.75, 0.82, 0.9, 7); }
  K.basic(G.cube, TM.box(x, 1.2, zc, 1.6, 2.4, 3), [0.75, 0.75, 0.72]);
  K.emissive(G.cube, TM.box(x, 1.7, zc, 1.7, 0.7, 2.4), [1, 0.85, 0.6], 1.2);
  K.collider(x - 0.8, 0, zc - 1.5, x + 0.8, 2.4, zc + 1.5);
  for (const dx of [-5, 5]) K.basic(G.cube, TM.box(x + dx, 1.1, zc - s * 5, 8, 0.12, 0.12), [0.85, 0.12, 0.1]);
}
// a steel arch over the river from bank to bank on each side of the deck, hangers down to it
function archSpan(K, x, r, W) {
  const { G } = K, rz = riverZk(r, x), deckY = ROADY + RIVER.h, z0 = rz - r.hw + 1, z1 = rz + r.hw - 1, half = (z1 - z0) / 2;
  const rise = Math.min(34, 0.26 * (z1 - z0) + 6), col = [[0.5, 0.14, 0.1], [0.62, 0.62, 0.6], [0.16, 0.3, 0.42]][Math.floor(ih2(Math.round(x), r.k, 63) * 3)];
  const y = (z) => deckY - 1 + (rise + 1) * (1 - ((z - rz) / half) ** 2), n = 24;
  for (const s of [-1, 1]) {
    const ax = x + s * (W / 2 + 0.7);
    for (let k = 0; k < n; k++) {
      const za = z0 + (2 * half * k) / n, zb = z0 + (2 * half * (k + 1)) / n;
      K.basic(G.cube, TM.seg(ax, y(za), za, ax, y(zb), zb, 1.2), col);
      K.collider(ax - 0.6, Math.min(y(za), y(zb)) - 0.6, za, ax + 0.6, Math.max(y(za), y(zb)) + 0.6, zb);
      if (k % 2 === 0) K.sprite(ax, y(za) + 0.9, za, [1, 0.9, 0.75], 3.5, 0.5);
      // hangers down to the deck
      if (k > 0 && y(za) > deckY + 2.5) K.basic(G.cube, TM.seg(ax, deckY + 0.6, za, ax, y(za), za, 0.18), col);
    }
  }
  // bracing between the two arches near the crown
  for (let z = rz - half * 0.5; z <= rz + half * 0.5; z += half * 0.25) {
    if (y(z) < deckY + 7.5) continue;
    K.basic(G.cube, TM.box(x, y(z) - 0.3, z, W + 1.4, 0.7, 0.7), col);
    K.collider(x - W / 2 - 0.7, y(z) - 0.65, z - 0.35, x + W / 2 + 0.7, y(z) + 0.05, z + 0.35);
  }
}
// a cable-stayed bridge: one pylon (two legs joined at the top) in mid-river, fans of stays to the deck
function cableStayed(K, x, r, W) {
  const { G } = K, rz = riverZk(r, x), deckY = ROADY + RIVER.h, H = 46 + Math.min(30, r.hw * 0.35), legX = [x - W / 2 - 1.2, x + W / 2 + 1.2];
  for (const lx of legX) {
    K.basic(G.cube, TM.seg(lx, -2, rz, (lx + x) / 2, H, rz, 2.4), [0.62, 0.62, 0.6]);
    K.collider(Math.min(lx, x) - 1.2, -2, rz - 1.4, Math.max(lx, x) + 1.2, H, rz + 1.4);
  }
  K.basic(G.cube, TM.box(x, H + 4, rz, 3, 9, 3), [0.62, 0.62, 0.6]);
  K.collider(x - 1.5, H, rz - 1.5, x + 1.5, H + 8.5, rz + 1.5);
  K.basic(G.cube, TM.box(x, deckY - 1.5, rz, W + 6, 1.6, 4), [0.5, 0.5, 0.5]);
  K.sprite(x, H + 9, rz, [1, 0.08, 0.04], 6, 0.9, ANIM.blink, 0, K.rd());
  for (let y = 12; y < H; y += 7) K.sprite(x, y, rz - 1.6, [0.85, 0.9, 1.0], 2, 0.5);
  const reach = r.hw + RIVER.ramp * 0.5;
  for (const s of [-1, 1])
    for (let k = 1; k <= 9; k++) {
      const z = rz + s * (reach * k) / 9, top = H + 1 + k * 0.8, yd = ROADY + bridgeH(x, z) + 0.8;
      for (const lx of [x - W / 2 + 0.3, x + W / 2 - 0.3]) K.emissive(G.cube, TM.seg(x, top, rz, lx, yd, z, 0.3), [0.8, 0.85, 0.95], 0.7);
    }
}
// an elevated line runs above some avenues, from one riverside (or slot) to the next;
// its trains loop along that stretch (ANIM.train), stations at both ends
function trainLine(K, x, za, zb, own) {
  const { G } = K, px = x;
  for (let z = Math.ceil(za / 4) * 4; z < zb; z += 4) {
    if (!own(px, z + 2)) continue;
    K.basic(G.cube, TM.box(px, TRAIN_Y - 0.6, z + 2, 4.3, 1.2, 4.0), [0.16, 0.16, 0.18]);
    K.collider(px - 2.15, TRAIN_Y - 1.2, z, px + 2.15, TRAIN_Y, z + 4);
    if (z % 32 === 0) { K.basic(G.cyl, TM.box(px, (TRAIN_Y - 1.2) / 2, z, 1.6, TRAIN_Y - 1.2, 1.6), [0.15, 0.15, 0.16]); K.collider(px - 0.8, 0, z - 0.8, px + 0.8, TRAIN_Y - 1.2, z + 0.8); }
    if (z % 12 === 0) for (const o of [-2.3, 2.3]) K.sprite(px + o, TRAIN_Y - 0.4, z, [0.4, 0.7, 1.0], 1.8, 0.35);
  }
  for (const [zs, dz] of [[za + 30, 1], [zb - 30, -1]]) {
    if (!own(px, zs)) continue;
    K.basic(G.cube, TM.box(px, TRAIN_Y - 0.4, zs, 9, 0.8, 60), [0.2, 0.2, 0.22]);
    K.basic(G.cube, TM.box(px, TRAIN_Y + 5, zs, 10, 0.4, 60), [0.14, 0.14, 0.16]);
    K.collider(px - 4.5, TRAIN_Y - 0.8, zs - 30, px + 4.5, TRAIN_Y, zs + 30);
    K.collider(px - 5, TRAIN_Y + 4.8, zs - 30, px + 5, TRAIN_Y + 5.2, zs + 30);
    for (const sx of [-4.6, 4.6]) for (const sz of [-28, 0, 28]) { K.basic(G.cyl, TM.box(px + sx, TRAIN_Y + 2.4, zs + sz, 0.3, 5, 0.3), [0.14, 0.14, 0.16]); K.collider(px + sx - 0.15, TRAIN_Y, zs + sz - 0.15, px + sx + 0.15, TRAIN_Y + 4.8, zs + sz + 0.15); }
    for (let z = zs - 26; z <= zs + 26; z += 6.5) for (const sx of [-3, 3]) K.sprite(px + sx, TRAIN_Y + 4.6, z, [0.85, 0.92, 1.0], 4, 0.6);
    K.emissive(G.cube, TM.box(px, TRAIN_Y + 6.5, zs + dz * 30, 6, 1.4, 0.3), [0.3, 0.8, 1.0], 2.5);
  }
  const mid = (za + zb) / 2;
  if (!own(px, mid)) return;
  const L = zb - za - 60;
  K.reseed(pcg(Math.round(x) ^ pcg(Math.round(za))));
  for (let t = 0; t < 2; t++)
    for (let k = 0; k < 5; k++) {
      const s0 = (t * L) / 2 - k * 16, q = [px + (t ? 1.1 : -1.1), za + 30, zb - 30, t ? -17 : 17];
      G.cube.push(TM.box(0, 1.9, 0, 3.0, 3.3, 15), [0.7, 0.72, 0.75, 0], [MAT.train, ANIM.train, K.seed(), s0], q);
      if (k === 0) for (const o of [-0.9, 0.9]) K.sprite(o, 1.2, 7.6, [1, 0.95, 0.85], 6, 0.5, ANIM.train, 0, s0, q);
    }
}

// ---------- what isn't in any piece: the blimp over Halvard Bay (and, added by quad.js, the quad) ----------
function baseGroups(Q) {
  const K = makeKit(Q, true), G = K.G;
  K.reseed(77);
  const q = [100, -250, 700, 7], ph = 1.3;
  const env = (m, col) => G.sphere.push(m, [...col, 0], [MAT.basic, ANIM.blimp, K.seed(), ph], q);
  env(TM.box(0, 0, 0, 52, 13, 13), [0.3, 0.3, 0.31]);
  K.basic(G.cube, TM.box(2, -7.2, 0, 9, 2.2, 3), [0.2, 0.2, 0.22], ANIM.blimp, q, ph);
  for (const [y, z, sy, sz] of [[5, 0, 7, 0.4], [-5, 0, 7, 0.4], [0, 5, 0.4, 7], [0, -5, 0.4, 7]]) K.basic(G.cube, TM.box(-23, y, z, 7, sy, sz), [0.28, 0.28, 0.3], ANIM.blimp, q, ph);
  for (const z of [-6.6, 6.6]) G.cube.push(TM.box(3, 0.5, z, 24, 6.5, 0.3), [0.3, 0.8, 1.0, 3], [MAT.neon, ANIM.blimp, K.seed(), ph], q);
  K.sprite(26.5, 0, 0, [1, 1, 1], 6, 0.8, ANIM.blimp, 0, ph, q);
  K.sprite(-26, 0, 0, [1, 0.15, 0.1], 6, 0.8, ANIM.blimp, 0, ph, q);
  K.sprite(2, -8.6, 0, [1, 0.8, 0.5], 4, 0.9, ANIM.blimp, 0, ph, q);
  return G;
}

// ---------- one piece ----------
function genChunk(cx, cz, lod, Q) {
  const X0 = cx * CHUNK, Z0 = cz * CHUNK, X1 = X0 + CHUNK, Z1 = Z0 + CHUNK, full = lod > 0;
  const own = (x, z) => x >= X0 && x < X1 && z >= Z0 && z < Z1;
  const K = makeKit(Q, full), G = K.G;
  const xs = aveXs(X0 - 700, X1 + 700), zs = aveZs(Z0 - 1400, Z1 + 1400);
  const step = full ? Q.lampStep : Q.lampStep * 1.5;
  let tallest = null;
  const keep = (b) => { if (b && (!tallest || b.H > tallest.H)) tallest = b; };

  // superblocks touching the piece, and the streets inside them
  const sbs = [];
  for (let a = 0; a + 1 < xs.length; a++)
    for (let b = 0; b + 1 < zs.length; b++) {
      if (xs[a + 1].x < X0 || xs[a].x > X1 || zs[b + 1].z < Z0 || zs[b].z > Z1) continue;
      sbs.push(superblock(xs[a].i, zs[b], zs[b + 1]));
    }
  // the lawns at the lookouts where avenues end at a river (painted by every piece they reach)
  for (const { i, x } of xs) {
    if (x < X0 - 12 || x > X1 + 12) continue;
    for (const A of zs) {
      if (A.kind !== 'n' || A.z > Z1 + 400 || A.z < Z0 - 800) continue;
      const r = riverSlot(A.k);
      if (crossingOf(i, r) !== 'end') continue;
      lookoutGround(K, x, A.z + PORT_GATE.stub, 1, r); lookoutGround(K, x, A.z + 2 * r.row - PORT_GATE.stub, -1, r);
    }
  }
  // ---- north-south avenues (constant x) ----
  for (let a = 0; a < xs.length; a++) {
    const { i, x } = xs[a];
    if (x < X0 || x >= X1) continue;
    for (let b = 0; b + 1 < zs.length; b++) {
      const A = zs[b], B = zs[b + 1];
      if (B.z < Z0 - 400 || A.z > Z1 + 400) continue;
      const r = A.kind === 'n' ? riverSlot(A.k) : null;
      const cross = r ? crossingOf(i, r) : null;
      if (r && cross === 'gate') {
        // a port: the avenue ends at the gate on each bank (the traffic turns round in front of it)
        const dN = A.z + PORT_GATE.door, dS = B.z - PORT_GATE.door, rz = riverZk(r, x);
        roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(dN, Z1));
        roadStrip(K, 1, x, AVE.w, 2, Math.max(dS, Z0), Math.min(B.z, Z1));
        portGate(K, x, dN, 1, clamp(rz - r.hw - dN - 6, 10, 30), own); portGate(K, x, dS, -1, clamp(dS - (rz + r.hw) - 6, 10, 30), own);
      } else if (r && cross === 'end') {
        // no bridge here: on each bank the avenue ends at a lookout over the river
        const dN = A.z + PORT_GATE.stub, dS = B.z - PORT_GATE.stub;
        roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(dN, Z1));
        roadStrip(K, 1, x, AVE.w, 2, Math.max(dS, Z0), Math.min(B.z, Z1));
        lookout(K, x, dN, 1, r, own); lookout(K, x, dS, -1, r, own);
      } else if (r) {
        const rz = riverZk(r, x), zA = rz - r.hw - RIVER.ramp, zB = rz + r.hw + RIVER.ramp;
        roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(zA, Z1));
        roadStrip(K, 1, x, AVE.w, 2, Math.max(zB, Z0), Math.min(B.z, Z1));
        bridge(K, x, r, AVE.w, cross, own);
      } else roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(B.z, Z1));
      // the streets of the superblocks either side end on this stretch: no lamps across their mouths
      const crosses = [{ pos: A.z, w: AVE.w }, { pos: B.z, w: AVE.w }];
      if (a > 0) for (const j of sbLayout(superblock(xs[a - 1].i, A, B)).edgeJ.x1) crosses.push(j);
      for (const j of sbLayout(superblock(i, A, B)).edgeJ.x0) crosses.push(j);
      if (r && (cross === 'gate' || cross === 'end')) {
        const m = cross === 'gate' ? PORT_GATE.door - 12 : PORT_GATE.stub - 4, lc = cross === 'gate' ? MERCURY : LAMP;
        roadLamps(K, 1, x, AVE.w, A.z, A.z + m, own, crosses, lc, step);
        roadLamps(K, 1, x, AVE.w, B.z - m, B.z, own, crosses, lc, step);
      } else if (r) {
        const rz = riverZk(r, x);
        roadLamps(K, 1, x, AVE.w, A.z, rz - r.hw - RIVER.ramp, own, crosses, LAMP, step);
        roadLamps(K, 1, x, AVE.w, rz + r.hw + RIVER.ramp, B.z, own, crosses, LAMP, step);
      } else roadLamps(K, 1, x, AVE.w, A.z, B.z, own, crosses, lampColor(superblock(i, A, B)), step);
      if (!r && boulevardX(i)) median(K, 1, x, A.z, B.z, own, lampColor(superblock(i, A, B)), step);
    }
    // its traffic: this piece's stretch of road, less the port rows the avenue stops at
    let parts = [[Z0, Z1]];
    for (let k = riverK(Z0) - 1; k <= riverK(Z1) + 1; k++) {
      const g = gateEnds(i, k);
      if (!g) continue;
      parts = parts.flatMap(([p0, p1]) => [[p0, Math.min(p1, g[0])], [Math.max(p0, g[1]), p1]]).filter(([p0, p1]) => p1 - p0 > 0.5);
    }
    for (const [p0, p1] of parts) { const [e0, e1] = aveStretch(i, (p0 + p1) / 2); nsLanes(K, x, p0, p1, e0, e1, X0 + CHUNK / 2, Z0 + CHUNK / 2); }
  }
  // ---- elevated lines, from one river slot to the next ----
  for (const { i, x } of xs) {
    if (x < X0 || x >= X1 || !hasTrain(i)) continue;
    for (let k = riverK(Z0) - 1; k <= riverK(Z1) + 1; k++) {
      const a = riverSlot(k), b = riverSlot(k + 1), za = a.zc + (a.on ? a.row : 0), zb = b.zc - (b.on ? b.row : 0);
      if (zb > Z0 && za < Z1) trainLine(K, x, za, zb, own);
    }
  }
  // ---- east-west avenues (constant z) ----
  for (const l of zs) {
    if (l.z < Z0 || l.z >= Z1) continue;
    for (let a = 0; a + 1 < xs.length; a++) {
      const xa = xs[a].x, xb = xs[a + 1].x;
      if (xb < X0 || xa > X1) continue;
      roadStrip(K, 0, l.z, AVE.w, 2, Math.max(xa, X0), Math.min(xb, X1));
      const crosses = [{ pos: xa, w: AVE.w }, { pos: xb, w: AVE.w }];
      const below = zs[zs.indexOf(l) - 1], above = zs[zs.indexOf(l) + 1];
      if (below) for (const j of sbLayout(superblock(xs[a].i, below, l)).edgeJ.z1) crosses.push(j);
      if (above) for (const j of sbLayout(superblock(xs[a].i, l, above)).edgeJ.z0) crosses.push(j);
      const sbN = above ? superblock(xs[a].i, l, above) : null;
      roadLamps(K, 0, l.z, AVE.w, xa, xb, own, crosses, sbN ? lampColor(sbN) : LAMP, step);
      if (boulevardZ(l)) median(K, 0, l.z, xa, xb, own, sbN ? lampColor(sbN) : LAMP, step);
      lanes(K, 0, l.z, Math.max(xa, X0), Math.min(xb, X1));
      // crossings with the north-south avenues
      if (own(xa, l.z)) crossing(K, xa, l.z, AVE.w, AVE.w);
    }
  }
  // ---- inside the superblocks ----
  // the ground is painted by every piece it reaches (rasters spill 48 m over the edges); things
  // are made by the piece their centre is in
  const pad = TPAD * TPX + 4;
  const near = (x0, z0, x1, z1) => x1 > X0 - pad && x0 < X1 + pad && z1 > Z0 - pad && z0 < Z1 + pad;
  for (const sb of sbs) {
    const L = sbLayout(sb), lc = lampColor(sb), half = AVE.w / 2;
    if (sb.river) { riverRow(K, sb, X0, X1, Z0, Z1, own); continue; }
    const rx0 = sb.x0 + half, rz0 = sb.z0 + half, rx1 = sb.x1 - half, rz1 = sb.z1 - half;
    if (sb.kind === 'park' || sb.special) {
      const b = { x0: rx0, z0: rz0, x1: rx1, z1: rz1, cx: (rx0 + rx1) / 2, cz: (rz0 + rz1) / 2 };
      if (near(rx0, rz0, rx1, rz1)) (sb.special ? specialGround : parkGround)(K, sb, b);
      if (own(b.cx, b.cz)) { if (sb.special) keep(specialPlace(K, sb, b)); else park(K, sb, b); }
      continue;
    }
    const sstep = sb.kind === 'suburb' ? step * 2 : step;
    L.roads.forEach((road, k) => straightStreet(K, road, own, lc, sstep, pcg((sb.seed ^ pcg(k * 7 + 3)) >>> 0)));
    for (const c of L.crossings) if (own(c.x, c.z)) crossing(K, c.x, c.z, c.wx, c.wz);
    for (const blk of L.blocks) {
      const bb = polyBox(blk.poly);
      if (near(bb.x0, bb.z0, bb.x1, bb.z1)) blockGround(K, blk);
      if (own(blk.cx, blk.cz)) keep(genBlock(K, sb, blk));
    }
  }
  // searchlights from the tallest tower downtown
  if (tallest && tallest.H > 150 && ih2(cx, cz, 71) < 0.6) {
    K.reseed(pcg(cx * 7 + cz * 13 + 5));
    for (let k = 0; k < 2; k++)
      G.beam.push(TM.box(tallest.x, tallest.top + 1, tallest.z, 16, 1600, 16), [0.55, 0.65, 1.0, 0.022], [0, ANIM.beam, K.seed(), K.rng() * 6.3], [K.R(0.12, 0.25) * (k ? -1 : 1), K.R(0.35, 0.6), 0, 0]);
  }
  const out = { cx, cz, lod, groups: {}, boxes: new Float32Array(K.boxes), marks: K.marks };
  for (const g of GROUPS) out.groups[g] = G[g].data();
  if (full) {
    out.splats = new Float32Array(K.splats); out.lay = new Float32Array(K.lay); out.polys = new Float32Array(K.polys);
    out.mesh = chunkMesh(out.boxes, X0, Z0);
  }
  return out;
}

// ---------- the piece as libfpv collides with it: its boxes (without bottoms), its ground, the river ----------
// relative to the piece's centre; materials: 0 ground, 1 walls, 2 water (see source/fpv/host.c)
function chunkMesh(boxes, X0, Z0) {
  const ox = X0 + CHUNK / 2, oz = Z0 + CHUNK / 2, pos = [], idx = [], mat = [];
  const quad = (a, b, c, d, m) => {
    const o = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p[0] - ox, p[1], p[2] - oz);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    mat.push(m, m);
  };
  for (let i = 0; i < boxes.length; i += 8) {
    const [cx, cz, hx, hz, c, sn, y0, y1] = boxes.subarray(i, i + 8);
    // the corners of an oriented box (see makeKit): x = cx + lx*c + lz*s, z = cz - lx*s + lz*c
    const P = (lx, lz, y) => [cx + lx * c + lz * sn, y, cz - lx * sn + lz * c];
    const a0 = [-hx, -hz], a1 = [hx, -hz], a2 = [hx, hz], a3 = [-hx, hz];
    quad(P(...a0, y1), P(...a3, y1), P(...a2, y1), P(...a1, y1), 1);
    quad(P(...a3, y0), P(...a2, y0), P(...a2, y1), P(...a3, y1), 1);
    quad(P(...a1, y0), P(...a0, y0), P(...a0, y1), P(...a1, y1), 1);
    quad(P(...a2, y0), P(...a1, y0), P(...a1, y1), P(...a2, y1), 1);
    quad(P(...a0, y0), P(...a3, y0), P(...a3, y1), P(...a0, y1), 1);
  }
  const X1 = X0 + CHUNK, Z1 = Z0 + CHUNK;
  const r = riverAt(Z0 + CHUNK / 2) || riverAt(Z0) || riverAt(Z1);
  const hw = r ? r.hw + 0.5 : 0;
  const crosses = r && Math.max(r.zc - RIVER.amp - hw, Z0) < Math.min(r.zc + RIVER.amp + hw, Z1);
  if (!crosses) quad([X0, ROADY, Z0], [X0, ROADY, Z1], [X1, ROADY, Z1], [X1, ROADY, Z0], 0);
  else {
    const STEP = 16;
    for (let x = X0; x < X1; x += STEP) {
      const xa = x, xb = x + STEP, rzA = riverZk(r, xa), rzB = riverZk(r, xb);
      const na = clamp(rzA - hw, Z0, Z1), nb = clamp(rzB - hw, Z0, Z1), sa = clamp(rzA + hw, Z0, Z1), sb = clamp(rzB + hw, Z0, Z1);
      if (na > Z0 || nb > Z0) quad([xa, ROADY, Z0], [xa, ROADY, na], [xb, ROADY, nb], [xb, ROADY, Z0], 0);
      if (sa < Z1 || sb < Z1) quad([xa, ROADY, sa], [xa, ROADY, Z1], [xb, ROADY, Z1], [xb, ROADY, sb], 0);
      if (sa > na || sb > nb) quad([xa, RIVER.level, na], [xa, RIVER.level, sa], [xb, RIVER.level, sb], [xb, RIVER.level, nb], 2);
      if (rzA - hw > Z0 && rzA - hw < Z1) quad([xa, RIVER.level, na], [xb, RIVER.level, nb], [xb, ROADY, nb], [xa, ROADY, na], 0);
      if (rzA + hw > Z0 && rzA + hw < Z1) quad([xb, RIVER.level, sb], [xa, RIVER.level, sa], [xa, ROADY, sa], [xb, ROADY, sb], 0);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), materials: new Uint8Array(mat), origin: [ox, 0, oz] };
}

// ---------- the ground under a piece, rasterised here so the main thread only has to add them up ----------
// 2 m per pixel over the piece and 48 m around it (light spills over the edges): the light of lamps,
// shop windows and signs (16-bit, x2048), the footprints of buildings (for ambient occlusion), and the
// ground types: r type (255 = not painted here), g park paths, a ponds
const TILE = 128, TILES = 16, TPX = CHUNK / TILE, TPAD = 24, TP = TILE + 2 * TPAD;
function chunkRaster(out) {
  const X0 = out.cx * CHUNK - TPAD * TPX, Z0 = out.cz * CHUNK - TPAD * TPX;
  const light = new Float32Array(TP * TP * 3), foot = new Uint8Array(TP * TP), lay = new Uint8Array(TP * TP * 4);
  for (let i = 0; i < TP * TP; i++) lay[i * 4] = 255;
  const S = out.splats;
  for (let i = 0; i < S.length; i += 6) {
    const cx = (S[i] - X0) / TPX, cz = (S[i + 1] - Z0) / TPX, s = S[i + 5] / TPX, rr = Math.ceil(s * 2.6), k = 1 / (2 * s * s);
    for (let row = Math.max(0, Math.floor(cz - rr)); row <= Math.min(TP - 1, Math.ceil(cz + rr)); row++)
      for (let col = Math.max(0, Math.floor(cx - rr)); col <= Math.min(TP - 1, Math.ceil(cx + rr)); col++) {
        const dx = col + 0.5 - cx, dz = row + 0.5 - cz, w = Math.exp(-(dx * dx + dz * dz) * k), o = (row * TP + col) * 3;
        light[o] += S[i + 2] * w; light[o + 1] += S[i + 3] * w; light[o + 2] += S[i + 4] * w;
      }
  }
  // polygons: ground types (paving, lawns, concrete) and building footprints, in the order given
  const PL = out.polys;
  for (let i = 0; i < PL.length;) {
    const kind = PL[i], val = PL[i + 1], n = PL[i + 2], pts = [];
    for (let k = 0; k < n; k++) pts.push({ x: (PL[i + 3 + k * 2] - X0) / TPX, z: (PL[i + 4 + k * 2] - Z0) / TPX });
    i += 3 + n * 2;
    const b = polyBox(pts);
    for (let r = Math.max(0, Math.floor(b.z0)); r <= Math.min(TP - 1, Math.ceil(b.z1)); r++)
      for (let c = Math.max(0, Math.floor(b.x0)); c <= Math.min(TP - 1, Math.ceil(b.x1)); c++) {
        if (!insidePoly(pts, c + 0.5, r + 0.5)) continue;
        if (kind === 1) foot[r * TP + c] = 255; else lay[(r * TP + c) * 4] = val;
      }
  }
  const L = out.lay;
  for (let i = 0; i < L.length; i += 6) {
    const op = L[i];
    if (op === 0) {
      for (let r = Math.max(0, Math.round((L[i + 2] - Z0) / TPX)); r < Math.min(TP, Math.round((L[i + 4] - Z0) / TPX)); r++)
        for (let c = Math.max(0, Math.round((L[i + 1] - X0) / TPX)); c < Math.min(TP, Math.round((L[i + 3] - X0) / TPX)); c++) lay[(r * TP + c) * 4] = L[i + 5];
    } else {
      const x = L[i + 1], z = L[i + 2], rx = op === 1 ? L[i + 3] : L[i + 3], rz = op === 1 ? L[i + 3] : L[i + 4], soft = op === 1 ? 1.2 : 3;
      for (let r = Math.max(0, Math.floor((z - rz - soft - Z0) / TPX)); r <= Math.min(TP - 1, Math.ceil((z + rz + soft - Z0) / TPX)); r++)
        for (let c = Math.max(0, Math.floor((x - rx - soft - X0) / TPX)); c <= Math.min(TP - 1, Math.ceil((x + rx + soft - X0) / TPX)); c++) {
          const wx = X0 + (c + 0.5) * TPX, wz = Z0 + (r + 0.5) * TPX, o = (r * TP + c) * 4;
          if (op === 1) {
            const v = Math.round(255 * smooth(rx + soft, rx - soft, Math.hypot(wx - x, wz - z)));
            if (v > lay[o + 1]) lay[o + 1] = v;
          } else {
            const d = Math.hypot((wx - x) / rx, (wz - z) / rz) + 0.08 * Math.sin(Math.atan2(wz - z, wx - x) * 5);
            const v = Math.round(255 * smooth(1.02, 0.96, d));
            if (v > lay[o + 3]) lay[o + 3] = v;
          }
        }
    }
  }
  // the promenades along a river
  for (let r = 0; r < TP; r++) {
    const wz = Z0 + (r + 0.5) * TPX, rv = riverAt(wz);
    if (!rv || Math.abs(wz - rv.zc) > rv.row) continue;
    for (let c = 0; c < TP; c++) {
      const wx = X0 + (c + 0.5) * TPX, d = Math.abs(wz - riverZk(rv, wx));
      if (d > rv.hw && d < rv.hw + 11) lay[(r * TP + c) * 4] = 6;
    }
  }
  const l16 = new Uint16Array(TP * TP * 3);
  for (let i = 0; i < l16.length; i++) l16[i] = Math.min(65535, Math.round(light[i] * 2048));
  out.raster = { light: l16, foot, lay };
  delete out.splats; delete out.lay; delete out.polys;
}

// in a worker: make pieces on request, hand back their buffers
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const { id, cx, cz, lod, Q } = e.data;
    const out = genChunk(cx, cz, lod, Q);
    if (lod) chunkRaster(out);
    const tr = [out.boxes.buffer, ...GROUPS.map((g) => out.groups[g].buffer)];
    if (out.mesh) tr.push(out.mesh.positions.buffer, out.mesh.indices.buffer, out.mesh.materials.buffer);
    if (out.raster) tr.push(out.raster.light.buffer, out.raster.foot.buffer, out.raster.lay.buffer);
    self.postMessage({ id, out }, tr);
  };
}
