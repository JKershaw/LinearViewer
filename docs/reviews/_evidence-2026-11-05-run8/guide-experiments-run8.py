#!/usr/bin/env python3
"""Labelled guide experiments for Seams & Tangles run 8 (LIN-4298). Proposals only; nothing edits areas.json.
  P7min-stage-writes : lib/stage-writes.js -> LLM & prompts (beside the templates that declare it)
  P2c-costs-area     : a new 'Costs & usage' area, inserted FIRST (first match wins), claiming the cost family
  P2c+P7min          : both
usage (repo root): python3 -I <this> write ; then seams.mjs per guide ; python3 -I <this> summary
"""
import json, os, sys
EV = 'docs/reviews/_evidence-2026-11-05-run8'
COST = r'^lib/(cost-read|cost-format|request-usage-[^/]*|usage-snapshot-intake|row-usage|model-pricing|llm-call-log|model-routing-spend|terminal-marked-task-cost|weekly-budget|transcript-spend|pricing-conformance-sweep)\.js$'
def build(name):
    g = json.load(open(os.path.join(EV, 'areas.head-af55cb73.json')))
    if 'P7min' in name:
        for a in g['areas']:
            if a['name'] == 'LLM & prompts': a['match'].append(r'^lib/stage-writes\.js$')
    if 'P2c' in name:
        g['areas'].insert(1, {'name': 'Costs & usage', 'match': [COST]})
    return g
NAMES = ['P7min-stage-writes', 'P2c-costs-area', 'P2c+P7min']
def short(n): return n.split(' (')[0].replace('Front end: ', '').split(',')[0].split(' &')[0]
if sys.argv[1] == 'write':
    for n in NAMES: json.dump(build(n), open(os.path.join(EV, f'areas.proposal-{n}.json'), 'w'), indent=2)
else:
    for guide in ['head-af55cb73'] + [f'proposal-{n}' for n in NAMES]:
        print(f'## {guide}')
        for c in ['2eb73ae0', 'af55cb73']:
            d = json.load(open(os.path.join(EV, f'seams-code-{c}-guide-{guide}.json')))
            tot = sum(l['imports'] for l in d['links'])
            ar = {a['name']: a['files'] for a in d['areas']}
            pairs = sorted(f"{short(p['a'])}<->{short(p['b'])} {p['aToB']}/{p['bToA']}" for p in d['knots']['pairs'])
            print(f"- {c}: files {d['scope']['files']}, links {tot}, pairs {len(pairs)}, groups {[len(x) for x in d['knots']['groups']]}, Other {ar.get('Other features')}, Costs {ar.get('Costs & usage')}")
            print('    ' + '; '.join(pairs))
