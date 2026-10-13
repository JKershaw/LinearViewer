# LIN-3551: merge hand judgments (catches/judged-*.json) into catches.json. Usage: python3 -I merge-catches.py <sessions-dir>
import json, glob, os, sys, collections
D = sys.argv[1]
cands = {c['id']: c for c in json.load(open(os.path.join(D, 'catches', 'candidates.json')))}
J = []
for f in sorted(glob.glob(os.path.join(D, 'catches', 'judged-*.json'))): J += json.load(open(f))
J.sort(key=lambda x: x['id'])
missing = sorted(set(cands) - {x['id'] for x in J})
real = [x for x in J if x['verdict'] == 'real_catch']
files = collections.Counter(t['file'] for x in real for t in {t['file']: t for t in x['failingTests']}.values())
out = {
    'method': 'Candidates: LinearViewer/scripts/survey-tests-local.mjs (census of local transcripts) episodes classed "prod fix" on LinearViewer unit tests '
              '(not tests/e2e|visual), grouped by (session stream, first failing run) -> one candidate per red run. Every candidate hand-read from an excerpt '
              '(scripts/excerpts.py) plus the transcript where needed; real_catch = a test that existed before the session failed on a genuine production fault the '
              'agent introduced or missed, and a production edit fixed it.',
    'window': 'session starts 2026-07-30 (one stray) / effectively 2026-09-02 .. 2026-10-13',
    'candidatesTotal': len(cands), 'judged': len(J), 'missing': missing,
    'verdicts': collections.Counter(x['verdict'] for x in J), 'notCatchReasons': collections.Counter(x['reason'] for x in J if x['verdict'] != 'real_catch'),
    'realCatchSessions': len({x['session'].split('/')[0] for x in real}),
    'realCatchTestFiles': dict(files.most_common()),
    'realCatches': [{k: x.get(k) for k in ('id', 'session', 'transcript', 'timestamp', 'failingTests', 'productionFilesEdited', 'fault', 'confidence')} for x in real],
    'allJudgments': J,
}
# Same fault judged twice: c037 is the same red run as c036 (github-projects block of the same golden file); c064 is the re-run 48 s after c063.
DUP = {'c037': 'c036', 'c064': 'c063'}
KIND = {'c000': 'module-load (wrong import path) - any test importing the route would fail', 'c032': 'syntax error - any test importing the module would fail',
        'c108': 'syntax error - any test importing the module would fail', 'c117': 'type slip after refactor (Date vs number) - several suites failed',
        'c018': 'behavioural', 'c024': 'behavioural (result-budget overflow)', 'c036': 'behavioural (golden byte-parity of rendered HTML)',
        'c054': 'prompt-content pin (text rule)', 'c063': 'architectural census (raw credential read); no behaviour change'}
for x in out['realCatches']: x['duplicateOf'] = DUP.get(x['id']); x['kind'] = KIND.get(DUP.get(x['id'], x['id']))
distinct = [x for x in out['realCatches'] if not x['duplicateOf']]
out['distinctFaults'] = len(distinct)
out['distinctFaultTestFiles'] = dict(collections.Counter(f for x in distinct for f in sorted({t['file'] for t in x['failingTests']})).most_common())
json.dump(out, open(os.path.join(D, 'catches.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: out[k] for k in ('candidatesTotal', 'judged', 'missing', 'verdicts', 'notCatchReasons', 'realCatchSessions')}, indent=1))
for x in real: print(x['id'], x['timestamp'][:10], [t['file'].replace('tests/unit/', '') for t in x['failingTests']], x['productionFilesEdited'], '|', x['fault'][:150])
