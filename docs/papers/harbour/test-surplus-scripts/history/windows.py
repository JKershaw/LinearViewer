import sys,datetime,json
S=sys.argv[1]
commits=[];cur=None
for line in open(S+'/numstat.txt',encoding='utf-8',errors='replace'):
    line=line.rstrip('\n')
    if line.startswith('@@@'):
        h,d,s=line[3:].split('|',2); cur={'d':datetime.datetime.fromisoformat(d).date(),'u':0,'p':0,'un':0,'pn':0}; commits.append(cur)
    elif line and cur:
        a,r,p=line.split('\t',2)
        if a=='-': continue
        a,r=int(a),int(r)
        if p.startswith('tests/unit/'): cur['u']+=a; cur['un']+=a-r
        elif p.startswith(('lib/','routes/','public/')) or p=='server.js': cur['p']+=a; cur['pn']+=a-r
def win(a,b):
    cs=[c for c in commits if a<=c['d']<b]
    u=sum(c['u'] for c in cs); p=sum(c['p'] for c in cs); un=sum(c['un'] for c in cs); pn=sum(c['pn'] for c in cs)
    days=(b-a).days
    return u/days*7,p/days*7,un/days*7,pn/days*7,(u/p if p else 0)
rules=[('2026-06-16','SD CLAUDE.md adopts TDD (LIN-447; SD repo only)'),
('2026-06-22','bug template: validate the acceptance witness (LIN-585)'),
('2026-06-26','implementation: characterization test before refactor (LIN-698)'),
('2026-06-29','review: What CI Did Not Prove ledger + close-out split (LIN-550)'),
('2026-08-22','implementation: observe your test fail (LIN-2219)'),
('2026-08-24','review: mutation-check load-bearing tests (LIN-2274); retrospective audit (LIN-2261)'),
('2026-09-12','SD CLAUDE.md: runtime witness (LIN-1220; SD repo only)'),
('2026-09-18','LV CLAUDE.md byte cap + source-map checked at test time (LIN-2896)'),
('2026-10-02','LV CLAUDE.md prompt freeze: lesson lands as code or test (LIN-3203)'),
('2026-10-06','close-out: "a claim a test could have proven is ... untested" (LIN-3326)')]
print('rule date | rule | 21d before: unit add/wk, prod add/wk, ratio | 21d after: unit add/wk, prod add/wk, ratio')
out=[]
for d,l in rules:
    D=datetime.date.fromisoformat(d); W=datetime.timedelta(days=21)
    end=min(D+W,datetime.date(2026,10,13))
    b=win(D-W,D); a=win(D,end)
    out.append(dict(date=d,rule=l,before=b,after=a,after_days=(end-D).days))
    print(f'{d} | {l[:70]:70s} | {b[0]:7.0f} {b[1]:7.0f} {b[4]:4.2f} | {a[0]:7.0f} {a[1]:7.0f} {a[4]:4.2f} ({(end-D).days}d)')
json.dump(out,open(S+'/rule_windows.json','w'),indent=1,default=str)
# monthly ratio
import collections
m=collections.defaultdict(lambda:[0,0])
for c in commits:
    k=c['d'].isoformat()[:7]; m[k][0]+=c['u']; m[k][1]+=c['p']
for k in sorted(m): print(k, m[k], round(m[k][0]/max(1,m[k][1]),2))
