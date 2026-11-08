#!/usr/bin/env python3
"""LIN-4394 run 5 extra measures (LV + SD): prompt-contract landing share, review evidence weight, SD windows.
Usage: python3 measure_extra.py <LV repo> <SD repo> <out.json>
All git reads are against committed objects; LV pin 9574d537, SD pin 5d8489e7 (see README)."""
import json, subprocess, sys
from collections import Counter
LV, SD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LV_PIN = '9574d5371cd78a4ce0ab98bc5278706eb4e1bc6f'
SD_PIN = '5d8489e7fd8434f0e69af7df11a3746790abbe64'
LV_RUN3, LV_F25, LV_RUN4 = '6be148a8', 'f25aa127', '5334c81a'
SD_RUN3, SD_RUN4 = 'bb1da78', '67ff5c3b'  # SD run-3 base, SD run-4 pin
PROMPT_SET = ['lib/prompt-template-defs.js', 'scripts/prompt-template-change-log.md', 'lib/proxy-instructions.js',
              'lib/proxy-preamble.js', 'docs/proxy-integration.md', 'lib/prompts/', 'lib/prompt-formatters.js',
              'lib/prompt-templates.js', 'tests/unit/prompt-size-budget.test.js']

def git(repo, *a):
    return subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True, check=True).stdout

def landings(repo, rng):
    out = git(repo, 'log', '--first-parent', '-m', '--numstat', '--no-renames', '--format=@@C@@%H|%cI|%s', rng)
    res, cur = [], None
    for line in out.splitlines():
        if line.startswith('@@C@@'):
            s, d, subj = line[5:].split('|', 2)
            cur = {'sha': s, 'date': d, 'subject': subj, 'files': []}; res.append(cur)
        elif line.strip() and cur is not None:
            a, dl, p = line.split('\t', 2)
            cur['files'].append((0 if a == '-' else int(a), 0 if dl == '-' else int(dl), p))
    return res

def touches_set(lands, pred):
    return [c for c in lands if any(pred(p) for _, _, p in c['files'])]

pr = lambda p: any(p == x or (x.endswith('/') and p.startswith(x)) for x in PROMPT_SET)
res = {'pins': {'LV': LV_PIN, 'SD': SD_PIN}, 'prompt_contract': {}, 'review_weight': {}, 'sd': {}}

windows = {'run3 6be148a8..f25aa127': (LV, f'{LV_RUN3}..{LV_F25}'),
           'run4 f25aa127..5334c81a': (LV, f'{LV_F25}..{LV_RUN4}'),
           'run5 delta 5334c81a..pin': (LV, f'{LV_RUN4}..{LV_PIN}'),
           'run5 rolling f25aa127..pin': (LV, f'{LV_F25}..{LV_PIN}')}
for name, (repo, rng) in windows.items():
    ls = landings(repo, rng)
    hit = touches_set(ls, pr)
    res['prompt_contract'][name] = {'landings': len(ls), 'touching': len(hit),
                                    'share': round(len(hit) / len(ls), 3) if ls else None,
                                    'added_lines': sum(a for c in hit for a, _, p in c['files'] if pr(p))}

# Review evidence weight: lines added under docs/reviews per review-touching landing; blob bytes at each pin
rv = lambda p: p.startswith('docs/reviews/')
for name, (repo, rng) in windows.items():
    ls = landings(repo, rng)
    hit = touches_set(ls, rv)
    res['review_weight'][name] = {'landings': len(ls), 'review_landings': len(hit),
        'review_added_lines': sum(a for c in hit for a, _, p in c['files'] if rv(p)),
        'review_added_per_landing': round(sum(a for c in hit for a, _, p in c['files'] if rv(p)) / len(hit)) if hit else None}

def blob_bytes(repo, rev, prefix):
    out = git(repo, 'ls-tree', '-r', '-l', rev, '--', prefix)
    total, n = 0, 0
    for line in out.splitlines():
        meta, _ = line.split('\t', 1)
        parts = meta.split()
        if parts[1] == 'blob' and parts[3] != '-':
            total += int(parts[3]); n += 1
    return total, n
res['review_weight']['blob_bytes_docs_reviews'] = {}
for label, rev in [('f25aa127', LV_F25), ('5334c81a', LV_RUN4), ('pin', LV_PIN)]:
    b, n = blob_bytes(LV, rev, 'docs/reviews/')
    tb, tn = blob_bytes(LV, rev, '.')
    res['review_weight']['blob_bytes_docs_reviews'][label] = {'review_bytes': b, 'review_files': n,
                                                             'repo_blob_bytes': tb, 'share_of_repo': round(b / tb, 3)}

# SD windows
sd_w = {'run3 bb1da78..67ff5c3b': (SD, f'bb1da78..{SD_RUN4}'), 'run4 67ff5c3b..pin': (SD, f'{SD_RUN4}..{SD_PIN}'),
        'rolling bb1da78..pin': (SD, f'bb1da78..{SD_PIN}')}
for name, (repo, rng) in sd_w.items():
    ls = landings(repo, rng)
    days = Counter(c['date'][:10] for c in ls)
    tests = sum(a for c in ls for a, _, p in c['files'] if '/test/' in '/' + p or p.startswith('test/'))
    srcadd = sum(a for c in ls for a, _, p in c['files'] if p.startswith(('lib/', 'routes/', 'public/')) or p in ('dispatcher.js', 'server.js', 'config.js', 'reapers.js', 'hook.js'))
    res['sd'][name] = {'landings': len(ls), 'by_day': dict(sorted(days.items())), 'test_added': tests, 'src_added_approx': srcadd}

json.dump(res, open(OUT, 'w'), indent=1)
print(json.dumps(res, indent=1))
