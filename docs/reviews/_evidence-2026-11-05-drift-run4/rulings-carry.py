# Carry the 11-04b rulings onto the 105 mustRule groups of the 11-05 reading (one guide).
# Join: (detector, decision, files) between W (2eb73ae0 vs d7ceb373) and 11-04b W1 (d7ceb373 vs 5334c81a).
# For each joined group, a site whose file:line falls inside a changed hunk (git diff -U0 d7ceb373 2eb73ae0) is flagged for re-reading.
# Usage (repo root): python3 -I rulings-carry.py <W.json> <priorW1.json> <prior-report.md> <out.tsv>
import json, sys, re, subprocess, collections
W = json.load(open(sys.argv[1])); P = json.load(open(sys.argv[2])); report = open(sys.argv[3]).read().split('\n')
key = lambda g: (g['detector'], g['decision'], tuple(g['files']))
pm = {key(g): g for g in P['groups'] if g['mustRule']}
# prior ruling table rows: | id | 11-04 id | decision | status | a/f/s | ruling | reason | basis |
rul = {}
start = next(i for i, l in enumerate(report) if l.startswith('## Census ruling table'))
for l in report[start:]:
    if l.startswith('## Census table groups'): break
    m = re.match(r'\| (G\d{4}) \| [^|]* \| (.*) \| [a-z]+[^|]* \| \d+/\d+/\d+ \| \*{0,2}(real|borderline|noise)\*{0,2} \| (.*) \| [^|]* \|$', l)
    if m: rul[m.group(1)] = (m.group(3), m.group(4))
# changed new-side line ranges per file
diff = subprocess.run(['git', 'diff', '-U0', 'd7ceb373', '2eb73ae0', '--', 'lib', 'routes', 'public', 'server.js'], capture_output=True, text=True).stdout
hunks = collections.defaultdict(list); cur = None
for l in diff.split('\n'):
    if l.startswith('+++ b/'): cur = l[6:]
    m = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
    if m and cur:
        s = int(m.group(1)); n = int(m.group(2) or 1); hunks[cur].append((s, s + max(n, 1) - 1))
def in_hunk(site):
    f, ln = site.rsplit(':', 1); ln = int(ln)
    return any(a <= ln <= b for a, b in hunks.get(f, []))
out = []; dist = collections.Counter(); flagged = []
for g in sorted((g for g in W['groups'] if g['mustRule']), key=lambda g: g['rank']):
    p = pm.get(key(g))
    if not p: out.append((g['id'], '?', g['decision'], 'NO-JOIN', '', '', '')); continue
    r = rul.get(p['id'], ('MISSING', ''))
    same = g['sites'] == p['sites']
    hot = [s for s in g['sites'] if in_hunk(s)]
    basis = 'identical sites' if same else ('lines shifted; ' + (f'{len(hot)} site(s) inside a window hunk: ' + ', '.join(hot) if hot else 'no site inside a window hunk'))
    if hot: flagged.append(g['id'])
    dist[r[0]] += 1
    out.append((g['id'], p['id'], g['decision'], f"{g['areaCount']}/{g['fileCount']}/{g['siteCount']}", r[0], r[1], basis))
with open(sys.argv[4], 'w') as fh:
    fh.write('id_11-05\tid_11-04b\tdecision\tareas/files/sites\truling_11-04b\treason_11-04b\tbasis_11-05\n')
    for row in out: fh.write('\t'.join(row) + '\n')
print('groups', len(out), 'rulings carried', dict(dist)); print('flagged for re-read (a site inside a window hunk):', len(flagged), flagged)
print('prior rulings parsed:', len(rul))
