#!/usr/bin/env python3
"""Labelled guide experiments for the Seams & Tangles run 7 report (LIN-4249). Proposals only: nothing here edits
`scripts/code-shape/areas.json`, and nothing enforces the guide.

Two proposal guides are written from the HEAD guide copy (`areas.head-2eb73ae0.json`) by appending one match pattern to
the named areas. "Other features" is the last area and first match wins, so an appended pattern places a file only if it
was falling through to the catch-all.

    P7min-new-files  the window's two new catch-all files: waiting-section -> Pages, ruling-settled -> Runs
    P1d-placed-16    every catch-all file at 2eb73ae0 (run 5's P1b placement, plus the three files added since)

Run from the repo root:

    python3 -I docs/reviews/_evidence-2026-11-05/guide-experiments.py write
    (run seams.mjs with each proposal guide at both commits; see README.md)
    python3 -I docs/reviews/_evidence-2026-11-05/guide-experiments.py summary > docs/reviews/_evidence-2026-11-05/guide-experiments.txt
"""
import json, os, sys

EV = 'docs/reviews/_evidence-2026-11-05'
PROPOSALS = {
    'P7min-new-files': {
        'Front end: server-rendered pages': ['waiting-section'],
        'Runs & dispatch': ['ruling-settled'],
    },
    'P1d-placed-16': {
        'Front end: server-rendered pages': ['home-pipeline', 'home-rows', 'home-view', 'dashboard-refresh', 'waiting-section'],
        'Task model': ['home-row-states', 'subtree-index', 'task-facts-holder', 'task-state'],
        'Platform & plumbing': ['cost-format', 'key-state', 'key-state-holders'],
        'Runs & dispatch': ['live-anchor', 'ruling-standing', 'ruling-settled', 'usage-snapshot-intake'],
    },
}
COMMITS = ['d7ceb373', '2eb73ae0']


def short(n):
    return n.split(' (')[0].replace('Front end: ', '').split(',')[0].split(' &')[0]


def write():
    base = json.load(open(os.path.join(EV, 'areas.head-2eb73ae0.json')))
    for name, extra in PROPOSALS.items():
        g = json.loads(json.dumps(base))
        for a in g['areas']:
            if a['name'] in extra:
                a['match'].append('^lib/(' + '|'.join(extra[a['name']]) + r')\.js$')
        with open(os.path.join(EV, f'areas.proposal-{name}.json'), 'w') as f:
            json.dump(g, f, indent=2)
            f.write('\n')


def summary():
    rows = [('head-2eb73ae0', 'HEAD guide (the series)')] + [(f'proposal-{n}', n) for n in PROPOSALS]
    print('# Guide experiments, run 7 (labelled proposals; the committed guide is unchanged)\n')
    for guide, label in rows:
        print(f'## {label} (`{guide}`)')
        for c in COMMITS:
            d = json.load(open(os.path.join(EV, f'seams-code-{c}-guide-{guide}.json')))
            tot = sum(l['imports'] for l in d['links'])
            oth = next((a['files'] for a in d['areas'] if a['name'] == 'Other features'), 0)
            pairs = sorted(f"{short(p['a'])}<->{short(p['b'])} {p['aToB']}/{p['bToA']}" for p in d['knots']['pairs'])
            print(f"- {c}: files {d['scope']['files']}, unmapped {len(d['scope']['unmappedFiles'])}, links {tot}, "
                  f"pairs {len(d['knots']['pairs'])}, group sizes {[len(x) for x in d['knots']['groups']]}, Other {oth}")
            print(f"    pairs: {'; '.join(pairs)}")
        print()


if __name__ == '__main__':
    {'write': write, 'summary': summary}[sys.argv[1]]()
