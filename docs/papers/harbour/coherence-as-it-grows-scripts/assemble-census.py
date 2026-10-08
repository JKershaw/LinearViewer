#!/usr/bin/env python3 -I
"""Assemble the companion census file for the paper from the per-snapshot outputs in data/."""
import json, os, collections, re
D = os.environ.get('COHERENCE_DATA', os.path.join(os.getcwd(), 'data'))  # run from the repo root; outputs of coherence-census.mjs live here
snaps = [('2026-01', '6c959c2bb996b7120d2421022c4bff467e119146', '2026-01-31'), ('2026-02', 'cd20df11b9cb6a375e1d1a8223cc4de5cc3e5ea5', '2026-02-26'), ('2026-03', 'abde98e753446b3fb6ac7636f24c75f4bd91613b', '2026-03-30'), ('2026-04', '8298af180343c3d0c1564d68604394f59500386f', '2026-04-25'), ('2026-05', '05d33f51190e0aca14207e3e985dd64f387e8199', '2026-05-31'), ('2026-06', '462ecafd44a0e85482f3b566add883b42a316051', '2026-06-30'), ('2026-07', 'a208d6b3a9708a6f348e6028edd03687414b34e6', '2026-07-31'), ('2026-08', '8b2be4242af92c3fde664da7bac8359854332b6d', '2026-08-31'), ('2026-09', '982fc662fcb4e85413e114529b23ec2ef8e8b46d', '2026-09-30'), ('2026-10', 'd61903f39f757ec84f989f541f0552dd86c8b26f', '2026-10-07')]
codes = json.load(open(D + '/admissions-head-codes.json'))
bytext = {h['text']: h['class'] for h in codes['hits']}
series = []
for m, sha, day in snaps:
    a = json.load(open(f'{D}/admissions-{sha}.json'))
    cls = collections.Counter(bytext.get(h['text'], '?') for h in a['hits'])
    c = json.load(open(f'{D}/clones/{sha[:8]}/summary.json'))
    row = {'month': m, 'sha': sha[:8], 'day': day, 'prodFiles': a['prodFiles'], 'prodLines': a['prodLines'],
           'jscpd50': {'lines': c['totalLines'], 'duplicatedLines': c['duplicatedLines'], 'percentage': c['percentage'], 'clones': c['clones'], 'crossFilePairs': c['crossFilePairs'], 'crossAreaPairs': c['crossAreaPairs']},
           'admissions': {'all': a['admissions'], 'files': a['admissionFiles'], 'T': cls['T'], 'S': cls['S'], 'H': cls['H'], 'P': cls['P'], 'O': cls['O'], 'unmatched': cls['?']},
           'syncTests': a['syncTests']}
    row['twinsPer10kLines'] = round(1e4 * cls['T'] / a['prodLines'], 2)
    row['crossFilePairsPer10kLines'] = round(1e4 * c['crossFilePairs'] / a['prodLines'], 2)
    p30 = f'{D}/clones30/{sha[:8]}/summary.json'
    if os.path.exists(p30):
        c30 = json.load(open(p30)); row['jscpd30'] = {'percentage': c30['percentage'], 'clones': c30['clones'], 'crossFilePairs': c30['crossFilePairs']}
    series.append(row)
mirrored = json.load(open(D + '/mirrored.json'))
prs = json.load(open(D + '/prs.json'))
bym = collections.defaultdict(lambda: {'prs': 0, 'mirrored': 0, 'pairs': 0})
for r in prs: bym[r['day'][:7]]['prs'] += 1
for o in mirrored['mirrored']: bym[o['day'][:7]]['mirrored'] += 1; bym[o['day'][:7]]['pairs'] += len(o['pairs'])
coupling = {}
for w in ['2026-01-01', '2026-02-01', '2026-06-01', '2026-08-01', '2026-10-01']:
    d = json.load(open(f'{D}/coupling-{w}.json')); coupling[w] = {k: d[k] for k in ['since', 'until', 'prs', 'pairs', 'hidden', 'hiddenBothLib', 'hiddenCrossArea']}
    coupling[w]['top'] = [{'a': p['a'], 'b': p['b'], 'co': p['co']} for p in d['list'] if not p.get('linked')][:12]
known = {
    'how': 'git grep -l -E <pattern> <sha> -- server.js lib routes public | wc -l (production files; .min. excluded)',
    'decisions': {
        'terminal states literal': r"\['completed', ?'canceled', ?'duplicate'\]",
        'model JSON reply fence parse': r"fence = text\.match\(/```",
        'tolerant timestamp parse': r"function (toMillis|toMs|_epoch)\(",
        'duration formatting': r"function format(Duration|Elapsed)\(",
        'bookkeeping stamp classifier': r"decision-withdrawal-reversed",
        'session classification': r"isStandaloneSession|isTerminalLoop",
        'ship layout primitives': r"orderByDependency|computeProximityRings",
        'segment rank': r"SEGMENT_RANK",
        'review ledger heading': r"What CI Did Not Prove",
        'page-shell option bag': r"deployInfo: getDeployInfo\(\)",
        'store clear(urlKey) boilerplate': r"async clear\(urlKey\)",
    },
    'sites': {
        'month': ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
        'terminal states literal': [4, 4, 4, 4, 5, 5],
        'model JSON reply fence parse': [1, 4, 5, 7, 7, 8],
        'tolerant timestamp parse': [1, 2, 8, 13, 13, 18],
        'duration formatting': [0, 0, 1, 2, 3, 4],
        'bookkeeping stamp classifier': [0, 0, 0, 0, 7, 8],
        'session classification': [0, 1, 3, 3, 5, 6],
        'ship layout primitives': [4, 4, 4, 4, 4, 4],
        'segment rank': [2, 2, 2, 2, 2, 2],
        'review ledger heading': [0, 4, 5, 5, 5, 6],
        'page-shell option bag': [1, 5, 9, 12, 12, 14],
        'store clear(urlKey) boilerplate': [7, 11, 13, 15, 16, 19],
        'production files': [94, 171, 231, 291, 347, 398],
    },
}
drift_review = {
    'source': 'docs/reviews/drift-coherence-review-2026-*.md (five persisted editions; the 2026-07-12 edition was never persisted)',
    'rows': {
        'provider-resolution incantation sites': {'2026-06-10': 5, '2026-06-25': 4, '2026-08-29': 16, '2026-09-26': 17},
        'inline error-envelope sites (metric widened at 08-29; 06-10 counted all res.status(4xx))': {'2026-06-10': 239, '2026-06-25': 53, '2026-08-29': 76, '2026-09-26': 87},
        'lib/errors.js importers': {'2026-06-10': 1, '2026-06-25': 5, '2026-08-29': 14, '2026-09-26': 26},
        'native confirm() sites against a registry of 4': {'2026-08-29': 6, '2026-09-26': 9},
        'provider-seam import SCC members': {'2026-08-29': 13, '2026-09-26': 15},
    },
    'fix tickets minted by the review and their state on 2026-10-08': {'LIN-675': 'Backlog (minted 2026-06-25)', 'LIN-2388': 'Backlog (minted 2026-08-29)', 'LIN-2389': 'Backlog (minted 2026-08-29)'},
}
consolidations = {
    'how': 'git grep -l <pattern> <sha> -- routes lib | wc -l, at the commit before the consolidation (^), at it, and at d61903f3',
    'rows': [
        {'ticket': 'LIN-1157', 'commit': 'c7454341', 'date': '2026-07-09', 'what': 'one function mints the bootstrap token and appends the proxy preamble', 'pattern': 'mintHandoffBootstrap / inline createToken+append in routes/proxy.js and routes/workspace-api.js', 'oldSitesBefore': 6, 'oldSitesAt': 0, 'oldSitesHead': 0, 'note': 'both route files changed in the same PR'},
        {'ticket': 'LIN-1084', 'commit': '0c4eb0a4', 'date': '2026-07-06', 'what': 'one validator for opaque dispatch fields (model, harness, terminal)', 'pattern': 'const MAX_NAME_LENGTH', 'oldSitesBefore': 3, 'oldSitesAt': 4, 'oldSitesHead': 5, 'note': 'validateOpaqueDispatchField is imported by 8 files at HEAD; the length bound is still declared locally in 5'},
        {'ticket': 'LIN-2631', 'commit': '64433a6d', 'date': '2026-09-05', 'what': 'one SSE frame writer (lib/sse.js)', 'pattern': 'res.write(`event: ', 'oldSitesBefore': 4, 'oldSitesAt': 3, 'oldSitesHead': 2, 'note': 'routes/workspace-api-roadmap.js:52 and routes/workspace-api.js:1075 still inline at HEAD'},
        {'ticket': 'LIN-2970/LIN-2978', 'commit': 'ede3a6d4 / d3d89f36', 'date': '2026-09-21', 'what': 'one chat-request preamble (credential chain, free-tier gate)', 'pattern': "import of lib/chat-request.js against inline resolveChatCredential( in routes", 'importersHead': 13, 'inlineHead': 8, 'note': 'the helper is adopted; the surrounding scaffold is still copied in 8 route files'},
        {'ticket': 'LIN-3300', 'commit': '19d7198a', 'date': '2026-10-04', 'what': 'delete the model-written meta-prompt path', 'sizes': {'lib/prompt-template-defs.js': {'2026-09-30': 131754, '2026-10-07': 109927}, 'lib/prompts/meta-prompt-template.js': {'2026-09-30': 106011, '2026-10-07': 'absent'}, 'lib/stage-router.js': {'2026-09-30': 'absent', '2026-10-07': 8115}}, 'coChange': 'of 63 PRs touching prompt-template-defs.js from June to 7 October, 53 also touched meta-prompt-template.js'},
    ],
}
out = {'about': 'Companion census for docs/papers/harbour/coherence-as-it-grows.md. Production code = server.js, lib/, routes/, non-vendored public/ (steady-base-code.mjs definition). jscpd@4.0.5, --min-tokens 50 --min-lines 5 --format javascript; the jscpd30 field is the same at --min-tokens 30.', 'snapshots': series, 'mirroredChanges': {'k': mirrored['k'], 'byMonth': dict(sorted(bym.items())), 'prsWithMirroredAdds': len(mirrored['mirrored'])}, 'coupling': coupling, 'knownDecisions': known, 'driftCoherenceReview': drift_review, 'consolidations': consolidations, 'twins': codes['twins'], 'headClasses': {k: v for k, v in collections.Counter(h['class'] for h in codes['hits']).items()}}
json.dump(out, open(D + '/coherence-census.json', 'w'), indent=1)
for r in series: print(r['month'], r['prodLines'], r['jscpd50']['percentage'], r['jscpd50']['crossFilePairs'], r['admissions']['T'], r['admissions']['S'], r['syncTests'], r['twinsPer10kLines'], r['crossFilePairsPer10kLines'], r.get('jscpd30', {}).get('percentage'))
