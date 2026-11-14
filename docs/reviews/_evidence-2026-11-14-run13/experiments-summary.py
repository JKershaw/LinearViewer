#!/usr/bin/env python3
"""Summarise the labelled experiments (seams-code-<H>-exp-*.json) against the head (HEAD registry), run 13 (LIN-4482).
Usage: python3 -I experiments-summary.py <evidence dir> > experiments-run13.txt"""
import json, glob, os, sys
R = os.path.abspath(sys.argv[1]); H = 'fb358dbda7f26ab44b3f58acb15886b21ac20950'
S = {'Runs & dispatch': 'Runs', 'LLM & prompts': 'LLM', 'Other features': 'Other', 'Front end: server-rendered pages': 'Pages',
     'Agent API (proxy)': 'Agent API', 'Providers (Linear, GitHub, Jira, local)': 'Providers', 'Auth, accounts & workspaces': 'Auth',
     'Platform & plumbing': 'Platform', 'Web routes (pages & workspace API)': 'Web', 'Wiring (server.js)': 'Wiring',
     'Front end: browser code': 'Browser'}
pr = lambda d: {tuple(sorted([p['a'], p['b']])): (p['a'], p['b'], p['aToB'], p['bToA']) for p in d['knots']['pairs']}
L = lambda d: {(l['from'], l['to']): l['imports'] for l in d['links']}
h = json.load(open(f'{R}/seams-code-{H}-guide-head.json')); base = pr(h); lb = L(h)
print('Experiments at HEAD fb358dbda (labelled; not applied). Head: 14 pairs, one cycle group of 9.')
for f in sorted(glob.glob(f'{R}/seams-code-{H}-exp-*.json')):
    d = json.load(open(f)); p = pr(d); l = L(d)
    print('\n' + f.split('exp-')[1].replace('.json', ''), '| pairs', len(p), '| cycle groups', [len(g) for g in d['knots']['groups']],
          '| cross-area links', sum(l.values()), '(head', sum(lb.values()), ')')
    for k in sorted(set(p) | set(base)):
        a = p.get(k); b = base.get(k)
        if (a and a[2:]) != (b and b[2:]):
            n = a or b
            print(f"   pair {S.get(n[0], n[0])} <-> {S.get(n[1], n[1])}: head {b[2] if b else '-'}/{b[3] if b else '-'} -> "
                  f"{a[2] if a else '-'}/{a[3] if a else '-'}" + ('  (closed)' if not a else '') + ('  (opened)' if not b else ''))
    for k in sorted(set(l) | set(lb)):
        if l.get(k, 0) != lb.get(k, 0):
            print(f"   link {S.get(k[0], k[0])} -> {S.get(k[1], k[1])}: {lb.get(k, 0)} -> {l.get(k, 0)}")
