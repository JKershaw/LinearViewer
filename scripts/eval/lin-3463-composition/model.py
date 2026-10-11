# OLS of log(sessions) and logistic-free split rate on composition codes, controlling for change size (PR lines) and origin.
import json, sys, math, random
import numpy as np
S = sys.argv[1]
rows = json.load(open(f'{S}/table.json')); T = json.load(open(f'{S}/joined.json')); AF = json.load(open(f'{S}/autofeatures.json'))
P = [x for x in T if x['state'] == 'Done' and x['work_type'] in ('bug', 'feature', 'refactor', 'ops', 'other') and AF[x['ticket']]['pr_lines']]
print('n', len(P))
def X_of(x):
    pl = AF[x['ticket']]['pr_lines']
    return [1, x['open_behaviour'] == 'yes', x['what_decided'] < 2, min(x['decisions'], 5), x['how_prescribed'], x['asserted_facts'],
            math.log1p(pl), x['origin'] == 'breakdown', x['origin'] == 'follow-up']
names = ['const', 'open_behaviour', 'not_settled', 'decisions', 'how_prescribed', 'asserted_facts', 'log_pr_lines', 'breakdown', 'follow_up']
X = np.array([X_of(x) for x in P], float); y = np.array([math.log(max(x['sessions'], 1)) for x in P])
def fit(X, y): return np.linalg.lstsq(X, y, rcond=None)[0]
b = fit(X, y)
random.seed(3463); boots = []
for _ in range(2000):
    idx = [random.randrange(len(P)) for _ in P]; boots.append(fit(X[idx], y[idx]))
boots = np.array(boots)
for i, n in enumerate(names):
    lo, hi = np.percentile(boots[:, i], [2.5, 97.5])
    print(f'{n:15s} coef {b[i]:+.3f}  x{math.exp(b[i]):.2f} sessions  95% CI [{lo:+.3f}, {hi:+.3f}]')
r2 = 1 - ((y - X @ b) ** 2).sum() / ((y - y.mean()) ** 2).sum(); print('R2', round(r2, 3))
# split as linear probability
ys = np.array([float(x['split']) for x in P]); bs = fit(X, ys)
bb = np.array([fit(X[i], ys[i]) for i in [[random.randrange(len(P)) for _ in P] for _ in range(2000)]])
print('split (linear probability):')
for i, n in enumerate(names[1:], 1):
    lo, hi = np.percentile(bb[:, i], [2.5, 97.5]); print(f'  {n:15s} {bs[i]:+.3f} [{lo:+.3f}, {hi:+.3f}]')
