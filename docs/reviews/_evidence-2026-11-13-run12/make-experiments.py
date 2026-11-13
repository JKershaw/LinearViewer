#!/usr/bin/env python3
"""Three labelled registry experiments for Seams & Tangles run 12 (LIN-4444).

Each writes a registry derived from the HEAD registry (areas.head-registry.json). Nothing is applied to the
repo: the outputs are scratch registries, measured with `scripts/code-shape/seams.mjs` at HEAD.
  exp-A-sequence-to-runs.json   the three recommendation sequence modules move from LLM & prompts to Runs & dispatch
  exp-B-isolate-words.json      the three prompt-vocabulary modules move to a new area "Prompt vocabulary", placed before LLM
  exp-C-sequence-area.json      the sequence modules plus recommendation-facts and recommendation-input move to a new area
                                "Recommendation sequence", placed before LLM
Usage: python3 -I make-experiments.py <evidence dir>
"""
import json, os, re, sys

EV = os.path.abspath(sys.argv[1])
reg = json.load(open(os.path.join(EV, 'areas.head-registry.json')))

SEQ = ['lib/recommendation-look-first.js', 'lib/recommendation-blind-read.js', 'lib/recommendation-live-wait.js']
WORDS = ['lib/prompts/blind-read-words.js', 'lib/prompts/survey-words.js', 'lib/prompts/leftover-words.js']


def exact(paths):
    return '^(?:' + '|'.join(re.escape(p) for p in paths) + ')$'


def exclude_from(area, paths):
    """Prefix each pattern of `area` with a negative lookahead for the exact paths (first match wins)."""
    neg = '(?!(?:' + '|'.join(re.escape(p) for p in paths) + ')$)'
    out = []
    for p in area['match']:
        assert p.startswith('^'), p
        out.append('^' + neg + p[1:])
    area['match'] = out


def find(areas, name):
    for i, a in enumerate(areas):
        if a['name'] == name:
            return i
    raise SystemExit(f'no area {name}')


def write(name, areas, label):
    doc = {'areas': areas}
    with open(os.path.join(EV, name), 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(name, label)


# A: sequence modules move from LLM to Runs
a = json.loads(json.dumps(reg['areas']))
llm = a[find(a, 'LLM & prompts')]
exclude_from(llm, SEQ)
runs = a[find(a, 'Runs & dispatch')]
runs['match'] = [exact(SEQ)] + runs['match']
write('areas.exp-A-sequence-to-runs.json', a, 'EXPERIMENT A: sequence modules LLM -> Runs (labelled, not applied)')

# B: prompt vocabulary moves to its own area before LLM
b = json.loads(json.dumps(reg['areas']))
llm = b[find(b, 'LLM & prompts')]
exclude_from(llm, WORDS)
newarea = {'name': 'Prompt vocabulary', 'slug': 'prompt-vocabulary', 'match': [exact(WORDS)]}
b.insert(find(b, 'LLM & prompts'), newarea)
write('areas.exp-B-isolate-words.json', b, 'EXPERIMENT B: prompt vocabulary leaves in their own area (labelled, not applied)')

# C: a new Recommendation sequence area before LLM holds the sequence modules and the two recommendation readers
SEQC = SEQ + ['lib/recommendation-facts.js', 'lib/recommendation-input.js']
c = json.loads(json.dumps(reg['areas']))
llm = c[find(c, 'LLM & prompts')]
exclude_from(llm, SEQC)
newarea = {'name': 'Recommendation sequence', 'slug': 'recommendation-sequence', 'match': [exact(SEQC)]}
c.insert(find(c, 'LLM & prompts'), newarea)
write('areas.exp-C-sequence-area.json', c, 'EXPERIMENT C: new Recommendation sequence area (labelled, not applied)')
