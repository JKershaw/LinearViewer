# Run 5 report fragments, generated (no hand edits): the ruling table (105 mustRule groups), the table-group list (309, no ruling),
# and the compact trend ledger (140 rows). Usage (repo root): python3 -I build-tables-run5.py <evidence-dir>
import json, csv, sys
E = sys.argv[1].rstrip('/') + '/'
W = json.load(open(E + 'census-run5-HEAD-5c63aa26-vs-af55cb73.json'))
rul = list(csv.reader(open(E + 'rulings-run5.tsv'), delimiter='\t'))[1:]
byid = {r[0]: r for r in rul}
with open(E + 'ruling-table-run5.md', 'w') as fh:
    fh.write('| id (run 5) | run-4 id | decision | a/f/s | ruling | one-line reason (carried from run 4) | basis (run 5) |\n|---|---|---|---|---|---|---|\n')
    for g in sorted([g for g in W['groups'] if g['mustRule']], key=lambda g: g['rank']):
        r = byid[g['id']]
        ruling = r[4]
        label = {'real': '**real**', 'borderline': 'borderline', 'noise': 'noise'}[ruling]
        fh.write(f"| {g['id']} | {r[1]} | {g['decision'].replace('|', '/')} | {r[3]} | {label} | {r[5].replace('|', '/')} | {r[6].replace('|', '/')} |\n")
with open(E + 'census-table-groups-run5.tsv', 'w') as fh:
    fh.write('id\tdecision\tfiles\tareas/files/sites\tstatus vs run 4\n')
    for g in sorted([g for g in W['groups'] if g['table']], key=lambda g: g['rank']):
        fh.write(f"{g['id']}\t{g['decision']}\t{' '.join(g['files'])}\t{g['areaCount']}/{g['fileCount']}/{g['siteCount']}\t{g['status']}\n")
# compact ledger markdown
L = list(csv.reader(open(E + 'ledger-run5.tsv'), delimiter='\t'))
with open(E + 'ledger-run5.md', 'w') as fh:
    fh.write('| # | finding | severity (run 4) | run 5 delta vs run 4, and evidence |\n|---|---|---|---|\n')
    for r in L[1:]:
        fh.write(f"| {r[0]} | `{r[1]}` | {r[2]} | {r[3].replace('|', '/')} |\n")
print('ruling rows', sum(1 for _ in open(E + 'ruling-table-run5.md')) - 2,
      '| table groups', sum(1 for _ in open(E + 'census-table-groups-run5.tsv')) - 1,
      '| ledger rows', len(L) - 1)
