// ---------------------------------------------------------------------------
// fpv.js: libfpv in the page. libfpv (https://github.com/hammerill/libfpv) runs real Betaflight
// 2025.12 and the SimITL flight model at 1 kHz, reads radios and gamepads through the Gamepad API,
// collides the quad with the city, and gives back its pose, the FPV / chase / line-of-sight
// cameras, the Betaflight OSD, the video feed, the F8 settings overlay and the motor sound.
// This wraps the WebAssembly module (fpvcore.js, built from source/fpv/host.c) in plain JS.
// SPDX-License-Identifier: GPL-3.0-or-later
// ---------------------------------------------------------------------------

// fpv_drone_flags
const FLAG = { ARMED: 1, FAILSAFE: 2, CRASHED: 4, BEEPER: 8, PAUSED: 16, ON_GROUND: 32, ANGLE: 64, HORIZON: 128, TURTLE: 256, OSD_DISABLED: 512, RADIO_ACTIVE: 1024, HEARD_FROM_PILOT: 4096 };
const INPUT_SOURCE = ['none', 'radio', 'gamepad', 'keyboard', 'host'];
// KeyboardEvent.code -> fpv_key (physical positions, so the keyboard sticks stay under the left hand on any layout)
const FPV_KEYS = {
  Tab: 9, Enter: 13, NumpadEnter: 13, Escape: 27, Space: 32,
  ArrowLeft: 256, ArrowRight: 257, ArrowUp: 258, ArrowDown: 259, PageUp: 260, PageDown: 261, Home: 262, End: 263,
  Insert: 264, Delete: 265, Backspace: 266, ShiftLeft: 267, ShiftRight: 268, ControlLeft: 269, ControlRight: 270, AltLeft: 271, AltRight: 272,
};
for (let i = 1; i <= 12; i++) FPV_KEYS['F' + i] = 272 + i;
function fpvKey(code) {
  if (FPV_KEYS[code]) return FPV_KEYS[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  return 0;
}

class FPV {
  // noAutoPause: keep simulating however long a frame takes (libfpv otherwise pauses after 0.5 s
  // without a frame); only for debugging on very slow renderers (#noautopause in the URL)
  static async load(build, noAutoPause = false) {
    // Right after a reload the previous page's memory may not be released yet; if the module
    // can't get its memory, wait a moment and try again.
    let M;
    for (let attempt = 0; ; attempt++) {
      try { M = await createFpvCore({ print: (t) => console.log(t), printErr: (t) => console.warn(t) }); break; }
      catch (e) {
        if (attempt >= 4) throw new Error('The flight model could not start (' + (e.message || e) + '). Close other tabs or restart the browser, then reload.', { cause: 'mem' });
        console.warn('libfpv: retrying start-up after', e);
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    const fpv = new FPV(M);
    const r = M._host_init(M.stringToNewUTF8(build), noAutoPause ? 1 : 0);
    if (r !== 0) throw new Error('libfpv failed to start: ' + M.UTF8ToString(M._host_last_error()));
    M._host_materials();
    return fpv;
  }
  constructor(M) {
    this.M = M;
    this.version = M.UTF8ToString(M._host_version());
    this.frame = null;
  }
  get F32() { return this.M.HEAPF32; }
  get U8() { return this.M.HEAPU8; }
  get U32() { return this.M.HEAPU32; }

  // the city as one triangle mesh: positions (Float32Array), indices (Uint32Array), materials (Uint8Array, per triangle)
  loadWorld(positions, indices, materials) {
    const M = this.M;
    const pp = M._malloc(positions.byteLength), ip = M._malloc(indices.byteLength), mp = M._malloc(materials.byteLength);
    M.HEAPF32.set(positions, pp >> 2); M.HEAPU32.set(indices, ip >> 2); M.HEAPU8.set(materials, mp);
    const r = M._host_load_mesh(pp, positions.length / 3, ip, indices.length / 3, mp);
    M._free(pp); M._free(ip); M._free(mp);
    if (r !== 0) throw new Error('libfpv could not load the city: ' + M.UTF8ToString(M._host_last_error()));
  }
  // a piece of the endless city: its triangles relative to mesh.origin, as a libfpv surface object
  addObject(mesh) {
    const M = this.M, { positions, indices, materials, origin } = mesh;
    const pp = M._malloc(positions.byteLength), ip = M._malloc(indices.byteLength), mp = M._malloc(materials.byteLength);
    M.HEAPF32.set(positions, pp >> 2); M.HEAPU32.set(indices, ip >> 2); M.HEAPU8.set(materials, mp);
    const id = M._host_object_create(pp, positions.length / 3, ip, indices.length / 3, mp, origin[0], origin[1], origin[2]);
    M._free(pp); M._free(ip); M._free(mp);
    if (!id) console.error('libfpv could not take a piece of the city: ' + M.UTF8ToString(M._host_last_error()));
    return id;
  }
  removeObject(id) { this.M._host_object_delete(id); }
  // the video link for every drone: 0 analog, 1 digital (-1 each drone's own)
  get videoMode() { return this.M._host_video_get_mode(); }
  set videoMode(m) { this.M._host_video_mode(m); }
  // Betaflight CLI commands, newline separated; true when they ran
  cli(commands) {
    const M = this.M, p = M.stringToNewUTF8(commands), r = M._host_cli(p);
    M._free(p);
    return r === 0;
  }
  // creates the drone, or teleports and repairs it; rot is a quaternion [x, y, z, w]
  spawn(pos, rot) { this.M._host_drone_spawn(pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3]); }
  repair() { this.M._host_drone_repair(); }
  // where the pilot stands: the line-of-sight view and the video link's range are from here
  setPilot(p) { this.M._host_set_pilot(p[0], p[1], p[2]); }
  setView(v) { this.M._host_set_view(v); }
  setPaused(p) { this.M._host_set_paused(p ? 1 : 0); }
  wind(vx, vz, turbulence = -1) { this.M._host_wind(vx, vz, turbulence); }

  // advances libfpv by dt (real time) and reads the frame
  tick(dt) {
    const p = this.M._host_tick(dt);
    if (!p) return this.frame;
    const F = this.F32, o = p >> 2, v3 = (i) => [F[o + i], F[o + i + 1], F[o + i + 2]];
    const cam = (i) => ({
      pos: v3(i), rot: [F[o + i + 3], F[o + i + 4], F[o + i + 5], F[o + i + 6]], f: v3(i + 7), u: v3(i + 10), r: v3(i + 13),
      fovY: F[o + i + 16], aspect: F[o + i + 17], near: F[o + i + 18], k1: F[o + i + 19], k2: F[o + i + 20], zoom: F[o + i + 21],
    });
    const motors = [0, 1, 2, 3].map((m) => {
      const b = o + 80 + m * 10;
      return { rpm: F[b], thrust: F[b + 1], amps: F[b + 2], damage: F[b + 3], pos: [F[b + 4], F[b + 5], F[b + 6]], dir: F[b + 7], flags: F[b + 8], cmd: F[b + 9] };
    });
    const flags = F[o] | 0;
    this.frame = {
      flags, armed: !!(flags & FLAG.ARMED), crashed: !!(flags & FLAG.CRASHED), turtle: !!(flags & FLAG.TURTLE),
      osdDisabled: !!(flags & FLAG.OSD_DISABLED), heardFromPilot: !!(flags & FLAG.HEARD_FROM_PILOT),
      armingDisabled: F[o + 1] | 0,
      pos: v3(2), rot: [F[o + 5], F[o + 6], F[o + 7], F[o + 8]], vel: v3(9), speedKmh: F[o + 12], altitude: F[o + 13],
      camera: cam(14), chase: cam(36), los: cam(58), motors,
      battery: { volts: F[o + 120], cell: F[o + 121], amps: F[o + 122], mAh: F[o + 123], capacity: F[o + 124], cells: F[o + 125] },
      impacts: F[o + 126], hardest: F[o + 127], propHit: F[o + 128] > 0, osdRevision: F[o + 129], wind: v3(130), angVel: v3(133),
      channels: Array.from(F.subarray(o + 136, o + 146)),
      video: {
        flags: F[o + 150] | 0, system: F[o + 151] | 0, aspect: F[o + 152], rasterW: F[o + 153] | 0, rasterH: F[o + 154] | 0,
        luma: F[o + 155], chroma: F[o + 156], subcarrier: F[o + 157], sharpen: F[o + 158], field: F[o + 159], parity: F[o + 160] | 0,
        roll: F[o + 161], seed: F[o + 162], interf: [F[o + 163], F[o + 164], F[o + 165], F[o + 166]], blocks: F[o + 167],
        softness: F[o + 168], frozen: F[o + 169] > 0, rssi: F[o + 170], cnr: F[o + 171], osdStyle: F[o + 172] | 0, lineCount: F[o + 173] | 0,
        noise: F[o + 174], signal: F[o + 175],
      },
      simTime: F[o + 176],
    };
    return this.frame;
  }
  armingText() { return this.M.UTF8ToString(this.M._host_arming_text()); }
  videoLines() { const p = this.M._host_video_lines(); return this.U8.subarray(p, p + 320 * 8); }

  // draw data, flattened by host.c: { nv, ni, nc, verts (bytes), idx (Uint32Array), cmds (Float32Array, 8 per command) }
  _flat(p) {
    const U = this.U32, o = p >> 2, nv = U[o], ni = U[o + 1], nc = U[o + 2];
    if (!nc) return null;
    return { nv, ni, nc, verts: this.U8.subarray(U[o + 3], U[o + 3] + nv * 20), idx: U.subarray(U[o + 4] >> 2, (U[o + 4] >> 2) + ni), cmds: this.F32.subarray(U[o + 5] >> 2, (U[o + 5] >> 2) + nc * 8) };
  }
  overlay(dt) { return this._flat(this.M._host_overlay(dt)); }
  osd(w, h, style) { return this.frame ? this._flat(this.M._host_osd(w, h, style)) : null; }
  texture(id) {
    const U = this.U32, o = this.M._host_texture(id) >> 2;
    if (!U[o]) return null;
    return { width: U[o], height: U[o + 1], rgba: this.U8.subarray(U[o + 2], U[o + 2] + U[o] * U[o + 1] * 4), revision: U[o + 3] };
  }

  // the F8 overlay and input
  overlayDisplay(w, h, scale) { this.M._host_overlay_display(w, h, scale); }
  overlayOpen(open) { this.M._host_overlay_open(open ? 1 : 0); }
  get overlayIsOpen() { return !!this.M._host_overlay_is_open(); }
  get overlayWantsInput() { return !!this.M._host_overlay_wants_input(); }
  mouseMove(x, y) { this.M._host_mouse_move(x, y); }
  mouseButton(b, down) { this.M._host_mouse_button(b, down ? 1 : 0); }
  mouseWheel(dx, dy) { this.M._host_mouse_wheel(dx, dy); }
  text(s) { const p = this.M.stringToNewUTF8(s); this.M._host_text(p); this.M._free(p); }
  key(code, down) { const k = fpvKey(code); if (k) this.M._host_key(k, down ? 1 : 0); return k; }
  // sticks and switches from the page (the touch sticks): AETR then AUX1.. (AUX1 arm, AUX2 angle,
  // AUX3 beeper, AUX4 turtle), -1..1, throttle -1 idle; they win over other inputs while fresh (0.5 s)
  channels(ch) {
    const M = this.M;
    if (!this._ch) this._ch = M._malloc(16 * 4);
    M.HEAPF32.set(ch, this._ch >> 2);
    M._host_channels(this._ch, ch.length);
  }
  clearChannels() { this.M._host_channels_clear(); }
  setAction(id, label) { const p = this.M.stringToNewUTF8(label || ''); this.M._host_set_action(id, p); this.M._free(p); }
  pollAction() { return this.M._host_poll_action(); }
  inputStatus() {
    const [src, setup, count, ...name] = this.M.UTF8ToString(this.M._host_input_status()).split('|');
    return { source: INPUT_SOURCE[+src] || 'none', needsSetup: setup === '1', devices: +count, name: name.join('|') };
  }
  // the FPV camera's angle above the frame, degrees (shared with F8 > Camera & sound)
  get uptilt() { return this.M._host_camera_get_uptilt(); }
  set uptilt(d) { this.M._host_camera_uptilt(d); }
  // fpv_sim_options: 1 no battery drain, 2 no damage
  get simOptions() { return this.M._host_get_sim_options(); }
  set simOptions(o) { this.M._host_sim_options(o); }

  // sound: stereo float frames, interleaved
  audioConfigure(rate) { this.M._host_audio_configure(rate); }
  audio(frames) { const p = this.M._host_audio(frames) >> 2; return this.F32.subarray(p, p + frames * 2); }
  audioVolume(v) { this.M._host_audio_volume(v); }
}
