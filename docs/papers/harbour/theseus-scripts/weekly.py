# theseus: the shape of the code once a week, from the first Monday of 2026 to the ref.
# Usage: python3 weekly.py <repoDir> <ref> <out.json>
# Per week: the last first-parent commit on or before that Monday, its Seams & Tangles
# measurement, product bytes per area (.js/.mjs/.css/.html outside scripts/ and docs/) and the
# bytes of test code (.js/.mjs under tests/; fixtures and snapshots left out).
import datetime as dt, json, os, re, subprocess, sys

repo, ref, out_path = sys.argv[1:4]
seams = os.path.join(repo, 'scripts/code-shape/seams.mjs')
guide_path = os.path.join(repo, 'scripts/code-shape/areas.json')
areas = [(a['name'], [re.compile(m) for m in a['match']]) for a in json.load(open(guide_path))['areas']]
area = lambda p: next((n for n, rx in areas if any(r.search(p) for r in rx)), None)
git = lambda *a: subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True).stdout
log = [l.split() for l in git('log', ref, '--first-parent', '--format=%H %cs').split('\n') if l]
picks, d = [], dt.date(2026, 1, 5)
end = dt.date.fromisoformat(log[0][1])
while d <= end:
    c = next((h for h, day in log if day <= d.isoformat()), None)
    if c and (not picks or picks[-1][1] != c):
        picks.append((d.isoformat(), c))
    d += dt.timedelta(days=7)
if picks[-1][1] != log[0][0]:
    picks.append((log[0][1], log[0][0]))
out = []
for day, c in picks:
    j = json.loads(subprocess.run(['node', seams, repo, c, guide_path], capture_output=True, text=True).stdout)
    product, tests = {}, 0
    for line in git('ls-tree', '-r', '-l', c).split('\n'):
        m = re.match(r'\d+ blob \w+\s+(\d+)\t(.+)', line)
        if not m:
            continue
        size, path = int(m.group(1)), m.group(2)
        if path.startswith('tests/'):
            tests += size if re.search(r'\.m?js$', path) else 0
        elif re.search(r'\.(js|mjs|css|html)$', path) and not path.startswith(('scripts/', 'docs/', 'prototypes/')):
            a = area(path)
            if a:
                product[a] = product.get(a, 0) + size
    out.append({'week': day, 'commit': c[:8], 'files': j['scope']['files'],
                'crossAreaImports': sum(l['imports'] for l in j['links']),
                'tangles': len(j['knots']['pairs']),
                'areas': {a['name']: {'files': a['files'], 'productBytes': product.get(a['name'], 0)} for a in j['areas']},
                'productBytes': sum(product.values()), 'testCodeBytes': tests})
    print(day, c[:8], out[-1]['files'], out[-1]['crossAreaImports'], out[-1]['tangles'],
          out[-1]['productBytes'], out[-1]['testCodeBytes'], flush=True)
json.dump(out, open(out_path, 'w'), indent=1)
