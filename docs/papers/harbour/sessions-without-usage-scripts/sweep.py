# Usage: python3 -I sweep.py <out.jsonl> <issue-numbers.txt>   (needs HARBOUR_LOCAL_BASE)
#
# Reads GET /cost/{id} through the workspace proxy for each issue in the list, paced under the
# proxy's 60/min limit. Read-only: no model or paid calls. Resumable: issues already in
# <out.jsonl> are skipped. Stage 1 of the paper's method (needs the proxy).
import json, os, sys, time, urllib.request, urllib.error
B = os.environ['HARBOUR_LOCAL_BASE'] + '/api/proxy'
out = sys.argv[1]; nums = sorted((int(x) for x in open(sys.argv[2]).read().split()), reverse=True)
done = {}
if os.path.exists(out):
    for line in open(out):
        r = json.loads(line); done[r['identifier']] = 1
f = open(out, 'a')
def get(path):
    for attempt in range(8):
        try:
            with urllib.request.urlopen(B + path, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429: print('429', flush=True); time.sleep(12); continue
            return {'error': e.code}
        except Exception as e:
            time.sleep(5)
    return {'error': 'gave-up'}
for n in nums:
    ident = f'LIN-{n}'
    if ident in done: continue
    d = get(f'/cost/{ident}')
    d['identifier'] = ident
    f.write(json.dumps(d) + '\n'); f.flush()
    time.sleep(1.1)
