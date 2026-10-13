import csv,collections,sys
S=sys.argv[1]
rows=list(csv.DictReader(open(S+'/test_line_chunks.csv')))
for r in rows:
    r['add']=int(r['add']); r['rem']=int(r['rem'])
    for k in r:
        if r[k] in('True','False'): r[k]=r[k]=='True'
T=sum(r['add'] for r in rows); R=sum(r['rem'] for r in rows)
print('since 2026-06-01 PR-level unit lines added',T,'removed',R,'net',T-R)
def share(pred,rs=rows,label=''):
    a=sum(r['add'] for r in rs if pred(r)); tot=sum(r['add'] for r in rs)
    print(f'  {label:55s} {a:7d} / {tot:7d} = {100*a/tot:5.1f}%')
print('By file type:')
share(lambda r:r['new'],label='lines in files created by that same PR')
share(lambda r:not r['new'],label='lines appended to pre-existing files')
share(lambda r:r['lin'],label='lines in lin-NNNN-* files')
share(lambda r:r['pinname'],label='lines in pin/drift/parity/contract/guard-named files')
print('By ticket kind (heuristic from subjects):')
for k in sorted(set(r['kind'] for r in rows)): share(lambda r,k=k:r['kind']==k,label=k)
print('By month:')
for m in sorted(set(r['date'][:7] for r in rows)):
    rs=[r for r in rows if r['date'][:7]==m]
    print(' ',m, 'add',sum(r['add'] for r in rs),'lin%',round(100*sum(r['add'] for r in rs if r['lin'])/max(1,sum(r['add'] for r in rs)),1),
      'new-file%',round(100*sum(r['add'] for r in rs if r['new'])/max(1,sum(r['add'] for r in rs)),1))
rules=[('2026-06-22','v_witness','bug template acceptance witness (LIN-585)'),
       ('2026-06-26','v_characterization','characterization test before refactor (LIN-698)'),
       ('2026-06-29','v_ledger','What CI Did Not Prove ledger / close-out (LIN-550)'),
       ('2026-08-22','v_observe_fail','implementation: observe it fail (LIN-2219)'),
       ('2026-08-22','v_witness','implementation acceptance-witness (LIN-2219) vocab=witness'),
       ('2026-08-24','v_mutation','review mutation-check (LIN-2274)'),
       ('2026-09-12','v_witness','SD CLAUDE.md runtime witness (LIN-1220)'),
       ('2026-09-18','v_pin','CLAUDE.md "checked against source at test time" (LIN-2896)'),
       ('2026-10-02','v_lesson','CLAUDE.md prompt freeze: lesson lands as code/test (LIN-3203)'),
       ('2026-06-01','v_regression','"regression" vocabulary (any)'),
       ('2026-06-01','v_tdd','TDD/test-first vocabulary (any)')]
print('Rule vocab share of test lines added since rule landed:')
for d,k,l in rules:
    rs=[r for r in rows if r['date']>=d]
    pre=[r for r in rows if r['date']<d]
    a=sum(r['add'] for r in rs if r[k]); tot=sum(r['add'] for r in rs)
    pa=sum(r['add'] for r in pre if r[k]); pt=sum(r['add'] for r in pre)
    print(f'  {d} {l:62s} after {a:6d}/{tot:6d}={100*a/tot:5.1f}%  before {100*pa/max(pt,1):5.1f}% (n={pt})')
