// ---------------------------------------------------------------------------
// main.js: startup, the time of day and the weather, the menu, the launch spots, the views
// (FPV, chase, line of sight), and the loop: libfpv flies the quad, the renderer draws the city
// from its camera, the goggles draw it as an FPV feed with the Betaflight OSD.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const uiCanvas = $('osd');
const setState = (s) => { document.body.className = s; };
const BUILD = '2026.11';

// ---- detail level: step down once if the last start on this level never got going ----
let level = pickLevel();
{
  const p = loadPrefs(), i = LEVEL_ORDER.indexOf(level);
  if (p.pending === level && i > 0) { level = LEVEL_ORDER[i - 1]; p.level = level; delete p.scale; }
  p.pending = level;
  savePrefs(p);
}
const Q = LEVELS[level];
const prefs = loadPrefs();
[...$('q').querySelectorAll('button')].forEach((b, i) => {
  b.classList.toggle('on', LEVEL_ORDER[i] === level);
  b.onclick = () => { const p = loadPrefs(); p.level = LEVEL_ORDER[i]; delete p.scale; delete p.pending; savePrefs(p); reloadClean(); };
});
if (!/Chrome|Edg/.test(navigator.userAgent)) $('w').hidden = false;

// ---- time of day: the city fades between these over a few seconds ----
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const TIMES = {
  dusk: {
    label: 'Dusk', skyTop: [0.012, 0.022, 0.085], skyHor: [0.34, 0.13, 0.12], sunDir: norm([-0.55, 0.02, -0.83]), sunCol: [1.3, 0.45, 0.18],
    amb: [0.022, 0.022, 0.045], glow: [0.55, 0.24, 0.14], lit: 0.45, fog: 0.00055, stars: 0.35, exposure: 1.0, beams: 0.5,
  },
  night: {
    label: 'Night', skyTop: [0.003, 0.004, 0.014], skyHor: [0.045, 0.035, 0.07], sunDir: norm([0.35, 0.5, -0.7]), sunCol: [0.07, 0.08, 0.12],
    amb: [0.01, 0.011, 0.02], glow: [0.45, 0.22, 0.12], lit: 0.55, fog: 0.0006, stars: 1, exposure: 1.35, beams: 1,
  },
  dawn: {
    label: 'Dawn', skyTop: [0.06, 0.11, 0.26], skyHor: [0.6, 0.38, 0.36], sunDir: norm([0.75, 0.04, 0.6]), sunCol: [1.4, 0.85, 0.55],
    amb: [0.07, 0.07, 0.1], glow: [0.45, 0.33, 0.3], lit: 0.16, fog: 0.0008, stars: 0.05, exposure: 0.9, beams: 0,
  },
};
const TIME_ORDER = ['dusk', 'night', 'dawn'];
const VEC = ['skyTop', 'skyHor', 'sunDir', 'sunCol', 'amb', 'glow'], SCAL = ['lit', 'fog', 'stars', 'exposure', 'beams'];
let timeKey = TIMES[prefs.time] ? prefs.time : 'dusk';
let raining = !!prefs.rain;
const env = { rain: raining ? 1 : 0, wet: raining ? 1 : 0 };
for (const k of VEC) env[k] = [...TIMES[timeKey][k]];
for (const k of SCAL) env[k] = TIMES[timeKey][k];
function stepEnv(dt) {
  const T = TIMES[timeKey], k = 1 - Math.exp(-dt * 1.3);
  for (const key of VEC) for (let i = 0; i < 3; i++) env[key][i] += (T[key][i] - env[key][i]) * k;
  env.sunDir = norm(env.sunDir);
  for (const key of SCAL) env[key] += (T[key] - env[key]) * k;
  env.rain = clamp(env.rain + (raining ? 1 : -1) * dt * 0.5, 0, 1);
  env.wet = clamp(env.wet + (raining ? dt * 0.12 : -dt * 0.03), 0, 1);
}

// ---- the renderer, Betaflight, then the city around the launch spot ----
const progress = (f, label) => { $('b').style.transform = `scaleX(${f})`; if (label) $('s').textContent = label + '…'; };
progress(0.05, 'Compiling shaders');
const base = baseGroups(Q);
const droneModel = addDroneModel(base);
const R = await createRenderer(canvas, Q, { groups: base }, (info) => {
  console.error('GPU device lost:', info.message);
  const p = loadPrefs(), i = LEVEL_ORDER.indexOf(level);
  if (i > 0) p.level = LEVEL_ORDER[i - 1];
  delete p.scale; delete p.pending; savePrefs(p);
  setTimeout(reloadClean, 400);
});
const goggles = createGoggles(R.device, R.format, R.ctx, uiCanvas);
progress(0.3, 'Booting Betaflight');
const core = await FPV.load(BUILD, location.hash.includes('noautopause'));
// the city collides piece by piece (stream.js); under it all, a floor far below the streets
core.loadWorld(new Float32Array([-2e5, -3.3, -2e5, -2e5, -3.3, 2e5, 2e5, -3.3, 2e5, 2e5, -3.3, -2e5]), new Uint32Array([0, 1, 2, 0, 2, 3]), new Uint8Array([0, 0]));
const city = createStreamer(Q, R, core);
const spots = launchSpots();
let spot = clamp(prefs.spot | 0, 0, spots.length - 1);
{
  const [x, , z] = spots[spot].pos;
  while (!city.ready(x, z)) {
    city.update(x, z, 0.05, 40);
    progress(0.4 + 0.6 * city.progressNear(x, z, 500), 'Raising the city');
    await new Promise((r) => setTimeout(r, 15));
  }
}
progress(1, 'Ready');
const audio = new Soundscape();
let soundOn = prefs.sound !== false;
audio.ambient = !!prefs.ambient;
audio.town = true;

// Reloading (a new detail level, a lost GPU): let go of the GPU and the sound first, so the new page
// doesn't have to find memory while the old one still holds it. The same when the page is closed or refreshed.
function reloadClean() {
  try { R.destroy(); } catch {}
  try { audio.ctx?.close(); } catch {}
  setTimeout(() => location.reload(), 80);
}
addEventListener('pagehide', () => { try { R.destroy(); } catch {} try { audio.ctx?.close(); } catch {} });
audio.attachStream({ configure: (rate) => core.audioConfigure(rate), fill: (n) => core.audio(n) });

// ---- resolution: starts from what this device settled on last time, then adapts ----
let scale = clamp(prefs.scale || Q.scale, Q.minScale, 1), tooSlowAt = 9;
function applySize() {
  const dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
  const w = Math.max(16, Math.round(innerWidth * dpr * scale)), h = Math.max(16, Math.round(innerHeight * dpr * scale));
  canvas.width = w; canvas.height = h;
  R.resize(w, h);
  // the OSD and the overlay stay sharp: full resolution whatever the 3D view's scale
  const udpr = Math.min(2, window.devicePixelRatio || 1);
  uiCanvas.width = Math.round(innerWidth * udpr); uiCanvas.height = Math.round(innerHeight * udpr);
  core.overlayDisplay(innerWidth, innerHeight, innerWidth > 1800 ? 1.25 : 1);
}
applySize();
addEventListener('resize', applySize);

let entered = false, playing = false, showStats = false;

// ---- launch spots: on the street, a roof or a bridge deck, facing the view ----
// a viewpoint high in the air launches from the highest roof within 90 m below it
function launchPoint(p) {
  const ground = city.supportY(p[0], p[2], p[1] + 0.5);
  if (p[1] - ground < 30) return [p[0], ground, p[2]];
  let best = null;
  city.eachBoxNear(p[0], p[2], 90, (b, o) => {
    const top = b[o + 4];
    if (top > p[1] || b[o + 3] - b[o] < 12 || b[o + 5] - b[o + 2] < 12) return;
    const cx = (b[o] + b[o + 3]) / 2, cz = (b[o + 2] + b[o + 5]) / 2;
    if (Math.hypot(cx - p[0], cz - p[2]) > 90) return;
    if (!best || top > best[1]) best = [cx, top, cz];
  });
  // the roof's highest point at its centre (setback towers have smaller tiers on top)
  return best ? [best[0], city.supportY(best[0], best[2], best[1] + 0.5), best[2]] : [p[0], ground, p[2]];
}
let pilotHome = [0, 0, 0];
// a launch waits until the city around it is in (a far spot takes a moment)
let pendingSpot = null;
function goSpot(i, announce) {
  spot = (i + spots.length) % spots.length;
  $('spn').textContent = spots[spot].name;
  const p = loadPrefs(); p.spot = spot; savePrefs(p);
  pendingSpot = { announce };
  if (playing) core.setPaused(true);
}
function spawnAtSpot() {
  const s = spots[spot];
  let pos = s.pos, at = s.at;
  const m = s.mark && city.findMark(s.mark, pos[0], pos[2]);
  if (m && s.mark === 'crane') pos = [m.x, m.y + 1.6, m.z];
  if (m && s.mark === 'wheel') { pos = [m.x + 70, 26, m.z - 25]; at = [m.x, 36, m.z]; }
  const yaw = Math.atan2(at[0] - pos[0], -(at[2] - pos[2]));
  const [x, y, z] = launchPoint(pos);
  core.spawn([x, y, z], [0, Math.sin(-yaw / 2), 0, Math.cos(-yaw / 2)]);
  // the pilot stands a few metres behind the quad and a little to the side
  const fx = Math.sin(yaw), fz = -Math.cos(yaw), px = x - fx * 4 - fz * 1.5, pz = z - fz * 4 + fx * 1.5;
  // (up on a crane or a mast there's nothing to stand on behind it: the pilot stays at the quad's height)
  pilotHome = [px, Math.max(y, city.supportY(px, pz, y + 2)), pz];
  core.setPilot(pilotHome);
  if (pendingSpot.announce) toast(s.name);
  pendingSpot = null;
  if (playing) core.setPaused(false);
}
goSpot(spot);
spawnAtSpot();
$('spl').onclick = () => goSpot(spot - 1);
$('spr').onclick = () => goSpot(spot + 1);
core.setAction(1, 'Next launch spot');
core.setAction(2, 'Back to the launch spot');

// ---- views: 0 the goggles, 1 chase, 2 line of sight from the pilot ----
const VIEWS = ['FPV', 'Chase', 'Line of sight'];
let viewMode = 0;
core.setView(0);
const view = { pos: [0, 200, 900], yaw: 0, pitch: -0.2, fov: 1.05, basis: null, near: 0.3 };
// in the menu the view circles the chosen launch spot
function orbitTarget() { const s = spots[spot]; return [(s.pos[0] + s.at[0]) / 2, 60, (s.pos[2] + s.at[2]) / 2]; }
function orbit(t) {
  const at = orbitTarget(), a = 0.5 + t * 0.016, pos = [at[0] + 760 * Math.cos(a), 230 + 50 * Math.sin(t * 0.05), at[2] + 760 * Math.sin(a)];
  const d = [at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]];
  Object.assign(view, { pos, yaw: Math.atan2(d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), fov: 1.05, basis: null, near: 0.3 });
}
function cameraView(c) {
  Object.assign(view, { pos: c.pos, basis: { f: c.f, u: c.u, r: c.r }, fov: (c.fovY * Math.PI) / 180, near: Math.max(0.02, c.near || 0.05) });
}

// ---- weather: a breeze, or a windy rainstorm; libfpv adds gusts, shelter behind buildings, updrafts ----
function applyWind() { if (raining) core.wind(7.5, 2.5); else core.wind(2.8, 0.9); }
applyWind();

// ---- menu and keys ----
function toast(msg) {
  const v = $('v');
  v.textContent = msg; v.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => v.classList.remove('on'), 1800);
}
function updateMenuButtons() {
  [...$('t').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', TIME_ORDER[i] === timeKey));
  [...$('r').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', (i === 1) === raining));
  [...$('sg').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', (i === 1) === unlimited));
  [...$('am').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', (i === 1) === audio.ambient));
}
function setTime(k) { timeKey = k; const p = loadPrefs(); p.time = k; savePrefs(p); updateMenuButtons(); }
function setRain(on) { raining = on; applyWind(); const p = loadPrefs(); p.rain = on; savePrefs(p); updateMenuButtons(); }
// video range: real (the link fades with distance and buildings, from where the pilot stands) or
// unlimited (the pilot walks with the quad, so the picture stays clean anywhere)
let unlimited = prefs.range === 'unlimited';
function setRange(on) { unlimited = on; if (!on) core.setPilot(pilotHome); const p = loadPrefs(); p.range = on ? 'unlimited' : 'real'; savePrefs(p); updateMenuButtons(); }
// the FPV camera's angle above the frame: libfpv's own setting, so it matches F8 > Camera & sound
function setTilt(d) { core.uptilt = clamp(Math.round(d / 5) * 5, 0, 70); updateTilt(); }
function updateTilt() { $('can').textContent = `${Math.round(core.uptilt)}°`; }
$('cal').onclick = () => setTilt(core.uptilt - 5);
$('car').onclick = () => setTilt(core.uptilt + 5);
$('cad').onclick = () => { core.uptilt = -1; updateTilt(); };
updateTilt();
function setAmbient(on) { audio.ambient = on; const p = loadPrefs(); p.ambient = on; savePrefs(p); updateMenuButtons(); }
function setSound(on) { soundOn = on; audio.setEnabled(on); const p = loadPrefs(); p.sound = on; savePrefs(p); }
[...$('t').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setTime(TIME_ORDER[i]); });
[...$('r').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setRain(i === 1); });
[...$('sg').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setRange(i === 1); });
[...$('am').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setAmbient(i === 1); });
updateMenuButtons();

// libfpv opens its settings by itself when it sees a radio that is not set up yet, even in the menu, where
// the mouse does not reach them: the settings open only when the pilot asks (F8, the Setup button)
let overlayAsked = false;
function enter(withOverlay) {
  entered = true; playing = true;
  overlayAsked = !!withOverlay;
  document.activeElement?.blur?.();
  setState('g');
  $('d').textContent = 'Resume';
  audio.start(); audio.setEnabled(soundOn);
  core.setPaused(false);
  core.overlayOpen(!!withOverlay);
}
function openMenu() {
  playing = false;
  overlayAsked = false;
  core.overlayOpen(false);
  core.setPaused(true);
  for (const k of held) core.key(k, false);
  held.clear();
  setState('m');
}
$('d').onclick = () => enter(false);
$('rb').onclick = () => enter(true);
$('o').onclick = openMenu;

const held = new Set();
addEventListener('keydown', (e) => {
  if (!playing) {
    if (e.code === 'F8' && document.body.classList.contains('m')) { e.preventDefault(); enter(true); return; }
    if ((e.code === 'Enter' || e.code === 'Space') && document.body.classList.contains('m') && e.target === document.body) { e.preventDefault(); enter(false); }
    return;
  }
  // F8 settings, Esc closes them: libfpv handles both; with the overlay open every key is its
  if (core.overlayWantsInput || core.overlayIsOpen) {
    core.key(e.code, true); held.add(e.code);
    overlayAsked = core.overlayIsOpen;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) core.text(e.key);
    if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
    return;
  }
  if (e.code === 'Escape') { openMenu(); return; }
  if (/^(Arrow|Space|Tab|F\d)/.test(e.code)) e.preventDefault();
  // the keyboard sticks and switches go to libfpv: W/S throttle, A/D yaw, arrows, Enter arm, T turtle
  core.key(e.code === 'Space' ? 'Enter' : e.code, true); held.add(e.code === 'Space' ? 'Enter' : e.code);
  // the settings key (F8, or whatever it was rebound to) toggles them inside libfpv
  if (core.overlayIsOpen) { overlayAsked = true; for (const k of held) core.key(k, false); held.clear(); return; }
  if (e.repeat) return;
  const n = /^Digit([1-9])$/.exec(e.code);
  if (n && +n[1] <= spots.length) goSpot(+n[1] - 1, true);
  if (e.code === 'KeyR') { goSpot(spot); toast('Respawned'); }
  if (e.code === 'KeyV') { viewMode = (viewMode + 1) % 3; core.setView(viewMode); toast(VIEWS[viewMode]); }
  if (e.code === 'KeyM') { setSound(!soundOn); toast(soundOn ? 'Sound on' : 'Sound off'); }
  if (e.code === 'KeyH') { showStats = !showStats; $('i').hidden = !showStats; }
  if (e.code === 'KeyN') { setTime(TIME_ORDER[(TIME_ORDER.indexOf(timeKey) + 1) % 3]); toast(TIMES[timeKey].label); }
  if (e.code === 'KeyU') { setRain(!raining); toast(raining ? 'Rain and wind' : 'Clear sky'); }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') { setTilt(core.uptilt + (e.code === 'BracketRight' ? 5 : -5)); toast(`Camera angle ${Math.round(core.uptilt)}°`); }
  if (e.code === 'KeyL') { setRange(!unlimited); toast(unlimited ? 'Video range: unlimited' : 'Video range: real'); }
});
addEventListener('keyup', (e) => {
  const code = e.code === 'Space' ? 'Enter' : e.code;
  if (held.delete(code) || held.delete(e.code)) core.key(code, false);
});
addEventListener('blur', () => { for (const k of held) core.key(k, false); held.clear(); });
// the mouse drives the overlay while it is open
const overMouse = () => playing && core.overlayIsOpen;
addEventListener('mousemove', (e) => { if (overMouse()) core.mouseMove(e.clientX, e.clientY); });
addEventListener('mousedown', (e) => { if (overMouse()) { core.mouseMove(e.clientX, e.clientY); core.mouseButton([0, 2, 1][e.button] ?? 0, true); } });
addEventListener('mouseup', (e) => { if (overMouse()) core.mouseButton([0, 2, 1][e.button] ?? 0, false); });
addEventListener('wheel', (e) => { if (overMouse()) { core.mouseWheel(-e.deltaX / 100, -e.deltaY / 100); e.preventDefault(); } }, { passive: false });
addEventListener('contextmenu', (e) => { if (overMouse()) e.preventDefault(); });

// the radio status line in the menu
let lastStatus = '';
function menuStatus() {
  updateTilt();
  const s = core.inputStatus();
  let text = 'No radio found · plug it in as a USB joystick and move a stick';
  if (s.needsSetup) text = 'Radio found · open the settings (F8) to set it up';
  else if (s.source === 'radio') text = `Radio: ${s.name}`;
  else if (s.source === 'gamepad') text = `Gamepad: ${s.name}`;
  if (text !== lastStatus) { lastStatus = text; $('rs').textContent = text; $('rs').classList.toggle('ok', s.source === 'radio' && !s.needsSetup); }
}

// for poking at the sim from the developer console
window.__fpv = { core, view, city, R, goggles, spots, get frame() { return core.frame; }, get launching() { return !!pendingSpot; } };

// ---- the loop ----
setState('m');
let last = performance.now(), t0 = last, frames = 0, statT = 0, statN = 0, perfT = 0, perfN = 0;
let wasCrashed = false, propAngle = [0, 0, 0, 0];
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = (now - t0) / 1000;
  let f = null;
  // the city follows the quad (or, before a launch, the spot it is going to)
  {
    const fr = core.frame, s = spots[spot].pos;
    const c = pendingSpot ? s : entered && fr ? fr.pos : orbitTarget();
    city.update(c[0], c[2], dt);
    if (pendingSpot && city.ready(s[0], s[2])) spawnAtSpot();
    else if (pendingSpot && playing) toast('Loading ' + spots[spot].name + '…');
  }
  if (!entered) orbit(t);
  else {
    // libfpv steps Betaflight and the physics at 1 kHz in real time inside tick (paused in the menu)
    f = core.tick(dt);
    if (f) {
      // unlimited range: the pilot keeps a few metres from the quad (except in the line-of-sight view,
      // where the pilot is the camera)
      if (unlimited) core.setPilot(viewMode === 2 ? pilotHome : [f.pos[0], f.pos[1] + 3, f.pos[2]]);
      cameraView(viewMode === 0 ? f.camera : viewMode === 1 ? f.chase : f.los);
      if (f.impacts > 0 && f.hardest > 1.5) audio.playHit(clamp(f.hardest / 15, 0.05, 1), f.hardest > 8);
      if (f.crashed && !wasCrashed) toast(f.propHit ? 'Props broken · R to respawn' : 'Crashed · R to respawn');
      wasCrashed = f.crashed;
      for (let i = 0; i < 4; i++) propAngle[i] += ((f.motors[i].rpm * f.motors[i].dir) / 60) * 2 * Math.PI * dt;
      updateDroneModel(R, droneModel, f, viewMode !== 0, propAngle);
    }
    for (let a; (a = core.pollAction());) {
      if (a === 1) goSpot(spot + 1, true);
      if (a === 2) goSpot(spot, true);
    }
  }
  if (!playing) menuStatus();
  stepEnv(dt);
  R.render(view, env, t);
  const g = goggles.drawMain(core, R.ldr, f, entered && viewMode === 0);
  // the OSD over the picture (digital, or analog effects off), and the F8 overlay
  const showOsd = entered && viewMode === 0 && f && !g.osdIn && !f.osdDisabled;
  const osd = showOsd ? core.osd(innerWidth, innerHeight, f.video.flags ? f.video.osdStyle : 0) : null;
  if (core.overlayIsOpen && !overlayAsked) core.overlayOpen(false);
  let overlay = core.overlay(dt);
  if (core.overlayIsOpen && !overlayAsked) { core.overlayOpen(false); overlay = null; }
  if (!core.overlayIsOpen) overlayAsked = false;
  goggles.drawUICanvas(core, osd, overlay, [innerWidth, innerHeight]);
  document.body.classList.toggle('ov', !!overlay);
  audio.update(dt, { alt: view.pos[1], speed: f ? (f.speedKmh / 3.6) * 3 : 0, rain: env.rain });

  if (++frames === 40) { const p = loadPrefs(); delete p.pending; savePrefs(p); }
  // adapt the resolution towards a steady 60 fps
  if (!document.hidden && frames > 20) {
    perfT += dt; perfN++;
    if (perfT > 1.5) {
      const avg = perfT / perfN;
      if (avg > 0.0215 && scale > Q.minScale) { tooSlowAt = scale; scale = Math.max(Q.minScale, scale * 0.88); applySize(); }
      else if (avg < 0.0175 && scale < 1 && scale * 1.06 < tooSlowAt) { scale = Math.min(1, scale * 1.06); applySize(); }
      const p = loadPrefs(); p.scale = +scale.toFixed(3); savePrefs(p);
      perfT = 0; perfN = 0;
    }
  }
  statT += dt; statN++;
  if (showStats && statT > 0.5) {
    const [w, h] = R.size, cs = city.stats();
    let s = `${Math.round(statN / statT)} fps  ${((statT / statN) * 1000).toFixed(1)} ms\n${w}×${h} (${Math.round(scale * 100)}%)  ${Q.name}\n`
      + `${cs.full} pieces near, ${cs.lite} far, ${cs.pending} coming  ${R.instances} instances\nlibfpv ${core.version}`;
    if (f) {
      const st = core.inputStatus();
      s += `\nx ${f.pos[0].toFixed(0)}  y ${f.pos[1].toFixed(1)}  z ${f.pos[2].toFixed(0)}  ${f.speedKmh.toFixed(0)} km/h  ${DISTRICTS[superblockAt(f.pos[0], f.pos[2]).kind].label}\n`
        + `${st.source}${st.name ? ' ' + st.name : ''}  ${f.armed ? 'ARMED' : core.armingText() || 'disarmed'}\n`
        + `video ${f.video.cnr.toFixed(1)} dB CNR  ${f.video.rssi.toFixed(0)} dBm  wind ${Math.hypot(...f.wind).toFixed(1)} m/s`;
    }
    $('i').textContent = s;
    statT = 0; statN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
