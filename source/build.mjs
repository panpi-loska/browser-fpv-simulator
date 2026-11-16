// Adapted from the build script of Abyssal Garden (https://github.com/Noniv/abyssal-garden), MIT, (c) 2026 Maksymilian Dendura
// Bundles src/*.js and fpv/fpvcore.js (libfpv as WebAssembly) into the single self-contained ../index.html. No dependencies.
// (Carried over from Afterglow City, https://github.com/J-o-h-n-M/afterglow-city)
//   node build.mjs          readable output
//   node build.mjs --min    also squeezes the WGSL and, if esbuild is installed, minifies the JS
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// concatenation order matters: every file shares one scope
const FILES = ['quality.js', 'math.js', 'city.js', 'layout.js', 'gen.js', 'places.js', 'cranes.js', 'stream.js', 'quad.js', 'shaders.js', 'renderer.js', 'goggles.js', 'audio.js', 'fpv.js', 'main.js'];
// the city's generator also runs in workers (stream.js): these files again, as a string
const WORKER_FILES = ['math.js', 'city.js', 'layout.js', 'gen.js', 'places.js', 'cranes.js'];
const min = process.argv.includes('--min');

let workerSrc = WORKER_FILES.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
let js = FILES.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

if (min) {
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '/*wgsl*/`' + minWgsl(w) + '`');
}
if (min) {
  try {
    const { transformSync } = await import('esbuild');
    workerSrc = transformSync(workerSrc, { minify: true, target: 'es2022', legalComments: 'none' }).code;
  } catch { /* left as is */ }
}
let code = wrap(`const WORKER_SRC = ${JSON.stringify(workerSrc)};\n` + js);
if (min) {
  try {
    const { transformSync } = await import('esbuild');
    code = transformSync(code, { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  } catch {
    console.log('(esbuild not installed: JS left unminified)');
  }
}
// libfpv's WebAssembly core (Betaflight + the flight model), built by fpv/build.sh, goes in first, as is
const core = readFileSync(path.join(here, 'fpv', 'fpvcore.js'), 'utf8');
// the menus' font: Betaflight's OSD font as a pixel TTF (fonts/), embedded
const font = readFileSync(path.join(here, 'fonts', 'RetroOSD.ttf')).toString('base64');
const html = tpl.replace('/*RETRO_OSD_FONT*/', () => font).replace('/*SCRIPT*/', () => core + '\n' + code);
writeFileSync(path.join(here, '..', 'index.html'), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`index.html: ${(html.length / 1024).toFixed(1)} kB, ${(gz / 1024).toFixed(1)} kB gzipped`);
