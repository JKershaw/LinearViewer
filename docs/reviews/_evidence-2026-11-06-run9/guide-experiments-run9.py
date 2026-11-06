#!/usr/bin/env python3
"""Labelled guide experiment for Seams & Tangles run 9 (LIN-4323). Proposal only; nothing edits areas.json.
  P7min-stage-writes : lib/stage-writes.js -> LLM & prompts (run 8's proposal, re-measured at both run 9 SHAs)
usage (repo root): python3 -I <this> write ; then seams.mjs per guide ; python3 -I <this> summary
"""
import json, os, sys
EV = 'docs/reviews/_evidence-2026-11-06-run9'
def build(name):
    g = json.load(open(os.path.join(EV, 'areas.head-5c63aa26.json')))
    if 'P7min' in name:
        for a in g['areas']:
            if a['name'] == 'LLM & prompts': a['match'].append(r'^lib/stage-writes\.js$')
    return g
NAMES = ['P7min-stage-writes']
def short(n): return n.split(' (')[0].replace('Front end: ', '').split(',')[0].split(' &')[0]
if sys.argv[1] == 'write':
    for n in NAMES: json.dump(build(n), open(os.path.join(EV, f'areas.proposal-{n}.json'), 'w'), indent=2)
else:
    for guide in ['head-5c63aa26'] + [f'proposal-{n}' for n in NAMES]:
        print(f'## {guide}')
        for c in ['af55cb73', '5c63aa26']:
            d = json.load(open(os.path.join(EV, f'seams-code-{c}-guide-{guide}.json')))
            tot = sum(l['imports'] for l in d['links'])
            ar = {a['name']: a['files'] for a in d['areas']}
            pairs = sorted(f"{short(p['a'])}<->{short(p['b'])} {p['aToB']}/{p['bToA']}" for p in d['knots']['pairs'])
            print(f"- {c}: files {d['scope']['files']}, links {tot}, pairs {len(pairs)}, groups {[len(x) for x in d['knots']['groups']]}, Other {ar.get('Other features')}")
            print('    ' + '; '.join(pairs))
