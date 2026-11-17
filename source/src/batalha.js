// ---------------------------------------------------------------------------
// batalha.js: the second map, Batalha (Piauí), a small town of the Brazilian northeast, at its real
// size. Its streets, squares, church, schools, market, stadium, cemeteries and creeks come from
// OpenStreetMap (batalha-data.js); what OSM does not have, the houses, the trees in the yards and the
// cerrado round the town, is made here the way the town looks from above: one-storey houses side by
// side along every street, their fronts on the pavement and orange tiled roofs, a yard behind with a
// mango tree, asphalt streets in town and red dirt roads on the edges, the bush all around.
// genBatalha makes a 256 m piece in the same form as genChunk (gen.js), so the streamer, the
// renderer and libfpv's collision take it as they take Halvard Bay. The ground is flat.
// ---------------------------------------------------------------------------

const BAT = { centre: [250, 40], half: 3300, cell: 64 };
let batCache = null;

// ---------- the data, read once (in each thread) ----------
function batalha() {
  if (batCache) return batCache;
  const roads = [], segs = [], areas = [], blds = [], points = [], streams = [];
  const H = BAT.half, inb = (p) => Math.abs(p[0]) <= H && Math.abs(p[1]) <= H;
  for (const line of BATALHA_OSM.split('\n')) {
    if (!line) continue;
    const [kind0, extra, geom] = line.split('|');
    const closed = kind0.endsWith('*'), kind = closed ? kind0.slice(0, -1) : kind0;
    const [name, surface, lanes, levels, oneway] = extra.split(';');
    const st = geom.split(' ').map((q) => q.split(',').map(Number));
    const pts = [[st[0][0], st[0][1]]];
    for (let i = 1; i < st.length; i++) pts.push([pts[i - 1][0] + st[i][0], pts[i - 1][1] + st[i][1]]);
    const [t, cls] = kind.split(':');
    if (t === 'p') { points.push({ kind: cls, name, x: pts[0][0], z: pts[0][1] }); continue; }
    if (t === 'h' || t === 'w') {
      // only the part on the map: runs of points with one end inside
      let run = [];
      const flush = () => { if (run.length > 1) (t === 'h' ? roads : streams).push({ cls, name, surface, lanes: +lanes || 0, oneway: !!oneway, pts: run }); run = []; };
      for (let i = 0; i < pts.length; i++) {
        if (inb(pts[i]) || (i > 0 && inb(pts[i - 1])) || (i + 1 < pts.length && inb(pts[i + 1]))) run.push(pts[i]); else flush();
      }
      flush();
      continue;
    }
    const poly = convexHull(pts.map(([x, z]) => ({ x, z })));
    const item = { t, cls, name, levels: +levels || 0, poly, box: polyBox(poly), c: polyCentroid(poly), rect: fitRect(poly) };
    (t === 'b' ? blds : areas).push(item);
  }
  // each road: how wide, what it is made of, and its straight pieces
  roads.forEach((r, ri) => {
    const mid = r.pts[r.pts.length >> 1], rc = Math.hypot(mid[0] - BAT.centre[0], mid[1] - BAT.centre[1]);
    let w = 7, surf = 'asphalt';
    switch (r.cls) {
      case 'primary': case 'primary_link': w = r.cls === 'primary' ? 10 : 7; surf = 'asphalt'; break;
      case 'secondary': w = 8.5; surf = 'asphalt'; break;
      case 'tertiary': w = 7; surf = rc < 900 ? 'asphalt' : 'dirt'; break;
      case 'unclassified': w = 6; surf = rc < 1100 ? 'asphalt' : 'dirt'; break;
      case 'track': case 'service': w = 4; surf = 'dirt'; break;
      default: w = 7; surf = 'asphalt';
    }
    if (r.surface === 'unpaved') surf = 'dirt';
    if (r.surface === 'asphalt') surf = 'asphalt';
    if (r.oneway && r.cls === 'primary') w = 7;
    r.w = w; r.surf = surf; r.id = ri;
    r.town = r.cls !== 'track' && r.cls !== 'service';
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      segs.push({ r, i: segs.length, ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len, hw: w / 2 });
    }
  });
  // a grid of cells, each listing the pieces of road near it
  const grid = new Map(), C = BAT.cell, key = (i, j) => i * 100003 + j;
  for (const s of segs) {
    const pad = s.hw + 48;
    for (let i = Math.floor((Math.min(s.ax, s.bx) - pad) / C); i <= Math.floor((Math.max(s.ax, s.bx) + pad) / C); i++)
      for (let j = Math.floor((Math.min(s.az, s.bz) - pad) / C); j <= Math.floor((Math.max(s.az, s.bz) + pad) / C); j++) {
        const k = key(i, j);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(s);
      }
  }
  const streamSegs = [];
  for (const s of streams) for (let i = 0; i + 1 < s.pts.length; i++) {
    const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len > 0.5) streamSegs.push({ ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len, name: s.name });
  }
  batCache = {
    roads, segs, areas, blds, points, streams, streamSegs,
    near(x, z) { return grid.get(key(Math.floor(x / C), Math.floor(z / C))) || []; },
  };
  // The church's block is all forecourt and paving (OSM tags the squares round it, not this one):
  // from the church out to the street on each of its four sides, along and across its long axis
  const ch = blds.find((q) => q.name === 'Igreja Matriz');
  batCache.church = ch;
  if (ch) {
    // out from the church in every direction to the edge of the street: the block's outline
    const ox = ch.rect.x, oz = ch.rect.z, poly = [];
    for (let k = 0; k < 160; k++) {
      const g = (k / 160) * Math.PI * 2, dx = Math.cos(g), dz = Math.sin(g);
      let t = 0;
      while (t < 220) { t += 0.75; const [cl] = roadClear(batCache, ox + dx * t, oz + dz * t, null); if (cl < 1.0) break; }
      poly.push({ x: ox + dx * (t - 0.5), z: oz + dz * (t - 0.5) });
    }
    poly.splice(0, poly.length, ...convexHull(poly));
    areas.push({ t: 'a', cls: 'adro', name: 'Adro da Matriz', levels: 0, poly, box: polyBox(poly), c: polyCentroid(poly), rect: fitRect(poly) });
  }
  return batCache;
}

// the convex hull of some points (the polygon helpers in layout.js take convex polygons), anticlockwise
function convexHull(pts) {
  const P = [...pts].sort((a, b) => a.x - b.x || a.z - b.z), cr = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const h = lo.slice(0, -1).concat(hi.slice(0, -1));
  return polyArea(h) < 0 ? h.reverse() : h;
}
// the oriented rectangle round a polygon, lined up with its longest edge: centre, half sizes, yaw (TM.yaw)
function fitRect(poly) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > best) { best = l; ux = (b.x - a.x) / l; uz = (b.z - a.z) / l; }
  }
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of poly) { const s = p.x * ux + p.z * uz, t = -p.x * uz + p.z * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
  return { x: sc * ux - tc * uz, z: sc * uz + tc * ux, hx: (s1 - s0) / 2, hz: (t1 - t0) / 2, ux, uz, yaw: Math.atan2(-uz, ux) };
}
// half sizes for a rectangle round (r.x, r.z) turned by r.yaw that keep it off the asphalt by gap:
// OSM's outlines sometimes reach a little into the street they front, so they are made smaller
function clearHalf(D, r, hx, hz, gap = 0.8) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), W = (lx, lz) => [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
  const worst = (hx, hz) => {
    let m = Infinity;
    for (const [ax, az, bx, bz] of [[-hx, -hz, hx, -hz], [hx, -hz, hx, hz], [hx, hz, -hx, hz], [-hx, hz, -hx, -hz]]) {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75);
      for (let k = 0; k <= n; k++) m = Math.min(m, roadClear(D, ...W(ax + (bx - ax) * k / n, az + (bz - az) * k / n), null)[0]);
    }
    return m;
  };
  for (let i = 0; i < 60 && worst(hx, hz) < gap; i++) { hx = Math.max(hx - 0.5, hx * 0.5 + 1); hz = Math.max(hz - 0.5, hz * 0.5 + 1); }
  return [hx, hz];
}
function segDist(s, x, z) {
  const t = clamp((x - s.ax) * s.ux + (z - s.az) * s.uz, 0, s.len);
  return Math.hypot(x - (s.ax + s.ux * t), z - (s.az + s.uz * t));
}
// how far (x, z) is from the edge of the nearest road (but road skip), and that road's piece
function roadClear(D, x, z, skip) {
  let best = Infinity, bs = null;
  for (const s of D.near(x, z)) {
    if (s === skip) continue;
    const d = segDist(s, x, z) - s.hw;
    if (d < best) { best = d; bs = s; }
  }
  return [best, bs];
}
function streamDist(D, x, z) {
  let best = Infinity;
  for (const s of D.streamSegs) {
    if (Math.abs(x - (s.ax + s.bx) / 2) > s.len / 2 + 80 || Math.abs(z - (s.az + s.bz) / 2) > s.len / 2 + 80) continue;
    best = Math.min(best, segDist(s, x, z));
  }
  return best;
}
// is (x, z) in the church's block: near it, with no street between them?
function churchBlock(D, x, z) {
  const ch = D.church;
  if (!ch) return false;
  const dx = x - ch.rect.x, dz = z - ch.rect.z, d = Math.hypot(dx, dz);
  if (d > 110) return false;
  for (let t = 0; t < d; t += 1.5) { const [cl] = roadClear(D, ch.rect.x + dx * t / d, ch.rect.z + dz * t / d, null); if (cl < 0.3) return false; }
  return true;
}
function inAreas(D, x, z, pad = 0) {
  if (D.church && churchBlock(D, x, z)) return D.church;
  for (const a of D.areas) {
    if (x < a.box.x0 - pad || x > a.box.x1 + pad || z < a.box.z0 - pad || z > a.box.z1 + pad) continue;
    if (insidePoly(a.poly, x, z)) return a;
  }
  for (const b of D.blds) {
    if (x < b.box.x0 - 2 || x > b.box.x1 + 2 || z < b.box.z0 - 2 || z > b.box.z1 + 2) continue;
    const r = b.rect, dx = x - r.x, dz = z - r.z, s = dx * r.ux + dz * r.uz, t = -dx * r.uz + dz * r.ux;
    if (Math.abs(s) < r.hx + 2 && Math.abs(t) < r.hz + 2) return b;
  }
  return null;
}
// how built-up the town is at (x, z): 1 in the centre, thinning out towards the edges
function batDensity(x, z) {
  const r = Math.hypot(x - BAT.centre[0], z - BAT.centre[1]);
  return clamp(1.02 - smooth(650, 2100, r) * 0.62 - smooth(2100, 3000, r) * 0.25, 0, 1) * (0.78 + 0.32 * vnoise(x / 380 + 3.1, z / 380 - 7.7));
}

// ---------- the houses along one side of one piece of road ----------
// Lots one after another from the start of the piece, each a house on the pavement and a yard
// behind; a lot is left empty (a vacant plot) now and then, more often on the edges of town, and
// never where it would reach into another street, a square, a school or a creek.
const lotCache = new Map();
function lotsOf(D, s, side) {
  const key = s.i * 2 + (side > 0 ? 1 : 0);
  let out = lotCache.get(key);
  if (out) return out;
  out = [];
  lotCache.set(key, out);
  if (lotCache.size > 6000) lotCache.clear();
  const r = s.r;
  if (!r.town || s.len < 9) return out;
  const rng = mulberry32(pcg(key * 7919 + 13));
  const nx = -s.uz * side, nz = s.ux * side;      // into the lot
  const walk = 1.6;                               // the pavement
  let t = 3 + rng() * 4;
  while (t < s.len - 5) {
    const mx = s.ax + s.ux * t, mz = s.az + s.uz * t, dens = batDensity(mx, mz);
    const centre = dens > 0.85;
    const w = centre ? 5.5 + rng() * 5 : 7 + rng() * 7;
    if (t + w > s.len - 2) break;
    const u = rng(), cls = r.cls;
    let p = dens * (cls === 'track' || cls === 'service' ? 0 : cls === 'unclassified' || r.surf === 'dirt' ? 0.6 : 1);
    if (cls === 'primary' && dens < 0.55) p *= 0.4;
    const t0 = t;
    t += w;
    if (u > p) { if (rng() < 0.4) t += 3 + rng() * 10; continue; }
    const tc = t0 + w / 2, set = centre ? 0 : rng() < 0.55 ? 0 : 1.5 + rng() * 3;
    const fx = s.ax + s.ux * tc + nx * (s.hw + walk + set), fz = s.az + s.uz * tc + nz * (s.hw + walk + set);
    const hd = Math.min(centre ? 11 + rng() * 9 : 8 + rng() * 6, 22);
    let depth = hd + 6 + rng() * 14;
    // the corners of the house must keep off every other street (corner lots: off the side street)
    const at = (a, d) => [fx + s.ux * a + nx * d, fz + s.uz * a + nz * d];
    const corners = [at(-w / 2 + 0.3, 0.3), at(w / 2 - 0.3, 0.3), at(-w / 2 + 0.3, hd), at(w / 2 - 0.3, hd), at(0, hd / 2)];
    let ok = true;
    for (const [x, z] of corners) {
      const [d] = roadClear(D, x, z, s);
      if (d < 1.8) { ok = false; break; }
      if (inAreas(D, x, z)) { ok = false; break; }
    }
    if (!ok || streamDist(D, fx + nx * hd / 2, fz + nz * hd / 2) < 9) continue;
    // the yard ends halfway to the street behind
    for (const d of [depth, depth * 0.75, hd + 3]) {
      const [x, z] = at(0, d), [cl] = roadClear(D, x, z, s);
      depth = d;
      if (cl > d * 0.5 + 1) break;
    }
    const h = rng();
    out.push({
      fx, fz, w, hd, depth: Math.max(depth, hd + 1), nx, nz, set,
      seed: pcg(key * 131 + Math.round(t0 * 10)),
      storeys: centre && h < 0.16 ? 2 : 1,
      shop: (centre && h > 0.55) || (cls === 'primary' && dens > 0.55 && h > 0.6),
      flat: !centre && h > 0.72,
    });
  }
  return out;
}

// ---------- roofs ----------
// A pitched roof of two tiled slopes meeting at the ridge, with eaves overhanging the walls, and the
// gable ends closed with a triangle of wall (a diamond prism exactly the size of the walls below:
// its lower half is inside them, so nothing shows under the eaves). In world coordinates: the
// middle of the top of the walls (cx, cz), the ridge's direction (dx, dz), the walls' length along it
// and half width across it, the top of the walls H. Returns the ridge's height above H.
function pitchedRoof(K, cx, cz, dx, dz, len, hw, H, col, wallCol, over = 0.45) {
  const { G } = K, rh = Math.min(hw * 0.55, 4.5), a = Math.atan2(rh, hw), sn = Math.sin(a), cs = Math.cos(a);
  const slope = Math.hypot(hw, rh) + over;
  K.setFrame(cx, cz, Math.atan2(-dz, dx) || 1e-9);
  // the slopes: local x the ridge, +z the one side, -z the other
  for (const side of [1, -1]) {
    // TM.pitch turns local +z to (0, -s, c): this side's slope falls away from the ridge
    const m = TM.pitch(0, 0, 0, len + 2 * over, 0.16, slope, side * sn, cs);
    // centred halfway down it from the ridge
    m[7] = H + rh - sn * (slope / 2) + 0.08; m[11] = side * cs * (slope / 2);
    K.basic(G.cube, m, col);
  }
  // the gable ends: wall, exactly over the walls
  const sq = hw * Math.SQRT2, g = TM.pitch(0, H, 0, len - 0.02, sq, sq, Math.SQRT1_2, Math.SQRT1_2);
  g[5] *= rh / hw; g[6] *= rh / hw;
  K.basic(G.cube, g, wallCol);
  K.collider(-len / 2, H, -hw * 0.5, len / 2, H + rh * 0.55, hw * 0.5);
  K.clearFrame();
  return rh;
}
// the same over an axis-aligned rectangle in the current frame (x0, z0)-(x1, z1), ridge along its
// longer side; the frame is put back afterwards
function roofRect(K, x0, z0, x1, z1, H, col, wallCol, frame) {
  const w = x1 - x0, d = z1 - z0, alongX = w >= d;
  const [cx, cz] = K.toWorld((x0 + x1) / 2, (z0 + z1) / 2), [ex, ez] = K.toWorld(alongX ? (x0 + x1) / 2 + 1 : (x0 + x1) / 2, alongX ? (z0 + z1) / 2 : (z0 + z1) / 2 + 1);
  const rh = pitchedRoof(K, cx, cz, ex - cx, ez - cz, alongX ? w : d, (alongX ? d : w) / 2, H, col, wallCol);
  if (frame) K.setFrame(frame[0], frame[1], frame[2] || 1e-9);
  return rh;
}

const HOUSE_WALLS = [
  [0.78, 0.76, 0.7], [0.8, 0.74, 0.55], [0.75, 0.62, 0.38], [0.6, 0.72, 0.78], [0.62, 0.76, 0.6], [0.82, 0.6, 0.58],
  [0.7, 0.7, 0.72], [0.85, 0.82, 0.74], [0.62, 0.5, 0.42], [0.86, 0.75, 0.42], [0.55, 0.64, 0.8],
];
const TILES_BAT = [[0.42, 0.17, 0.08], [0.38, 0.15, 0.07], [0.46, 0.21, 0.1], [0.34, 0.14, 0.08], [0.44, 0.24, 0.13]];
// one house, in its lot's own frame: local x along the street, local z into the lot
function batHouse(K, L) {
  const { G } = K;
  K.reseed(L.seed);
  const R = K.R, rd = K.rng;
  // the frame: origin at the middle of the house's front, local z into the lot (see makeKit)
  K.setFrame(L.fx, L.fz, Math.atan2(L.nx, L.nz) || 1e-9);
  const w = L.w, d = L.hd, H = L.storeys === 2 ? R(6.4, 7.2) : R(3.3, 4.1), fh = L.storeys === 2 ? H / 2 : H;
  const wall = K.pick(HOUSE_WALLS).map((c) => c * R(0.82, 1.05) * 0.55);
  K.push(G.cube, TM.box(0, H / 2, d / 2, w, H, d), [...wall, 0.15], [MAT.building, 0, K.seed(), L.shop ? 0.75 : 0], [6, fh, R(2.4, 3.2), R(0.3, 0.45)]);
  K.collider(-w / 2, 0, 0, w / 2, H, d);
  K.footRect(-w / 2, 0, w / 2, d);
  if (L.flat) {
    // a flat concrete roof with a low wall, and the blue water tank every house has
    K.basic(G.cube, TM.box(0, H + 0.35, d / 2, w + 0.2, 0.7, d + 0.2), wall.map((c) => c * 0.8));
    K.collider(-w / 2, H, 0, w / 2, H + 0.7, d);
    if (rd() < 0.8) { const tx = R(-w / 4, w / 4), tz = d * R(0.3, 0.7); K.basic(G.cyl, TM.box(tx, H + 1.4, tz, 1.5, 1.4, 1.5), [0.06, 0.12, 0.3]); K.collider(tx - 0.75, H, tz - 0.75, tx + 0.75, H + 2.1, tz + 0.75); }
  } else {
    roofRect(K, -w / 2, 0, w / 2, d, H, K.pick(TILES_BAT).map((c) => c * R(0.85, 1.1)), wall, [L.fx, L.fz, Math.atan2(L.nx, L.nz)]);
  }
  // the front: a wall and a gate where the house stands back from the pavement
  if (L.set > 0.5) {
    K.basic(G.cube, TM.box(0, 0.75, -L.set + 0.1, w, 1.5, 0.2), wall.map((c) => c * 0.9));
    K.collider(-w / 2, 0, -L.set, w / 2, 1.5, -L.set + 0.2);
  }
  // the yard: a mango tree or two
  const yard = L.depth - d;
  if (yard > 4 && K.full) {
    K.layRect(-w / 2, d, w / 2, L.depth, 10);
    if (rd() < 0.62 * K.Q.trees + 0.08) K.tree(R(-w / 3, w / 3), d + yard * R(0.35, 0.75), R(1.0, 1.55));
    if (yard > 12 && rd() < 0.3) K.tree(R(-w / 3, w / 3), d + yard * R(0.6, 0.9), R(0.8, 1.2));
  }
  K.clearFrame();
}

// (every K.setFrame here passes a non-zero angle: makeKit takes an angle of 0 as "no frame")
// ---------- the town's own buildings: OSM's footprints ----------
const BLD = {
  place_of_worship: { h: 9, wall: [0.55, 0.53, 0.48], style: 6, fh: 4.5 },
  townhall: { h: 8, wall: [0.5, 0.5, 0.47], style: 6, fh: 4 },
  school: { h: 4.6, wall: [0.5, 0.45, 0.35], style: 0, fh: 4.6 },
  public: { h: 7, wall: [0.5, 0.5, 0.5], style: 0, fh: 3.5 },
  commercial: { h: 5, wall: [0.45, 0.4, 0.3], style: 0, fh: 5, shop: 0.8 },
  yes: { h: 9, wall: [0.45, 0.45, 0.46], style: 3, fh: 9 },
};
function batBuilding(K, b) {
  const { G } = K, spec = BLD[b.cls] || BLD.yes;
  let r = b.rect;
  K.reseed(pcg(Math.round(r.x * 31 + r.z * 17)));
  if (b.name === 'Igreja Matriz') return matriz(K, b);
  const [hx, hz] = clearHalf(batalha(), r, r.hx, r.hz);
  r = { ...r, hx, hz };
  K.setFrame(r.x, r.z, r.yaw || 1e-9);
  const big = r.hx > 18 && r.hz > 12;
  const h = b.name.startsWith('Ginásio') ? 11 : spec.h;
  K.push(G.cube, TM.box(0, h / 2, 0, r.hx * 2, h, r.hz * 2), [...spec.wall, 0.2], [MAT.building, 0, K.seed(), spec.shop || 0], [spec.style, spec.fh, 3, spec.style === 3 ? 0 : 0.45]);
  K.collider(-r.hx, 0, -r.hz, r.hx, h, r.hz);
  K.footRect(-r.hx, -r.hz, r.hx, r.hz);
  // a sports hall's and a shed's roof: pale metal sheets; the rest: tiles
  if (big || b.cls === 'yes') { K.basic(G.cube, TM.box(0, h + 0.6, 0, r.hx * 2 + 0.8, 1.2, r.hz * 2 + 0.8), [0.3, 0.31, 0.32]); K.collider(-r.hx, h, -r.hz, r.hx, h + 1.2, r.hz); }
  else roofRect(K, -r.hx, -r.hz, r.hx, r.hz, h, K.pick(TILES_BAT), spec.wall.map((c) => c * 0.8));
  K.clearFrame();
}
// the Igreja Matriz, after photographs: white, on a raised paved forecourt with a wide flight of steps
// down to the street (a red strip up the middle, a statue at the top); the front with pilasters,
// the slender tower in the middle of it with a white spire and a cross; a nave and a transept under
// orange tiles, solar panels on one slope
function matriz(K, b) {
  const { G } = K, r = b.rect, fr = churchFrame(r), F = [fr.ox, fr.oz, fr.yaw];
  const L = Math.max(r.hx, r.hz), W = Math.min(r.hx, r.hz) * 0.72, white = [0.66, 0.65, 0.62], trim = [0.36, 0.4, 0.46];
  const P = 1.1, H = 10.5, pave = [0.3, 0.22, 0.18];
  // how far the block reaches from the church's centre, along and across it, to the kerb
  const D = batalha(), sx = Math.sin(fr.yaw), sz = Math.cos(fr.yaw);
  const reach = (ax, az) => { let t = 0; while (t < 120) { t += 0.5; const [cl] = roadClear(D, fr.ox + ax * t, fr.oz + az * t, null); if (cl < 0.6) break; } return t - 0.5; };
  const front = reach(sx, sz), back = reach(-sx, -sz), side = Math.min(reach(sz, -sx), reach(-sz, sx));
  K.setFrame(F[0], F[1], F[2] || 1e-9);
  // the forecourt and its steps (local z to the front), inside the block: the block's streets are
  // not square to the church, so the whole outline (steps included) is checked against them and the
  // forecourt made smaller until it keeps a metre off the asphalt everywhere
  const steps = 5, sd = 0.9;
  let fz1 = Math.max(L + 1.5, Math.min(L + 9, front - steps * sd - 0.3));
  let fz0 = Math.max(-L - 3, -back + 0.3), fw = Math.max(W + 0.6, Math.min(W + 9, side - 0.3));
  const clearOf = (x0, z0, x1, z1) => {
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75);
      for (let k = 0; k <= n; k++) {
        const lx = ax + (bx - ax) * k / n, lz = az + (bz - az) * k / n;
        if (roadClear(D, fr.ox + lx * sz + lz * sx, fr.oz - lx * sx + lz * sz, null)[0] < 1) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < 80 && !clearOf(-fw, fz0, fw, fz1 + steps * sd); i++) {
    // shrink the side that can still give: the width, then the front, then the back
    if (fw > W + 1.2) fw -= 0.5; else if (fz1 > L + 0.5) fz1 -= 0.5; else if (fz0 < -L - 0.2) fz0 += 0.5; else break;
  }
  K.basic(G.cube, TM.box(0, P / 2, (fz0 + fz1) / 2, fw * 2, P, fz1 - fz0), pave);
  K.collider(-fw, 0, fz0, fw, P, fz1);
  for (let k = 0; k < steps; k++) {
    const y = P - (k + 1) * (P / (steps + 1)), z = fz1 + sd / 2 + k * sd;
    K.basic(G.cube, TM.box(0, y / 2, z, fw * 2, y, sd), [0.5, 0.48, 0.45]);
    K.collider(-fw, 0, z - sd / 2, fw, y, z + sd / 2);
    K.basic(G.cube, TM.box(0, y + 0.005, z, 3.5, 0.02, 0.9), [0.42, 0.14, 0.12]);
  }
  K.basic(G.cube, TM.box(0, P + 0.005, (L + fz1) / 2, 3.5, 0.02, fz1 - L), [0.42, 0.14, 0.12]);
  K.basic(G.cube, TM.box(0, P + 0.6, fz1 - 1.5, 1.2, 1.2, 1.2), [0.5, 0.49, 0.46]);
  K.basic(G.cyl, TM.box(0, P + 2.1, fz1 - 1.5, 0.6, 1.8, 0.6), [0.12, 0.12, 0.13]);
  K.basic(G.sphere, TM.box(0, P + 3.15, fz1 - 1.5, 0.45, 0.5, 0.45), [0.12, 0.12, 0.13]);
  K.collider(-0.6, P, fz1 - 2.1, 0.6, P + 3.4, fz1 - 0.9);
  // the nave
  const nz0 = -L + 5, nz1 = L - 3;
  K.push(G.cube, TM.box(0, P + H / 2, (nz0 + nz1) / 2, W * 2, H, nz1 - nz0), [...white, 0.1], [MAT.building, 0, K.seed(), 0], [6, H, 4.5, 0.18]);
  K.collider(-W, P, nz0, W, P + H, nz1);
  K.footRect(-fw, fz0, fw, fz1);
  // the transept near the back, and the apse
  const tz = -L + 9, tw = Math.min(W + 6, fw - 0.5);
  K.push(G.cube, TM.box(0, P + H / 2, tz, tw * 2, H, 9), [...white, 0.1], [MAT.building, 0, K.seed(), 0], [6, H, 4.5, 0.18]);
  K.collider(-tw, P, tz - 4.5, tw, P + H, tz + 4.5);
  K.push(G.cube, TM.box(0, P + (H - 2) / 2, -L + 2.5, W * 1.4, H - 2, 5), [...white, 0.1], [MAT.building, 0, K.seed(), 0], [6, H, 4.5, 0]);
  K.collider(-W * 0.7, P, -L, W * 0.7, P + H - 2, -L + 5);
  const tile = [0.42, 0.17, 0.08];
  roofRect(K, -W, nz0, W, nz1, P + H, tile, white, F);
  roofRect(K, -tw, tz - 4.5, tw, tz + 4.5, P + H, tile, white, F);
  roofRect(K, -W * 0.7, -L, W * 0.7, -L + 5, P + H - 2, tile, white, F);
  // solar panels on the nave's east slope
  {
    const rh = Math.min(W * 0.55, 4.5), a = Math.atan2(rh, W);
    for (let k = 0; k < 3; k++) {
      // lying on the slope that falls towards +x: local x down the slope, y its normal, z along the nave
      const zc = nz0 + 6 + k * 4.6, xc = W * 0.45, yc = P + H + rh * 0.55 + 0.12, c = Math.cos(a), sn = Math.sin(a);
      K.basic(G.cube, [4 * c, -0.08 * sn, 0, xc, -4 * sn, 0.08 * c, 0, yc, 0, 0, 3.6, zc], [0.03, 0.05, 0.12]);
    }
  }
  // the front: a wall a little higher than the nave, with pilasters and a door, and the tower
  const fz = L - 3, fh = H + 2.5;
  K.push(G.cube, TM.box(0, P + fh / 2, fz + 0.6, W * 2 + 1.2, fh, 1.2), [...white, 0.1], [MAT.building, 0, K.seed(), 0], [6, fh, 3.6, 0]);
  K.collider(-W - 0.6, P, fz, W + 0.6, P + fh, fz + 1.2);
  for (const x of [-W - 0.3, -W * 0.45, W * 0.45, W + 0.3]) { K.basic(G.cube, TM.box(x, P + fh / 2, fz + 1.3, 0.7, fh, 0.3), trim); }
  K.basic(G.cube, TM.box(0, P + fh - 0.3, fz + 1.3, W * 2 + 1.4, 0.6, 0.35), trim);
  for (const x of [-W * 0.72, W * 0.72]) K.basic(G.cube, TM.box(x, P + 3.6, fz + 1.25, 1.1, 2.4, 0.1), [0.05, 0.06, 0.08]);
  const tw2 = 4.4, th = 22, tzc = fz + 1.2;
  K.push(G.cube, TM.box(0, P + th / 2, tzc, tw2, th, tw2), [...white, 0.1], [MAT.building, 0, K.seed(), 0], [6, th / 4, 2.2, 0.32]);
  K.collider(-tw2 / 2, P, tzc - tw2 / 2, tw2 / 2, P + th, tzc + tw2 / 2);
  for (const x of [-tw2 / 2 - 0.1, tw2 / 2 + 0.1]) K.basic(G.cube, TM.box(x, P + th / 2, tzc + tw2 / 2 + 0.05, 0.35, th, 0.3), trim);
  K.basic(G.cube, TM.box(0, P + 3, tzc + tw2 / 2 + 0.06, 1.8, 4, 0.1), [0.08, 0.06, 0.05]);
  K.push(G.cone, TM.box(0, P + th + 4.5, tzc, tw2 * 1.05, 9, tw2 * 1.05), [0.7, 0.69, 0.66, 0], [MAT.basic, 0, K.seed(), 0]);
  K.collider(-1.4, P + th, tzc - 1.4, 1.4, P + th + 6, tzc + 1.4);
  K.basic(G.cube, TM.box(0, P + th + 10, tzc, 0.22, 2.4, 0.22), [0.2, 0.2, 0.22]);
  K.basic(G.cube, TM.box(0, P + th + 10.5, tzc, 1.3, 0.22, 0.22), [0.2, 0.2, 0.22]);
  // the clock and the bell openings, lit at night
  K.emissive(G.cube, TM.box(0, P + th - 5, tzc + tw2 / 2 + 0.05, 1.5, 1.5, 0.05), [1, 0.92, 0.75], 1.3);
  for (const x of [-0.9, 0.9]) K.emissive(G.cube, TM.box(x, P + th - 1.8, tzc + tw2 / 2 + 0.05, 0.7, 1.8, 0.05), [1, 0.7, 0.35], 0.9);
  // the front lit from the square, lamps on the forecourt
  K.splat(0, L + 6, 0.95, 0.85, 0.65, 10);
  for (const x of [-fw + 1, fw - 1]) for (const z of [fz1 - 1, (fz0 + fz1) / 2]) { K.basic(G.cyl, TM.box(x, P + 2.5, z, 0.16, 5, 0.16), [0.08, 0.08, 0.09]); K.sprite(x, P + 5, z, LED, 4, 0.6); K.splat(x, z, 0.6, 0.65, 0.7, 7); }
  K.clearFrame();
}
// the church's frame: origin at its centre, local z to its front (the end towards +z, the square)
function churchFrame(r) {
  // the long axis
  let ax = r.hx >= r.hz ? r.ux : -r.uz, az = r.hx >= r.hz ? r.uz : r.ux;
  if (az < 0) { ax = -ax; az = -az; }
  // local z -> (s, c) in world (makeKit): s = ax, c = az
  return { ox: r.x, oz: r.z, yaw: Math.atan2(ax, az) };
}

// ---------- the town's areas: squares, schools, the market, the stadium, cemeteries ----------
function batArea(K, a, own, lc) {
  const { G } = K, r = a.rect;
  K.reseed(pcg(Math.round(a.c.x * 13) ^ pcg(Math.round(a.c.z * 7))));
  const ownC = own(a.c.x, a.c.z);
  const inner = (d) => insetPoly(a.poly, d) || a.poly;
  if (a.cls === 'park') {
    // a square: paving, trees in rows, lamps on the paths, benches; the biggest one in the
    // middle of town has the bandstand
    K.layPoly(a.poly.map((p) => [p.x, p.z]), 8);
    const ip = inner(2.5);
    const rng = mulberry32(pcg(Math.round(a.c.x) * 7 + Math.round(a.c.z)));
    for (let x = Math.floor(a.box.x0 / 7) * 7; x < a.box.x1; x += 7)
      for (let z = Math.floor(a.box.z0 / 7) * 7; z < a.box.z1; z += 7) {
        const px = x + rng() * 4, pz = z + rng() * 4, keep = rng();
        if (!own(px, pz) || !insidePoly(ip, px, pz) || keep > 0.7) continue;
        // keep the diagonals (the paths) clear
        const dx = px - a.c.x, dz = pz - a.c.z;
        if (Math.abs(Math.abs(dx) - Math.abs(dz)) < 3.5 || Math.hypot(dx, dz) < 7) continue;
        K.tree(px, pz, 0.75 + rng() * 0.6);
      }
    if (ownC) {
      const big = Math.abs(polyArea(a.poly)) > 1200;
      if (big) {   // the bandstand: a round floor, eight posts and a roof
        K.basic(G.cyl, TM.box(a.c.x, 0.5, a.c.z, 9, 1, 9), [0.5, 0.48, 0.44]);
        K.collider(a.c.x - 4.5, 0, a.c.z - 4.5, a.c.x + 4.5, 1, a.c.z + 4.5);
        for (let k = 0; k < 8; k++) { const g = (k / 8) * Math.PI * 2, x = a.c.x + 3.9 * Math.cos(g), z = a.c.z + 3.9 * Math.sin(g); K.basic(G.cyl, TM.box(x, 2.5, z, 0.25, 3, 0.25), [0.6, 0.58, 0.54]); }
        K.push(G.cone, TM.box(a.c.x, 4.6, a.c.z, 10, 1.8, 10), [0.38, 0.16, 0.08, 0], [MAT.basic, 0, K.seed(), 0]);
        K.collider(a.c.x - 4.5, 3.9, a.c.z - 4.5, a.c.x + 4.5, 5.3, a.c.z + 4.5);
        K.sprite(a.c.x, 3.6, a.c.z, lc, 3.5, 0.6);
        K.splat(a.c.x, a.c.z, lc[0], lc[1], lc[2], 6);
      }
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = a.c.x + dx * 6, z = a.c.z + dz * 6;
        if (!insidePoly(ip, x, z)) continue;
        K.basic(G.cyl, TM.box(x, 2, z, 0.14, 4, 0.14), [0.05, 0.05, 0.06]);
        K.emissive(G.sphere, TM.box(x, 4.1, z, 0.5, 0.5, 0.5), lc, 2.2);
        K.sprite(x, 4.1, z, lc, 4, 0.7);
        K.splat(x, z, lc[0] * 0.8, lc[1] * 0.8, lc[2] * 0.8, 6);
        K.basic(G.cube, TM.yaw(x + dx * 2, 0.45, z, 1.8, 0.12, 0.5, Math.PI / 4 * dx * dz), [0.3, 0.3, 0.3]);
      }
    }
    return;
  }
  if (a.cls === 'adro') {
    // the church's block: paved in a warm stone, a row of trees along the sides, lamps
    K.layPoly(a.poly.map((p) => [p.x, p.z]), 8);
    const ip = inner(3);
    for (let i = 0; i < ip.length; i++) {
      const p = ip[i], q = ip[(i + 1) % ip.length], l = Math.hypot(q.x - p.x, q.z - p.z);
      for (let t = 6; t < l - 4; t += 12) {
        const x = p.x + (q.x - p.x) * t / l, z = p.z + (q.z - p.z) * t / l;
        if (own(x, z)) K.tree(x, z, 0.8);
      }
    }
    return;
  }
  if (a.cls === 'pitch' || a.cls === 'stadium') {
    // the field (striped grass), goals at the ends, and for the stadium its stands and floodlights
    const st = a.cls === 'stadium', fl = st ? { hx: 50, hz: 32 } : { hx: Math.max(r.hx - 4, 8), hz: Math.max(r.hz - 3, 5) };
    if (st) K.layPoly(a.poly.map((p) => [p.x, p.z]), 2);
    K.setFrame(r.x, r.z, r.yaw || 1e-9);
    K.layRect(-fl.hx, -fl.hz, fl.hx, fl.hz, 9);
    if (!ownC) { K.clearFrame(); return; }
    for (const s of [-1, 1]) {
      const gx = s * fl.hx;
      K.basic(G.cube, TM.box(gx, 1.2, -3.6, 0.15, 2.4, 0.15), [0.8, 0.8, 0.8]); K.basic(G.cube, TM.box(gx, 1.2, 3.6, 0.15, 2.4, 0.15), [0.8, 0.8, 0.8]);
      K.basic(G.cube, TM.box(gx, 2.4, 0, 0.15, 0.15, 7.3), [0.8, 0.8, 0.8]);
      K.collider(gx - 0.1, 0, -3.7, gx + 0.1, 2.5, 3.7);
    }
    if (st) {
      for (const s of [-1, 1]) {   // stands along the long sides
        const z = s * (fl.hz + 7);
        for (let k = 0; k < 6; k++) K.basic(G.cube, TM.box(0, 0.5 + k * 0.6, z + s * k * 0.9, fl.hx * 1.4, 1, 1.0), [0.42, 0.42, 0.41]);
        K.collider(-fl.hx * 0.7, 0, Math.min(z, z + s * 5.4) - 0.5, fl.hx * 0.7, 3.8, Math.max(z, z + s * 5.4) + 0.5);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {   // floodlights
        const x = sx * (fl.hx + 6), z = sz * (fl.hz + 4);
        K.basic(G.cyl, TM.box(x, 12, z, 0.6, 24, 0.6), [0.3, 0.3, 0.32]);
        K.collider(x - 0.4, 0, z - 0.4, x + 0.4, 24, z + 0.4);
        K.basic(G.cube, TM.box(x, 24.8, z, 3.4, 1.6, 0.4), [0.2, 0.2, 0.22]);
        K.sprite(x, 24.6, z, [0.95, 0.97, 1.0], 6, 1.6);
      }
      K.splat(0, 0, 0.6, 0.62, 0.66, 30);
    }
    K.clearFrame();
    return;
  }
  if (a.cls === 'cemetery') {
    // a white wall round it, the graves in rows inside, a chapel
    K.layPoly(a.poly.map((p) => [p.x, p.z]), 8);
    for (let i = 0; i < a.poly.length; i++) {
      const p = a.poly[i], q = a.poly[(i + 1) % a.poly.length], mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, l = Math.hypot(q.x - p.x, q.z - p.z);
      if (!own(mx, mz) || l < 1) continue;
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      K.basic(G.cube, TM.yaw(mx, 1.1, mz, l + 0.3, 2.2, 0.3, yaw), [0.6, 0.59, 0.56]);
      K.obb(mx, mz, l / 2, 0.15, yaw, 0, 2.2);
    }
    if (!K.full) return;
    const ip = inner(3);
    K.setFrame(r.x, r.z, r.yaw || 1e-9);
    for (let x = -r.hx + 3; x < r.hx - 2; x += 2.6)
      for (let z = -r.hz + 3; z < r.hz - 2; z += 3.4) {
        const [wx, wz] = K.toWorld(x, z);
        if (!own(wx, wz) || !insidePoly(ip, wx, wz) || K.rng() < 0.12) continue;
        const h = K.R(0.5, 1.3), c = K.R(0.42, 0.66);
        K.basic(G.cube, TM.box(x, h / 2, z, 1.0, h, 2.1), [c, c, c * 0.96]);
        if (K.rng() < 0.3) { K.basic(G.cube, TM.box(x, h + 0.6, z - 0.7, 0.1, 1.2, 0.1), [0.5, 0.5, 0.48]); K.basic(G.cube, TM.box(x, h + 0.85, z - 0.7, 0.6, 0.1, 0.1), [0.5, 0.5, 0.48]); }
      }
    K.clearFrame();
    return;
  }
  // a school, the hospital, the market, the bus station, a petrol station: its yard paved, and its
  // building in the middle (OSM gives the plot, not the building)
  K.layPoly(a.poly.map((p) => [p.x, p.z]), 8);
  if (!ownC) return;
  K.setFrame(r.x, r.z, r.yaw || 1e-9);
  const [hx, hz] = clearHalf(batalha(), r, Math.max(r.hx - 4, 3), Math.max(r.hz - 4, 3), 1.5);
  const spec = {
    school: { h: 4.4, wall: [0.5, 0.42, 0.3], style: 0, roof: 'tile' },
    hospital: { h: 7.2, wall: [0.62, 0.62, 0.6], style: 0, roof: 'tile' },
    marketplace: { h: 7, wall: [0.5, 0.48, 0.42], style: 3, roof: 'metal' },
    bus_station: { h: 5.5, wall: [0.45, 0.47, 0.5], style: 0, roof: 'metal' },
    fuel: { h: 5.4, wall: [0.5, 0.5, 0.5], style: 0, roof: 'canopy' },
  }[a.cls] || { h: 5, wall: [0.5, 0.5, 0.5], style: 0, roof: 'tile' };
  if (spec.roof === 'canopy') {
    // a petrol station: a canopy on four posts, lit underneath, the pumps, a small shop
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { K.basic(G.cube, TM.box(sx * hx * 0.6, 2.6, sz * hz * 0.5, 0.4, 5.2, 0.4), [0.6, 0.6, 0.6]); K.collider(sx * hx * 0.6 - 0.2, 0, sz * hz * 0.5 - 0.2, sx * hx * 0.6 + 0.2, 5.2, sz * hz * 0.5 + 0.2); }
    K.basic(G.cube, TM.box(0, 5.5, 0, hx * 1.6, 0.8, hz * 1.3), [0.75, 0.75, 0.74]);
    K.collider(-hx * 0.8, 5.1, -hz * 0.65, hx * 0.8, 5.9, hz * 0.65);
    K.emissive(G.cube, TM.box(0, 5.08, 0, hx * 1.5, 0.04, hz * 1.2), [0.95, 0.97, 1], 1.5);
    for (const sx of [-1, 1]) { K.basic(G.cube, TM.box(sx * hx * 0.25, 0.9, 0, 0.8, 1.8, 0.5), [0.6, 0.15, 0.1]); K.collider(sx * hx * 0.25 - 0.4, 0, -0.25, sx * hx * 0.25 + 0.4, 1.8, 0.25); }
    K.splat(0, 0, 0.9, 0.95, 1, 9);
  } else {
    const h = spec.h;
    K.push(G.cube, TM.box(0, h / 2, 0, hx * 2, h, hz * 2), [...spec.wall, 0.2], [MAT.building, 0, K.seed(), a.cls === 'marketplace' ? 0.9 : 0], [spec.style, a.cls === 'hospital' ? 3.6 : h, 3, 0.45]);
    K.collider(-hx, 0, -hz, hx, h, hz);
    K.footRect(-hx, -hz, hx, hz);
    if (spec.roof === 'metal') { K.basic(G.cube, TM.box(0, h + 0.5, 0, hx * 2 + 1.5, 1, hz * 2 + 1.5), [0.32, 0.33, 0.34]); K.collider(-hx, h, -hz, hx, h + 1, hz); }
    else roofRect(K, -hx, -hz, hx, hz, h, K.pick(TILES_BAT), spec.wall.map((c) => c * 0.8), [r.x, r.z, r.yaw]);
    if (a.cls === 'school' && r.hx > 14) K.tree(hx * 0.6, hz + 2.5 < r.hz ? hz + 2 : 0, 1.3);
  }
  K.splat(0, r.hz, lc[0] * 0.6, lc[1] * 0.6, lc[2] * 0.6, 8);
  K.clearFrame();
}

// a telephone mast: a lattice tower (posts and braces) with antennas and a red light on top
function batMast(K, x, z, h) {
  const { G } = K, s = 1.3, grey = [0.35, 0.36, 0.38];
  for (const [dx, dz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) K.basic(G.cube, TM.seg(x + dx, 0, z + dz, x + dx * 0.4, h, z + dz * 0.4, 0.14), grey);
  if (K.full) for (let y = 4; y < h - 2; y += 5) {
    const k = 1 - 0.6 * (y / h), e = s * k;
    K.basic(G.cube, TM.seg(x - e, y, z - e, x + e, y + 5 * 0.9, z + e, 0.06), grey);
    K.basic(G.cube, TM.seg(x + e, y, z - e, x - e, y + 5 * 0.9, z + e, 0.06), grey);
  }
  K.collider(x - s, 0, z - s, x + s, h, z + s);
  for (let k = 0; k < 3; k++) { const g = k * 2.1; K.basic(G.cube, TM.box(x + Math.cos(g) * 0.9, h - 2, z + Math.sin(g) * 0.9, 0.35, 2.4, 0.35), [0.75, 0.75, 0.75]); }
  K.emissive(G.sphere, TM.box(x, h + 0.4, z, 0.5, 0.5, 0.5), [1, 0.1, 0.05], 3, ANIM.blink);
  K.sprite(x, h + 0.4, z, [1, 0.12, 0.06], 4, 0.9, ANIM.blink, 0, 0.5);
  K.sprite(x, h * 0.55, z, [1, 0.12, 0.06], 2.5, 0.6, ANIM.blink, 0, 0.1);
}

// ---------- the roads ----------
// q: (axis, width, lanes, mode): asphalt with a centre line (0) on the main roads, plain asphalt (2), dirt (4)
const SURF = { asphalt: [0, 0.03], dirt: [4, 0.01] };
function batRoad(K, r, own, lc, D) {
  const { G } = K, [mode, top] = SURF[r.surf], w = r.w, piece = 48;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, yaw = Math.atan2(-uz, ux), n = Math.ceil(len / piece);
    for (let k = 0; k < n; k++) {
      const s0 = (k * len) / n, s1 = ((k + 1) * len) / n, mx = ax + ux * (s0 + s1) / 2, mz = az + uz * (s0 + s1) / 2;
      if (!own(mx, mz)) continue;
      const lanes = mode === 0 && (r.cls === 'primary' || r.cls === 'secondary') && w >= 7 ? 1 : 0;
      K.G.cube.push(TM.yaw(mx, ROADY - 0.15 + top, mz, s1 - s0 + 0.05, 0.3, w, yaw), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, w, lanes, lanes ? 0 : mode === 0 ? 2 : mode]);
    }
    // round the bends and the ends, so the next piece joins without a notch
    if (own(bx, bz)) K.G.cyl.push(TM.box(bx, ROADY - 0.155 + top, bz, w, 0.3, w), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, w, 0, mode === 0 ? 2 : mode]);
    if (i === 0 && own(ax, az)) K.G.cyl.push(TM.box(ax, ROADY - 0.155 + top, az, w, 0.3, w), [0, 0, 0, 0], [MAT.road, 0, 0, 0], [0, w, 0, mode === 0 ? 2 : mode]);
    // lamps on concrete poles every 34 m, on one side then the other, in town
    if (!r.town || (r.surf === 'dirt' && batDensity(ax, az) < 0.75)) continue;
    for (let s = 10 + (r.id % 7) * 3; s < len - 4; s += 34) {
      const side = Math.floor(s / 34) % 2 ? 1 : -1, nx = -uz * side, nz = ux * side;
      const x = ax + ux * s + nx * (w / 2 + 0.6), z = az + uz * s + nz * (w / 2 + 0.6);
      if (!own(x, z)) continue;
      const [cl] = roadClear(D, x, z, null);
      if (cl < -0.5) continue;
      K.streetLamp(x, z, -nx, -nz, lc, 8);
    }
  }
}

// ---------- the bush round the town, and trees along the creeks ----------
function batBush(K, D, X0, Z0, own) {
  const step = K.full ? 11 : 22;
  for (let x = X0; x < X0 + CHUNK; x += step)
    for (let z = Z0; z < Z0 + CHUNK; z += step) {
      const h = pcg((Math.round(x) * 73856093) ^ (Math.round(z) * 19349663));
      const px = x + (h & 1023) / 1023 * step, pz = z + ((h >> 10) & 1023) / 1023 * step;
      // how thick the bush is here (the same as the ground's green, shaders.js)
      const v = vnoise(px / 140 + 11.3, pz / 140 - 4.1) * 0.65 + vnoise(px / 37, pz / 37) * 0.35;
      const sd = streamDist(D, px, pz), wet = sd < 25;
      if (!wet && v < 0.5) continue;
      if (!wet && ((h >> 20) & 255) / 255 > (v - 0.5) * 2.6) continue;
      const [cl] = roadClear(D, px, pz, null);
      if (cl < 2.5) continue;
      if (batDensity(px, pz) > 0.5 && cl < 45) continue;      // the town's yards have their own
      if (inAreas(D, px, pz, 3)) continue;
      if (!own(px, pz)) continue;
      const s = wet ? 1.1 + ((h >> 4) & 15) / 30 : 0.65 + ((h >> 4) & 15) / 28;
      if (K.full) K.tree(px, pz, s);
      else K.push(K.G.sphere, TM.box(px, 4.2 * s, pz, 4.6 * s, 4.2 * s, 4.6 * s), [0.05, 0.085, 0.045, 0], [MAT.foliage, 0, 7, 0]);
    }
}

// ---------- one piece ----------
function genBatalha(cx, cz, lod, Q) {
  const D = batalha();
  const X0 = cx * CHUNK, Z0 = cz * CHUNK, X1 = X0 + CHUNK, Z1 = Z0 + CHUNK, full = lod > 0;
  const own = (x, z) => x >= X0 && x < X1 && z >= Z0 && z < Z1;
  const K = makeKit(Q, full), G = K.G;
  const pad = 60, near = (b) => b.x1 > X0 - pad && b.x0 < X1 + pad && b.z1 > Z0 - pad && b.z0 < Z1 + pad;
  const lc = (x, z) => (batDensity(x, z) > 0.88 ? LED : LAMP);
  // roads, and the houses along them
  const seen = new Set();
  for (let x = X0 - 64; x <= X1 + 64; x += BAT.cell)
    for (let z = Z0 - 64; z <= Z1 + 64; z += BAT.cell)
      for (const s of D.near(x, z)) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (Math.max(s.ax, s.bx) < X0 - 40 || Math.min(s.ax, s.bx) > X1 + 40 || Math.max(s.az, s.bz) < Z0 - 40 || Math.min(s.az, s.bz) > Z1 + 40) continue;
        for (const side of [-1, 1]) for (const L of lotsOf(D, s, side)) if (own(L.fx, L.fz)) batHouse(K, L);
      }
  const roadsHere = new Set([...seen].map((s) => s.r));
  for (const r of roadsHere) batRoad(K, r, own, lc((X0 + X1) / 2, (Z0 + Z1) / 2), D);
  for (const a of D.areas) if (near(a.box)) batArea(K, a, own, LAMP);
  for (const b of D.blds) if (near(b.box) && own(b.rect.x, b.rect.z)) batBuilding(K, b);
  for (const p of D.points) {
    if (p.kind !== 'mast' || !own(p.x, p.z)) continue;
    // a mast OSM puts on the street stands just off it
    let x = p.x, z = p.z;
    for (let i = 0; i < 20; i++) { const [cl, s] = roadClear(D, x, z, null); if (cl > 3 || !s) break; const t = clamp((x - s.ax) * s.ux + (z - s.az) * s.uz, 0, s.len), qx = x - (s.ax + s.ux * t), qz = z - (s.az + s.uz * t), l = Math.hypot(qx, qz) || 1; x += (qx / l) * 1; z += (qz / l) * 1; }
    batMast(K, x, z, 38 + (Math.abs(p.x) % 9));
  }
  // the creeks: a dark wet bed with the bush thick along it
  if (full) for (const s of D.streamSegs) {
    if (Math.max(s.ax, s.bx) < X0 - 10 || Math.min(s.ax, s.bx) > X1 + 10 || Math.max(s.az, s.bz) < Z0 - 10 || Math.min(s.az, s.bz) > Z1 + 10) continue;
    const nx = -s.uz * 2.5, nz = s.ux * 2.5;
    K.layPoly([[s.ax - nx, s.az - nz], [s.bx - nx, s.bz - nz], [s.bx + nx, s.bz + nz], [s.ax + nx, s.az + nz]], 12);
  }
  batBush(K, D, X0, Z0, own);
  const out = { cx, cz, lod, groups: {}, boxes: new Float32Array(K.boxes), snd: new Uint8Array(K.sounds), marks: K.marks };
  for (const g of GROUPS) out.groups[g] = G[g].data();
  if (full) {
    out.splats = new Float32Array(K.splats); out.lay = new Float32Array(K.lay); out.polys = new Float32Array(K.polys);
    out.mesh = chunkMesh(out.boxes, X0, Z0);
  }
  return out;
}

// ---------- launch spots, and what the OSD calls a place ----------
function batalhaSpots() {
  const D = batalha();
  const b = D.blds.find((q) => q.name === 'Igreja Matriz'), fr = churchFrame(b.rect);
  // in front of the church (its local +z), on the square
  const fx = fr.ox + Math.sin(fr.yaw) * 40, fz = fr.oz + Math.cos(fr.yaw) * 40;
  const area = (cls, name) => D.areas.find((a) => a.cls === cls && (!name || a.name === name));
  const st = area('stadium'), mk = area('marketplace'), bus = area('bus_station'), hosp = area('hospital');
  // on the middle of the street nearest (x, z) (never in a house, a tree or a wall)
  const spot = (name, x, z, tx, tz, y = 2, ty = 6) => {
    if (y < 10) {
      let best = null, bd = Infinity;
      for (const s of D.segs) {
        if (!s.r.town) continue;
        const t = clamp((x - s.ax) * s.ux + (z - s.az) * s.uz, 3, s.len - 3), px = s.ax + s.ux * t, pz = s.az + s.uz * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) { bd = d; best = [px, pz]; }
      }
      if (best) [x, z] = best;
    }
    return { name, pos: [x, y, z], at: [tx, ty, tz] };
  };
  return [
    spot('Praça da Matriz', fx, fz, fr.ox, fr.oz, 2, 14),
    spot('Mercado Central', mk.c.x + 20, mk.c.z + 22, mk.c.x, mk.c.z),
    spot('Rodoviária', bus.c.x - 25, bus.c.z, bus.c.x, bus.c.z),
    spot('Estádio', st.c.x, st.c.z, st.c.x + 40, st.c.z - 40),
    spot('Hospital', hosp.c.x - 30, hosp.c.z + 30, hosp.c.x, hosp.c.z),
    spot('Riacho da Usina', 420, 560, 520, 700, 3, 3),
    spot('Avenida Getúlio Vargas', -150, 840, 0, 500),
    spot('Over the town', 260, 110, 250, -400, 160, 40),
    spot('Cerrado', 1600, -1300, 600, -400, 3, 20),
  ];
}
// the street nearest (x, z), for the OSD
function batalhaPlace(x, z) {
  const D = batalha();
  let best = null, bd = 60;
  for (const s of D.near(x, z)) if (s.r.name) { const d = segDist(s, x, z); if (d < bd) { bd = d; best = s.r.name; } }
  return best ? best.toUpperCase() : batDensity(x, z) > 0.6 ? 'BATALHA' : 'CERRADO';
}
