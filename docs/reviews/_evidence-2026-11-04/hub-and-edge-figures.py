import json, sys, collections
E=sys.argv[1]
def load(name): return json.load(open(f'{E}/edges-code-{name}.json'))['edgeList']
runs={'015':load('015aa4c6-guide-5334c81a'),'5334':load('5334c81a-guide-5334c81a')}
for k,edges in runs.items():
    print('#####',k,'edges',len(edges))
    cross=[e for e in edges if e['fromArea']!=e['toArea']]
    def imp(target):
        ins=[e for e in edges if e['to']==target]
        return ins
    for t in ['lib/cost-read.js','lib/request-usage-intake.js','lib/request-usage-store.js','lib/founder-lookup.js','lib/cost-format.js','lib/key-state.js','lib/key-state-holders.js','lib/workspace-issues-memo.js','lib/task-state.js','lib/subtree-index.js','lib/home-row-states.js','lib/task-page-loader.js','lib/run-controls.js','lib/proxy-preamble.js','lib/tree.js','lib/recommendation-facts.js','lib/render-run-steps.js','lib/errors.js','lib/utils/time.js','lib/read-horizon.js','lib/providers/state-map.js','lib/workspace.js','lib/openrouter.js','lib/utils/html.js','lib/chat-request.js','lib/prompt-templates.js','lib/routing-ruling.js','routes/test.js','lib/model-routing-spend.js','lib/model-routing-history.js','lib/run-view.js']:
        ins=imp(t); xin=[e for e in ins if e['fromArea']!=e['toArea']]
        outs=[e for e in edges if e['from']==t]; xout=[e for e in outs if e['fromArea']!=e['toArea']]
        print(f'{t}: importers {len(ins)} cross-in {len(xin)} from {sorted(set(e["fromArea"] for e in xin))} | out {len(outs)} cross-out {len(xout)} to {sorted(set(e["toArea"] for e in xout))}')
    print(' cost-read importers:', sorted(e['from'] for e in imp('lib/cost-read.js')))
    print(' request-usage-intake importers:', sorted((e['from'],e['fromArea']) for e in imp('lib/request-usage-intake.js')))
    print(' request-usage-store importers:', sorted((e['from'],e['fromArea']) for e in imp('lib/request-usage-store.js')))
    print(' proxy-preamble importers:', sorted((e['from'],e['fromArea'][:12]) for e in imp('lib/proxy-preamble.js')))
    print(' cost-format importers:', sorted(e['from'] for e in imp('lib/cost-format.js')))
    print(' tree.js importers:', sorted(e['from'] for e in imp('lib/tree.js')))
    print(' run-controls importers:', len(imp('lib/run-controls.js')), 'cross', len([e for e in imp('lib/run-controls.js') if e['fromArea']!=e['toArea']]))
    rr=[e for e in edges if e['from'].startswith('routes/') and e['to'].startswith('routes/')]
    print(' route->route edges (all):', len(rr), ' cross-area:', len([e for e in rr if e['fromArea']!=e['toArea']]))
    lr=[e for e in edges if e['from'].startswith('lib/') and e['to'].startswith('routes/')]
    print(' lib->routes edges:', len(lr))
    print(' cross-area edges from Other:', len([e for e in cross if e['fromArea']=='Other features' or e['toArea']=='Other features']))
    wf=collections.Counter(e['to'] for e in edges)
