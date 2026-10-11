# Index every dispatched-session transcript: header, start, ordered proxy reads, brief/issue payloads returned.
import json, os, re, sys, glob
P = os.path.expanduser('~/.claude/projects')
OUT = sys.argv[1]
HDR = re.compile(r'^#\s+([A-Z]+-\d+)\s+·\s+([\w-]+)')
def classify(cmd):
    out = []
    if 'curl' not in cmd and 'fetch(' not in cmd and 'urlopen' not in cmd and 'requests.' not in cmd: return out
    for m in re.finditer(r'(?:api/proxy|\}|\$[A-Z_]+|B)/((?:issues|brief|recap|dispatch|cost|search|stack|rulings|relations)[^\s"\'\\|>)]*)', cmd):
        p = m.group(1)
        if re.match(r'(issues/[A-Z]+-\d+/)?brief', p) or p.startswith('brief/'): out.append(('brief', p))
        elif re.match(r'issues/[A-Z]+-\d+/recap', p) or p.startswith('recap/'): out.append(('recap', p))
        elif re.match(r'issues/[A-Za-z0-9-]+/(snapshots|cost|relations|comments|description|labels)', p): out.append(('issue-sub', p))
        elif re.match(r'issues/[A-Z]+-\d+$', p) or re.match(r'issues/[A-Z]+-\d+\?', p): out.append(('issue', p))
        elif re.match(r'dispatch/[0-9a-f-]+/prompt', p): out.append(('prompt', p))
        else: out.append(('other', p))
    return out
rows = []
for d in glob.glob(P + '/-Users-work-development-simple-dispatcher-workspaces-*'):
    for f in glob.glob(d + '/*.jsonl'):
        try: lines = [json.loads(l) for l in open(f)]
        except Exception: continue
        hdr = None; start = None; reads = []; pending = {}; results = []
        method = 'POST'
        for e in lines:
            m = e.get('message')
            if not isinstance(m, dict): continue
            ts = e.get('timestamp')
            c = m.get('content')
            if e.get('type') == 'user' and hdr is None:
                txt = c if isinstance(c, str) else ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text') if isinstance(c, list) else ''
                mm = HDR.match(txt.strip()) if txt else None
                if mm: hdr = mm.groups(); start = ts
            if not isinstance(c, list): continue
            for b in c:
                if not isinstance(b, dict): continue
                if b.get('type') == 'tool_use':
                    cmd = (b.get('input') or {}).get('command') or ''
                    if b.get('name','').startswith('mcp__harbour'):
                        pending[b['id']] = (ts, [('mcp', b.get('name'))], False)
                    elif re.search(r'/(issues|brief|recap|dispatch)/', cmd):
                        cl = classify(cmd)
                        is_write = bool(re.search(r'-X\s*(POST|PATCH|DELETE)|X-Harbour-Intent', cmd))
                        pending[b['id']] = (ts, cl, is_write)
                elif b.get('type') == 'tool_result' and b.get('tool_use_id') in pending:
                    ts0, cl, w = pending.pop(b['tool_use_id'])
                    rc = b.get('content')
                    if isinstance(rc, list): rc = '\n'.join(x.get('text', '') for x in rc if isinstance(x, dict))
                    reads.append({'ts': ts0, 'calls': cl, 'write': w, 'len': len(rc or ''),
                                  'body': (rc or '')[:60000] if any(k in ('brief', 'issue', 'recap', 'prompt') for k, _ in cl) and not w else None})
        if hdr:
            rows.append({'file': f, 'ticket': hdr[0], 'kind': hdr[1], 'start': start, 'n_entries': len(lines), 'reads': reads})
json.dump(rows, open(OUT, 'w'))
print(len(rows))
