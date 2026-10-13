import sys,re,datetime,collections,json,csv,statistics
S=sys.argv[1]
SINCE=datetime.datetime.fromisoformat('2026-06-01T00:00:00+00:00')
# messages
msgs={}
for rec in open(S+'/fp_msgs.txt',encoding='utf-8',errors='replace').read().split('\x1e'):
    rec=rec.strip('\n')
    if not rec: continue
    h,b=rec.split('\x00',1); msgs[h]=b
def ticket(h):
    b=msgs.get(h,'')
    subj=b.split('\n',1)[0]
    m=re.search(r'LIN-(\d+)',subj,re.I)
    if m: return 'LIN-'+m.group(1)
    m=re.search(r'lin-(\d+)',subj,re.I)  # branch name in merge subject
    if m: return 'LIN-'+m.group(1)
    m=re.search(r'LIN-(\d+)',b)
    if m: return 'LIN-'+m.group(1)
    return None
# numstat first-parent
commits=[];cur=None
for line in open(S+'/fp_numstat.txt',encoding='utf-8',errors='replace'):
    line=line.rstrip('\n')
    if line.startswith('@@@'):
        h,d,s=line[3:].split('|',2); cur={'h':h,'d':datetime.datetime.fromisoformat(d),'s':s,'f':{}}; commits.append(cur)
    elif line and cur:
        a,r,p=line.split('\t',2)
        if a=='-': continue
        cur['f'][p]=(int(a),int(r))
commits.sort(key=lambda c:c['d'])
byh={c['h']:c for c in commits}
# name-status for unit A/D
ns=collections.defaultdict(list);cur=None
for line in open(S+'/fp_unit_ns.txt'):
    line=line.rstrip('\n')
    if line.startswith('@@@'): cur=line[3:]
    elif line and cur:
        st,p=line.split('\t',1); ns[cur].append((st[0],p))
# patches: per commit per file added text
patch=collections.defaultdict(lambda:collections.defaultdict(list));cur=None;f=None
for line in open(S+'/fp_unit_patch.txt',encoding='utf-8',errors='replace'):
    if line.startswith('@@@'):
        cur=line[3:].split('|')[0]; f=None
    elif line.startswith('+++ '):
        f=line[6:].rstrip('\n') if line.startswith('+++ b/') else None
    elif line.startswith('+') and not line.startswith('+++') and f:
        patch[cur][f].append(line[1:])
def isunit(p): return p.startswith('tests/unit/')
def isprod(p): return p.startswith(('lib/','routes/','public/')) or p=='server.js'
base=lambda p:p.rsplit('/',1)[-1]
PIN=re.compile(r'pin|drift|parity|census|contract|budget|source-scan|absence|guard|invariant|shape|snapshot',re.I)
WIT=re.compile(r'witness|evidence|close-?out|ledger|discharge|review|audit|probe|acceptance|characteri',re.I)
LESSON=re.compile(r'lesson|code owns|code carries|as code|LIN-3203|prompt.size',re.I)
TDD=re.compile(r'test-first|test first|\bTDD\b|failing test|red first|fails before|goes red|red-green|failing-then-passing',re.I)
def ticket_kind(subjs):
    t=' '.join(subjs).lower()
    if re.search(r'\breview\b|close-?out|ledger|discharge|audit|witness',t): return 'review/close-out/witness'
    if re.search(r'\bretire|remove|delete|revert|dead|drop\b',t): return 'retire/remove'
    if re.search(r'\bfix|bug|regression|hotfix|repair|broken|wrong|stale|leak',t): return 'fix'
    return 'feature/other'
# tickets' subjects
tsubj=collections.defaultdict(list)
for c in commits:
    t=ticket(c['h']); 
    if t: tsubj[t].append(c['s'])
tkind={t:ticket_kind(v) for t,v in tsubj.items()}
# existence tracking: files alive before each commit
alive=set()
created=[]  # files created since June
per_commit=[]
for c in commits:
    h=c['h']; t=ticket(h); msg=msgs.get(h,'')
    adds={p for st,p in ns.get(h,[]) if st=='A' and isunit(p)}
    dels={p for st,p in ns.get(h,[]) if st=='D' and isunit(p)}
    unit_files={p:v for p,v in c['f'].items() if isunit(p)}
    prod=sum(a+r for p,(a,r) in c['f'].items() if isprod(p))
    prod_add=sum(a for p,(a,r) in c['f'].items() if isprod(p))
    existing_touched=[p for p in unit_files if p in alive and p not in adds]
    existing_modified=[p for p in existing_touched if unit_files[p][1]>0]
    existing_removed_lines=sum(unit_files[p][1] for p in existing_touched)
    rec=dict(h=h[:10],date=c['d'].date().isoformat(),ticket=t,subject=c['s'][:120],prod_lines=prod,prod_add=prod_add,
             unit_add=sum(a for a,r in unit_files.values()),unit_del=sum(r for a,r in unit_files.values()),
             new_unit_files=len(adds),deleted_unit_files=len(dels),existing_unit_touched=len(existing_touched),
             existing_unit_modified=len(existing_modified),existing_unit_removed_lines=existing_removed_lines,
             existing_files=existing_touched, new_files=sorted(adds))
    if c['d']>=SINCE:
        for p in adds:
            b=base(p); tags=[]
            if re.match(r'lin-?\d+',b,re.I): tags.append('a_ticket_named')
            txt='\n'.join(patch[h].get(p,[])[:60])
            if PIN.search(b): tags.append('f_pin_drift')
            if WIT.search(b) or WIT.search(c['s']): tags.append('c_witness_review')
            if c['d']>=datetime.datetime.fromisoformat('2026-10-02T00:00:00+01:00') and (LESSON.search(msg) or LESSON.search(txt)): tags.append('d_lesson_as_code')
            if TDD.search(msg) or TDD.search(txt): tags.append('e_tdd')
            if not tags or tags==['a_ticket_named']: pass
            primary=tags[0] if tags else 'b_feature_module'
            fileticket=re.match(r'lin-?(\d+)',b,re.I)
            created.append(dict(file=p,date=c['d'].date().isoformat(),commit=h[:10],ticket=t,file_ticket=('LIN-'+fileticket.group(1)) if fileticket else None,
               lines=unit_files.get(p,(0,0))[0],tags='|'.join(tags) or 'b_feature_module',primary=primary,ticket_kind=tkind.get(t,'none'),subject=c['s'][:120],alive_at_head=None))
        # line attribution per file-commit
        for p,(a,r) in unit_files.items():
            txt='\n'.join(patch[h].get(p,[]))
            b=base(p)
            per_commit.append(dict(h=h[:10],date=c['d'].date().isoformat(),ticket=t,kind=tkind.get(t,'none'),file=p,add=a,rem=r,new=p in adds,
                lin=bool(re.match(r'lin-?\d+',b,re.I)),pinname=bool(PIN.search(b)),
                v_witness=bool(re.search(r'witness',txt+b+c['s'],re.I)),
                v_observe_fail=bool(re.search(r'observ\w* (it )?fail|goes red|go red|fails? (on|against) the unfixed|before the fix|mutation',txt+msg,re.I)),
                v_mutation=bool(re.search(r'mutation',txt+msg,re.I)),
                v_characterization=bool(re.search(r'characteri[sz]',txt+b+msg,re.I)),
                v_ledger=bool(re.search(r'ledger|discharge|close-?out|What CI Did Not Prove',txt+c['s'],re.I)),
                v_pin=bool(re.search(r'\bpin|drift|census|source-scan|count-pin|parity',txt+b,re.I)),
                v_lesson=bool(LESSON.search(msg) or re.search(r'lesson',txt,re.I)),
                v_regression=bool(re.search(r'regression',txt+b,re.I)),
                v_tdd=bool(TDD.search(msg+txt))))
        per_commit_rec=rec
    alive|=adds; alive-=dels
    per_commit.append if False else None
    rec['in_window']=c['d']>=SINCE
    c['rec']=rec
headset=alive
for x in created: x['alive_at_head']=x['file'] in headset
json.dump([c['rec'] for c in commits if c['rec']['in_window']],open(S+'/pr_level.json','w'),indent=0)
with open(S+'/created_since_june.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(created[0])); w.writeheader(); w.writerows(created)
with open(S+'/test_line_chunks.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(per_commit[0])); w.writeheader(); w.writerows(per_commit)
print('created since june',len(created),'alive',sum(x['alive_at_head'] for x in created))
print(collections.Counter(x['primary'] for x in created))
tagc=collections.Counter(t for x in created for t in x['tags'].split('|')); print(tagc)
