"""Port walk 7's seeds to the revised page (18 Nov): no area kind, no paths/claims; area addressees become `project`; `in` an area is dropped (the record belongs to the project)."""
import re, sys, pathlib
here = pathlib.Path(__file__).parent
for r in ['replay-4450', 'replay-4446', 'replay-4469']:
    s = (here.parent / '7' / r / 'seed.sh').read_text()
    n_area = len(re.findall(r'add area', s))
    # an area add: VAR=$(w add area ... <<'JSON' ... JSON ... )") -> VAR=project
    s, k = re.subn(r'(A_[A-Z_]+)=\$\(w add area.*?\nJSON\n\)"\)', r'\1=project', s, flags=re.S)
    s, k2 = re.subn(r'P=\$\(cat <<\'(J\d+)\'\n\{"name": [^\n]*\n\1\n\)\nP=\$\(sub "\$P"\)\n(A_[A-Z_]+)=\$\(L add area [^\n]*\| idof\)', r'\2=project', s); k += k2
    assert k == n_area, (r, k, n_area)
    # a revise that only set a task's paths has nothing left to write: drop it
    s, k3 = re.subn(r'P=\$\(cat <<\'(J\d+)\'\n\{"paths": [^\n]*\}\n\1\n\)\nP=\$\(sub "\$P"\)\nL revise [^\n]*\n', '', s)
    if k3: print(r, 'dropped paths-only revises', k3)
    s = s.replace('@@PARENT@@@2', '@@PARENT@@@1')  # 4469: the parent's v2 was the dropped paths-only revise
    s = re.sub(r'"in": *"@@A_[A-Z_]+@@", *', '', s)
    s = re.sub(r', *"in": *"@@A_[A-Z_]+@@"', '', s)
    for f in ('paths', 'claims'):
        s = re.sub(r'"%s": *\[[^\]]*\], *' % f, '', s)
        s = re.sub(r', *"%s": *\[[^\]]*\]' % f, '', s)
    s = re.sub(r'"of": *"(plan-review|review|blind-read)"', r'"judgement": "\1"', s)  # walk 7 fix: of -> judgement
    s = s.replace('walks/7', 'walks/8')
    s = s.replace('# Seed for walk 4', '# Ported to walk 8 by port-seeds.py (no areas, no paths, area addressees -> project). Seed for walk 4', 1)
    left = re.findall(r'add area|"paths"|"claims"|"in": *"@@A_', s)
    assert not left, (r, left[:3])
    (here / r / 'seed.sh').write_text(s)
    print(r, 'areas replaced', k, 'lines', s.count('\n'))
