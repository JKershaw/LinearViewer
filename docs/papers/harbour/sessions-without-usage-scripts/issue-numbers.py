# Usage: python3 -I issue-numbers.py <runner-logs-dir> <out.txt>
#
# The issue numbers the cost sweep reads: every "Issue: LIN-n" in the run logs dated
# 24 Sep 2026 or later, plus LIN-3807 to LIN-3944 (the window's own tickets, which the
# research added on a first pass). Gives 694 issues on the runner host, 25 Oct 2026.
import glob, os, re, sys

logs_dir, out_path = sys.argv[1], sys.argv[2]
nums = set(range(3807, 3945))
for p in glob.glob(os.path.join(logs_dir, 'dispatcher.run-*.log')):
    m = re.search(r'(\d{8})', os.path.basename(p))
    if not m or m.group(1) < '20260924':
        continue
    for line in open(p, errors='replace'):
        mm = re.search(r'Issue: LIN-(\d+)', line)
        if mm:
            nums.add(int(mm.group(1)))
with open(out_path, 'w') as f:
    f.write('\n'.join(str(n) for n in sorted(nums, reverse=True)) + '\n')
print(len(nums))
