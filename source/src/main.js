// ---------------------------------------------------------------------------
// main.js: startup, the time of day and the weather, the menu, the launch spots, the views
// (FPV, line of sight), and the loop: libfpv flies the quad, the renderer draws the city
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
  // drops on the lens while it rains, on any camera that is out in it
  env.lens = env.rain;
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
// volumes in steps of 20%; the ambience is off (0) until asked for (an older "ambience on" counts as 60%)
audio.vol.motors = clamp(prefs.volM ?? 0.8, 0, 1);
audio.vol.ambient = clamp(prefs.volA ?? (prefs.ambient ? 0.6 : 0), 0, 1);

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
    const top = b[o + 7];
    if (top > p[1] || b[o + 2] < 6 || b[o + 3] < 6) return;
    // a quarter of the way out from the centre of the roof, where a spire or a tank may stand
    const [cx, cz] = boxWorld(b, o, b[o + 2] * 0.5, b[o + 3] * 0.5);
    if (Math.hypot(cx - p[0], cz - p[2]) > 90) return;
    if (!best || top > best[1]) best = [cx, top, cz];
  });
  // the roof's highest point there (setback towers have smaller tiers on top)
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

// ---- views: 0 the goggles, 2 line of sight from the pilot (libfpv's numbers; its chase view, 1, is not used) ----
const VIEWS = { 0: 'FPV', 2: 'Line of sight' };
let viewMode = 0;
function nextView() { viewMode = viewMode === 0 ? 2 : 0; core.setView(viewMode); toast(VIEWS[viewMode]); }
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
  [...$('sg').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', (i === 0) === unlimited));
  [...$('so').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', (i === 1) === soundOn));
  $('gs').classList.toggle('off', !soundOn);
  // a volume as the OSD would draw it: a bar of five cells
  const bar = (v, zero) => (v <= 0 ? zero : '\u25AE'.repeat(Math.round(v * 5)) + '\u25AF'.repeat(5 - Math.round(v * 5)) + ' ' + Math.round(v * 100));
  $('vm').querySelector('b').textContent = bar(audio.vol.motors, 'MUTE');
  $('va').querySelector('b').textContent = bar(audio.vol.ambient, 'OFF');
}
function setTime(k) { timeKey = k; const p = loadPrefs(); p.time = k; savePrefs(p); updateMenuButtons(); }
function setRain(on) { raining = on; applyWind(); const p = loadPrefs(); p.rain = on; savePrefs(p); updateMenuButtons(); }
// video range: unlimited (the default: the pilot walks with the quad, so the picture stays clean
// anywhere) or real (the link fades with distance and buildings, from where the pilot stands)
let unlimited = prefs.range !== 'real';
function setRange(on) { unlimited = on; if (!on) core.setPilot(pilotHome); const p = loadPrefs(); p.range = on ? 'unlimited' : 'real'; savePrefs(p); updateMenuButtons(); }
// the FPV camera's angle above the frame: libfpv's own setting, so it matches F8 > Camera & sound
function setTilt(d) { core.uptilt = clamp(Math.round(d / 5) * 5, 0, 70); updateTilt(); }
function updateTilt() { $('can').textContent = `${Math.round(core.uptilt)}°`; }
// the pilot's name on the OSD: Betaflight's craft name (each drone keeps its own, so it is set again
// whenever the settings close, in case another drone was picked there)
const cleanName = (v) => v.toUpperCase().replace(/[^A-Z0-9 .!_-]/g, '').replace(/\s+/g, ' ').slice(0, 16);
let pilotName = cleanName(prefs.name || '').trim();
$('pni').value = pilotName;
function applyName() { if (pilotName) core.cli(`set craft_name = ${pilotName}\nsave`); }
applyName();
$('pni').addEventListener('input', () => { const v = cleanName($('pni').value); if (v !== $('pni').value) $('pni').value = v; });
$('pni').addEventListener('change', () => {
  pilotName = cleanName($('pni').value).trim(); $('pni').value = pilotName;
  const p = loadPrefs(); p.name = pilotName; savePrefs(p);
  applyName();
});
$('pni').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); $('pni').blur(); } e.stopPropagation(); });
// the video link is always analog: snow, rolling lines, the OSD in the picture (every drone, whatever
// its own setting in F8)
core.videoMode = 0;
$('cal').onclick = () => setTilt(core.uptilt - 5);
$('car').onclick = () => setTilt(core.uptilt + 5);
$('cad').onclick = () => { core.uptilt = -1; updateTilt(); };
updateTilt();
function setVolume(which, v) {
  v = clamp(Math.round(v * 5) / 5, 0, 1);
  audio.setVolume(which, v);
  const p = loadPrefs(); p[which === 'motors' ? 'volM' : 'volA'] = v; delete p.ambient; savePrefs(p);
  updateMenuButtons();
}
function setSound(on) { soundOn = on; audio.setEnabled(on); const p = loadPrefs(); p.sound = on; savePrefs(p); updateMenuButtons(); }
[...$('t').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setTime(TIME_ORDER[i]); });
[...$('r').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setRain(i === 1); });
[...$('sg').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => setRange(i === 0); });
[...$('so').querySelectorAll('button')].forEach((b, i) => { b.onclick = () => { setSound(i === 1); if (i === 1) audio.start(); }; });
for (const [id, which] of [['vm', 'motors'], ['va', 'ambient']])
  [...$(id).querySelectorAll('button')].forEach((b, i) => { b.onclick = () => { setVolume(which, audio.vol[which] + (i ? 0.2 : -0.2)); audio.start(); }; });
updateMenuButtons();
// the sections of the menu: where there is no room for all of them, one at a time (the tabs)
[...$('tabs').querySelectorAll('button')].forEach((b) => {
  b.onclick = () => {
    for (const o of $('tabs').querySelectorAll('button')) { o.classList.toggle('on', o === b); $(o.dataset.g).classList.toggle('on', o === b); }
  };
});

// libfpv opens its settings by itself when it sees a radio that is not set up yet, even in the menu, where
// the mouse does not reach them: the settings open only when the pilot asks (F8, the Setup button)
let overlayAsked = false;
function enter(withOverlay) {
  if (touch && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  entered = true; playing = true;
  overlayAsked = !!withOverlay;
  document.activeElement?.blur?.();
  setState('g');
  $('d').textContent = 'Resume';
  audio.start(); audio.setEnabled(soundOn); audio.setMenu(false);
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
  audio.setMenu(true);
  setState('m');
}

// ---- touch sticks (phones, tablets): mode 2, like a radio. Left: throttle (stays where it is left)
// and yaw; right: pitch and roll (spring back). Each half of the screen drives its stick. Buttons: arm,
// angle / acro, the view, back to the launch spot. Sent as channels while flying ----
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (touch) document.documentElement.classList.add('touch');
const sticks = { thr: -1, yaw: 0, pitch: 0, roll: 0, arm: false, angle: true, used: false, sent: 0 };
const expo = (v, e = 0.35) => v * (1 - e) + v * v * v * e;
function stickZone(zone, left) {
  const pad = zone.querySelector('.pad'), knob = pad.querySelector('.knob');
  let id = null;
  const draw = () => {
    const x = left ? sticks.yaw : sticks.roll, y = left ? sticks.thr : sticks.pitch;
    knob.style.left = `${50 + x * 42}%`; knob.style.top = `${50 - y * 42}%`;
  };
  const set = (e) => {
    const r = pad.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1) / 0.84, y = clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1) / 0.84;
    if (left) { sticks.yaw = clamp(x, -1, 1); sticks.thr = clamp(y, -1, 1); } else { sticks.roll = clamp(x, -1, 1); sticks.pitch = clamp(y, -1, 1); }
    draw();
  };
  zone.addEventListener('pointerdown', (e) => { if (id !== null) return; id = e.pointerId; zone.setPointerCapture(id); sticks.used = true; set(e); e.preventDefault(); });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
  const up = (e) => { if (e.pointerId !== id) return; id = null; if (left) sticks.yaw = 0; else { sticks.roll = 0; sticks.pitch = 0; } draw(); };
  zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up);
  draw();
}
stickZone($('zl'), true); stickZone($('zr'), false);
const tbtn = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); sticks.used = true; fn(); });
tbtn('tarm', () => {
  sticks.arm = !sticks.arm; $('tarm').classList.toggle('on', sticks.arm);
  // Betaflight arms only with the throttle down: say why when it will not
  if (sticks.arm) setTimeout(() => { if (sticks.arm && core.frame && !core.frame.armed) toast(sticks.thr > -0.9 ? 'Throttle down to arm' : core.armingText() || 'Not armed'); }, 400);
});
tbtn('tang', () => { sticks.angle = !sticks.angle; $('tang').classList.toggle('on', sticks.angle); $('tang').textContent = sticks.angle ? 'Angle' : 'Acro'; toast(sticks.angle ? 'Angle mode' : 'Acro mode'); });
tbtn('tvw', nextView);
tbtn('trs', () => { sticks.arm = false; $('tarm').classList.remove('on'); goSpot(spot); toast('Respawned'); });
function sendSticks() {
  if (!touch || !sticks.used || !playing || core.overlayIsOpen) return;
  // (Betaflight wants to see the arm switch off before it is on: the first frames go with it off)
  const arm = sticks.arm && ++sticks.sent > 20;
  core.channels([expo(sticks.roll), expo(sticks.pitch), sticks.thr, expo(sticks.yaw), arm ? 1 : -1, sticks.angle ? 1 : -1, -1, -1]);
}

// ---- the snow over the menus: a small canvas of noise, stretched, while it shows ----
const fxc = $('fxn').getContext('2d'), fxImg = fxc.createImageData(192, 108), fx32 = new Uint32Array(fxImg.data.buffer);
let fxT = 0;
function snow(dt) {
  if (playing && !core.overlayIsOpen) return;
  fxT += dt;
  if (fxT < 0.045) return;
  fxT = 0;
  for (let i = 0; i < fx32.length; i++) { const v = (Math.random() * 255) | 0; fx32[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
  fxc.putImageData(fxImg, 0, 0);
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
  if (e.code === 'KeyV') nextView();
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

// what the menu's OSD elements show: where the launch spot is, the time and weather, and, once the
// quad has flown, its real battery and video link (as the goggles would between flights)
let osdT = 0;
function menuOsd(dt) {
  osdT -= dt;
  if (osdT > 0) return;
  osdT = 0.5;
  const s = spots[spot], f = core.frame;
  $('oel').textContent = `HALVARD BAY \u00B7 ${placeLabel(superblockAt(s.pos[0], s.pos[2]))}`;
  $('oep').textContent = `${TIMES[timeKey].label} \u00B7 ${raining ? 'RAIN' : 'CLEAR'}`;
  $('oeb').textContent = f && entered ? `${Math.round(f.battery.cells) || 4}S ${f.battery.volts.toFixed(1)}V  ${Math.round(f.video.rssi)}DBM` : soundOn ? 'READY' : 'READY \u00B7 SOUND OFF';
  const t = f && entered ? f.simTime : 0;
  $('oet').textContent = entered ? `PAUSE ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}` : 'STANDBY';
}
// the radio status line in the menu
let lastStatus = '';
function menuStatus() {
  updateTilt();
  const s = core.inputStatus();
  let text = touch ? 'Touch sticks on screen · or plug in a radio' : 'No radio found · plug it in as a USB joystick and move a stick';
  if (s.needsSetup) text = 'Radio found · open the settings (F8) to set it up';
  else if (s.source === 'radio') text = `Radio: ${s.name}`;
  else if (s.source === 'gamepad') text = `Gamepad: ${s.name}`;
  if (text !== lastStatus) { lastStatus = text; $('rs').textContent = text; $('rs').classList.toggle('ok', s.source === 'radio' && !s.needsSetup); }
}

// ---- what the sound is made from: what the quad hit, and what is round the listener ----
const HIT_KIND = ['masonry', 'glass', 'metal', 'wood'];
function hitKind(p) {
  let best = -1, area = Infinity;
  city.eachBoxNear(p[0], p[2], 1.5, (b, o, snd) => {
    const [lx, lz] = boxLocal(b, o, p[0], p[2]);
    if (Math.abs(lx) > b[o + 2] + 0.8 || Math.abs(lz) > b[o + 3] + 0.8 || p[1] < b[o + 6] - 0.8 || p[1] > b[o + 7] + 0.8) return;
    // the smallest thing it is against (a pole in front of a wall is the pole)
    const a = b[o + 2] * b[o + 3];
    if (a < area) { area = a; best = snd; }
  });
  return best < 0 ? 'ground' : HIT_KIND[best] || 'masonry';
}
const BUSY = { downtown: 1, midtown: 0.85, residential: 0.55, oldtown: 0.5, industrial: 0.4, suburb: 0.25, park: 0.25, riverside: 0.35, docks: 0.3 };
const place = { alt: 0, speed: 0, wind: 0, rain: 0, motors: 0, traffic: 0, side: 0, urban: 0.5, enclosed: 0, water: 0, train: { gain: 0, pan: 0 } };
let placeT = 0;
// refreshed ten times a second: the listener is the camera (the quad in the goggles)
function soundPlace(dt, f, t) {
  place.rain = env.rain;
  place.speed = f && playing ? Math.hypot(f.vel[0] - f.wind[0], f.vel[1] - f.wind[1], f.vel[2] - f.wind[2]) : 0;
  place.wind = f ? Math.hypot(...f.wind) : raining ? 7.5 : 2.8;
  place.motors = f && playing ? clamp(f.motors.reduce((s, m) => s + Math.abs(m.rpm), 0) / 4 / 26000, 0, 1) : 0;
  placeT -= dt;
  if (placeT > 0 || !audio.ctx) return place;
  placeT = 0.1;
  const [x, y, z] = view.pos, alt = Math.max(0, y - city.supportY(x, z, y + 0.5));
  place.alt = alt;
  // right of the listener, on the ground plane
  const r = view.basis ? view.basis.r : [Math.cos(view.yaw), 0, Math.sin(view.yaw)], pan = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return clamp((dx * r[0] + dz * r[2]) / l, -1, 1); };
  // the nearest avenue: how near, how busy (by district), from how high
  const sb = superblockAt(x, z), busy = BUSY[sb.kind] ?? 0.4;
  const near = [[x - sb.x0, -1, 0], [sb.x1 - x, 1, 0], [z - sb.z0, 0, -1], [sb.z1 - z, 0, 1]].reduce((a, b) => (b[0] < a[0] ? b : a));
  place.traffic = busy / (1 + (near[0] / 45) ** 2) / (1 + (alt / 70) ** 2);
  place.side = pan(near[1], near[2]) * Math.min(1, near[0] / 15);
  place.urban = clamp(coreField(x, z) * 1.5 + busy * 0.55, 0, 1);
  // walls round the listener that rise above it
  let walls = 0;
  city.eachBoxNear(x, z, 34, (b, o) => {
    if (b[o + 7] < y + 3 || b[o + 2] < 3 || b[o + 3] < 3 || b[o + 6] > y + 4) return;
    const [lx, lz] = boxLocal(b, o, x, z), d = Math.hypot(Math.max(Math.abs(lx) - b[o + 2], 0), Math.max(Math.abs(lz) - b[o + 3], 0));
    if (d < 34) walls += 1 - d / 34;
  });
  place.enclosed = clamp(walls / 3.2, 0, 1);
  const rv = riverAt(z);
  place.water = rv ? 1 - smooth(rv.hw * 0.7, rv.hw + 70, Math.abs(z - riverZk(rv, x))) : 0;
  // the nearest train on the elevated line
  let tg = 0, tp = 0;
  for (const L of loopsNear(x - 260, z - 260, x + 260, z + 260)) {
    if (x < L.x0 - 260 || x > L.x1 + 260 || z < L.z0 - 260 || z > L.z1 + 260) continue;
    for (const tr of loopTrains(L)) {
      const [tx, tz] = trainPos(L, (tr.s0 + t * TRAIN.v - 2 * TRAIN.car) * tr.dir, -tr.dir * TRAIN.o);
      const d = Math.hypot(tx - x, TRAIN_Y + 2 - y, tz - z), g = d < 320 ? 1 / (1 + (d / 50) ** 2) : 0;
      if (g > tg) { tg = g; tp = pan(tx - x, tz - z); }
    }
  }
  place.train.gain = tg; place.train.pan = tp;
  return place;
}

// for poking at the sim from the developer console
window.__fpv = { core, view, city, R, goggles, spots, audio, place, hitKind, get frame() { return core.frame; }, get launching() { return !!pendingSpot; } };

// ---- the loop ----
setState('m');
let last = performance.now(), t0 = last, frames = 0, statT = 0, statN = 0, perfT = 0, perfN = 0;
let wasCrashed = false, wasWet = false, propAngle = [0, 0, 0, 0];
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
    // libfpv steps Betaflight and the physics at 1 kHz in real time inside tick (paused in the menu);
    // the touch sticks go in just before, so they are fresh for every step
    sendSticks();
    f = core.tick(dt);
    if (f) {
      // unlimited range: the pilot keeps a few metres from the quad (except in the line-of-sight view,
      // where the pilot is the camera)
      if (unlimited) core.setPilot(viewMode === 2 ? pilotHome : [f.pos[0], f.pos[1] + 3, f.pos[2]]);
      cameraView(viewMode === 0 ? f.camera : f.los);
      // what it hit, and how hard (hardest: the speed of the hit, m/s); into the river, a splash, once
      const wet = f.pos[1] < RIVER.level + 0.5 && inRiver(f.pos[0], f.pos[2]);
      if (wet && !wasWet) audio.playSplash(clamp(Math.hypot(...f.vel) / 14, 0.15, 1));
      else if (!wet && f.impacts > 0 && f.hardest > 1.2) audio.playHit(clamp((f.hardest - 0.8) / 13, 0.04, 1), hitKind(f.pos), f.hardest > 8);
      wasWet = wet;
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
  if (!playing) { menuStatus(); menuOsd(dt); }
  snow(dt);
  stepEnv(dt);
  R.render(view, env, t);
  const g = goggles.drawMain(core, R.ldr, f, entered && viewMode === 0);
  // the OSD over the picture (digital, or analog effects off), and the F8 overlay
  const showOsd = entered && viewMode === 0 && f && !g.osdIn && !f.osdDisabled;
  const osd = showOsd ? core.osd(innerWidth, innerHeight, f.video.osdStyle) : null;
  if (core.overlayIsOpen && !overlayAsked) core.overlayOpen(false);
  let overlay = core.overlay(dt);
  if (core.overlayIsOpen && !overlayAsked) { core.overlayOpen(false); overlay = null; }
  if (!core.overlayIsOpen) { if (overlayAsked) applyName(); overlayAsked = false; }
  goggles.drawUICanvas(core, osd, overlay, [innerWidth, innerHeight]);
  document.body.classList.toggle('ov', !!overlay);
  if (playing) audio.pump();
  audio.update(dt, soundPlace(dt, f, t));

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
      s += `\nx ${f.pos[0].toFixed(0)}  y ${f.pos[1].toFixed(1)}  z ${f.pos[2].toFixed(0)}  ${f.speedKmh.toFixed(0)} km/h  ${placeLabel(superblockAt(f.pos[0], f.pos[2]))}\n`
        + `${st.source}${st.name ? ' ' + st.name : ''}  ${f.armed ? 'ARMED' : core.armingText() || 'disarmed'}\n`
        + `video ${f.video.cnr.toFixed(1)} dB CNR  ${f.video.rssi.toFixed(0)} dBm  wind ${Math.hypot(...f.wind).toFixed(1)} m/s`;
    }
    $('i').textContent = s;
    statT = 0; statN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
