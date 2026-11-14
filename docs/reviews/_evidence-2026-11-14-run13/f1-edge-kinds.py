#!/usr/bin/env python3
"""F1 (LLM & prompts <-> Runs & dispatch) edges by target kind, run 13 (LIN-4482). Reads this folder's edge dumps.
A target is a LEAF when it has no outbound import edge at that commit (it imports nothing in scope).
Usage: python3 -I f1-edge-kinds.py <evidence dir>"""
import json, os, sys
from collections import Counter
EV = os.path.abspath(sys.argv[1])
H, B = 'fb358dbda7f26ab44b3f58acb15886b21ac20950', 'e2d4659c4bf07ed266735f718e85232e5f2a6458'
RUNS, LLM = 'Runs & dispatch', 'LLM & prompts'
for tag, sha in (('B e2d4659c4', B), ('H fb358dbda', H)):
    es = json.load(open(os.path.join(EV, f'edges-code-{sha}-guide-head.json')))['edgeList']
    out = Counter(e['from'] for e in es)
    for a, b in ((RUNS, LLM), (LLM, RUNS)):
        sel = [e for e in es if e['fromArea'] == a and e['toArea'] == b]
        leaf = [e for e in sel if out[e['to']] == 0]
        tgt = Counter(e['to'] for e in sel if out[e['to']] != 0)
        print(f'{tag} {a[:4]} -> {b[:4]}: {len(sel)} edges, {len(leaf)} into leaves; distinct targets {len({e["to"] for e in sel})}')
        print('    non-leaf targets:', dict(tgt.most_common()))
