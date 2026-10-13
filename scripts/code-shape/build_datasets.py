"""Build the three dashboard datasets from the measured snapshots and the Drift ledger."""
import json, os

T = os.path.dirname(os.path.abspath(__file__))
snaps = json.load(open(f'{T}/snaps.json'))
runs = {}
for f in os.listdir(f'{T}/runs'):
    d = json.load(open(f'{T}/runs/{f}'))
    runs[(d['kind'], d['sha'])] = d

REPO = {'lv': 'Harbour', 'sd': 'Simple Dispatcher'}

# 1. snapshots: one row per snapshot per repo
snap_rows, giant_rows = [], []
for s in snaps:
    for k in ('lv', 'sd'):
        d = runs[(k, s[k])]
        at = s['lvDate'] if k == 'lv' else s['sdDate']
        snap_rows.append({
            'snapshot': s['label'], 'kind': s['kind'], 'repo': REPO[k], 'commit': s[k][:9],
            'committedAt': at, 'productionLines': d['totalLines'], 'files': d['files'],
            'giantFunctions': d['fn200'], 'over400': d['fn400'], 'linesInGiants': d['linesIn200'],
            'copiedLines': d['dupLines'], 'countedLines': d['normLines'],
            'copiedShare': round(d['dupLines'] / d['normLines'], 4), 'copyPairs': d['dupPairs'],
        })
        for fn in d['functions']:
            if fn['lines'] >= 200 and not fn['container']:
                giant_rows.append({
                    'snapshot': s['label'], 'repo': REPO[k], 'file': fn['file'], 'function': fn['name'],
                    'key': f"{REPO[k]}:{fn['file']}::{fn['name']}", 'lines': fn['lines'], 'startLine': fn['start'],
                })

# 2. ledger: my reading of each Drift & Coherence ledger cell, with the review's own words kept verbatim.
raw = {r['row']: r for r in json.load(open(f'{T}/ledger-raw.json'))}
EDS = [('06-25', '2026-06-25', 'Jun 25'), ('07-12', '2026-07-12', 'Jul 12'), ('08-29', '2026-08-29', 'Aug 29'),
       ('09-26', '2026-09-26', 'Sep 26'), ('10-11', '2026-10-11', 'Oct 11'),
       ('10-11 post', '2026-10-11', 'Oct 11, after batches 1–2'), ('10-12', '2026-10-12', 'Oct 12, after batch 3')]
O = 'one'
# per decision: unit, then per edition: None (use default rule) | 'one' | int | 'many' (several, not counted)
CUR = {
    'lib-import-cycles': ('import cycles', {'06-25': O, '08-29': 3, '09-26': 4, '10-11': 4, '10-11 post': O, '10-12': O}),
    'provider-auth-router-upward-imports': ('upward import edges', {'06-25': 2, '08-29': 4, '09-26': 4, '10-11': 5, '10-11 post': O, '10-12': O}),
    'routes-error-envelope-fragmentation': ('hand-written error replies', {'06-25': 53, '08-29': 68, '09-26': 87, '10-11': 93, '10-11 post': 16, '10-12': 17}),
    'production-to-test-fixture-imports': ('production imports of test files', {'08-29': 7, '09-26': 7, '10-11': 7, '10-11 post': 7, '10-12': O}),
    'periodical-report-filename-convention-split': ('naming conventions', {'08-29': 'many', '09-26': 'many', '10-11': 'many', '10-11 post': 'many', '10-12': 'many'}),
    'dispatch-kind-vocabulary-cross-repo': ('hard-coded kind lists', {'08-29': 3, '09-26': 3, '10-11': O, '10-11 post': O, '10-12': O}),
    'provider-resolution-incantation': ('hand-rolled workspace lookups', {'06-25': 4, '08-29': 16, '09-26': 17, '10-11': 18, '10-11 post': 5, '10-12': 3}),
    'ui-divergences-registry-staleness': ('native confirm() dialogs', {'08-29': 6, '09-26': 9, '10-11': 10, '10-11 post': 10, '10-12': 10}),
    'simple-dispatcher-api-base-duplication': ('API base definitions', {'08-29': 2, '09-26': 2, '10-11': 2, '10-11 post': 2, '10-12': 2}),
    'cross-repo-halt-vocabulary': ('runner implementations that disagree', {'09-26': 2, '10-11': 2, '10-11 post': 2, '10-12': 2}),
    'cross-repo-sentinel-decision-marker-vocabulary': ('marker vocabularies', {'09-26': 'many', '10-11': 3, '10-11 post': 3, '10-12': 'many'}),
    'target-vocabulary': ('target lists', {'09-26': 3, '10-11': 3, '10-11 post': 7, '10-12': 3}),
    'sse-frame-writer-duplication': ('copies of the SSE writer', {'09-26': 2, '10-11': 2, '10-11 post': 2, '10-12': O}),
    'routes-proxy-decomposition': ('proxy router split', {'09-26': O, '10-11': O, '10-11 post': O, '10-12': O}),
    'cross-repo-repo-list': ('repo lists', {'08-29': 'many', '09-26': 'many', '10-11': 'many', '10-11 post': 'many', '10-12': 'many'}),
    'client-escape-html-duplication': ('definitions', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'client-shared-helper-duplication': ('definitions', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'client-section-fetch-idiom-duplication': ('fetch idioms', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'linear-cli-parallel-graphql-surface': ('GraphQL surfaces', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'store-module-uniformity': ('store shapes', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'server-side-escaping': ('escaping helpers', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'dispatch-payload-centralization': ('payload builders', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'renderer-provider-abstraction': ('renderer seams', {e: O for e in ('06-25', '08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'cache-module-family': ('cache modules', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'lib-components-primitive-adoption': ('primitive sets', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'state-store-write-seam': ('write seams', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'phase-vocabulary-centralization': ('phase vocabularies', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'target-harness-axis-orthogonality': ('axes', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'test-seam-separation': ('test seams', {e: O for e in ('08-29', '09-26', '10-11', '10-11 post', '10-12')}),
    'runner-contract-semantics-cross-repo': ('runner implementations', {'10-11': 2, '10-11 post': 2, '10-12': 2}),
    'connection-binding-predicate-drift': ('copies of the binding predicate', {'10-11': 5, '10-11 post': 2, '10-12': 2}),
    'run-page-identity-scrape': ('places the run page reads its task', {'10-11': 'many', '10-11 post': 'many', '10-12': 'many'}),
    'dispatch-entrance-field-duplication': ('places dispatch fields are re-serialised', {'10-11': 6, '10-11 post': 5, '10-12': 'many'}),
    'owner-word-collision': ('collisions', {'10-11': 4, '10-11 post': 4, '10-12': 4}),
    'run-family-render-primitives': ('hand-built fragment modules', {'10-11': 2, '10-11 post': 2, '10-12': 2}),
    'persist-binding-sibling-seams': ('persist seams', {'10-11': 7, '10-11 post': 7, '10-12': 7}),
    'server-formatter-duplication': ('copies per formatter', {'10-11': 'many', '10-11 post': 3, '10-12': 3}),
    'wake-marker-regex-copies': ('copies of the wake regex', {'10-11': 3, '10-11 post': 3, '10-12': O}),
    'runner-liveness-assumption': ('liveness assumptions', {'10-11': 'many', '10-11 post': 'many', '10-12': 'many'}),
    'workspace-urlkey-consolidation': ('derivations', {'10-11': O, '10-11 post': O, '10-12': O}),
    'credential-decision-multiplicity': ('credential copies', {'10-11 post': 6, '10-12': 6}),
    'keepalive-error-envelope-writer': ('hand-built keepalive error bodies', {'10-11 post': 74, '10-12': O}),
    'html-error-page-two-writers': ('error page writers', {'10-11 post': 2, '10-12': O}),
    'ai-availability-gate-duplication': ('AI-availability gates outside the shared one', {'10-11 post': 13, '10-12': 6}),
    'dispatch-refusal-relay-duplication': ('refusal relays', {'10-11 post': 2, '10-12': O}),
    'tolerant-date-parse-date-twins': ('private date parsers', {'10-11 post': 3, '10-12': O}),
    'timestamp-parse-consolidation': ('timestamp parsers', {'10-11 post': O, '10-12': O}),
    'loose-json-consolidation': ('loose-JSON parsers', {'10-11 post': O, '10-12': O}),
    'ai-mock-predicate-consolidation': ('AI-mock checks', {'10-11 post': O, '10-12': O}),
    'decision-dialect-split': ('decision dialects', {'10-12': 2}),
    'human-wait-derivation-split': ('places outside the shared waiting markers', {'10-12': 8}),
    'decision-stamp-classifier-copies': ('copies of the stamp classifier', {'10-12': 5}),
    'provider-write-field-contract': ('places that disagree', {'10-12': 2}),
    'close-out-merged-refusal-split': ('places that decide "already merged"', {'10-12': 'many'}),
    'periodic-loop-two-mechanisms': ('scheduling mechanisms', {'10-12': 2}),
}
# Which ticket combined a decision, from the ledger text and the coherence loop's own record (LIN-3449's children).
COMBINED_BY = {
    'lib-import-cycles': ('LIN-2388', True), 'provider-auth-router-upward-imports': ('LIN-675', True),
    'production-to-test-fixture-imports': ('LIN-3472', True), 'sse-frame-writer-duplication': ('LIN-2663', True),
    'wake-marker-regex-copies': ('LIN-3468', True), 'keepalive-error-envelope-writer': ('LIN-3465', True),
    'html-error-page-two-writers': ('LIN-3466', True), 'dispatch-refusal-relay-duplication': ('LIN-3470', True),
    'tolerant-date-parse-date-twins': ('LIN-3473', True), 'timestamp-parse-consolidation': ('LIN-3453', True),
    'loose-json-consolidation': ('LIN-3114', True), 'ai-mock-predicate-consolidation': ('LIN-3459', True),
    'dispatch-kind-vocabulary-cross-repo': ('LIN-3199', False), 'workspace-urlkey-consolidation': ('LIN-3382', False),
}
EXCLUDED = {'ci-convention-split-across-repos', 'semicolon-style-split', 'css-token-layer', 'batch-guard-residue'}
assert set(CUR) | EXCLUDED == set(raw), (set(raw) - set(CUR) - EXCLUDED, set(CUR) - set(raw))

ledger_rows = []
for name, (unit, cells) in CUR.items():
    r = raw[name]
    sev = r['severity'].replace('*', '').split(' (')[0].strip()
    for ed, date, label in EDS:
        text = r['cells'][ed]
        v = cells.get(ed)
        if text == 'not recovered':
            state, count = 'lost', None
        elif v is None:
            state, count = 'unrecorded', None
        elif v == O:
            state, count = 'one', 1
        elif v == 'many':
            state, count = 'several', None
        else:
            state, count = 'several', v
        ledger_rows.append({
            'decision': name, 'severity': sev if sev not in ('—', '') else 'none', 'unit': unit,
            'edition': label, 'editionDate': date, 'state': state, 'count': count,
            'reviewSays': text, 'reviewVerdict': r['delta'],
            'combinedBy': COMBINED_BY.get(name, ('', False))[0], 'combinedByLoop': COMBINED_BY.get(name, ('', False))[1],
        })

out = f'{T}/out'
os.makedirs(out, exist_ok=True)
json.dump(snap_rows, open(f'{out}/snapshots.json', 'w'))
json.dump(giant_rows, open(f'{out}/giant-functions.json', 'w'))
json.dump(ledger_rows, open(f'{out}/decision-ledger.json', 'w'))
for f in os.listdir(out):
    print(f, os.path.getsize(f'{out}/{f}'), 'bytes')
print(len(snap_rows), 'snapshot rows;', len(giant_rows), 'giant rows;', len(ledger_rows), 'ledger rows')
