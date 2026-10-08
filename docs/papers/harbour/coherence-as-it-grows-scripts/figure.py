#!/usr/bin/env python3 -I
"""Draw figures/coherence-as-it-grows/series.svg from data/coherence-census.json: four small multiples on one time axis."""
import json, os, sys
D = os.environ.get('COHERENCE_DATA', os.path.join(os.getcwd(), 'data'))
census = json.load(open(D + '/coherence-census.json'))
out = sys.argv[1] if len(sys.argv) > 1 else 'docs/papers/harbour/figures/coherence-as-it-grows/series.svg'
snaps = census['snapshots']
months = [r['month'] for r in snaps]
W, H = 960, 640
PW, PH = 400, 230
PAD = 60
panels = [
    ('Duplicated text, % of production lines (jscpd)', [('50-token clones', [r['jscpd50']['percentage'] for r in snaps], '#1f5aa6'), ('30-token clones', [r.get('jscpd30', {}).get('percentage') for r in snaps], '#7aa6d6')], 0, None),
    ('Declared twins and single-source claims, per 10k lines', [('twins (T)', [round(1e4 * r['admissions']['T'] / r['prodLines'], 2) for r in snaps], '#b5452b'), ('single-source claims (S)', [round(1e4 * r['admissions']['S'] / r['prodLines'], 2) for r in snaps], '#d9a066')], 0, None),
    ('Tests that pin agreement between sites (parity, drift, census)', [('sync tests', [r['syncTests'] for r in snaps], '#4a7c3f')], 0, None),
    ('Production files holding one small decision (sites)', [(k, census['knownDecisions']['sites'][k], c) for k, c in [('tolerant timestamp parse', '#6a3d9a'), ('page-shell option bag', '#9b6fc4'), ('model JSON reply fence parse', '#c9a7e3'), ('store clear(urlKey) boilerplate', '#bbbbbb')]], 0, None),
]
def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;')
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Inter, system-ui, sans-serif" font-size="12">',
       f'<rect width="{W}" height="{H}" fill="white"/>',
       f'<text x="{W/2}" y="24" text-anchor="middle" font-size="15" font-weight="600">Coherence as Harbour grew, January to October 2026 (month-end snapshots of origin/main)</text>']
for pi, (title, lines, ymin, ymax) in enumerate(panels):
    px = PAD + (pi % 2) * (PW + 80); py = 50 + (pi // 2) * (PH + 70)
    xs = months if pi < 3 else census['knownDecisions']['sites']['month']
    vals = [v for _, ys, _ in lines for v in ys if v is not None]
    import math
    raw = max(vals) * 1.1 if vals else 1
    mag = 10 ** math.floor(math.log10(raw)); step = next(st for st in (1, 2, 2.5, 5, 10) if raw <= st * mag) ; top = step * mag
    def X(i, n): return px + 40 + i * (PW - 60) / max(1, n - 1)
    def Y(v): return py + PH - 30 - (v - ymin) / (top - ymin) * (PH - 60)
    svg.append(f'<text x="{px}" y="{py - 8}" font-weight="600" font-size="13">{esc(title)}</text>')
    svg.append(f'<line x1="{px + 40}" y1="{py + PH - 30}" x2="{px + PW - 20}" y2="{py + PH - 30}" stroke="#999"/>')
    svg.append(f'<line x1="{px + 40}" y1="{py + 20}" x2="{px + 40}" y2="{py + PH - 30}" stroke="#999"/>')
    for t in range(5):
        v = ymin + (top - ymin) * t / 4
        svg.append(f'<text x="{px + 34}" y="{Y(v) + 4}" text-anchor="end" fill="#555">{v:.3g}</text>')
        svg.append(f'<line x1="{px + 40}" y1="{Y(v)}" x2="{px + PW - 20}" y2="{Y(v)}" stroke="#eee"/>')
    for i, m in enumerate(xs):
        svg.append(f'<text x="{X(i, len(xs))}" y="{py + PH - 14}" text-anchor="middle" fill="#555">{m[5:]}</text>')
    # fleet start marker (June)
    if '2026-06' in xs:
        j = xs.index('2026-06') - 0.5 if '2026-05' in xs else xs.index('2026-06')
        fx = X(j, len(xs))
        svg.append(f'<line x1="{fx}" y1="{py + 20}" x2="{fx}" y2="{py + PH - 30}" stroke="#c33" stroke-dasharray="4 3"/>')
        svg.append(f'<text x="{fx + 4}" y="{py + PH - 36}" fill="#c33" font-size="11">fleet starts</text>')
    for li, (name, ys, color) in enumerate(lines):
        pts = [(X(i, len(xs)), Y(v)) for i, v in enumerate(ys) if v is not None]
        if len(pts) > 1:
            svg.append('<polyline fill="none" stroke="%s" stroke-width="2" points="%s"/>' % (color, ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)))
        for x, y in pts: svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="{color}"/>')
        lx = px + 48; ly = py + 24 + li * 14
        svg.append(f'<rect x="{lx}" y="{ly}" width="10" height="3" fill="{color}"/>')
        svg.append(f'<text x="{lx + 14}" y="{ly + 4}" fill="#333">{esc(name)}</text>')
svg.append(f'<text x="{PAD}" y="{H - 12}" fill="#666">Sources: coherence-as-it-grows-census.json. Production code is server.js, lib/, routes/ and non-vendored public/. The October point is 7 October.</text>')
svg.append('</svg>')
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w').write('\n'.join(svg))
print('wrote', out)
