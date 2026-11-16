# RetroOSD

`RetroOSD.ttf` is Betaflight's analog OSD font (`default.mcm` from
[Betaflight Configurator](https://github.com/betaflight/betaflight-configurator), GPL-3.0, as copied
into libfpv's `assets/fonts`) turned into a pixel TrueType font: the white pixels of each glyph as
squares. Lower case maps to the capitals (the font has none), plus a few symbols drawn to match
(arrows from the font's own, a degree sign, a dot, a bullet).

The page embeds it (build.mjs) for its menus, and libfpv's settings overlay uses it too
(fpv/patches/0003). To rebuild it: `python3 build_ttf.py path/to/default.mcm RetroOSD.ttf`
(needs fontTools).
