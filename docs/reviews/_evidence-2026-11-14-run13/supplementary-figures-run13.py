#!/usr/bin/env python3
"""Supplementary figures for Seams & Tangles run 13 (LIN-4482).

Reads the evidence files in this folder (seams, cochange, edge dumps, registries) and committed git objects.
Prints the figures the report quotes. Facts only; nothing here is a threshold or a gate.
Run from the LinearViewer repo root, with the simple-dispatcher clone given as SD_DIR:
    SD_DIR=<simple-dispatcher clone> python3 -I docs/reviews/_evidence-2026-11-14-run13/supplementary-figures-run13.py .
"""
import json, os, re, subprocess, sys
from collections import Counter

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
EV = os.path.join(REPO, 'docs/reviews/_evidence-2026-11-14-run13')
SD = os.environ.get('SD_DIR')
H = 'fb358dbda7f26ab44b3f58acb15886b21ac20950'   # HEAD measured (origin/main 14 Nov)
B = 'e2d4659c4bf07ed266735f718e85232e5f2a6458'   # run 12's measured commit
SDB, SDH = 'af9b496d57f042972b912a30eb8c4d1164bbab77', '7d5fe7d9473232152365e6837ececcd6f2876987'
RUNS, LLM, OTHER, PAGES, AGENT, PROV, PLAT, WEB, WIRE, REP, AUTH, BROWSER, TASK = (
    'Runs & dispatch', 'LLM & prompts', 'Other features', 'Front end: server-rendered pages', 'Agent API (proxy)',
    'Providers (Linear, GitHub, Jira, local)', 'Platform & plumbing', 'Web routes (pages & workspace API)',
    'Wiring (server.js)', 'Reports & operator tools', 'Auth, accounts & workspaces', 'Front end: browser code', 'Task model')
SHORT = {RUNS: 'Runs', LLM: 'LLM', OTHER: 'Other', PAGES: 'Pages', AGENT: 'Agent API', PROV: 'Providers', PLAT: 'Platform',
         WEB: 'Web', WIRE: 'Wiring', REP: 'Reports', AUTH: 'Auth', BROWSER: 'Browser', TASK: 'Task'}
S = lambda a: SHORT.get(a, a)


def J(name):
    return json.load(open(os.path.join(EV, name)))


def git(*args, cwd=REPO):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True).stdout


def sec(t):
    print(f'\n## {t}')


registry = J('areas.head-registry.json')['areas']


def area_of(path, reg=registry):
    for a in reg:
        for p in a['match']:
            if re.search(p, path):
                return a['name']
    return None


seams = {'H': J(f'seams-code-{H}-guide-head.json'), 'B': J(f'seams-code-{B}-guide-head.json'),
         'B12': J(f'seams-code-{B}-guide-run12.json')}
edges = {'H': J(f'edges-code-{H}-guide-head.json')['edgeList'], 'B': J(f'edges-code-{B}-guide-head.json')['edgeList'],
         'B12': J(f'edges-code-{B}-guide-run12.json')['edgeList']}

sec('S1. Scope and could-not-read counts')
for k, d in seams.items():
    s = d['scope']
    links = sum(l['imports'] for l in d['links'])
    print(f"{k:4s} {d['commit'][:9]} files {s['files']} parseFailures {len(s['parseFailures'])} "
          f"unresolvedRelative {s['unresolvedRelativeImports']} nonLiteralDynamic {s['nonLiteralDynamicImports']} "
          f"unmapped {len(s['unmappedFiles'])} crossAreaLinks {links} pairs {len(d['knots']['pairs'])} "
          f"groups {[len(g) for g in d['knots']['groups']]} registry {d['areaMapSource'].split('/')[-1]}")
for k in ('H', 'B', 'B12'):
    print(f'{k:4s} edge dump: edges {len(edges[k])}, cross-area {sum(1 for e in edges[k] if e["fromArea"] != e["toArea"])}')
print('cycle group H == B:', seams['H']['knots']['groups'] == seams['B']['knots']['groups'], seams['H']['knots']['groups'])
print('window (B..H, first-parent):', git('rev-list', '--count', '--first-parent', f'{B}..{H}').strip(), 'commits;',
      git('diff', '--shortstat', B, H, '--', 'lib', 'routes', 'public', 'server.js').strip())
print('reproduces run 12 at B under its own registry (links, knots, areas equal to run 12 E/ head file):',
      all(seams['B12'][k] == json.load(open(os.path.join(REPO, 'docs/reviews/_evidence-2026-11-13-run12',
          f'seams-code-{B}-guide-head.json')))[k] for k in ('links', 'knots', 'areas', 'scope')))

sec('S2. Guide-only check: run 12 commit under its own registry (B12) vs under the HEAD registry (B)')
pr = lambda d: {tuple(sorted([p['a'], p['b']])): (p['aToB'], p['bToA'], p['a'], p['b']) for p in d['knots']['pairs']}
L = lambda d: {(l['from'], l['to']): l['imports'] for l in d['links']}
for k in sorted(set(L(seams['B12'])) | set(L(seams['B']))):
    a, b = L(seams['B12']).get(k, 0), L(seams['B']).get(k, 0)
    if a != b:
        print(f'  link {S(k[0])} -> {S(k[1])}: {a} -> {b}')
p12, pB = pr(seams['B12']), pr(seams['B'])
print('pairs B12', len(p12), 'B', len(pB), '| opened by the guide alone:', [f'{S(a)} <-> {S(b)}' for (a, b) in set(pB) - set(p12)],
      '| closed:', [f'{S(a)} <-> {S(b)}' for (a, b) in set(p12) - set(pB)])
e12 = {(e['from'], e['to']): e for e in edges['B12']}
for e in edges['B']:
    o = e12[(e['from'], e['to'])]
    if (o['fromArea'], o['toArea']) != (e['fromArea'], e['toArea']):
        print(f"  re-filed edge {e['from']} -> {e['to']}: {S(o['fromArea'])}->{S(o['toArea'])} becomes {S(e['fromArea'])}->{S(e['toArea'])}")

sec('S3. Reciprocal pairs (a->b / b->a): B12 (run 12 as published) | B (HEAD registry) | H (HEAD registry)')
ph = pr(seams['H'])
allk = sorted(set(ph) | set(pB) | set(p12))
for k in allk:
    cells = []
    for src in (p12, pB, ph):
        v = src.get(k)
        cells.append(f'{v[0]}/{v[1]}' if v else '-')
    a = (ph.get(k) or pB.get(k) or p12.get(k))[2:]
    print(f'  {S(a[0]):10s} <-> {S(a[1]):10s}  {cells[0]:>7s} | {cells[1]:>7s} | {cells[2]:>7s}')
print('pair set H == B:', set(ph) == set(pB), '| count H', len(ph))

sec('S4. File-level edge diff B -> H (edge dump, HEAD registry)')
eh = {(e['from'], e['to']): e for e in edges['H']}
eb = {(e['from'], e['to']): e for e in edges['B']}
added = sorted(set(eh) - set(eb)); removed = sorted(set(eb) - set(eh))
print('edges', len(eb), '->', len(eh), 'added', len(added), 'removed', len(removed),
      '| cross-area added', sum(1 for k in added if eh[k]['fromArea'] != eh[k]['toArea']),
      'removed', sum(1 for k in removed if eb[k]['fromArea'] != eb[k]['toArea']))
with open(os.path.join(EV, 'edge-diff-B-to-H.txt'), 'w') as f:
    for k in added:
        e = eh[k]; f.write(f"+ {k[0]} -> {k[1]} | {e['fromArea']} -> {e['toArea']}\n")
    for k in removed:
        e = eb[k]; f.write(f"- {k[0]} -> {k[1]} | {e['fromArea']} -> {e['toArea']}\n")
print('listing: edge-diff-B-to-H.txt')
moved = Counter()
for k in added:
    e = eh[k]
    if e['fromArea'] != e['toArea']: moved[(e['fromArea'], e['toArea'], '+')] += 1
for k in removed:
    e = eb[k]
    if e['fromArea'] != e['toArea']: moved[(e['fromArea'], e['toArea'], '-')] += 1
for (a, b) in sorted({(x, y) for (x, y, _) in moved}):
    plus = [f"{k[0]} -> {k[1]}" for k in added if eh[k]['fromArea'] == a and eh[k]['toArea'] == b]
    minus = [f"{k[0]} -> {k[1]}" for k in removed if eb[k]['fromArea'] == a and eb[k]['toArea'] == b]
    print(f'  {S(a)} -> {S(b)}: +{len(plus)} -{len(minus)}')
    for x in plus: print('      +', x)
    for x in minus: print('      -', x)

sec('S5. Hubs and doors: in / cross-area in / outbound / cross-area out, B -> H; lines B -> H')
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
hubs = ['lib/run-trail.js', 'lib/run-ledger.js', 'lib/run-live-wait.js', 'lib/recommendation-live-wait.js',
        'lib/stage-writes.js', 'lib/stage-write-gate.js', 'lib/prompts/stage-kinds.js', 'lib/item-stage-stamp.js',
        'lib/code-routes.js', 'lib/time-words.js', 'lib/cost-format.js', 'lib/cost-read.js', 'lib/cost-read-calls.js',
        'lib/should-mock-ai.js', 'lib/prompts/prompt-context.js', 'lib/openrouter.js', 'lib/workspace-preferences.js',
        'lib/dispatch-factory.js', 'lib/dispatch-store.js', 'lib/periodicals.js', 'lib/task-page-loader.js',
        'lib/run-controls.js', 'lib/tree.js', 'lib/as-asked.js', 'lib/recommendation-look-first.js',
        'lib/recommendation-blind-read.js', 'lib/recommendation-facts.js', 'lib/recent-runs.js', 'lib/run-view.js',
        'lib/prompt-template-defs.js', 'lib/proxy-preamble.js', 'lib/proxy-instructions.js', 'lib/providers/state-map.js',
        'lib/run-closeout-state.js', 'lib/completion-signals.js', 'lib/dispatch-entrance.js', 'lib/chat-tools.js',
        'lib/prompts/area-note-format.js', 'routes/proxy-writes.js', 'routes/proxy-compute.js', 'server.js']
print('file | B in/xIn/out/xOut | H in/xIn/out/xOut | lines B -> H')
for f in hubs:
    b = f"{db[0][f]}/{db[1][f]}/{db[2][f]}/{db[3][f]}"; h = f"{dh[0][f]}/{dh[1][f]}/{dh[2][f]}/{dh[3][f]}"
    print(f'{f:36s} {b:12s} {h:12s} {lines(B, f)} -> {lines(H, f)}')
def importers(es, f):
    return sorted(f"{e['from']} [{S(e['fromArea'])}]" for e in es if e['to'] == f and e['fromArea'] != e['toArea'])
for f in ['lib/run-trail.js', 'lib/run-ledger.js', 'lib/stage-writes.js', 'lib/time-words.js', 'lib/cost-format.js',
          'lib/run-live-wait.js', 'lib/should-mock-ai.js', 'lib/prompts/stage-kinds.js', 'lib/cost-read-calls.js']:
    print(f'  cross-area importers of {f} (H):', importers(edges['H'], f))
print('  cross-area importers of lib/run-ledger.js (B):', importers(edges['B'], 'lib/run-ledger.js'))
print('  run-trail.js outbound (H):', sorted(e['to'] for e in edges['H'] if e['from'] == 'lib/run-trail.js'))
print('  run-live-wait.js outbound (H):', sorted(e['to'] for e in edges['H'] if e['from'] == 'lib/run-live-wait.js'))
print('  stage-writes.js outbound (H):', sorted(e['to'] for e in edges['H'] if e['from'] == 'lib/stage-writes.js'))

sec('S6. Catch-all (Other features) and the new production files')
def cross_files(es):
    areaof, cross = {}, set()
    for e in es:
        areaof[e['from']] = e['fromArea']; areaof[e['to']] = e['toArea']
        if e['fromArea'] != e['toArea']:
            cross.add(e['from']); cross.add(e['to'])
    return sorted(f for f in cross if areaof.get(f) == OTHER)
n12, nb, nh = cross_files(edges['B12']), cross_files(edges['B']), cross_files(edges['H'])
print('N1 Other-features files with a cross-area edge: B12', len(n12), 'B', len(nb), 'H', len(nh))
print('  left by the guide edit (B12 - B):', sorted(set(n12) - set(nb)))
print('  B -> H: gone', sorted(set(nb) - set(nh)), 'new', sorted(set(nh) - set(nb)))
print('  H set:', [f.replace('lib/', '').replace('.js', '') for f in nh])
other_files_h = sorted({e['from'] for e in edges['H'] if e['fromArea'] == OTHER} | {e['to'] for e in edges['H'] if e['toArea'] == OTHER})
print('  Other-features files in any edge (H):', len(other_files_h))
new = [l.split('\t') for l in git('diff', '--name-status', B, H, '--', 'lib', 'routes', 'public', 'server.js').splitlines()
       if l[0] in 'AR']
for parts in new:
    f = parts[-1]
    print(f'  {parts[0]:5s} {f:42s} -> {S(area_of(f))}')
for f in git('diff', '--name-status', B, H, '--', 'scripts').splitlines():
    print('  scripts change:', f)

sec('S7. Direction checks (H)')
eH = edges['H']
print('lib -> routes edges: B', sum(1 for e in edges['B'] if e['from'].startswith('lib/') and e['to'].startswith('routes/')),
      'H', sum(1 for e in eH if e['from'].startswith('lib/') and e['to'].startswith('routes/')))
print('edges into server.js:', sum(1 for e in eH if e['to'] == 'server.js'))
print('public/ -> anything (B):', [f"{e['from']} -> {e['to']}" for e in edges['B'] if e['from'].startswith('public/')])
print('public/ -> anything (H):', [f"{e['from']} -> {e['to']} [{S(e['toArea'])}]" for e in eH if e['from'].startswith('public/')])
print('anything -> public/ (H):', [f"{e['from']} -> {e['to']}" for e in eH if e['to'].startswith('public/')])
print('public/ -> public/ (H, intra-browser imports):', sum(1 for e in eH if e['from'].startswith('public/') and e['to'].startswith('public/')))
for k, es in (('B', edges['B']), ('H', eH)):
    rr = [f"{e['from']} -> {e['to']} [{S(e['fromArea'])}]" for e in es
          if re.match(r'lib/render', e['to']) and e['fromArea'] in (RUNS, OTHER, LLM, PROV, AGENT, PLAT)]
    print(f'renderer (lib/render*) imported from Runs/Other/LLM/Providers/Agent/Platform ({k}):', rr)
for k, es in (('B', edges['B']), ('H', eH)):
    print(f'Pages-area files imported from Runs or Other ({k}):',
          sorted(f"{e['from']} -> {e['to']}" for e in es if e['toArea'] == PAGES and e['fromArea'] in (RUNS, OTHER, LLM)))
print('Platform & plumbing cross-area out (H):', sum(1 for e in eH if e['fromArea'] == PLAT and e['toArea'] != PLAT))
print('Providers -> LLM (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == PROV and e['toArea'] == LLM))
print('LLM -> Providers (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == LLM and e['toArea'] == PROV))
print('Agent API -> Other (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == AGENT and e['toArea'] == OTHER))
print('Other -> Agent API (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == OTHER and e['toArea'] == AGENT))
print('Runs -> Other (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == RUNS and e['toArea'] == OTHER))
print('Other -> Runs (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == OTHER and e['toArea'] == RUNS))
print('LLM -> Pages (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == LLM and e['toArea'] == PAGES))
print('LLM -> Agent API (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == LLM and e['toArea'] == AGENT))
print('Runs -> Agent API (H):', sorted(f"{e['from']} -> {e['to']}" for e in eH if e['fromArea'] == RUNS and e['toArea'] == AGENT))

sec('S8. Scripts outside the import tool scope that import lib/ (the tool reads server.js, lib, routes, public)')
reports = ['scripts/code-shape/retention.mjs', 'scripts/code-shape/retention-core.mjs', 'scripts/stability-measures.mjs',
           'scripts/stability-measures-core.mjs', 'scripts/stability-measures-tracker.mjs',
           'scripts/stability-measures-blind.mjs', 'scripts/stability-measures-seat.mjs', 'scripts/gen-llms-catalogue.mjs',
           'scripts/pipeline-churn.mjs']
for f in reports:
    src = git('show', f'{H}:{f}')
    libs = re.findall(r"from\s+['\"](\.\./(?:\.\./)?lib/[^'\"]+)['\"]", src)
    print(f'  {f:46s} area {S(area_of(f)) if area_of(f) else "(no area)":10s} lib imports: {libs}')
allscripts = [l for l in git('ls-tree', '-r', '--name-only', H, 'scripts').splitlines() if re.search(r'\.(m?js|cjs)$', l)
              and not re.search(r'\.test\.', l)]
withlib = []
for f in allscripts:
    src = git('show', f'{H}:{f}')
    if re.search(r"from\s+['\"](?:\.\./)+lib/", src) or re.search(r"import\(\s*['\"](?:\.\./)+lib/", src):
        withlib.append(f)
print('  all non-test scripts/ files importing lib/ at H:', len(withlib), '| of which registered to an area:',
      sum(1 for f in withlib if area_of(f)))

sec('S9. Co-change, 60 days, the same registry (HEAD) for both commits')
cb, ch = J(f'cochange-code-{B}-guide-head-days60.json'), J(f'cochange-code-{H}-guide-head-days60.json')
cb12 = J(f'cochange-code-{B}-guide-run12-days60.json')
for k, c in (('B', cb), ('H', ch), ('B12', cb12)):
    print(f"{k}: changes {c['changes']} multi {c['changesTouchingMultipleAreas']} pairs {len(c['pairs'])} unmapped {c['unmappedFiles']} shallow {c['shallow']} window {c['windowStart'][:10]}..{c['windowEnd'][:10]}")
pc = lambda c: {tuple(sorted(p['areas'])): p['changes'] for p in c['pairs']}
cbp, chp, cb12p = pc(cb), pc(ch), pc(cb12)
print('pairs moved by the guide edit alone (B under run-12 registry -> under HEAD registry):')
for k in sorted(cbp):
    if cb12p.get(k) != cbp[k]:
        print(f'  {S(k[0])} <-> {S(k[1])}: {cb12p.get(k)} -> {cbp[k]}')
print('top 14 pairs at H (with B), and whether an import link exists at H (either direction):')
lh = L(seams['H']); lb = L(seams['B'])
linked = lambda l, a, b: (l.get((a, b), 0) + l.get((b, a), 0)) > 0
for k, v in sorted(chp.items(), key=lambda kv: -kv[1])[:14]:
    print(f'  {S(k[0]):10s} <-> {S(k[1]):10s} B {cbp.get(k, 0):4d} H {v:4d}  link H {linked(lh, *k)}  link B {linked(lb, *k)}')
print('pairs B -> H that moved (HEAD registry):')
for k in sorted(set(cbp) | set(chp), key=lambda k: -max(cbp.get(k, 0), chp.get(k, 0))):
    if cbp.get(k) != chp.get(k):
        print(f'  {S(k[0])} <-> {S(k[1])}: {cbp.get(k, 0)} -> {chp.get(k, 0)}')
nolink_h = sorted([k for k in chp if not linked(lh, *k)], key=lambda k: -chp[k])
nolink_b = sorted([k for k in cbp if not linked(lb, *k)], key=lambda k: -cbp[k])
print('pairs with no import link: B', len(nolink_b), 'H', len(nolink_h))
print('  gained a link B -> H:', [f'{S(a)} <-> {S(b)}' for (a, b) in set(nolink_b) - set(nolink_h)])
print('  lost a link B -> H:', [f'{S(a)} <-> {S(b)}' for (a, b) in set(nolink_h) - set(nolink_b)])
for k in nolink_h:
    print(f'  no link H: {S(k[0])} <-> {S(k[1])}: B {cbp.get(k, 0)} H {chp[k]}')

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
with open(os.path.join(EV, 'cochange-window-commits-H-only.txt'), 'w') as f:
    for h in sorted(honly, key=lambda h: wh[h]['ct']):
        f.write(h + ' ' + git('show', '-s', '--format=%s', h).strip() + '\n')
def pairs_of(hs, src):
    c = Counter()
    for h in hs:
        a = sorted({area_of(f) for f in src[h]['files'] if area_of(f)})
        for i in range(len(a)):
            for j in range(i + 1, len(a)):
                c[(a[i], a[j])] += 1
    return c
po, pn = pairs_of(bonly, wb), pairs_of(honly, wh)
for k in [(BROWSER, PAGES), (AGENT, RUNS), (LLM, RUNS), (BROWSER, WEB), (WEB, RUNS), (AGENT, LLM), (AGENT, OTHER),
          (OTHER, RUNS), (LLM, OTHER), (PAGES, RUNS), (BROWSER, RUNS)]:
    kk = tuple(sorted(k))
    print(f'  {S(kk[0])} <-> {S(kk[1])}: B {cbp.get(kk, 0)} - B-only {po[kk]} + H-only {pn[kk]} = {cbp.get(kk, 0) - po[kk] + pn[kk]} (H reads {chp.get(kk, 0)})')

sec('S11. Carried measures re-read at B and H')
GLOB = re.compile(r'window\.[A-Za-z_$][A-Za-z0-9_$]* ?=[^=]')
for k, c in (('B', B), ('H', H)):
    files = [l for l in git('ls-tree', '-r', '--name-only', c, 'public').splitlines() if l.endswith('.js') and not l.endswith('.min.js')]
    total, per, mods = 0, Counter(), []
    for f in files:
        src = git('show', f'{c}:{f}')
        n = len(GLOB.findall(src)); total += n
        if n: per[f] = n
        if re.search(r'^\s*(import\s|export\s)', src, re.M): mods.append(f)
    print(f'F6 {k}: window.X = assignments in public/*.js: {total} across {len(per)} files; public files {len(files)}; ES-module files {len(mods)}: {mods}')
    if k == 'H':
        HPER = per
    else:
        BPER = per
for f in sorted(set(HPER) | set(BPER)):
    if HPER.get(f, 0) != BPER.get(f, 0):
        print(f'   moved: {f} {BPER.get(f, 0)} -> {HPER.get(f, 0)}')
print('route -> route edges (F5): B', sum(1 for e in edges['B'] if e['from'].startswith('routes/') and e['to'].startswith('routes/')),
      'H', sum(1 for e in eH if e['from'].startswith('routes/') and e['to'].startswith('routes/')))
print('unresolved relative imports: B', seams['B']['scope']['unresolvedRelativeImports'], 'H', seams['H']['scope']['unresolvedRelativeImports'])

sec('S12. Per-area rollup (files, internal imports, cross in / out, entry files), B -> H, HEAD registry')
def rollup(d, es):
    out = {}
    for a in d['areas']:
        out[a['name']] = {'files': a['files'], 'internal': a['internalImports'], 'entry': len(a['entryFiles'])}
    xin, xout = Counter(), Counter()
    for l in d['links']:
        xout[l['from']] += l['imports']; xin[l['to']] += l['imports']
    for n in out:
        out[n]['xin'] = xin[n]; out[n]['xout'] = xout[n]
    return out
rb, rh = rollup(seams['B'], edges['B']), rollup(seams['H'], edges['H'])
for n in rh:
    b, h = rb.get(n, {}), rh[n]
    cell = lambda k: f"{h[k]}" + (f" [{b.get(k)}]" if b.get(k) != h[k] else '')
    print(f"  {S(n):10s} files {cell('files'):10s} internal {cell('internal'):10s} xin {cell('xin'):10s} xout {cell('xout'):10s} entry {cell('entry')}")

sec('S13. simple-dispatcher (scratch reader; seams.mjs reads 0 CommonJS files)')
for tag in ['af9b496', '7d5fe7d']:
    d = J(f'require-graph-sd-{tag}.json')
    n = lambda v: v if isinstance(v, int) else len(v)
    print(tag, 'files', n(d['scope']['files']), 'unmapped', n(d['scope']['unmappedFiles']), 'unresolved', n(d['scope']['unresolvedRelative']),
          'nonLiteral', n(d['scope']['nonLiteralRequires']), 'fileEdges', n(d['fileEdges']), 'areaLinks', n(d['areaLinks']),
          'reciprocal', n(d['reciprocalPairs']))
a, b = J('require-graph-sd-af9b496.json'), J('require-graph-sd-7d5fe7d.json')
print('reader output identical across the window (areaLinks, fileEdges, pairs):',
      a['areaLinks'] == b['areaLinks'] and a['fileEdges'] == b['fileEdges'] and a['reciprocalPairs'] == b['reciprocalPairs'])
if SD:
    print('sd window commits:', git('log', '--first-parent', '--format=%h %s', f'{SDB}..{SDH}', cwd=SD).strip().replace('\n', ' | '))
    print('sd files changed:', git('diff', '--name-status', SDB, SDH, cwd=SD).strip().replace('\n', ' | '))
    for f in ['hook.js', 'transcript.js']:
        d = git('diff', SDB, SDH, '--', f, cwd=SD)
        req = [l for l in d.splitlines() if re.match(r'^[+-]\s*(const|let|var).*require\(', l)]
        print(f'  require lines changed in {f}:', req)
for tag in ['af9b496', '7d5fe7d']:
    d = J(f'cochange-sd-{tag}-guide-sd-days60.json')
    print('cochange', tag, d['changes'], d['changesTouchingMultipleAreas'], len(d['pairs']), d['unmappedFiles'], 'shallow', d['shallow'])
