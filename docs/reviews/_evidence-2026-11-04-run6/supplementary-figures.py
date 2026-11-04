#!/usr/bin/env python3
"""Supplementary figures for the Seams & Tangles run 6 report (LIN-4231).

These figures are not in the seams.mjs / cochange.mjs JSON, so they are read here. Each one is read from
committed git objects at a pinned SHA, or from the edge dumps in this folder. Run from the repo root:

    python3 docs/reviews/_evidence-2026-11-04-run6/supplementary-figures.py . > docs/reviews/_evidence-2026-11-04-run6/supplementary-figures.txt

Optional: SD_DIR=<path to a simple-dispatcher clone> adds the Simple Dispatcher module-format check (origin/main).
"""
import json, os, re, subprocess, sys
from datetime import datetime

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
EV = os.path.join(REPO, 'docs/reviews/_evidence-2026-11-04-run6')
B = '5334c81a7207b9f2cc85ca429a2c6b18e1635c0e'
H = 'd7ceb373444f9efbc027656132352d247535aa5e'
COMMITS = [('5334c81a', B), ('d7ceb373', H)]


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


def edges(code8, guide):
    return json.load(open(os.path.join(EV, f'edges-code-{code8}-guide-{guide}.json')))['edgeList']


def section(title):
    print(f'\n## {title}')


print('# Supplementary figures, Seams & Tangles run 6 (LIN-4231)')
print(f'repo HEAD at generation: {git("rev-parse", "HEAD").strip()}; measured commits {B} and {H}')

section('S0. Window facts')
print(git('log', '--format=%h %cI %s', f'{B}..{H}').rstrip())
print('- ' + git('diff', '--shortstat', B, H, '--', 'lib', 'routes', 'public', 'server.js').strip())
for l in git('diff', '--name-status', B, H, '--', 'lib', 'routes', 'public', 'server.js').splitlines():
    if not l.startswith('M'):
        print(f'- {l}')
for l in git('diff', '--numstat', B, H, '--', 'lib/runner-kit/runner.mjs', 'lib/cost-read.js', 'routes/proxy.js').splitlines():
    print(f'- numstat {l}')
for c8, sha in COMMITS:
    print(f'- {c8}: lib/cost-read.js lines {len(show(sha, "lib/cost-read.js").splitlines())}')

section('S1. lib/ -> routes/ imports')
for c8, sha in COMMITS:
    g = grep_lines(sha, r"""from ['"](\.\./)+routes/|from ['"]\./routes/|require\(['"](\.\./)+routes/""", 'lib')
    for guide in ('old-5334c81a', 'head-d7ceb373'):
        e = [x for x in edges(c8, guide) if x['from'].startswith('lib/') and x['to'].startswith('routes/')]
        print(f'- {c8} guide {guide}: edge-dump lib->routes {len(e)}; git grep {len(g)}')

section('S2. route -> route file edges (run 5 definition: edge dumps, from routes/ to routes/)')
for c8, _ in COMMITS:
    e = edges(c8, 'head-d7ceb373')
    rr = [x for x in e if x['from'].startswith('routes/') and x['to'].startswith('routes/')]
    print(f'- {c8}: {len(rr)} (cross-area {len([x for x in rr if x["fromArea"] != x["toArea"]])})')

section('S3. F7 dead named lib imports in routes/proxy.js (run 4 heuristic: named imports from ../lib/, identifier not found outside the import statement)')
for c8, sha in COMMITS:
    src = show(sha, 'routes/proxy.js')
    imports = list(re.finditer(r"import\s*\{([^}]*)\}\s*from\s*'(\.\./lib/[^']+)'\s*;?", src))
    body = src
    for m in imports:
        body = body.replace(m.group(0), '')
    names = []
    for m in imports:
        for part in m.group(1).split(','):
            part = part.strip()
            if not part:
                continue
            local = part.split(' as ')[-1].strip()
            names.append(local)
    dead = [n for n in names if not re.search(r'(?<![A-Za-z0-9_$])' + re.escape(n) + r'(?![A-Za-z0-9_$])', body)]
    print(f'- {c8}: named lib imports {len(names)}, unused {len(dead)}')

section('S4. F6 browser globals and the cost-format script lists')
for c8, sha in COMMITS:
    pub = grep_lines(sha, r'window\.[A-Za-z_]* *=', 'public')
    com = grep_lines(sha, r'window\.[A-Za-z_]* *=', 'public/common.js')
    com_strict = grep_lines(sha, r'window\.[A-Za-z_]* *=[^=]', 'public/common.js')
    lists = grep_lines(sha, r"""['"]/cost-format\.js['"]""", 'lib', 'routes', 'server.js')
    print(f'- {c8}: window.X = in public/ {len(pub)}; in public/common.js {len(com)} (strict =[^=] {len(com_strict)}); /cost-format.js script-list lines {len(lists)}: {", ".join(sorted(l.split(":")[0] for l in lists))}')
print(f'- public/ files changed in window: {len([l for l in git("diff", "--name-only", B, H, "--", "public").splitlines() if l])}')

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
    (r'requestUsageLoader[ ,}]|requestUsageLoader\.forRows', ['server.js']),
    (r'^export function requireRequestUsageLoader|Pure: no store', ['lib/request-usage-loader.js', 'lib/cost-read.js']),
    (r'^[[:space:]]*installTestTokenLinearTransport\(\)', ['server.js']),
    (r"from '\./usage-snapshot-intake\.js'|countUsageSnapshotPost\(", ['lib/dispatch-store.js']),
    (r'usage-snapshot-intake|USAGE_SNAPSHOT_INTAKE_COLLECTION|request-usage-loader|createRequestUsageLoader\(', ['server.js']),
]:
    for l in grep_lines(H, pat, *paths):
        print(f'- {l[:170]}')

section('S7. lib Runs -> server-rendered pages edges, and catch-all -> pages edges (HEAD guide)')
for c8, _ in COMMITS:
    e = edges(c8, 'head-d7ceb373')
    rp = [f"{x['from']}->{x['to']}" for x in e if x['fromArea'] == 'Runs & dispatch' and x['toArea'] == 'Front end: server-rendered pages']
    print(f'- {c8}: Runs->Pages {len(rp)}: {", ".join(rp)}')

section('S8. F1 (LLM <-> Runs) edges that touch the cost family (HEAD guide, d7ceb373)')
COST = re.compile(r'lib/(cost-read|cost-format|request-usage-[^/]*|usage-snapshot-intake|row-usage|lineage-membership|model-pricing|llm-call-log|model-routing-spend|model-routing-history|terminal-marked-task-cost|weekly-budget|effort-readout|session-telemetry|workspace-kpi-stats)\.js$')
e = edges('d7ceb373', 'head-d7ceb373')
for a, b in [('LLM & prompts', 'Runs & dispatch'), ('Runs & dispatch', 'LLM & prompts')]:
    es = [x for x in e if x['fromArea'] == a and x['toArea'] == b]
    cf = [x for x in es if COST.search(x['from']) or COST.search(x['to'])]
    print(f'- {a} -> {b}: {len(es)} edges, cost-family {len(cf)}: {", ".join(x["from"] + "->" + x["to"] for x in cf)}')

section('S9. The over-broad workspace- pattern: files it puts in Auth that are named workspace-*, and workspace-api-mocks importers (HEAD)')
e = edges('d7ceb373', 'head-d7ceb373')
mocks = sorted({x['from'] for x in e if x['to'] == 'lib/workspace-api-mocks.js'})
print(f'- lib/workspace-api-mocks.js area: {next((x["toArea"] for x in e if x["to"] == "lib/workspace-api-mocks.js"), "?")}; importers {len(mocks)}: {", ".join(mocks)}')
print(f'- lib/workspace-kpis-cache.js area under old guide at d7ceb373: {next((x["fromArea"] for x in edges("d7ceb373", "old-5334c81a") if x["from"] == "lib/workspace-kpis-cache.js"), "?")}; under HEAD guide: {next((x["fromArea"] for x in e if x["from"] == "lib/workspace-kpis-cache.js"), "?")}')

section('S10. Scripts outside the tool scope that import lib/ (LIN-4200, HEAD)')
for p in ['scripts/lin-4200-d13-volume-timing.mjs', 'scripts/lin-4200-measure-records-vs-snapshots.mjs']:
    libs = re.findall(r"from '\.\./lib/([^']+)'", show(H, p))
    print(f'- {p}: {", ".join(libs)}')

section('S11. Change-coupling window overlap (from cochange JSON and the commit lists in this folder)')
cb = json.load(open(os.path.join(EV, 'cochange-code-5334c81a-guide-head-d7ceb373-days60.json')))
ch = json.load(open(os.path.join(EV, 'cochange-code-d7ceb373-guide-head-d7ceb373-days60.json')))
p = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
ov = (min(p(cb['windowEnd']), p(ch['windowEnd'])) - max(p(cb['windowStart']), p(ch['windowStart']))).total_seconds() / 86400
wb = set(open(os.path.join(EV, 'cochange-window-commits-5334c81a.txt')).read().split())
wh = set(open(os.path.join(EV, 'cochange-window-commits-d7ceb373.txt')).read().split())
print(f'- windows {cb["windowStart"]}..{cb["windowEnd"]} and {ch["windowStart"]}..{ch["windowEnd"]}: overlap {ov:.3f} of 60 days ({ov / 60 * 100:.2f}%)')
print(f'- commits {len(wb)} vs {len(wh)} (match cochange changes {cb["changes"]} / {ch["changes"]}); shared {len(wb & wh)}; only 5334c81a {len(wb - wh)}; only d7ceb373 {len(wh - wb)}')

section('S12. No-link change-coupling pairs: which commits drive Agent API + Reports and Agent API + Other (HEAD guide, d7ceb373 window)')
guide = json.load(open(os.path.join(EV, 'areas.head-d7ceb373.json')))['areas']
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
for A, Bn in [('Agent API (proxy)', 'Reports & operator tools'), ('Agent API (proxy)', 'Other features')]:
    hits = []
    for c in commits:
        areas = {area_of(f) for f in c['files']}
        if A in areas and Bn in areas:
            hits.append(git('log', '-1', '--format=%h %s', c['sha']).strip()[:90])
    print(f'- {A} + {Bn}: {len(hits)} commits')
    for h in hits:
        print(f'    {h}')

section('S13. Simple Dispatcher module format (outside seams.mjs)')
sd = os.environ.get('SD_DIR')
if sd and os.path.isdir(sd):
    sha = git('rev-parse', 'origin/main', cwd=sd).strip()
    d = git('show', f'{sha}:dispatcher.js', cwd=sd)
    pkg = json.loads(git('show', f'{sha}:package.json', cwd=sd))
    print(f'- simple-dispatcher origin/main {sha}: dispatcher.js require( lines {len(re.findall(r"require\(", d))}; import/export lines {len(re.findall(r"^(import|export) ", d, re.M))}; package.json "type": {pkg.get("type")}')
else:
    print('- SD_DIR not set; not read')

section('S14. Survey place ledger rows this report cross-links (read only)')
try:
    ref = 'origin/claude/cool-rubin-6acj5j'
    sha = git('rev-parse', ref).strip()
    led = show(ref, 'docs/plans/survey/place-ledger.md').splitlines()
    print(f'- {ref} = {sha}')
    for i, l in enumerate(led, 1):
        if l.startswith('| LIN-4201') or l.startswith('| LIN-4203'):
            print(f'    place-ledger.md:{i}: {l[:160]}')
except SystemExit as e:
    print(f'- not readable: {e}')

section('S15. Entry files / files / internal imports per area, each combination (seams.areas)')
combos = [('5334c81a', 'old-5334c81a'), ('5334c81a', 'head-d7ceb373'), ('d7ceb373', 'old-5334c81a'), ('d7ceb373', 'head-d7ceb373')]
D = {c: json.load(open(os.path.join(EV, f'seams-code-{c[0]}-guide-{c[1]}.json'))) for c in combos}
print('| area | ' + ' | '.join(f'{c[0]}x{c[1]}' for c in combos) + ' |')
for a in D[combos[3]]['areas']:
    cells = []
    for c in combos:
        x = next(y for y in D[c]['areas'] if y['name'] == a['name'])
        cells.append(f"{len(x['entryFiles'])}/{x['files']} int {x['internalImports']}")
    print(f"| {a['name']} | " + ' | '.join(cells) + ' |')
