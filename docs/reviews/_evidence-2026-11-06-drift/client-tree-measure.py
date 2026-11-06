# Run 5 client-test-tree measures, read from git objects at one commit (no checkout).
# Usage (repo root): python3 -I client-tree-measure.py <commit>
# (a) vm-over-public suites: tests/**/*.test.[cm]?js that use vm (require/import of vm, runInContext, runInNewContext)
#     and mention public/. (b) of those, the ones with no loadWorld / client-world reference.
# (c) HAND_WRITTEN_FAKE_DOM_FILES: quoted entries inside the array literal, and the `// stop:` comments in it.
import subprocess, sys, re
sha = sys.argv[1]
def git(*a): return subprocess.run(['git', *a], capture_output=True, text=True).stdout
files = [f for f in git('ls-tree', '-r', '--name-only', sha, '--', 'tests').split('\n')
         if re.search(r'\.test\.[cm]?js$', f)]
vm_pub, not_lw = [], []
for f in files:
    s = git('show', f'{sha}:{f}')
    if not re.search(r"(require\(['\"](node:)?vm['\"]\))|(from ['\"](node:)?vm['\"])|runInContext|runInNewContext", s): continue
    if not re.search(r"public/|public'|\"public\"", s): continue
    vm_pub.append(f)
    if not re.search(r"loadWorld|client-world", s): not_lw.append(f)
census = git('show', f'{sha}:tests/unit/fake-dom-census.test.js')
i = census.index('const HAND_WRITTEN_FAKE_DOM_FILES = [')
block = census[i:census.index('\n];', i)]
entries = re.findall(r"^\s*'([^']+)'", block, re.M)
stops = len(re.findall(r'// stop:', block))
print(f'{sha[:8]} vm-over-public={len(vm_pub)} notOnLoadWorld={len(not_lw)} handWrittenFakeList={len(entries)} stopMarkers={stops}')
if '--list' in sys.argv: print('\n'.join(not_lw))
