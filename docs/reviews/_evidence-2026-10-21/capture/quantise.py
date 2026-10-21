"""LIN-3749: palette-quantise evidence PNGs in place (carried convention, coverage-map item 11).
Usage: python3 -I capture/quantise.py <dir>   (colour figures come from the JSON, never from these PNGs)"""
import sys, os
from PIL import Image
d = sys.argv[1]
before = after = 0
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    p = os.path.join(d, f)
    before += os.path.getsize(p)
    im = Image.open(p)
    if im.mode == 'P': after += os.path.getsize(p); continue
    im.convert('RGB').quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)
    after += os.path.getsize(p)
print(f'{before} -> {after} bytes')
