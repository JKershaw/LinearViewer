# Print sample Bash test-run commands with durations, for validating RUN_RE classification. Usage: python3 -I sample-runs.py N
import json,glob,os,re,sys,random
RUN=re.compile(r"""(?:^|[\s;&|(`'"])(node\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*--test\b|npm\s+(?:run\s+)?test(?::[\w:-]+)?\b|npm\s+t\b|npx\s+playwright\s+test\b|playwright\s+test\b)""")
fs=glob.glob(os.path.expanduser('~/.claude/projects/*simple-dispatcher-workspaces*/*.jsonl'))
random.seed(1); random.shuffle(fs)
out=[]
for f in fs[:150]:
  pend={}
  for l in open(f):
    try: e=json.loads(l)
    except: continue
    m=e.get('message') or {}
    c=m.get('content')
    if not isinstance(c,list): continue
    for b in c:
      if b.get('type')=='tool_use' and b.get('name')=='Bash' and RUN.search(b['input'].get('command','')): pend[b['id']]=(e['timestamp'],b['input']['command'])
      if b.get('type')=='tool_result' and b.get('tool_use_id') in pend:
        t0,cmd=pend.pop(b['tool_use_id'])
        from datetime import datetime
        d=(datetime.fromisoformat(e['timestamp'].replace('Z','+00:00'))-datetime.fromisoformat(t0.replace('Z','+00:00'))).total_seconds()
        r=b.get('content'); r=r if isinstance(r,str) else ''.join(x.get('text','') for x in r or [] if isinstance(x,dict))
        out.append((d,cmd.replace('\n',' ')[:230],r.replace('\n',' | ')[-200:]))
random.shuffle(out)
for d,c,r in out[:int(sys.argv[1])]: print(f"{d:7.1f}s  {c}\n          -> {r}\n")
