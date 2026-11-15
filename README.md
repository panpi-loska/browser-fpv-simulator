# Sodium Sky — browser FPV simulator

An FPV drone simulator that runs in your browser. Fly a quad through a city at dusk with your radio, a gamepad or the keyboard.

The quad is flown by **real Betaflight firmware** through [libfpv](https://github.com/hammerill/libfpv), compiled to WebAssembly,
so rates, PIDs, flight modes and the OSD work like on a real quad. The whole simulator is **one HTML file** and needs a browser
with **WebGPU** (Chrome or Edge on desktop).

### ▶ [Play it in your browser](https://panpi-loska.github.io/browser-fpv-simulator/)

## Features

- Real Betaflight (2025.12) running at 1 kHz, with its CLI. Paste your quad's `diff all` to fly your own tune.
- Several quads: 5" freestyle and racing, 7" long range, whoops and 3"–4" builds.
- A city with collisions: buildings, bridges, a train viaduct, a ferris wheel and moving tower cranes.
- Wind, battery sag, prop damage, turtle mode.
- Goggles view with fisheye lens and analog video breakup at long range (can be turned off).
- Adjustable camera angle, plus chase and line-of-sight views.
- Radio setup wizard for RadioMaster Pocket and any EdgeTX / OpenTX / ELRS radio over USB.

## How to run

**Online:** open https://panpi-loska.github.io/browser-fpv-simulator/ in Chrome or Edge and press **Fly**.

**Locally:**

1. Download [`index.html`](index.html).
2. Serve the folder, for example with `python -m http.server`.
3. Open `http://localhost:8000` in Chrome or Edge and press **Fly**.

The first load downloads about 0.8 MB. If the page says WebGPU is missing, update your browser or turn on hardware acceleration.

## Using a radio

1. Connect the radio with a USB-C data cable and pick **USB Joystick (HID)** on it.
2. Move a stick so the browser detects it.
3. Press **F8**, open the **Radio** tab and follow the wizard (sticks, arm, angle mode, beeper, turtle).
4. Arm with your switch and fly.

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
| Launch spot | `1`–`6` |
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

The flight core (`source/fpv/fpvcore.js`) only needs rebuilding if you change libfpv or `source/fpv/host.c`.
It needs Emscripten 4.0+:

```bash
git clone --recursive https://github.com/hammerill/libfpv.git && cd libfpv
git checkout c0821de && git submodule update --init
git apply ../browser-fpv-simulator/source/fpv/patches/0001-camera-uptilt-api.patch
emcmake cmake -S . -B build/web && cmake --build build/web -j
cd ../browser-fpv-simulator/source/fpv && LIBFPV=../../../libfpv ./build.sh
```

## Credits

This project builds on the work of others:

- **[libfpv](https://github.com/hammerill/libfpv)** by hammerill (GPL-3.0): flight model, Betaflight integration, collisions,
  wind, video link, radio input, settings overlay, OSD and motor sound. The goggles shader is a port of its video renderer.
- **[Betaflight](https://github.com/betaflight/betaflight)** (GPL-3.0): the flight controller firmware.
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
