// ---------------------------------------------------------------------------
// audio.js: the sound, with the Web Audio API. Everything is synthesized; there are no audio files.
//  - the quad's motors and Betaflight's beeper, synthesized by libfpv (attachStream). They play from
//    an AudioWorklet fed a tenth of a second ahead, so a slow frame does not click (a
//    ScriptProcessor on the main thread, as before, only where worklets are missing)
//  - knocks and crashes that sound like what was hit (glass, masonry, metal, wood, the ground) and
//    as hard as the hit was; a splash in the river
//  - an optional ambience (off by default) made from where the quad is: traffic by how near and how
//    busy the nearest avenue is, a train when one passes on the elevated line, water under it over
//    the river, wind from height and airspeed, rain. Between buildings it is duller and echoes;
//    in the open it is clear and dry.
// The mix: motors and ambience have their own volume; the ambience always stays under the motors;
// everything is quieter while the menu is up; a limiter at the end keeps peaks from clipping.
// No music.
// ---------------------------------------------------------------------------

// the worklet: a ring of stereo frames the page keeps topped up. If it runs dry (a long stall, the
// tab in the background) it fades out instead of clicking, and fades back in when frames arrive.
const RING_WORKLET = `
class Ring extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 32768; this.b = new Float32Array(this.N * 2); this.r = 0; this.w = 0; this.n = 0;
    this.g = 0; this.played = 0; this.tick = 0; this.l = 0; this.rr = 0;
    this.port.onmessage = (e) => {
      const d = e.data, f = d.length >> 1;
      for (let i = 0; i < f && this.n < this.N; i++) { this.b[this.w * 2] = d[i * 2]; this.b[this.w * 2 + 1] = d[i * 2 + 1]; this.w = (this.w + 1) % this.N; this.n++; }
    };
  }
  process(_, outs) {
    const L = outs[0][0], R = outs[0][1] || L;
    for (let i = 0; i < L.length; i++) {
      if (this.n > 0) {
        this.l = this.b[this.r * 2]; this.rr = this.b[this.r * 2 + 1]; this.r = (this.r + 1) % this.N; this.n--; this.played++;
        this.g = Math.min(1, this.g + 0.004);
      } else this.g *= 0.985;
      L[i] = this.l * this.g; R[i] = this.rr * this.g;
    }
    if (++this.tick % 4 === 0) this.port.postMessage(this.played);
    return true;
  }
}
registerProcessor('fpv-ring', Ring);`;

// what a knock sounds like, by what was hit
const HIT = {
  //          thud Hz, thud s, noise lowpass Hz, noise s, ring partials [ratio, gain], ring Hz, ring s, reverb
  masonry: { f: 95, ft: 0.16, lp: 1500, nt: 0.09, ring: null, wet: 0.35 },
  glass: { f: 150, ft: 0.1, lp: 5200, nt: 0.07, ring: [[1, 0.5], [1.52, 0.35], [2.31, 0.3], [3.4, 0.2]], rf: 1900, rt: 0.22, wet: 0.4 },
  metal: { f: 180, ft: 0.07, lp: 4200, nt: 0.04, ring: [[1, 0.6], [2.76, 0.45], [5.4, 0.3], [8.93, 0.18]], rf: 330, rt: 0.75, wet: 0.5 },
  wood: { f: 210, ft: 0.07, lp: 2400, nt: 0.05, ring: [[1, 0.5], [2.3, 0.2]], rf: 420, rt: 0.09, wet: 0.2 },
  ground: { f: 70, ft: 0.13, lp: 950, nt: 0.16, ring: null, wet: 0.15 },
};

class Soundscape {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.vol = { motors: 0.8, ambient: 0 };   // 0..1 each; ambient 0 is off
    this.inMenu = true; this.lastHit = 0;
  }
  get ambient() { return this.vol.ambient > 0; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // the chain: buses -> master (on / off, the menu's duck) -> limiter -> out
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 3; lim.ratio.value = 16; lim.attack.value = 0.003; lim.release.value = 0.18;
    this.master = G(0);
    this.master.connect(lim); lim.connect(ctx.destination);
    this.motorBus = G(0); this.motorBus.connect(this.master);
    this.fxBus = G(0.9); this.fxBus.connect(this.master);
    // the ambience goes through one filter that closes between buildings
    this.ambBus = G(0); this.ambTone = ctx.createBiquadFilter(); this.ambTone.type = 'lowpass'; this.ambTone.frequency.value = 9000; this.ambTone.Q.value = 0.5;
    this.ambBus.connect(this.ambTone); this.ambTone.connect(this.master);
    // two rooms: a street between walls (short, dense) and the open city (long, thin)
    this.street = ctx.createConvolver(); this.street.buffer = this.impulse(0.9, 2.2, 0.035);
    this.open = ctx.createConvolver(); this.open.buffer = this.impulse(3.2, 3.4, 0);
    this.streetG = G(0.3); this.openG = G(0.3);
    this.street.connect(this.streetG); this.streetG.connect(this.master);
    this.open.connect(this.openG); this.openG.connect(this.master);
    this.verb = G(1); this.verb.connect(this.street); this.verb.connect(this.open);
    this.white = this.noise(4, false);
    this.brown = this.noise(6, true);
    // the beds: endless filtered noise, each with its own gain
    const B = (buf, filters, pan) => this.bed(buf, filters, pan);
    this.beds = {
      hum: B(this.brown, [['lowpass', 260, 0.5]]),                                   // the city far off
      tyres: B(this.white, [['bandpass', 1100, 0.45], ['lowpass', 2600, 0.5]]),      // traffic near: tyres on asphalt
      engines: B(this.brown, [['bandpass', 140, 0.8]]),                              // and engines
      wind: B(this.white, [['bandpass', 380, 0.9]]),
      air: B(this.white, [['highpass', 1800, 0.4], ['lowpass', 6000, 0.4]]),         // air rushing past at speed
      rain: B(this.white, [['highpass', 1500, 0.5], ['lowpass', 8000, 0.5]]),        // rain in the air
      patter: B(this.white, [['bandpass', 520, 0.6]]),                               // rain on the street
      water: B(this.white, [['bandpass', 600, 1.4]]),                                // the river against its banks
      train: B(this.brown, [['bandpass', 95, 0.7]], true),                           // a train on the viaduct
      rails: B(this.white, [['bandpass', 2300, 2.5]], true),
    };
    this.timers = { car: 1, horn: 14, siren: 50, clack: 0 };
    this.place = null;
    this.apply(1.2);
    if (this.pendingStream) this.attachStream(this.pendingStream);
  }

  // the volumes, the on / off switch and the menu's duck, to the gains
  apply(k = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? (this.inMenu ? 0.4 : 0.95) : 0, t, k);
    this.motorBus.gain.setTargetAtTime(this.inMenu ? 0 : 1.5 * this.vol.motors, t, this.inMenu ? 0.08 : 0.2);
    this.fxBus.gain.setTargetAtTime(0.35 + 0.65 * Math.max(this.vol.motors, this.vol.ambient), t, k);
    if (!this.ambient) this.ambBus.gain.setTargetAtTime(0, t, 0.3);
  }
  setEnabled(on) { this.enabled = on; this.apply(); }
  setVolume(which, v) { this.vol[which] = clamp(v, 0, 1); this.apply(); }
  setMenu(on) { this.inMenu = on; this.apply(); }

  noise(sec, brown) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
    }
    return b;
  }
  // a room: noise dying away over sec (curve: how fast), with early echoes at about gap seconds
  // apart (walls across a street) when gap is set
  impulse(sec, curve, gap) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curve) * 0.5;
      if (gap) for (let k = 1; k <= 5; k++) {
        const at = Math.floor(ctx.sampleRate * gap * (k + (ch ? 0.37 : 0)) * (0.9 + 0.2 * Math.random()));
        for (let i = 0; i < 90 && at + i < n; i++) d[at + i] += (Math.random() * 2 - 1) * (0.9 / k) * (1 - i / 90);
      }
    }
    return b;
  }
  // an endless noise loop through a few filters (and a panner, for things that have a direction)
  bed(buf, filters, pan = false) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    let node = src;
    const fs = filters.map(([type, f, q]) => { const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; node.connect(bq); node = bq; return bq; });
    const g = ctx.createGain(); g.gain.value = 0;
    node.connect(g);
    let p = null;
    if (pan && ctx.createStereoPanner) { p = ctx.createStereoPanner(); g.connect(p); p.connect(this.ambBus); } else g.connect(this.ambBus);
    src.start(0, Math.random() * buf.duration);
    return { g, fs, p };
  }
  env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
  }
  out(node, bus, dry, wet) {
    const d = this.ctx.createGain(); d.gain.value = dry; node.connect(d); d.connect(bus);
    if (wet > 0) { const w = this.ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(this.verb); }
  }

  // ---- one-off sounds of the ambience ----
  // a car going by on the avenue below: tyre noise that swells, drops in pitch and moves across
  playCar(level, side) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = 1.6 + Math.random() * 1.8;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    const f0 = 700 + Math.random() * 500;
    bp.frequency.setValueAtTime(f0 * 1.12, t); bp.frequency.linearRampToValueAtTime(f0, t + dur * 0.5); bp.frequency.linearRampToValueAtTime(f0 * 0.86, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11 * level, t + dur * 0.48); g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp);
    // the engine under it
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const of = 60 + Math.random() * 50;
    o.frequency.setValueAtTime(of * 1.1, t); o.frequency.linearRampToValueAtTime(of * 0.9, t + dur);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 220;
    const og = ctx.createGain(); og.gain.value = 0.5; o.connect(olp); olp.connect(og); og.connect(g);
    bp.connect(g);
    let last = g;
    if (ctx.createStereoPanner) { const pan = ctx.createStereoPanner(), dir = Math.random() < 0.5 ? -1 : 1; pan.pan.setValueAtTime(clamp(side - 0.7 * dir, -1, 1), t); pan.pan.linearRampToValueAtTime(clamp(side + 0.7 * dir, -1, 1), t + dur); g.connect(pan); last = pan; }
    this.out(last, this.ambBus, 1, 0.12);
    src.start(t, Math.random() * 3, dur + 0.1); o.start(t); o.stop(t + dur + 0.1);
  }
  playHorn(level) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = 0.2 + Math.random() * 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = ctx.createGain(); this.env(g, t, 0.016 * level, 0.015, dur, 0.07);
    lp.connect(g); this.out(g, this.ambBus, 0.4, 0.9);
    const base = [349, 392, 415][Math.floor(Math.random() * 3)] * (0.97 + Math.random() * 0.06);
    for (const f of [base, base * 1.26]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + dur + 0.2); }
  }
  // far away, through the streets: mostly its echo
  playSiren() {
    const ctx = this.ctx, t = ctx.currentTime + 0.05, dur = 10;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.32;
    const lg = ctx.createGain(); lg.gain.value = 170; lfo.connect(lg); lg.connect(o.frequency);
    o.frequency.setValueAtTime(745, t); o.frequency.linearRampToValueAtTime(690, t + dur);   // it drives away
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    const g = ctx.createGain(); this.env(g, t, 0.008, 3.5, 3, 3.5);
    o.connect(lp); lp.connect(g); this.out(g, this.ambBus, 0.25, 1.3);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  }
  // wheels over a rail joint: two quick knocks
  playClack(level, pan) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01;
    for (const dt of [0, 0.11]) {
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 300; bp.Q.value = 2.2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.16 * level, t0 + dt); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.07);
      src.connect(bp); bp.connect(g);
      let last = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
      this.out(last, this.ambBus, 1, 0.25);
      src.start(t0 + dt, Math.random() * 3, 0.1);
    }
  }

  // ---- the motors and the beeper: libfpv fills stereo frames (interleaved); see the top ----
  attachStream(stream) {
    if (!this.ctx) { this.pendingStream = stream; return; }
    if (this.stream) return;
    this.stream = stream;
    stream.configure(this.ctx.sampleRate);
    const viaScript = () => {
      if (this.node) return;
      const node = (this.node = this.ctx.createScriptProcessor(1024, 0, 2));
      node.onaudioprocess = (e) => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1), n = L.length;
        if (this.inMenu) { L.fill(0); R.fill(0); return; }
        const d = stream.fill(n);
        for (let i = 0; i < n; i++) { L[i] = d[i * 2]; R[i] = d[i * 2 + 1]; }
      };
      node.connect(this.motorBus);
    };
    if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') { viaScript(); return; }
    const url = URL.createObjectURL(new Blob([RING_WORKLET], { type: 'application/javascript' }));
    this.ctx.audioWorklet.addModule(url).then(() => {
      const node = (this.node = new AudioWorkletNode(this.ctx, 'fpv-ring', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }));
      this.sent = 0; this.played = 0;
      node.port.onmessage = (e) => { this.played = e.data; };
      node.connect(this.motorBus);
      this.ring = node;
    }).catch(viaScript).finally(() => URL.revokeObjectURL(url));
  }
  // tops the ring up to a tenth of a second ahead (called every frame while flying)
  pump() {
    if (!this.ring || !this.stream || this.ctx.state !== 'running' || document.hidden) return;
    const rate = this.ctx.sampleRate, ahead = this.sent - this.played;
    let need = Math.round(rate * 0.1) - ahead;
    if (need < 256) return;
    need = Math.min(need, 8192);
    const d = this.stream.fill(need), copy = new Float32Array(need * 2);
    copy.set(d);
    this.ring.port.postMessage(copy, [copy.buffer]);
    this.sent += need;
  }

  // ---- knocks, crashes, a splash ----
  // strength 0..1; kind: what was hit (HIT); big: a crash that breaks something
  playHit(strength, kind = 'masonry', big = false) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.lastHit < 0.05) return;
    this.lastHit = now;
    const H = HIT[kind] || HIT.masonry, s = clamp(strength, 0.03, 1), amp = Math.pow(s, 1.25), t = now + 0.008, long = 1 + s * (big ? 2.2 : 0.8);
    // the body of the knock
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(H.f * (1 + 0.5 * s), t); o.frequency.exponentialRampToValueAtTime(H.f * 0.45, t + H.ft * long);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.55 * amp, t); og.gain.exponentialRampToValueAtTime(0.0001, t + H.ft * long);
    o.connect(og); this.out(og, this.fxBus, 1, H.wet * 0.5); o.start(t); o.stop(t + H.ft * long + 0.05);
    // the surface
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = H.lp * (0.7 + 0.6 * s);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4 * amp, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + H.nt * long);
    src.connect(lp); lp.connect(g); this.out(g, this.fxBus, 1, H.wet);
    src.start(t, Math.random() * 3, H.nt * long + 0.05);
    // what rings afterwards: a pane, a pole, a hollow wall
    if (H.ring) {
      const rf = H.rf * (0.8 + 0.4 * Math.random());
      for (const [ratio, gain] of H.ring) {
        const r = ctx.createOscillator(); r.type = 'sine'; r.frequency.value = rf * ratio * (0.99 + 0.02 * Math.random());
        const rg = ctx.createGain(), rt = (H.rt * long) / Math.sqrt(ratio);
        rg.gain.setValueAtTime(0.16 * gain * amp, t); rg.gain.exponentialRampToValueAtTime(0.0001, t + rt);
        r.connect(rg); this.out(rg, this.fxBus, 1, H.wet); r.start(t); r.stop(t + rt + 0.05);
      }
    }
    // a hard crash: the frame and the props crack
    if (big) {
      const c = ctx.createBufferSource(); c.buffer = this.white;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.35 * amp, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      c.connect(hp); hp.connect(cg); this.out(cg, this.fxBus, 1, 0.2); c.start(t, Math.random() * 3, 0.08);
      // and bits of it skitter away
      for (let k = 0; k < 3; k++) {
        const tk = t + 0.08 + Math.random() * 0.3, d = ctx.createBufferSource(); d.buffer = this.white;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500 + Math.random() * 3000; bp.Q.value = 3;
        const dg = ctx.createGain(); dg.gain.setValueAtTime(0.1 * amp, tk); dg.gain.exponentialRampToValueAtTime(0.0001, tk + 0.04);
        d.connect(bp); bp.connect(dg); this.out(dg, this.fxBus, 1, 0.3); d.start(tk, Math.random() * 3, 0.06);
      }
    }
  }
  // into the river: the slap, the water thrown up and falling back, a gulp
  playSplash(strength = 0.6) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01, a = 0.35 + 0.65 * clamp(strength, 0, 1);
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(500, t + 1.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * a, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    src.connect(bp); bp.connect(g); this.out(g, this.fxBus, 1, 0.35); src.start(t, Math.random() * 2, 1.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.45 * a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(og); og.connect(this.fxBus); o.start(t); o.stop(t + 0.35);
    for (let k = 0; k < 4; k++) {   // bubbles
      const tk = t + 0.25 + Math.random() * 0.7, b = ctx.createOscillator(); b.type = 'sine';
      const f = 350 + Math.random() * 500; b.frequency.setValueAtTime(f, tk); b.frequency.exponentialRampToValueAtTime(f * 1.9, tk + 0.07);
      const bg = ctx.createGain(); bg.gain.setValueAtTime(0.07 * a, tk); bg.gain.exponentialRampToValueAtTime(0.0001, tk + 0.08);
      b.connect(bg); bg.connect(this.fxBus); b.start(tk); b.stop(tk + 0.1);
    }
  }

  // ---- every frame. s: where the quad is and what is round it (main.js soundPlace):
  //   alt (m above the ground), speed (airspeed, m/s), wind (m/s), rain (0..1), motors (0..1),
  //   traffic (0..1: how near and how busy the nearest avenue is), side (-1..1: where it is, left to right),
  //   urban (0..1: how built-up this part of town is), enclosed (0..1: walls round and above the quad),
  //   water (0..1: over the river), train { gain 0..1, pan -1..1 } ----
  update(dt, s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, B = this.beds, amb = this.ambient;
    const set = (p, v, k = 0.4) => p.setTargetAtTime(v, now, k);
    // the rooms follow the place: walls close by give the street's echo, the open sky the long thin one
    set(this.streetG.gain, 0.12 + 0.5 * s.enclosed, 0.5);
    set(this.openG.gain, 0.22 * (1 - s.enclosed) * (0.4 + 0.6 * s.urban), 0.5);
    if (!amb) return;
    const low = 1 - smooth(6, 180, s.alt), high = smooth(40, 420, s.alt);
    // under the motors, always: the louder they are the more the ambience gives way
    set(this.ambBus.gain, this.vol.ambient * (1 - 0.35 * s.motors) * 0.85, 0.3);
    set(this.ambTone.frequency, 9000 - 6200 * s.enclosed * low, 0.6);
    set(B.hum.g.gain, 0.035 + 0.11 * s.urban * (1 - 0.5 * high), 1.2);
    set(B.tyres.g.gain, 0.085 * s.traffic, 0.5);
    set(B.engines.g.gain, 0.12 * s.traffic, 0.5);
    // wind: a little always, more high up and when it blows, most of it the air past the quad
    const v = clamp(s.speed / 32, 0, 1), blow = clamp(s.wind / 9, 0, 1);
    set(B.wind.g.gain, 0.01 + 0.05 * high + 0.06 * blow * (0.4 + 0.6 * high) + 0.05 * v * v, 0.4);
    set(B.wind.fs[0].frequency, 300 + 130 * Math.sin(now * 0.13) + 60 * Math.sin(now * 0.41) + 320 * v, 0.3);
    set(B.air.g.gain, 0.05 * v * v, 0.25);
    // rain: in the air everywhere; near the street, its patter too
    set(B.rain.g.gain, 0.13 * s.rain * (0.55 + 0.45 * s.rain), 0.8);
    set(B.patter.g.gain, 0.1 * s.rain * low, 0.8);
    set(B.water.g.gain, 0.03 * s.water * low * (0.7 + 0.3 * Math.sin(now * 0.9)), 0.5);
    const tr = s.train || { gain: 0, pan: 0 };
    set(B.train.g.gain, 0.5 * tr.gain, 0.25); set(B.rails.g.gain, 0.03 * tr.gain, 0.25);
    if (B.train.p) { set(B.train.p.pan, tr.pan, 0.2); set(B.rails.p.pan, tr.pan, 0.2); }
    const T = this.timers;
    for (const k in T) T[k] -= dt;
    if (T.car <= 0) { if (s.traffic > 0.25 && low > 0.3) this.playCar(s.traffic * low, s.side || 0); T.car = (1.2 + Math.random() * 3) / (0.4 + s.traffic); }
    if (T.horn <= 0) { if (s.traffic > 0.2 && s.urban > 0.5) this.playHorn(Math.min(1, s.traffic + 0.3) * (0.4 + 0.6 * low)); T.horn = (10 + Math.random() * 30) / (0.4 + s.urban); }
    if (T.siren <= 0) { if (s.urban > 0.3) this.playSiren(); T.siren = 80 + Math.random() * 110; }
    if (T.clack <= 0) { if (tr.gain > 0.12) this.playClack(tr.gain, tr.pan); T.clack = 0.62 + Math.random() * 0.1; }
  }
}
