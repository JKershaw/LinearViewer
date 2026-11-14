# Run 8 touch map (LIN-4481): each ledger row's cited files x the window's numstat (e2d4659c4..fb358dbda, all paths).
# Citations: the union of each row's text in the 11-05 ledger, run 4's ledger and run 7's ledger (basename-matched,
# as touch-map-run5.py does). Usage (repo root): python3 -I touch-map-run8.py <numstat.tsv> <ledger.tsv>...
import csv, re, sys
num = {}
for l in open(sys.argv[1]):
    a, d, f = l.rstrip('\n').split('\t'); num[f] = (a, d)
def hits_for(text):
    toks = set(re.findall(r'[\w./-]+\.(?:m?js|css|txt|md|json|html|sh|yml)', text))
    out = set()
    for f in num:
        base = f.rsplit('/', 1)[-1]
        for t in toks:
            if f == t or f.endswith('/' + t) or ('/' not in t and t == base): out.add(f)
    return sorted(out)
rows = {}
for p in sys.argv[2:]:
    for r in list(csv.reader(open(p), delimiter='\t'))[1:]:
        rows[r[0]] = rows.get(r[0], '') + ' ' + ' '.join(r)
for n in sorted(rows, key=lambda x: int(x) if x.isdigit() else 0):
    h = hits_for(rows[n])
    if h: print(n, '|', ', '.join(f'{f}({num[f][0]}/{num[f][1]})' for f in h))
