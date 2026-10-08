#!/usr/bin/env python3 -I
"""Join the tracker cache (comments, cost lineages) to per-PR exposure, and compare effort and review rounds
for tickets whose PRs touched a multi-authority site against those that did not, within size bands and months."""
import json, collections, statistics, re, os, sys, datetime, glob
D = os.environ.get('COHERENCE_DATA', os.path.join(os.getcwd(), 'data'))  # run from the repo root; outputs of coherence-census.mjs live here
cache = {}
for f in sorted(glob.glob(D + '/tracker-cache*.json')): cache.update(json.load(open(f))['tickets'])  # one file, or several slices fetched in parallel
rows = json.load(open(D + '/exposure.json'))
defects = json.load(open('docs/papers/harbour/reliability-baseline-defects.json'))['verdicts']
introduced = collections.Counter(v['introducedBy'] for v in defects if v['verdict'] == 'escaped' and v.get('introducedBy'))

# per-ticket aggregation of PR facts
T = collections.defaultdict(lambda: {'prs': 0, 'size': 0, 'files': set(), 'exposed': False, 'twin': False, 'clone': False, 'cloneDecision': False, 'commits': 0, 'firstDay': None, 'lastDay': None, 'areas': set()})
for r in rows:
    t = r['ticket']
    if not t or r['day'] < '2026-06-01': continue
    a = T[t]; a['prs'] += 1; a['size'] += r['size']; a['files'] |= set(r['prodFiles']); a['commits'] += r['commits']
    for k in ['exposed', 'twin', 'clone', 'cloneDecision']: a[k] = a[k] or r[k]
    a['firstDay'] = min(a['firstDay'] or r['day'], r['day']); a['lastDay'] = max(a['lastDay'] or r['day'], r['day']); a['areas'] |= set(r['areas'])

VERDICT = re.compile(r'(request(ed)? changes|needs discussion)', re.I)
APPROVE = re.compile(r'\bapprove', re.I)
REVIEW_HEAD = re.compile(r'^(#+\s*)?(code )?review\b|verdict|### Plan Review Verdict|plan-review|plan review', re.I | re.M)
def ticketFacts(t):
    c = cache.get(t)
    if not c or '__status' in c['issue']: return None
    iss = c['issue']; cost = c['cost']
    comments = iss['comments']
    sendbacks = 0; approvals = 0; planSendbacks = 0
    for cm in comments:
        head = cm['head']
        isPlan = bool(re.search(r'plan[- ]review', head[:200], re.I))
        if VERDICT.search(head):
            if isPlan: planSendbacks += 1
            else: sendbacks += 1
        elif APPROVE.search(head[:200]) and re.search(r'verdict|review', head[:200], re.I): approvals += 1
    ws = cost.get('workerSessions') or [] if '__status' not in cost else []
    kinds = collections.Counter(w['kind'] for w in ws)
    hours = sum((w.get('durationMs') or 0) for w in ws) / 3.6e6
    return {'state': iss['state']['name'], 'comments': len(comments), 'commentChars': sum(cm['chars'] for cm in comments), 'sendbacks': sendbacks, 'planSendbacks': planSendbacks, 'approvals': approvals, 'sessions': len(ws), 'reviewLegs': kinds.get('review', 0), 'implLegs': kinds.get('implementation', 0), 'planReviewLegs': kinds.get('plan-review', 0), 'hours': hours, 'noLineage': cost.get('noLineage') if '__status' not in cost else None, 'descriptionChars': iss['descriptionChars'], 'labels': iss['labels'], 'escapesIntroduced': introduced.get(t, 0)}

data = []
for t, a in T.items():
    f = ticketFacts(t)
    if not f: continue
    data.append({'ticket': t, **{k: (sorted(v) if isinstance(v, set) else v) for k, v in a.items()}, **f})
json.dump(data, open(D + '/ticket-outcomes.json', 'w'))
print('tickets joined:', len(data), 'with lineage:', sum(1 for d in data if d['sessions'] > 0))
def band(s): return '1-49' if s < 50 else '50-299' if s < 300 else '300+'
def med(xs): return round(statistics.median(xs), 2) if xs else None
def mean(xs): return round(statistics.mean(xs), 2) if xs else None
pop = [d for d in data if d['size'] > 0 and d['sessions'] > 0 and d['state'] == 'Done']
print('Done code tickets with a lineage:', len(pop))
for key in ['exposed', 'twin', 'cloneDecision']:
    print(f'\n== {key} (Done, lineage): month band | n exp/not | sendbacks mean | review legs mean | sessions mean | hours median | comments mean | escapesIntroduced per 100')
    cells = collections.defaultdict(lambda: {True: [], False: []})
    for d in pop: cells[(d['lastDay'][:7], band(d['size']))][d[key]].append(d)
    acc = collections.defaultdict(lambda: [0, 0])
    for k in sorted(cells):
        e, n = cells[k][True], cells[k][False]
        if len(e) >= 5 and len(n) >= 5:
            w = min(len(e), len(n))
            for m in ['sendbacks', 'reviewLegs', 'sessions', 'hours', 'comments']:
                acc[m][0] += w * (statistics.mean(x[m] for x in e) - statistics.mean(x[m] for x in n)); acc[m][1] += w
            print(k, len(e), len(n), f"{mean([x['sendbacks'] for x in e])}/{mean([x['sendbacks'] for x in n])}", f"{mean([x['reviewLegs'] for x in e])}/{mean([x['reviewLegs'] for x in n])}", f"{mean([x['sessions'] for x in e])}/{mean([x['sessions'] for x in n])}", f"{med([x['hours'] for x in e])}/{med([x['hours'] for x in n])}", f"{mean([x['comments'] for x in e])}/{mean([x['comments'] for x in n])}", f"{100*sum(x['escapesIntroduced']>0 for x in e)/len(e):.1f}/{100*sum(x['escapesIntroduced']>0 for x in n)/len(n):.1f}")
    print('weighted mean differences (exposed - not):', {m: round(v[0] / v[1], 3) for m, v in acc.items() if v[1]})
    e = [d for d in pop if d[key]]; n = [d for d in pop if not d[key]]
    print('pooled: n', len(e), len(n), 'sendbacks', mean([x['sendbacks'] for x in e]), mean([x['sendbacks'] for x in n]), 'hours med', med([x['hours'] for x in e]), med([x['hours'] for x in n]), 'escapes/100', round(100 * sum(x['escapesIntroduced'] > 0 for x in e) / len(e), 1), round(100 * sum(x['escapesIntroduced'] > 0 for x in n) / len(n), 1))

# review send-backs per Done code ticket by month and size band, all tickets with comments (no lineage needed): does the same-sized work get harder?
print('\n== all Done code tickets (comments, no lineage needed): month band | n | sendbacks mean | share sent back | plan send-backs mean | comments mean | commentChars median | exposed share')
pop2 = [d for d in data if d['size'] > 0 and d['state'] == 'Done' and d['comments'] > 0]
cells2 = collections.defaultdict(list)
for d in pop2: cells2[(d['lastDay'][:7], band(d['size']))].append(d)
for k in sorted(cells2):
    xs = cells2[k]
    print(k, len(xs), mean([x['sendbacks'] for x in xs]), f"{sum(x['sendbacks']>0 for x in xs)/len(xs):.0%}", mean([x['planSendbacks'] for x in xs]), mean([x['comments'] for x in xs]), med([x['commentChars'] for x in xs]), f"{sum(x['exposed'] for x in xs)/len(xs):.0%}")
print('\n== send-backs by exposure within month x band, all Done code tickets with comments (June-October)')
for key in ['exposed', 'twin']:
    cells3 = collections.defaultdict(lambda: {True: [], False: []})
    for d in pop2: cells3[(d['lastDay'][:7], band(d['size']))][d[key]].append(d)
    acc = [0, 0]; acc2 = [0, 0]; rows_ = []
    for k in sorted(cells3):
        e, n = cells3[k][True], cells3[k][False]
        if len(e) >= 5 and len(n) >= 5:
            w = min(len(e), len(n)); me = statistics.mean(x['sendbacks'] for x in e); mn = statistics.mean(x['sendbacks'] for x in n)
            pe = sum(x['sendbacks'] > 0 for x in e) / len(e); pn = sum(x['sendbacks'] > 0 for x in n) / len(n)
            acc[0] += w * (me - mn); acc[1] += w; acc2[0] += w * (pe - pn); acc2[1] += w
            rows_.append((k, len(e), len(n), round(me, 2), round(mn, 2), f'{pe:.0%}', f'{pn:.0%}'))
    for r in rows_: print(key, *r)
    print(key, 'weighted diff: sendbacks', round(acc[0] / acc[1], 3), 'share sent back', round(acc2[0] / acc2[1], 3))
# by month at fixed size: does effort per ticket rise over time? (agent-vs-system)
print('\n== by month (Done, lineage): band | n | sendbacks mean | sessions mean | hours median | comments mean')
cells = collections.defaultdict(list)
for d in pop: cells[(d['lastDay'][:7], band(d['size']))].append(d)
for k in sorted(cells):
    xs = cells[k]
    print(k, len(xs), mean([x['sendbacks'] for x in xs]), mean([x['sessions'] for x in xs]), med([x['hours'] for x in xs]), mean([x['comments'] for x in xs]))
