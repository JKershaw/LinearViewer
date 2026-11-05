#!/usr/bin/env python3
"""Supplementary figures for the Seams & Tangles run 7 report (LIN-4249).

These figures are not in the seams.mjs / cochange.mjs JSON, so they are read here. Each one is read from committed
git objects at a pinned SHA, or from the edge dumps in the evidence folder. Sections S0-S15 follow run 6's
`supplementary-figures.py` definitions so the figures compare mechanically; S16 onward are new for this window.
Run from the repo root:

    SD_DIR=<simple-dispatcher clone> python3 -I docs/reviews/_evidence-2026-11-05/supplementary-figures.py . > docs/reviews/_evidence-2026-11-05/supplementary-figures.txt
"""
import json, os, re, subprocess, sys
from datetime import datetime

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
EV = os.path.join(REPO, 'docs/reviews/_evidence-2026-11-05')
B = 'd7ceb373444f9efbc027656132352d247535aa5e'
H = '2eb73ae07fb7297fc0fa057a6198aa8cbe901558'
COMMITS = [('d7ceb373', B), ('2eb73ae0', H)]
G = 'head-2eb73ae0'
RUNS, LLM, OTHER, PAGES = 'Runs & dispatch', 'LLM & prompts', 'Other features', 'Front end: server-rendered pages'


def git(*args, cwd=REPO, ok=(0,)):
    p = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    if p.returncode not in ok:
        raise SystemExit(f'git {args} failed: {p.stderr}')
    return p.stdout


def show(sha, path):
    return git('show', f'{sha}:{path}')


def grep_lines(sha, pattern, *paths):
    out = git('grep', '-nE', pattern, sha, '--', *paths, ok=(0, 1))
    return [l[len(sha) + 1:] for l in out.splitlines() if l]


def edges(code8):
    return json.load(open(os.path.join(EV, f'edges-code-{code8}-guide-{G}.json')))['edgeList']


def short(a):
    return (a or '?').split(' (')[0].replace('Front end: ', '').split(',')[0].split(' &')[0]


def section(title):
    print(f'\n## {title}')


E = {c8: edges(c8) for c8, _ in COMMITS}
print('# Supplementary figures, Seams & Tangles run 7 (LIN-4249)')
print(f'measured commits {B} (baseline) and {H}; one guide, {G} (blob 642e9405)')

section('S0. Window facts')
print(git('log', '--format=%h %cI %s', f'{B}..{H}').rstrip())
print('- ' + git('diff', '--shortstat', B, H, '--', 'lib', 'routes', 'public', 'server.js').strip())
for l in git('diff', '--name-status', B, H, '--', 'lib', 'routes', 'public', 'server.js').splitlines():
    if not l.startswith('M'):
        print(f'- {l}')
print('- unchanged in window (empty diff = unchanged): ' + ', '.join(
    f'{p}: {"unchanged" if not git("diff", "--name-only", B, H, "--", p).strip() else "CHANGED"}'
    for p in ['scripts/code-shape/', 'lib/runner-kit/', 'docs/runner-prompt.md', 'docs/architecture/source-map.md', 'docs/dispatch-integration.md']))
for c8, sha in COMMITS:
    s = show(sha, 'server.js')
    print(f'- {c8}: lib/cost-read.js lines {len(show(sha, "lib/cost-read.js").splitlines())}; server.js lines {len(s.splitlines())}, '
          f'top-level import lines {len(re.findall(r"^import ", s, re.M))}, inline app.<verb>( routes {len(re.findall(r"^app\.(get|post|put|patch|delete)\(", s, re.M))}')

section('S1. lib/ -> routes/ imports')
for c8, sha in COMMITS:
    g = grep_lines(sha, r"""from ['"](\.\./)+routes/|from ['"]\./routes/|require\(['"](\.\./)+routes/""", 'lib')
    e = [x for x in E[c8] if x['from'].startswith('lib/') and x['to'].startswith('routes/')]
    print(f'- {c8}: edge-dump lib->routes {len(e)}; git grep {len(g)}')

section('S2. route -> route file edges (run 5 definition)')
for c8, _ in COMMITS:
    rr = [x for x in E[c8] if x['from'].startswith('routes/') and x['to'].startswith('routes/')]
    print(f'- {c8}: {len(rr)} (cross-area {len([x for x in rr if x["fromArea"] != x["toArea"]])})')

section('S3. F7 dead named lib imports in routes/proxy.js (run 4 heuristic)')
for c8, sha in COMMITS:
    src = show(sha, 'routes/proxy.js')
    imports = list(re.finditer(r"import\s*\{([^}]*)\}\s*from\s*'(\.\./lib/[^']+)'\s*;?", src))
    body = src
    for m in imports:
        body = body.replace(m.group(0), '')
    names = [part.strip().split(' as ')[-1].strip() for m in imports for part in m.group(1).split(',') if part.strip()]
    dead = [n for n in names if not re.search(r'(?<![A-Za-z0-9_$])' + re.escape(n) + r'(?![A-Za-z0-9_$])', body)]
    print(f'- {c8}: named lib imports {len(names)}, unused {len(dead)}')

section('S4. F6 browser globals and the cost-format script lists')
for c8, sha in COMMITS:
    pub = grep_lines(sha, r'window\.[A-Za-z_]* *=', 'public')
    com = grep_lines(sha, r'window\.[A-Za-z_]* *=', 'public/common.js')
    com_strict = grep_lines(sha, r'window\.[A-Za-z_]* *=[^=]', 'public/common.js')
    lists = grep_lines(sha, r"""['"]/cost-format\.js['"]""", 'lib', 'routes', 'server.js')
    print(f'- {c8}: window.X = in public/ {len(pub)}; in public/common.js {len(com)} (strict =[^=] {len(com_strict)}); /cost-format.js script-list lines {len(lists)}: {", ".join(sorted(l.split(":")[0] for l in lists))}')
pubchg = [l for l in git('diff', '--name-only', B, H, '--', 'public').splitlines() if l]
print(f'- public/ files changed in window: {len(pubchg)}: {", ".join(pubchg)}')
print('- window.X = lines added or removed in the window, by file:')
for l in git('diff', '-U0', B, H, '--', 'public').splitlines():
    if l.startswith('+++ '):
        cur = l[6:]
    elif re.match(r'^[+-][^+-].*window\.[A-Za-z_]* *=', l):
        print(f'    {cur}: {l[:150]}')

section('S5. N8: the deleted task-cost module still named')
for c8, sha in COMMITS:
    refs = [l for l in grep_lines(sha, r'task-cost\.js', 'lib', 'routes', 'server.js', 'public') if 'terminal-marked-task-cost' not in l]
    alias = '|task-cost|' in show(sha, 'scripts/code-shape/areas.json')
    print(f'- {c8}: guide alias task-cost| present={alias}; comment refs {len(refs)}')
    for l in refs:
        print(f'    {l[:140]}')

section('S6. Carried anchors (HEAD)')
for pat, paths in [
    (r'export function fmtDuration', ['lib/render-run-steps.js']),
    (r"import \{[^}]*fmtDuration[^}]*\} from '\./render-run-steps\.js'", ['lib']),
    (r'export function applyDefaultDispatchHarness', ['lib/proxy-preamble.js']),
    (r"export \{ selectFocusSubtask", ['lib/tree.js']),
    (r'export function parentNextOf', ['lib/recommendation-facts.js']),
    (r'import \{ parentNextOf \}', ['lib/providers']),
    (r'export class RefResolutionError', ['lib']),
    (r'export function collectIssueAttachments', ['lib']),
    (r'export function (stableStringify|hashContext)', ['lib']),
    (r"from './routes/test.js'", ['server.js']),
    (r'^[[:space:]]*installTestTokenLinearTransport\(\)', ['server.js']),
    (r"from '\./usage-snapshot-intake\.js'|countUsageSnapshotPost\(", ['lib/dispatch-store.js']),
    (r'lineageIdentityOfRows', ['lib/dispatch-store.js', 'lib/workspace-kpi-stats.js', 'server.js']),
    (r'requestUsageLoader[ ,}]|requestUsageLoader\.forRows|createRequestUsageLoader\(', ['server.js']),
    (r'^export function requireRequestUsageLoader|Pure: no store', ['lib/request-usage-loader.js', 'lib/cost-read.js']),
]:
    for l in grep_lines(H, pat, *paths):
        print(f'- {l[:170]}')

section('S7. lib Runs -> server-rendered pages edges')
for c8, _ in COMMITS:
    rp = [f"{x['from']}->{x['to']}" for x in E[c8] if x['fromArea'] == RUNS and x['toArea'] == PAGES]
    print(f'- {c8}: Runs->Pages {len(rp)}: {", ".join(rp)}')

section('S8. F1 (LLM <-> Runs) edges that touch the cost family')
COST = re.compile(r'lib/(cost-read|cost-format|request-usage-[^/]*|usage-snapshot-intake|row-usage|lineage-membership|model-pricing|llm-call-log|model-routing-spend|model-routing-history|terminal-marked-task-cost|weekly-budget|effort-readout|session-telemetry|workspace-kpi-stats)\.js$')
for c8, _ in COMMITS:
    for a, b in [(LLM, RUNS), (RUNS, LLM)]:
        es = [x for x in E[c8] if x['fromArea'] == a and x['toArea'] == b]
        cf = [x for x in es if COST.search(x['from']) or COST.search(x['to'])]
        print(f'- {c8} {short(a)} -> {short(b)}: {len(es)} edges, cost-family {len(cf)}: {", ".join(x["from"] + "->" + x["to"] for x in cf)}')

section('S9. The workspace- pattern (Auth): workspace-* files it places, and workspace-api-mocks importers')
for c8, sha in COMMITS:
    ws = sorted({x[k] for x in E[c8] for k in ('from', 'to') if re.match(r'lib/workspace-', x[k])})
    placed = {f: next((x['fromArea'] if x['from'] == f else x['toArea']) for x in E[c8] if f in (x['from'], x['to'])) for f in ws}
    mocks = sorted({x['from'] for x in E[c8] if x['to'] == 'lib/workspace-api-mocks.js'})
    print(f'- {c8}: ' + '; '.join(f'{f[4:]}={short(a)}' for f, a in placed.items()) + f' | workspace-api-mocks importers {len(mocks)}')

section('S10. Scripts outside the tool scope that import lib/ cost modules (HEAD)')
for l in grep_lines(H, r"from '\.\./lib/(cost-read|request-usage-[a-z]+|row-usage|kpi-stats|model-pricing)\.js'", 'scripts'):
    print(f'- {l[:150]}')

section('S11. Change-coupling window overlap')
cb = json.load(open(os.path.join(EV, f'cochange-code-d7ceb373-guide-{G}-days60.json')))
ch = json.load(open(os.path.join(EV, f'cochange-code-2eb73ae0-guide-{G}-days60.json')))
p = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
ov = (min(p(cb['windowEnd']), p(ch['windowEnd'])) - max(p(cb['windowStart']), p(ch['windowStart']))).total_seconds() / 86400
wb = set(open(os.path.join(EV, 'cochange-window-commits-d7ceb373.txt')).read().split())
wh = set(open(os.path.join(EV, 'cochange-window-commits-2eb73ae0.txt')).read().split())
print(f'- windows {cb["windowStart"]}..{cb["windowEnd"]} and {ch["windowStart"]}..{ch["windowEnd"]}: overlap {ov:.3f} of 60 days ({ov / 60 * 100:.2f}%)')
print(f'- commits {len(wb)} vs {len(wh)} (cochange changes {cb["changes"]} / {ch["changes"]}); shared {len(wb & wh)}; only d7ceb373 {len(wb - wh)}; only 2eb73ae0 {len(wh - wb)}')
print('- true top 12 by count at each commit (run 6 §6 printed run 5\'s ten pairs, not the d7ceb373 top ten):')
for name, cc in (('d7ceb373', cb), ('2eb73ae0', ch)):
    print(f'    {name}: ' + '; '.join(f'{" + ".join(short(a) for a in q["areas"])} {q["changes"]}' for q in cc['pairs'][:12]))

section('S12. No-link pairs: commits in the 2eb73ae0 window that touch both areas, for the non-browser no-link pairs')
guide = json.load(open(os.path.join(EV, f'areas.{G}.json')))['areas']
rx = [(a['name'], [re.compile(m) for m in a['match']]) for a in guide]
def area_of(f):
    for n, rs in rx:
        if any(r.search(f) for r in rs):
            return n
    return None
log = git('log', H, '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%H',
          f'--since={ch["windowStart"]}', f'--until={ch["windowEnd"]}')
commits, cur = [], None
for l in log.splitlines():
    if l.startswith('@'):
        cur = {'sha': l[1:], 'files': []}
        commits.append(cur)
    elif l.strip() and cur:
        cur['files'].append(l.strip())
for A_, B_ in [('Agent API (proxy)', 'Reports & operator tools'), ('Agent API (proxy)', OTHER), (OTHER, 'Reports & operator tools')]:
    hits = [c for c in commits if {A_, B_} <= {area_of(f) for f in c['files']}]
    print(f'- {short(A_)} + {short(B_)}: {len(hits)} commits; most recent 6: ' + '; '.join(git('log', '-1', '--format=%h %s', c['sha']).strip()[:70] for c in hits[:6]))
print('- in-window (d7ceb373..2eb73ae0) commits per browser-code pair partner:')
inwin = [c for c in commits if c['sha'] in (wh - wb)]
for c in inwin:
    areas = sorted({short(area_of(f)) for f in c['files'] if area_of(f)})
    print(f'    {c["sha"][:8]}: {", ".join(areas)}')

section('S13. Simple Dispatcher module format (outside seams.mjs)')
sd = os.environ.get('SD_DIR')
if sd and os.path.isdir(sd):
    sha = git('rev-parse', 'origin/main', cwd=sd).strip()
    d = git('show', f'{sha}:dispatcher.js', cwd=sd)
    pkg = json.loads(git('show', f'{sha}:package.json', cwd=sd))
    js = [f for f in git('ls-tree', '-r', '--name-only', sha, cwd=sd).splitlines() if re.search(r'\.(m?js|cjs)$', f) and not f.startswith('node_modules/')]
    esm = [f for f in js if re.search(r'^(import|export) ', git('show', f'{sha}:{f}', cwd=sd), re.M)]
    print(f'- simple-dispatcher origin/main {sha} ({git("log", "-1", "--format=%cI", sha, cwd=sd).strip()}): dispatcher.js require( lines {len(re.findall(r"require\(", d))}; '
          f'import/export lines {len(re.findall(r"^(import|export) ", d, re.M))}; package.json "type": {pkg.get("type")}; JS files {len(js)}, with top-level import/export {len(esm)}: {", ".join(esm) or "none"}')
else:
    print('- SD_DIR not set; not read')

section('S14. Survey place ledger rows this report cross-links (read only)')
try:
    ref = 'origin/claude/cool-rubin-6acj5j'
    sha = git('rev-parse', ref).strip()
    led = show(ref, 'docs/plans/survey/place-ledger.md').splitlines()
    print(f'- {ref} = {sha}; {len(led)} lines')
    for i, l in enumerate(led, 1):
        if re.search(r'LIN-(4226|4234|4240|4241|4242|4243|4151|4048|4143)\b|waiting-section|ruling-settled|home-placement', l):
            print(f'    place-ledger.md:{i}: {l[:200]}')
except SystemExit as e:
    print(f'- not readable: {e}')

section('S15. Entry files / files / internal imports per area (seams.areas)')
D = {c8: json.load(open(os.path.join(EV, f'seams-code-{c8}-guide-{G}.json'))) for c8, _ in COMMITS}
print('| area | d7ceb373 | 2eb73ae0 |')
for a in D['2eb73ae0']['areas']:
    cells = []
    for c8, _ in COMMITS:
        x = next(y for y in D[c8]['areas'] if y['name'] == a['name'])
        cells.append(f"{len(x['entryFiles'])}/{x['files']} int {x['internalImports']}")
    print(f"| {a['name']} | " + ' | '.join(cells) + ' |')

section('S16. Named hubs and doors: importers / outbound, total and cross-area, each commit')
HUBS = ['lib/cost-read.js', 'lib/request-usage-loader.js', 'lib/request-usage-intake.js', 'lib/request-usage-store.js', 'lib/dispatch-store.js',
        'lib/task-page-loader.js', 'lib/run-controls.js', 'lib/tree.js', 'lib/proxy-preamble.js', 'lib/render-run-steps.js',
        'lib/usage-snapshot-intake.js', 'lib/model-pricing.js', 'lib/utils/time.js', 'lib/ruling-standing.js', 'lib/unanswered-decisions.js',
        'lib/home-row-states.js', 'lib/render.js', 'lib/question-card.js', 'lib/task-page-href.js', 'lib/utils/html.js',
        'lib/ruling-settled.js', 'lib/waiting-section.js', 'lib/recommendation-facts.js', 'lib/errors.js', 'lib/workspace-api-mocks.js']
print('| file (area) | in d7ceb373 (cross / areas) | in 2eb73ae0 (cross / areas) | out d7ceb373 (cross) | out 2eb73ae0 (cross) |')
for f in HUBS:
    row = []
    area = '?'
    for c8, _ in COMMITS:
        i = [x for x in E[c8] if x['to'] == f]
        o = [x for x in E[c8] if x['from'] == f]
        area = next((x['toArea'] for x in i), None) or next((x['fromArea'] for x in o), area)
        ic = [x for x in i if x['fromArea'] != x['toArea']]
        oc = [x for x in o if x['fromArea'] != x['toArea']]
        row.append((f'{len(i)} ({len(ic)} / {len({x["fromArea"] for x in ic})})', f'{len(o)} ({len(oc)})'))
    print(f'| {f} ({short(area)}) | {row[0][0]} | {row[1][0]} | {row[0][1]} | {row[1][1]} |')
for f in ['lib/cost-read.js']:
    print(f'- {f} cross-area importers at 2eb73ae0: ' + ', '.join(f"{x['from']} [{short(x['fromArea'])}]" for x in E['2eb73ae0'] if x['to'] == f and x['fromArea'] != x['toArea']))

section('S17. Top 12 files by cross-area importers at 2eb73ae0 (with d7ceb373)')
def cross_in(c8):
    d = {}
    for x in E[c8]:
        if x['fromArea'] != x['toArea']:
            d.setdefault(x['to'], set()).add(x['from'])
    return d
ci_b, ci_h = cross_in('d7ceb373'), cross_in('2eb73ae0')
for f, s in sorted(ci_h.items(), key=lambda kv: -len(kv[1]))[:12]:
    print(f'- {f}: {len(ci_b.get(f, ()))} -> {len(s)}')
moved = [(f, len(ci_b.get(f, ())), len(ci_h.get(f, ()))) for f in set(ci_b) | set(ci_h) if len(ci_b.get(f, ())) != len(ci_h.get(f, ()))]
print('- every file whose cross-area importer count moved: ' + '; '.join(f'{f} {a}->{b}' for f, a, b in sorted(moved)))

section('S18. Wiring (server.js) outbound by area, each commit')
for c8, _ in COMMITS:
    d = {}
    for x in E[c8]:
        if x['from'] == 'server.js':
            d[short(x['toArea'])] = d.get(short(x['toArea']), 0) + 1
    print(f'- {c8}: ' + ', '.join(f'{k} {v}' for k, v in sorted(d.items())))

section('S19. The browser seam for public/home-placement.js and the settled-ruling code')
for c8, sha in COMMITS:
    for l in grep_lines(sha, r"scripts: \[[^]]*'/(app|home-placement|question-cards)\.js'", 'lib', 'routes', 'server.js'):
        f, n, rest = l.split(':', 2)
        lst = re.findall(r"'(/[^']+\.js)'", rest)
        hp = lst.index('/home-placement.js') if '/home-placement.js' in lst else None
        app = lst.index('/app.js') if '/app.js' in lst else None
        print(f'- {c8} {f}:{n}: {len(lst)} scripts; home-placement at {hp}; app.js at {app}; question-cards at {lst.index("/question-cards.js") if "/question-cards.js" in lst else None}')
for l in grep_lines(H, r'window\.HomePlacement|HomePlacement\.', 'public', 'lib'):
    print(f'- {l[:150]}')
for l in grep_lines(H, r"ruling-settled", 'public', 'lib', 'routes'):
    print(f'- {l[:150]}')
for l in grep_lines(H, r'^\s*"?/home-placement\.js|home-placement', 'public/llms.txt', 'docs/architecture/source-map.md'):
    print(f'- {l[:150]}')
