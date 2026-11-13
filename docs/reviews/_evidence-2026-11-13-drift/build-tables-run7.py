# Run 7 (LIN-4443): the two census tables. Reads the carry output (rulings-carry-run7.py) and the run-7 census JSON,
# applies this run's hand rulings and re-read notes, and writes census-rulings-run7.tsv, census-table-groups-run7.tsv
# and the two markdown tables (census-tables-run7.md) the report embeds.
# Usage (repo root): python3 -I build-tables-run7.py <carry.tsv> <census.json> <evidence-dir>
import csv, json, sys, collections
carry = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
C = json.load(open(sys.argv[2])); E = sys.argv[3]
HAND = {  # groups ruled or re-read from their sites at e2d4659c4
  'G0020': ('borderline', 'research', 'Grown from table to mustRule by two blind-read prompt sites (completion-signals.js:260, prompt-template-defs.js:1310) that ask an agent to end [skipped]; the parse authority is dispatch-terminal, as for [blocked]/[failed] (borderline).'),
}
REREAD = {
  'G0007': 'Re-read: the new site lib/session-roles.js:42 classifies a row\'s role from its kind, a different question from runner.mjs\'s wake-claim test; ruling stands.',
  'G0012': 'Re-read: close-out-readiness.js:155 is in a window hunk (the stop-at lane now hands a non-pr task to ladderNotReady instead of returning null); the same inline stopAt test, now with readStopAt beside it; ruling stands.',
  'G0051': 'Re-read: the three new sites (render-task-timeline.js:82,89,132) test the timeline lane state, a separate state space the model sets from isOpenState (runs-and-dispatch Lesson); ruling stands.',
  'G0147': 'Re-read: the new site public/task-page.js:848 repeats the page\'s own :64/:73 reads of the server status; ruling stands.',
}
out = []
for r in carry:
    gid = r['id_run7']; ruling, reason = r['ruling'], r['reason']; basis = r['basis']
    if gid in HAND: ruling, basis, reason = HAND[gid]
    note = REREAD.get(gid, '')
    out.append({**r, 'ruling': ruling, 'reason': reason, 'basis': basis, 'reread_run7': note})
with open(f'{E}/census-rulings-run7.tsv', 'w') as fh:
    cols = ['rank_run7', 'id_run7', 'id_run6', 'decision', 'areas/files/sites', 'status_vs_run6', 'basis', 'window_hunk', 'ruling', 'reason', 'reread_run7']
    fh.write('\t'.join(cols) + '\n')
    for r in out: fh.write('\t'.join(r[c] for c in cols) + '\n')
dist = collections.Counter(r['ruling'] for r in out)
tbl = [g for g in C['groups'] if g['table']]
with open(f'{E}/census-table-groups-run7.tsv', 'w') as fh:
    fh.write('rank\tid\tdetector\tdecision\tareas/files/sites\tstatus_vs_b315e0e8f\town_churn\n')
    for g in tbl: fh.write(f"{g['rank']}\t{g['id']}\t{g['detector']}\t{g['decision']}\t{g['areaCount']}/{g['fileCount']}/{g['siteCount']}\t{g['status']}\t{g['ownChurn']}\n")
esc = lambda s: s.replace('|', '\\|')
cut = lambda s, n: s if len(s) <= n else s[:n - 1] + '…'
md = ['| rank | id (run 7) | id (run 6) | decision | areas/files/sites | status vs run 6 | window hunk | ruling | reason |', '|---|---|---|---|---|---|---|---|---|']
for r in out:
    reason = r['reason'] + ((' ' + r['reread_run7']) if r['reread_run7'] else '')
    md.append(f"| {r['rank_run7']} | {r['id_run7']} | {r['id_run6']} | {esc(cut(r['decision'], 70))} | {r['areas/files/sites']} | {r['status_vs_run6']} | {r['window_hunk']} | {r['ruling']} | {esc(cut(reason, 150))} |")
md2 = ['| rank | id | detector | decision | a/f/s | status |', '|---|---|---|---|---|---|']
for g in tbl: md2.append(f"| {g['rank']} | {g['id']} | {g['detector']} | {esc(cut(g['decision'], 80))} | {g['areaCount']}/{g['fileCount']}/{g['siteCount']} | {g['status']} |")
open(f'{E}/census-tables-run7.md', 'w').write('\n'.join(md) + '\n\n' + '\n'.join(md2) + '\n')
print('mustRule', len(out), dict(dist), 'table', len(tbl), collections.Counter(g['status'] for g in tbl))
