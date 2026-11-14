# LIN-4478: ticket text sizes from a proxy snapshot taken 14 Nov 2026 (09:40-10:05Z).
# Snapshot: all.json = every issue from GET /api/proxy/issues?teamId=...&limit=250 (paged);
# dates.txt = "LIN-n createdAt ..." for every LIN number divisible by 60 (GET /issues/{id});
# full_<id>.json = GET /issues/{id} for two seeded random samples of Done tickets
# (seed 4478: 8 a month Jan-Apr, 20 a month May-Nov; seed 44782: 20 more a month Jun-Nov).
# Usage: python3 -I tickets.py <snapshot-dir>   -> prints both tables, writes ticket-rows.json there.
import json, glob, os, re, sys, bisect, statistics as st
d = sys.argv[1]
iss = json.load(open(os.path.join(d, 'all.json')))
pts = sorted((int(l.split()[0].split('-')[1]), l.split()[1][:10]) for l in open(os.path.join(d, 'dates.txt')) if l.split()[1] != 'None')
def month(n):  # creation month of LIN-n, from the next sampled number at or above it
    i = bisect.bisect_left([a for a, _ in pts], n); return pts[min(i, len(pts) - 1)][1][:7]
END = '*End of what was asked'
q = lambda v, p: sorted(v)[int(p * (len(v) - 1))]
by = {}
for i in iss:
    desc = i.get('description') or ''
    r = dict(len=len(desc), done=i['state']['type'] == 'completed', asked=None, below=None,
             dw=bool(re.search(r'(?im)^\W*done[ -]when', desc)))
    if desc.lstrip().startswith('## As asked') and END in desc:
        k = desc.index(END); e = desc.find('\n', k); e = len(desc) if e < 0 else e
        r['asked'] = e; r['below'] = len(desc[e:].strip())
    by.setdefault(month(int(i['identifier'].split('-')[1])), []).append(r)
print('Table A: current descriptions, every issue, by creation month (characters)')
print('month issues median p90 done-median as-asked-share as-asked-median below-median done-when-share')
for m in sorted(by):
    R = by[m]; L = [x['len'] for x in R]; D = [x['len'] for x in R if x['done']]; A = [x for x in R if x['asked'] is not None]
    print(m, len(R), int(st.median(L)), q(L, .9), int(st.median(D)) if D else '-', f"{len(A)/len(R):.2f}",
          int(st.median([x['asked'] for x in A])) if A else '-', int(st.median([x['below'] for x in A])) if A else '-',
          f"{sum(x['dw'] for x in R)/len(R):.2f}")
rows = []
for f in glob.glob(os.path.join(d, 'full_*.json')):
    t = json.load(open(f))
    if t.get('state', {}).get('type') != 'completed': continue
    cs = t.get('comments') or []
    rows.append(dict(id=t['identifier'], created=t['createdAt'][:10], completed=(t.get('completedAt') or '')[:10],
                     desc=len(t.get('description') or ''), comments=sum(len(c.get('body') or '') for c in cs),
                     n_comments=len(cs), truncated=bool(t.get('truncated'))))
json.dump(sorted(rows, key=lambda r: r['id']), open(os.path.join(d, 'ticket-rows.json'), 'w'), indent=0)
print('\nTable B: sampled Done tickets, description plus comments, by creation month (characters)')
print('month n desc-median comments-median total-median total-IQR comments-n-median chars-per-comment truncated')
bym = {}
for r in rows: bym.setdefault(r['created'][:7], []).append(r)
for m in sorted(bym):
    R = bym[m]
    if len(R) < 5: continue
    T = [r['desc'] + r['comments'] for r in R]; P = [r['comments'] / r['n_comments'] for r in R if r['n_comments']]
    print(m, len(R), int(st.median([r['desc'] for r in R])), int(st.median([r['comments'] for r in R])), int(st.median(T)),
          f"{q(T,.25)}-{q(T,.75)}", st.median([r['n_comments'] for r in R]), int(st.median(P)) if P else '-', sum(r['truncated'] for r in R))
