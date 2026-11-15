// ---------------------------------------------------------------------------
// goggles.js: what the pilot sees. Takes the rendered city (an LDR texture) and draws it the way
// FPV goggles show it, from libfpv's frame: the fisheye lens, the analog link (snow, sparkles,
// torn and rolling lines, colour loss, motor noise) or digital breakup, the camera's resolution
// and aspect with black bars, and the Betaflight OSD, in the signal (analog) or over it.
// Also draws libfpv's draw data (the OSD glyphs and the F8 overlay) on a second, full-resolution
// canvas. A WebGPU port of libfpv's docs/renderers/fpv_video_gl3.h and fpv_render_gl3.h.
// SPDX-License-Identifier: GPL-3.0-or-later
// ---------------------------------------------------------------------------

// The signal: one pixel of the feed's raster per fragment. Everything works in "picture"
// coordinates with y up, as the GL original does; textures are sampled through tx(), which flips.
const SIGNAL_WGSL = /*wgsl*/`
override MODE: u32 = 0u;
struct SU {
  raster: vec2f, noise: f32, res: f32,
  osdIn: f32, picAspect: f32, sceneAspect: f32, zoom: f32,
  k: vec2f, lumaCycles: f32, chromaCycles: f32,
  subcarrier: f32, sharpen: f32, parity: f32, roll: f32,
  seed: f32, activeLines: f32, totalLines: f32, blocks: f32,
  interf: vec4f,
  digital: vec2f, softness: f32, pad: f32,
};
@group(0) @binding(0) var<uniform> u: SU;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var osdT: texture_2d<f32>;
@group(0) @binding(3) var lines: texture_2d<f32>;
@group(0) @binding(4) var history: texture_2d<f32>;
@group(0) @binding(5) var smp: sampler;
const PI = 3.14159265;
struct VO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VO; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); return o;
}
fn tx(t: texture_2d<f32>, p: vec2f) -> vec4f { return textureSampleLevel(t, smp, vec2f(p.x, 1.0 - p.y), 0.0); }
fn h13(p0: vec3f) -> f32 { var p = fract(p0 * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
fn gn(p: vec3f) -> f32 { return (h13(p) + h13(p + vec3f(17.1, 3.7, 9.3)) - 1.0) * 2.45; }
fn sceneUv(p: vec2f) -> vec2f {
  let scale = vec2f(u.picAspect, 1.0) / (0.5 * sqrt(u.picAspect * u.picAspect + 1.0));
  let c = (p - 0.5) * scale; let r2 = dot(c, c);
  var d = c * (1.0 + u.k.x * r2 + u.k.y * r2 * r2) / u.zoom / scale;
  let s = u.picAspect / u.sceneAspect;
  if (s <= 1.0) { d.x *= s; } else { d.y /= s; }
  return d + 0.5;
}
fn tap(p: vec2f) -> vec3f {
  let s = sceneUv(p);
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { return vec3f(0.0); }
  return tx(scene, s).rgb;
}
fn osdTap(p0: vec2f) -> vec4f {
  if (u.osdIn < 0.5) { return vec4f(0.0); }
  var p = p0;
  if (u.res < 0.5) { p.x = (p.x - 0.5) * u.picAspect / (4.0 / 3.0) + 0.5; }
  if (p.x < 0.0 || p.x > 1.0) { return vec4f(0.0); }
  return tx(osdT, p);
}
const toYiq = mat3x3f(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const toRgb = mat3x3f(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

fn analog(uv: vec2f) -> vec3f {
  let px = floor(uv * u.raster);
  var lineF = (1.0 - uv.y) * u.activeLines;
  if (u.res > 0.5) { lineF = u.raster.y - 1.0 - px.y; }
  let rl = lineF + u.roll * u.totalLines;
  let rolled = rl - u.totalLines * floor(rl / u.totalLines);
  let line = floor(rolled);
  var t0 = vec4f(0.0, 0.0, 1.0, 1.0); var t1 = vec4f(0.5, 0.5, 0.5, 0.5);
  if (u.noise > 0.5) { t0 = textureLoad(lines, vec2i(0, i32(line)), 0); t1 = textureLoad(lines, vec2i(1, i32(line)), 0); }
  var shift = 0.0;
  if (u.noise > 0.5) { shift = (floor(t1.r * 255.0 + 0.5) * 256.0 + floor(t1.g * 255.0 + 0.5)) / 65535.0 * 0.5 - 0.25; }
  let blank = rolled >= u.activeLines;
  var yTop = rolled / u.activeLines;
  if (u.res > 0.5) { yTop = (2.0 * line + u.parity + 0.5) / (2.0 * u.activeLines); }
  var x = uv.x + shift;
  if (u.res > 0.5) { x = (px.x + 0.5) / u.raster.x + shift; }
  let p = vec2f(x, 1.0 - yTop);
  var yiq: vec3f;
  if (u.res > 0.5) {
    let sl = 0.35 / u.lumaCycles; let sc = 0.35 / u.chromaCycles; let dv = 0.25 / (2.0 * u.activeLines);
    var Y = 0.0; var Yring = 0.0; var wsum = 0.0; var wide = vec3f(0.0); var wcs = 0.0;
    for (var i = -3; i <= 3; i++) {
      let fi = f32(i); let w = exp(-0.5 * (fi * 0.75) * (fi * 0.75));
      var dvv = -dv; if ((i - (i / 2) * 2) != 0) { dvv = dv; }
      let q = p + vec2f(fi * 0.75 * sl, dvv);
      var c = tap(q); let od = osdTap(q); c = mix(c, od.rgb, od.a);
      let y = luma(c);
      Y += w * y; wsum += w; if (abs(i) >= 2) { Yring += y * 0.25; }
      let qw = p + vec2f(fi * 0.75 * sc + 0.3 * sc, 0.0);
      let cw = tap(qw); let ow = osdTap(qw);
      wide += w * mix(cw, ow.rgb, ow.a); wcs += w;
    }
    Y /= wsum; wide /= wcs;
    Y += u.sharpen * 1.6 * (Y - Yring);
    yiq = vec3f(Y, (toYiq * wide).yz);
    let hp = 0.5 / u.subcarrier;
    let yc = luma(tap(p));
    let yhf = yc - 0.5 * (luma(tap(p + vec2f(hp, 0.0))) + luma(tap(p - vec2f(hp, 0.0))));
    let ph = 2.0 * PI * (x * u.subcarrier + 0.5 * line + 0.5 * u.parity);
    yiq = vec3f(yiq.x, yiq.yz + 0.45 * yhf * vec2f(cos(ph), sin(ph)));
  } else {
    let c = tap(p); let od = osdTap(p); yiq = toYiq * mix(c, od.rgb, od.a);
  }
  if (x < 0.0 || x > 1.0) { yiq = vec3f(0.0); }
  if (u.noise > 0.5) {
    let grain = t0.r * 0.5; let density = t0.g * t0.g * t0.g; var chroma = t0.b; let pic = t0.a;
    let hue = (t1.a - 0.5) * 2.0 * PI;
    let sd = vec3f(0.0, line, u.seed);
    let gc = x * u.lumaCycles * 2.0; let gi = floor(gc); let gf = gc - gi;
    let g = mix(gn(sd + vec3f(gi, 0.0, 0.0)), gn(sd + vec3f(gi + 1.0, 0.0, 0.0)), gf);
    let cc = x * 90.0; let ci = floor(cc); let cf = cc - ci;
    let gcol = mix(vec2f(gn(sd + vec3f(ci, 51.0, 0.0)), gn(sd + vec3f(ci, 77.0, 0.0))),
                   vec2f(gn(sd + vec3f(ci + 1.0, 51.0, 0.0)), gn(sd + vec3f(ci + 1.0, 77.0, 0.0))), cf);
    let sc2 = x * 260.0; let si = floor(sc2); let sf = sc2 - si;
    let snow = 0.42 + 0.30 * mix(gn(sd + vec3f(si, 9.0, 1.0)), gn(sd + vec3f(si + 1.0, 9.0, 1.0)), sf) + 0.12 * g;
    if (blank) { yiq = vec3f(0.01, 0.0, 0.0); chroma = 0.0; }
    yiq.x = mix(snow, yiq.x, pic);
    var iq = yiq.yz * pic;
    let cs = cos(hue); let sn = sin(hue);
    iq = mat2x2f(cs, sn, -sn, cs) * iq * chroma;
    yiq = vec3f(yiq.x + grain * g, iq + grain * 1.6 * gcol * chroma);
    if (density > 0.0) {
      let kc = x * 360.0; let k0 = floor(kc);
      for (var j = 0; j < 6; j++) {
        let cell = k0 - f32(j);
        let q = sd + vec3f(cell, 0.0, 33.0);
        if (h13(q) < density) {
          let dist = kc - cell - h13(q + 1.3) * 0.8;
          let len = 0.6 + 3.5 * h13(q + 2.9);
          var v = 0.0; if (dist >= 0.0) { v = exp(-dist / len) * (1.0 - exp(-dist * 6.0)); }
          var pol = 1.0;
          if (h13(q + 4.7) < 0.8) { if (yiq.x >= 0.45) { pol = -1.0; } } else if (h13(q + 6.1) >= 0.5) { pol = -1.0; }
          yiq = vec3f(yiq.x + pol * v * 1.4, yiq.yz + (vec2f(h13(q + 7.7), h13(q + 8.3)) - 0.5) * v * 0.9 * chroma);
        }
      }
    }
    yiq.x += u.interf.x * sin(2.0 * PI * (x * u.interf.y + line * u.interf.z + u.interf.w));
    yiq.x += t1.b - 0.5;
  }
  return clamp(toRgb * yiq, vec3f(0.0), vec3f(1.0));
}

fn boxTap(p: vec2f, size: vec2f) -> vec3f {
  let o = 0.25 * size;
  return 0.25 * (tap(p + vec2f(-o.x, -o.y)) + tap(p + vec2f(o.x, -o.y)) + tap(p + vec2f(-o.x, o.y)) + tap(p + vec2f(o.x, o.y)));
}
fn digitalPix(uv: vec2f) -> vec3f {
  let p = uv;
  var c = tap(p); if (u.res > 0.5) { c = boxTap(p, 1.0 / u.raster); }
  let bsize = 16.0 / u.digital;
  let b = floor(p / bsize);
  if (u.softness > 0.0) {
    let bc = (b + 0.5) * bsize;
    let dc = boxTap(bc, bsize); let mid = boxTap(p, bsize * 0.5);
    c = mix(c, mix(mid, dc, 0.35 * u.softness), u.softness);
  }
  if (u.noise > 0.5 && u.blocks > 0.0) {
    let q = vec3f(b, u.seed);
    let runStart = floor(b.x / 6.0);
    let run = h13(vec3f(runStart, b.y, u.seed + 3.1));
    let runLen = 1.0 + floor(h13(vec3f(runStart, b.y, u.seed + 9.7)) * 6.0);
    let inRun = run < u.blocks * 0.7 && b.x - runStart * 6.0 < runLen;
    if (inRun || h13(q) < u.blocks * 0.3) {
      let kind = h13(q + 5.5);
      if (kind < 0.6) {
        let mv = (vec2f(h13(q + 1.1), h13(q + 2.2)) - 0.5) * bsize * 3.0;
        c = tx(history, p + mv).rgb;
      } else if (kind < 0.9) {
        let dc = boxTap((b + 0.5) * bsize, bsize);
        var y = toYiq * dc;
        y = vec3f(y.x, y.yz + (vec2f(h13(vec3f(runStart, b.y, u.seed + 3.3)), h13(vec3f(runStart, b.y, u.seed + 4.4))) - 0.5) * 0.18);
        let f = fract(p / bsize) * 2.0 - 1.0;
        y.x += 0.08 * (h13(q + 6.6) - 0.5) * (f.x + f.y);
        c = toRgb * y;
      } else {
        let f = fract(p / bsize);
        let s = cos(PI * floor(h13(q + 7.7) * 8.0) * f.x) * cos(PI * floor(h13(q + 8.8) * 8.0) * f.y);
        c = clamp(boxTap((b + 0.5) * bsize, bsize) + 0.25 * s * vec3f(0.8, 1.0, 0.7), vec3f(0.0), vec3f(1.0));
      }
    }
  }
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let uv = vec2f(i.pos.x / u.raster.x, 1.0 - i.pos.y / u.raster.y);
  var c: vec3f;
  if (MODE == 1u) { c = analog(uv); }
  else if (MODE == 2u) { c = digitalPix(uv); }
  else { c = tap(uv); if (u.osdIn > 0.5) { let od = osdTap(uv); c = mix(c, od.rgb, od.a); } }
  return vec4f(c, 1.0);
}
`;

// The goggles: the signal scaled into the picture, black around it (and the interlaced bob).
const PRESENT_WGSL = /*wgsl*/`
struct PU { rect: vec4f, rows: vec2f, size: vec2f };
@group(0) @binding(0) var<uniform> u: PU;
@group(0) @binding(1) var sig: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct VO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VO; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  // rect: x, y from the top-left, width, height (pixels); p in picture coordinates, y up
  var p = vec2f((i.pos.x - u.rect.x) / u.rect.z, 1.0 - (i.pos.y - u.rect.y) / u.rect.w);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  if (u.rows.x > 0.0) { let fromTop = (1.0 - p.y) * u.rows.x - 0.5 * u.rows.y; p.y = 1.0 - fromTop / u.rows.x; }
  return vec4f(textureSampleLevel(sig, smp, vec2f(p.x, 1.0 - p.y), 0.0).rgb, 1.0);
}
`;

// libfpv draw data: textured, coloured triangles with clip rectangles (ImGui and the OSD font)
const UI_WGSL = /*wgsl*/`
struct UU { display: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> u: UU;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f };
@vertex fn vs(@location(0) pos: vec2f, @location(1) uv: vec2f, @location(2) col: vec4f) -> VO {
  var o: VO;
  o.pos = vec4f(pos.x / u.display.x * 2.0 - 1.0, 1.0 - pos.y / u.display.y * 2.0, 0.0, 1.0);
  o.uv = uv; o.col = col; return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return i.col * textureSample(tex, smp, i.uv); }
`;

const SIGNAL_FLOATS = 32;

function createGoggles(device, format, mainCtx, uiCanvas) {
  const uiCtx = uiCanvas.getContext('webgpu');
  uiCtx.configure({ device, format, alphaMode: 'premultiplied' });
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const nearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const TB = GPUTextureUsage.TEXTURE_BINDING, RA = GPUTextureUsage.RENDER_ATTACHMENT, CD = GPUTextureUsage.COPY_DST, BCD = GPUBufferUsage.COPY_DST;
  const blank = device.createTexture({ size: [1, 1], format, usage: TB | CD });
  device.queue.writeTexture({ texture: blank }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);

  // ---- the signal: three pipelines (lens only, analog, digital), as in the GL original ----
  const sigMod = device.createShaderModule({ code: SIGNAL_WGSL, label: 'signal' });
  const sigBgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4].map((b) => ({ binding: b, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } })),
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const sigLayout = device.createPipelineLayout({ bindGroupLayouts: [sigBgl] });
  const sigPipes = [0, 1, 2].map((m) => device.createRenderPipeline({
    layout: sigLayout, label: 'signal' + m,
    vertex: { module: sigMod, entryPoint: 'vs' },
    fragment: { module: sigMod, entryPoint: 'fs', targets: [{ format }], constants: { MODE: m } },
    primitive: { topology: 'triangle-list' },
  }));
  const sigU = device.createBuffer({ size: SIGNAL_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | BCD });
  const sigData = new Float32Array(SIGNAL_FLOATS);

  const preMod = device.createShaderModule({ code: PRESENT_WGSL, label: 'present' });
  const prePipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: preMod, entryPoint: 'vs' },
    fragment: { module: preMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' },
  });
  const preU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | BCD });

  // ---- draw data ----
  const uiMod = device.createShaderModule({ code: UI_WGSL, label: 'ui' });
  const uiPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: uiMod, entryPoint: 'vs',
      buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }, { shaderLocation: 2, offset: 16, format: 'unorm8x4' }] }],
    },
    fragment: {
      module: uiMod, entryPoint: 'fs',
      targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const fontTex = {};  // FPV texture id -> { tex, bg, revision }
  function fontFor(core, id) {
    const t = core.texture(id);
    if (!t) return null;
    let f = fontTex[id];
    if (!f || f.revision !== t.revision || f.w !== t.width || f.h !== t.height) {
      f?.tex.destroy();
      const tex = device.createTexture({ size: [t.width, t.height], format: 'rgba8unorm', usage: TB | CD });
      device.queue.writeTexture({ texture: tex }, t.rgba, { bytesPerRow: t.width * 4 }, [t.width, t.height]);
      const bg = device.createBindGroup({ layout: uiPipe.getBindGroupLayout(1), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: id === 2 ? nearest : linear }] });
      f = fontTex[id] = { tex, bg, revision: t.revision, w: t.width, h: t.height };
    }
    return f;
  }
  // one set of buffers per thing drawn in a frame, so their writes never overlap
  const slots = {};
  function slot(name) {
    if (!slots[name]) {
      const s = slots[name] = { vcap: 0, icap: 0, vb: null, ib: null, ub: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | BCD }) };
      s.bg = device.createBindGroup({ layout: uiPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: s.ub } }] });
    }
    return slots[name];
  }
  // draws flattened draw data (from FPV.overlay / FPV.osd) into a pass; display is the coordinate space
  function drawUI(pass, core, dd, name, display, target) {
    if (!dd || !dd.nc) return;
    const s = slot(name);
    const vbytes = dd.verts.byteLength, ibytes = dd.idx.byteLength;
    if (vbytes > s.vcap) { s.vb?.destroy(); s.vcap = Math.max(vbytes * 2, 4096); s.vb = device.createBuffer({ size: s.vcap, usage: GPUBufferUsage.VERTEX | BCD }); }
    if (ibytes > s.icap) { s.ib?.destroy(); s.icap = Math.max(ibytes * 2, 4096); s.ib = device.createBuffer({ size: s.icap, usage: GPUBufferUsage.INDEX | BCD }); }
    device.queue.writeBuffer(s.vb, 0, dd.verts.buffer, dd.verts.byteOffset, (vbytes + 3) & ~3);
    device.queue.writeBuffer(s.ib, 0, dd.idx.buffer, dd.idx.byteOffset, ibytes);
    device.queue.writeBuffer(s.ub, 0, new Float32Array([display[0], display[1], 0, 0]));
    pass.setPipeline(uiPipe);
    pass.setBindGroup(0, s.bg);
    pass.setVertexBuffer(0, s.vb);
    pass.setIndexBuffer(s.ib, 'uint32');
    const sx = target[0] / display[0], sy = target[1] / display[1];
    for (let c = 0; c < dd.nc; c++) {
      const o = c * 8, C = dd.cmds;
      const f = fontFor(core, C[o + 4]);
      if (!f) continue;
      const x0 = clamp(Math.floor(C[o] * sx), 0, target[0]), y0 = clamp(Math.floor(C[o + 1] * sy), 0, target[1]);
      const x1 = clamp(Math.ceil(C[o + 2] * sx), 0, target[0]), y1 = clamp(Math.ceil(C[o + 3] * sy), 0, target[1]);
      if (x1 <= x0 || y1 <= y0) continue;
      pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
      pass.setBindGroup(1, f.bg);
      pass.drawIndexed(C[o + 6], 1, C[o + 5], 0);
    }
  }

  // ---- render targets ----
  let sig = null, osdT = null, linesT = null, linesN = 0;
  const target = (w, h) => device.createTexture({ size: [w, h], format, usage: TB | RA });
  const state = { cur: 0, have: false, field: -1, flags: -1 };

  // Draws the main canvas: the FPV view through the goggles when `f` (a libfpv frame) is given,
  // otherwise the scene as it is.
  function drawMain(core, scene, f, fpv) {
    const out = mainCtx.getCurrentTexture(), W = out.width, H = out.height;
    const sw = scene.width, sh = scene.height;
    const vf = f && fpv ? f.video : null;
    const flags = vf ? vf.flags : 0;
    const noise = (flags & 1) !== 0, res = (flags & 2) !== 0;
    const analog = vf && vf.system !== 2;
    const mode = !flags ? 0 : analog ? 1 : 2;
    const osdIn = !!(fpv && mode === 1 && (flags & 4));
    const pal = vf && vf.system === 1, active = pal ? 288 : 240, total = pal ? 313 : 263;
    let rx = 0, ry = 0, rw = W, rh = H, pic = W / H;
    if (res && vf.aspect > 0.1) {
      pic = vf.aspect;
      if (rw / rh > pic) { rw = rh * pic; rx = (W - rw) / 2; } else { rh = rw / pic; ry = (H - rh) / 2; }
    }
    let w = Math.max(1, Math.round(rw)), h = Math.max(1, Math.round(rh));
    if (res && mode === 1) { w = vf.rasterW; h = active; } else if (res && mode === 2) { w = vf.rasterW; h = vf.rasterH; }
    if (!sig || sig[0].width !== w || sig[0].height !== h) {
      sig?.forEach((t) => t.destroy());
      sig = [target(w, h), target(w, h)];
      state.have = false;
    }
    const enc = device.createCommandEncoder();
    const fresh = !state.have || !flags || !vf || vf.field !== state.field || flags !== state.flags;
    const hold = mode === 2 && noise && vf.frozen && state.have;
    if (fresh && !hold) {
      if (osdIn) {
        // the OSD chip's picture: the analog 4:3 OSD stretched over the raster
        const ow = res ? w : vf.rasterW, oh = active * 2;
        if (!osdT || osdT.width !== ow || osdT.height !== oh) { osdT?.destroy(); osdT = target(ow, oh); }
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: osdT.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        drawUI(pass, core, core.osd((oh * 4) / 3, oh, 0), 'osdsig', [(oh * 4) / 3, oh], [ow, oh]);
        pass.end();
      }
      if (noise && mode === 1) {
        const n = Math.max(1, vf.lineCount);
        if (!linesT || linesN !== n) { linesT?.destroy(); linesT = device.createTexture({ size: [2, n], format: 'rgba8unorm', usage: TB | CD }); linesN = n; }
        device.queue.writeTexture({ texture: linesT }, core.videoLines().slice(0, 8 * n), { bytesPerRow: 8 }, [2, n]);
      }
      const next = state.have ? 1 - state.cur : state.cur;
      const d = sigData, cam = f ? f.camera : null;
      d.set([w, h, noise ? 1 : 0, res ? 1 : 0, osdIn ? 1 : 0, pic, sw / sh, cam && cam.zoom > 0 ? cam.zoom : 1,
        cam ? cam.k1 : 0, cam ? cam.k2 : 0, vf && vf.luma > 1 ? vf.luma : 250, vf && vf.chroma > 1 ? vf.chroma : 53,
        vf && vf.subcarrier > 1 ? vf.subcarrier : 188.5, vf ? vf.sharpen : 0, vf ? vf.parity & 1 : 0, vf ? vf.roll : 0,
        vf ? vf.seed : 0, active, total, vf ? vf.blocks : 0,
        ...(vf ? vf.interf : [0, 0, 0, 0]),
        vf && vf.rasterW ? vf.rasterW : w, vf && vf.rasterH ? vf.rasterH : h, noise && vf ? vf.softness : 0, 0]);
      device.queue.writeBuffer(sigU, 0, d);
      const bg = device.createBindGroup({
        layout: sigBgl,
        entries: [
          { binding: 0, resource: { buffer: sigU } }, { binding: 1, resource: scene.createView() },
          { binding: 2, resource: (osdIn ? osdT : blank).createView() }, { binding: 3, resource: (noise && mode === 1 ? linesT : blank).createView() },
          { binding: 4, resource: sig[1 - next].createView() }, { binding: 5, resource: linear },
        ],
      });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: sig[next].createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(sigPipes[mode]); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
      state.cur = next; state.have = true; state.field = vf ? vf.field : -1; state.flags = flags;
    }
    device.queue.writeBuffer(preU, 0, new Float32Array([rx, ry, rw, rh, res && mode === 1 ? active : 0, vf ? vf.parity & 1 : 0, W, H]));
    const pbg = device.createBindGroup({ layout: prePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: preU } }, { binding: 1, resource: sig[state.cur].createView() }, { binding: 2, resource: linear }] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(prePipe); pass.setBindGroup(0, pbg); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
    return { osdIn, rect: [rx / W, ry / H, rw / W, rh / H] };
  }

  // Draws the full-resolution UI canvas: the OSD over the picture (when it isn't in the signal)
  // and libfpv's overlay. display: CSS pixels.
  function drawUICanvas(core, osd, overlay, display) {
    const out = uiCtx.getCurrentTexture(), T = [out.width, out.height];
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    if (osd) drawUI(pass, core, osd, 'osd', display, T);
    if (overlay) drawUI(pass, core, overlay, 'overlay', display, T);
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  return { drawMain, drawUICanvas };
}
