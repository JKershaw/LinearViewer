import json, sys, re
from collections import Counter, defaultdict
def seq_of(r):
    seq = []
    for rd in r['reads']:
        if rd['write']: continue
        for k, p in rd['calls']:
            if k in ('brief', 'issue', 'recap', 'prompt', 'mcp'): seq.append((k, p))
    return seq
def classify(r):
    seq = seq_of(r); tk = r['ticket']
    ob = [i for i, (k, p) in enumerate(seq) if k == 'brief' and tk in p]
    oi = [i for i, (k, p) in enumerate(seq) if k == 'issue' and re.search(tk + r'(?!\d)', p)]
    key = 'brief+issue' if ob and oi else 'brief only' if ob else 'issue only' if oi else 'neither'
    if ob and oi: key += ' (brief first)' if ob[0] < oi[0] else ' (issue first)'
    return key, seq
if __name__ == '__main__':
    rows = [r for r in json.load(open(sys.argv[1])) if r['start']]
    stats = defaultdict(Counter); neither = []
    for r in rows:
        key, seq = classify(r)
        for g in ('ALL', r['kind'], 'M' + r['start'][:7]): stats[g][key] += 1
        if key == 'neither': neither.append(r)
    for k, v in sorted(stats.items(), key=lambda x: -sum(x[1].values()))[:14]:
        n = sum(v.values()); print(k, n, {a: f'{b} ({100*b/n:.0f}%)' for a, b in v.most_common()})
    import datetime
    wk = defaultdict(Counter)
    for r in rows:
        k, _ = classify(r); d = datetime.date.fromisoformat(r['start'][:10]); wk[str(d - datetime.timedelta(days=d.weekday()))][k] += 1
    for w in sorted(wk):
        n = sum(wk[w].values()); print('week', w, n, f"brief first {100*wk[w]['brief+issue (brief first)']/n:.0f}%  issue first {100*wk[w]['brief+issue (issue first)']/n:.0f}%")
