# Validate run detection after stripping heredoc bodies / long quoted payloads: how many matched commands have no test-runner output signature?
import json,glob,os,re,sys,random
RUN=re.compile(r"""(?:^|[\s;&|(`'"])(node\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*--test\b|npm\s+(?:run\s+)?test(?::[\w:-]+)?\b|npm\s+t\b|npx\s+playwright\s+test\b|playwright\s+test\b|node\s+scripts/assert-unit-suite-hermetic\.mjs)""")
HD=re.compile(r"""<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)""")
SQ=re.compile(r"""'[^']{150,}'""")
SIG=re.compile(r"""ℹ (?:tests|pass|fail) \d|^# (?:tests|pass|fail) \d|\d+ (?:passed|failed|skipped|flaky)\b|^\s*[✔✖✓✘] |^(?:not )?ok \d|Running \d+ tests? using|running in background|Command running|tests? \d+|\bTAP version|Error:|ERR_|Exit code""",re.M)
def strip(c): return SQ.sub("'<Q>'",HD.sub(lambda m:'<<H'+m.group(3),c))
fs=glob.glob(os.path.expanduser('~/.claude/projects/*simple-dispatcher-workspaces*/*.jsonl'))
random.seed(2); random.shuffle(fs)
raw=kept=nosig=0; ex=[]; dropped=[]
for f in fs[:400]:
  pend={}
  for l in open(f):
    try: e=json.loads(l)
    except: continue
    c=(e.get('message') or {}).get('content')
    if not isinstance(c,list): continue
    for b in c:
      if b.get('type')=='tool_use' and b.get('name')=='Bash':
        cmd=b['input'].get('command','')
        if RUN.search(cmd):
          raw+=1
          if RUN.search(strip(cmd)): kept+=1; pend[b['id']]=cmd
          else: dropped.append(cmd[:160].replace('\n',' '))
      if b.get('type')=='tool_result' and b.get('tool_use_id') in pend:
        cmd=pend.pop(b['tool_use_id']); r=b.get('content'); r=r if isinstance(r,str) else ''.join(x.get('text','') for x in r or [] if isinstance(x,dict))
        if not SIG.search(r): nosig+=1; ex.append((strip(cmd)[:200].replace('\n',' '), r[-150:].replace('\n',' | ')))
print(dict(raw=raw,kept=kept,nosig=nosig))
random.shuffle(dropped); random.shuffle(ex)
print("DROPPED:"); [print('  ',d) for d in dropped[:8]]
print("NOSIG:"); [print('  ',c,'\n      ->',r) for c,r in ex[:15]]
