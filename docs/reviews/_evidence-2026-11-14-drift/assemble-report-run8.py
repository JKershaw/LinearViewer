# Run 8 (LIN-4481): assemble the report from its prose parts and the evidence tables.
# Usage (repo root): python3 -I assemble-report-run8.py <out.md> [second-read.md]
import csv, sys
E = 'docs/reviews/_evidence-2026-11-14-drift'
esc = lambda s: s.replace('|', '\\|')
parts = [open(f'{E}/report-head-run8.md').read(), open(f'{E}/report-body-run8.md').read()]
r = list(csv.DictReader(open(f'{E}/census-rulings-run8.tsv'), delimiter='\t'))
t = ['\n## Census rulings (the 107 `mustRule` groups, run-8 reading)\n',
     'Carried by key from run 7 unless the basis says otherwise; `hunk` marks a site inside a window hunk, re-read at HEAD (last column).\n',
     '| rank | id (run 7) | decision | a/f/s | status | basis | hunk | ruling | reason | re-read |', '|---|---|---|---|---|---|---|---|---|---|']
for x in r:
    t.append(f"| {x['rank_run8']} | {x['id_run8']} ({x['id_run7']}) | {esc(x['decision'])} | {x['areas/files/sites']} | {x['status_vs_run7']} | {x['basis']} | {x['window_hunk']} | {x['ruling']} | {esc(x['reason'])} | {esc(x['reread_run8'])} |")
parts.append('\n'.join(t) + '\n')
g = list(csv.DictReader(open(f'{E}/census-table-groups-run8.tsv'), delimiter='\t'))
t = [f'\n## Census table groups ({len(g)}; no ruling, per the method)\n', '| rank | id | detector | decision | a/f/s | status |', '|---|---|---|---|---|---|']
t += [f"| {x['rank']} | {x['id']} | {x['detector']} | {esc(x['decision'])} | {x['areas/files/sites']} | {x['status']} |" for x in g]
parts.append('\n'.join(t) + '\n')
l = list(csv.DictReader(open(f'{E}/ledger-run8.tsv'), delimiter='\t'))
t = ['\n## Compact trend ledger\n', f'All {len(l)} rows under their stable names (`ledger-run8.tsv`; the next run compares mechanically).\n',
     '| row | finding | severity | run-8 delta | noted in |', '|---|---|---|---|---|']
t += [f"| {x['row']} | `{esc(x['finding'].strip('`'))}` | {x['severity']} | {esc(x['run8_delta'])} | {x['noted_in']} |" for x in l]
parts.append('\n'.join(t) + '\n')
parts.append('\n## Follow-ups\n\nNone minted. Every finding is in this report and, where it binds a builder or waits in an area, in that area\'s note.\n')
if len(sys.argv) > 2: parts.append('\n' + open(sys.argv[2]).read())
open(sys.argv[1], 'w').write('\n'.join(p.rstrip('\n') + '\n' for p in parts))
print('ok', sum(len(p) for p in parts))
