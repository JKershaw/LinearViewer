# Usage: python3 -I logmap.py <runner-logs-dir> <out.json>
#
# Maps each dispatch item the runner launched to the workspace session it created, with
# the harness, model and effort the launch log records. Reads the run logs only.
# Stage 1 of the paper's method (needs the runner host's logs).
import glob, json, os, re, sys

logs_dir, out_path = sys.argv[1], sys.argv[2]
out = {}
for p in sorted(glob.glob(os.path.join(logs_dir, 'dispatcher.run-*.log'))):
    cur = None
    for line in open(p, errors='replace'):
        m = re.match(r'Found dispatch item: ([0-9a-f-]{36})', line)
        if m:
            cur = {'item': m.group(1), 'log': os.path.basename(p)}
            continue
        if cur is None:
            continue
        m = re.match(r'\s+(Harness|Model|Effort) \(payload\): (\S+)', line)
        if m:
            cur[m.group(1).lower()] = m.group(2)
            continue
        m = re.match(r'Claimed item .*creating session: ([0-9a-f-]{36})', line)
        if m:
            cur['session'] = m.group(1)
            out.setdefault(cur['item'], cur)
            continue
        m = re.search(r'prepareCommand model: (\S+) effort: (\S+)', line)
        if m and 'session' in cur:
            cur['reqModel'], cur['reqEffort'] = m.group(1), m.group(2)
            cur = None
with open(out_path, 'w') as f:
    json.dump(out, f)
print(len(out))
