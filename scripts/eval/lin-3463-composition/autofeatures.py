import json, re, sys, statistics as st
from collections import defaultdict
S = sys.argv[1]
rows = json.load(open(f'{S}/table.json')); prs = {int(k): v for k, v in json.load(open(f'{S}/prs.json')).items()}
def feats(t):
    t = t or ''
    return {'words': len(t.split()),
            'file_refs': len(set(re.findall(r'[\w./-]+\.(?:js|mjs|json|md|css|html)\b', t))),
            'line_anchors': len(re.findall(r'\.(?:js|mjs|md)[:#]L?\d+', t)) + len(re.findall(r'`:\d+', t)),
            'code_blocks': t.count('```') // 2,
            'questions': len(re.findall(r'\?(\s|$)', t)),
            'has_done': bool(re.search(r'done (when|looks like)|acceptance|definition of done', t, re.I)),
            'has_fix': bool(re.search(r'suggested fix|proposed fix|\*\*fix[:*]|^fix:', t, re.I | re.M)),
            'has_behaviour': bool(re.search(r'\*\*behaviou?r', t, re.I)),
            'has_plan': bool(re.search(r'implementation plan', t, re.I)),
            'out_of_scope': bool(re.search(r'out of scope|non-goal', t, re.I))}
def desc_ids(tk, seen=None):
    seen = seen or set()
    if tk in seen or tk not in rows: return []
    seen.add(tk); return [tk] + [d for c in rows[tk]['children_after_start'] for d in desc_ids(c, seen)]
out = {}
for tk, r in rows.items():
    if not (r['desc0'] and r['lineages']): continue
    f = feats(r['desc0'])
    pl = set(p for d in desc_ids(tk) for p in rows[d]['prs'] if p in prs)
    f['pr_lines'] = sum(prs[p]['prod_add'] + prs[p]['prod_del'] for p in pl) if pl else None
    f['test_lines'] = sum(prs[p]['test_add'] + prs[p]['test_del'] for p in pl) if pl else None
    f['n_prs'] = len(pl)
    out[tk] = f
json.dump(out, open(f'{S}/autofeatures.json', 'w'))
P = [dict(rows[t], **f) for t, f in out.items() if rows[t]['state'] == 'Done']
print('Done tickets with features', len(P), 'with PR lines', sum(1 for x in P if x['pr_lines'] is not None))
def tert(key):
    xs = sorted(P, key=lambda x: x[key]); n = len(xs)
    for lab, part in (('low', xs[:n//3]), ('mid', xs[n//3:2*n//3]), ('high', xs[2*n//3:])):
        s = [x['sessions_total'] for x in part]
        print(f'  {key} {lab:4s} ({part[0][key]}-{part[-1][key]}): n={len(part)} sessions med {st.median(s)} mean {st.mean(s):.1f} split {100*sum(x["split"] for x in part)/len(part):.0f}%')
for k in ['words', 'file_refs', 'line_anchors', 'questions']: tert(k)
for k in ['has_done', 'has_fix', 'has_behaviour', 'has_plan', 'out_of_scope']:
    for v in (False, True):
        part = [x for x in P if x[k] == v]; s = [x['sessions_total'] for x in part]
        print(f'  {k}={v}: n={len(part)} sessions med {st.median(s)} mean {st.mean(s):.1f} split {100*sum(x["split"] for x in part)/len(part):.0f}%')
