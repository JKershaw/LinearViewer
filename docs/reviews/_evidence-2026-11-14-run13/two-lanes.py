#!/usr/bin/env python3
"""The two HTTP lanes (Agent API routes/proxy*.js and Web routes/workspace-api*.js etc.), run 13 (LIN-4482): links between them,
files outside both that both import, and the window's commits touching both. Usage: python3 -I two-lanes.py <evidence dir> <repo>"""
import json, os, re, subprocess, sys
EV, REPO = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
H, B = 'fb358dbda7f26ab44b3f58acb15886b21ac20950', 'e2d4659c4bf07ed266735f718e85232e5f2a6458'
AG, WEB = 'Agent API (proxy)', 'Web routes (pages & workspace API)'
reg = json.load(open(os.path.join(EV, 'areas.head-registry.json')))['areas']
area = lambda p: next((a['name'] for a in reg if any(re.search(m, p) for m in a['match'])), None)
for tag, sha in (('B', B), ('H', H)):
    es = json.load(open(os.path.join(EV, f'edges-code-{sha}-guide-head.json')))['edgeList']
    w2a = sum(1 for e in es if e['fromArea'] == WEB and e['toArea'] == AG)
    a2w = sum(1 for e in es if e['fromArea'] == AG and e['toArea'] == WEB)
    ta = {e['to'] for e in es if e['fromArea'] == AG and e['toArea'] not in (AG, WEB)}
    tw = {e['to'] for e in es if e['fromArea'] == WEB and e['toArea'] not in (AG, WEB)}
    print(f'{tag}: Web->Agent API {w2a}, Agent API->Web {a2w}; outside targets: Agent API {len(ta)}, Web {len(tw)}, shared {len(ta & tw)} of {len(ta | tw)}')
    if tag == 'B': sb = ta & tw
    else: print('  shared targets new at H:', sorted((ta & tw) - sb), '| gone:', sorted(sb - (ta & tw)))
cs = json.load(open(os.path.join(EV, f'cochange-code-{B}-guide-head-days60.json'))), json.load(open(os.path.join(EV, f'cochange-code-{H}-guide-head-days60.json')))
pc = lambda c: {tuple(sorted(p['areas'])): p['changes'] for p in c['pairs']}
k = tuple(sorted([AG, WEB])); print('co-change Agent API <-> Web: B', pc(cs[0])[k], 'H', pc(cs[1])[k])
out = subprocess.run(['git', 'log', '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%h %s', f'{B}..{H}'], cwd=REPO, capture_output=True, text=True).stdout
cur = None; both = []
for l in out.split('\n'):
    if l.startswith('@'): cur = [l[1:], set()]; both.append(cur)
    elif l.strip() and cur: cur[1].add(area(l.strip()))
hits = [c[0] for c in both if AG in c[1] and WEB in c[1]]
print('window commits touching both lanes:', len(hits)); [print('  ', h[:90]) for h in hits]
