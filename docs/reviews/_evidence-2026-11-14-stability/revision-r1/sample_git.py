import subprocess, sys, collections
REPO='.'
S='/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c4d058e4-99b2-4516-94fa-4cefb5107221/c4d058e4-99b2-4516-94fa-4cefb5107221/scratchpad'
def git(*a): return subprocess.run(['git','-C',REPO,*a],capture_output=True,text=True,check=True).stdout
def measure(label, sample_file, rng, anchor):
    files=[l.strip() for l in open(sample_file) if l.strip()]
    # first-parent landings touching sample files
    out=git('log','--first-parent','-m','--numstat','--format=@@%h %cI %s',rng,'--',*files)
    lands=[]; cur=None
    for line in out.splitlines():
        if line.startswith('@@'):
            h,d,s=line[2:].split(' ',2); cur={'h':h,'d':d,'s':s,'add':0,'del':0,'files':set()}; lands.append(cur); continue
        f=line.split('\t')
        if len(f)==3 and cur is not None and f[2] in files:
            cur['add']+=int(f[0]) if f[0].isdigit() else 0
            cur['del']+=int(f[1]) if f[1].isdigit() else 0
            cur['files'].add(f[2])
    lands=[l for l in lands if l['files']]
    add=sum(l['add'] for l in lands); dl=sum(l['del'] for l in lands)
    after=[l for l in lands if l['d']>git('log','-1','--format=%cI',anchor).strip()]
    last=lands[0] if lands else None
    print(f"{label}: range {rng}; landings touching sample {len(lands)}; files touched {len(set().union(*[l['files'] for l in lands])) if lands else 0}/14; +{add}/-{dl} net {add-dl}; after anchor {anchor}: {len(after)} landings; last: {last['d'][:16] if last else '-'} {last['h'] if last else ''} {last['s'][:70] if last else ''}")
    return lands
measure('RUNS before->after', f'{S}/runs_sample.txt','4b5001ddf..302edafc3','302edafc3')
measure('RUNS after->head', f'{S}/runs_sample.txt','302edafc3..fb358dbda','302edafc3')
measure('LLM before->after', f'{S}/llm_sample.txt','e8e92d50a..49776653d','49776653d')
measure('LLM after->head', f'{S}/llm_sample.txt','49776653d..fb358dbda','49776653d')
measure('FE(control) before->after', f'{S}/fe_sample.txt','4b5001ddf..302edafc3','302edafc3')
measure('FE(control) e8->49776', f'{S}/fe_sample.txt','e8e92d50a..49776653d','49776653d')
measure('FE(control) after->head', f'{S}/fe_sample.txt','302edafc3..fb358dbda','302edafc3')
measure('FE(control) run6 window', f'{S}/fe_sample.txt','163efc069..fb358dbda','302edafc3')
