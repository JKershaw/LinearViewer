import json,glob,collections,sys,os
S=sys.argv[1]
byday=collections.defaultdict(lambda: collections.Counter())
roots=collections.defaultdict(set); rootcost={}; rootkind={}
issues=0; app=collections.Counter()
for f in sorted(glob.glob(S+'/cost/*.json')):
  try: d=json.load(open(f))
  except: continue
  if 'workerSessions' not in d: continue
  ident=d['identifier']
  if d['noLineage']: byday['nolineage']['issues']+=1; continue
  issues+=1
  a=d.get('appCalls') or {}; app['calls']+=a.get('calls',0); app['usd']+=a.get('costUsd',0) or 0; app['unpriced']+=a.get('unpricedCalls',0)
  app['issues_total_null']+= d['totalUsd'] is None
  for w in d['workerSessions']:
    day=(w.get('dispatchedAt') or '')[:10]
    c=byday[day]; c['sessions']+=1
    tel = w.get('model') is not None or w.get('costUsd') is not None
    if tel: c['telemetry']+=1
    if w.get('costUsd') is not None: c['priced']+=1; c['usd']+=w['costUsd']
    elif tel: c['tel_unpriced']+=1; c['m:'+str(w.get('model'))]+=1
    roots[w['rootItemId']].add(ident); rootcost[w['rootItemId']]=w.get('costUsd'); rootkind[w['rootItemId']]=w.get('kind')
print('issues with lineage', issues, 'app', dict(app))
for day in sorted(byday):
  c=byday[day]; print(day, {k:(round(v,2) if isinstance(v,float) else v) for k,v in c.items()})
multi={r:s for r,s in roots.items() if len(s)>1}
extra=sum((len(s)-1)*(rootcost[r] or 0) for r,s in multi.items())
print('roots', len(roots), 'roots under >1 issue', len(multi), 'extra counted usd', round(extra,2))
print(collections.Counter(rootkind[r] for r in multi))
for r,s in sorted(multi.items(), key=lambda x:-(rootcost[x[0]] or 0))[:5]: print(r[:8], rootkind[r], rootcost[r], len(s), sorted(s)[:6])
