import json,statistics,collections,sys,csv
S=sys.argv[1]
P=json.load(open(S+'/pr_level.json'))
for since in ['2026-09-01','2026-06-01']:
    prs=[p for p in P if p['date']>=since and p['prod_lines']>0]
    n=len(prs)
    mod=[p for p in prs if p['existing_unit_modified']>0]
    touch=[p for p in prs if p['existing_unit_touched']>0]
    anyunit=[p for p in prs if p['unit_add']+p['unit_del']>0]
    print(f'== product-changing first-parent commits since {since}: {n}')
    print(f'  touching any unit test: {len(anyunit)} ({100*len(anyunit)/n:.1f}%)')
    print(f'  touching >=1 pre-existing unit file: {len(touch)} ({100*len(touch)/n:.1f}%)')
    print(f'  removing/modifying lines in >=1 pre-existing unit file: {len(mod)} ({100*len(mod)/n:.1f}%)')
    print('  median existing unit files touched per product PR:',statistics.median(p['existing_unit_touched'] for p in prs),' mean',round(statistics.mean(p['existing_unit_touched'] for p in prs),2))
    print('  median existing unit files modified (lines removed) per product PR:',statistics.median(p['existing_unit_modified'] for p in prs))
    print('  among PRs touching existing: median',statistics.median(p['existing_unit_touched'] for p in touch))
    print('  p90 existing touched', sorted(p['existing_unit_touched'] for p in prs)[int(0.9*n)])
    print('  total existing-file lines removed',sum(p['existing_unit_removed_lines'] for p in prs),'vs prod lines changed',sum(p['prod_lines'] for p in prs))
    # by product size bucket
    for lo,hi in [(1,20),(21,100),(101,500),(501,10**9)]:
        b=[p for p in prs if lo<=p['prod_lines']<=hi]
        if b: print(f'   prod {lo}-{hi}: n={len(b)} modify-existing {100*sum(p["existing_unit_modified"]>0 for p in b)/len(b):.0f}% median existing touched {statistics.median(p["existing_unit_touched"] for p in b)}')
# most-edited test files by distinct tickets since Sep 1 (edits to pre-existing files only, i.e. not the creating PR)
ft=collections.defaultdict(set); fc=collections.Counter(); fprod=collections.defaultdict(set)
for p in P:
    if p['date']<'2026-09-01': continue
    for f in p['existing_files']:
        ft[f].add(p['ticket']); fc[f]+=1
        if p['prod_lines']>0: fprod[f].add(p['ticket'])
lead=sorted(ft,key=lambda f:-len(ft[f]))[:30]
with open(S+'/pin_tax_leaders.csv','w',newline='') as fh:
    w=csv.writer(fh); w.writerow(['file','distinct_tickets_editing_existing_since_sep1','edit_commits','distinct_product_tickets','tickets'])
    for f in sorted(ft,key=lambda f:-len(ft[f])):
        w.writerow([f,len(ft[f]),fc[f],len(fprod[f]),' '.join(sorted(t or '?' for t in ft[f]))])
print('== pin-tax leaders (distinct tickets editing an already-existing file, since 2026-09-01)')
for f in lead: print(f'  {len(ft[f]):3d} tickets {fc[f]:3d} commits  {f}')
print('files edited by >=5 tickets:',sum(1 for f in ft if len(ft[f])>=5),' >=10:',sum(1 for f in ft if len(ft[f])>=10))
