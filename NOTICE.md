# Licenses and credits

Sodium Sky (copyright (c) 2026 Tainan Melo) as a whole is licensed under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)),
because it includes libfpv, Betaflight and SimITL, which are GPL-3.0. The source of everything compiled into
`index.html` is in this repository or in the repositories below, at the versions given.

## Included in the page

| Component | What it does here | License | Source |
|---|---|---|---|
| [libfpv](https://github.com/hammerill/libfpv) 0.3.1 (commit `c0821de`) by hammerill | the flight model, collisions, wind, video link, radio input and setup wizard, settings overlay, OSD, motor sound | GPL-3.0-or-later | `source/fpv/build.sh` builds it, with `source/fpv/patches/` applied |
| [Betaflight](https://github.com/betaflight/betaflight) 2025.12 (AJ92's SimITL fork, as pinned by libfpv) | the flight controller firmware, running in the loop | GPL-3.0 | via libfpv's submodules |
| [SimITL](https://github.com/AJ92/SimITL) by AJ92 | the physics core libfpv extends | GPL-3.0 | via libfpv's submodules |
| Betaflight Configurator OSD fonts (`default.mcm`, `bold.mcm`) | the OSD glyphs | GPL-3.0 | embedded by libfpv |
| [Dear ImGui](https://github.com/ocornut/imgui) | the settings overlay | MIT | via libfpv |
| [{fmt}](https://github.com/fmtlib/fmt) | text formatting inside libfpv | MIT | via libfpv |
| [nlohmann/json](https://github.com/nlohmann/json) | settings files inside libfpv | MIT | via libfpv |
| [Afterglow City](https://github.com/J-o-h-n-M/afterglow-city) by John | the WebGPU renderer, shaders, the city generator (Halvard Bay), sound synthesis and build script | MIT (notice below) | this repository, `source/src` |
| [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura | the single-file approach, build script and menu layout Afterglow City adapted | MIT (notice below) | |

`source/src/goggles.js` is a WebGPU port of libfpv's `docs/renderers/fpv_video_gl3.h` and `fpv_render_gl3.h` (GPL-3.0-or-later).

## MIT notices of the upstream projects

The MIT License is compatible with the GPL; these notices are kept as that license requires.

This project is a fork of Afterglow City (https://github.com/J-o-h-n-M/afterglow-city):
the city generator, renderer, shaders, soundscape, page template and build script
come from it and are used under its license:

MIT License

Copyright (c) 2026 John

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

-------------------------------------------------------------------------------

Parts of Afterglow City, and so of this project, are adapted from Abyssal Garden
(https://github.com/Noniv/abyssal-garden): the single-file build approach in
source/build.mjs (the async wrapper and the WGSL minifier) and the structure of
the menu page in source/template.html. Those parts are used under its license:

MIT License

Copyright (c) 2026 Maksymilian Dendura

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
