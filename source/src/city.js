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
    : { k, zc: RIVER.z0 + k * RIVER.period + (ih(k, 11) - 0.5) * 1400, on: ih(k, 12) < 0.6, hw: 32 + 63 * Math.pow(ih(k, 19), 1.4),
        a1: 26 + 24 * ih(k, 13), f1: 0.0026 + 0.0024 * ih(k, 14), p1: 6.2832 * ih(k, 15),
        a2: 5 + 9 * ih(k, 16), f2: 0.006 + 0.006 * ih(k, 17), p2: 6.2832 * ih(k, 18) };
  // rivers run from 64 to 190 m wide; a wide one has less room to wind in its row
  if (k !== 0) { const f = Math.min(1, (125 - r.hw) / (r.a1 + r.a2)); r.a1 *= f; r.a2 *= f; }
  // the riverside row (drive to drive) fits its river: room for the bends, the ramps and a strip of
  // bank, wider or narrower from one river to the next
  r.row = k === 0 ? RIVER.row : Math.max(125, Math.min(200, r.hw + r.a1 + r.a2 + 58 + 45 * ih(k, 20)));
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
// What carries north-south avenue i over river r: Halvard Bay's suspension bridge at the origin;
// elsewhere a bridge every second or third avenue (each river has its own rhythm), of one kind or
// another, the big ones on wide rivers; between them the avenue ends at the riverside, at a lookout
// with room to turn round ('end'). In a port nothing crosses (the ships need the water): on each bank
// the avenue ends at the port's gate ('gate').
function crossingOf(i, r) {
  if (i === 0 && r.k === 0) return 'suspension';
  const u = ih2(i, r.k, 62);
  if (portAt(i, r)) return 'gate';
  const per = ih(r.k, 66) < 0.5 ? 2 : 3, off = Math.floor(ih(r.k, 67) * per);
  if ((((i + off) % per) + per) % per !== 0) return 'end';
  const uu = (j) => ih2(j, r.k, 62);
  // the big bridges (suspension, cable-stayed) are few and far apart, and arches do not come in a row
  const alone = (lo, hi, n) => [-3, -2, -1, 1, 2, 3].slice(3 - n, 3 + n).every((d) => uu(i + d) <= lo || uu(i + d) > hi || u > uu(i + d));
  // where the railway crosses on the same avenue, the road bridge is a plain one under the rail bridge
  if (trainCrosses(i, r.k)) return 'girder';
  if (u > 0.955 && r.hw > 55 && alone(0.955, 1, 3)) return 'suspension';
  if (u > 0.84 && u <= 0.955 && r.hw > 45 && alone(0.84, 0.955, 2)) return 'cable';
  const archBand = (v) => v > 0.68 && v <= 0.84;
  if (archBand(u) && !archBand(uu(i - 1))) return 'arch';
  return 'girder';
}
// a port at avenue i on river r: the docks on either side of it
function portAt(i, r) {
  const L = zLinesOf(r.k), A = L.find((l) => l.kind === 'n'), B = L.find((l) => l.kind === 's');
  return superblock(i, A, B).kind === 'docks' || superblock(i - 1, A, B).kind === 'docks';
}
// a port gate: the avenue runs on past the riverside drive to the gate's doors (door m in); the traffic
// turns round in front of it (turn m in), see aveStretch. A lookout's road ends at stub m in.
const PORT_GATE = { turn: 17, door: 32, stub: 26 };
// where avenue i ends at river k (a port's gates or a lookout on each bank): [north end, south end],
// or null where it crosses
const gateCache = new Map();
function gateEnds(i, k) {
  const key = i + ',' + k;
  let g = gateCache.get(key);
  if (g !== undefined) return g;
  const r = riverSlot(k);
  g = null;
  const c = r.on && crossingOf(i, r);
  if (c === 'gate' || c === 'end') {
    const L = zLinesOf(k), A = L.find((l) => l.kind === 'n'), B = L.find((l) => l.kind === 's');
    g = [A.z + PORT_GATE.turn, B.z - PORT_GATE.turn];
  }
  if (gateCache.size > 8192) gateCache.clear();
  gateCache.set(key, g);
  return g;
}
// The stretch of north-south avenue i around z between two port gates: [e0, e1] (+-1e7 where it runs
// on). Its traffic drives up to one end, turns round and comes back (carPose), so no car ever pops.
function aveStretch(i, z) {
  let e0 = -1e7, e1 = 1e7;
  const k0 = riverK(z);
  for (let k = k0 - 1; k <= k0 + 25; k++) { const g = gateEnds(i, k); if (g && g[0] >= z) { e1 = g[0]; break; } }
  for (let k = k0 + 1; k >= k0 - 25; k--) { const g = gateEnds(i, k); if (g && g[1] <= z) { e0 = g[1]; break; } }
  return [e0, e1];
}
function inRiver(x, z) { const r = riverAt(z); return !!r && Math.abs(z - riverZk(r, x)) < r.hw + 0.5; }

// ---------- the avenue grid ----------
// North-south avenues come in runs of eight that span exactly eight periods; inside a run the gaps are
// drawn between 300 and 650 m (as in a real city, some blocks long, some short). The first gap of the
// run at the origin is fixed, so Halvard Bay's downtown keeps its avenue at x = 150 and its width.
const AVE_RUN = 8, aveRuns = new Map();
function aveRun(g) {
  let o = aveRuns.get(g);
  if (o) return o;
  const raw = [];
  for (let j = 0; j < AVE_RUN; j++) raw.push(g === 0 && j === 0 ? 480 : 300 + 350 * ih2(g, j, 21));
  const f = (AVE_RUN * AVE.period) / raw.reduce((a, b) => a + b, 0);
  o = [0];
  for (let j = 0; j < AVE_RUN - 1; j++) o.push(o[j] + raw[j] * f);
  if (aveRuns.size > 256) aveRuns.clear();
  aveRuns.set(g, o);
  return o;
}
const aveX = (i) => { const g = Math.floor(i / AVE_RUN); return AVE.x0 + g * AVE_RUN * AVE.period + aveRun(g)[i - g * AVE_RUN]; };
// the north-south avenues between x0 and x1
function aveXs(x0, x1) {
  const out = [];
  for (let i = Math.floor((x0 - AVE.x0) / AVE.period) - 3; i <= Math.ceil((x1 - AVE.x0) / AVE.period) + 3; i++) {
    const x = aveX(i);
    if (x >= x0 && x <= x1) out.push({ i, x });
  }
  return out;
}
// the east-west avenues from river slot k to the next: the two riverside drives if there is a
// river, then lines between with gaps drawn from 300 to 650 m and scaled to fit
const zLineCache = new Map();
function zLinesOf(k) {
  let out = zLineCache.get(k);
  if (out) return out;
  const r = riverSlot(k), n = riverSlot(k + 1);
  out = [];
  if (r.on) { out.push({ z: r.zc - r.row, k, m: -1, kind: 'n' }); out.push({ z: r.zc + r.row, k, m: 0, kind: 's' }); }
  else out.push({ z: r.zc, k, m: 0, kind: '' });
  const a = r.zc + (r.on ? r.row : 0), b = n.zc - (n.on ? n.row : 0), g = b - a, cnt = Math.max(1, Math.round(g / AVE.period));
  const raw = [];
  for (let m = 0; m < cnt; m++) raw.push(300 + 350 * ih2(k, m, 22));
  const f = g / raw.reduce((s, v) => s + v, 0);
  let z = a;
  for (let m = 1; m < cnt; m++) { z += raw[m - 1] * f; out.push({ z, k, m, kind: '' }); }
  if (zLineCache.size > 64) zLineCache.clear();
  zLineCache.set(k, out);
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
// ---------- the elevated railway ----------
// Closed loops, as Halvard Bay's line always was: up one avenue (a leg), along an east-west avenue (an
// end), down another avenue two or three further on, back along another east-west avenue, the corners
// rounded over the junctions (radius TRAIN.R). Along a pair of legs the loops come one after another, a
// block apart: one across each river, on its own rail bridge, and one between the rivers. Trains go
// round on two tracks, one each way, and never stop being somewhere (shaders.js trainPath).
const TRAIN = { R: 24, o: 1.1, v: 17, car: 16 };
const trainSeed = (i) => i === -1 || ((i < -4 || i > 2) && ih(i, 61) < 0.16);
// the west leg of a pair (the next three avenues start none), and how many avenues on its east leg is
const trainWest = (i) => trainSeed(i) && !trainSeed(i + 1) && !trainSeed(i + 2) && !trainSeed(i + 3);
const trainSpan = (i) => (i !== -1 && ih(i, 68) < 0.4 && aveX(i + 3) - aveX(i) < 1500 ? 3 : 2);
// the pair of legs avenue i is one of, [west, east], or null
function trainPair(i) {
  if (trainWest(i)) return [i, i + trainSpan(i)];
  for (const d of [2, 3]) if (trainWest(i - d) && trainSpan(i - d) === d) return [i - d, i];
  return null;
}
const hasTrain = (i) => !!trainPair(i);
// the pair whose loops span avenue i (a leg or between them), or null
function trainPairOver(i) {
  for (let w = i; w >= i - 3; w--) if (trainWest(w) && w + trainSpan(w) >= i) return [w, w + trainSpan(w)];
  return null;
}
// the east-west avenues of slot k south of its river (or of its own line where there is no river)
const innerLines = (k) => zLinesOf(k).filter((l) => l.kind === '' && l.m >= 1);
// does pair p's loop across river slot k exist? (never through a port: the ships need the water)
function riverLoopOK(p, k) {
  const r = riverSlot(k);
  if (!innerLines(k).length || !innerLines(k - 1).length) return false;
  return !(r.on && (portAt(p[0], r) || portAt(p[1], r)));
}
const trainCrosses = (i, k) => { const p = trainPair(i); return !!p && riverSlot(k).on && riverLoopOK(p, k); };
// the loops of pair p that belong to slot k: the one across its river (from the last line of slot k-1
// to the first past the river), and the one between that river and the next
const loopCache = new Map();
function trainLoops(p, k) {
  const key = p[0] + ',' + k;
  let out = loopCache.get(key);
  if (out) return out;
  out = [];
  const x0 = aveX(p[0]), x1 = aveX(p[1]), S = innerLines(k), N = innerLines(k - 1);
  const mk = (a, b, river) => ({ x0, x1, z0: a.z, z1: b.z, p, river, A: a, B: b });
  const here = riverLoopOK(p, k), next = riverLoopOK(p, k + 1);
  if (here) out.push(mk(N[N.length - 1], S[0], riverSlot(k).on ? riverSlot(k) : null));
  const lo = here ? 1 : 0, hi = next ? S.length - 2 : S.length - 1;
  if (hi - lo >= 1) out.push(mk(S[lo], S[hi], null));
  if (loopCache.size > 512) loopCache.clear();
  loopCache.set(key, out);
  return out;
}
// the loops reaching into the rectangle x0..x1, z0..z1
function loopsNear(x0, z0, x1, z1) {
  const out = [];
  for (let i = Math.floor((x0 - 2000 - AVE.x0) / AVE.period) - 3; i <= Math.ceil((x1 - AVE.x0) / AVE.period) + 3; i++) {
    if (!trainWest(i)) continue;
    const p = [i, i + trainSpan(i)];
    if (aveX(p[0]) > x1 + 30 || aveX(p[1]) < x0 - 30) continue;
    for (let k = riverK(z0) - 1; k <= riverK(z1) + 1; k++)
      for (const L of trainLoops(p, k)) if (L.z0 < z1 + 30 && L.z1 > z0 - 30) out.push(L);
  }
  return out;
}
// is the east-west avenue l, where it meets avenue i, an end of a loop? (the loop, or null)
function loopEndAt(i, l) {
  const p = trainPairOver(i);
  if (!p) return null;
  for (const k of [l.k, l.k + 1]) for (const L of trainLoops(p, k)) if (Math.abs(L.z0 - l.z) < 0.5 || Math.abs(L.z1 - l.z) < 0.5) return L;
  return null;
}
// the trains of a loop: which way each goes (dir +1 the inner track, clockwise) and where its head
// is at time 0, in metres round the loop (the same for the piece that draws them and for their sound)
function loopTrains(L) {
  const R = TRAIN.R, rng = mulberry32(pcg(Math.round(L.x0) ^ pcg(Math.round(L.z0)))), out = [];
  for (const dir of [1, -1]) {
    const len = 2 * (L.x1 - L.x0 - 2 * R) + 2 * (L.z1 - L.z0 - 2 * R) + 2 * Math.PI * (R - dir * TRAIN.o);
    const n = Math.max(1, Math.round(len / 1300)), ph = rng() * len;
    for (let t = 0; t < n; t++) out.push({ dir, s0: ph + (t * len) / n });
  }
  return out;
}
// where a train is, s metres round loop L on the track o m outside the centre line: [x, z]
// (shaders.js trainPath)
function trainPos(L, s0, o) {
  const R = TRAIN.R + o, x0 = L.x0 + TRAIN.R, x1 = L.x1 - TRAIN.R, z0 = L.z0 + TRAIN.R, z1 = L.z1 - TRAIN.R, a = x1 - x0, b = z1 - z0, c = (Math.PI / 2) * R, len = 2 * (a + b) + 4 * c;
  let s = s0 - Math.floor(s0 / len) * len;
  if (s < a) return [x0 + s, z0 - R]; s -= a;
  if (s < c) { const g = -Math.PI / 2 + s / R; return [x1 + R * Math.cos(g), z0 + R * Math.sin(g)]; } s -= c;
  if (s < b) return [x1 + R, z0 + s]; s -= b;
  if (s < c) { const g = s / R; return [x1 + R * Math.cos(g), z1 + R * Math.sin(g)]; } s -= c;
  if (s < a) return [x1 - s, z1 + R]; s -= a;
  if (s < c) { const g = Math.PI / 2 + s / R; return [x0 + R * Math.cos(g), z1 + R * Math.sin(g)]; } s -= c;
  if (s < b) return [x0 - R, z1 - s]; s -= b;
  const g = Math.PI + s / R; return [x0 + R * Math.cos(g), z0 + R * Math.sin(g)];
}
// industry gathers along the railway and the rivers
function industryPull(x, z) {
  let i = Math.floor((x - AVE.x0) / AVE.period);
  while (aveX(i) > x) i--;
  while (aveX(i + 1) <= x) i++;
  let t = 0;
  for (const j of [i, i + 1]) if (trainWest(j)) t = Math.max(t, smooth(320, 90, Math.abs(x - aveX(j))));
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
  const r0 = riverSlot(0), sx = aveX(0), rz = (x) => riverZk(r0, x), wx = (aveX(0) + aveX(1)) / 2;   // the Ferris wheel's x
  const spots = [
    { name: 'Downtown avenue', pos: [sx + AVE.w / 2 + 1.8, 2.2, -120], at: [sx, 40, -700] },
    { name: 'Skyline across the river', pos: [190, 22, rz(190) + RIVER.hw + 30], at: [140, 110, -420] },
    { name: 'Ferris wheel', pos: [wx + 75, 26, rz(wx) - 30], at: [wx, 36, rz(wx) - 125], mark: 'wheel' },
    { name: 'Above downtown', pos: [400, 420, -150], at: [150, 60, -420] },
    { name: 'Tower crane', pos: [430, 80, -430], at: [150, 60, -380], mark: 'crane' },
    { name: 'Suspension bridge', pos: [sx + 3.5, ROADY + RIVER.h + 2.2, rz(sx) + 22], at: [sx, 30, rz(sx) - 160] },
  ];
  // the railway's bridge over Halvard Bay's river, a truss where the road ends at the banks
  const tl = trainLoops(trainPair(-1), 0).find((L) => L.river);
  if (tl) { const x = tl.x0, z = riverZk(tl.river, x); spots.push({ name: 'Rail bridge', pos: [x + 45, 2, z - tl.river.hw - 18], at: [x, 17, z] }); }
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
