// ---------------------------------------------------------------------------
// math.js: random numbers, noise, matrices and the small meshes everything is built from
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function hash2i(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2i(ix, iz), hash2i(ix + 1, iz), ux), lerp(hash2i(ix, iz + 1), hash2i(ix + 1, iz + 1), ux), uz);
}

// ---- 4x4 matrices, column-major like WGSL ----
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
// reversed-Z, infinite far plane: depth = near / distance, cleared to 0, compared with 'greater'
function perspectiveRevInf(fovy, aspect, near) {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[11] = -1; m[14] = near;
  return m;
}
// camera looks along forward = (sin yaw cos pitch, sin pitch, -cos yaw cos pitch)
function camBasis(yaw, pitch) {
  const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const r = [Math.cos(yaw), 0, Math.sin(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}
function viewMatrix(pos, b) {
  const { f, r, u } = b, m = new Float32Array(16), d = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -d(r, pos);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -d(u, pos);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = d(f, pos);
  m[15] = 1;
  return m;
}
// mirror about the horizontal plane y = h
function mirrorY(h) {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = -1; m[10] = 1; m[13] = 2 * h; m[15] = 1;
  return m;
}
function mat4Inv(m) {
  const o = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return o;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

// ---- instance transforms: 3 rows of a 3x4 affine matrix (12 floats) ----
const TM = {
  box: (cx, cy, cz, sx, sy, sz) => [sx, 0, 0, cx, 0, sy, 0, cy, 0, 0, sz, cz],
  // rotated about y; local +x maps to (cos a, 0, -sin a)
  yaw(cx, cy, cz, sx, sy, sz, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c * sx, 0, s * sz, cx, 0, sy, 0, cy, -s * sx, 0, c * sz, cz];
  },
  // pitched about x; local +z maps to (0, sn, cs)
  pitch: (cx, cy, cz, sx, sy, sz, sn, cs) => [sx, 0, 0, cx, 0, cs * sy, -sn * sz, cy, 0, sn * sy, cs * sz, cz],
  // a beam from A to B: local y runs along the segment, thickness t
  seg(ax, ay, az, bx, by, bz, t, t2 = t) {
    let yx = bx - ax, yy = by - ay, yz = bz - az;
    const len = Math.hypot(yx, yy, yz) || 1e-6;
    yx /= len; yy /= len; yz /= len;
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(yy) > 0.9) { rx = 1; ry = 0; }
    // X = normalize(Y x ref), Z = X x Y (right-handed)
    let xx = yy * rz - yz * ry, xy = yz * rx - yx * rz, xz = yx * ry - yy * rx;
    const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
    const zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx;
    return [xx * t, yx * len, zx * t2, (ax + bx) / 2, xy * t, yy * len, zy * t2, (ay + by) / 2, xz * t, yz * len, zz * t2, (az + bz) / 2];
  },
};

// ---- meshes: interleaved position + normal, triangles wound counter-clockwise from outside ----
function meshBuilder() {
  const v = [], idx = [];
  return {
    v, idx,
    vert(p, n) { v.push(p[0], p[1], p[2], n[0], n[1], n[2]); return v.length / 6 - 1; },
    // adds a triangle, flipping it if it faces against its vertex normals
    tri(a, b, c) {
      const P = (i, k) => v[i * 6 + k];
      const e1 = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)];
      const e2 = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let d = 0;
      for (const i of [a, b, c]) d += fn[0] * P(i, 3) + fn[1] * P(i, 4) + fn[2] * P(i, 5);
      if (d < 0) idx.push(a, c, b); else idx.push(a, b, c);
    },
    done() { return { vertices: new Float32Array(v), indices: new Uint32Array(idx) }; },
  };
}
function cubeMesh() {
  const m = meshBuilder();
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of faces) {
    const a = Math.abs(n[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
    const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
      m.vert([n[0] * 0.5 + a[0] * s * 0.5 + b[0] * t * 0.5, n[1] * 0.5 + a[1] * s * 0.5 + b[1] * t * 0.5, n[2] * 0.5 + a[2] * s * 0.5 + b[2] * t * 0.5], n));
    m.tri(q[0], q[1], q[2]); m.tri(q[0], q[2], q[3]);
  }
  return m.done();
}
// radius 0.5, y from -0.5 to 0.5; rTop < 0.5 makes a cone-ish frustum
function cylinderMesh(seg = 14, rTop = 0.5, caps = true) {
  const m = meshBuilder(), slope = 0.5 - rTop;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const ring = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const nrm = (a) => { const l = Math.hypot(1, slope); return [Math.cos(a) / l, slope / l, Math.sin(a) / l]; };
    const b0 = m.vert(ring(a0, 0.5, -0.5), nrm(a0)), b1 = m.vert(ring(a1, 0.5, -0.5), nrm(a1));
    const t0 = m.vert(ring(a0, rTop, 0.5), nrm(a0)), t1 = m.vert(ring(a1, rTop, 0.5), nrm(a1));
    m.tri(b0, b1, t1); m.tri(b0, t1, t0);
    if (caps) {
      const cb = m.vert([0, -0.5, 0], [0, -1, 0]);
      m.tri(cb, m.vert(ring(a0, 0.5, -0.5), [0, -1, 0]), m.vert(ring(a1, 0.5, -0.5), [0, -1, 0]));
      if (rTop > 0.001) {
        const ct = m.vert([0, 0.5, 0], [0, 1, 0]);
        m.tri(ct, m.vert(ring(a0, rTop, 0.5), [0, 1, 0]), m.vert(ring(a1, rTop, 0.5), [0, 1, 0]));
      }
    }
  }
  return m.done();
}
function sphereMesh(sub = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; };
  verts = verts.map(norm);
  for (let s = 0; s < sub; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (!cache.has(k)) { verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])); cache.set(k, verts.length - 1); }
      return cache.get(k);
    };
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const m = meshBuilder();
  for (const p of verts) m.vert([p[0] * 0.5, p[1] * 0.5, p[2] * 0.5], p);
  for (const [a, b, c] of faces) m.tri(a, b, c);
  return m.done();
}
// open cone for light beams: apex at the origin, radius 1 at y = 1
function beamMesh(seg = 20) {
  const m = meshBuilder();
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const p0 = m.vert([n0[0] * 0.03, 0, n0[2] * 0.03], n0), p1 = m.vert([n1[0] * 0.03, 0, n1[2] * 0.03], n1);
    const q0 = m.vert([n0[0], 1, n0[2]], n0), q1 = m.vert([n1[0], 1, n1[2]], n1);
    m.tri(p0, p1, q1); m.tri(p0, q1, q0);
  }
  return m.done();
}
function quadMesh(x0, z0, x1, z1, y) {
  const m = meshBuilder(), n = [0, 1, 0];
  const a = m.vert([x0, y, z0], n), b = m.vert([x1, y, z0], n), c = m.vert([x1, y, z1], n), d = m.vert([x0, y, z1], n);
  m.tri(a, b, c); m.tri(a, c, d);
  return m.done();
}
