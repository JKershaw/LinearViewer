import sys,re,datetime,collections,csv,json
S=sys.argv[1]
def parse(fn):
    commits=[]
    cur=None
    for line in open(fn,encoding='utf-8',errors='replace'):
        line=line.rstrip('\n')
        if line.startswith('@@@'):
            h,d,s=line[3:].split('|',2)
            cur={'h':h,'d':datetime.datetime.fromisoformat(d),'s':s,'f':[]}
            commits.append(cur)
        elif line and cur is not None:
            a,r,p=line.split('\t',2)
            if a=='-': continue
            cur['f'].append((int(a),int(r),p))
    return commits
def cat(p):
    if p.startswith('tests/unit/'): return 'unit'
    if p.startswith(('lib/','routes/','public/')) or p=='server.js': return 'prod'
    return None
commits=parse(S+'/numstat.txt')
commits.sort(key=lambda c:c['d'])
# cumulative + weekly
def wk(d):
    d=d.date(); return d-datetime.timedelta(days=d.weekday())
cum={'unit':0,'prod':0}
unitfiles=set(); created={}; deleted={}
# file existence tracked via add/delete in name-status; do separately
W=collections.OrderedDict()
for c in commits:
    w=wk(c['d'])
    if w not in W: W[w]={'unit_add':0,'unit_del':0,'prod_add':0,'prod_del':0,'commits':0,'unit_commits':0}
    W[w]['commits']+=1
    tu=False
    for a,r,p in c['f']:
        k=cat(p)
        if not k: continue
        W[w][k+'_add']+=a; W[w][k+'_del']+=r; cum[k]+=a-r
        if k=='unit': tu=True
    if tu: W[w]['unit_commits']+=1
    W[w]['unit_cum']=cum['unit']; W[w]['prod_cum']=cum['prod']
json.dump({str(k):v for k,v in W.items()},open(S+'/weekly_raw.json','w'),indent=1)
print('final cum',cum)
