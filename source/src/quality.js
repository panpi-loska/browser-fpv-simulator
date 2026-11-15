// ---------------------------------------------------------------------------
// quality.js: the detail levels, which one a device starts on, and what is remembered between visits.
// ringFull / ringLite: how far the city is made in full (collision, ground light, cars, trees) and as a skyline
// ---------------------------------------------------------------------------

const LEVELS = {
  low: {
    name: 'Low', msaa: 1, scale: 0.6, minScale: 0.4, reflections: false, bloomLevels: 4,
    carGap: 150, lampStep: 60, trees: 0.35, rainDrops: 4000, details: 0.4, maxDpr: 1,
    ringFull: 800, ringLite: 1600, caps: { cube: 65536, cyl: 16384, sphere: 8192, cone: 4096, beam: 256, sprite: 49152 },
  },
  medium: {
    name: 'Medium', msaa: 4, scale: 0.85, minScale: 0.5, reflections: true, bloomLevels: 5,
    carGap: 80, lampStep: 40, trees: 0.7, rainDrops: 9000, details: 0.75, maxDpr: 1.5,
    ringFull: 1050, ringLite: 2100, caps: { cube: 98304, cyl: 24576, sphere: 16384, cone: 6144, beam: 384, sprite: 81920 },
  },
  high: {
    name: 'High', msaa: 4, scale: 1, minScale: 0.5, reflections: true, bloomLevels: 6,
    carGap: 46, lampStep: 30, trees: 1, rainDrops: 16000, details: 1, maxDpr: 2,
    ringFull: 1300, ringLite: 2600, caps: { cube: 131072, cyl: 32768, sphere: 24576, cone: 8192, beam: 512, sprite: 98304 },
  },
};
const LEVEL_ORDER = ['low', 'medium', 'high'];
const STORE_KEY = 'sodium-sky';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private window: nothing remembered */ }
}
function pickLevel() {
  const prefs = loadPrefs();
  if (LEVELS[prefs.level]) return prefs.level;
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  const mem = navigator.deviceMemory || 8;
  if (mobile) return mem >= 8 ? 'medium' : 'low';
  return mem <= 4 ? 'low' : 'high';
}
