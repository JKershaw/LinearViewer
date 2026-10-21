"""LIN-3750: palette-quantise the beat-3 PNGs to keep the evidence dir repo-sane.

Carried convention (09-26 §1.4 / §7.11): PNGs are palette-quantised, fine for layout and hierarchy
judgments; colour figures come ONLY from the JSON measurements. Run once after the captures:
    python3 docs/reviews/_evidence-2026-10-21/capture/beat3-quantise.py
"""
import os, sys
from PIL import Image

d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'authenticated')
before = after = 0
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'):
        continue
    p = os.path.join(d, f)
    before += os.path.getsize(p)
    im = Image.open(p)
    if im.mode == 'P':
        after += os.path.getsize(p)
        continue
    q = im.convert('RGB').quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(p, optimize=True)
    after += os.path.getsize(p)
print(f'{before/1e6:.1f} MB -> {after/1e6:.1f} MB')
