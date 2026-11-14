import json, re, subprocess, sys, collections
REPO=sys.argv[1]; RNG=sys.argv[2]; WANT=sys.argv[3].split(',')
def git(*a): return subprocess.run(['git','-C',REPO,*a],capture_output=True,text=True,check=True).stdout
areas=json.load(open(REPO+'/docs/areas/areas.json'))['areas']
pats={a['slug']:[re.compile(p) for p in a['match']] for a in areas}
order=[a['slug'] for a in areas]
def area_of(p):
    for s in order:
        if any(r.search(p) for r in pats[s]): return s
out=git('log','--first-parent','-m','--numstat','--format=@@%h %cI %s',RNG)
rows=[]; cur=None; agg=collections.defaultdict(lambda:[0,0])
for line in out.splitlines():
    if line.startswith('@@'):
        if cur: rows.append(cur)
        h,d,s=line[2:].split(' ',2); cur={'h':h,'d':d[:16],'s':s,'a':collections.Counter(),'dl':collections.Counter()}; continue
    f=line.split('\t')
    if len(f)!=3 or cur is None: continue
    sl=area_of(f[2])
    if sl in WANT:
        cur['a'][sl]+=int(f[0]) if f[0].isdigit() else 0
        cur['dl'][sl]+=int(f[1]) if f[1].isdigit() else 0
if cur: rows.append(cur)
for slug in WANT:
    print('###',slug)
    for r in rows:
        if r['a'][slug] or r['dl'][slug]:
            print(f"  {r['d']} {r['h']} +{r['a'][slug]}/-{r['dl'][slug]}  {r['s'][:85]}")
