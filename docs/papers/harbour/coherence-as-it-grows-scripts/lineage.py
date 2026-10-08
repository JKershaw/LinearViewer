#!/usr/bin/env python3 -I
r"""
lineage.py — build the lineage of four copy-pasted decisions in the Harbour repo.

Usage:
  python3 -I lineage.py --repo /home/user/LinearViewer --ground d61903f3 \
      --out data/lineage \
      --defects data/tracker-full-defects.json \
      --sendbacks data/tracker-full-sendbacks.json \
      --tracker data/tracker-merged.json

Read-only against the repository (git grep / git diff on tree objects; no checkout).
Walks the first-parent history of --ground, oldest first, and for every commit runs one
`git grep -nE` with the four patterns combined, classifying hits per decision:

  D1 tolerant-timestamp-parse : ^\s*function (toMillis|toMs|_epoch)\(   in server.js lib/ routes/ public/ (minus *.min.js)
  D2 page-shell-option-bag    : deployInfo: getDeployInfo\(\)              in routes/ only (server.js sites counted separately)
  D3 hand-rolled-ws-lookup    : urlKey === urlKey                         in lib/ routes/ server.js, minus comment lines and
                                                                           the canonical helper body (lib/workspace.js getWorkspaceByUrlKey)
  D4 inline-error-envelope    : res\.status\([45][0-9][0-9]\) AND \.json( on the same line, in routes/*.js + server.js, minus routes/test.js

Events: birth / site (per-file count increase) / move (file moved, total unchanged) / touch
(a merge since --touch-since whose diff hunks land within ±15 lines of an existing site in the
parent) / fix (defect row naming it) / complaint (send-back or tracker ticket naming it) /
helper (shared-helper commits, hand-listed below from `git log -S`).
Outputs lineage.json, lineage.md, snapshots.json (per-commit counts) in --out.
"""
import argparse, json, re, subprocess, sys, os, collections, datetime

DECISIONS = ['D1', 'D2', 'D3', 'D4']
NAMES = {
  'D1': 'Tolerant timestamp parse',
  'D2': 'Page-shell option bag (deployInfo: getDeployInfo())',
  'D3': 'Hand-rolled workspace lookup (urlKey === urlKey)',
  'D4': 'Inline error envelope (res.status(4xx|5xx).json)',
}
GREP_RE = r'function (toMillis|toMs|_epoch)\(|deployInfo: getDeployInfo\(\)|urlKey === urlKey|res\.status\([45][0-9][0-9]\)'
PATHSPEC = ['server.js', 'lib', 'routes', 'public']
TICKET_RE = re.compile(r'LIN-(\d+)', re.I)
PR_RE = re.compile(r'#(\d+)')

def run(args, repo):
  return subprocess.run(['git', '-C', repo] + args, capture_output=True, text=True).stdout

def classify(path, line, text):
  """Return decision id for a grep hit, or None."""
  stripped = text.strip()
  if re.match(r'function (toMillis|toMs|_epoch)\(', stripped):
    if path.endswith('.min.js'): return None
    return 'D1'
  if 'deployInfo: getDeployInfo()' in text:
    return 'D2' if path.startswith('routes/') else 'D2srv'
  if 'urlKey === urlKey' in text:
    if not (path.startswith('lib/') or path.startswith('routes/') or path == 'server.js'): return None
    if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'): return None
    if path == 'lib/workspace.js' and 'session.workspaces.find' in text: return None  # canon body
    return 'D3'
  if re.search(r'res\.status\([45][0-9][0-9]\)', text) and '.json(' in text:
    if path == 'server.js' or re.match(r'^routes/[^/]+\.js$', path):
      if path == 'routes/test.js': return None
      return 'D4'
  return None

def sites_at(sha, repo):
  out = run(['grep', '-nE', GREP_RE, sha, '--'] + PATHSPEC, repo)
  sites = {d: [] for d in DECISIONS + ['D2srv']}
  for row in out.splitlines():
    try:
      _, rest = row.split(':', 1)
      path, ln, text = rest.split(':', 2)
    except ValueError:
      continue
    d = classify(path, int(ln), text)
    if d: sites[d].append((path, int(ln), text.strip()))
  return sites

def hunks(repo, parent, sha, files):
  """old-line ranges changed per file, from git diff -U0 parent..sha."""
  if not files: return {}
  out = run(['diff', '-U0', '-M', parent, sha, '--'] + sorted(files), repo)
  res = collections.defaultdict(list); cur = None
  for row in out.splitlines():
    if row.startswith('--- '):
      cur = row[4:].strip()
      cur = cur[2:] if cur.startswith('a/') else cur
    elif row.startswith('@@'):
      m = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', row)
      a = int(m.group(1)); b = int(m.group(2)) if m.group(2) is not None else 1
      if b == 0: res[cur].append((a, a))
      else: res[cur].append((a, a + b - 1))
  return res

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument('--repo', required=True); ap.add_argument('--ground', required=True)
  ap.add_argument('--out', required=True); ap.add_argument('--defects'); ap.add_argument('--sendbacks'); ap.add_argument('--tracker')
  ap.add_argument('--touch-since', default='2026-06-01'); ap.add_argument('--window', type=int, default=15)
  a = ap.parse_args()
  os.makedirs(a.out, exist_ok=True)
  log = run(['log', '--first-parent', '--reverse', '--format=%H%x09%ad%x09%P%x09%s', '--date=short', a.ground], a.repo)
  commits = []
  for row in log.splitlines():
    sha, date, parents, subj = row.split('\t', 3)
    commits.append(dict(sha=sha, date=date, parent=parents.split()[0] if parents else None, subject=subj))
  events = {d: [] for d in DECISIONS}
  snapshots = []
  prev = {d: collections.Counter() for d in DECISIONS}
  prev_sites = {d: [] for d in DECISIONS}
  prev_total = {d: 0 for d in DECISIONS}
  for i, c in enumerate(commits):
    ticket = (TICKET_RE.search(c['subject']) or [None, None])
    ticket = ('LIN-' + ticket.group(1)) if hasattr(ticket, 'group') else None
    pr = PR_RE.search(c['subject']); pr = int(pr.group(1)) if pr else None
    s = sites_at(c['sha'], a.repo)
    snap = dict(sha=c['sha'][:8], date=c['date'], ticket=ticket, pr=pr)
    for d in DECISIONS:
      cnt = collections.Counter(p for p, _, _ in s[d]); total = sum(cnt.values())
      snap[d] = total
      if d == 'D2': snap['D2srv'] = len(s['D2srv'])
      # spread / birth / move
      if total != prev_total[d] or cnt != prev[d]:
        added = {f: cnt[f] - prev[d][f] for f in cnt if cnt[f] > prev[d][f]}
        removed = {f: prev[d][f] - cnt[f] for f in prev[d] if prev[d][f] > cnt[f]}
        if total > prev_total[d]:
          kind = 'birth' if prev_total[d] == 0 else 'site'
          for f, n in sorted(added.items()):
            events[d].append(dict(kind=kind, date=c['date'], sha=c['sha'][:8], ticket=ticket, pr=pr, file=f,
              note=f'+{n} site(s) in {f}; total {prev_total[d]}→{total}' + (f'; also −{sum(removed.values())} elsewhere ({", ".join(removed)})' if removed else '')))
            kind = 'site'
        elif total < prev_total[d]:
          events[d].append(dict(kind='removal', date=c['date'], sha=c['sha'][:8], ticket=ticket, pr=pr, file=', '.join(sorted(removed)),
            note=f'−{sum(removed.values())} site(s); total {prev_total[d]}→{total}' + (f'; +{sum(added.values())} in {", ".join(added)}' if added else '')))
        elif added or removed:
          events[d].append(dict(kind='move', date=c['date'], sha=c['sha'][:8], ticket=ticket, pr=pr, file=', '.join(sorted(added)),
            note=f'site(s) moved {", ".join(removed)} → {", ".join(added)}; total unchanged at {total}'))
      # touches: merges since --touch-since against the parent's sites
      if c['date'] >= a.touch_since and c['parent'] and prev_sites[d]:
        files = {p for p, _, _ in prev_sites[d]}
        h = hunks(a.repo, c['parent'], c['sha'], files)
        touched = []
        for p, ln, text in prev_sites[d]:
          for (lo, hi) in h.get(p, []):
            if lo <= ln + a.window and hi >= ln - a.window:
              touched.append((p, ln)); break
        if touched:
          nfiles = sorted({p for p, _ in touched})
          events[d].append(dict(kind='touch', date=c['date'], sha=c['sha'][:8], ticket=ticket, pr=pr, file=', '.join(nfiles),
            touched=len(touched), existing=len(prev_sites[d]),
            note=f'touched {len(touched)} of {len(prev_sites[d])} existing site(s) within ±{a.window} lines' + (f'; count {prev_total[d]}→{total}' if total != prev_total[d] else '')))
      prev[d] = cnt; prev_sites[d] = s[d]; prev_total[d] = total
    snapshots.append(snap)
    if i % 200 == 0: print(f'  {i}/{len(commits)} {c["date"]}', file=sys.stderr)
  # ---- fixes and complaints from the tracker caches
  TERMS = {
    'D1': re.compile(r'\btoMillis\b|\b_epoch\b|\btoMs\(|tolerant timestamp|timestamp parse', re.I),
    'D2': re.compile(r'\bdeployInfo\b|getDeployInfo', re.I),
    'D3': re.compile(r'urlKey === urlKey|getWorkspaceByUrlKey|provider-resolution-incantation|workspace lookup|find\(w => w\.urlKey', re.I),
    'D4': re.compile(r'lib/errors\.js|\bjsonError\b|error[- ]envelope|envelope-fragmentation|inline `?res\.status\(4', re.I),
  }
  def scan(text, d):
    m = TERMS[d].search(text or '')
    return m.group(0) if m else None
  if a.defects:
    for row in json.load(open(a.defects)):
      bug = row.get('bug') or {}
      blob = ' '.join([bug.get('title',''), bug.get('description','') or '', row.get('reason','') or ''] + [ (c.get('body') if isinstance(c, dict) else str(c)) or '' for c in (bug.get('comments') or [])])
      for d in DECISIONS:
        term = scan(blob, d)
        if term:
          where = 'title' if scan(bug.get('title',''), d) else ('description' if scan(bug.get('description','') or '', d) else ('reason' if scan(row.get('reason',''), d) else 'comments'))
          events[d].append(dict(kind='fix', date=(bug.get('createdAt') or '')[:10], sha=None, ticket=row.get('identifier'), file=None,
            note=f'defect row ({row.get("verdict")}, found by {row.get("foundBy")}): "{bug.get("title","")[:90]}" — names `{term}` in {where}'))
  if a.sendbacks:
    for sb in json.load(open(a.sendbacks)).get('sendbacks', []):
      for d in DECISIONS:
        term = scan(sb.get('body',''), d)
        if term:
          events[d].append(dict(kind='complaint', date=(sb.get('createdAt') or '')[:10], sha=None, ticket=sb.get('ticket'), file=None,
            note=f'{sb.get("stage")}-review send-back names `{term}`'))
  if a.tracker:
    tk = json.load(open(a.tracker)).get('tickets', {})
    rows = tk.values() if isinstance(tk, dict) else tk
    for r in rows:
      iss = r.get('issue') or r
      title = iss.get('title','') or ''; desc = iss.get('description','') or ''
      for d in DECISIONS:
        term = scan(title, d) or scan(desc, d)
        if term:
          labels = [l if isinstance(l, str) else l.get('name') for l in (iss.get('labels') or [])]
          state = iss.get('state'); state = state.get('name') if isinstance(state, dict) else state
          events[d].append(dict(kind='complaint', date=(iss.get('createdAt') or '')[:10], sha=None, ticket=iss.get('identifier'), file=None,
            note=f'tracker ticket "{title[:90]}" [{state}; {", ".join(l for l in labels if l)}] names `{term}` in {"title" if scan(title, d) else "description"}'))
  # ---- strength: a fix/complaint is 'direct' when its text is about the decision, 'incidental' when it
  # merely cites the canonical file or function while discussing something else (hand-classified from the
  # matched context; see the ±200-char excerpts printed by the exploration commands in lineage.md).
  DIRECT = {'D1': {'LIN-2358'}, 'D2': {'LIN-1385', 'LIN-1388'}, 'D3': set(),
            'D4': {'LIN-417', 'LIN-420', 'LIN-1158', 'LIN-2363', 'LIN-1886', 'LIN-2025', 'LIN-3254'}}
  for d in DECISIONS:
    for e in events[d]:
      if e['kind'] in ('fix', 'complaint'):
        e['strength'] = 'direct' if e.get('ticket') in DIRECT[d] else 'incidental'
  # ---- hand-listed events: helpers (from `git log --first-parent -S'<helper>'`), the Drift & Coherence
  # review editions that track D3/D4 (docs/reviews/drift-coherence-review-*.md), and fix/pin commits.
  REV = 'docs/reviews/drift-coherence-review-%s.md'
  hand = {
    'D1': [],
    'D2': [dict(kind='helper', date='2026-01-18', sha='5a34977d', ticket=None, pr=65, file='server.js', note='getDeployInfo() born in server.js (footer requirements); first `deployInfo: getDeployInfo()` in server.js 2026-02-08 c946d9cf (#145)'),
           dict(kind='helper', date='2026-07-17', sha='a7faf17a', ticket='LIN-1385', pr=940, file='lib/deploy-info.js', note='getDeployInfo() extracted to lib/deploy-info.js (footer blank after Railway migration); call sites untouched'),
           dict(kind='fix', date='2026-08-01', sha='636148ef', ticket='LIN-1388', pr=1044, file='server.js, routes/dashboard.js, lib/render-*.js', strength='direct', note='LIN-1388 fix: reword stale Heroku deployInfo/dyno wording at 5 JSDoc sites (7 files)')],
    'D3': [dict(kind='helper', date='2026-01-20', sha='000531a5', ticket='LIN-100', pr=100, file='lib/workspace.js', note='canonical getWorkspaceByUrlKey(session, urlKey) added — one first-parent commit BEFORE the birth commit 71395df9 the same day'),
           dict(kind='complaint', date='2026-06-10', sha=None, ticket=None, pr=None, file=REV % '2026-06-10', strength='direct', note='review names `provider-resolution-incantation` (Low): "copy-pasted 8× across 6 files"'),
           dict(kind='complaint', date='2026-06-11', sha=None, ticket=None, pr=None, file=REV % '2026-06-11', strength='direct', note='review re-grounds to 5 renderer sites'),
           dict(kind='complaint', date='2026-06-25', sha=None, ticket=None, pr=None, file=REV % '2026-06-25', strength='direct', note='review: improved, 4 renderer sites (foreman retired)'),
           dict(kind='complaint', date='2026-08-29', sha=None, ticket='LIN-2389', pr=None, file=REV % '2026-08-29', strength='direct', note='review: "worsened sharply (4 → 16 sites)"; mints LIN-2389 (change getWorkspaceByUrlKey to accept a workspaces array). LIN-2389 is absent from the tracker cache and no first-parent commit cites it — never landed'),
           dict(kind='complaint', date='2026-09-26', sha=None, ticket='LIN-2389', pr=None, file=REV % '2026-09-26', strength='direct', note='review: worsened 16 → 17; "root cause unchanged: a signature mismatch"; LIN-2389 still the standing fix'),
           dict(kind='helper', date='2026-09-29', sha='b45a390e', ticket='LIN-3124', pr=1610, file='tests/unit/lin-3124-pr1-count-pins.test.js', note='not a helper: a COUNT PIN — `w?.urlKey === urlKey` pinned at expected 16 (the `w`-named form only). Two later sites dodge it: LIN-3186 (lib/superseded-selection.js, variable named `candidate` with a comment saying so) and LIN-3282 (lib/connection-credential.js, `r.urlKey`); pin still reads 16 at ground while the review-pattern count is 19')],
    'D4': [dict(kind='helper', date='2026-01-18', sha='d1222b5c', ticket='LIN-36', pr=55, file='lib/errors.js', note='canonical lib/errors.js (jsonError, badRequest, …) added; 20 inline sites already in server.js'),
           dict(kind='complaint', date='2026-06-10', sha=None, ticket=None, pr=None, file=REV % '2026-06-10', strength='direct', note='review names `routes-error-envelope-fragmentation` (Medium): 239 inline sites, 1 importer'),
           dict(kind='complaint', date='2026-06-11', sha=None, ticket='LIN-420', pr=None, file=REV % '2026-06-11', strength='direct', note='review: 246 inline sites, 2 importers (LIN-417 put the structured envelope in canon); mints LIN-420'),
           dict(kind='helper', date='2026-06-18', sha='8fadcb9b', ticket='LIN-420', pr=505, file='routes/proxy.js, routes/workspace-api.js, routes/dispatch.js', note='adopt lib/errors.js in the big-three routes: 357 → 53 sites (−304), the only sweep'),
           dict(kind='complaint', date='2026-06-25', sha=None, ticket=None, pr=None, file=REV % '2026-06-25', strength='direct', note='review: improved markedly (~53 non-test residue) but "the residue is a new, smaller frontier": dashboard 17, collective 15, task-chat 10, next-run 5, legacy-redirects 4'),
           dict(kind='complaint', date='2026-08-29', sha=None, ticket=None, pr=None, file=REV % '2026-08-29', strength='direct', note='review: 76 residue at 292ac962; dashboard.js a half-adopter (imports jsonError, converted 0 of 17)'),
           dict(kind='complaint', date='2026-09-26', sha=None, ticket=None, pr=None, file=REV % '2026-09-26', strength='direct', note='review: 76 → 87, "+11, all in code written this window"; flight-companion.js a second half-adopter (0 → 8); importer count 14 → 26 is a file-split artifact (LIN-679)')],
  }
  for d in DECISIONS:
    events[d].extend(hand[d])
    events[d].sort(key=lambda e: (e.get('date') or '', e['kind']))
  json.dump(dict(ground=a.ground, generated=datetime.date.today().isoformat(), patterns=PATTERN_DOC,
                 decisions={d: dict(name=NAMES[d], events=events[d]) for d in DECISIONS}),
            open(os.path.join(a.out, 'lineage.json'), 'w'), indent=1)
  json.dump(snapshots, open(os.path.join(a.out, 'snapshots.json'), 'w'))
  # ---- summary table + lineage.md (narratives.md, hand-written, is prepended when present)
  month_end = {}
  for s in snapshots: month_end[s['date'][:7]] = s
  def ends(d):
    return '/'.join(str(month_end[m][d]) if m in month_end else '-' for m in ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  rows = []
  for d in DECISIONS:
    ev = events[d]
    birth = next((e for e in ev if e['kind'] == 'birth'), None)
    touches = [e for e in ev if e['kind'] == 'touch']
    fc = [e for e in ev if e['kind'] in ('fix', 'complaint')]
    direct = sorted({e['ticket'] or ('review ' + e['date']) for e in fc if e.get('strength') == 'direct'})
    inc = len({(e['ticket'], e['date']) for e in fc if e.get('strength') != 'direct'})
    helpers_ = [e for e in ev if e['kind'] == 'helper']
    rows.append((NAMES[d], f"{birth['date']} `{birth['sha']}` {birth['ticket'] or ('#%s' % birth['pr'] if birth['pr'] else 'no PR')} ({birth['file']})" if birth else '-',
                 ends(d) + (f" (server.js: {'/'.join(str(month_end[m]['D2srv']) for m in ['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'])})" if d == 'D2' else ''),
                 str(len(touches)), str(sum(1 for e in touches if e['touched'] == e['existing'])) + (f" (max {max((e['touched'] for e in touches), default=0)}/{next((e['existing'] for e in sorted(touches, key=lambda x: -x['touched'])), 0)})"),
                 f"{len(direct)} direct ({', '.join(direct)}) + {inc} incidental", '; '.join(' '.join(x for x in (e['date'], e['ticket'] or ('#%s' % e['pr'] if e.get('pr') else ''), e['file']) if x) for e in helpers_) or 'none',
                 SITES_DELETED[d]))
  table = ['| decision | birth | sites May/Jun/Jul/Aug/Sep/Oct (month-end; Oct = ground) | PRs that touched a site (since June) | PRs that touched all sites (max touched/existing) | fixes/complaints naming it | helper added | sites deleted after |',
           '|---|---|---|---|---|---|---|---|'] + ['| ' + ' | '.join(r) + ' |' for r in rows]
  md = []
  narr = os.path.join(a.out, 'narratives.md')
  if os.path.exists(narr): md.append(open(narr).read().rstrip() + '\n')
  md.append('\n## Summary table\n\n' + '\n'.join(table) + '\n')
  md.append('\n## Patterns and method\n\n' + PATTERN_DOC + '\n')
  open(os.path.join(a.out, 'lineage.md'), 'w').write('\n'.join(md))
  print('wrote', a.out)

SITES_DELETED = {
  'D1': 'n/a — no helper. 2 sites deleted 2026-10-06 (LIN-3325 removed guest-run/share-run-reader), not a consolidation',
  'D2': '0 — LIN-1385 moved getDeployInfo() to lib/deploy-info.js; all 9 then-existing route sites kept the literal `deployInfo: getDeployInfo()`',
  'D3': '0 — LIN-2389 never landed; the LIN-3124 pin (expected 16) froze the `w`-form only and was dodged twice by renaming the variable (19 at ground)',
  'D4': '304 deleted by LIN-420 (357 → 53 on 2026-06-18); +40 new inline sites written since, in files that mostly import lib/errors.js (dashboard, flight-companion, task-chat)',
}
PATTERN_DOC = '''Patterns (all run as `git grep -nE <re> <sha> -- server.js lib routes public`, classified in `classify()`):

- D1 Tolerant timestamp parse: `^\\s*function (toMillis|toMs|_epoch)\\(` in server.js, lib/, routes/, public/ (public/*.min.js excluded as vendored). Given by the brief.
- D2 Page-shell option bag: `deployInfo: getDeployInfo\\(\\)` in routes/ only (14 at ground). server.js carries the same literal (8 at ground, first 2026-02-08) and is reported separately, not counted. Given by the brief.
- D3 Hand-rolled workspace lookup — derived from the review's own command `grep -rn "urlKey === urlKey" lib/ routes/ server.js`: `urlKey === urlKey` in lib/, routes/, server.js, minus comment lines and minus the canonical helper body (`session.workspaces.find` in lib/workspace.js). Reproduces the review's 16 at 292ac962 and 17 at b5c528c4 exactly. The 06-25 edition's "4" counted only the renderer `getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))` incantation; this pattern gives 9 at d9c51da (navbar 2, render.js 2, render-roadmap 1, server.js 1 extra).
- D4 Inline error envelope — the review's stated command `grep -rnE "res\\.status\\(4[0-9][0-9]\\)|res\\.status\\(5[0-9][0-9]\\)" routes/*.js server.js | grep "\\.json(" | grep -v routes/test.js`: `res\\.status\\([45][0-9][0-9]\\)` and `.json(` on the same line, in routes/*.js (no subdirectories) + server.js, routes/test.js excluded. Reproduces the review's 76 at 292ac962 and 87 at b5c528c4 exactly.

Method: first-parent walk of d61903f3 (1,824 commits, 2026-01-04 → 2026-10-08), one `git grep` per commit; a "site" event is a per-file count increase between consecutive first-parent snapshots (a per-snapshot diff, equivalent to `git log --first-parent -S` but file-attributed); a "touch" is a first-parent commit since 2026-06-01 whose `git diff -U0 parent..commit` hunks overlap ±15 lines of a site that existed in the parent. Tickets come from the merge subject (`LIN-\\d+`); when the subject carries none, the inner commits of the merged branch were read by hand (D1 birth #291 → LIN-299; #958 → LIN-1436). Fixes/complaints: regex scan of results/A/input.json (title, description, reason, comments), results/C/input.json send-back bodies and data/tracker-merged.json (title, description); each match hand-classified direct/incidental from its context. Review-edition rows were read from docs/reviews/drift-coherence-review-*.md.

Reproduce: `python3 -I lineage.py --repo /home/user/LinearViewer --ground d61903f3 --out <this dir> --defects results/A/input.json --sendbacks results/C/input.json --tracker data/tracker-merged.json` (≈3 min; writes lineage.json, snapshots.json, lineage.md = narratives.md + this table).'''

if __name__ == '__main__':
  main()
