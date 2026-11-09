"""Generate the Model Y Radar icon SVGs: Tesla-red gradient tile, white radar sweep with a price blip and a bold Y."""
import os, math
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024

def icon(rounded=False, scale=1.0, detail=True):
    rr = 228 if rounded else 0
    off = (S - S * scale) / 2
    tr = f"translate({off:.1f},{off:.1f}) scale({scale})"
    cx, cy = 512, 770
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">',
    """<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#ff5c61"/><stop offset="0.42" stop-color="#e82127"/><stop offset="0.8" stop-color="#b3141a"/><stop offset="1" stop-color="#7f0c10"/></linearGradient>
 <radialGradient id="glow" cx="0.25" cy="0.16" r="0.75">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
 <radialGradient id="sweep" cx="0.5" cy="0.684" r="0.5">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs>"""]
    o.append(f'<rect width="{S}" height="{S}" rx="{rr}" fill="url(#bg)"/>')
    o.append(f'<rect width="{S}" height="{S}" rx="{rr}" fill="url(#glow)"/>')
    o.append(f'<g transform="{tr}">')
    # radar arcs (upper half circle)
    for r, op, w in ([(350, 0.30, 26), (248, 0.48, 26), (146, 0.7, 26)] if detail else [(300, 0.55, 46), (170, 0.85, 46)]):
        o.append(f'<path d="M{cx-r} {cy} A{r} {r} 0 0 1 {cx+r} {cy}" fill="none" stroke="#fff" stroke-opacity="{op}" stroke-width="{w}" stroke-linecap="round"/>')
    # sweep wedge + needle
    ang = math.radians(-38)  # from vertical, towards upper-right
    L = 350 if detail else 300
    ex, ey = cx + L * math.sin(math.radians(38)), cy - L * math.cos(math.radians(38))
    w2 = math.radians(58)
    sx, sy = cx + L * math.sin(math.radians(68)), cy - L * math.cos(math.radians(68))
    if detail:
        o.append(f'<path d="M{cx} {cy} L{ex:.1f} {ey:.1f} A{L} {L} 0 0 1 {sx:.1f} {sy:.1f} Z" fill="url(#sweep)"/>')
    o.append(f'<path d="M{cx} {cy} L{ex:.1f} {ey:.1f}" stroke="#fff" stroke-width="{34 if detail else 52}" stroke-linecap="round"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{44 if detail else 64}" fill="#fff"/>')
    if detail:  # price blip
        bx, by = cx + 248 * math.sin(math.radians(56)), cy - 248 * math.cos(math.radians(56))
        o.append(f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="34" fill="#fff"/><circle cx="{bx:.1f}" cy="{by:.1f}" r="62" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="14"/>')
    # Y mark
    ys = 0.92 if detail else 1.1
    yx, yy = 512, (250 if detail else 245)
    o.append(f'<g transform="translate({yx},{yy}) scale({ys})"><path d="M-118 -120 L0 30 L118 -120 M0 30 L0 150" fill="none" stroke="#fff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/></g>')
    o.append('</g></svg>')
    return "\n".join(o)

open(f"{D}/icon.svg", "w").write(icon())
open(f"{D}/icon-rounded.svg", "w").write(icon(rounded=True))
open(f"{D}/icon-maskable.svg", "w").write(icon(scale=0.78))
open(f"{D}/icon-small.svg", "w").write(icon(rounded=True, detail=False))
print("svgs written")
