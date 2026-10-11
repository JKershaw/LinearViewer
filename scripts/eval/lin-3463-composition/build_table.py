# One row per ticket: composition at first dispatch (first task-history snapshot) and how the work ran.
import json, glob, re, sys, os
from collections import Counter
S = sys.argv[1]
recs = {}
for f in glob.glob(f'{S}/data/LIN-*.json'):
    d = json.load(open(f)); i = d.get('issue') or {}
    if '_error' in i: continue
    recs[i['identifier']] = d
def ts(x): return x or ''
rows = {}
for tk, d in recs.items():
    i = d['issue']; cost = d.get('cost') or {}
    ws = cost.get('workerSessions') or []
    sn = sorted(((d.get('snapshots') or {}).get('snapshots') or []), key=lambda s: s['capturedAt'])
    disp = (d.get('dispatch') or {}).get('items') or []
    first_dispatch = min([w['dispatchedAt'] for w in ws] + [x['dispatchedAt'] for x in disp if x['kind'] != 'wake'] or [None]) if (ws or disp) else None
    desc0 = sn[0]['snapshot'].get('description') if sn else None
    kinds = Counter(w['kind'] for w in ws)
    rows[tk] = {
        'id': tk, 'n': int(tk.split('-')[1]), 'title': i.get('title'), 'state': (i.get('state') or {}).get('name'),
        'created': i.get('createdAt'), 'completed': i.get('completedAt'), 'parent': (i.get('parent') or {}).get('identifier'),
        'children': [c['identifier'] for c in i.get('children') or []], 'labels': i.get('labels') or [],
        'first_dispatch': first_dispatch, 'first_snapshot_at': sn[0]['capturedAt'] if sn else None,
        'desc0': desc0, 'desc_head': i.get('description'), 'n_snapshots': len(sn),
        'desc_max_chars': max([len(s['snapshot'].get('description') or '') for s in sn] or [0]),
        'lineages': len(ws), 'kinds': dict(kinds), 'no_lineage': cost.get('noLineage'),
        'dur_ms': sum(w.get('durationMs') or 0 for w in ws),
        'aborted': sum(1 for x in disp if x.get('status') == 'aborted' and x['kind'] != 'wake'),
        'comments': [{'at': c['createdAt'], 'body': c['body']} for c in i.get('comments') or []],
    }
# splits: children created after the parent's first dispatch
for r in rows.values():
    kids = [rows[c] for c in r['children'] if c in rows]
    r['children_after_start'] = [k['id'] for k in kids if r['first_dispatch'] and k['created'] and k['created'] > r['first_dispatch']]
    r['children_unknown'] = [c for c in r['children'] if c not in rows]
def total(tk, seen=None):
    seen = seen or set()
    if tk in seen or tk not in rows: return 0
    seen.add(tk); r = rows[tk]
    return r['lineages'] + sum(total(c, seen) for c in r['children_after_start'])
for r in rows.values():
    r['sessions_total'] = total(r['id'])
    r['split'] = bool(r['children_after_start'])
    pr = set()
    for c in r['comments']:
        for m in re.finditer(r'github\.com/JKershaw/LinearViewer/pull/(\d+)', c['body']): pr.add(int(m.group(1)))
    r['prs'] = sorted(pr)
json.dump(rows, open(f'{S}/table.json', 'w'))
print(len(rows), 'with desc0', sum(1 for r in rows.values() if r['desc0']), 'with lineages', sum(1 for r in rows.values() if r['lineages']))
