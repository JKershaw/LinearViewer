import json,sys,collections
E=sys.argv[1]
def L(n): return json.load(open(f'{E}/{n}'))
W1=L('census-W1-code-d7ceb373-vs-5334c81a-guide-d7ceb373.json')
W2=L('census-W2-code-d7ceb373-vs-5334c81a-guide-5334c81a.json')
R1=L('census-R1-code-5334c81a-vs-015aa4c6-guide-5334c81a.json')
R2=L('census-R2-code-5334c81a-vs-015aa4c6-guide-d7ceb373.json')
def cls(g): return 'mustRule' if g['mustRule'] else ('table' if g['table'] else 'none')
def key(g): return (g['detector'],g['decision'])
for name,d in [('W1',W1),('W2',W2),('R1',R1),('R2',R2)]:
    st=collections.Counter(g.get('status') for g in d['groups'] if g['mustRule'] or g['table'])
    stall=collections.Counter(g.get('status') for g in d['groups'])
    print(name, d['counts'], 'status(all):',dict(stall), 'status(rule+table):', dict(st))
def guide_diff(a,b,label):
    A={key(g):g for g in a['groups']}; B={key(g):g for g in b['groups']}
    print(f'\n== guide effect {label}: groups only in one: {len(set(A)^set(B))}')
    for k in sorted(set(A)&set(B)):
        if cls(A[k])!=cls(B[k]) or A[k]['areaCount']!=B[k]['areaCount']:
            print(f"  {A[k]['id']} {k[1][:90]} | areas {B[k]['areaCount']}->{A[k]['areaCount']} | {cls(B[k])}->{cls(A[k])} rank {B[k]['rank']}->{A[k]['rank']}")
guide_diff(W1,W2,'this window: HEAD guide (W1) vs old guide (W2)')
guide_diff(R2,R1,'prev window: HEAD guide (R2) vs old guide (R1)')
print('\n== W1 code effect: non-unchanged groups')
for g in W1['groups']:
    if g.get('status')!='unchanged':
        print(f"  {g['id']} [{cls(g)}] {g['status']} {g['detector']} {g['decision'][:110]} | {g['areaCount']}/{g['fileCount']}/{g['siteCount']} | {','.join(g['files'])[:200]}")
print('gone:',[(x['id'],x['decision'][:120],x['files']) for x in W1['gone']])
# mustRule set W1 vs 11-04 (R1)
A={key(g) for g in W1['groups'] if g['mustRule']}; B={key(g) for g in R1['groups'] if g['mustRule']}
print('\nmustRule W1 minus R1:',[k[1][:100] for k in A-B]); print('mustRule R1 minus W1:',[k[1][:100] for k in B-A])
A={key(g) for g in W1['groups'] if g['table']}; B={key(g) for g in R1['groups'] if g['table']}
print('table W1 minus R1:',[k[1][:100] for k in A-B]); print('table R1 minus W1:',[k[1][:100] for k in B-A])
# mustRule groups whose site lists changed
R1m={key(g):g for g in R1['groups'] if g['mustRule']}
same=shift=files=0; ch=[]
for g in W1['groups']:
    if g['mustRule'] and key(g) in R1m:
        o=R1m[key(g)]
        if o.get('sites')==g.get('sites'): same+=1
        elif sorted(o['files'])==sorted(g['files']): shift+=1
        else: files+=1; ch.append((g['id'],g['decision'][:80],sorted(set(o['files'])^set(g['files']))))
print(f'\nmustRule site drift vs R1: identical {same}, shifted lines {shift}, file set changed {files}', ch)
