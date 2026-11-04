#!/usr/bin/env python3
"""LIN-4206 stability review run 4: LinearViewer (LV) measurements.

Usage:  python3 measure_lv.py <path-to-LV-repo> <out-dir>
Writes JSON + TSV evidence into <out-dir> and prints a short summary.
Method (run-3 method, see docs/reviews/stability-review-2026-10-21.md, Measurement decisions):
  * landings = first-parent commits (git log --first-parent -m --numstat --no-renames)
  * excluded paths: docs/reviews/**, *_evidence-*/**, docs/papers/**, tests/screenshots/**,
    tests/fixtures/**, scripts/eval/**, package-lock.json
  * tests and scripts bucketed separately; experiments/ is the research bucket
  * ISO weeks by committer date
"""
import json
import os
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime

REPO, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

BASE_RUN3 = '6be148a8'   # run-3 (10-12 report) HEAD
RUN3_END = 'f25aa127'    # run-4 window base == run-3 report's end (10-21)
HEAD = '5334c81a7207b9f2cc85ca429a2c6b18e1635c0e'  # pinned LV origin/main at mint


def git(*args):
    return subprocess.run(['git', '-C', REPO, *args], capture_output=True, text=True,
                          check=True).stdout


def bucket(path):
    if (path.startswith('docs/reviews/') or '_evidence-' in path or path.startswith('docs/papers/')
            or path.startswith('tests/screenshots/') or path.startswith('tests/fixtures/')
            or path.startswith('scripts/eval/') or path == 'package-lock.json'):
        return 'excluded'
    if path.startswith('experiments/'):
        return 'research'
    if path.startswith('tests/'):
        return 'tests'
    if path.startswith('scripts/'):
        return 'scripts'
    if path.startswith('docs/'):
        return 'docs'
    if path.startswith('.github/'):
        return 'ci-config'
    return 'src'


def landings(rev_range=None, since=None, until=None):
    """First-parent landings in a rev range or committer-date window, with numstat rows."""
    fmt = '@@C@@%H|%cI|%s'
    args = ['log', '--first-parent', '-m', '--numstat', '--no-renames', f'--format={fmt}']
    if rev_range:
        args.append(rev_range)
    if since:
        args.append(f'--since={since}')
    if until:
        args.append(f'--until={until}')
    out = git(*args)
    res, cur = [], None
    for line in out.splitlines():
        if line.startswith('@@C@@'):
            sha, cI, subj = line[5:].split('|', 2)
            cur = {'sha': sha, 'date': cI, 'subject': subj, 'files': []}
            res.append(cur)
        elif line.strip() and cur is not None:
            a, d, p = line.split('\t', 2)
            cur['files'].append((int(a) if a != '-' else 0, int(d) if d != '-' else 0, p))
    return res


def iso_week(cI):
    d = datetime.fromisoformat(cI)
    y, w, _ = d.isocalendar()
    return f'{y}-W{w:02d}'


report = {}

# 1. Reproduction of run-3 method: weekly landing counts over the full first-parent history
all_l = landings(f'{RUN3_END}')  # first-parent history reaching the run-3 end
weeks = Counter(iso_week(c['date']) for c in all_l)
report['repro_weeks'] = {k: weeks[k] for k in ['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44', '2026-W45']}

# 2. Window counts
run3_win = landings(f'{BASE_RUN3}..{RUN3_END}')
win = landings(f'{RUN3_END}..HEAD')
report['run3_window_6be148a8_f25aa127'] = len(run3_win)
report['window_f25aa127_HEAD_landings'] = len(win)
report['window_commits_all'] = int(git('rev-list', '--count', f'{RUN3_END}..HEAD').strip())
report['window_first_date'] = win[-1]['date']
report['window_last_date'] = win[0]['date']
daily = Counter(c['date'][:10] for c in win)
report['daily_landings'] = dict(sorted(daily.items()))
report['weekly_window'] = dict(sorted(Counter(iso_week(c['date']) for c in win).items()))

# 3. Bucket line counts (added / deleted), per window
def bucket_totals(lands):
    tot = defaultdict(lambda: [0, 0, 0])  # added, deleted, files touched
    seen = defaultdict(set)
    for c in lands:
        for a, d, p in c['files']:
            b = bucket(p)
            tot[b][0] += a
            tot[b][1] += d
            seen[b].add(p)
    return {b: {'added': v[0], 'deleted': v[1], 'files': len(seen[b])} for b, v in tot.items()}

report['buckets_window'] = bucket_totals(win)
report['buckets_run3_corrected'] = bucket_totals(run3_win)
prior30 = landings(since='2026-09-12', until='2026-10-12')  # 10-12 report's prior-30 window
report['buckets_prior30_09-12..10-12'] = bucket_totals(prior30)

# 4. Hot files: touches (landings) per src/scripts/tests file in window
touch = Counter()
for c in win:
    for a, d, p in c['files']:
        if bucket(p) in ('src', 'scripts'):
            touch[p] += 1
hot = [(p, n) for p, n in touch.most_common() if n >= 6]
hot_rows = []
for p, n in hot:
    try:
        lines = len(git('show', f'{HEAD}:{p}').splitlines())
    except subprocess.CalledProcessError:
        lines = None
    try:
        lines_f = len(git('show', f'{RUN3_END}:{p}').splitlines())
    except subprocess.CalledProcessError:
        lines_f = None
    hot_rows.append({'file': p, 'touches': n, 'lines_at_f25aa127': lines_f, 'lines_at_HEAD': lines})
report['hot_src_scripts_ge6'] = hot_rows

# 5. Rewrite-in-place events: a landing deleting >= 50% of the file's prior size (src/scripts)
rewrites = []
for c in win:
    for a, d, p in c['files']:
        if bucket(p) not in ('src', 'scripts') or d == 0:
            continue
        try:
            prev = len(git('show', f"{c['sha']}^1:{p}").splitlines())
        except subprocess.CalledProcessError:
            continue  # file created by this landing
        if prev and d >= 0.5 * prev:
            rewrites.append({'sha': c['sha'][:8], 'date': c['date'][:10], 'file': p,
                             'added': a, 'deleted': d, 'prev_lines': prev, 'subject': c['subject'][:90]})
rw_files = Counter(r['file'] for r in rewrites)
report['rewrite_events'] = rewrites
report['rewrite_files_with_repeats'] = {f: n for f, n in rw_files.items() if n > 1}

# 6. Short-lived src files: absent at f25aa127, created inside the window, deleted inside the window
def exists_at(rev, path):
    return subprocess.run(['git', '-C', REPO, 'cat-file', '-e', f'{rev}:{path}'],
                          capture_output=True).returncode == 0
created_in = {}
for c in win[::-1]:  # oldest first
    for a, d, p in c['files']:
        if bucket(p) == 'src' and p not in created_in and not exists_at(RUN3_END, p) and a > 0:
            created_in[p] = c['date'][:10]
deleted_in = {}
for p in created_in:
    if not exists_at(HEAD, p):
        out = git('log', '--first-parent', '--format=%cI', f'{RUN3_END}..HEAD', '--', p).strip().splitlines()
        deleted_in[p] = out[0][:10] if out else None  # most recent touch, a proxy for the deletion date
report['short_lived_src'] = {p: {'created': created_in[p], 'last_touch': deleted_in[p]} for p in deleted_in}

# 7. Stagnation: src files with >=4 first-parent landings in 04-01..06-25, present at f25aa127, silent since 08-12
stag_cnt = Counter()
for c in landings(since='2026-04-01', until='2026-06-26'):
    for a, d, p in c['files']:
        if bucket(p) == 'src':
            stag_cnt[p] += 1
cands = [p for p, n in stag_cnt.items() if n >= 4]
present = []
for p in cands:
    r = subprocess.run(['git', '-C', REPO, 'cat-file', '-e', f'{RUN3_END}:{p}'], capture_output=True)
    if r.returncode == 0:
        present.append(p)
silent = []
silent_at_base = []
for p in present:
    out = git('log', '--first-parent', '--since=2026-08-12', '--format=%H', f'{HEAD}', '--', p).strip()
    if not out:
        silent.append(p)
    out_b = git('log', '--first-parent', '--since=2026-08-12', '--format=%H', f'{RUN3_END}', '--', p).strip()
    if not out_b:
        silent_at_base.append(p)
report['stagnation'] = {'candidates_ge4_0401_0625': len(cands), 'present_at_f25aa127': len(present),
                        'silent_since_0812_at_HEAD': sorted(silent),
                        'silent_since_0812_at_f25aa127': len(silent_at_base)}

# 8. docs/reviews touch rate (run-3 definition: any landing touching docs/reviews/)
rv = [c for c in win if any(p.startswith('docs/reviews/') for _, _, p in c['files'])]
rv3 = [c for c in run3_win if any(p.startswith('docs/reviews/') for _, _, p in c['files'])]
rv_p30 = [c for c in prior30 if any(p.startswith('docs/reviews/') for _, _, p in c['files'])]
report['review_layer'] = {
    'prior30_touching': len(rv_p30), 'run3_window_touching': len(rv3), 'window_touching': len(rv),
    'window_weekly': dict(sorted(Counter(iso_week(c['date']) for c in rv).items())),
    'window_day_counts': dict(sorted(Counter(c['date'][:10] for c in rv).items())),
    'window_reviews_lines_added': sum(a for c in rv for a, _, p in c['files'] if p.startswith('docs/reviews/')),
}

# 9. Dump the full landing list (LV) for the evidence
with open(os.path.join(OUT, 'lv-window-landings.tsv'), 'w') as f:
    f.write('sha\tcommitter_date\tsubject\n')
    for c in win:
        f.write(f"{c['sha']}\t{c['date']}\t{c['subject']}\n")

with open(os.path.join(OUT, 'lv-measure.json'), 'w') as f:
    json.dump(report, f, indent=1, default=str)

print(json.dumps({k: report[k] for k in [
    'repro_weeks', 'run3_window_6be148a8_f25aa127', 'window_f25aa127_HEAD_landings',
    'window_commits_all', 'daily_landings', 'weekly_window']}, indent=1))
print('buckets_window', json.dumps(report['buckets_window']))
print('buckets_run3_corrected', json.dumps(report['buckets_run3_corrected']))
print('buckets_prior30', json.dumps(report['buckets_prior30_09-12..10-12']))
print('hot count', len(hot_rows))
print('rewrite events', len(rewrites), 'repeats', report['rewrite_files_with_repeats'])
print('short_lived', report['short_lived_src'])
print('stagnation', {k: (v if not isinstance(v, list) else len(v)) for k, v in report['stagnation'].items()})
print('review_layer', {k: v for k, v in report['review_layer'].items() if not isinstance(v, dict)})
