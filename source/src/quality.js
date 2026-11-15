// ---------------------------------------------------------------------------
// quality.js: the detail levels, which one a device starts on, and what is remembered between visits
// ---------------------------------------------------------------------------

const LEVELS = {
  low: {
    name: 'Low', msaa: 1, scale: 0.6, minScale: 0.4, reflections: false, bloomLevels: 4,
    carGap: 150, lampStep: 60, trees: 0.35, rainDrops: 4000, details: 0.4, maxDpr: 1,
  },
  medium: {
    name: 'Medium', msaa: 4, scale: 0.85, minScale: 0.5, reflections: true, bloomLevels: 5,
    carGap: 80, lampStep: 40, trees: 0.7, rainDrops: 9000, details: 0.75, maxDpr: 1.5,
  },
  high: {
    name: 'High', msaa: 4, scale: 1, minScale: 0.5, reflections: true, bloomLevels: 6,
    carGap: 46, lampStep: 30, trees: 1, rainDrops: 16000, details: 1, maxDpr: 2,
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
