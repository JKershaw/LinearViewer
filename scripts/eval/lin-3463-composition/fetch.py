import json, os, sys, time, urllib.request, urllib.error
B = os.environ['HARBOUR_LOCAL_BASE'].rstrip('/') + '/api/proxy'
OUT = sys.argv[1]; lo, hi = int(sys.argv[2]), int(sys.argv[3])
last = [0.0]
def get(path):
    for attempt in range(6):
        wait = 1.12 - (time.time() - last[0])
        if wait > 0: time.sleep(wait)
        last[0] = time.time()
        try:
            with urllib.request.urlopen(B + path, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(30); continue
            if e.code == 404: return {'_error': 404}
            body = e.read()[:300].decode('utf8', 'replace')
            if e.code >= 500: time.sleep(5); continue
            return {'_error': e.code, '_body': body}
        except Exception as e:
            time.sleep(5)
    return {'_error': 'gave-up'}
for n in range(hi, lo - 1, -1):
    f = f'{OUT}/LIN-{n}.json'
    if os.path.exists(f): continue
    rec = {'issue': get(f'/issues/LIN-{n}')}
    if '_error' not in rec['issue']:
        rec['cost'] = get(f'/cost/LIN-{n}')
        if rec['cost'].get('workerSessions'):
            rec['snapshots'] = get(f'/issues/LIN-{n}/snapshots')
            rec['dispatch'] = get(f'/dispatch?issueIdentifier=LIN-{n}&limit=250')
    json.dump(rec, open(f, 'w'))
    print(n, 'ok' if '_error' not in rec['issue'] else rec['issue']['_error'], flush=True)
