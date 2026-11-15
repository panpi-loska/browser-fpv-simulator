// ---------------------------------------------------------------------------
// world.js: the city layout. Streets, blocks, towers, the river and its bridges, the park,
// traffic, the elevated train, the ferris wheel, the blimp and the baked ground light.
// A good place to start.
// ---------------------------------------------------------------------------

const WORLD = 1500;                 // the city spans -WORLD..WORLD on x and z (meters)
const RIVER = { z: 150, hw: 55, ramp: 45, h: 7, level: -0.8 };
const ROADY = 0.1;                  // top of the asphalt
const TRAIN_Y = 14;                 // top of the elevated track
const BLIMP_Y = 270;
const LAYOUT_N = 2048, LIGHT_N = 1024;
const MAT = { basic: 0, building: 1, emissive: 2, road: 3, sidewalk: 4, foliage: 5, neon: 7, train: 8 };
const ANIM = { none: 0, car: 1, train: 2, wheel: 3, gondola: 4, blink: 5, blimp: 6, beam: 7, slew: 8 };

function riverZ(x) { return RIVER.z + 10 * Math.sin(x * 0.0023 + 0.7) + 5 * Math.sin(x * 0.0061); }
function bridgeH(x, z) {
  const d = Math.abs(z - riverZ(x)) - RIVER.hw, k = clamp(1 - d / RIVER.ramp, 0, 1);
  return RIVER.h * k * k * (3 - 2 * k);
}
// how tall the city wants to be here: downtown north of the river, two smaller centres south of it
function skylineAt(x, z) {
  const g = (cx, cz, s, h) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (s * s));
  return 10 + g(150, -380, 430, 330) + g(-750, 650, 300, 150) + g(900, 820, 260, 95) + g(-1000, -900, 260, 60);
}

// growable list of instances, 24 floats each: 3x4 transform, color, p, q
class InstList {
  constructor() { this.a = new Float32Array(24 * 4096); this.n = 0; }
  push(m, c, p, q = [0, 0, 0, 0]) {
    if ((this.n + 1) * 24 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, o = this.n * 24;
    for (let i = 0; i < 12; i++) a[o + i] = m[i];
    a[o + 12] = c[0]; a[o + 13] = c[1]; a[o + 14] = c[2]; a[o + 15] = c[3];
    a[o + 16] = p[0]; a[o + 17] = p[1]; a[o + 18] = p[2]; a[o + 19] = p[3];
    a[o + 20] = q[0]; a[o + 21] = q[1]; a[o + 22] = q[2]; a[o + 23] = q[3];
    this.n++;
  }
  data() { return this.a.subarray(0, this.n * 24); }
}

// the elevated train runs a rounded rectangle; the same path is written in WGSL (shaders.js)
function trainPath(T, s0) {
  const { cx, cz, hx, hz, r } = T, a = 2 * (hx - r), b = 2 * (hz - r), c = (Math.PI / 2) * r, L = 2 * a + 2 * b + 4 * c;
  let s = s0 - Math.floor(s0 / L) * L;
  const x0 = cx - hx + r, x1 = cx + hx - r, z0 = cz - hz + r, z1 = cz + hz - r;
  const arc = (ox, oz, ang) => [ox + r * Math.cos(ang), oz + r * Math.sin(ang), -Math.sin(ang), Math.cos(ang)];
  if (s < a) return [x0 + s, cz - hz, 1, 0]; s -= a;
  if (s < c) return arc(x1, z0, -Math.PI / 2 + s / r); s -= c;
  if (s < b) return [cx + hx, z0 + s, 0, 1]; s -= b;
  if (s < c) return arc(x1, z1, s / r); s -= c;
  if (s < a) return [x1 - s, cz + hz, -1, 0]; s -= a;
  if (s < c) return arc(x0, z1, Math.PI / 2 + s / r); s -= c;
  if (s < b) return [cx - hx, z1 - s, 0, -1]; s -= b;
  return arc(x0, z0, Math.PI + s / r);
}
function trainLength(T) { return 4 * (T.hx - T.r) + 4 * (T.hz - T.r) + 2 * Math.PI * T.r; }


// ---------------------------------------------------------------------------
// The toolkit the city is built with: seeded random numbers, instance lists, ground textures
// (layout and baked light), colliders, and the pieces they share (lamps, trees, buildings).
// ---------------------------------------------------------------------------
function makeKit(Q, progress, seedA, seedB) {
  const rng = mulberry32(seedA);
  const R = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // decorations that depend on the detail level draw from their own stream, so every level is the same city
  const rd = mulberry32(seedB), Rd = (a, b) => a + (b - a) * rd(), pickd = (arr) => arr[Math.floor(rd() * arr.length)];
  const tick = async (f, label) => { progress(f, label); await new Promise((r) => setTimeout(r, 0)); };

  const G = { cube: new InstList(), cyl: new InstList(), sphere: new InstList(), cone: new InstList(), beam: new InstList(), sprite: new InstList() };
  const layout = new Uint8Array(LAYOUT_N * LAYOUT_N * 4);
  const light = new Float32Array(LIGHT_N * LIGHT_N * 3);
  const foot = new Float32Array(LIGHT_N * LIGHT_N);
  const boxes = [];
  let seedN = 1;

  // ---------- rasterising into the ground textures ----------
  const lx = (x) => (x / (2 * WORLD) + 0.5) * LAYOUT_N;
  function layRect(x0, z0, x1, z1, type) {
    const c0 = Math.max(0, Math.round(lx(x0))), c1 = Math.min(LAYOUT_N, Math.round(lx(x1)));
    const r0 = Math.max(0, Math.round(lx(z0))), r1 = Math.min(LAYOUT_N, Math.round(lx(z1)));
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) layout[(r * LAYOUT_N + c) * 4] = type;
  }
  function layDisk(x, z, rad, ch, soft = 1.2) {
    const px = LAYOUT_N / (2 * WORLD), cx = lx(x), cz = lx(z), rr = (rad + soft) * px;
    for (let r = Math.max(0, Math.floor(cz - rr)); r <= Math.min(LAYOUT_N - 1, Math.ceil(cz + rr)); r++)
      for (let c = Math.max(0, Math.floor(cx - rr)); c <= Math.min(LAYOUT_N - 1, Math.ceil(cx + rr)); c++) {
        const d = Math.hypot(c + 0.5 - cx, r + 0.5 - cz) / px, v = Math.round(255 * smooth(rad + soft, rad - soft, d));
        const i = (r * LAYOUT_N + c) * 4 + ch;
        if (v > layout[i]) layout[i] = v;
      }
  }
  const ll = (x) => (x / (2 * WORLD) + 0.5) * LIGHT_N;
  function splat(x, z, r, g, b, sigma) {
    const px = LIGHT_N / (2 * WORLD), cx = ll(x), cz = ll(z), s = sigma * px, rr = Math.ceil(s * 2.6), k = 1 / (2 * s * s);
    for (let row = Math.max(0, Math.floor(cz - rr)); row <= Math.min(LIGHT_N - 1, Math.ceil(cz + rr)); row++)
      for (let col = Math.max(0, Math.floor(cx - rr)); col <= Math.min(LIGHT_N - 1, Math.ceil(cx + rr)); col++) {
        const dx = col + 0.5 - cx, dz = row + 0.5 - cz, w = Math.exp(-(dx * dx + dz * dz) * k), i = (row * LIGHT_N + col) * 3;
        light[i] += r * w; light[i + 1] += g * w; light[i + 2] += b * w;
      }
  }
  function footRect(x0, z0, x1, z1) {
    for (let r = Math.max(0, Math.floor(ll(z0))); r < Math.min(LIGHT_N, Math.ceil(ll(z1))); r++)
      for (let c = Math.max(0, Math.floor(ll(x0))); c < Math.min(LIGHT_N, Math.ceil(ll(x1))); c++) foot[r * LIGHT_N + c] = 1;
  }

  // ---------- small helpers that place things ----------
  const sprite = (x, y, z, col, inten, size, anim = 0, dir = 0, phase = 0, q = [0, 0, 0, 0]) =>
    G.sprite.push([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z], [col[0], col[1], col[2], inten], [size, anim, dir, phase], q);
  const basic = (list, m, col, anim = 0, q, phase = 0) => list.push(m, [col[0], col[1], col[2], 0], [MAT.basic, anim, seedN++, phase], q);
  const emissive = (list, m, col, inten, anim = 0, q, phase = 0) => list.push(m, [col[0], col[1], col[2], inten], [MAT.emissive, anim, seedN++, phase], q);
  const collider = (x0, y0, z0, x1, y1, z1) => boxes.push(x0, y0, z0, x1, y1, z1);
  const LAMP = [1.0, 0.72, 0.44];
  const NEON = [[0.2, 0.9, 1.0], [1.0, 0.2, 0.75], [1.0, 0.55, 0.15], [0.5, 0.35, 1.0], [0.3, 1.0, 0.5], [1.0, 0.15, 0.2], [1.0, 0.9, 0.4]];

  function streetLamp(x, z, ox, oz, h = 7) {
    // pole at (x, z); the head reaches out over the road along (ox, oz)
    basic(G.cyl, TM.box(x, h / 2, z, 0.22, h, 0.22), [0.06, 0.06, 0.07]);
    basic(G.cube, TM.box(x + ox * 0.7, h - 0.05, z + oz * 0.7, Math.abs(ox) * 1.4 + 0.12, 0.1, Math.abs(oz) * 1.4 + 0.12), [0.06, 0.06, 0.07]);
    const hx = x + ox * 1.4, hz = z + oz * 1.4;
    emissive(G.cube, TM.box(hx, h - 0.15, hz, 0.7, 0.14, 0.4), LAMP, 2.5);
    sprite(hx, h - 0.3, hz, LAMP, 5, 0.75);
    splat(hx, hz, 0.95, 0.68, 0.42, 6.5);
  }
  function tree(x, z, s = 1, conifer = false) {
    const tint = pickd([[0.06, 0.1, 0.045], [0.05, 0.085, 0.05], [0.08, 0.1, 0.04], [0.045, 0.075, 0.06]]);
    basic(G.cyl, TM.box(x, 1.5 * s, z, 0.35 * s, 3 * s, 0.35 * s), [0.06, 0.04, 0.03]);
    if (conifer) {
      G.cone.push(TM.box(x, 6 * s, z, 4.5 * s, 9 * s, 4.5 * s), [...tint, 0], [MAT.foliage, 0, seedN++, 0]);
    } else {
      const w = Rd(3.6, 5.2) * s;
      G.sphere.push(TM.box(x, 4.4 * s, z, w, w * Rd(0.8, 1.0), w), [...tint, 0], [MAT.foliage, 0, seedN++, 0]);
    }
  }


  let buildingCount = 0;
  // opt: style, wall [r,g,b], shop (0..1), roof (rooftop gear and signs), tiers (setbacks), fh (floor height)
  function building(x0, z0, x1, z1, H, sides, nl, H0, opt = {}) {
    const seed = 7919 + 13 * buildingCount++;
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
    const wx = Math.min(1, [0.55, 0.92, 0.45, 1.0, 0.62][style] * R(0.9, 1.08));
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
      collider(a, yb, b, c, yt, d);
    });
    footRect(x0, z0, x1, z1);
    // light spilling out of shop windows onto the pavement
    if (shop > 0.3) {
      const spill = (x, z) => splat(x, z, 0.5 * shop, 0.36 * shop, 0.22 * shop, 3.5);
      if (sides & 4) for (let x = x0 + 3; x < x1 - 2; x += 7) spill(x, z0 - 2);
      if (sides & 8) for (let x = x0 + 3; x < x1 - 2; x += 7) spill(x, z1 + 2);
      if (sides & 1) for (let z = z0 + 3; z < z1 - 2; z += 7) spill(x0 - 2, z);
      if (sides & 2) for (let z = z0 + 3; z < z1 - 2; z += 7) spill(x1 + 2, z);
    }
    const [tx0, tz0, tx1, tz1, , top] = tiers[tiers.length - 1];
    const tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2, tw = tx1 - tx0, td = tz1 - tz0;
    if (opt.roof === false) {
      if (H > 40) sprite(tcx, top + 0.6, tcz, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
      return H > 150 ? { x: tcx, z: tcz, top, H } : null;
    }
    // rooftops: LED crowns, corner strips, spires, warning lights, water tanks, machinery, billboards
    if (H > 140 && rd() < 0.6) {
      const c = pickd(NEON.slice(0, 4).concat([[0.9, 0.95, 1.0]])), it = Rd(3, 6);
      for (const s of [-1, 1]) {
        emissive(G.cube, TM.box(tcx, top - 0.4, tcz + s * td / 2, tw + 0.3, 0.5, 0.3), c, it);
        emissive(G.cube, TM.box(tcx + s * tw / 2, top - 0.4, tcz, 0.3, 0.5, td + 0.3), c, it);
      }
      if (rd() < 0.5) {
        const [, , , , yb] = tiers[tiers.length - 1];
        for (const [cx, cz] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) emissive(G.cube, TM.box(cx, (yb + top) / 2, cz, 0.35, top - yb, 0.35), c, it * 0.6);
      }
    }
    if (H > 200 && rd() < 0.75) {
      const sh = Rd(25, 70);
      basic(G.cyl, TM.box(tcx, top + sh / 2, tcz, 1.4, sh, 1.4), [0.3, 0.3, 0.32]);
      sprite(tcx, top + sh + 0.6, tcz, [1, 0.08, 0.04], 8, 1.2, ANIM.blink, 0, rd());
    }
    if (H > 90) for (const [cx, cz] of [[tx0 + 0.5, tz0 + 0.5], [tx1 - 0.5, tz1 - 0.5]]) sprite(cx, top + 0.6, cz, [1, 0.08, 0.04], 5, 0.8, ANIM.blink, 0, rd());
    if (H > 12 && H < 95 && rd() < 0.35 * Q.details) {
      const x = Rd(tx0 + 3, tx1 - 3), z = Rd(tz0 + 3, tz1 - 3), r = Rd(3.5, 5);
      basic(G.cyl, TM.box(x, top + 3.2, z, r, 4.2, r), [0.22, 0.14, 0.09]);
      basic(G.cone, TM.box(x, top + 6.0, z, r * 1.05, 1.4, r * 1.05), [0.18, 0.12, 0.08]);
      for (const [a, b] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) basic(G.cube, TM.box(x + a * r * 0.3, top + 0.6, z + b * r * 0.3, 0.25, 1.2, 0.25), [0.1, 0.1, 0.1]);
    }
    if (rd() < 0.6 * Q.details) {
      for (let k = 0, n = 1 + Math.floor(rd() * 3); k < n; k++) {
        const sx = Rd(2, Math.min(6, tw * 0.3)), sz = Rd(2, Math.min(6, td * 0.3)), sy = Rd(1.2, 2.6);
        basic(G.cube, TM.box(Rd(tx0 + sx, tx1 - sx), top + sy / 2, Rd(tz0 + sz, tz1 - sz), sx, sy, sz), [0.16, 0.16, 0.17]);
      }
    }
    if (H > 25 && H < 120 && rd() < 0.1 * Q.details) {
      const ah = Rd(8, 20), x = Rd(tx0 + 2, tx1 - 2), z = Rd(tz0 + 2, tz1 - 2);
      basic(G.cyl, TM.box(x, top + ah / 2, z, 0.3, ah, 0.3), [0.25, 0.25, 0.27]);
      sprite(x, top + ah, z, [1, 0.1, 0.05], 3, 0.5, ANIM.blink, 0, rd());
    }
    // a billboard on the roof, facing a street
    if (H > 12 && H < 55 && nl > 0.55 && rd() < 0.18 * Q.details && sides) {
      const c = pickd(NEON), bw = Math.min(16, Math.max(tw, td) * 0.7), bh = Rd(5, 8);
      let m;
      if (sides & 4) m = TM.yaw(tcx, top + 2 + bh / 2, tz0 + 1, bw, bh, 0.4, 0);
      else if (sides & 8) m = TM.yaw(tcx, top + 2 + bh / 2, tz1 - 1, bw, bh, 0.4, 0);
      else if (sides & 1) m = TM.yaw(tx0 + 1, top + 2 + bh / 2, tcz, bw, bh, 0.4, Math.PI / 2);
      else m = TM.yaw(tx1 - 1, top + 2 + bh / 2, tcz, bw, bh, 0.4, Math.PI / 2);
      G.cube.push(m, [...c, Rd(2, 3.5)], [MAT.neon, 0, seedN++, 1]);
      basic(G.cube, TM.box(m[3], top + 1, m[11], 0.3, 2, 0.3), [0.1, 0.1, 0.1]);
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
        if (m) {
          G.cube.push(m, [...c, Rd(2.5, 4.5)], [MAT.neon, 0, seedN++, 0]);
          splat(m[3], m[11], c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 4);
        }
      }
    }
    return H > 150 ? { x: tcx, z: tcz, top, H } : null;
  }

  // ---------- bake the ground light and ambient occlusion, and build the collision grid ----------
  async function finish(extra) {
  await tick(0.85, 'Baking light');
  const blur = (src, n, rad) => {
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
  };
  const ao = blur(blur(foot, LIGHT_N, 2), LIGHT_N, 1);
  const lightTex = new Uint8Array(LIGHT_N * LIGHT_N * 4);
  for (let i = 0; i < LIGHT_N * LIGHT_N; i++) {
    lightTex[i * 4] = Math.min(255, light[i * 3] * 64);
    lightTex[i * 4 + 1] = Math.min(255, light[i * 3 + 1] * 64);
    lightTex[i * 4 + 2] = Math.min(255, light[i * 3 + 2] * 64);
    lightTex[i * 4 + 3] = Math.round(255 * (1 - 0.7 * Math.min(1, ao[i] * 1.6)));
  }

  // collision: a coarse grid of the solid boxes (buildings, bridge decks, piers, towers, the train viaduct)
  const CELL = 64, grid = new Map(), nb = boxes.length / 6;
  for (let i = 0; i < nb; i++) {
    const o = i * 6;
    for (let gx = Math.floor(boxes[o] / CELL); gx <= Math.floor(boxes[o + 3] / CELL); gx++)
      for (let gz = Math.floor(boxes[o + 2] / CELL); gz <= Math.floor(boxes[o + 5] / CELL); gz++) {
        const k = gx * 100003 + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  }
  await tick(0.9, 'Uploading the map');
  return {
    groups: G, layout, lightTex,
    collide: { boxes: new Float32Array(boxes), grid, CELL },
    ...extra,
    stats: { buildings: buildingCount, boxes: nb, ...(extra.stats || {}) },
  };
  }

  return {
    G, rng, R, pick, rd, Rd, pickd, tick, layout, light, foot, boxes, lx, ll, layRect, layDisk, splat, footRect,
    sprite, basic, emissive, collider, LAMP, NEON, streetLamp, tree, building, finish, seed: () => seedN++,
  };
}

// ---------------------------------------------------------------------------
// Halvard Bay: the river city at dusk. Towers, traffic, bridges, the elevated train, the wheel,
// cranes over the building sites.
// ---------------------------------------------------------------------------
async function buildWorld(Q, progress) { return buildCity(Q, progress); }
async function buildCity(Q, progress) {
  const K = makeKit(Q, progress, 20261115, 6047);
  const { G, rng, R, pick, rd, Rd, pickd, tick, layout, lx, layRect, layDisk, splat, sprite, basic, emissive, collider, LAMP, NEON, streetLamp, tree, building, seed } = K;
  // ---------- 1. street grid ----------
  await tick(0.05, 'Laying out streets');
  const line = (pos, avenue) => ({ pos, avenue, w: avenue ? 20 : 12, lanes: avenue ? 2 : 1 });
  const vx = []; // roads running along z (constant x)
  for (let x = -WORLD, i = 0; x <= WORLD + 1; i++) { vx.push(line(Math.min(x, WORLD), i % 4 === 0 || x >= WORLD)); x += R(72, 120) + (i % 4 === 3 ? 12 : 0); }
  vx[vx.length - 1].pos = WORLD; vx[vx.length - 1].avenue = true; vx[vx.length - 1].w = 20; vx[vx.length - 1].lanes = 2;
  const hz = []; // roads running along x (constant z); none may cross the river
  for (let z = 20, i = 0; z > -WORLD; i++) { hz.push(line(z, i % 4 === 0)); z -= R(72, 120); }
  hz.push(line(-WORLD, true));
  for (let z = 280, i = 0; z < WORLD; i++) { hz.push(line(z, i % 4 === 0)); z += R(72, 120); }
  hz.push(line(WORLD, true));
  hz.sort((a, b) => a.pos - b.pos);
  const nearest = (arr, v, avenueOnly) => arr.filter((l) => !avenueOnly || l.avenue).reduce((a, b) => (Math.abs(b.pos - v) < Math.abs(a.pos - v) ? b : a));

  // asphalt strips, intersections and bridges
  for (const h of hz) G.cube.push(TM.box(0, ROADY - 0.15, h.pos, 2 * WORLD + 20, 0.3, h.w), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, h.w, h.lanes, 0]);
  const suspension = nearest(vx, 150, true);
  for (const v of vx) {
    // only the avenues cross the river; the other streets end at the riverside drives
    const zA = v.avenue ? riverZ(v.pos) - RIVER.hw - RIVER.ramp : 20, zB = v.avenue ? riverZ(v.pos) + RIVER.hw + RIVER.ramp : 280;
    for (const [a, b] of [[-WORLD - 10, zA], [zB, WORLD + 10]])
      G.cube.push(TM.box(v.pos, ROADY - 0.15, (a + b) / 2, v.w, 0.3, b - a), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [1, v.w, v.lanes, 0]);
    for (const h of hz) G.cube.push(TM.box(v.pos, ROADY - 0.12, h.pos, v.w, 0.3, h.w), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, v.w, h.w, 1]);
    if (v.avenue) buildBridge(v, zA, zB, v === suspension);
  }

  function buildBridge(v, zA, zB, grand) {
    const x = v.pos, W = v.w + 2.4, n = Math.ceil((zB - zA) / 5);
    for (let k = 0; k < n; k++) {
      const z0 = zA + ((zB - zA) * k) / n, z1 = zA + ((zB - zA) * (k + 1)) / n;
      const y0 = bridgeH(x, z0), y1 = bridgeH(x, z1), len = Math.hypot(z1 - z0, y1 - y0), sn = (y1 - y0) / len, cs = (z1 - z0) / len;
      const cy = ROADY + (y0 + y1) / 2 - 0.6, cz = (z0 + z1) / 2;
      G.cube.push(TM.pitch(x, cy, cz, W, 1.2, len + 0.25, sn, cs), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [1, v.w, v.lanes, 0]);
      for (const s of [-1, 1]) basic(G.cube, TM.pitch(x + s * (W / 2 - 0.15), cy + 1.1, cz, 0.3, 1.0, len + 0.25, sn, cs), [0.13, 0.13, 0.15]);
      // solid deck and railings, so you can fly under the bridge (and hit it)
      const yLo = ROADY + Math.min(y0, y1), yHi = ROADY + Math.max(y0, y1);
      if (yHi > ROADY + 0.3) {
        collider(x - W / 2, yLo - 1.2, z0, x + W / 2, yHi, z1);
        for (const s of [-1, 1]) collider(x + s * (W / 2 - 0.15) - 0.15, yLo, z0, x + s * (W / 2 - 0.15) + 0.15, yHi + 1.0, z1);
      }
    }
    // piers in the water
    const rz = riverZ(x);
    for (let z = rz - RIVER.hw + 14; z < rz + RIVER.hw - 10; z += grand ? 200 : 30)
    {
      basic(G.cyl, TM.box(x, (ROADY + RIVER.h - 1.2 - 3) / 2, z, 3.2, ROADY + RIVER.h - 1.2 + 3, 5), [0.1, 0.1, 0.1]);
      collider(x - 1.4, -3, z - 2.3, x + 1.4, ROADY + RIVER.h - 1.2, z + 2.3);
    }
    // lamps along the railings
    for (let z = zA + 20; z < zB - 10; z += 26)
      for (const s of [-1, 1]) {
        const lxp = x + s * (W / 2 - 0.2), y = ROADY + bridgeH(x, z);
        basic(G.cyl, TM.box(lxp, y + 2.6, z, 0.16, 5.2, 0.16), [0.08, 0.08, 0.09]);
        sprite(lxp - s * 0.4, y + 5.1, z, grand ? [0.75, 0.85, 1.0] : LAMP, 4, 0.6);
        emissive(G.sphere, TM.box(lxp - s * 0.2, y + 5.1, z, 0.5, 0.5, 0.5), grand ? [0.75, 0.85, 1.0] : LAMP, 2);
      }
    if (!grand) return;
    // the suspension bridge: two towers, main cables strung with lights, suspenders down to the deck
    const deckY = ROADY + RIVER.h, top = 58, zt = [rz - RIVER.hw + 10, rz + RIVER.hw - 10];
    const legX = [x - W / 2 - 1.3, x + W / 2 + 1.3];
    for (const z of zt) {
      for (const lxp of legX) { basic(G.cube, TM.box(lxp, (top - 3) / 2, z, 2.4, top + 3, 3.4), [0.2, 0.19, 0.2]); collider(lxp - 1.2, -3, z - 1.7, lxp + 1.2, top, z + 1.7); }
      for (const y of [deckY + 10, 40, top - 1]) { basic(G.cube, TM.box(x, y, z, W + 5, 2.2, 2.6), [0.2, 0.19, 0.2]); collider(x - (W + 5) / 2, y - 1.1, z - 1.3, x + (W + 5) / 2, y + 1.1, z + 1.3); }
      for (const lxp of legX) sprite(lxp, top + 0.8, z, [1, 0.1, 0.05], 6, 0.9, ANIM.blink, 0, rng());
      for (const lxp of legX) for (let y = 4; y < top; y += 6) sprite(lxp - Math.sign(lxp - x) * 1.3, y, z, [0.7, 0.8, 1], 1.6, 0.5);
    }
    const cablePts = (s) => {
      const pts = [], xx = legX[s];
      const anchorA = zA + 8, anchorB = zB - 8;
      const zm = (zt[0] + zt[1]) / 2, half = (zt[1] - zt[0]) / 2, low = deckY + 2.5;
      for (let z = anchorA; z <= zt[0] + 0.01; z += (zt[0] - anchorA) / 10) pts.push([xx, lerp(ROADY + bridgeH(x, anchorA) + 1, top, (z - anchorA) / (zt[0] - anchorA)), z]);
      for (let k = 1; k <= 30; k++) { const z = zt[0] + (2 * half * k) / 30, t = (z - zm) / half; pts.push([xx, low + (top - low) * t * t, z]); }
      for (let k = 1; k <= 10; k++) { const z = zt[1] + ((anchorB - zt[1]) * k) / 10; pts.push([xx, lerp(top, ROADY + bridgeH(x, anchorB) + 1, (z - zt[1]) / (anchorB - zt[1])), z]); }
      return pts;
    };
    for (let s = 0; s < 2; s++) {
      const pts = cablePts(s);
      for (let k = 0; k + 1 < pts.length; k++) {
        const [a, b] = [pts[k], pts[k + 1]];
        basic(G.cube, TM.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.55), [0.3, 0.3, 0.33]);
        sprite(a[0], a[1] + 0.5, a[2], [0.8, 0.88, 1.0], 3.2, 0.45);
        if (a[2] > zt[0] + 1 && a[2] < zt[1] - 1) basic(G.cube, TM.seg(a[0], deckY + 0.8, a[2], a[0], a[1], a[2], 0.12), [0.3, 0.3, 0.33]);
      }
    }
  }

  // ---------- 2. blocks ----------
  await tick(0.15, 'Raising towers');
  const PARK = { x0: -820, z0: -1060, x1: -380, z1: -640 };
  const blocks = [];
  for (let i = 0; i + 1 < vx.length; i++)
    for (let j = 0; j + 1 < hz.length; j++) {
      const b = { x0: vx[i].pos + vx[i].w / 2, x1: vx[i + 1].pos - vx[i + 1].w / 2, z0: hz[j].pos + hz[j].w / 2, z1: hz[j + 1].pos - hz[j + 1].w / 2 };
      b.cx = (b.x0 + b.x1) / 2; b.cz = (b.z0 + b.z1) / 2;
      b.kind = hz[j].pos === 20 && hz[j + 1].pos === 280 ? 'river'
        : b.cx > PARK.x0 && b.cx < PARK.x1 && b.cz > PARK.z0 && b.cz < PARK.z1 ? 'park' : 'city';
      blocks.push(b);
    }
  const SW = 3.6; // sidewalk width
  const sidewalk = (x0, z0, x1, z1) => G.cube.push(TM.box((x0 + x1) / 2, 0.09, (z0 + z1) / 2, x1 - x0, 0.18, z1 - z0), [0, 0, 0, 0], [MAT.sidewalk, 0, 0, 0]);
  const nightlife = (x, z) => vnoise(x * 0.004 + 3.1, z * 0.004 - 1.7) * 0.8 + 0.5 * Math.exp(-((x - 150) ** 2 + (z + 380) ** 2) / 500 ** 2);

  const tallest = [], sites = [];
  for (const b of blocks) {
    if (b.kind !== 'city') continue;
    sidewalk(b.x0, b.z0, b.x1, b.z1);
    const H0 = skylineAt(b.cx, b.cz), nl = nightlife(b.cx, b.cz);
    const ix0 = b.x0 + SW, ix1 = b.x1 - SW, iz0 = b.z0 + SW, iz1 = b.z1 - SW;
    // street lamps and street trees around the block
    if (H0 < 70 && rd() < 0.75) {
      const step = 13;
      for (let x = b.x0 + 6; x < b.x1 - 5; x += step) for (const z of [b.z0 + 1.6, b.z1 - 1.6]) if (rd() < 0.8 * Q.trees) tree(x + Rd(-1, 1), z, Rd(0.8, 1.1));
      for (let z = b.z0 + 6; z < b.z1 - 5; z += step) for (const x of [b.x0 + 1.6, b.x1 - 1.6]) if (rd() < 0.8 * Q.trees) tree(x, z + Rd(-1, 1), Rd(0.8, 1.1));
    }
    if (rng() < 0.035 && H0 < 200) { plaza(ix0, iz0, ix1, iz1); continue; }
    // building sites, each with its tower crane
    if (sites.length < 6 && H0 > 45 && rng() < 0.09) { sites.push(constructionSite(K, ix0, iz0, Math.min(ix1, ix0 + 75), Math.min(iz1, iz0 + 75), H0)); continue; }
    const maxLot = H0 > 170 ? 70 : H0 > 70 ? 40 : 26 + R(0, 10);
    const lots = [];
    splitLots(ix0, iz0, ix1, iz1, maxLot, 0, 15, lots);
    for (const lot of lots) {
      const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
      if (w < 7 || d < 7) continue;
      if (rng() < 0.05) { if (rd() < Q.trees) tree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, Rd(0.9, 1.3)); continue; }
      let H = H0 * (0.3 + 0.95 * Math.pow(rng(), 1.3));
      if (H0 > 120 && rng() < 0.06) H *= 1.4;
      H = Math.max(Math.min(H, Math.max(w, d) * 7.5), R(7, 13));
      const g = H0 > 60 ? R(1.5, 4) : rng() < 0.5 ? 0 : R(1, 2.5);
      const bld = building(lot.x0 + g / 2, lot.z0 + g / 2, lot.x1 - g / 2, lot.z1 - g / 2, H, lot.sides, nl, H0);
      if (bld) tallest.push(bld);
    }
  }

  function splitLots(x0, z0, x1, z1, maxLot, depth, sides, out) {
    const w = x1 - x0, d = z1 - z0;
    if ((w <= maxLot && d <= maxLot) || depth > 5) { out.push({ x0, z0, x1, z1, sides }); return; }
    if (w >= d) {
      const s = x0 + w * R(0.35, 0.65);
      splitLots(x0, z0, s, z1, maxLot, depth + 1, sides & ~2, out); splitLots(s, z0, x1, z1, maxLot, depth + 1, sides & ~1, out);
    } else {
      const s = z0 + d * R(0.35, 0.65);
      splitLots(x0, z0, x1, s, maxLot, depth + 1, sides & ~8, out); splitLots(x0, s, x1, z1, maxLot, depth + 1, sides & ~4, out);
    }
  }

  function plaza(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    basic(G.cyl, TM.box(cx, 0.45, cz, 12, 0.6, 12), [0.16, 0.15, 0.14]);
    emissive(G.cyl, TM.box(cx, 0.6, cz, 11, 0.5, 11), [0.25, 0.55, 0.8], 0.6);
    emissive(G.cyl, TM.box(cx, 2.2, cz, 0.8, 3.6, 0.8), [0.6, 0.85, 1.0], 1.5);
    sprite(cx, 4.2, cz, [0.6, 0.85, 1.0], 6, 1.6);
    splat(cx, cz, 0.3, 0.55, 0.8, 9);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; tree(cx + Math.cos(a) * 16, cz + Math.sin(a) * 16, 0.9); }
    for (const [x, z] of [[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3]]) streetLamp(x, z, 0, 0, 5);
  }

  // ---------- 3. the riverside and the park ----------
  await tick(0.35, 'Filling the river');
  layRect(-WORLD, 20, WORLD, 280, 2);
  const promenade = (x) => [riverZ(x) - RIVER.hw - 11, riverZ(x) - RIVER.hw, riverZ(x) + RIVER.hw, riverZ(x) + RIVER.hw + 11];
  for (let c = 0; c < LAYOUT_N; c++) {
    const x = ((c + 0.5) / LAYOUT_N - 0.5) * 2 * WORLD, [a, b, e, f] = promenade(x);
    for (let r = Math.floor(lx(a)); r < Math.ceil(lx(f)); r++) {
      const z = ((r + 0.5) / LAYOUT_N - 0.5) * 2 * WORLD;
      if ((z > a && z < b) || (z > e && z < f)) layout[(r * LAYOUT_N + c) * 4] = 6;
    }
  }
  // embankment walls along both banks
  for (let x = -WORLD - 40; x < WORLD + 40; x += 8) {
    for (const s of [-1, 1]) {
      const z0 = riverZ(x) + s * (RIVER.hw + 0.75), z1 = riverZ(x + 8) + s * (RIVER.hw + 0.75);
      const yaw = -Math.atan2(z1 - z0, 8);
      basic(G.cube, TM.yaw(x + 4, -1.2, (z0 + z1) / 2, 8.3, 4.0, 1.5, yaw), [0.12, 0.11, 0.1]);
    }
  }
  let wheel = null;
  for (const b of blocks) {
    if (b.kind !== 'river') continue;
    sidewalk(b.x0, b.z0, b.x1, b.z0 + 4);
    sidewalk(b.x0, b.z1 - 4, b.x1, b.z1);
    // promenade lamps and trees
    for (let x = b.x0 + 8; x < b.x1 - 4; x += 24)
      for (const s of [-1, 1]) {
        const z = riverZ(x) + s * (RIVER.hw + 3);
        basic(G.cyl, TM.box(x, 2.2, z, 0.16, 4.4, 0.16), [0.05, 0.05, 0.06]);
        emissive(G.sphere, TM.box(x, 4.6, z, 0.6, 0.6, 0.6), LAMP, 2.5);
        sprite(x, 4.6, z, LAMP, 4.5, 0.7);
        splat(x, z, 0.8, 0.58, 0.36, 5.5);
      }
    for (let k = 0, n = ((b.x1 - b.x0) / 9) * Q.trees; k < n; k++) {
      const x = Rd(b.x0 + 3, b.x1 - 3), s = rd() < 0.5 ? -1 : 1, rz = riverZ(x);
      const z = s < 0 ? Rd(b.z0 + 7, rz - RIVER.hw - 14) : Rd(rz + RIVER.hw + 14, b.z1 - 7);
      tree(x, z, Rd(0.9, 1.4), rd() < 0.2);
    }
    if (!wheel && b.x0 < 430 && b.x1 > 430) wheel = ferrisWheel(b.cx, (b.z0 + 4 + riverZ(b.cx) - RIVER.hw - 11) / 2);
  }

  function ferrisWheel(px, pz) {
    const py = 38, rad = 30, w = 0.055, piv = [px, py, pz, w];
    const ring = 56, spokes = 16;
    for (const side of [-1.6, 1.6]) {
      for (let k = 0; k < ring; k++) {
        const a0 = (k / ring) * Math.PI * 2, a1 = ((k + 1) / ring) * Math.PI * 2;
        basic(G.cube, TM.seg(px + Math.cos(a0) * rad, py + Math.sin(a0) * rad, pz + side, px + Math.cos(a1) * rad, py + Math.sin(a1) * rad, pz + side, 0.55), [0.55, 0.55, 0.6], ANIM.wheel, piv);
        sprite(px + Math.cos(a0) * rad, py + Math.sin(a0) * rad, pz + side * 1.2, [1, 1, 1], 7, 0.75, ANIM.wheel, 0, k / ring, piv);
      }
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2;
        basic(G.cube, TM.seg(px, py, pz + side, px + Math.cos(a) * rad, py + Math.sin(a) * rad, pz + side, 0.22), [0.5, 0.5, 0.55], ANIM.wheel, piv);
        for (let r = 6; r < rad - 2; r += 6) sprite(px + Math.cos(a) * r, py + Math.sin(a) * r, pz + side * 1.2, [1, 1, 1], 5, 0.6, ANIM.wheel, 0, 0.5 + r / rad / 3, piv);
      }
    }
    basic(G.cyl, TM.seg(px, py, pz - 3.5, px, py, pz + 3.5, 3), [0.4, 0.4, 0.45]);
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2, c = pick(NEON);
      G.cube.push(TM.box(0, -1.7, 0, 2.6, 2.4, 2.4), [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0], [MAT.basic, ANIM.gondola, rad, a], piv);
      G.sprite.push([1, 0, 0, 0, 0, 1, 0, -1.7, 0, 0, 1, 0], [1, 0.75, 0.5, 2], [0.9, ANIM.gondola, rad, a], piv);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) basic(G.cube, TM.seg(px + sx * 16, 0, pz + sz * 5, px, py, pz + sz * 2.4, 1.1), [0.32, 0.32, 0.36]);
    splat(px, pz, 0.6, 0.5, 0.6, 22);
    return { x: px, y: py, z: pz, r: rad };
  }

  const parkC = { x: (PARK.x0 + PARK.x1) / 2, z: (PARK.z0 + PARK.z1) / 2 };
  // the pond fills the biggest park block, clear of the streets
  const pb = blocks.filter((b) => b.kind === 'park').reduce((a, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a));
  const pond = { x: pb.cx, z: pb.cz, rx: (pb.x1 - pb.x0) / 2 - 14, rz: (pb.z1 - pb.z0) / 2 - 14 };
  const parkPaths = [];
  for (let k = 0; k < 5; k++) {
    const pts = [], horizontal = k % 2 === 0, ph = R(0, 6), amp = R(15, 45), off = R(-150, 150);
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const u = lerp(horizontal ? PARK.x0 - 40 : PARK.z0 - 40, horizontal ? PARK.x1 + 40 : PARK.z1 + 40, t);
      const v = (horizontal ? parkC.z : parkC.x) + off + Math.sin(t * 7 + ph) * amp;
      pts.push(horizontal ? [u, v] : [v, u]);
    }
    parkPaths.push(pts);
  }
  const nearPath = (x, z) => layout[(Math.floor(lx(z)) * LAYOUT_N + Math.floor(lx(x))) * 4 + 1] > 40;
  const inPond = (x, z) => ((x - pond.x) / pond.rx) ** 2 + ((z - pond.z) / pond.rz) ** 2 < 1.15;
  for (const b of blocks) if (b.kind === 'park') { layRect(b.x0, b.z0, b.x1, b.z1, 2); }
  for (const pts of parkPaths)
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k];
      const inPark = blocks.some((b) => b.kind === 'park' && x > b.x0 + 4 && x < b.x1 - 4 && z > b.z0 + 4 && z < b.z1 - 4);
      if (!inPark || inPond(x, z)) continue;
      if (k + 1 < pts.length) for (let s = 0; s < 1; s += 0.2) layDisk(lerp(x, pts[k + 1][0], s), lerp(z, pts[k + 1][1], s), 2.0, 1);
      if (k % 6 === 0) {
        basic(G.cyl, TM.box(x + 3, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]);
        emissive(G.sphere, TM.box(x + 3, 4.2, z, 0.55, 0.55, 0.55), LAMP, 2.5);
        sprite(x + 3, 4.2, z, LAMP, 4, 0.7);
        splat(x + 3, z, 0.75, 0.55, 0.34, 5);
      }
    }
  // the pond (alpha channel), soft-edged
  for (let r = Math.floor(lx(pond.z - pond.rz - 4)); r < Math.ceil(lx(pond.z + pond.rz + 4)); r++)
    for (let c = Math.floor(lx(pond.x - pond.rx - 4)); c < Math.ceil(lx(pond.x + pond.rx + 4)); c++) {
      const x = ((c + 0.5) / LAYOUT_N - 0.5) * 2 * WORLD, z = ((r + 0.5) / LAYOUT_N - 0.5) * 2 * WORLD;
      const d = Math.hypot((x - pond.x) / pond.rx, (z - pond.z) / pond.rz) + 0.08 * Math.sin(Math.atan2(z - pond.z, x - pond.x) * 5);
      layout[(r * LAYOUT_N + c) * 4 + 3] = Math.round(255 * smooth(1.02, 0.96, d));
    }
  for (const b of blocks) {
    if (b.kind !== 'park') continue;
    sidewalk(b.x0, b.z0, b.x1, b.z0 + 4); sidewalk(b.x0, b.z1 - 4, b.x1, b.z1);
    sidewalk(b.x0, b.z0 + 4, b.x0 + 4, b.z1 - 4); sidewalk(b.x1 - 4, b.z0 + 4, b.x1, b.z1 - 4);
    const n = (((b.x1 - b.x0) * (b.z1 - b.z0)) / 140) * Q.trees;
    for (let k = 0; k < n; k++) {
      const x = Rd(b.x0 + 7, b.x1 - 7), z = Rd(b.z0 + 7, b.z1 - 7);
      if (nearPath(x, z) || inPond(x, z)) continue;
      tree(x, z, Rd(0.9, 1.6), rd() < 0.25);
    }
  }

  // ---------- 4. street lamps ----------
  await tick(0.5, 'Switching on the lights');
  const inCross = (pos, cross) => cross.some((c) => Math.abs(pos - c.pos) < c.w / 2 + 3);
  for (const h of hz)
    for (let x = -WORLD + 8; x < WORLD - 8; x += Q.lampStep)
      for (const s of [-1, 1]) {
        if (inCross(x, vx)) continue;
        const z = h.pos + s * (h.w / 2 + 0.8);
        if (Math.abs(z) > WORLD - 2) continue;
        streetLamp(x, z, 0, -s);
      }
  for (const v of vx) {
    const zA = v.avenue ? riverZ(v.pos) - RIVER.hw - RIVER.ramp : 20, zB = v.avenue ? riverZ(v.pos) + RIVER.hw + RIVER.ramp : 280;
    for (let z = -WORLD + 8 + Q.lampStep / 2; z < WORLD - 8; z += Q.lampStep)
      for (const s of [-1, 1]) {
        if (inCross(z, hz) || (z > zA - 4 && z < zB + 4)) continue;
        const x = v.pos + s * (v.w / 2 + 0.8);
        if (Math.abs(x) > WORLD - 2) continue;
        streetLamp(x, z, -s, 0);
      }
  }

  // ---------- 5. traffic ----------
  await tick(0.6, 'Starting the traffic');
  const CARS = [[0.5, 0.05, 0.04], [0.06, 0.07, 0.09], [0.6, 0.6, 0.62], [0.12, 0.2, 0.35], [0.03, 0.03, 0.03], [0.35, 0.35, 0.37], [0.05, 0.18, 0.12], [0.55, 0.38, 0.05]];
  let carCount = 0;
  // seg 0 runs the whole street, seg 1 / seg 2 only the part north / south of the river (shaders.js: carPose)
  const SEGS = [2 * WORLD, WORLD + 20, WORLD - 280];
  function lane(axis, coord, dir, avenue, seg = 0) {
    const speed = Rd(9, 16), L = SEGS[seg];
    for (let s = Rd(0, Q.carGap); s < L - 8; s += Q.carGap * Rd(0.4, 1.6) + 9) {
      const q = [axis + 2 * seg, coord, dir, speed], bus = avenue && rd() < 0.05;
      if (bus) {
        G.cube.push(TM.box(0, 1.8, 0, 11, 2.9, 2.5), [0.75, 0.75, 0.72, 0], [MAT.train, ANIM.car, seed(), s], q);
        for (const z of [-0.8, 0.8]) { sprite(5.55, 0.9, z, [1, 0.92, 0.8], 4, 0.4, ANIM.car, 1, s, q); sprite(-5.55, 0.9, z, [1, 0.06, 0.03], 3, 0.32, ANIM.car, -1, s, q); }
      } else {
        const taxi = rd() < 0.12, col = taxi ? [0.75, 0.55, 0.05] : pickd(CARS);
        G.cube.push(TM.box(0, 0.72, 0, 4.4, 0.78, 1.86), [...col, 0], [MAT.basic, ANIM.car, seed(), s], q);
        G.cube.push(TM.box(-0.3, 1.38, 0, 2.3, 0.58, 1.62), [0.02, 0.022, 0.026, 0], [MAT.basic, ANIM.car, seed(), s], q);
        for (const z of [-0.62, 0.62]) { sprite(2.22, 0.78, z, [1, 0.92, 0.8], 4, 0.35, ANIM.car, 1, s, q); sprite(-2.22, 0.85, z, [1, 0.06, 0.03], 3, 0.3, ANIM.car, -1, s, q); }
      }
      carCount++;
    }
  }
  // right-hand traffic: driving +x keeps to +z, driving +z keeps to -x
  for (const h of hz) {
    const offs = h.avenue ? [2.2, 5.8] : [3];
    for (const o of offs) { lane(0, h.pos + o, 1, h.avenue); lane(0, h.pos - o, -1, h.avenue); }
  }
  for (const v of vx) {
    const offs = v.avenue ? [2.2, 5.8] : [3];
    for (const seg of v.avenue ? [0] : [1, 2])
      for (const o of offs) { lane(1, v.pos - o, 1, v.avenue, seg); lane(1, v.pos + o, -1, v.avenue, seg); }
  }

  // ---------- 6. the elevated train ----------
  await tick(0.7, 'Running the trains');
  const ta = nearest(vx, -250, true).pos, tb = nearest(vx, 560, true).pos, tc = nearest(hz, -760, true).pos, td = 20;
  const T = { cx: (ta + tb) / 2, cz: (tc + td) / 2, hx: (tb - ta) / 2, hz: (td - tc) / 2, r: 16 };
  const TL = trainLength(T);
  for (let s = 0; s < TL; s += 4) {
    const [x, z, dx, dz] = trainPath(T, s + 2), yaw = Math.atan2(-dz, dx);
    basic(G.cube, TM.yaw(x, TRAIN_Y - 0.6, z, 4.3, 1.2, 6.4, yaw), [0.16, 0.16, 0.18]);
    { const hx = Math.abs(dx) * 2.15 + Math.abs(dz) * 3.2, hzz = Math.abs(dz) * 2.15 + Math.abs(dx) * 3.2; collider(x - hx, TRAIN_Y - 1.2, z - hzz, x + hx, TRAIN_Y, z + hzz); }
    if (Math.round(s) % 32 === 0) { basic(G.cyl, TM.box(x, (TRAIN_Y - 1.2) / 2, z, 1.6, TRAIN_Y - 1.2, 1.6), [0.15, 0.15, 0.16]); collider(x - 0.8, 0, z - 0.8, x + 0.8, TRAIN_Y - 1.2, z + 0.8); }
    if (Math.round(s) % 12 === 0) for (const o of [-3.3, 3.3]) sprite(x - dz * o, TRAIN_Y - 0.4, z + dx * o, [0.4, 0.7, 1.0], 1.8, 0.35);
  }
  for (let t = 0; t < 2; t++)
    for (let k = 0; k < 5; k++) {
      const s0 = (t * TL) / 2 - k * 16, q = [s0, 17, 0, 0];
      G.cube.push(TM.box(0, 1.9, 0, 15, 3.3, 3.0), [0.7, 0.72, 0.75, 0], [MAT.train, ANIM.train, seed(), 0], q);
      if (k === 0) for (const z of [-0.9, 0.9]) sprite(7.6, 1.2, z, [1, 0.95, 0.85], 6, 0.5, ANIM.train, 0, 0, q);
    }

  // ---------- 7. sky: a blimp and searchlights ----------
  {
    const q = [100, -250, 700, 7], ph = 1.3;
    const env = (m, col) => G.sphere.push(m, [...col, 0], [MAT.basic, ANIM.blimp, seed(), ph], q);
    env(TM.box(0, 0, 0, 52, 13, 13), [0.3, 0.3, 0.31]);
    basic(G.cube, TM.box(2, -7.2, 0, 9, 2.2, 3), [0.2, 0.2, 0.22], ANIM.blimp, q, ph);
    for (const [y, z, sy, sz] of [[5, 0, 7, 0.4], [-5, 0, 7, 0.4], [0, 5, 0.4, 7], [0, -5, 0.4, 7]]) basic(G.cube, TM.box(-23, y, z, 7, sy, sz), [0.28, 0.28, 0.3], ANIM.blimp, q, ph);
    for (const z of [-6.6, 6.6]) G.cube.push(TM.box(3, 0.5, z, 24, 6.5, 0.3), [0.3, 0.8, 1.0, 3], [MAT.neon, ANIM.blimp, seed(), ph], q);
    sprite(26.5, 0, 0, [1, 1, 1], 6, 0.8, ANIM.blimp, 0, ph, q);
    sprite(-26, 0, 0, [1, 0.15, 0.1], 6, 0.8, ANIM.blimp, 0, ph, q);
    sprite(2, -8.6, 0, [1, 0.8, 0.5], 4, 0.9, ANIM.blimp, 0, ph, q);
  }
  tallest.sort((a, b) => b.H - a.H);
  for (const t of tallest.slice(0, 4))
    for (let k = 0; k < 2; k++)
      G.beam.push(TM.box(t.x, t.top + 1, t.z, 16, 1600, 16), [0.55, 0.65, 1.0, 0.022], [0, ANIM.beam, seed(), rng() * 6.3], [R(0.12, 0.25) * (k ? -1 : 1), R(0.35, 0.6), 0, 0]);

  // ---------- 9. viewpoints (keys 1-6) ----------
  const ave = nearest(vx, 150, true), sx = suspension.pos;
  const views = [
    { name: 'Downtown avenue', pos: [ave.pos + ave.w / 2 + 1.8, 2.2, -120], at: [ave.pos, 40, -700] },
    { name: 'Skyline across the river', pos: [190, 22, riverZ(190) + RIVER.hw + 30], at: [140, 110, -420] },
    { name: 'Ferris wheel', pos: wheel ? [wheel.x + 75, 26, wheel.z + 95] : [400, 30, 150], at: wheel ? [wheel.x, 36, wheel.z] : [400, 30, 50] },
    { name: 'Above downtown', pos: [760, 420, 260], at: [150, 60, -380] },
    sites.length ? { name: 'Tower crane', pos: [sites[0].x, sites[0].top + 1.6, sites[0].z], at: [150, 60, -380] } : { name: 'The park', pos: [pond.x - 45, 7, pond.z - 12], at: [150, 90, -380] },
    { name: 'Suspension bridge', pos: [sx + 3.5, ROADY + RIVER.h + 2.2, riverZ(sx) + 22], at: [sx, 30, riverZ(sx) - 160] },
  ];

  return K.finish({ views, wheel, consts: { T, TL, map: 0 }, stats: { cars: carCount } });
}

// ---------- the city as libfpv collides with it ----------
// One triangle mesh: every solid box (buildings, bridge decks and railings, piers, towers, the train
// viaduct) without its bottom face, the streets, the river banks and the water, which kills props.
// Materials: 0 ground, 1 walls, 2 water (see source/fpv/host.c).
function buildCollisionMesh(world) {
  const { boxes } = world.collide, nb = boxes.length / 6;
  const pos = [], idx = [], mat = [];
  const quad = (a, b, c, d, m) => {
    const o = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    mat.push(m, m);
  };
  for (let i = 0; i < nb; i++) {
    const [x0, y0, z0, x1, y1, z1] = boxes.subarray(i * 6, i * 6 + 6);
    // outward faces, counter-clockwise seen from outside
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 1);   // top
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1);   // +z
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 1);   // -z
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1);   // +x
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 1);   // -x
  }
  // the ground in strips across the river, which winds; banks and water in between
  const E = WORLD + 900, STEP = 25, hw = RIVER.hw + 0.5;
  for (let x = -E; x < E; x += STEP) {
    const xa = x, xb = x + STEP, na = riverZ(xa) - hw, nb2 = riverZ(xb) - hw, sa = riverZ(xa) + hw, sb = riverZ(xb) + hw;
    quad([xa, ROADY, -E], [xa, ROADY, na], [xb, ROADY, nb2], [xb, ROADY, -E], 0);
    quad([xa, ROADY, sa], [xa, ROADY, E], [xb, ROADY, E], [xb, ROADY, sb], 0);
    quad([xa, RIVER.level, na], [xa, RIVER.level, sa], [xb, RIVER.level, sb], [xb, RIVER.level, nb2], 2);
    quad([xa, RIVER.level, na], [xb, RIVER.level, nb2], [xb, ROADY, nb2], [xa, ROADY, na], 0);
    quad([xb, RIVER.level, sb], [xa, RIVER.level, sa], [xa, ROADY, sa], [xb, ROADY, sb], 0);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), materials: new Uint8Array(mat) };
}

const inRiver = (x, z) => Math.abs(z - riverZ(x)) < RIVER.hw + 0.5;
// the highest solid surface under (x, z) that is below y: a roof, a bridge deck, the street or the river
function supportY(world, x, z, y) {
  const { boxes, grid, CELL } = world.collide;
  let best = inRiver(x, z) ? RIVER.level : ROADY;
  const list = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || [];
  for (const i of list) {
    const o = i * 6;
    if (x >= boxes[o] && x <= boxes[o + 3] && z >= boxes[o + 2] && z <= boxes[o + 5] && boxes[o + 4] <= y + 0.5) best = Math.max(best, boxes[o + 4]);
  }
  return best;
}
