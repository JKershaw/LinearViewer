#!/usr/bin/env python3
"""Decision-level exposure (M2) and inconsistent changes (M3) for coherence-as-it-grows, round 2.

Usage, from the repository root (read-only against git; writes only to --out):

  python3 -I docs/papers/harbour/coherence-as-it-grows-scripts/decision-exposure.py \\
      --prs    <scratch>/data/prs.json \\
      --tickets <scratch>/data/ticket-outcomes.json \\
      --exposure <scratch>/data/exposure.json \\
      --readings <scratch>/results/B/m3-readings.json \\
      --out    <scratch>/results/B [--since 2026-06-01] [--window 15] [--file-sites]

  Sensitivities used in the round-2 write-up: `--window 3` (a hunk must lie within ±3 lines of a
  site) and `--file-sites` (every match of a decision in one file is one site, the census's unit).
  --readings is the reader's hand reading of the M3 pairs (written after the first run from the
  m3-pairs.tsv this script emits); without it every pair is reported as unread.

Inputs
  docs/papers/harbour/coherence-as-it-grows-census.json  knownDecisions.decisions: 11 regexes (git grep -E)
  docs/papers/harbour/coherence-as-it-grows-codes.json   admissions.twins / admissions.hits (33 live twins)
  prs.json            merged PRs (pr, sha, day, ticket, prodFiles, prodAdded, prodDeleted ...)
  ticket-outcomes.json per-ticket cost fields (sendbacks, planSendbacks, reviewLegs, escapesIntroduced,
                      sessions, hours, noLineage, size, labels)
  exposure.json       version-1's per-PR file-level `exposed` flag (optional; for the cross-tab)

Method
  A decision's SITES at a month-end snapshot are (named decisions) every production line matching
  the census regex, and (twins) the admission comment line(s) plus the partner declaration(s) named
  in the TWINS table below, resolved by `git grep -n -E` at that snapshot. Lines of one decision in
  one file within WINDOW lines of each other chain-merge into one site. A twin is live at a snapshot
  only if at least one of its admission anchors is found there.
  For each PR on/after --since, the snapshot is the last month-end before the PR's day; its sites
  are relocated into the PR's pre-change version (first parent) by exact line text, else by regex,
  nearest the snapshot line. A PR TOUCHES a site when a hunk of `git diff --unified=0 parent sha`
  has an old-side range within ±WINDOW lines of the site; it ADDS/REMOVES a site when the net count
  of added-minus-removed lines matching the decision's pattern is positive/negative. A PR is
  decision-exposed if it touches, adds or removes any site.
  M3: for every (PR, decision) with 1 <= touched < total, every later PR within 30 days that touched
  a site of the same decision not in the first PR's touched set is a sibling edit; the script scores
  it on subject / ticket / diff keywords and the Bug label, and the reader records a final reading.

Outputs (in --out): results.json, tables.md, m3-cases.md
"""
import argparse
import collections
import json
import os
import re
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
CENSUS = os.path.join(REPO, 'docs/papers/harbour/coherence-as-it-grows-census.json')
CODES = os.path.join(REPO, 'docs/papers/harbour/coherence-as-it-grows-codes.json')

SNAPSHOTS = [  # month-end snapshots (last first-parent commit of the month)
    ('2026-05', '05d33f51'), ('2026-06', '462ecafd'), ('2026-07', 'a208d6b3'),
    ('2026-08', '8b2be424'), ('2026-09', '982fc662'), ('2026-10', 'd61903f3'),
]
PROD_PATHS = ['server.js', 'lib', 'routes', 'public']
PROD_RE = re.compile(r'^(server\.js|lib/.*|routes/.*|public/.*)$')
NOT_PROD_RE = re.compile(r'vendor|\.min\.')
KEYWORDS = re.compile(r'\b(fix|fixes|fixed|fixing|sibling|siblings|also|parity|same|align|aligns|aligned|'
                      r'mirror|mirrors|mirrored|missed|missing|drift|drifted)\b', re.I)
STRONG_KEYWORDS = re.compile(r'\b(sibling|siblings|parity|mirror|mirrors|mirrored|align|aligns|aligned|'
                             r'drift|drifted|missed|lockstep|in sync)\b', re.I)


def is_prod(path):
    return bool(PROD_RE.match(path)) and not NOT_PROD_RE.search(path) and path.endswith(('.js', '.mjs'))


# ---------------------------------------------------------------------------------------------
# The 33 twins (codes.json admissions.twins, in order). Each has ANCHORS (regex over the admission
# comment, in the file the hit names) and PARTNERS (the second site: a declaration regex in the
# partner file, or a whole non-production document). `note` records the judgement call.
# ---------------------------------------------------------------------------------------------
TWINS = [
    dict(anchors=[('lib/chat-tools.js', r'loop-local mirror of routes/dashboard\.js')],
         partners=[('routes/dashboard.js', r'function isTerminalLoop\(')]),
    dict(anchors=[('lib/connection-credential.js', r'runConnectionRefresh. CASes it first')],
         partners=[('lib/connection-store.js', r'async mirrorCredentialIfToken\('),
                   ('lib/connection-credential.js', r'async function runConnectionRefresh\(')],
         note='partner = the row-mirror writer (connection-store.mirrorCredentialIfToken) and the record writer (runConnectionRefresh)'),
    dict(anchors=[('lib/db-indexes.js', r'keep the two in lockstep')],
         partners=[('lib', r'\.sort\(\{ ?timestamp: ?-1, ?(_seq: ?-1, ?)?_id: ?-1 ?\}\)')],
         note='partner = every paged-list sort in lib/ that the index keys must match'),
    dict(anchors=[('lib/dispatch-repo-guard.js', r'keeps the two in sync')],
         partners=[], note='UNRESOLVED partner: the runner host namespace lives in simple-dispatcher (cross-repo)'),
    dict(anchors=[('lib/dispatch-store.js', r'archive allow-list must stay in step')],
         partners=[('lib/dispatch-store.js', r'async addItem\(')]),
    dict(anchors=[('lib/dispatch-store.js', r'de-dupe \(copied from .countDistinctTasksForSession')],
         partners=[('lib/dispatch-store.js', r'async countDistinctTasksForSession\(')]),
    dict(anchors=[('lib/flight-companion-gate.js', r'restated from lib/observer-sweep\.js')],
         partners=[('lib/observer-sweep.js', r'const LANE_KEYS = ')]),
    dict(anchors=[('lib/periodical-runs.js', r'Copied verbatim from')],
         partners=[('lib/live-console.js', r'function _epoch\(')]),
    dict(anchors=[('lib/prompts/autopilot-kickoff.js', r'keep in sync with docs/autopilot-kickoff\.md')],
         partners=[('docs/autopilot-kickoff.md', None)],
         note='partner is a non-production document; any hunk in it counts as touching the partner site'),
    dict(anchors=[('lib/prompts/autopilot-manual.js', r'must stay byte-identical to the manual')],
         partners=[('docs/autopilot-operating-manual.md', r"^## The human's edge, and how to hand back")],
         note='partner is a heading line in a non-production document'),
    dict(anchors=[('lib/providers/interface.js', r'Keep this in sync with the method declarations below')],
         partners=[('lib/providers/interface.js', r'^export class ProviderInterface')],
         note='partner = the base class whose method declarations the PROVIDER_SURFACE list restates'),
    dict(anchors=[('lib/providers/jira/adf.js', r'keep this list in lockstep with those three functions')],
         partners=[('lib/providers/jira/adf.js', r'^function (parseBlock|parseInline|parseParagraphContent)\(')]),
    dict(anchors=[('lib/render-settings.js', r'hand-mirrored across')],
         partners=[], note='UNRESOLVED partner: CLAUDE_MAPPABLE_MODEL_FAMILIES lives in simple-dispatcher (cross-repo)'),
    dict(anchors=[('lib/render-settings.js', r'Mirrored in public/common\.js')],
         partners=[('public/common.js', r'^const DISPATCH_MODEL_OTHER_VALUE = ')]),
    dict(anchors=[('lib/render-ship-biscuit.js', r'Kept in lockstep with'),
                  ('public/ship-biscuit.js', r'Kept in lockstep with lib/render-ship-biscuit\.js')],
         partners=[('lib/render-ship-biscuit.js', r'^const (COLUMN_WEIGHT_FLOOR|DESK_ORDER) = '),
                   ('public/ship-biscuit.js', r'^  var (COLUMN_WEIGHT_FLOOR|DESK_ORDER) = ')]),
    dict(anchors=[('lib/render-ship-biscuit.js', r'mirrored in public/ship-biscuit\.js')],
         partners=[('public/ship-biscuit.js', r'function layoutIndex\(')]),
    dict(anchors=[('lib/render.js', r"Kept in sync with that endpoint's .allowedHosts")],
         partners=[('routes', r'const allowedHosts = new Set\(')],
         note='partner = the /api/image relay allowlist (routes/workspace-api.js at every snapshot)'),
    dict(anchors=[('lib/run-view.js', r'Same rule as .routes/dashboard\.js')],
         partners=[('routes/dashboard.js', r'function isStandaloneSession\(')]),
    dict(anchors=[('lib/ship-layout.js', r'Mirrored in public/common\.js \(window\.computeFitZoom\)'),
                  ('public/common.js', r'Mirror of lib/ship-layout\.js')],
         partners=[('lib/ship-layout.js', r'^export function computeFitZoom\('),
                   ('public/common.js', r'^window\.computeFitZoom = ')]),
    dict(anchors=[('lib/transcript-spend.js', r'kept in lockstep with wall-clock-summary\.js')],
         partners=[('lib/wall-clock-summary.js', r'^const CI_TEST_SIGNATURE = ')],
         note='partner = CI_TEST_SIGNATURE (the "signature" the comment names, by content not name)'),
    dict(anchors=[('lib/workspace.js', r"rotate the matching binding's credentials in lockstep"),
                  ('lib/workspace.js', r'writes the legacy scalar mirror')],
         partners=[], note='both writers of the scalar mirror are the two admission sites themselves; no further partner'),
    dict(anchors=[('public/audit.js', r'client-side mirrors of lib/components')],
         partners=[('lib/components/status-pill.js', r'^const STATE_GLYPHS = '),
                   ('lib/components/card.js', r'^export function renderCard\('),
                   ('lib/components/field.js', r'^export function renderField\('),
                   ('lib/components/tag.js', r'^export function renderTag\('),
                   ('lib/components/disclosure.js', r'^export function renderDisclosure\(')],
         note='partners = the five primitives the comment lists (renderCard/renderField/renderStatusPill/renderTag/renderDisclosure) plus STATE_GLYPHS'),
    dict(anchors=[('public/common.js', r'Mirror of lib/timeline-zoom\.js'),
                  ('public/common.js', r'lib/timeline-zoom\.js timelineRunOverlapsWindow')],
         partners=[('lib/timeline-zoom.js', r'^export function (computeTimelineZoom|computeTimelinePan|timelineRunOverlapsWindow|computeTimelineFit)\(')]),
    dict(anchors=[('public/common.js', r'ONE replica, many consumers, no drift')],
         partners=[('lib/components/status-pill.js', r'^export function renderStatusPill\('),
                   ('lib/components/surface.js', r'^export function renderSurface\('),
                   ('lib/components/tag.js', r'^export function (renderTag|renderChip)\(')]),
    dict(anchors=[('public/observation.js', r'Must stay byte-identical to lib/render-observation\.js')],
         partners=[('lib/render-observation.js', r'as proposed</button>')]),
    dict(anchors=[('public/ship.js', r'Popover behaviour copied from swim\.js')],
         partners=[('public/swim.js', r'^function showPopover\('), ('public/ship.js', r'function openPopover\(')],
         note='the copy itself (ship.js openPopover) is a site; the admission sits in the file header far from it'),
    dict(anchors=[('public/ship.js', r'mirrored from lib/tree\.js'), ('public/swim.js', r'mirrored from lib/tree\.js'),
                  ('public/swipe.js', r'mirrored from lib/tree\.js')],
         partners=[('lib', r'^export const TERMINAL_STATE_TYPES = ')],
         note='lib/tree.js lost the literal after May; the symbol (TERMINAL_STATE_TYPES) is followed wherever it lives in lib/'),
    dict(anchors=[('public/ship.js', r'Layout primitives \(mirror of lib/ship-layout\.js\)'),
                  ('public/ship.js', r'Mirror of lib/ship-layout\.js'),
                  ('public/ship.js', r'mirror of lib/ship-layout\.js orientation path')],
         partners=[('lib/ship-layout.js', r'^export (const SECTORS = |function (computeShipReachableIds|computeProximityRings|orderByDependency|resolveCollisions|orientationLayout)\()')]),
    dict(anchors=[('public/swim.js', r'client-side copy of lib/swim-lanes\.js'), ('public/swim.js', r'prevents importing from lib/')],
         partners=[('lib/swim-lanes.js', r'^export function assignLanes\('), ('lib/swim-lanes.js', r'^const SEGMENT_RANK = '),
                   ('public/swim.js', r'^function assignLanes\(')]),
    dict(anchors=[('routes/dispatch.js', r'recent counterpart stay in sync by value'),
                  ('routes/dispatch.js', r'Validation is copied verbatim from the recents POST')],
         partners=[('routes/dispatch.js', r"router\.post\('/workspace/:urlKey/api/dispatch/(recent|favorite)-prompts'")]),
    dict(anchors=[('routes/proxy-dispatch.js', r'parity with routes/dispatch\.js')],
         partners=[('routes/dispatch.js', r'maxTasks: maxTasks \?\? null')],
         note='partner = the line in routes/dispatch.js that stores the same bound'),
    dict(anchors=[('routes/proxy-reads.js', r"Kept in lockstep with discovery's UPLOAD_HOSTS")],
         partners=[('lib/proxy-wire.js', r'^const (LINEAR_)?UPLOAD_HOSTS = ')]),
    dict(anchors=[('server.js', r'Both .intervalMs. constants below MUST stay the same value')],
         partners=[('server.js', r'intervalMs: OBSERVER_SWEEP_INTERVAL_MS')]),
]


def git(*args, check=True):
    r = subprocess.run(['git', '-C', REPO] + list(args), capture_output=True, text=True)
    if check and r.returncode not in (0, 1):
        raise RuntimeError(f'git {args[:3]} failed: {r.stderr[:200]}')
    return r.stdout


def git_grep(sha, pattern, paths):
    out = git('grep', '-n', '-E', pattern, sha, '--', *paths)
    rows = []
    for line in out.splitlines():
        rest = line.split(':', 1)[1]  # strip "sha:"
        file, ln, text = rest.split(':', 2)
        rows.append((file, int(ln), text))
    return rows


_file_cache = {}


def file_lines(sha, path):
    key = (sha, path)
    if key not in _file_cache:
        r = subprocess.run(['git', '-C', REPO, 'show', f'{sha}:{path}'], capture_output=True, text=True)
        _file_cache[key] = r.stdout.split('\n') if r.returncode == 0 else None
        if len(_file_cache) > 4000:
            _file_cache.clear()
    return _file_cache[key]


def cluster(members, window):
    """members: list of dicts with file, line. Chain-merge lines within `window` in the same file."""
    out = []
    byfile = collections.defaultdict(list)
    for m in members:
        byfile[m['file']].append(m)
    for file, ms in byfile.items():
        ms.sort(key=lambda m: m['line'])
        cur = None
        for m in ms:
            if cur and m['line'] - cur['hi'] <= window:
                cur['hi'] = m['line']
                cur['members'].append(m)
            else:
                cur = dict(file=file, lo=m['line'], hi=m['line'], members=[m])
                out.append(cur)
    for c in out:
        first = c['members'][0]
        c['key'] = f"{c['file']}::{first['kind']}::{first['text'].strip()[:50]}"
    # ordinal disambiguation for identical keys in one file
    seen = collections.Counter()
    for c in out:
        n = seen[c['key']]
        seen[c['key']] += 1
        if n:
            c['key'] += f'#{n}'
    return out


def sites_at(sha, decisions, twins, window):
    """Return (sites, diag). sites: decision name -> list of clusters."""
    sites, diag = {}, {}
    for name, pat in decisions.items():
        rows = [(f, l, t) for f, l, t in git_grep(sha, pat, PROD_PATHS) if is_prod(f)]
        members = [dict(file=f, line=l, text=t, pat=pat, kind='named') for f, l, t in rows]
        sites[name] = cluster(members, window)
        diag[name] = dict(matches=len(rows), files=len(set(f for f, _, _ in rows)), sites=len(sites[name]))
    for i, tw in enumerate(twins):
        name = tw['name']
        anchors, partners, missing = [], [], []
        for file, pat in tw['anchors']:
            rows = git_grep(sha, pat, [file])
            if not rows:
                missing.append(f'anchor {file} /{pat}/')
            anchors += [dict(file=f, line=l, text=t, pat=pat, kind='anchor') for f, l, t in rows]
        if not anchors:
            sites[name] = []
            diag[name] = dict(live=False, anchors=0, partners=0, sites=0, missing=missing)
            continue
        for file, pat in tw['partners']:
            if pat is None:  # whole-document partner
                exists = git('ls-tree', sha, '--', file).strip() != ''
                if exists:
                    partners.append(dict(file=file, line=1, text='', pat='', kind='document', whole=True))
                else:
                    missing.append(f'document {file}')
                continue
            rows = git_grep(sha, pat, [file])
            if not rows:
                missing.append(f'partner {file} /{pat}/')
            partners += [dict(file=f, line=l, text=t, pat=pat, kind='partner') for f, l, t in rows]
        cl = cluster(anchors + partners, window)
        sites[name] = cl
        diag[name] = dict(live=True, anchors=len(anchors), partners=len(partners), sites=len(cl), missing=missing)
    return sites, diag


HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def parse_diff(parent, sha, paths):
    out = git('diff', '--no-renames', '--unified=0', parent, sha, '--', *paths)
    files, cur, hunk = {}, None, None
    for line in out.split('\n'):
        if line.startswith('diff --git '):
            m = re.match(r'diff --git a/(.*) b/(.*)$', line)
            cur = m.group(2)
            files[cur] = []
            hunk = None
        elif line.startswith('@@'):
            m = HUNK_RE.match(line)
            a, b = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            c, d = int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
            hunk = dict(oldStart=a, oldCount=b, newStart=c, newCount=d, added=[], removed=[])
            files[cur].append(hunk)
        elif hunk is not None and line.startswith('+') and not line.startswith('+++'):
            hunk['added'].append(line[1:])
        elif hunk is not None and line.startswith('-') and not line.startswith('---'):
            hunk['removed'].append(line[1:])
    return files


def hunk_old_range(h):
    if h['oldCount'] == 0:  # pure insertion after old line oldStart
        return (h['oldStart'], h['oldStart'] + 1)
    return (h['oldStart'], h['oldStart'] + h['oldCount'] - 1)


def relocate(cluster_, parent, stats):
    """Find the cluster's member lines in the parent version. Returns (lo, hi, method) or None."""
    if cluster_['members'][0].get('whole'):
        return ('document', 'document')
    lines = file_lines(parent, cluster_['file'])
    if lines is None:
        stats['fileMissingInParent'] += 1
        return None
    found = []
    for m in cluster_['members']:
        want = m['text'].strip()
        cands = [i + 1 for i, l in enumerate(lines) if l.strip() == want]
        if not cands:
            try:
                rx = re.compile(m['pat'])
                cands = [i + 1 for i, l in enumerate(lines) if rx.search(l)]
            except re.error:
                cands = []
            if cands:
                stats['relocatedByRegex'] += 1
        if cands:
            found.append(min(cands, key=lambda c: abs(c - m['line'])))
    if not found:
        stats['unrelocatable'] += 1
        return None
    stats['relocated'] += 1
    if abs(min(found) - cluster_['lo']) > 15:
        stats['driftOver15'] += 1
    return (sorted(set(found)), 'text')


def analyse_pr(pr, parent, snapshot_sites, decisions, twins, window, stats):
    doc_paths = sorted({f for tw in twins for f, p in tw['partners'] if f.startswith('docs/')})
    diff = parse_diff(parent, pr['sha'], PROD_PATHS + doc_paths)
    diff = {f: h for f, h in diff.items() if is_prod(f) or f in doc_paths}
    result = {}
    for name, clusters in snapshot_sites.items():
        total = len(clusters)
        touched, touched_exact, touched_near3 = [], [], []
        contexts = {}
        for c in clusters:
            hunks = diff.get(c['file'])
            if not hunks:
                continue
            rel = relocate(c, parent, stats)
            if rel is None:
                continue
            lines_, _ = rel
            hit = exact = near3 = False
            ctx = []
            for h in hunks:
                a, b = hunk_old_range(h)
                if lines_ == 'document':  # whole-document partner: any hunk touches it
                    hit = near3 = exact = True
                    ctx += h['added'][:40]
                    continue
                # a hunk touches the site when its old-side range lies within ±window of any member line
                if any(a <= ln + window and b >= ln - window for ln in lines_):
                    hit = True
                    ctx += h['added'][:40] + ['-' + l for l in h['removed'][:10]]
                if any(a <= ln + 3 and b >= ln - 3 for ln in lines_):
                    near3 = True
                if any(a <= ln and b >= ln for ln in lines_):
                    exact = True
            if hit:
                touched.append(c['key'])
                contexts[c['key']] = ctx[:60]
            if near3:
                touched_near3.append(c['key'])
            if exact:
                touched_exact.append(c['key'])
        # added / removed pattern matches
        added = removed = 0
        if name in decisions:
            rx = re.compile(decisions[name])
            for f, hunks in diff.items():
                if not is_prod(f):
                    continue
                net = sum(1 for h in hunks for l in h['added'] if rx.search(l)) - \
                      sum(1 for h in hunks for l in h['removed'] if rx.search(l))
                added += max(0, net)
                removed += max(0, -net)
        else:
            tw = next(t for t in twins if t['name'] == name)
            for file, pat in tw['anchors'] + [(f, p) for f, p in tw['partners'] if p]:
                targets = [f for f in diff if f == file or (not file.endswith('.js') and not file.endswith('.md') and f.startswith(file + '/'))]
                rx = re.compile(pat)
                for f in targets:
                    net = sum(1 for h in diff[f] for l in h['added'] if rx.search(l)) - \
                          sum(1 for h in diff[f] for l in h['removed'] if rx.search(l))
                    added += max(0, net)
                    removed += max(0, -net)
        if touched or added or removed:
            result[name] = dict(total=total, touched=len(touched), touchedSites=touched,
                                touchedNear3=len(touched_near3), touchedExact=len(touched_exact),
                                added=added, removed=removed,
                                all=(total > 0 and len(touched) == total),
                                subset=(1 <= len(touched) < total))
            ctx_store[(pr['pr'], name)] = contexts
    return result


ctx_store = {}


def median(xs):
    return statistics.median(xs) if xs else None


def p75(xs):
    if not xs:
        return None
    xs = sorted(xs)
    k = 0.75 * (len(xs) - 1)
    f = int(k)
    return xs[f] if f + 1 >= len(xs) else xs[f] + (xs[f + 1] - xs[f]) * (k - f)


def mean(xs):
    return (sum(xs) / len(xs)) if xs else None


def fmt(x, nd=2):
    if x is None:
        return '–'
    if isinstance(x, float):
        return f'{x:.{nd}f}'
    return str(x)


def pr_subjects(pr, parents):
    if len(parents) >= 2:
        out = git('log', '--format=%s', f'{pr["sha"]}^2', f'^{pr["sha"]}^1')
        subs = [s for s in out.splitlines() if s.strip()]
        if subs:
            return subs
    return [git('log', '-1', '--format=%s', pr['sha']).strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prs', required=True)
    ap.add_argument('--tickets', required=True)
    ap.add_argument('--exposure')
    ap.add_argument('--out', required=True)
    ap.add_argument('--since', default='2026-06-01')
    ap.add_argument('--window', type=int, default=15, help='±lines around a site that count as touching it')
    ap.add_argument('--file-sites', action='store_true', help='sensitivity: one site per file (all matches in a file merge)')
    ap.add_argument('--readings', help='JSON {"<firstPr>|<decision>|<laterPr>": {"reading": "sibling-fix|unrelated|unclear", "note": "..."}}')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    W = args.window
    CW = 10 ** 9 if args.file_sites else W  # clustering window

    census = json.load(open(CENSUS))['knownDecisions']
    decisions = census['decisions']
    codes = json.load(open(CODES))['admissions']
    twins = []
    for i, tw in enumerate(codes['twins']):
        t = dict(TWINS[i])
        t['name'] = 'twin: ' + tw['decision']
        t['firstDeclared'] = tw['firstDeclared']
        t['hits'] = [dict(file=codes['hits'][h]['file'], line=codes['hits'][h]['line']) for h in tw['hits']]
        twins.append(t)
    prs = [r for r in json.load(open(args.prs)) if r['day'] >= args.since]
    tickets = {r['ticket']: r for r in json.load(open(args.tickets))}
    v1 = {}
    if args.exposure:
        v1 = {r['pr']: r['exposed'] for r in json.load(open(args.exposure))}

    # ---- sites per snapshot --------------------------------------------------------------
    snap_sites, snap_diag = {}, {}
    for month, sha in SNAPSHOTS:
        s, d = sites_at(sha, decisions, twins, CW)
        snap_sites[month] = s
        snap_diag[month] = d
        snap_day = git('log', '-1', '--format=%cs', sha).strip()
        for t in twins:  # keep only the unexpected misses: anchors missing after firstDeclared, partners missing while live
            dd = d[t['name']]
            dd['missing'] = [m for m in dd.get('missing', []) if not (m.startswith('anchor') and snap_day < t['firstDeclared'])]
        print(f'sites at {month} {sha}: ' + ', '.join(f'{k}={v["sites"]}' for k, v in d.items() if k in decisions), file=sys.stderr)
    months = [m for m, _ in SNAPSHOTS]

    # ---- parents ------------------------------------------------------------------------
    out = git('rev-list', '--no-walk', '--parents', *[r['sha'] for r in prs])
    parents = {}
    for line in out.splitlines():
        parts = line.split()
        parents[parts[0][:8]] = parts[1:]

    # ---- per-PR analysis ----------------------------------------------------------------
    stats = collections.Counter()
    per_pr = []
    for n, pr in enumerate(prs):
        month = pr['day'][:7]
        snap_month = months[months.index(month) - 1]
        ps = parents[pr['sha']]
        parent = ps[0]
        res = analyse_pr(pr, parent, snap_sites[snap_month], decisions, twins, W, stats)
        exposed = bool(res)
        per_pr.append(dict(pr=pr['pr'], sha=pr['sha'], day=pr['day'], month=month, ticket=pr['ticket'],
                           snapshot=snap_month, mergeParents=len(ps), prodLines=pr['prodAdded'] + pr['prodDeleted'],
                           prodFiles=len(pr['prodFiles']), decisions=res, exposed=exposed,
                           touchExposed=any(d['touched'] for d in res.values()),
                           addOnly=exposed and not any(d['touched'] for d in res.values()),
                           exposedNear3=any(d['touchedNear3'] or d['added'] or d['removed'] for d in res.values()),
                           exposedExact=any(d['touchedExact'] or d['added'] or d['removed'] for d in res.values()),
                           v1Exposed=v1.get(pr['pr'])))
        if n % 200 == 0:
            print(f'  {n}/{len(prs)} PRs', file=sys.stderr)
    by_pr = {p['pr']: p for p in per_pr}

    # ---- M2.1 exposed share by month + cross-tab -----------------------------------------
    m2_month = {}
    for m in months[1:]:
        rows = [p for p in per_pr if p['month'] == m]
        m2_month[m] = dict(prs=len(rows), exposed=sum(p['exposed'] for p in rows),
                           touchExposed=sum(p['touchExposed'] for p in rows), addOnly=sum(p['addOnly'] for p in rows),
                           exposedNear3=sum(p['exposedNear3'] for p in rows), exposedExact=sum(p['exposedExact'] for p in rows),
                           v1Exposed=sum(1 for p in rows if p['v1Exposed']))
    xtab = collections.Counter((p['exposed'], bool(p['v1Exposed'])) for p in per_pr if p['v1Exposed'] is not None)

    # ---- M2.2 size as outcome -----------------------------------------------------------
    m2_size = {}
    for m in ['pooled'] + months[1:]:
        rows = [p for p in per_pr if m == 'pooled' or p['month'] == m]
        cell = {}
        for label, grp in (('exposed', [p for p in rows if p['exposed']]), ('not', [p for p in rows if not p['exposed']])):
            L = [p['prodLines'] for p in grp]
            F = [p['prodFiles'] for p in grp]
            cell[label] = dict(n=len(grp), linesMedian=median(L), linesP75=p75(L), filesMedian=median(F), filesP75=p75(F))
        m2_size[m] = cell

    # ---- M2.3 cost via tickets ----------------------------------------------------------
    t_exposed = collections.defaultdict(bool)
    t_prs = collections.defaultdict(list)
    for p in per_pr:
        if p['ticket']:
            t_prs[p['ticket']].append(p['pr'])
            t_exposed[p['ticket']] = t_exposed[p['ticket']] or p['exposed']
    joined = [tickets[t] for t in t_prs if t in tickets]

    def band(size):
        return '0' if size == 0 else '1-49' if size < 50 else '50-299' if size < 300 else '300+'

    def cost_cell(rows):
        lin = [r for r in rows if not r['noLineage']]
        return dict(n=len(rows), sendbacks=mean([r['sendbacks'] for r in rows]), planSendbacks=mean([r['planSendbacks'] for r in rows]),
                    reviewLegs=mean([r['reviewLegs'] for r in rows]), escapesIntroduced=mean([r['escapesIntroduced'] for r in rows]),
                    sendbackShare=mean([1 if r['sendbacks'] else 0 for r in rows]),
                    escapeShare=mean([1 if r['escapesIntroduced'] else 0 for r in rows]),
                    nLineage=len(lin), sessions=mean([r['sessions'] for r in lin]), hoursMedian=median([r['hours'] for r in lin]),
                    sizeMedian=median([r['size'] for r in rows]))

    m2_cost = {}
    for grp_name, pred in (('pooled', lambda r: True), ('1-49', lambda r: band(r['size']) == '1-49'),
                           ('50-299', lambda r: band(r['size']) == '50-299'), ('300+', lambda r: band(r['size']) == '300+'),
                           ('0', lambda r: band(r['size']) == '0')):
        rows = [r for r in joined if pred(r)]
        m2_cost[grp_name] = dict(exposed=cost_cell([r for r in rows if t_exposed[r['ticket']]]),
                                 not_exposed=cost_cell([r for r in rows if not t_exposed[r['ticket']]]))
    m2_cost_month = {}
    for m in months[1:]:
        rows = [r for r in joined if r['firstDay'][:7] == m]
        m2_cost_month[m] = dict(exposed=cost_cell([r for r in rows if t_exposed[r['ticket']]]),
                                not_exposed=cost_cell([r for r in rows if not t_exposed[r['ticket']]]))

    # ---- M2.4 N-place edits -------------------------------------------------------------
    nplace = collections.defaultdict(lambda: collections.Counter())
    allsites = collections.defaultdict(lambda: collections.Counter())
    for p in per_pr:
        for name, d in p['decisions'].items():
            if d['touched'] >= 2:
                nplace[name][p['month']] += 1
            if d['all'] and d['total'] >= 2:
                allsites[name][p['month']] += 1

    # ---- M3 ------------------------------------------------------------------------------
    subject_cache = {}

    def subjects(p):
        if p['pr'] not in subject_cache:
            subject_cache[p['pr']] = pr_subjects(p, parents[p['sha']])
        return subject_cache[p['pr']]

    def day_add(day, n):
        import datetime
        return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()

    cases = []
    readings = json.load(open(args.readings)) if args.readings else {}
    subset_edits = 0
    followed = set()
    for p in per_pr:
        for name, d in p['decisions'].items():
            if not d['subset']:
                continue
            subset_edits += 1
            first = set(d['touchedSites'])
            horizon = day_add(p['day'], 30)
            for q in per_pr:
                later = q['day'] > p['day'] or (q['day'] == p['day'] and q['pr'] > p['pr'])
                if not later or q['day'] > horizon:
                    continue
                dq = q['decisions'].get(name)
                if not dq:
                    continue
                other = [s for s in dq['touchedSites'] if s not in first]
                if not other:
                    continue
                followed.add((p['pr'], name))
                subs = subjects(q)
                tq = tickets.get(q['ticket'] or '', {})
                tp = tickets.get(p['ticket'] or '', {})
                signals = []
                if q['ticket'] and q['ticket'] == p['ticket']:
                    signals.append('same-ticket')
                if p['ticket'] and any(p['ticket'] in s for s in subs):
                    signals.append('cites-first-ticket')
                if 'Bug' in tq.get('labels', []):
                    signals.append('Bug-label')
                kw = sorted({m.group(1).lower() for s in subs for m in KEYWORDS.finditer(s)})
                if kw:
                    signals.append('subject:' + ','.join(kw))
                # diff context at the sibling site: added/removed lines of the hunks that touched it
                ctx_kw = set()
                ctx_lines = []
                for s in other:
                    for l in ctx_store.get((q['pr'], name), {}).get(s, []):
                        ctx_lines.append(l)
                        for m in STRONG_KEYWORDS.finditer(l):
                            ctx_kw.add(m.group(1).lower())
                        if p['ticket'] and p['ticket'] in l:
                            ctx_kw.add(p['ticket'])
                if ctx_kw:
                    signals.append('diff:' + ','.join(sorted(ctx_kw)))
                strong = any(s.startswith('cites-first-ticket') or s.startswith('diff:') for s in signals) or \
                    any(STRONG_KEYWORDS.search(s) for s in subs)
                auto = 'sibling-fix?' if strong else ('candidate' if signals else 'unrelated')
                key = f"{p['pr']}|{name}|{q['pr']}"
                cases.append(dict(key=key, firstPr=p['pr'], firstDay=p['day'], firstTicket=p['ticket'], firstSubject=subjects(p)[0],
                                  decision=name, touched=d['touched'], total=d['total'], firstSites=sorted(first),
                                  laterPr=q['pr'], laterDay=q['day'], laterTicket=q['ticket'], laterSubjects=subs[:3],
                                  laterSites=other, laterTouched=dq['touched'], laterTotal=dq['total'],
                                  signals=signals, autoReading=auto, context=ctx_lines[:12],
                                  reading=readings.get(key, {}).get('reading'), readingNote=readings.get(key, {}).get('note')))

    # ---- write results.json -------------------------------------------------------------
    results = dict(
        groundedAt='d61903f3', since=args.since, window=W, prs=len(prs),
        snapshots=dict(SNAPSHOTS),
        siteCounts={m: {k: v for k, v in snap_diag[m].items()} for m in months},
        twinTable=[dict(name=t['name'], firstDeclared=t['firstDeclared'], anchors=t['anchors'], partners=t['partners'], note=t.get('note')) for t in twins],
        relocationStats=dict(stats),
        m2=dict(byMonth=m2_month, crossTabWithV1={f'decision={a},v1={b}': n for (a, b), n in sorted(xtab.items())},
                size=m2_size, cost=m2_cost, costByMonth=m2_cost_month,
                nPlaceEdits={k: dict(v) for k, v in nplace.items()}, allSitesEdits={k: dict(v) for k, v in allsites.items()},
                ticketsJoined=len(joined), ticketsExposed=sum(1 for r in joined if t_exposed[r['ticket']])),
        m3=dict(subsetEdits=subset_edits, followedBySibling=len(followed), cases=len(cases),
                autoReadings=dict(collections.Counter(c['autoReading'] for c in cases))),
        perPr=per_pr,
        m3Cases=cases,
    )
    with open(os.path.join(args.out, 'results.json'), 'w') as f:
        json.dump(results, f, indent=1)

    # ---- tables.md ----------------------------------------------------------------------
    L = []
    L.append(f'# M2 / M3 tables — grounded at d61903f3, PRs since {args.since} (n={len(prs)}), window ±{W} lines\n')
    L.append('## Site counts per snapshot (clustered sites; named decisions also as raw match lines / files)\n')
    L.append('| decision | ' + ' | '.join(months) + ' |')
    L.append('|---|' + '---|' * len(months))
    for name in list(decisions) + [t['name'] for t in twins]:
        cells = []
        for m in months:
            d = snap_diag[m][name]
            if name in decisions:
                cells.append(f"{d['sites']} ({d['matches']}m/{d['files']}f)")
            else:
                cells.append(f"{d['sites']}" if d['live'] else '–')
        L.append(f'| {name} | ' + ' | '.join(cells) + ' |')
    L.append('\nTwin partner resolution problems (snapshot: missing anchor/partner):\n')
    for m in months:
        for name, d in snap_diag[m].items():
            if name not in decisions and d.get('missing'):
                L.append(f'- {m} {name}: ' + '; '.join(d['missing']))
    L.append(f'\nRelocation into pre-change versions: {dict(stats)}\n')

    L.append('## M2.1 Decision-exposed share of PRs by month\n')
    L.append('| month | PRs | decision-exposed | share | of which touch an existing site | of which only add/remove a site | ±3-line sensitivity | exact-line sensitivity | v1 file-level exposed |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for m, d in m2_month.items():
        L.append(f"| {m} | {d['prs']} | {d['exposed']} | {100*d['exposed']/d['prs']:.1f}% | {d['touchExposed']} ({100*d['touchExposed']/d['prs']:.1f}%) | {d['addOnly']} | {d['exposedNear3']} ({100*d['exposedNear3']/d['prs']:.1f}%) | {d['exposedExact']} ({100*d['exposedExact']/d['prs']:.1f}%) | {d['v1Exposed']} ({100*d['v1Exposed']/d['prs']:.1f}%) |")
    tot = sum(d['prs'] for d in m2_month.values())
    L.append(f"| all | {tot} | {sum(d['exposed'] for d in m2_month.values())} | {100*sum(d['exposed'] for d in m2_month.values())/tot:.1f}% | {sum(d['touchExposed'] for d in m2_month.values())} | {sum(d['addOnly'] for d in m2_month.values())} | {sum(d['exposedNear3'] for d in m2_month.values())} | {sum(d['exposedExact'] for d in m2_month.values())} | {sum(d['v1Exposed'] for d in m2_month.values())} |")
    L.append('\nCross-tab, PR level (rows: decision-exposed; columns: version-1 file-level exposed):\n')
    L.append('| | v1 not exposed | v1 exposed |')
    L.append('|---|---|---|')
    L.append(f"| decision not exposed | {xtab[(False, False)]} | {xtab[(False, True)]} |")
    L.append(f"| decision exposed | {xtab[(True, False)]} | {xtab[(True, True)]} |")

    L.append('\n## M2.2 Size as an outcome (production lines added+deleted; production files)\n')
    L.append('| month | group | n | lines median | lines p75 | files median | files p75 |')
    L.append('|---|---|---|---|---|---|---|')
    for m, cell in m2_size.items():
        for g in ('exposed', 'not'):
            c = cell[g]
            L.append(f"| {m} | {g} | {c['n']} | {fmt(c['linesMedian'],1)} | {fmt(c['linesP75'],1)} | {fmt(c['filesMedian'],1)} | {fmt(c['filesP75'],1)} |")

    L.append(f"\n## M2.3 Cost joined through ticket-outcomes (tickets with a PR since {args.since}: {len(joined)}; exposed if any PR is decision-exposed)\n")
    L.append('| band | group | n | size median | sendbacks mean | plan send-backs mean | review legs mean | escapes mean | share with send-back | share with escape | n lineage | sessions mean | hours median |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for b in ('pooled', '1-49', '50-299', '300+', '0'):
        for g in ('exposed', 'not_exposed'):
            c = m2_cost[b][g]
            L.append(f"| {b} | {g} | {c['n']} | {fmt(c['sizeMedian'],0)} | {fmt(c['sendbacks'])} | {fmt(c['planSendbacks'])} | {fmt(c['reviewLegs'])} | {fmt(c['escapesIntroduced'],3)} | {fmt(c['sendbackShare'],2)} | {fmt(c['escapeShare'],3)} | {c['nLineage']} | {fmt(c['sessions'])} | {fmt(c['hoursMedian'])} |")
    L.append('\nBy month (ticket firstDay):\n')
    L.append('| month | group | n | size median | sendbacks mean | plan send-backs mean | review legs mean | escapes mean | n lineage | sessions mean | hours median |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for m, cell in m2_cost_month.items():
        for g in ('exposed', 'not_exposed'):
            c = cell[g]
            L.append(f"| {m} | {g} | {c['n']} | {fmt(c['sizeMedian'],0)} | {fmt(c['sendbacks'])} | {fmt(c['planSendbacks'])} | {fmt(c['reviewLegs'])} | {fmt(c['escapesIntroduced'],3)} | {c['nLineage']} | {fmt(c['sessions'])} | {fmt(c['hoursMedian'])} |")

    L.append('\n## M2.4 N-place edits: PRs touching ≥2 sites of one decision in one change (and, in brackets, touching all of its ≥2 sites)\n')
    L.append('| decision | ' + ' | '.join(months[1:]) + ' | total |')
    L.append('|---|' + '---|' * (len(months)))
    for name in list(decisions) + [t['name'] for t in twins]:
        if name not in nplace and name not in allsites:
            continue
        cells = [f"{nplace[name][m]} ({allsites[name][m]})" for m in months[1:]]
        L.append(f"| {name} | " + ' | '.join(cells) + f" | {sum(nplace[name].values())} ({sum(allsites[name].values())}) |")
    L.append('\nPRs by number of decisions touched: ' + str(dict(sorted(collections.Counter(len(p['decisions']) for p in per_pr).items()))))
    L.append('\nExposed PRs by decision (any touch/add/remove):\n')
    L.append('| decision | ' + ' | '.join(months[1:]) + ' | total |')
    L.append('|---|' + '---|' * (len(months)))
    cnt = collections.defaultdict(collections.Counter)
    for p in per_pr:
        for name in p['decisions']:
            cnt[name][p['month']] += 1
    for name in list(decisions) + [t['name'] for t in twins]:
        if name in cnt:
            L.append(f"| {name} | " + ' | '.join(str(cnt[name][m]) for m in months[1:]) + f" | {sum(cnt[name].values())} |")

    L.append('\n## M3 counts\n')
    L.append(f"- subset edits (PR × decision with 1 ≤ touched < total): {subset_edits}")
    L.append(f"- followed within 30 days by a PR touching a different site of the same decision: {len(followed)}")
    L.append(f"- sibling-edit pairs listed: {len(cases)}; automatic readings: {dict(collections.Counter(c['autoReading'] for c in cases))}")
    read = collections.Counter(c['reading'] or 'unread' for c in cases)
    L.append(f"- reader's readings over pairs: {dict(read)}")
    fix_edits = {(c['firstPr'], c['decision']) for c in cases if c['reading'] == 'sibling-fix'}
    unclear_edits = {(c['firstPr'], c['decision']) for c in cases if c['reading'] == 'unclear'} - fix_edits
    L.append(f"- subset edits followed by at least one sibling-fix reading: {len(fix_edits)}; by an unclear reading only: {len(unclear_edits)}")
    by_dec = collections.defaultdict(collections.Counter)
    for p in per_pr:
        for name, d in p['decisions'].items():
            if d['subset']:
                by_dec[name]['subset'] += 1
    for (fp, name) in followed:
        by_dec[name]['followed'] += 1
    for (fp, name) in fix_edits:
        by_dec[name]['siblingFix'] += 1
    for (fp, name) in unclear_edits:
        by_dec[name]['unclear'] += 1
    L.append('\n| decision | subset edits | followed by sibling edit | sibling-fix reading | unclear only |')
    L.append('|---|---|---|---|---|')
    for name in list(decisions) + [t['name'] for t in twins]:
        if name in by_dec:
            c = by_dec[name]
            L.append(f"| {name} | {c['subset']} | {c['followed']} | {c['siblingFix']} | {c['unclear']} |")
    results['m3'].update(readerReadings=dict(read), subsetEditsWithSiblingFix=len(fix_edits), subsetEditsUnclearOnly=len(unclear_edits),
                         byDecision={k: dict(v) for k, v in by_dec.items()})
    with open(os.path.join(args.out, 'results.json'), 'w') as f:
        json.dump(results, f, indent=1)
    with open(os.path.join(args.out, 'tables.md'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # ---- m3-cases.md (auto part; the reader appends/overrides readings) -----------------
    C = ['# M3 cases: subset edits followed within 30 days by an edit to a sibling site\n',
         f'{len(cases)} pairs from {len(followed)} subset edits (of {subset_edits}). `auto` is the keyword reading '
         f'(sibling-fix? / candidate / unrelated); `reading` is the reader\'s final reading (sibling-fix / unrelated / unclear) '
         f'from --readings, with the note. Sites are file::kind::text; a sibling site is one the first PR did not touch.\n',
         f"Reader's readings: {dict(read)}; subset edits with a sibling-fix reading: {len(fix_edits)}; unclear only: {len(unclear_edits)}.\n"]
    by_first = collections.defaultdict(list)
    for c in cases:
        by_first[(c['firstPr'], c['decision'])].append(c)
    for (fp, name), cs in sorted(by_first.items()):
        c0 = cs[0]
        C.append(f"\n## PR #{fp} ({c0['firstDay']}, {c0['firstTicket']}) — {name}: touched {c0['touched']}/{c0['total']}\n")
        C.append(f"first subject: {c0['firstSubject'].replace('|', '/')}  \nsites touched: {', '.join(c0['firstSites']).replace('|', '/')}\n")
        C.append('| later PR | day | ticket | subject | sibling sites touched | signals | auto | reading | note |')
        C.append('|---|---|---|---|---|---|---|---|---|')
        for c in cs:
            C.append(f"| #{c['laterPr']} | {c['laterDay']} | {c['laterTicket']} | {c['laterSubjects'][0][:110].replace('|','/')} | "
                     f"{'; '.join(s.split('::')[0] for s in c['laterSites'])} ({c['laterTouched']}/{c['laterTotal']}) | "
                     f"{', '.join(c['signals']).replace('|','/')} | {c['autoReading']} | {c['reading'] or ''} | {(c['readingNote'] or '').replace('|','/')} |")
    with open(os.path.join(args.out, 'm3-cases.md'), 'w') as f:
        f.write('\n'.join(C) + '\n')
    # compact pair list for the reading pass
    with open(os.path.join(args.out, 'm3-pairs.tsv'), 'w') as f:
        f.write('key\tfirstDay\tfirstTicket\tfirstSubject\tdecision\tfirstSites\tlaterDay\tlaterTicket\tlaterSubjects\tlaterSites\tsignals\tauto\tcontext\n')
        for c in cases:
            f.write('\t'.join([c['key'], c['firstDay'], str(c['firstTicket']), c['firstSubject'][:90], c['decision'][:40],
                               ';'.join(s.split('::')[0] for s in c['firstSites']), c['laterDay'], str(c['laterTicket']),
                               ' // '.join(s[:90] for s in c['laterSubjects']), ';'.join(s.split('::')[0] for s in c['laterSites']),
                               ','.join(c['signals']), c['autoReading'], ' ⏎ '.join(l.strip()[:80] for l in c['context'][:4])]).replace('\n', ' ') + '\n')
    print(json.dumps(dict(prs=len(prs), byMonth=m2_month, xtab={str(k): v for k, v in xtab.items()}, m3=results['m3'], stats=dict(stats)), indent=1))


if __name__ == '__main__':
    main()
