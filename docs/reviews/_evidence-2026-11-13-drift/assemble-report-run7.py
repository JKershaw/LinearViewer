# Run 7 (LIN-4443): assemble the report from its prose template and the evidence tables (no hand-copied tables).
# Usage (repo root): python3 -I assemble-report-run7.py <template.md> <evidence-dir> <second-read.md|-> <out.md>
import csv, sys
tpl, E, sr, out = sys.argv[1:5]
t = open(tpl).read()
tables = open(f'{E}/census-tables-run7.md').read().split('\n\n')
esc = lambda s: s.replace('|', '\\|')
sd = '\n'.join(f"| {r['rank']} | {r['id']} | {esc(r['decision'])} | {r['areas/files/sites']} | {r['ruling']} | {esc(r['reason'])} |" for r in csv.DictReader(open(f'{E}/census-SD-rulings-run7.tsv'), delimiter='\t'))
led = ['| row | finding | severity | run-7 delta | noted in |', '|---|---|---|---|---|']
for r in csv.DictReader(open(f'{E}/ledger-run7.tsv'), delimiter='\t'):
    led.append(f"| {r['row']} | `{r['finding']}` | {r['severity']} | {esc(r['run7_delta'])} | {r['noted_in']} |")
srtext = open(sr).read().strip() if sr != '-' else '_Pending: the second read runs after this report is written._'
headline = 'pending.'
if sr != '-':
    headline = open(sr).read().split('<!--headline:')[1].split('-->')[0].strip()
    srtext = srtext.split('-->', 1)[1].strip()
t = (t.replace('{{RULINGS}}', tables[0].strip()).replace('{{TABLEGROUPS}}', tables[1].strip())
      .replace('{{SD_RULINGS}}', sd).replace('{{LEDGER}}', '\n'.join(led))
      .replace('{{SECOND_READ}}', srtext).replace('{{SR_HEADLINE}}', headline))
assert '{{' not in t
open(out, 'w').write(t)
print(out, len(t.encode()), 'bytes')
