"""Render PNG icons from the SVGs with cairosvg (librsvg not needed)."""
import os, cairosvg
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def r(svg, name, n):
    cairosvg.svg2png(url=f"{D}/{svg}", write_to=f"{D}/{name}", output_width=n, output_height=n)
r("icon.svg", "apple-touch-icon.png", 180)
r("icon.svg", "icon-192.png", 192)
r("icon.svg", "icon-512.png", 512)
r("icon-maskable.svg", "icon-maskable-192.png", 192)
r("icon-maskable.svg", "icon-maskable-512.png", 512)
r("icon-small.svg", "favicon-32.png", 32)
print("pngs rendered")
