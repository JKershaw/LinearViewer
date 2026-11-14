#!/usr/bin/env python3
"""Labelled registry experiments for Seams & Tangles run 13 (LIN-4482). Nothing is applied to the repo.

Each writes a registry derived from the HEAD registry (areas.head-registry.json), measured with
`scripts/code-shape/seams.mjs` at HEAD fb358dbda. A moved file is excluded from every other area by a negative
lookahead wrapped around each whole pattern, and added as an exact pattern at the front of the target area (first match wins).
  exp-E-stage-writes-to-agent-api.json   lib/stage-writes.js (catch-all) -> Agent API (proxy), beside lib/stage-write-gate.js
  exp-F-stage-writes-to-llm.json         lib/stage-writes.js (catch-all) -> LLM & prompts, beside lib/prompts/stage-kinds.js
  exp-G-should-mock-ai-to-platform.json  lib/should-mock-ai.js (LLM & prompts by name) -> Platform & plumbing
  exp-H-shared-leaves-to-platform.json   lib/cost-format.js, lib/time-words.js (Pages) -> Platform & plumbing
                                         (reverses the LIN-4471 owner pin in tests/unit/served-leaf-owners.test.js)
  exp-I-seal-to-llm.json                 lib/as-asked-seal.js (catch-all) -> LLM & prompts: run 10's P10a, re-measured at HEAD
                                         (reverses the pin in tests/unit/area-map-placement.test.js)
  exp-J-seal-to-llm-and-stage-writes-to-agent-api.json   I and E together
Usage: python3 -I make-experiments.py <evidence dir>
"""
import copy, json, os, re, sys

EV = os.path.abspath(sys.argv[1])
base = json.load(open(os.path.join(EV, 'areas.head-registry.json')))


def exact(paths):
    return '^(?:' + '|'.join(re.escape(p) for p in paths) + ')$'


def area_of(reg, path):
    for a in reg['areas']:
        if any(re.search(p, path) for p in a['match']):
            return a
    return None


def move(reg, paths, target):
    reg = copy.deepcopy(reg)
    neg = '(?!(?:' + '|'.join(re.escape(p) for p in paths) + ')$)'
    for a in reg['areas']:
        if a['name'] == target:
            continue
        a['match'] = ['^' + neg + '(?:' + p + ')' for p in a['match']]  # the whole alternation, so every branch is excluded
    t = next(a for a in reg['areas'] if a['name'] == target)
    t['match'] = [exact(paths)] + t['match']
    for p in paths:
        assert area_of(reg, p)['name'] == target, (p, area_of(reg, p)['name'])
    return reg


EXPS = {
    'exp-E-stage-writes-to-agent-api': (['lib/stage-writes.js'], 'Agent API (proxy)'),
    'exp-F-stage-writes-to-llm': (['lib/stage-writes.js'], 'LLM & prompts'),
    'exp-G-should-mock-ai-to-platform': (['lib/should-mock-ai.js'], 'Platform & plumbing'),
    'exp-H-shared-leaves-to-platform': (['lib/cost-format.js', 'lib/time-words.js'], 'Platform & plumbing'),
    'exp-I-seal-to-llm': (['lib/as-asked-seal.js'], 'LLM & prompts'),
}
for name, (paths, target) in EXPS.items():
    json.dump(move(base, paths, target), open(os.path.join(EV, f'areas.{name}.json'), 'w'), indent=2)
    print('wrote', f'areas.{name}.json')
both = move(move(base, ['lib/as-asked-seal.js'], 'LLM & prompts'), ['lib/stage-writes.js'], 'Agent API (proxy)')
json.dump(both, open(os.path.join(EV, 'areas.exp-J-seal-to-llm-and-stage-writes-to-agent-api.json'), 'w'), indent=2)
print('wrote areas.exp-J-seal-to-llm-and-stage-writes-to-agent-api.json')
