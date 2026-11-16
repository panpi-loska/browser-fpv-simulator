// ---------------------------------------------------------------------------
// city.js: the shape of the endless city, as formulas that hold anywhere. The same seed always
// gives the same city: rivers, the avenue grid, the superblocks between avenues and the district
// each of them belongs to. Nothing here is stored; any point can be asked about at any time
// (world.js generates a piece of the city from these, shaders.js has the river formulas too).
// ---------------------------------------------------------------------------

const CHUNK = 256;                  // the city is generated and streamed in squares this big (meters)
const ROADY = 0.1;                  // top of the asphalt
const TRAIN_Y = 14;                 // top of the elevated track
const BLIMP_Y = 270;
// rivers run along x, one every ~3 km (not all of them there); each has a riverside row between
// two drives, 175 m either side of its line, with bridges where the avenues cross. A river winds
// inside its row, up to amp metres off the line: long bends with smaller wiggles on them
const RIVER = { hw: 55, ramp: 45, h: 7, level: -0.8, period: 3000, z0: 150, row: 175, amp: 66 };
// avenues: north-south every ~470 m, east-west between the rivers; streets fill the superblocks between
const AVE = { period: 470, x0: 150, w: 20 };
const MAT = { basic: 0, building: 1, emissive: 2, road: 3, sidewalk: 4, foliage: 5, neon: 7, train: 8 };
const ANIM = { none: 0, car: 1, train: 2, wheel: 3, gondola: 4, blink: 5, blimp: 6, beam: 7, slew: 8 };

// ---------- hashing: the same integer hash as in WGSL (pcg), so the GPU agrees about the rivers ----------
function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
// a number in [0, 1) for the integer a (and b), different for every salt
const ih = (a, salt) => pcg(((a | 0) >>> 0) ^ pcg(salt)) / 4294967296;
const ih2 = (a, b, salt) => pcg(((a | 0) >>> 0) ^ pcg(((b | 0) >>> 0) ^ pcg(salt))) / 4294967296;

// ---------- rivers ----------
const riverK = (z) => Math.round((z - RIVER.z0) / RIVER.period);
const riverCache = new Map();
function riverSlot(k) {
  let r = riverCache.get(k);
  if (r) return r;
  // river 0 is Halvard Bay's own, where it always was
  r = k === 0
    ? { k, zc: RIVER.z0, on: true, hw: RIVER.hw, a1: 36, f1: 0.0036, p1: 0.7, a2: 8, f2: 0.0095, p2: 0 }
    : { k, zc: RIVER.z0 + k * RIVER.period + (ih(k, 11) - 0.5) * 1400, on: ih(k, 12) < 0.6, hw: 40 + 18 * ih(k, 19),
        a1: 26 + 24 * ih(k, 13), f1: 0.0026 + 0.0024 * ih(k, 14), p1: 6.2832 * ih(k, 15),
        a2: 5 + 9 * ih(k, 16), f2: 0.006 + 0.006 * ih(k, 17), p2: 6.2832 * ih(k, 18) };
  if (riverCache.size > 64) riverCache.clear();
  riverCache.set(k, r);
  return r;
}
const riverZk = (r, x) => r.zc + r.a1 * Math.sin(x * r.f1 + r.p1) + r.a2 * Math.sin(x * r.f2 + r.p2);
// the river whose row (x, z) may be in, or null
function riverAt(z) { const r = riverSlot(riverK(z)); return r.on ? r : null; }
function riverZ(x, z) { const r = riverAt(z); return r ? riverZk(r, x) : null; }
function bridgeH(x, z) {
  const r = riverAt(z);
  if (!r) return 0;
  const d = Math.abs(z - riverZk(r, x)) - r.hw, k = clamp(1 - d / RIVER.ramp, 0, 1);
  return RIVER.h * k * k * (3 - 2 * k);
}
function inRiver(x, z) { const r = riverAt(z); return !!r && Math.abs(z - riverZk(r, x)) < r.hw + 0.5; }

// ---------- the avenue grid ----------
const aveX = (i) => (i === 0 ? AVE.x0 : AVE.x0 + i * AVE.period + (ih(i, 21) - 0.5) * 120);
// the north-south avenues between x0 and x1
function aveXs(x0, x1) {
  const out = [];
  for (let i = Math.floor((x0 - AVE.x0) / AVE.period) - 1; i <= Math.ceil((x1 - AVE.x0) / AVE.period) + 1; i++) {
    const x = aveX(i);
    if (x >= x0 && x <= x1) out.push({ i, x });
  }
  return out;
}
// the east-west avenues from river slot k to the next: the two riverside drives if there is a
// river, then evenly spread lines with a little jitter
function zLinesOf(k) {
  const r = riverSlot(k), n = riverSlot(k + 1), out = [];
  if (r.on) { out.push({ z: r.zc - RIVER.row, k, m: -1, kind: 'n' }); out.push({ z: r.zc + RIVER.row, k, m: 0, kind: 's' }); }
  else out.push({ z: r.zc, k, m: 0, kind: '' });
  const a = r.zc + (r.on ? RIVER.row : 0), b = n.zc - (n.on ? RIVER.row : 0), g = b - a, cnt = Math.max(1, Math.round(g / AVE.period));
  for (let m = 1; m < cnt; m++) out.push({ z: a + (g * m) / cnt + (ih2(k, m, 22) - 0.5) * 120, k, m, kind: '' });
  return out;
}
function aveZs(z0, z1) {
  const out = [];
  for (let k = riverK(z0) - 1; k <= riverK(z1) + 1; k++) for (const l of zLinesOf(k)) if (l.z >= z0 && l.z <= z1) out.push(l);
  return out.sort((a, b) => a.z - b.z);
}

// ---------- districts ----------
// The centres a city grows round: Halvard Bay's at the origin, and others on a jittered 3.6 km grid.
// About one in four is a business centre (a skyline peak with a landmark tower); the rest are
// smaller clusters of offices round a junction, which only reach midtown heights.
function corePeaks(x, z) {
  const out = [{ px: 150, pz: -380, s: 1, R: 520, major: true }];
  const S = 3600, a0 = Math.floor(x / S), b0 = Math.floor(z / S);
  for (let a = a0 - 1; a <= a0 + 1; a++)
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      if ((a === 0 || a === -1) && (b === 0 || b === -1)) continue;   // around the origin there is only Halvard Bay's
      if (ih2(a, b, 31) > 0.8) continue;
      const px = (a + 0.15 + 0.7 * ih2(a, b, 32)) * S, pz = (b + 0.15 + 0.7 * ih2(a, b, 33)) * S, major = ih2(a, b, 36) < 0.3;
      out.push(major
        ? { px, pz, s: 0.85 + 0.15 * ih2(a, b, 34), R: 620 + 260 * ih2(a, b, 35), major }
        : { px, pz, s: 0.38 + 0.22 * ih2(a, b, 34), R: 300 + 180 * ih2(a, b, 35), major });
    }
  return out;
}
// the landmark tower at a centre's peak, and how tall the towers round it may be (it must stand out)
const landmarkH = (p) => (p.major ? (p.px === 150 && p.pz === -380 ? 480 : 430 + 90 * ih2(p.px | 0, p.pz | 0, 37)) : 175 + 60 * ih2(p.px | 0, p.pz | 0, 37));
function towerCap(x, z) {
  let cap = Infinity;
  for (const p of corePeaks(x, z)) if (Math.hypot(x - p.px, z - p.pz) < 2.5 * p.R) cap = Math.min(cap, 0.68 * landmarkH(p));
  return cap;
}
function coreField(x, z) {
  let c = 0;
  for (const p of corePeaks(x, z)) c = Math.max(c, p.s * Math.exp(-((x - p.px) ** 2 + (z - p.pz) ** 2) / (p.R * p.R)));
  return c;
}
// the elevated lines run along some north-south avenues; industry gathers along them and the rivers
const hasTrain = (i) => i === -1 || (i !== 0 && ih(i, 61) < 0.16);
function industryPull(x, z) {
  let i = Math.floor((x - AVE.x0) / AVE.period);
  while (aveX(i) > x) i--;
  while (aveX(i + 1) <= x) i++;
  let t = 0;
  for (const j of [i, i + 1]) if (hasTrain(j)) t = Math.max(t, smooth(320, 90, Math.abs(x - aveX(j))));
  const r = riverAt(z), w = r ? smooth(650, 260, Math.abs(z - r.zc)) : 0;
  return 0.08 * t + 0.04 * w;
}
const industryField = (x, z) => vnoise(x / 1800 + 17.3, z / 1800 - 3.1) + industryPull(x, z);
const DISTRICTS = {
  downtown: { label: 'Downtown', street: [85, 120], sw: 12 },
  midtown: { label: 'Midtown', street: [75, 110], sw: 12 },
  residential: { label: 'Residential', street: [60, 85], sw: 11 },
  oldtown: { label: 'Old town', street: [42, 62], sw: 9 },
  industrial: { label: 'Industrial', street: [150, 230], sw: 14 },
  suburb: { label: 'Suburbs', street: [55, 75], sw: 9 },
  park: { label: 'Park', street: null, sw: 0 },
  riverside: { label: 'Riverside', street: null, sw: 0 },
  docks: { label: 'Docks', street: null, sw: 0 },
};
function districtAt(x, z) {
  const c = coreField(x, z);
  if (c > 0.42) return 'downtown';
  if (c > 0.12) return 'midtown';
  if (industryField(x, z) > 0.7) return 'industrial';
  if (vnoise(x / 1500 - 41.7, z / 1500 + 9.2) > 0.69) return 'oldtown';
  if (c < 0.03 && vnoise(x / 2600 + 5.5, z / 2600 + 77.1) > 0.56) return 'suburb';
  return 'residential';
}

// ---------- superblocks: the rectangles between avenues ----------
const sbCache = new Map();
function superblockAt(x, z) {
  let i = Math.floor((x - AVE.x0) / AVE.period);
  while (aveX(i) > x) i--;
  while (aveX(i + 1) <= x) i++;
  const zs = aveZs(z - 1400, z + 1400);
  let j = 0;
  while (j + 1 < zs.length && zs[j + 1].z <= z) j++;
  return superblock(i, zs[j], zs[j + 1]);
}
function sbBasics(i, A, B) {
  const x0 = aveX(i), x1 = aveX(i + 1), cx = (x0 + x1) / 2, cz = (A.z + B.z) / 2;
  const seed = pcg(((i | 0) >>> 0) ^ pcg(((A.k * 64 + A.m + 8) >>> 0) ^ pcg(41)));
  let kind;
  if (A.kind === 'n') {
    // the riverside row: docks next to industry, a promenade and gardens elsewhere
    const ind = districtAt(cx, A.z - 300) === 'industrial' || districtAt(cx, B.z + 300) === 'industrial';
    kind = ind ? 'docks' : 'riverside';
  } else {
    kind = districtAt(cx, cz);
    if (kind !== 'downtown' && kind !== 'industrial' && ih(seed, 42) < 0.07) kind = 'park';
  }
  return { i, x0, x1, z0: A.z, z1: B.z, cx, cz, A, B, kind, seed };
}
function superblock(i, A, B) {
  const key = i + ',' + A.k + ',' + A.m;
  let sb = sbCache.get(key);
  if (sb) return sb;
  sb = sbBasics(i, A, B);
  sb.river = A.kind === 'n' ? riverSlot(A.k) : null;
  sb.special = A.kind === 'n' ? null : specialOf(sb);
  if (sbCache.size > 400) sbCache.clear();
  sbCache.set(key, sb);
  return sb;
}

// Now and then a whole superblock is one big place, where it makes sense: a rail yard on the line in
// industry, a stadium by the train, a hospital, a university campus, a cemetery, a golf course in the
// suburbs. Never two side by side (only every other superblock may hold one).
const SPECIALS = { stadium: 'Stadium', railyard: 'Rail yard', hospital: 'Hospital', campus: 'University', cemetery: 'Cemetery', golf: 'Golf course' };
// At most one in each 3 km square of the map: of the superblocks there that could hold one, the one
// with the lowest draw. Rare, and never in a pattern.
const SPECIAL_CELL = 3000, specialCells = new Map();
// (and two of a kind are never within 4.5 km: the one with the higher draw gives way)
function specialOf(sb) {
  const sp = specialCandidate(sb);
  if (!sp) return null;
  const a = Math.floor(sb.cx / SPECIAL_CELL), c = Math.floor(sb.cz / SPECIAL_CELL), best = cellSpecial(a, c);
  if (!best || best.seed !== sb.seed) return null;
  for (let da = -2; da <= 2; da++)
    for (let dc = -2; dc <= 2; dc++) {
      const o = (da || dc) && cellSpecial(a + da, c + dc);
      if (o && o.sp === sp && o.d < best.d && Math.hypot(o.x - sb.cx, o.z - sb.cz) < 4500) return null;
    }
  return sp;
}
function cellSpecial(a, c) {
  const key = a + ',' + c;
  let best = specialCells.get(key);
  if (best === undefined) {
    best = null;
    const xs = aveXs(a * SPECIAL_CELL - 700, (a + 1) * SPECIAL_CELL + 700), zs = aveZs(c * SPECIAL_CELL - 1400, (c + 1) * SPECIAL_CELL + 1400);
    for (let p = 0; p + 1 < xs.length; p++)
      for (let q = 0; q + 1 < zs.length; q++) {
        if (zs[q].kind === 'n') continue;
        const o = sbBasics(xs[p].i, zs[q], zs[q + 1]);
        if (Math.floor(o.cx / SPECIAL_CELL) !== a || Math.floor(o.cz / SPECIAL_CELL) !== c) continue;
        const sp = specialCandidate(o), d = ih(o.seed, 45);
        if (sp && (!best || d < best.d)) best = { d, seed: o.seed, sp, x: o.cx, z: o.cz };
      }
    if (specialCells.size > 400) specialCells.clear();
    specialCells.set(key, best);
  }
  return best;
}
function specialCandidate(sb) {
  const { kind, i, A } = sb;
  if ((i + A.m + A.k) & 1 || kind === 'downtown' || kind === 'park') return null;
  const w = sb.x1 - sb.x0, d = sb.z1 - sb.z0;
  if (w < 360 || d < 320) return null;
  const u = ih(sb.seed, 44), train = hasTrain(i) || hasTrain(i + 1);
  if (kind === 'industrial') return train && u < 0.3 ? 'railyard' : null;
  const city = kind === 'midtown' || kind === 'residential';
  if (city && u < (train ? 0.08 : 0.012)) return 'stadium';
  if (city && u > 0.97) return 'hospital';
  if ((city || kind === 'oldtown') && u > 0.94 && u <= 0.97) return 'campus';
  if ((kind === 'residential' || kind === 'suburb' || kind === 'oldtown') && u > 0.915 && u <= 0.94) return 'cemetery';
  if (kind === 'suburb' && u > 0.86 && u <= 0.915) return 'golf';
  return null;
}
const placeLabel = (sb) => SPECIALS[sb.special] || DISTRICTS[sb.kind].label;

// the streets inside a superblock and the blocks between them: sbLayout (layout.js)

// ---------- launch spots: Halvard Bay's six, then one in each kind of district nearby ----------
function findDistrict(kind, x0, z0) {
  for (let r = 0; r < 14; r++)
    for (let a = 0; a < 8 + r * 4; a++) {
      const ang = (a / (8 + r * 4)) * Math.PI * 2, x = x0 + Math.cos(ang) * r * 450, z = z0 + Math.sin(ang) * r * 450;
      const sb = superblockAt(x, z);
      if (sb.kind === kind) return sb;
    }
  return null;
}
function findSpecial(sp, x0, z0) {
  for (let r = 0; r < 26; r++)
    for (let a = 0; a < 8 + r * 4; a++) {
      const ang = (a / (8 + r * 4)) * Math.PI * 2, sb = superblockAt(x0 + Math.cos(ang) * r * 450, z0 + Math.sin(ang) * r * 450);
      if (sb.special === sp) return sb;
    }
  return null;
}
function launchSpots() {
  const r0 = riverSlot(0), sx = aveX(0), rz = (x) => riverZk(r0, x);
  const spots = [
    { name: 'Downtown avenue', pos: [sx + AVE.w / 2 + 1.8, 2.2, -120], at: [sx, 40, -700] },
    { name: 'Skyline across the river', pos: [190, 22, rz(190) + RIVER.hw + 30], at: [140, 110, -420] },
    { name: 'Ferris wheel', pos: [505, 26, rz(430) - 30], at: [430, 36, rz(430) - 125], mark: 'wheel' },
    { name: 'Above downtown', pos: [400, 420, -150], at: [150, 60, -420] },
    { name: 'Tower crane', pos: [430, 80, -430], at: [150, 60, -380], mark: 'crane' },
    { name: 'Suspension bridge', pos: [sx + 3.5, ROADY + RIVER.h + 2.2, rz(sx) + 22], at: [sx, 30, rz(sx) - 160] },
  ];
  // the nearest stadium (from its car park), rail yard (from the end of the tracks) and hospital
  // (on its helipad: a launch high up takes the roof below it)
  for (const [sp, name] of [['stadium', 'Stadium'], ['railyard', 'Rail yard'], ['hospital', 'Hospital helipad']]) {
    const sb = findSpecial(sp, 150, -200);
    if (!sb) continue;
    const h = AVE.w / 2, b = { x0: sb.x0 + h, z0: sb.z0 + h, x1: sb.x1 - h, z1: sb.z1 - h }; b.cx = (b.x0 + b.x1) / 2; b.cz = (b.z0 + b.z1) / 2;
    const P = specialPlan(sb, b), far = Math.hypot(sb.cx - 150, sb.cz + 200);
    if (sp === 'stadium') spots.push({ name, pos: [P.cx - P.rx - 75, 2, P.cz - 30], at: [P.cx, 15, P.cz], far });
    else if (sp === 'railyard') spots.push({ name, pos: [b.cx + 2.7, 2, b.z0 + 9], at: [b.cx, 10, b.z1 - 60], far });
    else spots.push({ name, pos: [P.cx - 30, 95, P.cz - 30], at: [P.cx + 400, 10, P.cz + 300], far });
  }
  for (const [kind, name] of [['oldtown', 'Old town'], ['docks', 'The docks'], ['industrial', 'Industrial zone'], ['suburb', 'Suburbs']]) {
    const sb = findDistrict(kind, 150, -200);
    if (!sb) continue;
    // on one of its streets, looking along it (the docks: on the quay)
    let pos = [sb.cx, 3, sb.z0], dir = [1, 0];
    const L = sb.kind === 'docks' ? null : sbLayout(sb), road = L && L.roads[0];
    if (sb.kind === 'docks') pos = [sb.cx, 3, sb.z0 + AVE.w / 2 + 2];
    else if (road) {
      const l = Math.hypot(road.bx - road.ax, road.bz - road.az);
      pos = [(road.ax + road.bx) / 2, 3, (road.az + road.bz) / 2]; dir = [(road.bx - road.ax) / l, (road.bz - road.az) / l];
    }
    spots.push({ name, pos, at: [pos[0] + dir[0] * 400, 25, pos[2] + dir[1] * 400], far: Math.hypot(sb.cx - 150, sb.cz + 200) });
  }
  return spots;
}
