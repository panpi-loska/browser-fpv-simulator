// ---------------------------------------------------------------------------
// cranes.js: Halvard Bay's building sites. A concrete frame going up, fenced and lit, and a tower
// crane beside it whose jib slews slowly back and forth (ANIM.slew in shaders.js).
// ---------------------------------------------------------------------------

// ---------- a tower crane: lattice mast, slewing jib with trolley and hook, counterweights, lights ----------
// o.still: an abandoned crane that no longer turns; o.col: its paint
function towerCrane(K, x, z, h, L, yaw, o = {}) {
  const { G, basic, emissive, sprite, rd } = K;
  K.snd = 2;
  const col = o.col || [0.75, 0.55, 0.08], dark = [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5];
  const spin = o.still ? 0 : 0.03 + rd() * 0.04, q = [x, 0, z, spin];
  // base and mast (fixed)
  basic(G.cube, TM.box(x, 0.8, z, 6, 1.6, 6), [0.3, 0.29, 0.27]);
  K.collider(x - 3, 0, z - 3, x + 3, 1.6, z + 3);
  const P = [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]];
  for (const [a, b] of P) basic(G.cube, TM.box(x + a, h / 2, z + b, 0.25, h, 0.25), col);
  for (let y = 1.6, k = 0; y < h - 3; y += 3, k++)
    for (let f = 0; f < 4; f++) {
      const A = P[f], B = P[(f + 1) % 4], up = k % 2 ? [A, B] : [B, A];
      basic(G.cube, TM.seg(x + up[0][0], y, z + up[0][1], x + up[1][0], y + 3, z + up[1][1], 0.1), col);
    }
  K.collider(x - 1.1, 0, z - 1.1, x + 1.1, h + 1.5, z + 1.1);
  // everything above turns with the jib (ANIM.slew about the mast, phase = yaw)
  const S = (m, c) => basic(G.cube, m, c, ANIM.slew, q, yaw);
  const SE = (m, c, it) => emissive(G.cube, m, c, it, ANIM.slew, q, yaw);
  S(TM.box(x, h + 0.75, z, 3.4, 1.5, 3.4), dark);
  S(TM.box(x + 1.2, h + 2.4, z + 2.0, 2.2, 2.2, 2.0), [0.2, 0.2, 0.22]);           // the cab
  SE(TM.box(x + 2.32, h + 2.6, z + 2.0, 0.06, 1.1, 1.6), [1, 0.75, 0.45], 1.2);  // its window
  // the tower head, a pyramid
  const apex = [x, h + 11, z];
  for (const [a, b] of P) S(TM.seg(x + a, h + 1.5, z + b, apex[0], apex[1], apex[2], 0.2), col);
  // the jib (+x) and the counter-jib (-x): chords and braces
  const yb = h + 1.6, yt = h + 3.4, Lc = L * 0.32;
  for (const zc of [-0.8, 0.8]) S(TM.seg(x + 1.5, yb, z + zc, x + L, yb, z + zc, 0.18), col);
  S(TM.seg(x + 1.5, yt, z, x + L - 2, yb + 0.4, z, 0.18), col);
  for (let d = 2, k = 0; d < L - 2; d += 2.5, k++) {
    const zc = k % 2 ? 0.8 : -0.8;
    S(TM.seg(x + d, yb, z + zc, x + d + 1.25, lerp(yt, yb + 0.4, (d + 1.25) / L), z, 0.08), col);
    S(TM.seg(x + d + 1.25, lerp(yt, yb + 0.4, (d + 1.25) / L), z, x + d + 2.5, yb, z - zc, 0.08), col);
  }
  for (const zc of [-1, 1]) S(TM.seg(x - 1.5, yb, z + zc, x - Lc, yb, z + zc, 0.22), col);
  for (let d = 2.5; d < Lc; d += 3) S(TM.seg(x - d, yb, z - 1, x - d, yb, z + 1, 0.12), col);
  S(TM.box(x - Lc + 3, yb - 1.2, z, 3.5, 2.6, 2.8), [0.42, 0.41, 0.39]);         // counterweights
  // the pendants from the apex to the jib and the counter-jib
  S(TM.seg(apex[0], apex[1], apex[2], x + L * 0.55, yt - 0.5, z, 0.06), [0.3, 0.3, 0.32]);
  S(TM.seg(apex[0], apex[1], apex[2], x - Lc + 1, yb + 0.3, z, 0.06), [0.3, 0.3, 0.32]);
  // trolley, cable and hook block
  const tr = L * (0.35 + rd() * 0.5), hook = Math.max(6, h * (0.25 + rd() * 0.6));
  S(TM.box(x + tr, yb - 0.3, z, 1.6, 0.6, 1.8), dark);
  S(TM.seg(x + tr, yb - 0.5, z, x + tr, yb - hook, z, 0.05), [0.15, 0.15, 0.16]);
  S(TM.box(x + tr, yb - hook - 0.6, z, 0.9, 1.2, 0.7), [0.7, 0.5, 0.05]);
  if (!o.still && rd() < 0.6) S(TM.box(x + tr, yb - hook - 2.4, z, 4, 1.2, 1.2), [0.35, 0.3, 0.25]); // a load of beams
  // lights: red on the apex and both tips, a few work lamps along the jib
  const red = [1, 0.08, 0.04];
  sprite(apex[0], apex[1] + 0.4, apex[2], red, 7, 1.0, o.still ? ANIM.blink : ANIM.slew, 0, o.still ? rd() : yaw, o.still ? undefined : q);
  sprite(x + L, yb + 0.5, z, red, 6, 0.9, ANIM.slew, 0, yaw, q);
  sprite(x - Lc, yb + 0.5, z, red, 6, 0.9, ANIM.slew, 0, yaw, q);
  if (!o.still) {
    for (let d = 10; d < L; d += 14) sprite(x + d, yb - 0.4, z, [1, 0.85, 0.6], 3, 0.5, ANIM.slew, 0, yaw, q);
    sprite(x, h - 0.5, z, [1, 0.8, 0.55], 6, 1.2);
    K.splat(x, z, 0.8, 0.6, 0.4, 14);
  }
  K.snd = 0;
}

// ---------- a building site: a concrete frame going up, fenced, with work lights and its crane ----------
function constructionSite(K, x0, z0, x1, z1, Htarget) {
  const { G, basic, sprite, splat, rd, Rd } = K;
  const w = x1 - x0, d = z1 - z0, inset = 4;
  const bx0 = x0 + inset, bz0 = z0 + inset, bx1 = x1 - inset, bz1 = z1 - inset, fh = 3.6;
  const floors = Math.max(4, Math.round((Htarget * Rd(0.3, 0.75)) / fh)), built = floors * fh;
  const concrete = [0.3, 0.29, 0.27];
  for (let k = 1; k <= floors; k++) {
    const y = k * fh, full = k < floors - 1;
    basic(G.cube, TM.box((bx0 + bx1) / 2, y - 0.15, (bz0 + bz1) / 2, bx1 - bx0, 0.3, bz1 - bz0), concrete);
    K.collider(bx0, y - 0.3, bz0, bx1, y, bz1);
    if (full && rd() < 0.3) basic(G.cube, TM.box((bx0 + bx1) / 2, y + 0.6, bz0 + 0.1, bx1 - bx0, 1.2, 0.08), [0.75, 0.3, 0.05]); // safety netting
    if (rd() < 0.35) { const lx = Rd(bx0 + 2, bx1 - 2), lz = Rd(bz0 + 2, bz1 - 2); sprite(lx, y - 0.6, lz, [1, 0.62, 0.3], 4, 0.8); }
  }
  // columns on a 6 m grid, one floor higher than the last slab
  for (let cx = bx0 + 0.4; cx <= bx1 - 0.3; cx += (bx1 - bx0 - 0.8) / Math.max(1, Math.round((bx1 - bx0) / 6)))
    for (let cz = bz0 + 0.4; cz <= bz1 - 0.3; cz += (bz1 - bz0 - 0.8) / Math.max(1, Math.round((bz1 - bz0) / 6))) {
      basic(G.cube, TM.box(cx, (built + fh) / 2, cz, 0.6, built + fh, 0.6), concrete);
      K.collider(cx - 0.3, 0, cz - 0.3, cx + 0.3, built + fh, cz + 0.3);
    }
  // the stair core
  const sx = bx0 + 3, sz = bz0 + 3;
  basic(G.cube, TM.box(sx, (built + fh * 2) / 2, sz, 5, built + fh * 2, 5), [0.33, 0.32, 0.3]);
  K.collider(sx - 2.5, 0, sz - 2.5, sx + 2.5, built + fh * 2, sz + 2.5);
  // hoarding around the plot, lit by a few sodium lamps
  for (const [a, b, c, e] of [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]])
    basic(G.cube, TM.box((a + c) / 2, 1.2, (b + e) / 2, Math.max(0.2, c - a), 2.4, Math.max(0.2, e - b)), [0.08, 0.16, 0.12]);
  for (const [lx, lz] of [[x0 + 2, z0 + 2], [x1 - 2, z1 - 2]]) { sprite(lx, 6, lz, [1, 0.62, 0.3], 5, 1); splat(lx, lz, 0.8, 0.5, 0.25, 10); }
  // the crane, on the corner of the plot, its jib over the frame
  const ch = built + Rd(22, 34);
  towerCrane(K, x1 - 3, z0 + 3, ch, Math.max(35, Math.hypot(w, d) * 0.9), Rd(0, Math.PI * 2));
  return { x: x1 - 3, z: z0 + 3, top: ch };
}
