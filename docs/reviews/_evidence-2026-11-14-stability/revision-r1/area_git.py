import json, re, subprocess, sys, collections
REPO = sys.argv[1]
TARGET_SLUGS = ['runs-and-dispatch', 'front-end-pages', 'llm-and-prompts']
def git(*a):
    return subprocess.run(['git','-C',REPO,*a],capture_output=True,text=True,check=True).stdout
areas = json.load(open(REPO+'/docs/areas/areas.json'))['areas']
pats = {a['slug']: [re.compile(p) for p in a['match']] for a in areas}
order = [a['slug'] for a in areas]
def area_of(path):
    for s in order:
        for p in pats[s]:
            if p.search(path): return s
    return None
def run(label, rng, head_ref):
    # landings: first-parent merges and squash commits in range
    out = git('log','--first-parent','-m','--numstat','--format=@@%H %cI %s', rng)
    per = collections.defaultdict(lambda: {'touches':0,'add':0,'del':0,'last':None,'lastsubj':None,'landings':set(),'files':set()})
    cur=None
    for line in out.splitlines():
        if line.startswith('@@'):
            parts=line[2:].split(' ',2); cur=(parts[0],parts[1],parts[2] if len(parts)>2 else '')
            continue
        if not line.strip() or cur is None: continue
        f=line.split('\t')
        if len(f)!=3: continue
        a,d,path=f
        if path.startswith('docs/') or path.startswith('tests/') : pass
        slug=area_of(path)
        if slug not in TARGET_SLUGS: continue
        r=per[slug]
        r['files'].add(path)
        r['landings'].add(cur[0])
        r['add']+= int(a) if a.isdigit() else 0
        r['del']+= int(d) if d.isdigit() else 0
        if r['last'] is None or cur[1]>r['last']:
            r['last']=cur[1]; r['lastsubj']=cur[2][:90]
    res={}
    for s in TARGET_SLUGS:
        r=per[s]
        res[s]={'landings_touching':len(r['landings']),'files_touched':len(r['files']),'add':r['add'],'del':r['del'],'net':r['add']-r['del'],'last_landing':(r['last'] or '')[:19],'last_subject':r['lastsubj']}
    print('##',label,rng)
    for s in TARGET_SLUGS: print(s, json.dumps(res[s]))
    return per
run('window-run6-to-now','163efc069..fb358dbda', None)
run('post-v4','4b5001ddf..fb358dbda', None)
# area file counts at base/head
for ref in ['302edafc3','fb358dbda','163efc069','4b5001ddf']:
    files=git('ls-tree','-r','--name-only',ref).splitlines()
    cnt=collections.Counter(area_of(f) for f in files if f.endswith('.js') or f.endswith('.mjs'))
    print('files@',ref, {s:cnt.get(s,0) for s in TARGET_SLUGS})
