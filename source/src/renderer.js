// ---------------------------------------------------------------------------
// renderer.js: WebGPU directly, no engine. One storage buffer holds every instance in the city;
// a mirrored pass renders the reflection for the river and the wet streets; bloom, then tone mapping.
// ---------------------------------------------------------------------------

const HDR = 'rgba16float';
const UNIFORM_FLOATS = 76;

async function createRenderer(canvas, Q, world, onLost) {
  if (!navigator.gpu) throw new Error('This city needs WebGPU. Open it in a recent Chrome or Edge on a desktop computer.', { cause: 'nogpu' });
  // the previous page's GPU memory may still be going away after a reload: try a few times
  let adapter, device;
  for (let attempt = 0; ; attempt++) {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU graphics adapter was found. Try updating your browser or graphics driver.', { cause: 'nogpu' });
    try { device = await adapter.requestDevice(); break; }
    catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); }
  }
  let destroyed = false;
  device.lost.then((info) => { if (!destroyed) onLost(info); });
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

  // ---- meshes ----
  const rzMin = RIVER.z - 16 - RIVER.hw - 6, rzMax = RIVER.z + 16 + RIVER.hw + 6;
  const meshSrc = {
    cube: cubeMesh(), cyl: cylinderMesh(14), sphere: sphereMesh(2), cone: cylinderMesh(12, 0, true), beam: beamMesh(24),
    ground: quadMesh(-7000, -7000, 7000, 7000, 0), water: quadMesh(-7000, rzMin, 7000, rzMax, RIVER.level),
  };
  const mesh = {};
  for (const [k, m] of Object.entries(meshSrc)) {
    const vb = device.createBuffer({ size: m.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vb, 0, m.vertices);
    const ib = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, m.indices);
    mesh[k] = { vb, ib, count: m.indices.length };
  }

  // ---- all instances in one storage buffer; each draw starts at its own firstInstance ----
  const order = ['cube', 'cyl', 'sphere', 'cone', 'beam', 'sprite'];
  const ranges = {};
  let total = 0;
  for (const k of order) { ranges[k] = { first: total, count: world.groups[k].n }; total += world.groups[k].n; }
  const instBuf = device.createBuffer({ size: Math.max(96, total * 96), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  for (const k of order) if (ranges[k].count) device.queue.writeBuffer(instBuf, ranges[k].first * 96, world.groups[k].data());

  // ---- ground textures ----
  const tex2d = (n, data) => {
    const t = device.createTexture({ size: [n, n], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, data, { bytesPerRow: n * 4 }, [n, n]);
    return t;
  };
  const lightTex = tex2d(LIGHT_N, world.lightTex), layoutTex = tex2d(LAYOUT_N, world.layout);
  const dummy = device.createTexture({ size: [1, 1], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  // ---- shaders and pipelines ----
  const compile = async (code, label) => {
    const m = device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    for (const x of info.messages) console[x.type === 'error' ? 'error' : 'warn'](`${label}:${x.lineNum}:${x.linePos} ${x.message}`);
    if (errs.length) throw new Error(`Shader error in ${label}: ${errs[0].message} (line ${errs[0].lineNum})`);
    return m;
  };
  const sceneMod = await compile(sceneShader(world.consts), 'scene');
  const postMod = await compile(POST_WGSL, 'post');

  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 3, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 4, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 5, visibility: VF, texture: { sampleType: 'float' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const VBUF = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
  const ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  const pipe = (o) => device.createRenderPipelineAsync({
    layout, label: o.fs,
    vertex: { module: sceneMod, entryPoint: o.vs, buffers: o.buffers || [] },
    fragment: { module: sceneMod, entryPoint: o.fs, targets: [{ format: HDR, blend: o.blend }] },
    primitive: { topology: o.topology || 'triangle-list', cullMode: o.cull || 'none', frontFace: 'ccw' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: o.depthWrite !== false, depthCompare: o.depthCompare || 'greater' },
    multisample: { count: o.samples },
  });
  const makeSet = async (samples, mirrored) => {
    const [sky, ground, props, sprite, water, beam, rain] = await Promise.all([
      pipe({ vs: 'vs_full', fs: 'fs_sky', samples, depthWrite: false, depthCompare: 'always' }),
      pipe({ vs: 'vs_ground', fs: 'fs_ground', buffers: VBUF, samples }),
      pipe({ vs: 'vs_props', fs: 'fs_props', buffers: VBUF, samples, cull: mirrored ? 'none' : 'back' }),
      pipe({ vs: 'vs_sprite', fs: 'fs_sprite', samples, topology: 'triangle-strip', blend: ADD, depthWrite: false }),
      mirrored ? null : pipe({ vs: 'vs_ground', fs: 'fs_water', buffers: VBUF, samples }),
      mirrored ? null : pipe({ vs: 'vs_beam', fs: 'fs_beam', buffers: VBUF, samples, blend: ADD, depthWrite: false }),
      mirrored ? null : pipe({ vs: 'vs_rain', fs: 'fs_rain', samples, topology: 'triangle-strip', blend: ADD, depthWrite: false }),
    ]);
    return { sky, ground, props, sprite, water, beam, rain };
  };
  const P = await makeSet(Q.msaa, false);
  const PR = Q.reflections ? await makeSet(1, true) : null;

  const postBgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const postLayout = device.createPipelineLayout({ bindGroupLayouts: [postBgl] });
  const postPipe = (fs, fmt, blend) => device.createRenderPipelineAsync({
    layout: postLayout, label: fs,
    vertex: { module: postMod, entryPoint: 'vs_full' },
    fragment: { module: postMod, entryPoint: fs, targets: [{ format: fmt, blend }] },
    primitive: { topology: 'triangle-list' },
  });
  const [downPipe, upPipe, compPipe] = await Promise.all([postPipe('fs_down', HDR), postPipe('fs_up', HDR, ADD), postPipe('fs_comp', format)]);

  // ---- uniforms ----
  const uMain = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uRefl = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uData = new Float32Array(UNIFORM_FLOATS);
  const sceneBG = (ub, refl) => device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: instBuf } },
      { binding: 2, resource: lightTex.createView() }, { binding: 3, resource: layoutTex.createView() },
      { binding: 4, resource: sampler }, { binding: 5, resource: refl.createView() },
    ],
  });
  const bgRefl = sceneBG(uRefl, dummy);

  // ---- render targets, rebuilt when the size changes ----
  let RT = null;
  const tex = (w, h, fmt, usage, samples = 1) => device.createTexture({ size: [w, h], format: fmt, usage, sampleCount: samples });
  const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
  function resize(w, h) {
    if (RT && RT.w === w && RT.h === h) return;
    if (RT) for (const t of RT.owned) t.destroy();
    const owned = [];
    const own = (t) => { owned.push(t); return t; };
    const r = { w, h, owned };
    r.hdr = own(tex(w, h, HDR, RA | TB));
    r.ldr = own(tex(w, h, format, RA | TB));  // the tonemapped scene, for the goggles pass (goggles.js)
    r.msaa = Q.msaa > 1 ? own(tex(w, h, HDR, RA, Q.msaa)) : null;
    r.depth = own(tex(w, h, 'depth32float', RA, Q.msaa));
    if (PR) {
      r.rw = Math.max(1, w >> 1); r.rh = Math.max(1, h >> 1);
      r.refl = own(tex(r.rw, r.rh, HDR, RA | TB));
      r.reflDepth = own(tex(r.rw, r.rh, 'depth32float', RA));
    }
    r.bgMain = sceneBG(uMain, r.refl || dummy);
    r.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < Q.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      r.bloom.push({ t: own(tex(bw, bh, HDR, RA | TB)), w: bw, h: bh });
    }
    // one small uniform buffer and bind group per post pass
    const pp = (srcTex, texel, intensity, mode, bloomT) => {
      const b = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      owned.push(b);
      device.queue.writeBuffer(b, 0, new Float32Array([texel[0], texel[1], intensity, mode, 1, 0, 0.35, 0]));
      return { buf: b, bg: device.createBindGroup({ layout: postBgl, entries: [{ binding: 0, resource: srcTex.createView() }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: b } }, { binding: 3, resource: (bloomT || dummy).createView() }] }) };
    };
    r.down = r.bloom.map((lvl, i) => (i === 0 ? pp(r.hdr, [1 / w, 1 / h], 1, 1) : pp(r.bloom[i - 1].t, [1 / r.bloom[i - 1].w, 1 / r.bloom[i - 1].h], 1, 0)));
    r.up = r.bloom.slice(0, -1).map((lvl, i) => pp(r.bloom[i + 1].t, [1 / r.bloom[i + 1].w, 1 / r.bloom[i + 1].h], 1, 0));
    r.comp = pp(r.hdr, [1 / w, 1 / h], 0.1, 0, r.bloom[0].t);
    RT = r;
  }

  // ---- per-frame uniforms ----
  function fillU(vp, inv, cam, env, t, right, up, p1, p2) {
    const d = uData;
    d.set(vp, 0); d.set(inv, 16);
    d.set([cam[0], cam[1], cam[2], t], 32);
    d.set([...env.skyTop, env.lit], 36);
    d.set([...env.skyHor, env.fog], 40);
    d.set([...env.sunDir, env.stars], 44);
    d.set([...env.sunCol, 0], 48);
    d.set([...env.amb, env.rain], 52);
    d.set([...env.glow, RIVER.level], 56);
    d.set(p1, 60); d.set(p2, 64);
    d.set([...right, 0], 68); d.set([...up, 0], 72);
  }

  const drawProps = (pass) => {
    for (const k of ['cube', 'cyl', 'sphere', 'cone']) {
      const r = ranges[k];
      if (!r.count) continue;
      pass.setVertexBuffer(0, mesh[k].vb); pass.setIndexBuffer(mesh[k].ib, 'uint32');
      pass.drawIndexed(mesh[k].count, r.count, 0, 0, r.first);
    }
  };
  const drawQuad = (pass, pl, m) => { pass.setPipeline(pl); pass.setVertexBuffer(0, mesh[m].vb); pass.setIndexBuffer(mesh[m].ib, 'uint32'); pass.drawIndexed(mesh[m].count); };

  function render(view, env, t) {
    const { w, h } = RT;
    const proj = perspectiveRevInf(view.fov, w / h, view.near || 0.3);
    // an FPV camera hands over its full basis (it can roll); otherwise build one from yaw and pitch
    const basis = view.basis || camBasis(view.yaw, view.pitch);
    const vp = mat4Mul(proj, viewMatrix(view.pos, basis));
    const pixA = (2 * Math.tan(view.fov / 2)) / h;
    fillU(vp, mat4Inv(vp), view.pos, env, t, basis.r, basis.u, [0, w, h, PR ? 1 : 0], [pixA, env.wet, env.beams, 0]);
    device.queue.writeBuffer(uMain, 0, uData);
    if (PR) {
      const M = mirrorY(RIVER.level);
      const vpr = mat4Mul(vp, M);
      const cr = [view.pos[0], 2 * RIVER.level - view.pos[1], view.pos[2]];
      fillU(vpr, mat4Inv(vpr), cr, env, t, [basis.r[0], -basis.r[1], basis.r[2]], [basis.u[0], -basis.u[1], basis.u[2]], [1, RT.rw, RT.rh, 0], [pixA * 2, env.wet, env.beams, 0]);
      device.queue.writeBuffer(uRefl, 0, uData);
    }
    device.queue.writeBuffer(RT.comp.buf, 16, new Float32Array([env.exposure, t % 1000]));

    const enc = device.createCommandEncoder();
    if (PR) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: RT.refl.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: RT.reflDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
      });
      pass.setBindGroup(0, bgRefl);
      pass.setPipeline(PR.sky); pass.draw(3);
      drawQuad(pass, PR.ground, 'ground');
      pass.setPipeline(PR.props); drawProps(pass);
      pass.setPipeline(PR.sprite); pass.draw(4, ranges.sprite.count, 0, ranges.sprite.first);
      pass.end();
    }
    {
      const ca = RT.msaa
        ? { view: RT.msaa.createView(), resolveTarget: RT.hdr.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }
        : { view: RT.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] };
      const pass = enc.beginRenderPass({
        colorAttachments: [ca],
        depthStencilAttachment: { view: RT.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
      });
      pass.setBindGroup(0, RT.bgMain);
      pass.setPipeline(P.sky); pass.draw(3);
      drawQuad(pass, P.ground, 'ground');
      pass.setPipeline(P.props); drawProps(pass);
      drawQuad(pass, P.water, 'water');
      pass.setPipeline(P.sprite); pass.draw(4, ranges.sprite.count, 0, ranges.sprite.first);
      if (ranges.beam.count && env.beams > 0.01) {
        pass.setPipeline(P.beam); pass.setVertexBuffer(0, mesh.beam.vb); pass.setIndexBuffer(mesh.beam.ib, 'uint32');
        pass.drawIndexed(mesh.beam.count, ranges.beam.count, 0, 0, ranges.beam.first);
      }
      if (env.rain > 0.01) { pass.setPipeline(P.rain); pass.draw(4, Q.rainDrops); }
      pass.end();
    }
    // bloom: down the chain, then back up adding each level onto the one above it
    const post = (target, pl, pp, load) => {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pl); pass.setBindGroup(0, pp.bg); pass.draw(3); pass.end();
    };
    RT.bloom.forEach((lvl, i) => post(lvl.t, downPipe, RT.down[i]));
    for (let i = RT.bloom.length - 2; i >= 0; i--) post(RT.bloom[i].t, upPipe, RT.up[i], true);
    post(RT.ldr, compPipe, RT.comp);
    device.queue.submit([enc.finish()]);
  }

  // instances that move every frame (the quad's model): rewrite them in place
  const instScratch = new Float32Array(24);
  function setInstance(group, index, m, col, p, q = [0, 0, 0, 0]) {
    instScratch.set(m, 0); instScratch.set(col, 12); instScratch.set(p, 16); instScratch.set(q, 20);
    device.queue.writeBuffer(instBuf, (ranges[group].first + index) * 96, instScratch);
  }

  return {
    device, format, ctx, resize, render, setInstance,
    get ldr() { return RT.ldr; },
    instances: total, sprites: ranges.sprite.count,
    get size() { return RT ? [RT.w, RT.h] : [0, 0]; },
    destroy() { destroyed = true; device.destroy(); },
  };
}
