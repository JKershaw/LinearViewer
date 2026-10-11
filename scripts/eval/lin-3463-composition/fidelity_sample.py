import json, re, random, sys
from collections import Counter
import statistics as st
S = sys.argv[1]
rows = json.load(open(f'{S}/transcripts.json'))
def parse(body):
    for cand in (body, (re.search(r'\{.*\}', body, re.S) or [None])[0]):
        if not cand: continue
        try:
            j = json.loads(cand)
            if isinstance(j, dict): return j
        except Exception: pass
    return None
first = {}
for r in sorted([r for r in rows if r['start']], key=lambda r: r['start']):
    tk = r['ticket']
    if tk in first: continue
    b = i = None
    for rd in r['reads']:
        if rd['write'] or not rd['body']: continue
        if b is None and any(k == 'brief' and tk in p for k, p in rd['calls']):
            j = parse(rd['body'])
            if j and j.get('brief'): b = j
        if i is None and any(k == 'issue' and re.search(tk + r'(?!\d)', p) for k, p in rd['calls']):
            j = parse(rd['body'])
            if j and 'description' in j: i = j
    if b and i and isinstance(i.get('comments', []), list) and all(isinstance(c, dict) for c in i.get('comments') or []): first[tk] = (r, b, i)
print('tickets with first-session pair', len(first))
print(Counter(v[0]['kind'] for v in first.values()).most_common(8))
print(Counter(v[0]['start'][:7] for v in first.values()))
json.dump(sorted(first), open(f'{S}/fidelity/eligible.json', 'w'))
random.seed(3463)
sample = sorted(random.sample(sorted(first), 60), key=lambda t: int(t.split('-')[1]))
idx = []
for n, tk in enumerate(sample):
    r, b, i = first[tk]
    st_ = i.get('state'); st_ = st_.get('name') if isinstance(st_, dict) else st_
    src = {'title': i.get('title'), 'state': st_, 'parent': i.get('parent'),
           'children': [c.get('identifier') + ': ' + (c.get('title') or '') for c in (i.get('children') or []) if isinstance(c, dict)],
           'description': i.get('description'),
           'comments': [{'createdAt': c.get('createdAt'), 'body': c.get('body')} for c in sorted(i.get('comments') or [], key=lambda c: c.get('createdAt') or '')]}
    pid = f'F{n+1:02d}'
    json.dump(src, open(f'{S}/fidelity/{pid}-source.json', 'w'), indent=1)
    open(f'{S}/fidelity/{pid}-brief.md', 'w').write(b['brief'])
    idx.append({'pair': pid, 'ticket': tk, 'session_kind': r['kind'], 'session_start': r['start'], 'transcript': r['file'],
                'brief_model': b.get('model'), 'brief_generatedAt': b.get('generatedAt'), 'brief_status': b.get('status'),
                'desc_chars': len(i.get('description') or ''), 'n_comments': len(i.get('comments') or []), 'brief_chars': len(b['brief'])})
json.dump(idx, open(f'{S}/fidelity/index.json', 'w'), indent=1)
print(Counter(x['brief_model'] for x in idx), Counter(x['session_kind'] for x in idx))
print('desc chars med', st.median(x['desc_chars'] for x in idx), 'brief chars med', st.median(x['brief_chars'] for x in idx), 'comments med', st.median(x['n_comments'] for x in idx))
