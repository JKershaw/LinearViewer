# theseus: how ready the Providers block is to be rebuilt against a written spec.
# Usage: python3 providers.py <repoDir> <workDir> <out.json>
# Runs every unit test file that touches Providers once, under V8 coverage and with
# shape-recorder.mjs preloaded, then measures: which provider/method pairs are implemented and
# exercised, what each returns, how tests reach the block, where code outside the block checks
# a provider's name, which helpers smooth over return-shape differences, and the comment share.
import glob, json, os, re, shutil, subprocess, sys
from collections import Counter, defaultdict

repo, work, out_path = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
rel = lambda p: os.path.relpath(p, repo)

caps = json.loads(subprocess.run(['node', os.path.join(here, 'provider-capabilities.mjs'), repo],
                                 capture_output=True, text=True, check=True).stdout)
impl = caps['implemented']
provs = list(impl)

tests = sorted(f for f in glob.glob(os.path.join(repo, 'tests/unit/*.js'))
               if re.search(r'lib/providers/|getProvider|providers/index', open(f).read()))
cov_dir, shape_dir = os.path.join(work, 'cov'), os.path.join(work, 'shapes')
for d in (cov_dir, shape_dir):
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
env = dict(os.environ, NODE_V8_COVERAGE=cov_dir, SHAPE_OUT=shape_dir, REPO=repo)
run = subprocess.run(['node', '--import', os.path.join(here, 'shape-recorder.mjs'), '--test',
                      '--test-concurrency=4', *tests], cwd=repo, env=env, capture_output=True, text=True)
summary = {k: int(v) for k, v in re.findall(r'^# (tests|pass|fail) (\d+)$', run.stdout, re.M)}

# 1. Exercised pairs: a method counts when its function in the provider's index.js ran.
#    V8 names class methods by bare name, so a module-level function of the same name in that
#    file is indistinguishable from the method.
hits = defaultdict(int)
for f in glob.glob(os.path.join(cov_dir, '*.json')):
    for r in json.load(open(f))['result']:
        m = re.search(r'/lib/providers/([^/]+)/index\.js$', r['url'])
        if not m or m.group(1) not in impl:
            continue
        ran = {fn['functionName'] for fn in r['functions'] if fn['ranges'][0]['count'] > 0}
        for meth in impl[m.group(1)]:
            if meth in ran:
                hits[(m.group(1), meth)] += 1
pairs = [(p, m) for p in provs for m in impl[p]]
unexercised = [f'{p}.{m}' for p, m in pairs if not hits[(p, m)]]

# 2. Return shapes: the key paths each provider's results carried, per method.
def paths(s, pre=''):
    if isinstance(s, dict):
        return set().union(set(), *(paths(v, f'{pre}.{k}') for k, v in s.items()))
    if isinstance(s, list):
        return {pre + '[]'} if s[1] == 'empty' else paths(s[1], pre + '[]')
    return {pre}
seen = defaultdict(lambda: defaultdict(set))
records = Counter()
for f in glob.glob(os.path.join(shape_dir, '*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        seen[r['m']][r['p']] |= paths(r['s'])
        records[r['p']] += 1
agreement = {}
for m, by in sorted(seen.items()):
    ps = [p for p in provs if by.get(p)]
    if len(ps) < 2:
        continue
    union, common = set().union(*(by[p] for p in ps)), set.intersection(*(by[p] for p in ps))
    agreement[m] = {'providers': ps, 'paths': len(union), 'sharedByAll': len(common),
                    'onlyOne': {p: sorted(by[p] - set().union(set(), *(by[q] for q in ps if q != p))) for p in ps}}
nodes_paths = sorted({x for by in seen.values() for s in by.values() for x in s if '.nodes' in x})
nodes_by_provider = {p: len({x for by in seen.values() for x in by.get(p, set()) if '.nodes' in x}) for p in provs}

# 3. Test reach: what unit tests import from the block.
reach = Counter(); targets = Counter()
for f in glob.glob(os.path.join(repo, 'tests/unit/*.js')):
    for t in re.findall(r"""from\s+['"]\.\./\.\./(lib/providers/[^'"]+)['"]""", open(f).read()):
        kind = ('surface' if re.search(r'/(index|interface|registry)\.js$', t)
                else 'fake' if 'fake' in t else 'internal')
        reach[kind] += 1; targets[t] += 1

# 4. Code outside the block that names a specific provider: comparisons against a provider-name
#    literal, and any use of a SOURCE_* constant (imports and lists included). A dispatch `target`
#    of 'local' names the Harbour OS workstation, not the local provider, so it is left out.
name = r"""['"](linear|github|github-projects|jira|local)['"]"""
check = re.compile(rf"""[!=]==?\s*{name}|{name}\s*[!=]==?|\bSOURCE_(LINEAR|GITHUB|GITHUB_PROJECTS|JIRA|LOCAL)\b""")
outside = Counter()
for f in glob.glob(os.path.join(repo, 'lib/**/*.js'), recursive=True) + glob.glob(os.path.join(repo, 'routes/**/*.js'), recursive=True) + [os.path.join(repo, 'server.js')]:
    if rel(f).startswith('lib/providers/'):
        continue
    for line in open(f):
        if not line.strip().startswith(('//', '*')):
            outside[rel(f)] += len(check.findall(re.sub(r"""\btarget\s*[!=]==?\s*['"]local['"]""", '', line)))
outside = {k: v for k, v in outside.most_common() if v}

# 5. Helpers that smooth over the {success, entity} / bare-entity split in write results.
smoothing = []
for f in glob.glob(os.path.join(repo, 'lib/**/*.js'), recursive=True) + glob.glob(os.path.join(repo, 'routes/**/*.js'), recursive=True):
    if rel(f).startswith('lib/providers/'):
        continue
    for i, line in enumerate(open(f), 1):
        if re.search(r"""'success' in result\) return result""", line):
            smoothing.append(f'{rel(f)}:{i}')

# 6. Comment share of the block.
cre = re.compile(r'/\*[\s\S]*?\*/|^[ \t]*//.*$', re.M)  # block comments, and whole-line // comments
size = comments = 0
for f in glob.glob(os.path.join(repo, 'lib/providers/**/*.js'), recursive=True):
    s = open(f).read(); size += len(s); comments += sum(len(x) for x in cre.findall(s))

out = {
    'testRun': {'files': len(tests), **summary},
    'surfaceMethods': len(caps['surface']),
    'implemented': {p: len(impl[p]) for p in provs},
    'pairs': len(pairs), 'exercised': len(pairs) - len(unexercised), 'unexercised': unexercised,
    'exercisedBy': {f'{p}.{m}': hits[(p, m)] for p, m in pairs},
    'shapeRecords': dict(records), 'shapeAgreement': agreement, 'linearConnectionPaths': len(nodes_paths), 'linearConnectionPathsByProvider': nodes_by_provider,
    'testReach': dict(reach), 'testReachTargets': dict(targets.most_common()),
    'outsideChecks': {'total': sum(outside.values()), 'files': len(outside), 'byFile': outside},
    'smoothingHelpers': smoothing,
    'commentShare': {'bytes': size, 'commentBytes': comments, 'share': round(comments / size, 3)},
}
json.dump(out, open(out_path, 'w'), indent=1)
print(json.dumps({k: out[k] for k in ('testRun', 'surfaceMethods', 'implemented', 'pairs', 'exercised', 'unexercised',
                                      'shapeRecords', 'linearConnectionPaths', 'testReach', 'smoothingHelpers', 'commentShare')}, indent=0))
print('outside', out['outsideChecks']['total'], 'in', out['outsideChecks']['files'], list(outside.items())[:6])
for m in ('createComment', 'fetchIssueContext', 'fetchProjects'):
    a = agreement.get(m, {}); print(m, a.get('providers'), a.get('sharedByAll'), '/', a.get('paths'))
