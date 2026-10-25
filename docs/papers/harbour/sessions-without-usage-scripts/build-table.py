# Usage: python3 -I build-table.py <runner-logs-dir> <cost.jsonl> <logmap.json> <tcost.json> <out.csv>
#
# Builds the per-lineage table the paper's figures are read from. One row per dispatch
# lineage dispatched 26 Sep to 24 Oct 2026 (UTC), from the stored /cost records, with each
# no-usage row classed from the runner's own logs and each launched session's transcript
# cost. Stage 1 output; stage 2 (analyse.py) reads only this table.
import csv, glob, json, os, re, sys

logs_dir, cost_path, map_path, tcost_path, out_path = sys.argv[1:6]
LO, HI = '2026-09-26', '2026-10-24'

# ── lineages: one per rootItemId, deduped across the issues that share it ──
rows = {}
for line in open(cost_path):
    d = json.loads(line)
    for w in d.get('workerSessions', []):
        day = (w['dispatchedAt'] or '')[:10]
        if not (LO <= day <= HI):
            continue
        r = rows.get(w['rootItemId'])
        if r:
            r['issues'].append(d['identifier'])
            continue
        w = dict(w)
        w['issues'] = [d['identifier']]
        w['day'] = day
        rows[w['rootItemId']] = w

# ── launch evidence from the run logs, per dispatch item ──
# A dispatch item's block runs from its "Found dispatch item:" line to the next one.
# An abort row logs either "Aborting session" or "No session to abort"; both mean it never launched.
tags = {}      # item uuid -> set of 'abort' | 'refused' | 'launched'
followup = {}  # 8-char item prefix -> verdict on the follow-up row
for p in sorted(glob.glob(os.path.join(logs_dir, 'dispatcher.run-*.log'))):
    cur = None
    for line in open(p, errors='replace'):
        m = re.match(r'Found dispatch item: ([0-9a-f-]{36})', line)
        if m:
            cur = m.group(1)
            tags.setdefault(cur, set())
            continue
        m = re.match(r'\[follow-up\] item ([0-9a-f]{8}) .*→ (REJECT|SIGNAL|RESUME|QUEUED-BUSY)', line)
        if m:
            followup.setdefault(m.group(1), m.group(2))
        if cur is None:
            continue
        if 'Aborting session' in line or '[failed] No session to abort' in line:
            tags[cur].add('abort')
        if '[failed] Unknown repo' in line:
            tags[cur].add('refused')
        if 'creating session:' in line:
            tags[cur].add('launched')

lm = json.load(open(map_path))
tc = json.load(open(tcost_path))

out_rows = []
for rid, r in rows.items():
    launch = lm.get(rid) or {}
    t = tc.get(rid) or {}
    row = {
        'issues': ';'.join(r['issues']),
        'rootItemId': rid,
        'day': r['day'],
        'kind': r['kind'],
        'harness': r['harness'],
        'model': r['model'],
        'effort': r['effort'],
        'durationMs': r['durationMs'],
        'costUsd': r['costUsd'],
        'reqModel': launch.get('reqModel'),
        'reqEffort': launch.get('reqEffort'),
        'transcriptCostUsd': t.get('cost'),
        'subagentCostUsd': t.get('subCost'),
        'sidechainLines': t.get('sidechainLines'),
    }
    if r['harness'] is not None or r['model'] is not None:
        # Priced rows keep their reported cost; a row with a harness but no cost is unpriced.
        row['class'] = 'priced' if r['costUsd'] is not None else 'unpriced'
        row['subclass'] = 'priced' if r['costUsd'] is not None else 'unpriced:' + str(r['model'])
    else:
        row['class'] = 'no-usage'
        seen = tags.get(rid, set())
        # Rows that never ran a session. Checked before launch so a block that both
        # aborted and launched is not counted as a non-session.
        if 'launched' not in seen and 'abort' in seen:
            row['subclass'] = 'abort'
        elif 'launched' not in seen and followup.get(rid[:8]) in ('REJECT', 'SIGNAL'):
            row['subclass'] = 'follow-up-' + followup[rid[:8]].lower()
        elif 'launched' not in seen and 'refused' in seen:
            row['subclass'] = 'refused'
        elif 'launched' not in seen:
            row['subclass'] = 'no-launch-record'
        elif launch.get('harness') == 'opencode':
            row['subclass'] = 'opencode'
        elif t.get('missing'):
            row['subclass'] = 'no-transcript'
        elif t.get('usage') is None:
            row['subclass'] = 'no-turn'
        else:
            row['subclass'] = 'recoverable'
    out_rows.append(row)

out_rows.sort(key=lambda x: (x['day'], x['rootItemId']))
with open(out_path, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['issues', 'rootItemId', 'day', 'kind', 'harness', 'model', 'effort',
                                      'durationMs', 'costUsd', 'class', 'subclass', 'reqModel', 'reqEffort',
                                      'transcriptCostUsd', 'subagentCostUsd', 'sidechainLines'])
    w.writeheader()
    for row in out_rows:
        w.writerow({k: ('' if row[k] is None else row[k]) for k in row})
print(len(out_rows))
