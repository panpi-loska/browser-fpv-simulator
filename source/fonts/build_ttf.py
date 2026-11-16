# Builds RetroOSD.ttf from Betaflight's OSD font (MAX7456 .mcm, GPL-3.0): the white pixels of each glyph
# as squares (the black border comes from a text outline in CSS / is left out in ImGui).
import sys
from mcm import load
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
G = load(sys.argv[1]); out = sys.argv[2]
U = 100                    # font units per pixel
ADV, SHIFT = 8, -2       # advance in pixels, and the glyphs moved left (their ink is in columns 3..8)
BASE = 13                  # the baseline is the top of pixel row 13
cmap, glyphs = {}, {}
def draw(name, px):
    pen = TTGlyphPen(None)
    for r, row in enumerate(px):
        c = 0
        while c < 12:
            if row[c] == '10':
                c0 = c
                while c < 12 and row[c] == '10': c += 1
                x0, x1 = (c0 + SHIFT) * U, (c + SHIFT) * U
                y0, y1 = (BASE - 1 - r) * U, (BASE - r) * U
                pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
            else: c += 1
    glyphs[name] = pen.glyph()
order = ['.notdef']
draw('.notdef', [['00'] * 12] * 18)
for code in range(0x20, 0x60):
    n = 'g%02x' % code; order.append(n); draw(n, G[code]); cmap[code] = n
for code in range(ord('a'), ord('z') + 1): cmap[code] = cmap[code - 32]
for cp, code in {0x25BC: 0x60, 0x2193: 0x60, 0x25B6: 0x64, 0x25BA: 0x64, 0x2192: 0x64, 0x25B2: 0x68, 0x2191: 0x68, 0x25C0: 0x6C, 0x25C4: 0x6C, 0x2190: 0x6C}.items():
    n = 'g%02x' % code
    if n not in glyphs: order.append(n); draw(n, G[code])
    cmap[cp] = n
# a degree sign, a middle dot, a bullet, an ellipsis (not in the OSD font)
def pix(rows):
    px = [['00'] * 12 for _ in range(18)]
    for r, s in rows.items():
        for c, ch in enumerate(s): px[r][c] = '10' if ch == '#' else '00'
    return px
for name, cp, rows in [('degree', 0xB0, {4: '    ##', 5: '   #  #', 6: '   #  #', 7: '    ##'}),
                       ('middot', 0xB7, {8: '    ##', 9: '    ##'}),
                       ('bullet', 0x25CF, {6: '    ##', 7: '   ####', 8: '   ####', 9: '    ##'}),
                       ('ellipsis', 0x2026, {11: '  #  #  #'}),
                       ('emdash', 0x2014, {9: '  ######'}), ('endash', 0x2013, {9: '   ####'}),
                       ('times', 0xD7, {7: '   #  #', 8: '    ##', 9: '    ##', 10: '   #  #'}),
                       ('ident', 0x2261, {6: '   #####', 8: '   #####', 10: '   #####'})]:
    order.append(name); draw(name, pix(rows)); cmap[cp] = name
fb = FontBuilder(unitsPerEm=1200, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n: (ADV * U, 0) for n in order})
fb.setupHorizontalHeader(ascent=1000, descent=-300)
fb.setupNameTable({'familyName': 'RetroOSD', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=1000, sTypoDescender=-300, usWinAscent=1000, usWinDescent=300)
fb.setupPost()
fb.save(out)
print(out, len(order), 'glyphs')
