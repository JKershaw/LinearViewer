# Run 5 touch map (LIN-4324): each ledger row's cited files x the window's numstat (af55cb73..5c63aa26, all paths).
# Citations come from the 11-05 ledger text (the rows' cited files, basename-matched); rows 128-135 (run 4's new rows) are
# matched on their run-4 text. Usage (repo root): python3 -I touch-map-run5.py <ledger-11-05.tsv> <ledger-run4.tsv> <window-numstat-all-run5.tsv>
import csv, re, sys
num = {}
for l in open(sys.argv[3]):
    a, d, f = l.rstrip('\n').split('\t'); num[f] = (a, d)
def hits_for(text):
    toks = set(re.findall(r'[\w./-]+\.(?:m?js|css|txt|md|json|html|sh|yml)', text))
    out = set()
    for f in num:
        base = f.rsplit('/', 1)[-1]
        for t in toks:
            if f == t or f.endswith('/' + t) or ('/' not in t and t == base):
                out.add(f)
    return sorted(out)
rows = {}
for r in list(csv.reader(open(sys.argv[1]), delimiter='\t'))[1:]:
    rows.setdefault(r[0], ' '.join(r))
for r in list(csv.reader(open(sys.argv[2]), delimiter='\t'))[1:]:
    rows.setdefault(r[0], ' '.join(r))
n = 0
for row in sorted(rows, key=int):
    h = hits_for(rows[row])
    if h:
        n += 1
        print(row, '|', ', '.join(f'{x}({num[x][0]}/{num[x][1]})' for x in h))
print(f'# rows citing a window-touched file: {n}')
