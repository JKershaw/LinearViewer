import os,re,subprocess,json,sys,glob
S=sys.argv[1]
import os; R=os.environ.get('LV', '.')  # path to a LinearViewer checkout
os.chdir(R)
def g(*a): return subprocess.run(['git',*a],capture_output=True,text=True).stdout
files=sorted(glob.glob('tests/unit/lin-*.js'))
step=len(files)/30
sample=[files[int(i*step)] for i in range(30)]
out=[]
for f in sample:
    t=open(f,encoding='utf-8',errors='replace').read()
    created=g('log','--diff-filter=A','--format=%H|%ad|%s','--date=short','--',f).strip().splitlines()[-1].split('|',2)
    ch,cd,cs=created
    edits=len(g('log','--format=%h','--',f).split())-1
    # imports
    imps=re.findall(r"""(?:import\s+(?:([\w{}\s,*$]+?)\s+from\s+)?|import\()\s*['"](\.\.?/[^'"]+)['"]""",t)
    srcrefs=set(re.findall(r"""['"`]((?:lib|routes|public)/[\w./-]+\.(?:js|css|mjs)|server\.js)['"`]""",t))
    mods=[]
    for names,p in imps:
        ap=os.path.normpath(os.path.join(os.path.dirname(f),p))
        if not ap.startswith(('lib','routes','public','server.js','scripts')): continue
        exists=os.path.exists(ap)
        syms=[s.strip().split(' as ')[0] for s in re.sub(r'[{}]','',names or '').split(',') if s.strip() and s.strip()!='*']
        missing=[]
        if exists:
            src=open(ap,encoding='utf-8',errors='replace').read()
            missing=[s for s in syms if not re.search(r'\b'+re.escape(s)+r'\b',src)]
        mods.append((ap,exists,missing))
    targets=sorted({m[0] for m in mods}|srcrefs)
    churn=[]
    for tf in targets:
        if not os.path.exists(tf): churn.append((tf,'MISSING',None,None)); continue
        size=sum(1 for _ in open(tf,encoding='utf-8',errors='replace'))
        ns=g('diff','--numstat',ch,'HEAD','--',tf).split()
        a,r=(int(ns[0]),int(ns[1])) if ns else (0,0)
        churn.append((tf,size,a,r))
    absence=len(re.findall(r'doesNotMatch|\.not\.|!\s*\w+\.includes\(|assert\.ok\(\s*!',t))
    srcread=bool(re.search(r'readFileSync',t)) and bool(srcrefs or re.search(r"(lib|routes)/",t))
    out.append(dict(file=f,created=cd,creating_commit=ch[:10],subject=cs[:100],edits_since=edits,lines=t.count('\n'),
        imports=[(m[0],m[1],m[2]) for m in mods],source_refs=sorted(srcrefs),churn=churn,absence_assertions=absence,reads_source=srcread))
json.dump(out,open(S+'/obsolete_sample.json','w'),indent=1)
for o in out:
    mx=max([ (r/size if isinstance(size,int) and size else 0) for tf,size,a,r in o['churn'] if size!='MISSING'] or [0])
    miss=[c[0] for c in o['churn'] if c[1]=='MISSING']
    msym=[(m[0],m[2]) for m in o['imports'] if m[2]]
    print(f"{o['file'][11:60]:50s} {o['created']} edits={o['edits_since']:2d} tgt={len(o['churn'])} maxRemovedFrac={mx:.2f} missingFiles={miss} missingSyms={msym} absence={o['absence_assertions']} src={o['reads_source']}")
