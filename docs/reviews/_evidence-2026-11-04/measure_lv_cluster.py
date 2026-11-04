#!/usr/bin/env python3
"""LIN-4206: cluster sizes, burst/tail split and pair lifts for LV, from lv-window-landings.tsv.
Usage: python3 measure_lv_cluster.py <LV repo> <out.json>
Lift = P(A and B) / (P(A) P(B)) over the window's first-parent landings (run-3 definition)."""
import json, subprocess, sys
from collections import Counter
from itertools import combinations
REPO, OUT = sys.argv[1], sys.argv[2]
HEAD = '5334c81a7207b9f2cc85ca429a2c6b18e1635c0e'; BASE = 'f25aa127'
import os
HERE = os.path.dirname(os.path.abspath(__file__))
def git(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True).stdout
def exists(rev, f): return subprocess.run(['git', '-C', REPO, 'cat-file', '-e', f'{rev}:{f}'], capture_output=True).returncode == 0
def nlines(rev, f): return len(git('show', f'{rev}:{f}').splitlines())
def files_of(sha):
    out = git('show', '--first-parent', '-m', '--numstat', '--no-renames', '--format=', sha)
    return {l.split('\t')[2] for l in out.splitlines() if l.count('\t') == 2}
rows = [l.split('\t') for l in open(os.path.join(HERE, 'lv-window-landings.tsv')).read().splitlines()[1:]]
regime = lambda d: 'burst' if '2026-10-23' <= d <= '2026-10-26' else ('tail' if d >= '2026-10-29' else 'early')
landings = [(sha, d[:10], subj) for sha, d, subj in rows]
touch = {sha: files_of(sha) for sha, _, _ in landings}
cluster = ['lib/task-page-loader.js', 'lib/render-task-page.js', 'public/prompt-section.js', 'lib/render.js',
           'routes/task-page.js', 'lib/task-board-view.js', 'public/app.js', 'public/task-page.js']
cluster += [f for f in set().union(*touch.values()) if f.startswith('lib/home') or f.startswith('public/home')]
res = {'cluster_files': {}, 'pairs': []}
for f in sorted(set(cluster)):
    head = nlines(HEAD, f) if exists(HEAD, f) else None
    base = nlines(BASE, f) if exists(BASE, f) else 0
    n = {'burst': 0, 'tail': 0, 'early': 0}
    for sha, d, _ in landings:
        if f in touch[sha]: n[regime(d)] += 1
    res['cluster_files'][f] = {'lines_at_f25aa127': base, 'lines_at_HEAD': head,
                              'touches_total': sum(n.values()), 'burst': n['burst'], 'tail': n['tail'], 'early': n['early']}
tot_landings = len(landings)
hot = [f for f, _ in Counter(f for sha in touch for f in touch[sha]).most_common() if f.startswith(('lib/', 'public/', 'routes/', 'server.js'))]
hot = [f for f in hot if Counter(x for s in touch for x in touch[s])[f] >= 6]
cnt = Counter(x for s in touch for x in touch[s])
for a, b in combinations(hot, 2):
    both = sum(1 for s in touch if a in touch[s] and b in touch[s])
    if both >= 5:
        lift = (both / tot_landings) / ((cnt[a] / tot_landings) * (cnt[b] / tot_landings))
        res['pairs'].append({'a': a, 'b': b, 'n_both': both, 'lift': round(lift, 2)})
res['pairs'].sort(key=lambda r: -r['lift'])
res['regime_counts'] = dict(Counter(regime(d) for _, d, _ in landings))
json.dump(res, open(OUT, 'w'), indent=1)
for f, v in res['cluster_files'].items(): print(f, v)
print('pairs (n>=5, sorted by lift):')
for p in res['pairs'][:12]: print(p)
print('regimes', res['regime_counts'])
