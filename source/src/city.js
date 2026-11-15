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
// two drives, 130 m either side of its line, with bridges where the avenues cross
const RIVER = { hw: 55, ramp: 45, h: 7, level: -0.8, period: 3000, z0: 150, row: 130 };
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
    ? { k, zc: RIVER.z0, on: true, hw: RIVER.hw, a1: 10, f1: 0.0023, p1: 0.7, a2: 5, f2: 0.0061, p2: 0 }
    : { k, zc: RIVER.z0 + k * RIVER.period + (ih(k, 11) - 0.5) * 1400, on: ih(k, 12) < 0.6, hw: 40 + 18 * ih(k, 19),
        a1: 6 + 8 * ih(k, 13), f1: 0.0014 + 0.0016 * ih(k, 14), p1: 6.2832 * ih(k, 15),
        a2: 2 + 4 * ih(k, 16), f2: 0.004 + 0.004 * ih(k, 17), p2: 6.2832 * ih(k, 18) };
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
// how strongly a downtown pulls here: Halvard Bay's at the origin, and others on a jittered 3.6 km grid
function coreField(x, z) {
  let c = Math.exp(-((x - 150) ** 2 + (z + 380) ** 2) / (520 * 520));
  const S = 3600, a0 = Math.floor(x / S), b0 = Math.floor(z / S);
  for (let a = a0 - 1; a <= a0 + 1; a++)
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      if ((a === 0 || a === -1) && (b === 0 || b === -1)) continue;   // around the origin there is only Halvard Bay's
      if (ih2(a, b, 31) > 0.8) continue;
      const px = (a + 0.15 + 0.7 * ih2(a, b, 32)) * S, pz = (b + 0.15 + 0.7 * ih2(a, b, 33)) * S;
      const s = 0.55 + 0.45 * ih2(a, b, 34), R = 420 + 380 * ih2(a, b, 35);
      c = Math.max(c, s * Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (R * R)));
    }
  return c;
}
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
  if (vnoise(x / 1800 + 17.3, z / 1800 - 3.1) > 0.7) return 'industrial';
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
function superblock(i, A, B) {
  const key = i + ',' + A.k + ',' + A.m;
  let sb = sbCache.get(key);
  if (sb) return sb;
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
  sb = { i, x0, x1, z0: A.z, z1: B.z, cx, cz, A, B, kind, seed, river: A.kind === 'n' ? riverSlot(A.k) : null };
  if (sbCache.size > 400) sbCache.clear();
  sbCache.set(key, sb);
  return sb;
}

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
