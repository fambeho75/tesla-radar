"""Flat Tesla Radar icon: graphite T glyph (own drawing in the style of the Tesla T) on white."""
import os, math
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
C = "#1F2937"
def glyph():
    # Thick shallow crescent bar on top, flared stem below with a small gap.
    bar = ('M -420 -270 Q 0 -420 420 -270 L 396 -196 Q 0 -300 -396 -196 Z')
    stem = ('M -215 -190 Q 0 -250 215 -190 Q 100 -168 80 -100 '
            'L 52 340 Q 0 400 -52 340 L -80 -100 Q -100 -168 -215 -190 Z')
    out = [f'<path d="{bar}" fill="{C}"/>', f'<path d="{stem}" fill="{C}"/>']
    return "\n".join(out), (-420, -345, 420, 385)
def icon(rounded=False, scale=0.88):
    g,(x0,y0,x1,y1) = glyph()
    cx, cy = (x0+x1)/2, (y0+y1)/2
    rr = 228 if rounded else 0
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">\n'
            f'<rect width="{S}" height="{S}" rx="{rr}" fill="#ffffff"/>\n'
            f'<g transform="translate(512 512) scale({scale}) translate({-cx} {-cy})">\n{g}\n</g>\n</svg>\n')
open(f"{D}/icon.svg","w").write(icon())
open(f"{D}/icon-rounded.svg","w").write(icon(True))
open(f"{D}/icon-maskable.svg","w").write(icon(scale=0.72))
open(f"{D}/icon-small.svg","w").write(icon(True, scale=1.0))
