# LIN-3551: build hand-reading excerpts for candidate in-session catches.
# Input: local-failures.json from LinearViewer/scripts/survey-tests-local.mjs. Candidates = LinearViewer episodes classed 'prod fix'
# on unit tests (not tests/e2e|visual), grouped by (session stream, first failing run). Output: excerpts/<id>.txt + candidates.json
# Usage: python3 -I excerpts.py <local-failures.json> <outdir>
import json, glob, os, sys, re
from datetime import datetime

src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(outdir, 'excerpts'), exist_ok=True)
d = json.load(open(src))
E = [e for e in d['episodes'] if e['class'] == 'prod fix' and e['repo'] == 'lv' and not (e['file'] and re.search(r'tests/(e2e|visual)', e['file']))]
groups = {}
for e in E: groups.setdefault((e['session'], e['firstFailTs']), []).append(e)

ROOT = os.path.expanduser('~/.claude/projects')
def path_of(label, project):
    s, _, sub = label.partition('/')
    return os.path.join(ROOT, project, s, 'subagents', sub + '.jsonl') if sub else os.path.join(ROOT, project, s + '.jsonl')
def txt(c):
    if isinstance(c, str): return c
    return ''.join(x.get('text', '') for x in (c or []) if isinstance(x, dict) and x.get('type') == 'text')
def clip(s, n, tail=False):
    s = s or ''
    return s if len(s) <= n else (('…' + s[-n:]) if tail else (s[:n] + '…'))
def P(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))

cands = []
for i, ((label, t0), eps) in enumerate(sorted(groups.items(), key=lambda kv: kv[0][1])):
    cid = f'c{i:03d}'
    p = path_of(label, eps[0]['project'])
    tests = sorted({(e['file'] or '?', e['name']) for e in eps})
    tclose = max((e['closeTs'] for e in eps if e['closeTs']), default=None)
    edited = sorted({f['path'] for e in eps for f in e['editedFiles']})
    cands.append({'id': cid, 'session': label, 'transcript': p, 'firstFailTs': t0, 'closeTs': tclose, 'tests': [{'file': f, 'name': n} for f, n in tests], 'editedFiles': edited})
    recs = []
    for line in open(p):
        try: e = json.loads(line)
        except Exception: continue
        if e.get('isSidechain') and '/' not in label: continue
        m = e.get('message') or {}
        if isinstance(m.get('content'), list) and e.get('timestamp'): recs.append(e)
    t0d = P(t0); tcd = P(tclose) if tclose else t0d
    # find index of the failing run's tool_result (timestamp == firstFailTs per survey: run ts is the tool_use ts)
    out = [f'# {cid}  session={label}\n# transcript={p}\n# first failing run {t0}  closing green run {tclose}\n# failing tests (survey parse):']
    for f, n in tests[:25]: out.append(f'#   {f} :: {n}')
    out.append(f'# files edited between red and green (survey): {edited}\n')
    issue = None
    for e in recs[:5]:
        if e['type'] == 'user':
            mm = re.search(r'#\s*(LIN-\d+)\s*·\s*([\w-]+)', txt(e['message']['content']) or '')
            if mm: issue = mm.group(0); break
    out.append(f'# dispatch: {issue}\n')
    before, during = [], []
    tool_names = {}
    for e in recs:
        ts = P(e['timestamp'])
        bucket = before if ts < t0d else during if ts <= tcd else None
        if bucket is None: break
        for b in e['message']['content']:
            ty = b.get('type')
            if e['type'] == 'assistant' and ty == 'text' and b.get('text', '').strip():
                bucket.append(('TEXT', e['timestamp'], clip(b['text'].strip(), 700)))
            elif e['type'] == 'assistant' and ty == 'tool_use':
                inp = b.get('input') or {}; tool_names[b['id']] = b['name']
                if b['name'] == 'Bash': bucket.append(('BASH', e['timestamp'], clip(inp.get('command', ''), 600)))
                elif b['name'] in ('Edit', 'MultiEdit'):
                    edits = [inp] if b['name'] == 'Edit' else inp.get('edits', [])
                    body = '\n'.join(f"--- old:\n{clip(x.get('old_string',''), 900)}\n+++ new:\n{clip(x.get('new_string',''), 900)}" for x in edits[:4])
                    bucket.append(('EDIT', e['timestamp'], inp.get('file_path', '') + '\n' + body))
                elif b['name'] == 'Write': bucket.append(('WRITE', e['timestamp'], inp.get('file_path', '') + f"  ({len((inp.get('content') or '').splitlines())} lines)\n" + clip(inp.get('content', ''), 500)))
                elif b['name'] in ('Read', 'Grep', 'Glob'): bucket.append(('TOOL', e['timestamp'], b['name'] + ' ' + str(inp.get('file_path') or inp.get('pattern') or '')[:200] + ' ' + str(inp.get('path') or '')[:150]))
                else: bucket.append(('TOOL', e['timestamp'], b['name'] + ' ' + clip(json.dumps(inp), 200)))
            elif e['type'] == 'user' and ty == 'tool_result':
                name = tool_names.get(b.get('tool_use_id'))
                if name == 'Bash': bucket.append(('RESULT', e['timestamp'], clip(txt(b.get('content')), 1800 if bucket is during else 400, tail=True)))
                elif name in ('Edit', 'Write', 'MultiEdit') and b.get('is_error'): bucket.append(('RESULT', e['timestamp'], clip(txt(b.get('content')), 200)))
    # context: test-file edits earlier in the session + last ~25 events before the red
    tfiles = {f for f, _ in tests if f != '?'}
    prior_test_edits = [x for x in before if x[0] in ('EDIT', 'WRITE') and any(t in x[2].split('\n')[0] for t in tfiles)]
    out.append(f'## earlier edits/writes in this session to the failing test file(s): {len(prior_test_edits)}')
    for x in prior_test_edits[-3:]: out.append(f'[{x[0]} {x[1]}] {clip(x[2], 600)}')
    out.append('\n## CONTEXT: last events before the failing run')
    for x in before[-22:]: out.append(f'[{x[0]} {x[1]}] {x[2]}')
    out.append('\n## FROM FAILING RUN TO CLOSING GREEN RUN')
    for x in during[:80]: out.append(f'[{x[0]} {x[1]}] {x[2]}')
    if len(during) > 80: out.append(f'... {len(during) - 80} more events truncated')
    open(os.path.join(outdir, 'excerpts', cid + '.txt'), 'w').write('\n'.join(out))
json.dump(cands, open(os.path.join(outdir, 'candidates.json'), 'w'), indent=1)
print(len(cands), 'candidates from', len(E), 'episodes in', len({c['session'].split('/')[0] for c in cands}), 'sessions')
