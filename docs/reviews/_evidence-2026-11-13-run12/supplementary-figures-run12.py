#!/usr/bin/env python3
"""Supplementary figures for Seams & Tangles run 12 (LIN-4444).

Reads the evidence files in this folder (seams, cochange, edge dumps, registries) and committed git objects.
Prints the figures the report quotes. Facts only; nothing here is a threshold or a gate.
Run from the LinearViewer repo root, with the simple-dispatcher clone (for its commits) given as SD_DIR:
    SD_DIR=<simple-dispatcher clone> python3 -I docs/reviews/_evidence-2026-11-13-run12/supplementary-figures-run12.py .
"""
import json, os, re, subprocess, sys
from collections import Counter

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
EV = os.path.join(REPO, 'docs/reviews/_evidence-2026-11-13-run12')
H = 'e2d4659c4bf07ed266735f718e85232e5f2a6458'   # HEAD measured (origin/main 13 Nov)
B = 'b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754'   # run 11's measured commit
SDB, SDH = '5d8489e7fd8434f0e69af7df11a3746790abbe64', 'af9b496d57f042972b912a30eb8c4d1164bbab77'
RUNS, LLM, OTHER, PAGES, AGENT, PROV, PLAT, WEB, WIRE, REP, AUTH, BROWSER, TASK = (
    'Runs & dispatch', 'LLM & prompts', 'Other features', 'Front end: server-rendered pages', 'Agent API (proxy)',
    'Providers (Linear, GitHub, Jira, local)', 'Platform & plumbing', 'Web routes (pages & workspace API)',
    'Wiring (server.js)', 'Reports & operator tools', 'Auth, accounts & workspaces', 'Front end: browser code', 'Task model')


def J(name):
    return json.load(open(os.path.join(EV, name)))


def git(*args, cwd=REPO):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True).stdout


def sec(t):
    print(f'\n## {t}')


registry = J('areas.head-registry.json')['areas']


def area_of(path):
    for a in registry:
        for p in a['match']:
            if re.search(p, path):
                return a['name']
    return None


seams = {'H': J(f'seams-code-{H}-guide-head.json'), 'B': J(f'seams-code-{B}-guide-head.json'),
         'B11': J(f'seams-code-{B}-guide-run11.json')}
edges = {'H': J(f'edges-code-{H}-guide-head.json')['edgeList'], 'B': J(f'edges-code-{B}-guide-head.json')['edgeList']}

sec('S1. Scope and could-not-read counts')
for k, d in seams.items():
    s = d['scope']
    print(f"{k:4s} {d['commit'][:9]} files {s['files']} parseFailures {len(s['parseFailures'])} "
          f"unresolvedRelative {s['unresolvedRelativeImports']} nonLiteralDynamic {s['nonLiteralDynamicImports']} "
          f"unmapped {len(s['unmappedFiles'])} registry {d['areaMapSource'].split('/')[-1]}")
print('window (B..H, first-parent):', git('rev-list', '--count', '--first-parent', f'{B}..{H}').strip(), 'commits;',
      git('diff', '--shortstat', B, H, '--', 'lib', 'routes', 'public', 'server.js').strip())

sec('S2. Guide-only check: run 11 commit with its own registry vs with the HEAD registry')
same = all(seams['B'][k] == seams['B11'][k] for k in ('links', 'knots', 'areas'))
print('links, knots, areas identical:', same, '| only areaMapSource differs:',
      {k: seams['B'][k] for k in seams['B'] if k not in ('areaMapSource',)} == {k: seams['B11'][k] for k in seams['B11'] if k != 'areaMapSource'})

sec('S3. Reciprocal pairs (a->b / b->a), H vs B, same HEAD registry')
pr = lambda d: {tuple(sorted([p['a'], p['b']])): (p['aToB'], p['bToA'], p['a'], p['b']) for p in d['knots']['pairs']}
ph, pb = pr(seams['H']), pr(seams['B'])
print('pair set identical:', set(ph) == set(pb), '| count', len(ph))
for k in sorted(ph):
    a2b, b2a, a, b = ph[k]
    ob = pb[k]
    flag = '' if (a2b, b2a) == ob[:2] else f'  (B: {ob[0]}/{ob[1]})'
    print(f'  {a[:24]:24s} <-> {b[:24]:24s} {a2b:3d}/{b2a:<3d}{flag}')
print('cycle groups H:', [len(g) for g in seams['H']['knots']['groups']], 'B:', [len(g) for g in seams['B']['knots']['groups']])

sec('S4. File-level edge diff B -> H (edge dump, same registry)')
eh = {(e['from'], e['to']): e for e in edges['H']}
eb = {(e['from'], e['to']): e for e in edges['B']}
added = sorted(set(eh) - set(eb)); removed = sorted(set(eb) - set(eh))
print('edges', len(eb), '->', len(eh), 'added', len(added), 'removed', len(removed))
with open(os.path.join(EV, 'edge-diff-B-to-H.txt'), 'w') as f:
    for k in added:
        e = eh[k]; f.write(f"+ {k[0]} -> {k[1]} | {e['fromArea']} -> {e['toArea']}\n")
    for k in removed:
        e = eb[k]; f.write(f"- {k[0]} -> {k[1]} | {e['fromArea']} -> {e['toArea']}\n")
print('listing: edge-diff-B-to-H.txt')
def dirn(e_list, a, b):
    return sum(1 for e in e_list if e['fromArea'].startswith(a) and e['toArea'].startswith(b))
for a, b in [(LLM, RUNS), (RUNS, LLM), (AGENT, LLM), (AGENT, RUNS), (RUNS, AGENT), (PAGES, RUNS), (PAGES, OTHER),
             (LLM, PROV), (PROV, LLM), (AUTH, LLM), (OTHER, RUNS)]:
    print(f'  {a[:20]:20s} -> {b[:20]:20s} B {dirn(edges["B"], a, b):3d}  H {dirn(edges["H"], a, b):3d}')
grp = lambda es: Counter(e['fromArea'] for e in es)
print('LLM -> Runs edges added:', [f"{e['from']} -> {e['to']}" for k in added for e in [eh[k]]
                                  if e['fromArea'].startswith(LLM) and e['toArea'].startswith(RUNS)])
print('Runs -> LLM edges added:', [f"{e['from']} -> {e['to']}" for k in added for e in [eh[k]]
                                  if e['fromArea'].startswith(RUNS) and e['toArea'].startswith(LLM)])
print('Runs -> LLM edges removed:', [f"{e['from']} -> {e['to']}" for k in removed for e in [eb[k]]
                                     if e['fromArea'].startswith(RUNS) and e['toArea'].startswith(LLM)])

sec('S5. Hubs and doors: importers (in) / cross-area in / outbound / cross-area out / lines, B -> H')
def degrees(es):
    inn, inx, out, outx = Counter(), Counter(), Counter(), Counter()
    for e in es:
        inn[e['to']] += 1; out[e['from']] += 1
        if e['fromArea'] != e['toArea']:
            inx[e['to']] += 1; outx[e['from']] += 1
    return inn, inx, out, outx
dh, db = degrees(edges['H']), degrees(edges['B'])
def lines(c, f):
    t = subprocess.run(['git', 'show', f'{c}:{f}'], cwd=REPO, capture_output=True, text=True).stdout
    return t.count('\n') if t else None
hubs = ['lib/run-ledger.js', 'lib/openrouter.js', 'lib/workspace-preferences.js', 'lib/dispatch-factory.js',
        'lib/dispatch-store.js', 'lib/periodicals.js', 'lib/task-page-loader.js', 'lib/run-controls.js',
        'lib/cost-read.js', 'lib/tree.js', 'lib/as-asked.js', 'lib/recommendation-look-first.js',
        'lib/recommendation-blind-read.js', 'lib/recommendation-live-wait.js', 'lib/recent-runs.js',
        'lib/run-view.js', 'lib/prompt-template-defs.js', 'lib/proxy-preamble.js', 'lib/providers/state-map.js',
        'lib/task-timeline.js', 'lib/render-task-timeline.js', 'lib/task-cost-read.js', 'lib/session-roles.js',
        'lib/dispatch-leftover-answer.js', 'lib/recommendation-facts.js', 'lib/chat-tools.js',
        'lib/dispatch-entrance.js', 'routes/proxy-writes.js', 'routes/proxy-compute.js', 'server.js']
print('file | in/crossIn/out/crossOut (B) | (H) | lines B -> H')
for f in hubs:
    b = f"{db[0][f]}/{db[1][f]}/{db[2][f]}/{db[3][f]}"; h = f"{dh[0][f]}/{dh[1][f]}/{dh[2][f]}/{dh[3][f]}"
    print(f'{f:36s} {b:12s} {h:12s} {lines(B, f)} -> {lines(H, f)}')

sec('S6. Catch-all (Other features) and the ten new production files')
def cross_files(es):
    areaof, cross = {}, set()
    for e in es:
        areaof[e['from']] = e['fromArea']; areaof[e['to']] = e['toArea']
        if e['fromArea'] != e['toArea']:
            cross.add(e['from']); cross.add(e['to'])
    return sorted(f for f in cross if areaof.get(f) == OTHER)
print('N1 Other-features files with a cross-area edge: B', len(cross_files(edges['B'])), 'H', len(cross_files(edges['H'])),
      '| same set:', cross_files(edges['B']) == cross_files(edges['H']))
new = [l.rstrip('\n').split('\t')[1] for l in open(os.path.join(EV, 'prod-files-since-run11.txt')) if l.startswith('A\t')]
for f in new:
    print(f'  new {f:40s} -> {area_of(f)}')

sec('S7. Wrong-way and direction checks (H)')
eH = edges['H']
print('lib -> routes edges:', sum(1 for e in eH if e['from'].startswith('lib/') and e['to'].startswith('routes/')))
print('edges into server.js:', sum(1 for e in eH if e['to'] == 'server.js'))
print('non-Pages files importing lib/render-*.js (B, H):',
      sum(1 for e in edges['B'] if re.match(r'lib/render-', e['to']) and e['fromArea'] not in (PAGES, WEB, AUTH, REP, PAGES)),
      sum(1 for e in eH if re.match(r'lib/render-', e['to']) and e['fromArea'] not in (PAGES, WEB, AUTH, REP, PAGES)))
for e in eH:
    if re.match(r'lib/render-', e['to']) and e['fromArea'] in (RUNS, OTHER, LLM, PROV) :
        print('   renderer import from', e['fromArea'], ':', e['from'], '->', e['to'])
print('Runs modules importing a renderer (carried, LIN-4154 family):',
      [f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == RUNS and re.match(r'lib/render-', e['to'])])
print('render-task-timeline.js outbound edges (a renderer importing run logic is the right way round):',
      [f"{e['from']} -> {e['to']}" for e in eH if e['from'] == 'lib/render-task-timeline.js'])

sec('S8. Reports scripts outside the import tool scope that import lib/ (the tool reads server.js, lib, routes, public)')
for f in ['scripts/code-shape/retention.mjs', 'scripts/code-shape/retention-core.mjs', 'scripts/stability-measures.mjs',
          'scripts/stability-measures-core.mjs', 'scripts/stability-measures-tracker.mjs',
          'scripts/stability-measures-blind.mjs', 'scripts/stability-measures-seat.mjs']:
    src = git('show', f'{H}:{f}')
    libs = re.findall(r"from\s+'(\.\./lib/[^']+)'", src)
    print(f'  {f:50s} lib imports: {libs}')

sec('S9. Co-change, 60 days, the same registry (HEAD) for both commits')
cb, ch = J(f'cochange-code-{B}-guide-head-days60.json'), J(f'cochange-code-{H}-guide-head-days60.json')
cb11 = J(f'cochange-code-{B}-guide-run11-days60.json')
print('B:', cb['changes'], cb['changesTouchingMultipleAreas'], len(cb['pairs']), cb['unmappedFiles'], 'shallow', cb['shallow'])
print('H:', ch['changes'], ch['changesTouchingMultipleAreas'], len(ch['pairs']), ch['unmappedFiles'], 'shallow', ch['shallow'])
print('B under run-11 registry:', cb11['changes'], cb11['changesTouchingMultipleAreas'], len(cb11['pairs']), cb11['unmappedFiles'])
pc = lambda c: {tuple(sorted(p['areas'])): p['changes'] for p in c['pairs']}
cbp, chp, cb11p = pc(cb), pc(ch), pc(cb11)
print('pairs moved by the guide edit alone (B under run-11 registry vs under HEAD registry):')
for k in sorted(cbp):
    if cb11p.get(k) != cbp[k]:
        print(f'  {k[0][:24]} <-> {k[1][:24]}: {cb11p.get(k)} -> {cbp[k]}')
print('pairs B -> H (HEAD registry, same 60-day length):')
for k in sorted(set(cbp) | set(chp), key=lambda k: -max(cbp.get(k, 0), chp.get(k, 0))):
    if cbp.get(k) != chp.get(k):
        print(f'  {k[0][:24]} <-> {k[1][:24]}: {cbp.get(k, 0)} -> {chp.get(k, 0)}')

sec('S10. Window reconciliation of co-change pairs (commits in each 60-day window)')
def window_commits(sha, days=60):
    end = int(git('show', '-s', '--format=%ct', sha).strip()); start = end - days * 86400
    out = git('log', sha, '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%H %ct')
    commits, cur = {}, None
    for line in out.split('\n'):
        if line.startswith('@'):
            h, ct = line[1:].split(); cur = h; commits[h] = {'ct': int(ct), 'files': []}
        elif line.strip() and cur:
            commits[cur]['files'].append(line.strip())
    return {h: v for h, v in commits.items() if start <= v['ct'] <= end}
wb, wh = window_commits(B), window_commits(H)
bonly, honly = set(wb) - set(wh), set(wh) - set(wb)
print('B window', len(wb), 'H window', len(wh), 'shared', len(set(wb) & set(wh)), 'B-only', len(bonly), 'H-only', len(honly))
def pairs_of(hs, src):
    c = Counter()
    for h in hs:
        a = sorted({area_of(f) for f in src[h]['files'] if area_of(f)})
        for i in range(len(a)):
            for j in range(i + 1, len(a)):
                c[(a[i], a[j])] += 1
    return c
po, pn = pairs_of(bonly, wb), pairs_of(honly, wh)
for k in [(BROWSER, PAGES), (AGENT, RUNS), (LLM, RUNS), (BROWSER, WEB), (WEB, RUNS)]:
    kk = tuple(sorted(k))
    print(f'  {k[0][:22]} <-> {k[1][:22]}: B {cbp.get(kk, 0)} - B-only {po[kk]} + H-only {pn[kk]} = {cbp.get(kk, 0) - po[kk] + pn[kk]} (H reads {chp.get(kk, 0)})')

sec('S11. Carried measures re-read at HEAD')
print('F6 window.X = assignments in public/: B 67, H 67 (grep -oE "window\\.[A-Za-z_$][A-Za-z0-9_$]* ?=[^=]")')
print('route -> route edges (F5): B', sum(1 for e in edges['B'] if e['from'].startswith('routes/') and e['to'].startswith('routes/')),
      'H', sum(1 for e in eH if e['from'].startswith('routes/') and e['to'].startswith('routes/')))
print('route -> route cross-area: B', sum(1 for e in edges['B'] if e['from'].startswith('routes/') and e['to'].startswith('routes/') and e['fromArea'] != e['toArea']),
      'H', sum(1 for e in eH if e['from'].startswith('routes/') and e['to'].startswith('routes/') and e['fromArea'] != e['toArea']))
print('unresolved relative imports: B', seams['B']['scope']['unresolvedRelativeImports'], 'H', seams['H']['scope']['unresolvedRelativeImports'])

sec('S12. simple-dispatcher (scratch reader; seams.mjs reads 0 CommonJS files)')
for tag in ['5d8489e', 'af9b496']:
    d = J(f'require-graph-sd-{tag}.json')
    n = lambda v: v if isinstance(v, int) else len(v)
    print(tag, 'files', n(d['scope']['files']), 'unmapped', n(d['scope']['unmappedFiles']), 'unresolved', n(d['scope']['unresolvedRelative']),
          'nonLiteral', n(d['scope']['nonLiteralRequires']), 'fileEdges', n(d['fileEdges']), 'areaLinks', n(d['areaLinks']),
          'reciprocal', n(d['reciprocalPairs']))
a, b = J('require-graph-sd-5d8489e.json'), J('require-graph-sd-af9b496.json')
print('reader output identical across the window (areaLinks, fileEdges, pairs):',
      a['areaLinks'] == b['areaLinks'] and a['fileEdges'] == b['fileEdges'] and a['reciprocalPairs'] == b['reciprocalPairs'])
for tag in ['5d8489e', 'af9b496']:
    d = J(f'cochange-sd-{tag}-guide-sd-days60.json') if os.path.exists(os.path.join(EV, f'cochange-sd-{tag}-guide-sd-days60.json')) else None
    if d:
        print('cochange', tag, d['changes'], d['changesTouchingMultipleAreas'], len(d['pairs']), d['unmappedFiles'])
