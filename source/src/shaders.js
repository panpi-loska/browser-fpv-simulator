// ---------------------------------------------------------------------------
// shaders.js: the look of the city (WGSL). Sky, fog, windows and the rooms behind them,
// wet asphalt, water, neon, light sprites, searchlights, rain, then bloom and tone mapping.
// ---------------------------------------------------------------------------

function sceneShader(Q) {
  const f = (x) => (+x).toFixed(4);
  return /*wgsl*/`
diagnostic(off, derivative_uniformity);

struct U {
  viewProj: mat4x4f, invViewProj: mat4x4f,
  cam: vec4f,     // xyz camera, w time
  skyTop: vec4f,  // w: share of windows lit
  skyHor: vec4f,  // w: fog density
  sunDir: vec4f,  // w: star brightness
  sunCol: vec4f,
  amb: vec4f,     // w: rain particles
  glow: vec4f,    // city glow color, w: clip plane height
  p1: vec4f,      // x clip below plane, y/z target size, w reflection texture available
  p2: vec4f,      // x radians per pixel, y wetness, z searchlight strength
  right: vec4f, up: vec4f,
};
struct Inst { m0: vec4f, m1: vec4f, m2: vec4f, col: vec4f, p: vec4f, q: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> inst: array<Inst>;
@group(0) @binding(2) var lightTex: texture_2d<f32>;
@group(0) @binding(3) var layoutTex: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var reflTex: texture_2d<f32>;
@group(0) @binding(6) var sampW: sampler;
@group(0) @binding(7) var tileKey: texture_2d<i32>;

const PI = 3.14159265;
const CHUNK = ${f(CHUNK)};
const TILES = ${TILES};
const SPAN = ${f(CHUNK * TILES)};
const SPAN_PX = ${f(TILE * TILES)};
const CAR_STEP = ${f(CAR_STEP)};
const CAR_KEEP = ${f(clamp(CAR_STEP / (Q.carGap + 9), 0.05, 0.6))};
const RIVER_Z0 = ${f(RIVER.z0)};
const RIVER_P = ${f(RIVER.period)};
const RIVER_HW = ${f(RIVER.hw)};
const RAMP = ${f(RIVER.ramp)};
const BRIDGE_H = ${f(RIVER.h)};
const TUN_LEN = ${f(TUNNEL.len)};
const TUN_RAMP = ${f(TUNNEL.ramp)};
const TUN_D = ${f(TUNNEL.depth)};
const ROADY = ${f(ROADY)};
const TRAIN_Y = ${f(TRAIN_Y)};
const BLIMP_Y = ${f(BLIMP_Y)};

// ---------- hashing and noise ----------
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(v: u32) -> f32 { return f32(pcg(v)) * (1.0 / 4294967296.0); }
fn ihash(a: i32, b: i32, c: u32) -> u32 { return pcg(bitcast<u32>(a) ^ pcg(bitcast<u32>(b) ^ pcg(c))); }
fn h21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), s.x), mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), s.x), s.y);
}
fn fbm(p: vec2f) -> f32 {
  var s = 0.0; var a = 0.5; var q = p;
  for (var i = 0; i < 4; i++) { s += a * vnoise(q); q = q * 2.03 + vec2f(1.7, 9.2); a *= 0.5; }
  return s;
}
fn hue(h: f32) -> vec3f { return clamp(abs(fract(h + vec3f(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)); }
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
fn rotX(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
fn rotZ(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }

// ---------- the rivers (the same formulas and hash as city.js) ----------
fn ihf(a: i32, salt: u32) -> f32 { return rnd(bitcast<u32>(a) ^ pcg(salt)); }
struct River { on: bool, zc: f32, hw: f32, a1: f32, f1: f32, p1: f32, a2: f32, f2: f32, p2: f32 };
fn riverSlot(k: i32) -> River {
  var r: River;
  if (k == 0) { r.on = true; r.zc = RIVER_Z0; r.hw = RIVER_HW; r.a1 = 36.0; r.f1 = 0.0036; r.p1 = 0.7; r.a2 = 8.0; r.f2 = 0.0095; r.p2 = 0.0; return r; }
  r.zc = RIVER_Z0 + f32(k) * RIVER_P + (ihf(k, 11u) - 0.5) * 1400.0;
  r.on = ihf(k, 12u) < 0.6;
  r.hw = 32.0 + 63.0 * pow(ihf(k, 19u), 1.4);
  r.a1 = 26.0 + 24.0 * ihf(k, 13u); r.f1 = 0.0026 + 0.0024 * ihf(k, 14u); r.p1 = 6.2832 * ihf(k, 15u);
  r.a2 = 5.0 + 9.0 * ihf(k, 16u); r.f2 = 0.006 + 0.006 * ihf(k, 17u); r.p2 = 6.2832 * ihf(k, 18u);
  let f = min(1.0, (125.0 - r.hw) / (r.a1 + r.a2)); r.a1 = r.a1 * f; r.a2 = r.a2 * f;
  return r;
}
// how far (x, z) is from the nearest river's bank (negative: in the water)
fn riverDist(x: f32, z: f32) -> f32 {
  let r = riverSlot(i32(floor((z - RIVER_Z0) / RIVER_P + 0.5)));
  if (!r.on) { return 1e9; }
  return abs(z - (r.zc + r.a1 * sin(x * r.f1 + r.p1) + r.a2 * sin(x * r.f2 + r.p2))) - r.hw;
}
fn bridgeH(x: f32, z: f32) -> f32 {
  let d = riverDist(x, z); let k = clamp(1.0 - d / RAMP, 0.0, 1.0);
  return BRIDGE_H * k * k * (3.0 - 2.0 * k);
}
// in a tunnel the road goes down from TUN_LEN off the bank and runs TUN_D under the river (city.js)
fn tunnelY(x: f32, z: f32) -> f32 {
  let k = clamp((TUN_LEN - riverDist(x, z)) / TUN_RAMP, 0.0, 1.0);
  return -TUN_D * k * k * (3.0 - 2.0 * k);
}

// ---------- animation: everything that moves is moved here, on the GPU ----------
struct Pose { pos: vec3f, yaw: f32, pitch: f32, on: bool, k: u32 };
fn carPose(q: vec4f, slot: f32, t: f32) -> Pose {
  // q: the road's line (x for north-south, z for east-west), this piece's stretch [q.y, q.z] (swapped
  // for north-south), the lane's speed (negative: the other way). The lane is a conveyor of slots
  // CAR_STEP apart; slot k is at k * CAR_STEP + phase + speed * t, the same in every piece.
  // A north-south lane's speed carries a code in its thousands (the same speed: the conveyor stays
  // seamless): which of the four lanes it is, so the avenue's centre line is known (the deck of a bridge
  // or a tunnel is level across), and whether this stretch is a tunnel.
  let ns = q.y > q.z;
  let code = floor(abs(q.w) / 1000.0);
  let sp = q.w - sign(q.w) * code * 1000.0;
  let tun = code > 4.5;
  let offs = array<f32, 4>(-5.8, -2.2, 2.2, 5.8);
  let xc = select(q.x, q.x - offs[u32(max(code - 1.0, 0.0)) % 4u], code > 0.5);
  let lo = min(q.y, q.z); let hi = max(q.y, q.z);
  let lid = pcg(bitcast<u32>(i32(round(q.x * 4.0))) ^ select(0x9e3779b9u, 0x7f4a7c15u, q.w > 0.0));
  let base = rnd(lid) * CAR_STEP + sp * t;
  let k0 = ceil((lo - base) / CAR_STEP);
  let s = base + (k0 + slot) * CAR_STEP;
  var P: Pose;
  P.k = pcg(bitcast<u32>(i32(k0 + slot)) ^ lid);
  P.on = s < hi && rnd(P.k) < CAR_KEEP;
  let fw = q.w > 0.0;
  if (!ns) {
    P.pos = vec3f(s, ROADY, q.x); P.yaw = select(PI, 0.0, fw); P.pitch = 0.0;
  } else {
    let d = select(-0.5, 0.5, fw);
    P.yaw = select(PI * 0.5, -PI * 0.5, fw);
    if (tun) {
      P.pos = vec3f(q.x, ROADY + tunnelY(xc, s), s);
      P.pitch = atan(tunnelY(xc, s + d) - tunnelY(xc, s - d));
    } else {
      P.pos = vec3f(q.x, ROADY + bridgeH(xc, s), s);
      P.pitch = atan(bridgeH(xc, s + d) - bridgeH(xc, s - d));
    }
  }
  return P;
}
fn carColor(k: u32) -> vec3f {
  let r = rnd(k ^ 0x51ed27u);
  if (r < 0.1) { return vec3f(0.75, 0.55, 0.05); }   // a taxi
  let c = array<vec3f, 8>(vec3f(0.5, 0.05, 0.04), vec3f(0.06, 0.07, 0.09), vec3f(0.6, 0.6, 0.62), vec3f(0.12, 0.2, 0.35),
                          vec3f(0.03, 0.03, 0.03), vec3f(0.35, 0.35, 0.37), vec3f(0.05, 0.18, 0.12), vec3f(0.55, 0.38, 0.05));
  return c[u32(rnd(k ^ 0x1234567u) * 7.999)];
}
struct AR { w: vec3f, n: vec3f, em: f32, cc: vec4f };
fn animate(I: Inst, w0: vec3f, n0: vec3f, t: f32) -> AR {
  var r: AR; r.w = w0; r.n = n0; r.em = 1.0; r.cc = vec4f(0.0);
  let a = u32(I.p.y + 0.5);
  if (a == 1u) {          // car: rides its lane's conveyor, climbs the bridges; an empty slot draws nothing
    let P = carPose(I.q, I.p.w, t);
    if (!P.on) { r.w = vec3f(0.0, -1e4, 0.0); r.em = 0.0; return r; }
    r.w = P.pos + rotY(rotZ(w0, P.pitch), P.yaw); r.n = rotY(rotZ(n0, P.pitch), P.yaw);
    if (I.p.z > 0.5 && I.p.x < 0.5) { r.cc = vec4f(carColor(P.k), 1.0); }
  } else if (a == 2u) {   // train: runs its line from station to station (q: x, ends, speed)
    let L = max(I.q.z - I.q.y, 1.0);
    var s = I.q.y + fract((I.p.w + t * abs(I.q.w)) / L) * L;
    var yaw = 0.0;
    if (I.q.w < 0.0) { s = I.q.y + I.q.z - s; yaw = PI; }
    r.w = vec3f(I.q.x, TRAIN_Y, s) + rotY(w0, yaw); r.n = rotY(n0, yaw);
  } else if (a == 3u) {   // ferris wheel: turns about z through its hub
    let ang = t * I.q.w;
    r.w = I.q.xyz + rotZ(w0 - I.q.xyz, ang); r.n = rotZ(n0, ang);
  } else if (a == 4u) {   // gondola: rides the rim but keeps hanging straight down
    r.w = I.q.xyz + rotZ(vec3f(I.p.z, 0.0, 0.0), I.p.w + t * I.q.w) + w0;
  } else if (a == 5u) {   // aircraft warning light
    r.em = select(0.0, 1.0, fract(t * 0.55 + I.p.w) < 0.14);
  } else if (a == 8u) {   // tower crane: the jib slews slowly back and forth about the mast
    let ang = I.p.w + 0.7 * sin(t * I.q.w + I.p.w * 2.0);
    let piv = vec3f(I.q.x, 0.0, I.q.z);
    r.w = piv + rotY(w0 - piv, ang); r.n = rotY(n0, ang);
  } else if (a == 6u) {   // blimp: a slow circle over the city
    let ang = I.p.w + t * I.q.w / I.q.z;
    let yaw = atan2(-cos(ang), -sin(ang));
    r.w = vec3f(I.q.x + I.q.z * cos(ang), BLIMP_Y + 6.0 * sin(t * 0.1), I.q.y + I.q.z * sin(ang)) + rotY(w0, yaw); r.n = rotY(n0, yaw);
  }
  return r;
}

// ---------- light ----------
fn fresnel(c: f32) -> f32 { return 0.04 + 0.96 * pow(1.0 - c, 5.0); }
// the ground textures hold the pieces near the camera, wrapping around: is this piece's tile there?
fn tileOK(w: vec3f) -> bool {
  let c = vec2i(floor(w.xz / CHUNK));
  let k = textureLoad(tileKey, ((c % TILES) + TILES) % TILES, 0).xy;
  return all(k == c);
}
fn lightAt(w: vec3f) -> vec4f {
  if (!tileOK(w)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return textureSampleLevel(lightTex, sampW, w.xz / SPAN, 0.0);
}
fn ambientL(n: vec3f, y: f32) -> vec3f {
  return u.amb.rgb * (0.65 + 0.35 * n.y) + u.glow.rgb * (0.05 * (0.5 - 0.5 * n.y) + 0.05 * exp(-max(y, 0.0) / 120.0));
}
fn sunL(n: vec3f) -> vec3f { return u.sunCol.rgb * max(dot(n, u.sunDir.xyz), 0.0); }
fn streetL(w: vec3f, n: vec3f) -> vec3f {
  return lightAt(w).rgb * 4.0 * exp(-max(w.y - 0.5, 0.0) / 6.0) * (0.45 + 0.55 * max(n.y, 0.0));
}
fn fogCol(V: vec3f) -> vec3f {
  let s = pow(max(dot(V, u.sunDir.xyz), 0.0), 6.0);
  return u.skyHor.rgb * 0.85 + u.glow.rgb * 0.22 + u.sunCol.rgb * s * 0.25;
}
fn fogF(w: vec3f) -> f32 {
  let d = distance(w, u.cam.xyz);
  let h = max(0.5 * (w.y + u.cam.y), 0.0);
  return 1.0 - exp(-d * u.skyHor.w * exp(-h / 180.0));
}
fn applyFog(c: vec3f, w: vec3f) -> vec3f { return mix(c, fogCol(normalize(w - u.cam.xyz)), fogF(w)); }
fn skyBase(d: vec3f) -> vec3f {
  let up = pow(clamp(d.y, 0.0, 1.0), 0.45);
  var c = mix(fogCol(d), u.skyTop.rgb, smoothstep(0.0, 1.0, up));
  if (d.y < 0.0) { c = fogCol(d) * mix(1.0, 0.55, clamp(-d.y * 4.0, 0.0, 1.0)); }
  let sd = max(dot(d, u.sunDir.xyz), 0.0);
  c += u.sunCol.rgb * (smoothstep(0.99982, 0.99990, sd) * 30.0 + pow(sd, 90.0) * 0.5 + pow(sd, 8.0) * 0.12);
  return c;
}
// a thin band of hw meters around 0, faded out when it gets thinner than a pixel
fn band(x: f32, hw: f32, fw: f32) -> f32 {
  let f = max(fw, 0.0005);
  return clamp((hw - x) / f + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / f);
}
fn reflSample(fp: vec2f, V: vec3f, n: vec3f, w: vec3f, streak: f32) -> vec3f {
  // the mirrored pass is only right close to the water plane; raised decks reflect the sky
  if (u.p1.w > 0.5 && w.y < 1.5) {
    let uv = fp / u.p1.yz;
    let j = (vnoise(w.xz * 1.7) - 0.5) * 0.006;
    var c = vec3f(0.0);
    for (var i = 0; i < 4; i++) { c += textureSampleLevel(reflTex, samp, uv + vec2f(j, f32(i) * 0.005 * streak), 0.0).rgb; }
    return c * 0.25;
  }
  return skyBase(reflect(V, n)) * 0.5;
}

// ---------- windows ----------
fn windowState(seed: u32, cx: i32, cy: i32, face: u32, style: u32) -> vec4f {
  let h = ihash(cx + i32(face) * 4099, cy, seed);
  let r0 = rnd(h); let r1 = rnd(h ^ 0x68e31da4u); let r2 = rnd(h * 747796405u + 1u);
  let lf = u.skyTop.w * (0.55 + 0.9 * rnd(seed * 2654435761u));
  var lit: bool;
  if (style == 1u || style == 3u) {
    let fl = rnd(ihash(cy, 77, seed));     // offices: whole floors on or off
    lit = (fl < lf * 0.9 && r0 < 0.93) || r0 < lf * 0.15;
  } else { lit = r0 < lf; }
  let ep = u32(floor(u.cam.w / 37.0 + r2 * 11.0));
  if (rnd(h ^ (ep * 0x51ed27u)) < 0.05) { lit = !lit; }  // now and then someone flips a switch
  var lc = vec3f(1.0, 0.62, 0.32);
  if (style == 1u || style == 3u || style == 4u) { lc = select(vec3f(0.8, 0.9, 1.0), vec3f(1.0, 0.78, 0.5), r1 > 0.55); }
  else if (r1 > 0.8) { lc = vec3f(1.0, 0.85, 0.62); }
  if (r1 < 0.05) { lc = vec3f(0.35, 0.5, 1.0) * (0.75 + 0.25 * sin(u.cam.w * 6.0 + r2 * 40.0)); } // a television
  lc *= 1.0 + 2.6 * r2 * r2;
  return vec4f(lc, select(0.0, 1.0, lit));
}
// a little room behind each window, found by tracing the view ray into a box
fn interior(o2: vec2f, room: vec2f, V: vec3f, T: vec3f, n: vec3f, h: u32, ws: vec4f) -> vec3f {
  let d = vec3f(dot(V, T), V.y, min(dot(V, n), -0.02));
  let o = vec3f(o2, 0.0);
  let D = room.x * 1.4;
  let tx = select(-o.x / d.x, (room.x - o.x) / d.x, d.x > 0.0);
  let ty = select(-o.y / d.y, (room.y - o.y) / d.y, d.y > 0.0);
  let tz = D / -d.z;
  let t = min(min(tx, ty), tz);
  let p = o + d * t;
  let r0 = rnd(h ^ 0x1234u); let r1 = rnd(h ^ 0x9876u);
  let wallT = mix(vec3f(0.55, 0.5, 0.44), vec3f(0.42, 0.48, 0.55), r0) * (0.6 + 0.4 * r1);
  var c: vec3f;
  if (t == tz) {
    c = wallT * 0.8;
    let fx = p.x / room.x;
    if (p.y < room.y * 0.4 && abs(fx - (0.3 + 0.4 * r1)) < 0.22) { c *= 0.22; }
    if (r0 > 0.7 && p.y > room.y * 0.5 && p.y < room.y * 0.78 && abs(fx - 0.5) < 0.14) { c = vec3f(0.5, 0.35, 0.15); }
  } else if (t == ty) {
    if (d.y > 0.0) {
      let q = vec2f(p.x - room.x * 0.5, p.z + D * 0.5);
      c = vec3f(0.6) + vec3f(2.5) * exp(-dot(q, q) * 0.8);
    } else { c = mix(vec3f(0.22, 0.14, 0.09), vec3f(0.12, 0.12, 0.14), r1); }
  } else { c = wallT * 0.65; }
  return c * ws.rgb * mix(0.012, 1.0, ws.a) * mix(1.0, 0.5, clamp(-p.z / D, 0.0, 1.0));
}

fn instSize(I: Inst) -> vec3f {
  return vec3f(length(vec3f(I.m0.x, I.m1.x, I.m2.x)), length(vec3f(I.m0.y, I.m1.y, I.m2.y)), length(vec3f(I.m0.z, I.m1.z, I.m2.z)));
}

fn shadeBuilding(I: Inst, w: vec3f, n: vec3f, lp: vec3f, V: vec3f) -> vec3f {
  let size = instSize(I);
  let seed = u32(I.p.z);
  let wall = I.col.rgb;
  let light = ambientL(n, w.y) + sunL(n) + streetL(w, n);
  if (abs(n.y) > 0.5) {
    let rim = max(abs(lp.x) * size.x - (size.x * 0.5 - 0.6), abs(lp.z) * size.z - (size.z * 0.5 - 0.6));
    let r = mix(vec3f(0.05, 0.05, 0.055), wall * 0.6 + 0.03, step(0.0, rim)) * (0.75 + 0.5 * vnoise(w.xz * 0.4));
    return r * light;
  }
  // which wall, in the building's own frame (it may be turned to its street)
  var uC: f32; var width: f32; var T: vec3f; var face: u32;
  if (abs(lp.x) >= abs(lp.z)) { uC = (lp.z + 0.5) * size.z; width = size.z; T = normalize(vec3f(I.m0.z, I.m1.z, I.m2.z)); face = select(1u, 0u, lp.x > 0.0); }
  else { uC = (lp.x + 0.5) * size.x; width = size.x; T = normalize(vec3f(I.m0.x, I.m1.x, I.m2.x)); face = select(3u, 2u, lp.z > 0.0); }
  let style = u32(I.q.x + 0.5);
  let fh = I.q.y;
  let cw = width / max(1.0, round(width / I.q.z));
  let gx = uC / cw; let gy = w.y / fh;
  let cx = floor(gx); let cy = floor(gy);
  let fx = gx - cx; let fy = gy - cy;
  let fw = max(fwidth(gx), fwidth(gy));
  let wx = I.q.w;
  var wy = 0.55;
  switch style { case 1u: { wy = 0.84; } case 2u: { wy = 0.5; } case 3u: { wy = 0.45; } case 4u: { wy = 0.78; } default: {} }

  var wallC = wall * (0.85 + 0.3 * vnoise(vec2f(uC * 0.15 + f32(face) * 13.0, w.y * 0.08)));
  wallC *= mix(0.45, 1.0, smoothstep(0.0, 8.0, w.y)) * light;
  let cosv = clamp(-dot(V, n), 0.0, 1.0);
  let fr = fresnel(cosv);
  let refl = I.col.a;
  let tint = select(vec3f(0.8, 0.85, 0.9), vec3f(0.55, 0.8, 0.85), style == 1u);
  let reflC = skyBase(reflect(V, n)) * tint * (0.08 + 0.92 * fr) * refl;

  // the ground floor: shop windows with a glowing sign band above
  if (I.p.w > 0.01 && w.y < 4.8) {
    let sx = uC / 6.5; let sid = floor(sx); let sf = sx - sid;
    let sh = ihash(i32(sid) + i32(face) * 977, -3, seed);
    let on = rnd(sh) < I.p.w * 0.95;
    let warm = vec3f(1.0, 0.7, 0.42);
    let sc = select(warm, hue(rnd(sh ^ 99u)) * 0.6 + 0.4, rnd(sh ^ 7u) < 0.25) * (0.22 + 0.45 * rnd(sh ^ 3u));
    var c = wallC * 0.7;
    if (sf > 0.06 && sf < 0.94 && w.y > 0.35 && w.y < 3.5) {
      // shelves and racks inside, brighter towards the ceiling lights
      let shelf = 0.55 + 0.45 * step(0.25, fract(w.y * 1.6)) * step(0.12, fract(sx * 5.0 + rnd(sh ^ 11u)));
      let g = select(vec3f(0.008), sc * shelf * (0.45 + 0.55 * smoothstep(0.3, 3.5, w.y)), on);
      c = g * (1.0 - fr * 0.5) + reflC * 0.6;
    }
    // a coloured sign over the window: most shops downtown, few where there are few shops
    if (on && rnd(sh ^ 0x77u) < I.p.w * I.p.w * 1.6 && w.y > 3.75 && w.y < 4.45 && sf > 0.1 && sf < 0.9) {
      let flick = select(1.0, 0.15, rnd(sh ^ 5u) < 0.15 && rnd(sh ^ u32(u.cam.w * 9.0)) < 0.04);
      c = (hue(rnd(sh ^ 0x55u)) * 2.2 + 0.15) * flick;
    }
    return c;
  }

  let ws = windowState(seed, i32(cx), i32(cy), face, style);
  let aa = clamp(fw * 0.75, 0.002, 0.5);
  let ex = (1.0 - wx) * 0.5;
  var mx = 1.0;
  if (wx < 0.99) { mx = smoothstep(ex - aa, ex + aa, fx) * (1.0 - smoothstep(1.0 - ex - aa, 1.0 - ex + aa, fx)); }
  let ey0 = (1.0 - wy) * 0.62; let ey1 = ey0 + wy;
  let mask = mx * smoothstep(ey0 - aa, ey0 + aa, fy) * (1.0 - smoothstep(ey1 - aa, ey1 + aa, fy));

  let hc = ihash(i32(cx) + 31, i32(cy) * 7 + i32(face), seed);
  var glass: vec3f;
  if (rnd(hc ^ 0xabcdefu) < 0.3) {   // blinds drawn
    let sl = 0.55 + 0.45 * smoothstep(0.3, 0.5, abs(fract(fy * 14.0) - 0.5));
    glass = ws.rgb * ws.a * 0.5 * sl + vec3f(0.006);
  } else {
    glass = interior(vec2f(fx * cw, fy * fh), vec2f(cw, fh), V, T, n, hc, ws);
  }
  glass = glass * (1.0 - fr * refl) + reflC;
  let nearC = mix(wallC, glass, mask);
  let flatC = mix(wallC, ws.rgb * ws.a * 0.45 + reflC * 0.8 + vec3f(0.004), wx * wy);
  let avgL = select(vec3f(1.0, 0.65, 0.38), vec3f(0.9, 0.88, 0.85), style == 1u || style == 3u || style == 4u);
  let farC = mix(wallC, avgL * u.skyTop.w * 0.75 * (0.55 + 0.9 * rnd(seed * 2654435761u)) + reflC * 0.8, wx * wy);
  var c = mix(nearC, flatC, smoothstep(0.3, 0.9, fw));
  c = mix(c, farC, smoothstep(1.2, 4.0, fw));
  return c;
}

fn shadeRoad(I: Inst, w: vec3f, n: vec3f, lp: vec3f, fp: vec2f, V: vec3f) -> vec3f {
  let L = lightAt(w);
  if (n.y < 0.5) { return vec3f(0.12, 0.115, 0.11) * (ambientL(n, w.y) + sunL(n) + streetL(w, n)); }
  var alb = vec3f(0.032, 0.033, 0.037) * (0.75 + 0.5 * fbm(w.xz * 0.12));
  var mark = 0.0; var yel = 0.0;
  let size = instSize(I);
  // q: axis (the local axis the road runs along), width, lanes, mode (0 a road, 1 a crossing, 2 plain)
  if (I.q.w < 0.5) {
    // along: the distance along the road's direction (continuous over pieces in a line); across: local
    var dir = normalize(vec3f(I.m0.x, I.m1.x, I.m2.x)); var across = lp.z * size.z;
    if (I.q.x > 0.5) { dir = normalize(vec3f(I.m0.z, I.m1.z, I.m2.z)); across = lp.x * size.x; }
    let along = dot(w, dir);
    let fa = fwidth(across); let fl = fwidth(along);
    let half = I.q.y * 0.5; let a = abs(across);
    let dash = (1.0 - smoothstep(0.0, 1.0, fl * 0.3));
    if (I.q.z > 1.5) {
      yel = band(abs(a - 0.22), 0.09, fa);
      mark = band(abs(a - half * 0.5), 0.08, fa) * mix(0.45, step(fract(along / 12.0), 0.45), dash);
    } else {
      yel = band(a, 0.09, fa) * mix(0.5, step(fract(along / 9.0), 0.5), dash);
    }
    mark = max(mark, band(abs(a - (half - 0.55)), 0.08, fa));
  } else if (I.q.w < 1.5) {
    let lx = lp.x * size.x; let lz = lp.z * size.z;
    let inX = I.q.y * 0.5 - abs(lx); let inZ = I.q.z * 0.5 - abs(lz);
    let fs = max(fwidth(lx), fwidth(lz));
    let st = mix(0.5, 1.0, 1.0 - smoothstep(0.2, 0.6, fs));
    if (inX > 0.6 && inX < 3.6 && inZ > 1.0) { mark = mix(0.5, step(fract(lz / 1.1), 0.5), st); }
    if (inZ > 0.6 && inZ < 3.6 && inX > 1.0) { mark = mix(0.5, step(fract(lx / 1.1), 0.5), st); }
  }
  let worn = 0.55 + 0.45 * vnoise(w.xz * 0.9);
  alb = mix(alb, vec3f(0.42), mark * worn);
  alb = mix(alb, vec3f(0.42, 0.3, 0.05), yel * worn);
  var c = alb * (ambientL(n, w.y) + sunL(n) + L.rgb * 4.0) * mix(0.5, 1.0, L.a);
  let wet = u.p2.y;
  let pud = smoothstep(0.5, 0.75, fbm(w.xz * 0.05 + 7.0));
  let fr = fresnel(clamp(-dot(V, n), 0.0, 1.0));
  let k = min((0.12 + 0.88 * fr) * (0.12 + wet * (0.3 + 0.4 * pud)), 0.6) * (1.0 - mark * 0.5);
  return c * (1.0 - wet * 0.3) + reflSample(fp, V, n, w, 1.0 + 3.0 * wet) * k;
}

fn shadeSidewalk(w: vec3f, n: vec3f, fp: vec2f, V: vec3f) -> vec3f {
  let L = lightAt(w);
  var alb = vec3f(0.1, 0.098, 0.094);
  if (n.y > 0.5) {
    let g = fract(w.xz / 1.5);
    let e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
    let seams = 1.0 - smoothstep(0.03, 0.12, fwidth(w.x) / 1.5);
    alb *= mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.05, e)) * (0.8 + 0.4 * h21(floor(w.xz / 1.5))), seams);
  } else { alb = vec3f(0.14, 0.135, 0.13); }
  var c = alb * (ambientL(n, w.y) + sunL(n) + L.rgb * 4.0) * mix(0.3, 1.0, L.a);
  if (n.y > 0.5) { c += reflSample(fp, V, n, w, 1.0) * (0.05 + 0.6 * fresnel(clamp(-dot(V, n), 0.0, 1.0))) * u.p2.y * 0.6; }
  return c;
}

fn shadeNeon(I: Inst, lp: vec3f, n: vec3f, w: vec3f) -> vec3f {
  let size = instSize(I);
  let s = u32(I.p.z); let t = u.cam.w;
  let c1 = I.col.rgb; let it = I.col.a;
  if (abs(lp.z) < 0.49) { return vec3f(0.02) * (ambientL(n, w.y) + streetL(w, n)) + c1 * 0.04; }
  let uv = vec2f((lp.x + 0.5) * size.x, (lp.y + 0.5) * size.y);
  let border = min(min(uv.x, size.x - uv.x), min(uv.y, size.y - uv.y));
  let frame = smoothstep(0.24, 0.12, border);
  if (I.p.w < 0.5) {
    // a blade sign: a column of glowing glyphs
    let inner = uv - vec2f(0.25, 0.3);
    let ch = floor(inner.y / 1.2);
    let cl = vec2f(inner.x / (size.x - 0.5) * 3.0, fract(inner.y / 1.2) * 4.6);
    let gi = floor(cl); let gf = fract(cl);
    let inside = inner.x > 0.0 && inner.x < size.x - 0.5 && inner.y > 0.0 && inner.y < size.y - 0.6 && gi.y < 4.0;
    let bit = rnd(ihash(i32(gi.x), i32(gi.y) + i32(ch) * 8, s)) < 0.55;
    let stroke = smoothstep(0.5, 0.32, max(abs(gf.x - 0.5), abs(gf.y - 0.5)));
    var g = 0.0;
    if (inside && bit) { g = stroke; }
    var on = 1.0;
    if (s % 3u == 1u) { on = step(ch, floor(fract(t * 0.25 + rnd(s)) * (floor(size.y / 1.2) + 3.0))); }  // spelled out letter by letter
    let flick = select(1.0, 0.12, rnd(s ^ 9u) < 0.25 && rnd(s ^ u32(t * 12.0)) < 0.05);
    return (c1 * it * (g * on + frame * 0.9) + c1 * 0.05) * flick;
  }
  // a billboard with a slowly changing animated picture
  let p = uv / size.xy;
  var v = 0.0; var col = c1;
  let mode = s % 3u;
  if (mode == 0u) { v = 0.5 + 0.5 * sin(p.x * 12.0 - t * 2.0 + sin(p.y * 6.0 + t)); col = mix(c1, hue(fract(t * 0.05 + p.x * 0.3)), 0.6); }
  else if (mode == 1u) { v = step(0.5, fract(p.x * 4.0 + p.y * 2.0 - t * 0.6)) * 0.7 + 0.3; col = hue(fract(rnd(s) + floor(t * 0.2) * 0.17)); }
  else { let q = (p - 0.5) * vec2f(size.x / size.y, 1.0); v = 0.5 + 0.5 * sin(length(q) * 20.0 - t * 3.0); col = mix(c1, vec3f(1.0), 0.3 * v); }
  return col * it * (0.25 + 0.75 * v) * 0.6 + c1 * it * frame;
}

fn shadeTrain(I: Inst, lp: vec3f, n: vec3f, w: vec3f) -> vec3f {
  let size = instSize(I);
  var c = I.col.rgb * (ambientL(n, w.y) + sunL(n) + streetL(w, n) + vec3f(0.01));
  if (abs(lp.z) > 0.49) {
    let x = (lp.x + 0.5) * size.x;
    if (lp.y > -0.02 && lp.y < 0.3 && abs(lp.x) < 0.46 && abs(fract(x / 1.7) - 0.5) < 0.38) { c = vec3f(1.0, 0.85, 0.62) * 1.6; }
    if (lp.y > -0.2 && lp.y < -0.1) { c = vec3f(0.2, 0.8, 1.0) * 1.2; }
  } else if (abs(lp.x) > 0.49 && abs(n.y) < 0.5) {
    if (lp.y > 0.0 && lp.y < 0.35 && abs(lp.z) < 0.4) { c = vec3f(0.02, 0.03, 0.04); }
  }
  return c;
}

// ---------- props: every box, cylinder, sphere and cone in the city ----------
struct PO {
  @builtin(position) pos: vec4f,
  @location(0) w: vec3f,
  @location(1) n: vec3f,
  @location(2) lp: vec3f,
  @location(3) @interpolate(flat) ii: u32,
  @location(4) em: f32,
  @location(5) @interpolate(flat) cc: vec4f,
};
@vertex fn vs_props(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> PO {
  let I = inst[ii];
  let p4 = vec4f(p, 1.0);
  let w0 = vec3f(dot(I.m0, p4), dot(I.m1, p4), dot(I.m2, p4));
  let s2 = vec3f(I.m0.x * I.m0.x + I.m1.x * I.m1.x + I.m2.x * I.m2.x,
                 I.m0.y * I.m0.y + I.m1.y * I.m1.y + I.m2.y * I.m2.y,
                 I.m0.z * I.m0.z + I.m1.z * I.m1.z + I.m2.z * I.m2.z);
  let nn = n / max(s2, vec3f(1e-8));
  let A = animate(I, w0, vec3f(dot(I.m0.xyz, nn), dot(I.m1.xyz, nn), dot(I.m2.xyz, nn)), u.cam.w);
  var o: PO;
  o.pos = u.viewProj * vec4f(A.w, 1.0);
  o.w = A.w; o.n = A.n; o.lp = p; o.ii = ii; o.em = A.em; o.cc = A.cc;
  return o;
}
@fragment fn fs_props(i: PO) -> @location(0) vec4f {
  if (u.p1.x > 0.5 && i.w.y < u.glow.w) { discard; }
  let I = inst[i.ii];
  let n = normalize(i.n);
  let V = normalize(i.w - u.cam.xyz);
  var col: vec3f;
  switch u32(I.p.x + 0.5) {
    case 1u: { col = shadeBuilding(I, i.w, n, i.lp, V); }
    case 2u: { col = I.col.rgb * I.col.a * i.em; }
    case 3u: { col = shadeRoad(I, i.w, n, i.lp, i.pos.xy, V); }
    case 4u: { col = shadeSidewalk(i.w, n, i.pos.xy, V); }
    case 5u: {
      let alb = I.col.rgb * (0.55 + 0.8 * vnoise(i.w.xz * 0.8 + vec2f(i.w.y * 0.7)));
      col = alb * (ambientL(n, i.w.y) + sunL(n) * 0.8 + lightAt(i.w).rgb * 4.0 * exp(-max(i.w.y, 0.0) / 9.0) * (0.5 + 0.5 * max(n.y, 0.0)));
    }
    case 7u: { col = shadeNeon(I, i.lp, n, i.w); }
    case 8u: { col = shadeTrain(I, i.lp, n, i.w); }
    default: {
      let alb = select(I.col.rgb, i.cc.rgb, i.cc.a > 0.5);
      col = alb * (ambientL(n, i.w.y) + sunL(n) + streetL(i.w, n)) + skyBase(reflect(V, n)) * fresnel(clamp(-dot(V, n), 0.0, 1.0)) * 0.25;
    }
  }
  return vec4f(applyFog(col, i.w), 1.0);
}

// ---------- ground and water ----------
struct GO { @builtin(position) pos: vec4f, @location(0) w: vec3f };
@vertex fn vs_ground(@location(0) p: vec3f, @location(1) n: vec3f) -> GO {
  // the ground and water grids move with the camera, a cell at a time
  let off = floor(u.cam.xz / 128.0) * 128.0;
  let w = p + vec3f(off.x, 0.0, off.y);
  var o: GO; o.pos = u.viewProj * vec4f(w, 1.0); o.w = w; return o;
}
fn waterColor(w: vec3f, V: vec3f, fp: vec2f) -> vec3f {
  let t = u.cam.w; let p = w.xz;
  var g = vec2f(sin(p.x * 0.11 + p.y * 0.05 + t * 0.9), sin(p.y * 0.13 - p.x * 0.04 - t * 0.7)) * 0.04;
  g += (vec2f(vnoise(p * 0.4 + vec2f(t * 0.35, 0.0)), vnoise(p * 0.4 + vec2f(5.2, t * 0.3))) - 0.5) * 0.22;
  g += (vec2f(vnoise(p * 1.7 + vec2f(-t * 0.8, 1.3)), vnoise(p * 1.7 + vec2f(3.1, t * 0.9))) - 0.5) * 0.12;
  g += (vec2f(vnoise(p * 6.0 + t * 3.0), vnoise(p * 6.0 - t * 3.0 + 9.0)) - 0.5) * 0.2 * u.p2.y;
  let dist = distance(w, u.cam.xyz);
  g *= mix(1.0, 0.35, smoothstep(50.0, 900.0, dist));
  let n = normalize(vec3f(g.x, 1.0, g.y));
  let fr = fresnel(clamp(-dot(V, n), 0.0, 1.0));
  var refl: vec3f;
  if (u.p1.w > 0.5) {
    refl = textureSampleLevel(reflTex, samp, fp / u.p1.yz + g * vec2f(0.025, 0.06) * (40.0 / (dist + 40.0) + 0.12), 0.0).rgb;
  } else { refl = skyBase(reflect(V, n)); }
  let deep = vec3f(0.004, 0.009, 0.013) + u.amb.rgb * 0.15;
  let k = 0.3 + 0.7 * fr;
  return deep * (1.0 - k) + refl * k + u.sunCol.rgb * pow(max(dot(reflect(V, n), u.sunDir.xyz), 0.0), 300.0) * 6.0;
}
// far away, where the ground light isn't loaded: the city's lights as scattered dots
fn suburbLights(w: vec3f) -> vec3f {
  let dist = distance(w, u.cam.xyz);
  let r = max(0.9, dist * u.p2.x * 1.3);
  var c = vec3f(0.0);
  let cell = floor(w.xz / 160.0);
  let f = w.xz - cell * 160.0;
  if (rnd(ihash(i32(cell.x), i32(cell.y), 99u)) < 0.7) {
    let d = length(vec2f((fract(f.x / 35.0) - 0.5) * 35.0, f.y - 80.0));
    c += vec3f(1.0, 0.6, 0.3) * 2.2 * exp(-d * d / (r * r));
  }
  let g2 = w.xz / 22.0; let c2 = floor(g2);
  let h2 = ihash(i32(c2.x), i32(c2.y), 7u);
  if (rnd(h2) < 0.3) {
    let d = length((g2 - c2 - (vec2f(rnd(h2 ^ 1u), rnd(h2 ^ 2u)) * 0.8 + 0.1)) * 22.0);
    c += vec3f(1.0, 0.75, 0.45) * 1.3 * exp(-d * d / (r * r));
  }
  return c * smoothstep(300.0, 900.0, distance(w.xz, u.cam.xz));
}
@fragment fn fs_ground(i: GO) -> @location(0) vec4f {
  let w = i.w;
  if (riverDist(w.x, w.z) < 1.0) { discard; }
  let V = normalize(w - u.cam.xyz);
  let n = vec3f(0.0, 1.0, 0.0);
  let uv = w.xz / SPAN;
  var ty = 7u; var path = 0.0; var pond = 0.0;
  if (tileOK(w)) {
    ty = u32(textureLoad(layoutTex, vec2i(floor(fract(uv) * SPAN_PX)), 0).r * 255.0 + 0.5);
    if (ty == 10u) { discard; }   // the open ramp down into a tunnel
    let ls = textureSampleLevel(layoutTex, sampW, uv, 0.0);
    path = ls.g; pond = ls.a;
  }
  let L = lightAt(w);
  var alb: vec3f;
  if (ty == 2u) { alb = mix(vec3f(0.035, 0.06, 0.028) * (0.6 + 0.8 * fbm(w.xz * 0.15)), vec3f(0.1, 0.09, 0.075), path); }
  else if (ty == 9u) {   // mown grass: a fairway or a green, in stripes
    let st = step(0.5, fract((w.x + w.z) / 16.0));
    alb = mix(vec3f(0.055, 0.105, 0.04) * (0.82 + 0.3 * st) * (0.85 + 0.3 * fbm(w.xz * 0.05)), vec3f(0.12, 0.11, 0.085), path);
  }
  else if (ty == 6u) {
    let g = fract(w.xz / 2.0); let e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
    alb = vec3f(0.11, 0.1, 0.095) * mix(0.7, 1.0, smoothstep(0.0, 0.05, e));
  }
  else if (ty == 7u) { alb = vec3f(0.02, 0.022, 0.02) * (0.6 + 0.8 * fbm(w.xz * 0.01)); }
  else if (ty == 8u) {   // paving: the pavements round a block
    let g = fract(w.xz / 1.5); let e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
    let seams = 1.0 - smoothstep(0.03, 0.12, fwidth(w.x) / 1.5);
    alb = vec3f(0.1, 0.098, 0.094) * mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.05, e)) * (0.8 + 0.4 * h21(floor(w.xz / 1.5))), seams);
  }
  else { alb = vec3f(0.05, 0.045, 0.04) * (0.7 + 0.6 * fbm(w.xz * 0.2)); }
  var c = alb * (ambientL(n, 0.0) + sunL(n) + L.rgb * 4.0) * mix(0.4, 1.0, L.a);
  if (ty == 8u) { c += reflSample(i.pos.xy, V, n, w, 1.0) * (0.05 + 0.6 * fresnel(clamp(-dot(V, n), 0.0, 1.0))) * u.p2.y * 0.6; }
  if (pond > 0.01) { c = mix(c, waterColor(w, V, i.pos.xy), pond); }
  if (ty == 7u) { c += suburbLights(w); }
  return vec4f(applyFog(c, w), 1.0);
}
@fragment fn fs_water(i: GO) -> @location(0) vec4f {
  if (riverDist(i.w.x, i.w.z) > 1.5) { discard; }   // only in a river (not under a tunnel's ramp)
  return vec4f(applyFog(waterColor(i.w, normalize(i.w - u.cam.xyz), i.pos.xy), i.w), 1.0);
}

// ---------- sky ----------
struct FO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: FO; o.pos = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}
@fragment fn fs_sky(i: FO) -> @location(0) vec4f {
  // a point 300 m out (not at infinity: far from the origin that would lose the direction to rounding)
  let pn = u.invViewProj * vec4f(i.ndc, 0.001, 1.0);
  let d = normalize(pn.xyz / pn.w - u.cam.xyz);
  var c = skyBase(d);
  if (d.y > -0.02) {
    let sp = d * 240.0; let cell = floor(sp);
    let h = ihash(i32(cell.x), i32(cell.y), bitcast<u32>(i32(cell.z)));
    if (rnd(h) < 0.04) {
      let off = vec3f(rnd(h ^ 1u), rnd(h ^ 2u), rnd(h ^ 3u)) * 0.6 + 0.2;
      let tw = 0.6 + 0.4 * sin(u.cam.w * (1.0 + 3.0 * rnd(h ^ 4u)) + rnd(h ^ 5u) * 6.0);
      c += mix(vec3f(0.7, 0.8, 1.0), vec3f(1.0, 0.85, 0.7), rnd(h ^ 6u)) * smoothstep(0.16, 0.0, length(sp - cell - off))
           * tw * u.sunDir.w * smoothstep(0.0, 0.3, d.y) * (0.5 + 2.0 * rnd(h ^ 7u));
    }
    let cp = d.xz / (d.y + 0.1) * 1.4 + vec2f(u.cam.w * 0.006, u.cam.w * 0.002);
    let cl = smoothstep(0.42, 0.85, fbm(cp * 0.7)) * smoothstep(-0.02, 0.2, d.y);
    let sd = max(dot(d, u.sunDir.xyz), 0.0);
    let cc = u.skyHor.rgb * 0.5 + u.glow.rgb * 0.22 * (1.0 - d.y) + u.sunCol.rgb * pow(sd, 6.0) * 0.6 + u.amb.rgb * 0.5;
    c = mix(c, cc, cl * 0.8);
  }
  return vec4f(c, 1.0);
}

// ---------- light sprites: lamps, headlights, cable lights, warning lights ----------
struct SO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f };
@vertex fn vs_sprite(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  let I = inst[ii];
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let A = animate(I, vec3f(I.m0.w, I.m1.w, I.m2.w), vec3f(0.0, 1.0, 0.0), u.cam.w);
  var c = A.w;
  var k = A.em;
  let anim = u32(I.p.y + 0.5);
  var col = I.col.rgb;
  if (anim == 1u && abs(I.p.z) > 0.5 && k > 0.0) {   // headlights face forward, tail lights back
    let P = carPose(I.q, I.p.w, u.cam.w);
    let f = dot(rotY(vec3f(1.0, 0.0, 0.0), P.yaw), normalize(u.cam.xyz - c)) * sign(I.p.z);
    k *= mix(0.1, 1.0, smoothstep(-0.3, 0.7, f));
  }
  if (anim == 3u) { col = mix(hue(fract(I.p.w + u.cam.w * 0.07)), vec3f(1.0), 0.25); }
  let toC = u.cam.xyz - c; let dist = max(length(toC), 0.01);
  let s = max(I.p.x, u.p2.x * dist * 1.6);
  k *= clamp(I.p.x / s, 0.25, 1.0);
  c += toC / dist * min(0.6, dist * 0.3);
  var o: SO;
  o.pos = u.viewProj * vec4f(c + (u.right.xyz * corner.x + u.up.xyz * corner.y) * s, 1.0);
  o.uv = corner;
  o.col = col * I.col.a * k * (1.0 - fogF(c));
  return o;
}
@fragment fn fs_sprite(i: SO) -> @location(0) vec4f {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.0) { discard; }
  return vec4f(i.col * (exp(-d2 * 6.0) + exp(-d2 * 40.0) * 2.0) * (1.0 - d2), 0.0);
}

// ---------- searchlight beams ----------
struct BO { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) n: vec3f, @location(2) a: f32, @location(3) @interpolate(flat) ii: u32 };
@vertex fn vs_beam(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> BO {
  let I = inst[ii];
  let p4 = vec4f(p, 1.0);
  let w0 = vec3f(dot(I.m0, p4), dot(I.m1, p4), dot(I.m2, p4));
  let base = vec3f(I.m0.w, I.m1.w, I.m2.w);
  let t = u.cam.w;
  let tilt = I.q.y + 0.12 * sin(t * 0.21 + I.p.w * 3.0);
  let ang = I.p.w + t * I.q.x;
  var o: BO;
  o.w = base + rotY(rotX(w0 - base, tilt), ang);
  o.n = rotY(rotX(n, tilt), ang);
  o.pos = u.viewProj * vec4f(o.w, 1.0);
  o.a = p.y; o.ii = ii;
  return o;
}
@fragment fn fs_beam(i: BO) -> @location(0) vec4f {
  let I = inst[i.ii];
  let e = abs(dot(normalize(i.n), normalize(i.w - u.cam.xyz)));
  let fade = (1.0 - i.a) * (1.0 - i.a) * smoothstep(0.0, 0.01, i.a);
  return vec4f(I.col.rgb * I.col.a * e * e * fade * (1.0 - 0.7 * fogF(i.w)) * u.p2.z, 0.0);
}

// ---------- rain: streaks that wrap around the camera ----------
@vertex fn vs_rain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  let h = pcg(ii * 7u + 1u);
  let r = vec3f(rnd(h), rnd(h ^ 0x1234567u), rnd(h * 5u + 3u));
  let B = vec3f(60.0, 40.0, 60.0);
  let t = u.cam.w;
  var p = r * B;
  p.y -= t * 16.0 + r.x * 7.0;
  p.x += t * 2.0;
  p = u.cam.xyz + (fract((p - u.cam.xyz) / B + 0.5) - 0.5) * B;
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let toC = u.cam.xyz - p; let dist = length(toC);
  let side = normalize(cross(vec3f(0.0, 1.0, 0.0), toC / max(dist, 0.01)));
  let wp = p + side * corner.x * 0.012 * max(1.0, dist * 0.08) + vec3f(0.12, 1.0, 0.0) * corner.y * 0.55;
  var o: SO;
  o.pos = u.viewProj * vec4f(wp, 1.0);
  o.uv = corner;
  let lit = u.amb.rgb * 4.0 + u.glow.rgb * 0.2 + lightAt(p).rgb * 2.0 * exp(-max(p.y, 0.0) / 10.0);
  o.col = lit * 0.22 * u.amb.w * smoothstep(0.5, 3.0, dist) * (1.0 - smoothstep(18.0, 30.0, dist));
  return o;
}
@fragment fn fs_rain(i: SO) -> @location(0) vec4f {
  return vec4f(i.col * (1.0 - abs(i.uv.x)) * (1.0 - i.uv.y * i.uv.y), 0.0);
}
`;
}

// bloom (a chain of downsamples and tent-filtered upsamples) and the final tone mapping
const POST_WGSL = /*wgsl*/`
struct PU { texel: vec2f, intensity: f32, mode: f32, exposure: f32, time: f32, vignette: f32, pad: f32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> pu: PU;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
struct FO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: FO; o.pos = vec4f(p, 0.0, 1.0); o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); return o;
}
fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv, 0.0).rgb; }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
@fragment fn fs_down(i: FO) -> @location(0) vec4f {
  let t = pu.texel; let uv = i.uv;
  let a = s(uv + t * vec2f(-2.0, -2.0)); let b = s(uv + t * vec2f(0.0, -2.0)); let c = s(uv + t * vec2f(2.0, -2.0));
  let d = s(uv + t * vec2f(-1.0, -1.0)); let e = s(uv + t * vec2f(1.0, -1.0));
  let f = s(uv + t * vec2f(-2.0, 0.0)); let g = s(uv); let h = s(uv + t * vec2f(2.0, 0.0));
  let j = s(uv + t * vec2f(-1.0, 1.0)); let k = s(uv + t * vec2f(1.0, 1.0));
  let l = s(uv + t * vec2f(-2.0, 2.0)); let m = s(uv + t * vec2f(0.0, 2.0)); let n = s(uv + t * vec2f(2.0, 2.0));
  if (pu.mode > 0.5) {
    // first level: weight each group of taps to tame single bright pixels, then keep only what is bright
    let g0 = (d + e + j + k) * 0.25; let g1 = (a + b + f + g) * 0.25; let g2 = (b + c + g + h) * 0.25;
    let g3 = (f + g + l + m) * 0.25; let g4 = (g + h + m + n) * 0.25;
    let w0 = karis(g0) * 0.5; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.125;
    var col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    let br = max(col.r, max(col.g, col.b));
    let knee = 0.6; let thr = 0.9;
    let soft = clamp(br - thr + knee, 0.0, 2.0 * knee);
    let contrib = max(soft * soft / (4.0 * knee + 1e-4), br - thr) / max(br, 1e-4);
    return vec4f(min(col * contrib, vec3f(60.0)), 1.0);
  }
  return vec4f((d + e + j + k) * 0.125 + (a + c + l + n) * 0.03125 + (b + f + h + m) * 0.0625 + g * 0.125, 1.0);
}
@fragment fn fs_up(i: FO) -> @location(0) vec4f {
  let t = pu.texel; let uv = i.uv;
  var c = s(uv) * 4.0;
  c += (s(uv + vec2f(-t.x, 0.0)) + s(uv + vec2f(t.x, 0.0)) + s(uv + vec2f(0.0, -t.y)) + s(uv + vec2f(0.0, t.y))) * 2.0;
  c += s(uv + vec2f(-t.x, -t.y)) + s(uv + vec2f(t.x, -t.y)) + s(uv + vec2f(-t.x, t.y)) + s(uv + vec2f(t.x, t.y));
  return vec4f(c / 16.0 * pu.intensity, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs_comp(i: FO) -> @location(0) vec4f {
  var c = s(i.uv) + textureSampleLevel(bloomTex, smp, i.uv, 0.0).rgb * pu.intensity;
  c *= pu.exposure;
  c = aces(c);
  let q = i.uv - 0.5;
  c *= 1.0 - pu.vignette * dot(q, q) * 1.6;
  c = pow(c, vec3f(1.0 / 2.2));
  // a faint violet lift in the shadows, and dither against banding
  c += vec3f(0.012, 0.006, 0.022) * (1.0 - c);
  let n = fract(sin(dot(i.pos.xy + pu.time * 61.0, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(c + (n - 0.5) / 255.0, 1.0);
}
`;
