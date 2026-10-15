# theseus: run the Seams & Tangles measurement at every first-parent commit.
# Usage: python3 per-commit.py <repoDir> <ref> <out.jsonl>
# Uses scripts/code-shape/seams.mjs and areas.json from the working tree, read against each
# commit's tree. Resumable: commits already in <out.jsonl> are skipped. About 1,941 commits to
# 38fc3b5c; each is one node process.
import json, os, re, subprocess, sys

repo, ref, out_path = sys.argv[1:4]
seams = os.path.join(repo, 'scripts/code-shape/seams.mjs')
guide = os.path.join(repo, 'scripts/code-shape/areas.json')
done = set()
if os.path.exists(out_path):
    for line in open(out_path):
        done.add(json.loads(line)['sha'])
log = subprocess.run(['git', '-C', repo, 'log', ref, '--first-parent', '--reverse',
                      '--format=%H%x1f%cs%x1f%s%x1f%b%x1e'], capture_output=True, text=True).stdout
with open(out_path, 'a') as f:
    for rec in (r.strip('\n') for r in log.split('\x1e') if r.strip()):
        sha, day, subject, body = (rec.split('\x1f') + ['', '', ''])[:4]
        if sha in done:
            continue
        p = subprocess.run(['node', seams, repo, sha, guide], capture_output=True, text=True)
        try:
            j = json.loads(p.stdout)
        except ValueError:
            f.write(json.dumps({'sha': sha, 'date': day, 'subject': subject, 'error': True}) + '\n')
            continue
        pairs = {f"{q['a']}|{q['b']}": sorted(f"{c['from']}>{c['to']}" for c in q.get('crossings', []))
                 for q in j['knots']['pairs']}
        f.write(json.dumps({
            'sha': sha, 'date': day, 'subject': subject,
            'lin': sorted(set(re.findall(r'LIN-\d+', subject + ' ' + body))),
            'pr': (re.findall(r'\(#(\d+)\)', subject) or [None])[-1],
            'files': j['scope']['files'],
            'cross': sum(l['imports'] for l in j['links']),
            'pairs': pairs,
        }) + '\n')
        f.flush()
