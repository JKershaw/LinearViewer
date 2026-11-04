import json, sys, collections
E='docs/reviews/_evidence-2026-11-04/'
def L(n): return json.load(open(E+n+'.json'))
a=L('edges-code-015aa4c6-guide-5334c81a')['edgeList']
b=L('edges-code-5334c81a-guide-5334c81a')['edgeList']
def key(e): return (e['from'],e['to'])
A={key(e):e for e in a}; B={key(e):e for e in b}
added=[k for k in B if k not in A]; removed=[k for k in A if k not in B]
print('file edges: 015 =',len(A),' 5334 =',len(B),' added',len(added),' removed',len(removed))
print('ADDED (cross-area only):')
for k in sorted(added):
    e=B[k]
    if e['fromArea']!=e['toArea']: print('  +',k[0],'->',k[1],'|',e['fromArea'][:22],'->',e['toArea'][:22])
print('REMOVED (cross-area only):')
for k in sorted(removed):
    e=A[k]
    if e['fromArea']!=e['toArea']: print('  -',k[0],'->',k[1],'|',e['fromArea'][:22],'->',e['toArea'][:22])
print('intra-area added/removed:', len([k for k in added if B[k]['fromArea']==B[k]['toArea']]), len([k for k in removed if A[k]['fromArea']==A[k]['toArea']]))
# placement-only: same file edge, area label changed
ch=[(k, A[k]['fromArea'], B[k]['fromArea'], A[k]['toArea'], B[k]['toArea']) for k in A if k in B and (A[k]['fromArea']!=B[k]['fromArea'] or A[k]['toArea']!=B[k]['toArea'])]
print('same file edge, changed area label:', len(ch))
# area-pair counts under HEAD guide, both commits
def pc(edges):
    c=collections.Counter()
    for e in edges:
        if e['fromArea']!=e['toArea']: c[(e['fromArea'],e['toArea'])]+=1
    return c
ca,cb=pc(a),pc(b)
print('directed area-pair deltas (HEAD guide), |delta|>=1:')
for k in sorted(set(ca)|set(cb), key=lambda k:-(abs(cb[k]-ca[k]))):
    if ca[k]!=cb[k]: print(f'  {k[0][:26]:26} -> {k[1][:26]:26} {ca[k]:4} -> {cb[k]:4}  ({cb[k]-ca[k]:+d})')
