# Run 7 (LIN-4443): carry run 6's census rulings onto the run-7 mustRule groups (one guide, HEAD registry).
# W = run-7 reading (e2d4659c4 vs b315e0e8f); P = run 6's reading (b315e0e8f vs 5c63aa26), whose ids name run 6's rulings.
# Join 1: (detector, decision, files). Join 2 (fallback): (detector, decision) with file overlap >= 50%.
# A joined group with a site inside a hunk of `git diff -U0 b315e0e8f e2d4659c4` is flagged for re-reading.
# Usage (repo root): python3 -I rulings-carry-run7.py <W.json> <P.json> <census-rulings-run6.tsv> <out.tsv>
import json, sys, re, subprocess, collections, csv
W = json.load(open(sys.argv[1])); P = json.load(open(sys.argv[2]))
rul = {}
with open(sys.argv[3]) as fh:
    for r in csv.DictReader(fh, delimiter='\t'):
        rul[r['id_run6']] = (r['ruling'], r['reason'])
key = lambda g: (g['detector'], g['decision'], tuple(g['files']))
pm = {key(g): g for g in P['groups']}
pd = collections.defaultdict(list)
for g in P['groups']: pd[(g['detector'], g['decision'])].append(g)
diff = subprocess.run(['git', 'diff', '-U0', 'b315e0e8f', 'e2d4659c4', '--', 'lib', 'routes', 'public', 'server.js'], capture_output=True, text=True).stdout
hunks = collections.defaultdict(list); cur = None
for l in diff.split('\n'):
    if l.startswith('+++ '): cur = l[6:] if l.startswith('+++ b/') else None
    m = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
    if m and cur:
        s = int(m.group(1)); n = int(m.group(2) if m.group(2) is not None else 1); hunks[cur].append((s, s + max(n, 1) - 1))
def in_hunk(site):
    f, ln = site.rsplit(':', 1); ln = int(ln)
    return any(a <= ln <= b for a, b in hunks.get(f, []))
out = []; dist = collections.Counter(); flagged = []; nojoin = []
for g in sorted((g for g in W['groups'] if g['mustRule']), key=lambda g: g['rank']):
    p = pm.get(key(g)); how = 'by-key'
    if not p:
        cands = [c for c in pd.get((g['detector'], g['decision']), []) if len(set(c['files']) & set(g['files'])) * 2 >= max(len(c['files']), len(g['files']))]
        p = cands[0] if cands else None; how = 'by-decision+overlap'
    hot = [s for s in g.get('sites', []) if in_hunk(s)]
    if hot: flagged.append(g['id'])
    if not p or p['id'] not in rul:
        nojoin.append(g['id'])
        out.append((str(g['rank']), g['id'], p['id'] if p else '-', g['decision'], f"{g['areaCount']}/{g['fileCount']}/{g['siteCount']}", g['status'], 'research', 'yes' if hot else '—', 'RULE', '', ', '.join(hot)))
        continue
    r = rul[p['id']]; dist[r[0]] += 1
    out.append((str(g['rank']), g['id'], p['id'], g['decision'], f"{g['areaCount']}/{g['fileCount']}/{g['siteCount']}", g['status'], 'carried-' + how, 'yes' if hot else '—', r[0], r[1], ', '.join(hot)))
with open(sys.argv[4], 'w') as fh:
    fh.write('rank_run7\tid_run7\tid_run6\tdecision\tareas/files/sites\tstatus_vs_run6\tbasis\twindow_hunk\truling\treason\tsites_in_hunk\n')
    for row in out: fh.write('\t'.join(row) + '\n')
print('mustRule groups', len(out), 'carried', dict(dist), 'to rule from sites', len(nojoin), nojoin)
print('flagged for re-read (a site inside a window hunk):', len(flagged), flagged)
