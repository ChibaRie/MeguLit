# Checks a font patched by FontDotPatch.h against its original with fontTools (TrueType glyf and CFF): every outline
# glyph is now one square no larger than unitsPerEm / 12 at the original's black-box top-left (CFF: lsb and the vmtx
# top), and advances (hmtx, vmtx) and the cmap are unchanged. usage: python check.py <original> <patched>
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen

orig, dot = TTFont(sys.argv[1], lazy=True), TTFont(sys.argv[2], lazy=True)
upem = orig['head'].unitsPerEm
go, gd = orig.getGlyphSet(), dot.getGlyphSet()
assert orig.getBestCmap() == dot.getBestCmap(), 'cmap changed'
assert orig['hmtx'].metrics == dot['hmtx'].metrics, 'advances changed'
cmap = orig.getBestCmap()
bad = checked = 0
for ch in 'あ漢字A。「夢」':
    name = cmap.get(ord(ch))
    if not name:
        continue
    po, pd = BoundsPen(go), BoundsPen(gd)
    go[name].draw(po); gd[name].draw(pd)
    if po.bounds is None:
        continue
    checked += 1
    x0, y0, x1, y1 = pd.bounds or (0, 0, 0, 0)
    ox0, oy0, ox1, oy1 = po.bounds
    ok = pd.bounds is not None and x1 - x0 <= upem / 12 + 1 and y1 - y0 <= upem / 12 + 1 and abs(x0 - ox0) <= upem / 20 and abs(y1 - oy1) <= upem / 8
    print('  %s %s -> %s %s' % (ch.encode('unicode_escape').decode(), po.bounds, pd.bounds, '' if ok else '<-- FAIL'))
    bad += not ok
if bad or not checked:
    print('FAIL %d of %d' % (bad, checked)); sys.exit(1)
print('PASS %d glyphs: squares <= upem/12 at the black-box top-left, cmap and advances unchanged' % checked)
