// ---------------------------------------------------------------------------
// quad.js: the quad as seen from the line-of-sight view. A handful of instances
// (frame, arms, motors, props, battery, camera, LEDs) kept in the renderer's instance buffer and
// moved every frame to libfpv's pose. Hidden in the FPV view, where the camera sits inside it.
// ---------------------------------------------------------------------------

function addDroneModel(G) {
  const cube = (col, emissive = 0) => { G.cube.push(new Array(12).fill(0), [...col, emissive], [emissive ? MAT.emissive : MAT.basic, 0, 7, 0]); return { g: 'cube', i: G.cube.n - 1, col, emissive }; };
  const cyl = (col) => { G.cyl.push(new Array(12).fill(0), [...col, 0], [MAT.basic, 0, 7, 0]); return { g: 'cyl', i: G.cyl.n - 1, col, emissive: 0 }; };
  const carbon = [0.07, 0.07, 0.08];
  return {
    body: cube(carbon), plate: cube(carbon), battery: cube([0.55, 0.42, 0.08]), cam: cube([0.06, 0.06, 0.07]), lens: cube([0.25, 0.4, 0.9], 3),
    arms: [0, 1, 2, 3].map(() => cube(carbon)),
    motors: [0, 1, 2, 3].map(() => cyl([0.25, 0.26, 0.3])),
    props: [0, 1, 2, 3].map(() => cube([0.9, 0.35, 0.12])),
    discs: [0, 1, 2, 3].map(() => cyl([0.12, 0.08, 0.06])),
    ledF: cube([1, 1, 1], 10), ledR: cube([1, 0.1, 0.05], 14),
  };
}

// quaternion [x, y, z, w] to the columns of a rotation matrix
function quatCols(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}
// world transform (3 rows of 3x4) of a local 3x4 transform m placed on the quad
function onQuad(cols, pos, m) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += cols[k][r] * m[k * 4 + c];
      out[r * 4 + c] = s + (c === 3 ? pos[r] : 0);
    }
  }
  return out;
}
const ZERO12 = new Array(12).fill(0);

function updateDroneModel(R, M, f, visible, propAngle) {
  const put = (part, m) => R.setInstance(part.g, part.i, visible ? m : ZERO12, [...part.col, part.emissive], [part.emissive ? MAT.emissive : MAT.basic, 0, 7, 0]);
  const cols = quatCols(f.rot), p = f.pos, place = (m) => onQuad(cols, p, m);
  // the frame's size from where libfpv says the motors are
  const mp = f.motors.map((m) => m.pos), arm = Math.max(0.03, Math.hypot(mp[0][0], mp[0][2]));
  const s = arm / 0.112;  // relative to a 5" quad
  put(M.body, place(TM.box(0, 0.012 * s, 0, 0.05 * s, 0.012 * s, 0.12 * s)));
  put(M.plate, place(TM.box(0, 0.042 * s, 0, 0.045 * s, 0.004 * s, 0.1 * s)));
  put(M.battery, place(TM.box(0, 0.062 * s, 0.008 * s, 0.036 * s, 0.032 * s, 0.075 * s)));
  put(M.cam, place(TM.box(0, 0.028 * s, -0.052 * s, 0.022 * s, 0.022 * s, 0.022 * s)));
  put(M.lens, place(TM.box(0, 0.03 * s, -0.064 * s, 0.012 * s, 0.012 * s, 0.004 * s)));
  put(M.ledF, place(TM.box(0, 0.005 * s, -0.062 * s, 0.01 * s, 0.006 * s, 0.004 * s)));
  put(M.ledR, place(TM.box(0, 0.02 * s, 0.066 * s, 0.05 * s, 0.012 * s, 0.008 * s)));
  const dia = 2 * Math.max(0.035, arm * 0.57);
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = mp[i];
    put(M.arms[i], place(TM.seg(0, 0.004, 0, x, 0.004, z, 0.008 * s, 0.022 * s)));
    put(M.motors[i], place(TM.box(x, y + 0.012 * s, z, 0.028 * s, 0.022 * s, 0.028 * s)));
    // fast props blur into a disc; slow ones show their blades
    const fast = Math.abs(f.motors[i].rpm) > 2500, broken = f.motors[i].damage >= 0.99;
    put(M.discs[i], fast && !broken ? place(TM.box(x, y + 0.026 * s, z, dia, 0.002, dia)) : ZERO12);
    put(M.props[i], !fast && !broken ? place(TM.yaw(x, y + 0.026 * s, z, dia, 0.003, 0.011 * s, propAngle[i])) : ZERO12);
  }
}
