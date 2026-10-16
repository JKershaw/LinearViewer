import sys,datetime,collections,json,csv
S=sys.argv[1]
ev=[];cur=None
for line in open(S+'/unit_namestatus.txt'):
    line=line.rstrip('\n')
    if line.startswith('@@@'):
        h,d,s=line[3:].split('|',2); cur=(h,datetime.datetime.fromisoformat(d),s)
    elif line:
        parts=line.split('\t')
        st=parts[0][0]
        ev.append((cur[1],cur[0],cur[2],st,parts[1:]))
ev.sort(key=lambda e:e[0])
def wk(d):
    d=d.date(); return d-datetime.timedelta(days=d.weekday())
W=collections.defaultdict(lambda:{'files_created':0,'files_deleted':0,'lin_created':0})
alive=set(); created={}; deletedlist=[]
for d,h,s,st,p in ev:
    w=wk(d)
    if st=='A':
        f=p[0]; alive.add(f); created.setdefault(f,[]).append((d.isoformat(),h,s)); W[w]['files_created']+=1
        if f.startswith('tests/unit/lin-'): W[w]['lin_created']+=1
    elif st=='D':
        f=p[0]; alive.discard(f); deletedlist.append((d.isoformat(),h[:8],s,f)); W[w]['files_deleted']+=1
    elif st=='R':
        alive.discard(p[0]); alive.add(p[1])
    W[w]['alive']=len(alive)
raw=json.load(open(S+'/weekly_raw.json'))
rows=[]; alivec=0
weeks=sorted(set(raw)|{str(k) for k in W})
for w in weeks:
    r=raw.get(w,{}); f=W.get(datetime.date.fromisoformat(w),{})
    if 'alive' in f: alivec=f['alive']
    rows.append(dict(week_start=w,commits_touching_unit_or_prod=r.get('commits',0),commits_touching_unit=r.get('unit_commits',0),unit_files_created=f.get('files_created',0),unit_lin_files_created=f.get('lin_created',0),unit_files_deleted=f.get('files_deleted',0),unit_files_alive=alivec,unit_lines_added=r.get('unit_add',0),unit_lines_removed=r.get('unit_del',0),unit_lines_cum=r.get('unit_cum',None),prod_lines_added=r.get('prod_add',0),prod_lines_removed=r.get('prod_del',0),prod_lines_cum=r.get('prod_cum',None)))
# fill cum forward
lu=lp=0
for r in rows:
    if r['unit_lines_cum'] is None: r['unit_lines_cum']=lu
    if r['prod_lines_cum'] is None: r['prod_lines_cum']=lp
    lu=r['unit_lines_cum']; lp=r['prod_lines_cum']
with open(S+'/growth_allweeks.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
with open(S+'/growth.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0])); w.writeheader(); w.writerows([r for r in rows if r['week_start']>='2026-05-25'])
json.dump(deletedlist,open(S+'/deleted_unit_files.json','w'),indent=1)
json.dump(created,open(S+'/created_unit_files.json','w'),indent=1)
print(len(alive), 'created',sum(len(v) for v in created.values()),'distinct',len(created),'deleted',len(deletedlist))
