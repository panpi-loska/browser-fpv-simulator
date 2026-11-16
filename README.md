# RetroFPV — browser FPV simulator

An FPV drone simulator that runs in your browser. Fly a quad through an endless city at dusk with your radio, a gamepad, the keyboard or the touch sticks on a phone.

The quad is flown by **real Betaflight firmware** through [libfpv](https://github.com/hammerill/libfpv), compiled to WebAssembly,
so rates, PIDs, flight modes and the OSD work like on a real quad. The whole simulator is **one HTML file** and needs a browser
with **WebGPU** (Chrome or Edge on desktop).

### ▶ [Play it in your browser](https://panpi-loska.github.io/browser-fpv-simulator/)

## Features

- Real Betaflight (2025.12) running at 1 kHz, with its CLI. Paste your quad's `diff all` to fly your own tune.
- Several quads: 5" freestyle and racing, 7" long range, whoops and 3"–4" builds.
- An endless city: it is generated around you as you fly, so it never runs out, and every place is always the same.
  Different districts give each part its own feel: downtowns with towers and searchlights, old town with narrow
  streets and neon, docks with cranes, containers and ships, industrial zones, quiet suburbs, parks, and rivers with bridges.
- Streets that vary: a believable city grid, not a checkerboard. Block sizes follow the district (small old-town
  blocks, long residential blocks, big industrial lots), some streets stop at T junctions, some blocks are merged,
  and there are pocket parks, parking lots and tree-lined boulevards with planted medians. Main streets have shops
  along the avenues, and now and then two avenues cross at a square with a monument or a fountain.
- A real skyline: a few big business centres, each with a landmark tower with a lit crown, and smaller office
  clusters between them. Avenues are unevenly spaced, as in a real city. Rivers of different widths wind through
  town, crossed now and then by girder, arch, cable-stayed or suspension bridges; elsewhere the avenues end at a
  lookout on the bank. Ports keep the water free for ships: the avenues end at the port gate. Where an avenue
  ends, the traffic turns round.
- Rare places to find: stadiums, rail yards, hospitals with a helipad, universities, cemeteries and golf courses.
- Everything collides: buildings, bridges, train viaducts, cranes, ships. Water kills the props.
- Wind, battery sag, prop damage, turtle mode.
- Analog video, with the snow and rolling lines of a real analog link, and menus in the look of Betaflight's
  analog OSD, in its own font. Video breakup at long range can be turned off.
- Your own pilot name on the OSD, set in the menu.
- Adjustable camera angle, plus chase and line-of-sight views.
- Radio setup wizard for RadioMaster Pocket and any EdgeTX / OpenTX / ELRS radio over USB.

## How to run

**Online:** open https://panpi-loska.github.io/browser-fpv-simulator/ in Chrome or Edge and press **Fly**.

**Locally:**

Download [`index.html`](https://raw.githubusercontent.com/panpi-loska/browser-fpv-simulator/main/index.html)
(right click, *Save link as*), open it in Chrome or Edge and press **Fly**. That's all: it's one file, nothing to install.

Online, the first load downloads about 0.8 MB. If the page says WebGPU is missing, update your browser or turn on hardware acceleration.

## Using a radio

1. Connect the radio with a USB-C data cable and pick **USB Joystick (HID)** on it.
2. Move a stick so the browser detects it.
3. Press **F8**, open the **Radio** tab and follow the wizard (sticks, arm, angle mode, beeper, turtle).
4. Arm with your switch and fly.

## Phones and tablets

On a touch screen two sticks appear while you fly, laid out like a radio in mode 2: the left one is throttle
(it stays where you leave it) and yaw, the right one pitch and roll (they spring back). Buttons along the top
arm and disarm, switch between angle and acro, change the view and take you back to the launch spot.
Android Chrome with WebGPU works best; the game goes full screen when you press **Fly**.

## Keyboard

| Action | Key |
|---|---|
| Throttle | `W` / `S` |
| Yaw | `A` / `D` |
| Pitch / roll | arrow keys |
| Arm / disarm | `Enter` |
| Turtle mode | `T` |
| Change view | `V` |
| Respawn | `R` |
| Launch spot | `1`–`9` |
| Camera angle | `[` / `]` |
| Video range real / unlimited | `L` |
| Time of day / rain | `N` / `U` |
| Sound / stats | `M` / `H` |
| Settings | `F8` |
| Menu | `Esc` |

## Building from source

The page only needs Node.js 18+:

```bash
cd source
node build.mjs        # writes ../index.html
node build.mjs --min  # smaller output
```

How the endless city works: `source/src/city.js` defines the city with formulas that hold anywhere
(rivers, avenues, districts), `layout.js` lays out the streets and blocks between the avenues,
`gen.js` builds one 256 m piece from them in a Web Worker (`places.js` adds the squares and the special places),
and `stream.js`
keeps the pieces around the drone loaded (in full nearby, as a skyline farther out) and gives each nearby
piece to libfpv as collision.

The flight core (`source/fpv/fpvcore.js`) only needs rebuilding if you change libfpv or `source/fpv/host.c`.
It needs Emscripten 4.0+:

```bash
git clone --recursive https://github.com/hammerill/libfpv.git && cd libfpv
git checkout c0821de && git submodule update --init
git apply ../browser-fpv-simulator/source/fpv/patches/*.patch
emcmake cmake -S . -B build/web && cmake --build build/web -j
cd ../browser-fpv-simulator/source/fpv && LIBFPV=../../../libfpv ./build.sh
```

## Credits

This project builds on the work of others:

- **[libfpv](https://github.com/hammerill/libfpv)** by hammerill (GPL-3.0): flight model, Betaflight integration, collisions,
  wind, video link, radio input, settings overlay, OSD and motor sound. The goggles shader is a port of its video renderer.
- **[Betaflight](https://github.com/betaflight/betaflight)** (GPL-3.0): the flight controller firmware.
- **[Betaflight Configurator](https://github.com/betaflight/betaflight-configurator)** (GPL-3.0): the analog OSD font,
  turned into the pixel font of the menus (`source/fonts`).
- **[SimITL](https://github.com/AJ92/SimITL)** by AJ92 (GPL-3.0): the simulation core libfpv is based on.
- **[Afterglow City](https://github.com/J-o-h-n-M/afterglow-city)** by John (MIT): the original WebGPU renderer, shaders,
  city generator and build script this project started from.
- **[Abyssal Garden](https://github.com/Noniv/abyssal-garden)** by Maksymilian Dendura (MIT): the single-file approach
  Afterglow City is based on.
- [Dear ImGui](https://github.com/ocornut/imgui), [{fmt}](https://github.com/fmtlib/fmt) and
  [nlohmann/json](https://github.com/nlohmann/json) (MIT), used inside libfpv.

Full license notices are in [NOTICE.md](NOTICE.md).

## License

Copyright (c) 2026 Tainan Melo. Licensed under [GPL-3.0-or-later](LICENSE), because it includes libfpv and Betaflight.
