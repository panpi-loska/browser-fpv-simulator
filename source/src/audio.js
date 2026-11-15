// ---------------------------------------------------------------------------
// audio.js: the sound, with the Web Audio API. Mostly what goggles give you: the quad's motors and
// Betaflight's beeper, synthesized by libfpv (attachStream), and knocks and crashes.
// An optional ambience (off by default): traffic at street level, wind up high, rain, the odd horn
// or siren in town. No music.
// On top of that: the quad's motors and Betaflight's beeper, synthesized by libfpv (attachStream),
// and knocks, crashes and splashes.
// ---------------------------------------------------------------------------

class Soundscape {
  constructor() { this.ctx = null; this.enabled = true; this.ambient = false; this.town = true; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, ctx.currentTime, 1.5);
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.5);
    const wet = ctx.createGain(); wet.gain.value = 0.6;
    this.verb.connect(wet); wet.connect(this.master);
    this.white = this.noise(4, false);
    this.brownBuf = this.noise(6, true);
    this.rumble = this.bed(this.brownBuf, [['lowpass', 170, 0.7]]);
    this.traffic = this.bed(this.white, [['bandpass', 480, 0.5], ['lowpass', 1300, 0.6]]);
    this.wind = this.bed(this.white, [['bandpass', 380, 0.9]]);
    this.rain = this.bed(this.white, [['highpass', 1400, 0.5], ['lowpass', 7500, 0.5]]);
    this.timers = { whoosh: 1, horn: 14, siren: 45 };
    if (this.pendingStream) this.attachStream(this.pendingStream);
    this.chord = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.3);
  }

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
  impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return b;
  }
  // an endless noise loop through a few filters
  bed(buf, filters) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    let node = src;
    const fs = filters.map(([type, f, q]) => { const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; node.connect(bq); node = bq; return bq; });
    const g = ctx.createGain(); g.gain.value = 0;
    node.connect(g); g.connect(this.master);
    src.start(0, Math.random() * buf.duration);
    return { g, fs };
  }
  env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
  }
  out(node, dry, wet) {
    const d = this.ctx.createGain(); d.gain.value = dry; node.connect(d); d.connect(this.master);
    const w = this.ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(this.verb);
  }

  playWhoosh(level) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = 1.4 + Math.random() * 1.6;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
    const f0 = 250 + Math.random() * 200;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.linearRampToValueAtTime(f0 * 2.6, t + dur * 0.45); bp.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
    const pan = ctx.createStereoPanner(), dir = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.9 * dir, t); pan.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * level, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp); bp.connect(pan); pan.connect(g); this.out(g, 1, 0.15);
    src.start(t, Math.random() * 3, dur + 0.1);
  }
  playHorn(level) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = 0.25 + Math.random() * 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); this.env(g, t, 0.02 * level, 0.02, dur, 0.08);
    lp.connect(g); this.out(g, 0.5, 1);
    for (const f of [349, 440]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (0.97 + Math.random() * 0.06); o.connect(lp); o.start(t); o.stop(t + dur + 0.2); }
  }
  playSiren() {
    const ctx = this.ctx, t = ctx.currentTime + 0.05, dur = 9;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 720;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lg = ctx.createGain(); lg.gain.value = 170; lfo.connect(lg); lg.connect(o.frequency);
    o.frequency.setValueAtTime(740, t); o.frequency.linearRampToValueAtTime(680, t + dur); // slow doppler drift
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); this.env(g, t, 0.01, 3, 3, 3);
    o.connect(lp); lp.connect(g); this.out(g, 0.3, 1.4);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  }

  // a stereo source that fills its own samples: libfpv's motors and beeper.
  // fill(frames) returns interleaved left/right floats.
  attachStream(stream) {
    if (!this.ctx) { this.pendingStream = stream; return; }
    if (this.stream) return;
    stream.configure(this.ctx.sampleRate);
    const node = this.ctx.createScriptProcessor(1024, 0, 2);
    node.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1), n = L.length;
      const d = stream.fill(n);
      for (let i = 0; i < n; i++) { L[i] = d[i * 2]; R[i] = d[i * 2 + 1]; }
    };
    const g = this.ctx.createGain(); g.gain.value = 1.4;
    node.connect(g); g.connect(this.master);
    this.stream = node;
  }

  // a knock on a wall, or the quad hitting something hard
  playHit(strength, big) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01, dur = big ? 0.6 : 0.12;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = big ? 2200 : 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(clamp(strength, 0.05, 1) * (big ? 0.5 : 0.18), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); this.out(g, 1, 0.3);
    src.start(t, Math.random() * 3, dur + 0.05);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(big ? 140 : 220, t); o.frequency.exponentialRampToValueAtTime(40, t + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(clamp(strength, 0.05, 1) * (big ? 0.5 : 0.15), t); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  playSplash() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01, src = ctx.createBufferSource(); src.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(2500, t); bp.frequency.exponentialRampToValueAtTime(400, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(bp); bp.connect(g); this.out(g, 1, 0.5); src.start(t, 0, 1.5);
  }

  update(dt, s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const low = 1 - smooth(8, 220, s.alt), high = smooth(60, 500, s.alt);
    const set = (p, v, k = 0.6) => p.setTargetAtTime(v, now, k);
    const amb = this.ambient ? 1 : 0, town = this.town ? 1 : 0;
    set(this.rumble.g.gain, 0, 0.3);   // the low rumble read as surf; it stays off
    set(this.traffic.g.gain, amb * town * (0.07 * low + 0.01), 0.4);
    set(this.wind.g.gain, amb * (0.012 + 0.09 * high + 0.06 * clamp(s.speed / 150, 0, 1)), 0.4);
    set(this.wind.fs[0].frequency, 300 + 220 * Math.sin(now * 0.13) + s.speed * 2, 0.3);
    set(this.rain.g.gain, amb * 0.2 * s.rain, 1.5);
    if (!amb) return;
    const T = this.timers;
    for (const k in T) T[k] -= dt;
    if (T.whoosh <= 0) { if (town && low > 0.2) this.playWhoosh(low * 0.7); T.whoosh = 0.9 + Math.random() * 2.5; }
    if (T.horn <= 0) { if (town && low > 0.3) this.playHorn(low); T.horn = 12 + Math.random() * 30; }
    if (T.siren <= 0) { if (town) this.playSiren(); T.siren = 70 + Math.random() * 90; }
  }
}
