# Usage: python3 -I analyse.py <sessions.csv>
#
# Stage 2 of the paper's method. Reads only the committed per-lineage table and prints
# every figure the paper states: the class table and its true cost, the measurement check,
# the held-out estimator, the decisive test on the real no-usage sessions, the residue
# bounds and their back-test, and the effort and routing facts.
import csv, collections, math, random, statistics as st, sys

rows = list(csv.DictReader(open(sys.argv[1])))


def num(x):
    return float(x) if x not in ('', None) else None


def fam(m):
    if not m:
        return None
    if 'deepseek' in m:
        return 'deepseek'
    return m.replace('claude-', '').split('-')[0]


for r in rows:
    for k in ('durationMs', 'costUsd', 'transcriptCostUsd', 'subagentCostUsd', 'sidechainLines'):
        r[k] = num(r[k])
    r['fam'] = fam(r['model']) if r['class'] == 'priced' else fam(r['reqModel'])
    r['effort'] = r['effort'] or None


def P(*a):
    print(*a)


def pct(x):
    return '%+.0f%%' % (100 * x)


priced = [r for r in rows if r['class'] == 'priced']
nousage = [r for r in rows if r['class'] == 'no-usage']
recoverable = [r for r in nousage if r['subclass'] == 'recoverable']
P('== population ==')
P('lineages in window', len(rows), '| priced', len(priced), '| unpriced', sum(r['class'] == 'unpriced' for r in rows),
  '| no usage', len(nousage))
for k, v in sorted(collections.Counter(r['subclass'] for r in nousage).items(), key=lambda x: -x[1]):
    P(f'  {k:20s} {v}')
P('not sessions (abort, follow-up REJECT/SIGNAL, refused):',
  sum(r['subclass'] in ('abort', 'follow-up-reject', 'follow-up-signal', 'refused') for r in nousage))
P('no-usage by kind', collections.Counter(r['kind'] for r in nousage).most_common())

rt = [r['transcriptCostUsd'] for r in recoverable]
P('\n== recoverable claude-code sessions (transcript is the truth) ==')
P('n %d, sum $%.2f, median $%.3f, max $%.2f, priced-as-unknown %d' % (
    len(rt), sum(rt), st.median(rt), max(rt), sum(x is None for x in rt)))
dur = sorted(r['durationMs'] / 60000 for r in nousage if r['subclass'] != 'abort' and r['durationMs'] is not None)
P('no-usage, non-abort duration min: median %.1f, p90 %.1f' % (st.median(dur), dur[int(.9 * (len(dur) - 1))]))

P('\n== measurement check: reported cost against the transcript ==')
both = [r for r in priced if r['transcriptCostUsd']]
rat = sorted(r['costUsd'] / r['transcriptCostUsd'] for r in both if r['transcriptCostUsd'] > 0)
P('matched sessions %d: ratio p5 %.3f, p50 %.3f, p95 %.3f' % (
    len(rat), rat[int(.05 * len(rat))], st.median(rat), rat[int(.95 * len(rat))]))
rep = sum(r['costUsd'] for r in both)
tr = sum(r['transcriptCostUsd'] for r in both)
P('matched totals: reported $%.2f, transcript $%.2f, shortfall $%.2f (%.1f%%)' % (rep, tr, tr - rep, 100 * (tr - rep) / tr))
P('all priced reported total $%.2f' % sum(r['costUsd'] for r in priced))
sub = [r for r in rows if r['subagentCostUsd']]
P('sessions with subagent transcripts: %d, subagent cost $%.2f (%.1f%% of priced reported)' % (
    len(sub), sum(r['subagentCostUsd'] for r in sub),
    100 * sum(r['subagentCostUsd'] for r in sub) / sum(r['costUsd'] for r in priced)))
P('main transcripts with sidechain lines:', sum(1 for r in rows if (r['sidechainLines'] or 0) > 0),
  'of', sum(1 for r in rows if r['sidechainLines'] is not None))

# ── estimator ──
train = [r for r in priced if r['costUsd'] and r['costUsd'] > 0]
for r in train:
    r['efam'] = r['fam']
P('\n== held-out estimator, trained on %d priced sessions ==' % len(train))
P('kinds:', collections.Counter(r['kind'] for r in train).most_common())
P('families:', collections.Counter(r['fam'] for r in train).most_common())


EFFORT_IN_CELL = True


def key(r, lvl, fk):
    effort = r['effort'] if EFFORT_IN_CELL else None
    return {3: (r['kind'], fk, effort), 2: (r['kind'], fk), 1: (r['kind'],), 0: ()}[lvl]


def fit(tr, fk):
    cells = {}
    for lvl in (3, 2, 1, 0):
        g = collections.defaultdict(list)
        for r in tr:
            g[key(r, lvl, fk(r))].append(r)
        cells[lvl] = g
    return cells


def predict(cells, r, use_dur, fk):
    for lvl in (3, 2, 1, 0):
        g = cells[lvl].get(key(r, lvl, fk(r)))
        if not (g and len(g) >= 5):
            continue
        if not use_dur or not r['durationMs']:
            return st.median(x['costUsd'] for x in g), st.mean(x['costUsd'] for x in g), lvl
        gd = [x for x in g if x['durationMs']]
        if len(gd) < 5:
            return st.median(x['costUsd'] for x in g), st.mean(x['costUsd'] for x in g), lvl
        # Within-cell log-log fit of cost on run time (minutes), with Duan smearing for totals.
        X = [math.log(x['durationMs'] / 60000) for x in gd]
        Y = [math.log(x['costUsd']) for x in gd]
        mx, my = st.mean(X), st.mean(Y)
        sxx = sum((a - mx) ** 2 for a in X)
        b = sum((a - mx) * (c - my) for a, c in zip(X, Y)) / sxx if sxx > 1e-9 else 0
        res = [c - (my + b * (a - mx)) for a, c in zip(X, Y)]
        yhat = my + b * (math.log(r['durationMs'] / 60000) - mx)
        smear = st.mean(math.exp(e) for e in res)
        return math.exp(yhat), math.exp(yhat) * smear, lvl
    return None, None, None


def evaluate(label, folds, use_dur, fk):
    errs = collections.defaultdict(list)
    sums = []
    for tr_, te in folds:
        c = fit(tr_, fk)
        s_true = s_pred = 0
        for r in te:
            med, mean, _ = predict(c, r, use_dur, fk)
            if med is None:
                continue
            lr = math.log(r['costUsd'] / med)
            for g in ('all', 'model:' + str(r['fam']), 'kind:' + r['kind']):
                errs[g].append(lr)
            s_true += r['costUsd']
            s_pred += mean
        sums.append(s_pred / s_true - 1)
    P(f'\n-- {label} --  total error per fold: ' + ', '.join(pct(x) for x in sums))
    for g in sorted(errs, key=lambda g: (g != 'all', g)):
        e = sorted(errs[g])
        n = len(e)
        if n < 15 and g != 'all':
            continue
        mae = st.median(abs(x) for x in e)
        P(f'  {g:26s} n={n:5d}  median |err| {100 * (math.exp(mae) - 1):4.0f}%  '
          f'80% within x{math.exp(e[int(.1 * (n - 1))]):.2f}..x{math.exp(e[int(.9 * (n - 1))]):.2f}')


random.seed(3944)
sh = train[:]
random.shuffle(sh)
K = 5
kf = [([r for i, r in enumerate(sh) if i % K != k], [r for i, r in enumerate(sh) if i % K == k]) for k in range(K)]
cut = '2026-10-18'
ts = [([r for r in train if r['day'] < cut], [r for r in train if r['day'] >= cut])]
P('time split: train before %s (%d), test from %s (%d)' % (cut, len(ts[0][0]), cut, len(ts[0][1])))
fk = lambda r: r['efam']
for lab, f in (('5-fold', kf), ('time split', ts)):
    evaluate(lab + ' | cell median (kind, model, effort)', f, False, fk)
    evaluate(lab + ' | cell log-log on run time', f, True, fk)

EFFORT_IN_CELL = False
P('\nablation, effort left out of the cell (kind, model), run time in:')
for lab, f in (('5-fold', kf), ('time split', ts)):
    evaluate(lab + ' | cell log-log on run time, no effort', f, True, fk)
EFFORT_IN_CELL = True

# ── decisive test: the real no-usage sessions, against their transcript truth ──
c = fit(train, fk)
test = [r for r in recoverable if r['transcriptCostUsd'] and r['transcriptCostUsd'] > 0]
P('\n== decisive test: %d real no-usage sessions with a transcript ==' % len(test))
for r in test:
    r['efam'] = r['fam']
    r['effort'] = r['reqEffort']
for use in (True, False):
    o = []
    for r in test:
        med, mean, lvl = predict(c, r, use, fk)
        if med is not None:
            o.append((r, med, mean))
    tt = sum(x[0]['transcriptCostUsd'] for x in o)
    pp = sum(x[2] for x in o)
    e = sorted(math.log(x[0]['transcriptCostUsd'] / x[1]) for x in o)
    P('%s run time: n=%d, true $%.2f, estimate $%.2f (%s), median |err| %.0f%%' % (
        'with' if use else 'without', len(o), tt, pp, pct(pp / tt - 1),
        100 * (math.exp(st.median(abs(x) for x in e)) - 1)))

# ── effort: within each kind, how many efforts did each model run at? ──
P('\n== effort within kind (priced sessions): efforts used per model ==')
eff = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for r in priced:
    eff[r['kind']][r['fam']][r['effort']] += 1
varied = 0
for kind in sorted(eff):
    for fk_, cnt in sorted(eff[kind].items(), key=lambda x: str(x[0])):
        if len(cnt) > 1:
            varied += 1
        P(f'  {kind:14s} {str(fk_):9s} ' + ', '.join(f'{e}:{n}' for e, n in cnt.most_common()))
P('model-within-kind pairs running more than one effort:', varied)
P('haiku implementation: priced %d, unpriced %d' % (
    sum(1 for r in priced if r['kind'] == 'implementation' and r['fam'] == 'haiku'),
    sum(1 for r in rows if r['class'] == 'unpriced' and r['kind'] == 'implementation')))

# ── residue bounds and their back-test ──
P('\n== residue bounds ==')
cellmax = collections.defaultdict(list)
cellrows = collections.defaultdict(list)
for r in train:
    cellmax[(r['kind'], r['fam'])].append(r['costUsd'])
    cellrows[(r['kind'], r['fam'])].append((r['durationMs'] or 0, r['costUsd']))
oc = [r for r in nousage if r['subclass'] == 'opencode']
P('opencode, %d rows (true cost unrecoverable):' % len(oc))
for name, pick in (
        ('cell median', lambda r: st.median(cellmax[(r['kind'], r['fam'])])),
        ('cell p90', lambda r: sorted(cellmax[(r['kind'], r['fam'])])[int(.9 * (len(cellmax[(r['kind'], r['fam'])]) - 1))]),
        ('cell max', lambda r: max(cellmax[(r['kind'], r['fam'])]))):
    P('  %-12s $%.2f' % (name, sum(pick(r) for r in oc)))
ncl = [r for r in nousage if r['subclass'] == 'no-transcript']
P('no-transcript claude-code, %d rows: at recoverable median $%.2f, at recoverable p90 $%.2f' % (
    len(ncl), len(ncl) * st.median(rt), len(ncl) * sorted(rt)[int(.9 * (len(rt) - 1))]))

# Residue of the no-usage set: likely (cell median, recoverable median), high (cell p90,
# recoverable p90) and bound (cell max). Recovered sessions are added as known spend.
rec_p90 = sorted(rt)[int(.9 * (len(rt) - 1))]
known = sum(rt)
def cell_stat(r, fn):
    v = cellmax[(r['kind'], r['fam'])]
    return fn(v) if v else 0
likely = sum(cell_stat(r, st.median) for r in oc) + len(ncl) * st.median(rt)
high = sum(cell_stat(r, lambda v: sorted(v)[int(.9 * (len(v) - 1))]) for r in oc) + len(ncl) * rec_p90
bound = sum(cell_stat(r, max) for r in oc) + sum(cell_stat(r, max) for r in ncl)
P('no-usage spend: recovered $%.2f; unrecovered likely $%.2f, high $%.2f, bound $%.2f' % (known, likely, high, bound))
P('total no-usage spend: likely $%.2f (%.2f%% of priced reported), bound $%.2f (%.2f%%)' % (
    known + likely, 100 * (known + likely) / sum(r['costUsd'] for r in priced),
    known + bound, 100 * (known + bound) / sum(r['costUsd'] for r in priced)))

# Run-time-matched bound: the largest reported cost among priced sessions of the same kind
# and model family that ran no longer than this row did. Tighter than the cell max where a
# row's run time is known; falls back to the cell max where it is not.
def matched_max(r):
    cell = cellrows[(r['kind'], r['fam'])]
    if not cell:
        return 0
    if r['durationMs'] is None:
        return max(c for _, c in cell)
    within = [c for d, c in cell if d <= r['durationMs']]
    # No session in the cell ran this briefly: fall back to the cell max, never a minimum.
    return max(within) if within else max(c for _, c in cell)
bound_m = sum(matched_max(r) for r in oc) + sum(matched_max(r) for r in ncl)
P('run-time-matched bound on the same rows: $%.2f (total no-usage spend $%.2f, %.2f%%)' % (
    bound_m, known + bound_m, 100 * (known + bound_m) / sum(r['costUsd'] for r in priced)))

# Back-test of the bound rules on the 25 recoverable sessions: each bound must cover its
# session's true transcript cost.
for label, bfn in (('cell max', lambda r: cell_stat(r, max)), ('run-time-matched max', matched_max)):
    pairs = [(r['transcriptCostUsd'], bfn(r)) for r in recoverable if r['transcriptCostUsd'] is not None]
    P('back-test (%s) on %d recoverable sessions: covers true cost in %d; bounds total $%.2f vs true $%.2f' % (
        label, len(pairs), sum(t <= b for t, b in pairs), sum(b for _, b in pairs), sum(t for t, _ in pairs)))
