# Run 8 (LIN-4481): carry run 7's SD census rulings onto SD's run-8 groups by (detector, decision, files) and flag sites in a window hunk.
# Usage (Harbour repo root): python3 -I sd-rulings-carry-run8.py <SD repo> <W.json> <P.json> <census-SD-rulings-run7.tsv> <out.tsv>
import json, sys, re, subprocess, collections, csv
sd, W, P = sys.argv[1], json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))
rul = {r[list(r)[1]]: r for r in csv.DictReader(open(sys.argv[4]), delimiter='\t')}
key = lambda g: (g['detector'], g['decision'], tuple(g['files']))
pm = {key(g): g for g in P['groups']}
diff = subprocess.run(['git', '-C', sd, 'diff', '-U0', 'af9b496', '7d5fe7d'], capture_output=True, text=True).stdout
hunks = collections.defaultdict(list); cur = None
for l in diff.split('\n'):
    if l.startswith('+++ '): cur = l[6:] if l.startswith('+++ b/') else None
    m = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
    if m and cur:
        s = int(m.group(1)); n = int(m.group(2) if m.group(2) is not None else 1); hunks[cur].append((s, s + max(n, 1) - 1))
def in_hunk(site):
    f, ln = site.rsplit(':', 1); ln = int(ln)
    return any(a <= ln <= b for a, b in hunks.get(f, []))
out = open(sys.argv[5], 'w'); out.write('id_run8\tid_run7\tdecision\tstatus\truling_run7\tsites_in_hunk\n'); n = collections.Counter()
for g in sorted((g for g in W['groups'] if g['mustRule']), key=lambda g: g['rank']):
    p = pm.get(key(g)); r = rul.get(p['id']) if p else None
    hot = [s for s in g.get('sites', []) if in_hunk(s)]
    ruling = r['ruling'] if r else 'RULE'; n[ruling] += 1
    out.write('\t'.join([g['id'], p['id'] if p else '-', g['decision'], g['status'], ruling, ', '.join(hot)]) + '\n')
    if hot: print('in hunk:', g['id'], g['decision'], hot)
print(dict(n))
