#!/usr/bin/env python3
"""LIN-4394 run 5: method-8 rewrite-in-place events over a range (run 4's definition, same bucket rule as measure_lv.py).
Usage: python3 rewrites.py <LV repo> <rev-range> <out.json>. Run 4's 38 events = f25aa127..5334c81a."""
import json, subprocess, sys
from collections import Counter
REPO, RNG, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
def git(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True, check=True).stdout
def bucket(p):
    if p.startswith('experiments/') and '/replay/work/' in p: return 'generated'
    if p.startswith(('docs/reviews/', 'docs/papers/', 'tests/screenshots/', 'tests/fixtures/', 'scripts/eval/')) or '_evidence-' in p or p == 'package-lock.json': return 'excluded'
    if p.startswith('experiments/'): return 'research'
    if p.startswith('tests/'): return 'tests'
    if p.startswith('scripts/'): return 'scripts'
    if p.startswith('docs/'): return 'docs'
    return 'src'
out = git('log', '--first-parent', '-m', '--numstat', '--no-renames', '--format=@@C@@%H|%cI|%s', RNG)
lands, cur = [], None
for line in out.splitlines():
    if line.startswith('@@C@@'):
        s, d, subj = line[5:].split('|', 2); cur = {'sha': s, 'date': d, 'subject': subj, 'files': []}; lands.append(cur)
    elif line.strip() and cur is not None:
        a, dl, p = line.split('\t', 2); cur['files'].append((0 if a == '-' else int(a), 0 if dl == '-' else int(dl), p))
ev = []
for c in lands:
    for a, d, p in c['files']:
        if bucket(p) not in ('src', 'scripts') or d == 0: continue
        try: prev = len(git('show', f"{c['sha']}^1:{p}").splitlines())
        except subprocess.CalledProcessError: continue
        if prev and d >= 0.5 * prev:
            # whole-file deletion: the file does not exist after this landing
            whole = subprocess.run(['git', '-C', REPO, 'cat-file', '-e', f"{c['sha']}:{p}"], capture_output=True).returncode != 0
            ev.append({'sha': c['sha'][:8], 'date': c['date'][:10], 'file': p, 'prev_lines': prev, 'deleted': d, 'added': a, 'whole_file': whole})
res = {'range': RNG, 'landings': len(lands), 'events': len(ev), 'whole_file': sum(e['whole_file'] for e in ev),
       'in_place': sum(not e['whole_file'] for e in ev),
       'repeats_in_place': {f: n for f, n in Counter(e['file'] for e in ev if not e['whole_file']).items() if n > 1}, 'list': ev}
json.dump(res, open(OUT, 'w'), indent=1)
print({k: v for k, v in res.items() if k != 'list'})
