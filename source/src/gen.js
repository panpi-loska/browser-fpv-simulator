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
function makeKit(Q, full) {
  let rng = mulberry32(1), rd = mulberry32(2), seedN = 1;
  const R = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const Rd = (a, b) => a + (b - a) * rd(), pickd = (arr) => arr[Math.floor(rd() * arr.length)];
  const G = {}; for (const g of GROUPS) G[g] = new InstList();
  const boxes = [], splats = [], foot = [], lay = [], marks = [];
  const K = {
    G, boxes, splats, foot, lay, marks, full, Q,
    // every block (and every road) reseeds, so it comes out the same whichever piece asks
    reseed(s) { rng = mulberry32(s); rd = mulberry32((s ^ 0x5bd1e995) >>> 0); seedN = (s % 100000) * 64 + 1; },
    rng: () => rng(), rd: () => rd(), R, pick, Rd, pickd,
    seed: () => (seedN = (seedN + 1) % 16000000),
    // the ground light, ambient occlusion and ground types (rasterised on the main thread)
    splat(x, z, r, g, b, sigma) { if (full) splats.push(x, z, r, g, b, sigma); },
    footRect(x0, z0, x1, z1) { if (full) foot.push(x0, z0, x1, z1); },
    layRect(x0, z0, x1, z1, type) { if (full) lay.push(0, x0, z0, x1, z1, type); },
    layDisk(x, z, rad, ch) { if (full) lay.push(1, x, z, rad, ch, 0); },
    layPond(x, z, rx, rz) { if (full) lay.push(2, x, z, rx, rz, 0); },
    collider(x0, y0, z0, x1, y1, z1) { boxes.push(x0, y0, z0, x1, y1, z1); },
  };
  K.sprite = (x, y, z, col, inten, size, anim = 0, dir = 0, phase = 0, q = [0, 0, 0, 0]) =>
    G.sprite.push([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z], [col[0], col[1], col[2], inten], [size, anim, dir, phase], q);
  K.basic = (list, m, col, anim = 0, q, phase = 0) => list.push(m, [col[0], col[1], col[2], 0], [MAT.basic, anim, K.seed(), phase], q);
  K.emissive = (list, m, col, inten, anim = 0, q, phase = 0) => list.push(m, [col[0], col[1], col[2], inten], [MAT.emissive, anim, K.seed(), phase], q);
  K.streetLamp = (x, z, ox, oz, col = LAMP, h = 7) => {
    // pole at (x, z); the head reaches out over the road along (ox, oz). Far away only the light shows.
    const hx = x + ox * 1.4, hz = z + oz * 1.4;
    if (full) {
      K.basic(G.cyl, TM.box(x, h / 2, z, 0.22, h, 0.22), [0.06, 0.06, 0.07]);
      K.basic(G.cube, TM.box(x + ox * 0.7, h - 0.05, z + oz * 0.7, Math.abs(ox) * 1.4 + 0.12, 0.1, Math.abs(oz) * 1.4 + 0.12), [0.06, 0.06, 0.07]);
      K.emissive(G.cube, TM.box(hx, h - 0.15, hz, 0.7, 0.14, 0.4), col, 2.5);
    }
    K.sprite(hx, h - 0.3, hz, col, 5, 0.75);
    K.splat(hx, hz, col[0] * 0.95, col[1] * 0.95, col[2] * 0.95, 6.5);
  };
  K.tree = (x, z, s = 1, conifer = false) => {
    if (!full) return;
    const tint = pickd([[0.06, 0.1, 0.045], [0.05, 0.085, 0.05], [0.08, 0.1, 0.04], [0.045, 0.075, 0.06]]);
    K.basic(G.cyl, TM.box(x, 1.5 * s, z, 0.35 * s, 3 * s, 0.35 * s), [0.06, 0.04, 0.03]);
    if (conifer) G.cone.push(TM.box(x, 6 * s, z, 4.5 * s, 9 * s, 4.5 * s), [...tint, 0], [MAT.foliage, 0, K.seed(), 0]);
    else { const w = Rd(3.6, 5.2) * s; G.sphere.push(TM.box(x, 4.4 * s, z, w, w * Rd(0.8, 1.0), w), [...tint, 0], [MAT.foliage, 0, K.seed(), 0]); }
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
    G.cube.push(TM.box((a + c) / 2, (yb + yt) / 2, (b + d) / 2, c - a, yt - yb, d - b), [...wall, refl], [MAT.building, 0, seed, k === 0 ? shop : 0], [style, fh, cw, wx]);
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
  if (H > 140 && rd() < 0.6) {
    const c = pickd(NEON.slice(0, 4).concat([[0.9, 0.95, 1.0]])), it = Rd(3, 6);
    for (const s of [-1, 1]) {
      K.emissive(G.cube, TM.box(tcx, top - 0.4, tcz + s * td / 2, tw + 0.3, 0.5, 0.3), c, it);
      K.emissive(G.cube, TM.box(tcx + s * tw / 2, top - 0.4, tcz, 0.3, 0.5, td + 0.3), c, it);
    }
    if (rd() < 0.5) {
      const yb = tiers[tiers.length - 1][4];
      for (const [cx, cz] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) K.emissive(G.cube, TM.box(cx, (yb + top) / 2, cz, 0.35, top - yb, 0.35), c, it * 0.6);
    }
  }
  if (H > 200 && rd() < 0.75) {
    const sh = Rd(25, 70);
    K.basic(G.cyl, TM.box(tcx, top + sh / 2, tcz, 1.4, sh, 1.4), [0.3, 0.3, 0.32]);
    K.sprite(tcx, top + sh + 0.6, tcz, [1, 0.08, 0.04], 8, 1.2, ANIM.blink, 0, rd());
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
    G.cube.push(m, [...c, Rd(2, 3.5)], [MAT.neon, 0, K.seed(), 1]);
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
      if (m) { G.cube.push(m, [...c, Rd(2.5, 4.5)], [MAT.neon, 0, K.seed(), 0]); K.splat(m[3], m[11], c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 4); }
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
    ind: smooth(0.62, 0.78, vnoise(x / 1800 + 17.3, z / 1800 - 3.1)) * urban,
    old: smooth(0.61, 0.77, vnoise(x / 1500 - 41.7, z / 1500 + 9.2)) * urban,
    sub: smooth(0.46, 0.66, vnoise(x / 2600 + 5.5, z / 2600 + 77.1)) * (1 - smooth(0.0, 0.08, c)),
  };
}
function genBlock(K, sb, b) {
  K.reseed(b.seed);
  const { R, rd, Rd, Q } = K;
  const SW = 3.6, ix0 = b.x0 + SW, ix1 = b.x1 - SW, iz0 = b.z0 + SW, iz1 = b.z1 - SW;
  if (sb.kind === 'park') return park(K, sb, b);
  const mx = blockMix(b.cx, b.cz), c = mx.c, nlBase = nightlife(b.cx, b.cz);
  // each block draws its own lot, weighted by the fields (the same draw whoever asks)
  const r1 = ih(b.seed, 91), r2 = ih(b.seed, 92), r3 = ih(b.seed, 93);
  sidewalk(K, b.x0, b.z0, b.x1, b.z1);
  if (r1 < mx.ind) return industrialBlock(K, sb, b, ix0, iz0, ix1, iz1);
  if (r2 < mx.sub && ix1 - ix0 > 18 && iz1 - iz0 > 18) return suburbBlock(K, sb, b);
  const old = r3 < mx.old;
  // apartment blocks: towers downtown, falling off smoothly towards the suburbs
  const resH = (16 + vnoise(b.cx * 0.006, b.cz * 0.006) * 22) * (1 - 0.6 * mx.sub);
  const towers = 12 + 320 * Math.pow(c, 1.5) + vnoise(b.cx * 0.01, b.cz * 0.01) * 12;
  let H0, nl, maxLot, styleOpt = {}, irregular = 0, trees;
  if (old) {
    H0 = 17 + vnoise(b.cx * 0.02, b.cz * 0.02) * 8; nl = 0.55 + nlBase * 0.6; maxLot = 17; irregular = 0.12;
    styleOpt = { style: rd() < 0.7 ? 2 : 0, tiers: false }; trees = false;
  } else {
    H0 = Math.max(resH, towers);
    nl = towers > resH ? nlBase + (c > 0.42 ? 0.15 : 0) : 0.15 + nlBase * 0.35;
    maxLot = H0 > 170 ? 70 : H0 > 70 ? 40 : 28 - 6 * mx.sub; trees = H0 < 70;
  }
  const lc = lampColor(sb);
  if (trees && rd() < 0.8) {
    for (let x = b.x0 + 6; x < b.x1 - 5; x += 13) for (const z of [b.z0 + 1.6, b.z1 - 1.6]) if (rd() < 0.8 * Q.trees) K.tree(x + Rd(-1, 1), z, Rd(0.8, 1.1));
    for (let z = b.z0 + 6; z < b.z1 - 5; z += 13) for (const x of [b.x0 + 1.6, b.x1 - 1.6]) if (rd() < 0.8 * Q.trees) K.tree(x, z + Rd(-1, 1), Rd(0.8, 1.1));
  }
  if (K.rng() < 0.035 && H0 < 200) return plaza(K, ix0, iz0, ix1, iz1, lc);
  // building sites with their tower cranes; one is always beside Halvard Bay's downtown
  const forced = 430 >= b.x0 && 430 <= b.x1 && -430 >= b.z0 && -430 <= b.z1;
  if ((forced || (K.rng() < 0.07 && H0 > 45)) && !old && c > 0.12 && ix1 - ix0 > 30 && iz1 - iz0 > 30) {
    const s = constructionSite(K, ix0, iz0, Math.min(ix1, ix0 + 75), Math.min(iz1, iz0 + 75), H0);
    K.marks.push({ type: 'crane', x: s.x, y: s.top, z: s.z });
    return null;
  }
  const lots = [];
  splitLots(K, ix0, iz0, ix1, iz1, maxLot, 0, 15, lots, irregular);
  let tallest = null;
  for (const lot of lots) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 6 || d < 6) continue;
    if (K.rng() < 0.05) { if (rd() < Q.trees) K.tree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, Rd(0.9, 1.3)); continue; }
    let H = H0 * (0.3 + 0.95 * Math.pow(K.rng(), 1.3));
    if (H0 > 120 && K.rng() < 0.06) H *= 1.4;
    H = Math.max(Math.min(H, Math.max(w, d) * 7.5), old ? R(9, 12) : R(7, 13));
    const g = old ? 0 : H0 > 60 ? R(1.5, 4) : K.rng() < 0.5 ? 0 : R(1, 2.5);
    const opt = { ...styleOpt };
    if (old) opt.shop = clamp(nl + R(-0.2, 0.3), 0.2, 1);
    const bld = K.building(lot.x0 + g / 2, lot.z0 + g / 2, lot.x1 - g / 2, lot.z1 - g / 2, H, lot.sides, nl, H0, opt);
    if (bld && (!tallest || bld.H > tallest.H)) tallest = bld;
  }
  return tallest;
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
  return null;
}

// a park: lawns, winding paths with lamps, a pond, trees
function park(K, sb, b) {
  const { G, R, rd, Rd, Q } = K;
  sidewalk(K, b.x0, b.z0, b.x1, b.z0 + 4); sidewalk(K, b.x0, b.z1 - 4, b.x1, b.z1);
  sidewalk(K, b.x0, b.z0 + 4, b.x0 + 4, b.z1 - 4); sidewalk(K, b.x1 - 4, b.z0 + 4, b.x1, b.z1 - 4);
  K.layRect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, 2);
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const pond = { x: b.cx + R(-0.15, 0.15) * w, z: b.cz + R(-0.15, 0.15) * d, rx: w * R(0.12, 0.22), rz: d * R(0.12, 0.22) };
  K.layPond(pond.x, pond.z, pond.rx, pond.rz);
  const inPond = (x, z) => ((x - pond.x) / pond.rx) ** 2 + ((z - pond.z) / pond.rz) ** 2 < 1.3;
  const paths = [];
  for (let k = 0; k < 4; k++) {
    const horizontal = k % 2 === 0, ph = R(0, 6), amp = R(10, 30), off = R(-0.3, 0.3) * (horizontal ? d : w);
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = lerp(horizontal ? b.x0 + 4 : b.z0 + 4, horizontal ? b.x1 - 4 : b.z1 - 4, t);
      const v = (horizontal ? b.cz : b.cx) + off + Math.sin(t * 7 + ph) * amp;
      const [x, z] = horizontal ? [u, v] : [v, u];
      if (inPond(x, z)) continue;
      paths.push([x, z]);
      K.layDisk(x, z, 2.0, 1);
      if (Math.round(t * 50) % 5 === 0) {
        K.basic(G.cyl, TM.box(x + 3, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]);
        K.emissive(G.sphere, TM.box(x + 3, 4.2, z, 0.55, 0.55, 0.55), LAMP, 2.5);
        K.sprite(x + 3, 4.2, z, LAMP, 4, 0.7);
        K.splat(x + 3, z, 0.75, 0.55, 0.34, 5);
      }
    }
  }
  const n = ((w * d) / 140) * Q.trees;
  for (let k = 0; k < n; k++) {
    const x = Rd(b.x0 + 7, b.x1 - 7), z = Rd(b.z0 + 7, b.z1 - 7);
    if (inPond(x, z) || paths.some(([px, pz]) => Math.abs(px - x) < 4 && Math.abs(pz - z) < 4)) continue;
    K.tree(x, z, Rd(0.9, 1.6), rd() < 0.25);
  }
  return null;
}

// industry: warehouses and sheds, tanks, chimneys, yards under white mercury lamps
function industrialBlock(K, sb, b, ix0, iz0, ix1, iz1) {
  const { G, R, rd, Rd, pickd } = K;
  K.layRect(ix0, iz0, ix1, iz1, 0);
  const lots = [];
  splitLots(K, ix0, iz0, ix1, iz1, 75, 0, 15, lots, 0.05);
  for (const lot of lots) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0, cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    if (w < 14 || d < 14) continue;
    const r = K.rng();
    if (r < 0.55) {
      // a warehouse: long, low, few windows, a lit loading door or two
      const g = R(4, 9), H = R(8, 17);
      const wall = pickd([[0.32, 0.33, 0.34], [0.22, 0.26, 0.3], [0.35, 0.3, 0.24], [0.15, 0.17, 0.2]]);
      K.building(lot.x0 + g, lot.z0 + g, lot.x1 - g, lot.z1 - g, H, lot.sides, 0.05, H, { style: 3, wall, wx: 0.3, shop: 0.05, tiers: false, fh: R(4.5, 6) });
      for (const s of [lot.z0 + g, lot.z1 - g]) if (rd() < 0.5) {
        const dx = Rd(lot.x0 + g + 4, lot.x1 - g - 4);
        K.emissive(G.cube, TM.box(dx, 2.4, s, 4.5, 4.8, 0.3), [0.9, 0.85, 0.7], 0.8);
        K.splat(dx, s + (s > cz ? 4 : -4), 0.45, 0.5, 0.45, 6);
      }
      // a white lamp over the yard
      K.basic(G.cyl, TM.box(lot.x0 + 2, 6, lot.z0 + 2, 0.3, 12, 0.3), [0.12, 0.12, 0.13]);
      K.sprite(lot.x0 + 2, 12, lot.z0 + 2, MERCURY, 6, 1.0);
      K.splat(lot.x0 + 4, lot.z0 + 4, 0.6, 0.85, 0.72, 11);
    } else if (r < 0.78) {
      // storage tanks with a ring of lights and a catwalk
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
      const g = R(5, 10), H = R(14, 26);
      K.building(lot.x0 + g, lot.z0 + g, lot.x1 - g, lot.z1 - g, H, lot.sides, 0.05, H, { style: 2, wall: [0.28, 0.17, 0.12], wx: 0.5, shop: 0.05, tiers: false, roof: false });
      const ch = R(38, 75), x = lot.x1 - g - 3, z = lot.z0 + g + 3;
      K.basic(G.cyl, TM.box(x, ch / 2, z, 3.2, ch, 3.2), [0.3, 0.22, 0.18]);
      for (const y of [ch * 0.5, ch - 2]) K.basic(G.cyl, TM.box(x, y, z, 3.5, 0.6, 3.5), [0.6, 0.6, 0.6]);
      K.collider(x - 1.4, 0, z - 1.4, x + 1.4, ch, z + 1.4);
      K.sprite(x, ch + 0.6, z, [1, 0.08, 0.04], 7, 1.0, ANIM.blink, 0, rd());
      K.sprite(x, ch * 0.5, z + 1.8, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
    }
  }
  return null;
}

// the suburbs: houses with pitched roofs and gardens, few lamps, lots of trees
function suburbBlock(K, sb, b) {
  const { G, R, rd, Rd, pickd, Q } = K;
  K.layRect(b.x0 + 3.6, b.z0 + 3.6, b.x1 - 3.6, b.z1 - 3.6, 2);
  const lots = [];
  splitLots(K, b.x0 + 3.6, b.z0 + 3.6, b.x1 - 3.6, b.z1 - 3.6, 22, 0, 15, lots, 0.05);
  for (const lot of lots) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 9 || d < 9) continue;
    if (K.rng() < 0.12) { K.tree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, Rd(1, 1.5), rd() < 0.4); continue; }
    const hw = Math.min(w - 4, R(8, 12)) / 2, hd = Math.min(d - 4, R(7, 10)) / 2, H = K.rng() < 0.3 ? R(6, 7) : R(3.2, 3.6);
    const cx = (lot.x0 + lot.x1) / 2 + R(-1, 1), cz = (lot.z0 + lot.z1) / 2 + R(-1, 1);
    // the house itself (one or two floors, exactly: building() would make it at least two)
    const style = K.rng() < 0.5 ? 0 : 2, wall = style ? [R(0.3, 0.42), R(0.14, 0.2), R(0.08, 0.12)] : [R(0.38, 0.55), R(0.36, 0.5), R(0.32, 0.44)];
    G.cube.push(TM.box(cx, H / 2, cz, hw * 2, H, hd * 2), [...wall, 0.25], [MAT.building, 0, Math.floor(K.rng() * 16000000), 0], [style, H > 5 ? H / 2 : H, R(2.6, 3.4), 0.45]);
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
    if (rd() < 0.3) K.splat(cx, cz + hd + 2, 0.35, 0.25, 0.15, 3);
    if (rd() < 0.7 * Q.trees) K.tree(lot.x0 + Rd(1.5, 3), lot.z0 + Rd(1.5, 3), Rd(0.8, 1.3), rd() < 0.3);
  }
  return null;
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
      const za = rz(x) + s * (RIVER.hw + 0.75), zb = rz(x + 8) + s * (RIVER.hw + 0.75), zc = (za + zb) / 2;
      if (zc < Z0 || zc >= Z1) continue;
      K.basic(G.cube, TM.yaw(x + 4, -1.2, zc, 8.3, 4.0, 1.5, -Math.atan2(zb - za, 8)), [0.12, 0.11, 0.1]);
    }
  if (sb.kind === 'riverside') {
    for (let x = Math.ceil((Math.max(x0, X0) - 8) / 24) * 24 + 8; x < Math.min(x1 - 4, X1); x += 24)
      for (const s of [-1, 1]) {
        const z = rz(x) + s * (RIVER.hw + 3);
        if (z < Z0 || z >= Z1 || x < x0 + 4) continue;
        if (K.full) { K.basic(G.cyl, TM.box(x, 2.2, z, 0.16, 4.4, 0.16), [0.05, 0.05, 0.06]); K.emissive(G.sphere, TM.box(x, 4.6, z, 0.6, 0.6, 0.6), LAMP, 2.5); }
        K.sprite(x, 4.6, z, LAMP, 4.5, 0.7);
        K.splat(x, z, 0.8, 0.58, 0.36, 5.5);
      }
  }
  // the rest belongs to the piece holding the row's centre
  if (!own(sb.cx, r.zc)) return;
  K.reseed(sb.seed ^ 0x51ed270b);
  sidewalk(K, x0, z0, x1, z0 + 4);
  sidewalk(K, x0, z1 - 4, x1, z1);
  K.layRect(x0, z0, x1, z1, sb.kind === 'docks' ? 0 : 2);
  if (sb.kind === 'riverside') {
    for (let k = 0, n = ((x1 - x0) / 9) * Q.trees; k < n; k++) {
      const x = Rd(x0 + 3, x1 - 3), s = rd() < 0.5 ? -1 : 1, zr = rz(x);
      const z = s < 0 ? Rd(z0 + 7, zr - RIVER.hw - 14) : Rd(zr + RIVER.hw + 14, z1 - 7);
      K.tree(x, z, Rd(0.9, 1.4), rd() < 0.2);
    }
    const wheelHere = r.k === 0 ? x0 < 430 && x1 > 430 : ih(sb.seed, 44) < 0.12;
    if (wheelHere) {
      const px = (x0 + x1) / 2, pz = (z0 + 4 + rz(px) - RIVER.hw - 11) / 2;
      ferrisWheel(K, px, pz);
      K.marks.push({ type: 'wheel', x: px, y: 38, z: pz });
    }
    return;
  }
  // docks: quays both sides, container stacks, gantry cranes along the water, a ship or two
  for (const s of [-1, 1]) {
    const edge = (x) => rz(x) + s * (RIVER.hw + 1.5), back = s < 0 ? z0 + 6 : z1 - 6;
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
    // container stacks between the cranes and the drive
    const zA = Math.min(edge(x0) - s * 34, back), zB = Math.max(edge(x0) - s * 34, back);
    for (let x = x0 + 8; x < x1 - 14; x += 14) {
      for (let z = Math.min(zA, zB) + 2; z < Math.max(zA, zB) - 4; z += 3.2) {
        if (K.rng() < 0.25) continue;
        const n = 1 + Math.floor(K.rng() * 4), col = pick([[0.5, 0.08, 0.05], [0.08, 0.25, 0.45], [0.55, 0.4, 0.05], [0.12, 0.35, 0.15], [0.45, 0.45, 0.47], [0.6, 0.2, 0.05]]);
        for (let k = 0; k < n; k++) K.basic(G.cube, TM.box(x + 6, 1.3 + k * 2.6, z, 12, 2.55, 2.45), [col[0] * (0.8 + 0.3 * rd()), col[1] * (0.8 + 0.3 * rd()), col[2] * (0.8 + 0.3 * rd())]);
        K.collider(x, 0, z - 1.2, x + 12, n * 2.6, z + 1.2);
      }
      if (Math.round(x) % 56 < 14) { K.basic(G.cyl, TM.box(x, 9, back, 0.4, 18, 0.4), [0.12, 0.12, 0.13]); K.sprite(x, 18, back, MERCURY, 7, 1.3); K.splat(x, back - s * 10, 0.55, 0.8, 0.7, 16); }
    }
    // a ship moored at the quay, clear of the bridges
    if (K.rng() < 0.7 && x1 - x0 > 240) {
      const L = R(110, Math.min(170, x1 - x0 - 90)), cx = (x0 + x1) / 2 + R(-20, 20), zc = rz(cx) + s * (RIVER.hw - 12);
      const hull = pick([[0.12, 0.13, 0.15], [0.35, 0.08, 0.06], [0.08, 0.15, 0.25]]);
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
function lane(K, axis, coord, dir, lo, hi) {
  const { G } = K, speed = 9 + 7 * ih(Math.round(coord * 4), dir > 0 ? 81 : 82);
  const q = axis === 0 ? [coord, lo, hi, dir * speed] : [coord, hi, lo, dir * speed];
  for (let i = 0, n = Math.ceil((hi - lo) / CAR_STEP) + 1; i < n; i++) {
    // body (p.z = 1: coloured by the shader), cabin, headlights, tail lights
    G.cube.push(TM.box(0, 0.72, 0, 4.4, 0.78, 1.86), [0.3, 0.3, 0.3, 0], [MAT.basic, ANIM.car, 1, i], q);
    G.cube.push(TM.box(-0.3, 1.38, 0, 2.3, 0.58, 1.62), [0.02, 0.022, 0.026, 0], [MAT.basic, ANIM.car, 0, i], q);
    for (const z of [-0.62, 0.62]) { K.sprite(2.22, 0.78, z, [1, 0.92, 0.8], 4, 0.35, ANIM.car, 1, i, q); K.sprite(-2.22, 0.85, z, [1, 0.06, 0.03], 3, 0.3, ANIM.car, -1, i, q); }
  }
}
// both directions of an avenue over [lo, hi); right-hand traffic: driving +x keeps to +z, driving +z keeps to -x
function lanes(K, axis, coord, lo, hi) {
  if (!K.full || hi - lo < 1) return;
  for (const o of [2.2, 5.8]) {
    if (axis === 0) { lane(K, 0, coord + o, 1, lo, hi); lane(K, 0, coord - o, -1, lo, hi); }
    else { lane(K, 1, coord - o, 1, lo, hi); lane(K, 1, coord + o, -1, lo, hi); }
  }
}
// side streets end at the avenues, so their cars are parked along the kerbs
function parked(K, axis, coord, w, lo, hi, own, seed, crosses) {
  if (!K.full) return;
  K.reseed(seed);
  const { G, rd, Rd, pickd, Q } = K, every = Q.carGap * 0.35 + 6;
  for (const side of [-1, 1]) {
    const off = coord + side * (w / 2 - 1.2);
    for (let s = lo + 9 + Rd(0, every); s < hi - 9; s += every * Rd(0.5, 1.5) + 5.5) {
      const [x, z] = axis === 0 ? [s, off] : [off, s];
      if (!own(x, z) || rd() < 0.25 || crosses.some((c) => Math.abs(s - c) < w / 2 + 6)) continue;
      const col = rd() < 0.08 ? [0.75, 0.55, 0.05] : pickd(CARS), yaw = axis === 0 ? 0 : Math.PI / 2;
      K.basic(G.cube, TM.yaw(x, 0.72, z, 4.4, 0.78, 1.86, yaw), col);
      K.basic(G.cube, TM.yaw(axis === 0 ? x - 0.3 : x, 1.38, axis === 0 ? z : z + 0.3, 2.3, 0.58, 1.62, yaw), [0.02, 0.022, 0.026]);
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

// ---------- bridges and the elevated train ----------
function bridge(K, x, r, w, grand, own) {
  const { G } = K, W = w + 2.4, rz = riverZk(r, x), zA = rz - RIVER.hw - RIVER.ramp, zB = rz + RIVER.hw + RIVER.ramp;
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
  for (let z = rz - RIVER.hw + 14; z < rz + RIVER.hw - 10; z += grand ? 200 : 30) {
    if (!own(x, z)) continue;
    K.basic(G.cyl, TM.box(x, (ROADY + RIVER.h - 1.2 - 3) / 2, z, 3.2, ROADY + RIVER.h - 1.2 + 3, 5), [0.1, 0.1, 0.1]);
    K.collider(x - 1.4, -3, z - 2.3, x + 1.4, ROADY + RIVER.h - 1.2, z + 2.3);
  }
  for (let z = zA + 20; z < zB - 10; z += 26)
    for (const s of [-1, 1]) {
      const lxp = x + s * (W / 2 - 0.2), y = ROADY + bridgeH(x, z);
      if (!own(lxp, z)) continue;
      if (K.full) { K.basic(G.cyl, TM.box(lxp, y + 2.6, z, 0.16, 5.2, 0.16), [0.08, 0.08, 0.09]); K.emissive(G.sphere, TM.box(lxp - s * 0.2, y + 5.1, z, 0.5, 0.5, 0.5), grand ? [0.75, 0.85, 1.0] : LAMP, 2); }
      K.sprite(lxp - s * 0.4, y + 5.1, z, grand ? [0.75, 0.85, 1.0] : LAMP, 4, 0.6);
    }
  if (!grand || !own(x, rz)) return;
  // the suspension bridge: two towers, main cables strung with lights, suspenders down to the deck
  const deckY = ROADY + RIVER.h, top = 58, zt = [rz - RIVER.hw + 10, rz + RIVER.hw - 10], legX = [x - W / 2 - 1.3, x + W / 2 + 1.3];
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
// an elevated line runs above some avenues, from one riverside (or slot) to the next;
// its trains loop along that stretch (ANIM.train), stations at both ends
const hasTrain = (i) => i === -1 || (i !== 0 && ih(i, 61) < 0.16);
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
  // ---- north-south avenues (constant x) ----
  for (let a = 0; a < xs.length; a++) {
    const { i, x } = xs[a];
    if (x < X0 || x >= X1) continue;
    for (let b = 0; b + 1 < zs.length; b++) {
      const A = zs[b], B = zs[b + 1];
      if (B.z < Z0 - 400 || A.z > Z1 + 400) continue;
      const r = A.kind === 'n' ? riverSlot(A.k) : null;
      if (r) {
        const rz = riverZk(r, x), zA = rz - RIVER.hw - RIVER.ramp, zB = rz + RIVER.hw + RIVER.ramp;
        roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(zA, Z1));
        roadStrip(K, 1, x, AVE.w, 2, Math.max(zB, Z0), Math.min(B.z, Z1));
        bridge(K, x, r, AVE.w, (i === 0 && r.k === 0) || (i !== 0 && ih2(i, r.k, 62) < 0.1), own);
      } else roadStrip(K, 1, x, AVE.w, 2, Math.max(A.z, Z0), Math.min(B.z, Z1));
      // the streets of the superblocks either side end on this stretch: no lamps across their mouths
      const crosses = [{ pos: A.z, w: AVE.w }, { pos: B.z, w: AVE.w }];
      for (const nb of [a > 0 ? superblock(xs[a - 1].i, A, B) : null, superblock(i, A, B)]) if (nb) for (const z of sbStreets(nb).hs) crosses.push({ pos: z, w: sbStreets(nb).sw });
      if (r) {
        const rz = riverZk(r, x);
        roadLamps(K, 1, x, AVE.w, A.z, rz - RIVER.hw - RIVER.ramp, own, crosses, LAMP, step);
        roadLamps(K, 1, x, AVE.w, rz + RIVER.hw + RIVER.ramp, B.z, own, crosses, LAMP, step);
      } else roadLamps(K, 1, x, AVE.w, A.z, B.z, own, crosses, lampColor(superblock(i, A, B)), step);
      lanes(K, 1, x, Math.max(A.z, Z0), Math.min(B.z, Z1));
    }
  }
  // ---- elevated lines, from one river slot to the next ----
  for (const { i, x } of xs) {
    if (x < X0 || x >= X1 || !hasTrain(i)) continue;
    for (let k = riverK(Z0) - 1; k <= riverK(Z1) + 1; k++) {
      const a = riverSlot(k), b = riverSlot(k + 1), za = a.zc + (a.on ? RIVER.row : 0), zb = b.zc - (b.on ? RIVER.row : 0);
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
      for (const [A, B] of [[below, l], [l, above]]) if (A && B) { const nb = superblock(xs[a].i, A, B); for (const x of sbStreets(nb).vs) crosses.push({ pos: x, w: sbStreets(nb).sw }); }
      const sbN = above ? superblock(xs[a].i, l, above) : null;
      roadLamps(K, 0, l.z, AVE.w, xa, xb, own, crosses, sbN ? lampColor(sbN) : LAMP, step);
      lanes(K, 0, l.z, Math.max(xa, X0), Math.min(xb, X1));
      // crossings with the north-south avenues
      if (own(xa, l.z)) crossing(K, xa, l.z, AVE.w, AVE.w);
    }
  }
  // ---- inside the superblocks ----
  for (const sb of sbs) {
    const L = sbStreets(sb), half = AVE.w / 2, lc = lampColor(sb);
    if (sb.river) { riverRow(K, sb, X0, X1, Z0, Z1, own); continue; }
    for (const x of L.vs) {
      if (x >= X0 && x < X1) {
        roadStrip(K, 1, x, L.sw, 1, Math.max(sb.z0 + half, Z0), Math.min(sb.z1 - half, Z1));
        const crosses = L.hs.map((z) => ({ pos: z, w: L.sw }));
        roadLamps(K, 1, x, L.sw, sb.z0 + half, sb.z1 - half, own, crosses, lc, sb.kind === 'suburb' ? step * 2 : step);
        if (own(x, sb.z0)) crossing(K, x, sb.z0, L.sw, AVE.w);
        if (own(x, sb.z1)) crossing(K, x, sb.z1, L.sw, AVE.w);
      }
      parked(K, 1, x, L.sw, sb.z0 + half, sb.z1 - half, own, pcg(sb.seed ^ Math.round(x)), L.hs);
    }
    for (const z of L.hs) {
      if (z >= Z0 && z < Z1) {
        roadStrip(K, 0, z, L.sw, 1, Math.max(sb.x0 + half, X0), Math.min(sb.x1 - half, X1));
        const crosses = L.vs.map((x) => ({ pos: x, w: L.sw }));
        roadLamps(K, 0, z, L.sw, sb.x0 + half, sb.x1 - half, own, crosses, lc, sb.kind === 'suburb' ? step * 2 : step);
        if (own(sb.x0, z)) crossing(K, sb.x0, z, AVE.w, L.sw);
        if (own(sb.x1, z)) crossing(K, sb.x1, z, AVE.w, L.sw);
        for (const x of L.vs) if (own(x, z)) crossing(K, x, z, L.sw, L.sw);
      }
      parked(K, 0, z, L.sw, sb.x0 + half, sb.x1 - half, own, pcg(sb.seed ^ Math.round(z * 3)), L.vs);
    }
    for (const b of L.blocks) if (own(b.cx, b.cz)) keep(genBlock(K, sb, b));
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
    out.splats = new Float32Array(K.splats); out.foot = new Float32Array(K.foot); out.lay = new Float32Array(K.lay);
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
  for (let i = 0; i < boxes.length; i += 6) {
    const [x0, y0, z0, x1, y1, z1] = boxes.subarray(i, i + 6);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 1);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 1);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 1);
  }
  const X1 = X0 + CHUNK, Z1 = Z0 + CHUNK;
  const r = riverAt(Z0 + CHUNK / 2) || riverAt(Z0) || riverAt(Z1);
  const hw = RIVER.hw + 0.5;
  const crosses = r && Math.max(r.zc - 30 - hw, Z0) < Math.min(r.zc + 30 + hw, Z1);
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
  const F = out.foot;
  for (let i = 0; i < F.length; i += 4)
    for (let r = Math.max(0, Math.floor((F[i + 1] - Z0) / TPX)); r < Math.min(TP, Math.ceil((F[i + 3] - Z0) / TPX)); r++)
      for (let c = Math.max(0, Math.floor((F[i] - X0) / TPX)); c < Math.min(TP, Math.ceil((F[i + 2] - X0) / TPX)); c++) foot[r * TP + c] = 255;
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
    if (!rv || Math.abs(wz - rv.zc) > RIVER.row) continue;
    for (let c = 0; c < TP; c++) {
      const wx = X0 + (c + 0.5) * TPX, d = Math.abs(wz - riverZk(rv, wx));
      if (d > RIVER.hw && d < RIVER.hw + 11) lay[(r * TP + c) * 4] = 6;
    }
  }
  const l16 = new Uint16Array(TP * TP * 3);
  for (let i = 0; i < l16.length; i++) l16[i] = Math.min(65535, Math.round(light[i] * 2048));
  out.raster = { light: l16, foot, lay };
  delete out.splats; delete out.foot; delete out.lay;
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
