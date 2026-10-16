# theseus: births and deaths of two-way area pairs ("tangles"), from per-commit.py's output.
# Usage: python3 events.py <repoDir> <per-commit.jsonl> <codes.json> <outDir>
# Writes theseus-events.json (each event, joined to its hand code), theseus-per-commit.json
# (sha, date, files, cross-area imports, tangle count for every commit) and
# theseus-tangles-head.json (each tangle at the last commit, with its thinner direction's edges).
import json, os, re, sys
from collections import Counter

repo, src, codes_path, out_dir = sys.argv[1:5]
guide = json.load(open(os.path.join(repo, 'scripts/code-shape/areas.json')))['areas']
areas = [(a['name'], [re.compile(m) for m in a['match']]) for a in guide]

def area(path):  # first match wins, as in seams.mjs
    return next((n for n, rx in areas if any(r.search(path) for r in rx)), None)

def directions(key, crossings):
    a, b = key.split('|')
    return {'a>b': [c for c in crossings if area(c.split('>')[0]) == a],
            'b>a': [c for c in crossings if area(c.split('>')[0]) == b]}

recs = [json.loads(l) for l in open(src) if l.strip()]
errors = sum(1 for r in recs if r.get('error'))
recs = [r for r in recs if not r.get('error')]
codes = {(c['sha'], c['pair']): c for c in json.load(open(codes_path))['events']}
events, prev = [], {}
for r in recs:
    cur = r['pairs']
    for k in sorted(cur.keys() - prev.keys()):
        d = directions(k, cur[k])
        thin = min(d, key=lambda x: len(d[x]))
        events.append({'kind': 'born', 'pair': k, 'date': r['date'], 'sha': r['sha'][:8], 'lin': r['lin'][:4],
                       'pr': r['pr'], 'subject': r['subject'][:120], 'thinEdges': d[thin]})
    for k in sorted(prev.keys() - cur.keys()):
        events.append({'kind': 'dissolved', 'pair': k, 'date': r['date'], 'sha': r['sha'][:8], 'lin': r['lin'][:4],
                       'pr': r['pr'], 'subject': r['subject'][:120], 'lastEdges': prev[k][:6]})
    prev = cur
for e in events:
    c = codes.get((e['sha'], e['pair']), {})
    e['ticket'], e['title'], e['code'], e['note'] = c.get('ticket'), c.get('title'), c.get('code'), c.get('note')

head = recs[-1]
tangles = []
for k, cr in sorted(head['pairs'].items()):
    d = directions(k, cr)
    thin = min(d, key=lambda x: len(d[x]))
    tangles.append({'pair': k, 'edges': len(cr), 'thinDirection': thin, 'thinEdges': d[thin]})

json.dump(events, open(os.path.join(out_dir, 'theseus-events.json'), 'w'), indent=1)
json.dump({'commit': head['sha'], 'tangles': tangles},
          open(os.path.join(out_dir, 'theseus-tangles-head.json'), 'w'), indent=1)
json.dump({'fields': ['sha', 'date', 'files', 'crossAreaImports', 'tangles'],
           'rows': [[r['sha'][:8], r['date'], r['files'], r['cross'], len(r['pairs'])] for r in recs]},
          open(os.path.join(out_dir, 'theseus-per-commit.json'), 'w'), separators=(',', ':'))

born = [e for e in events if e['kind'] == 'born']
print('commits', len(recs), 'errors', errors, 'events', len(events), 'born', len(born),
      'dissolved', len(events) - len(born))
print('births made by one import in the thin direction:', sum(len(e['thinEdges']) == 1 for e in born))
print('births by month:', dict(sorted(Counter(e['date'][:7] for e in born).items())))
print('codes:', dict(Counter((e['kind'], e['code']) for e in events)))
print('uncoded:', [(e['sha'], e['pair']) for e in events if not e['code']])
single = [t for t in tangles if len(t['thinEdges']) == 1]
print('tangles at head', len(tangles), 'single-edge', len(single), 'two-edge', sum(len(t['thinEdges']) == 2 for t in tangles))
for t in single:
    print('  ', t['pair'], t['thinEdges'])
