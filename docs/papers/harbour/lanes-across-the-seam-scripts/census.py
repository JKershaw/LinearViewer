#!/usr/bin/env python3
"""Census for docs/papers/harbour/lanes-across-the-seam.md (LIN-4480).

Re-run:  python3 -I census.py <out-dir>
Needs:   HARBOUR_LOCAL_BASE (the workspace proxy, GET only) and an authenticated `gh`
         in a LinearViewer checkout (for the merged-PR file lists).

Writes to <out-dir>:
  issues/LIN-nnnn.json   the four lanes' tickets as fetched (description + comments), with
                         commit-author names redacted (see redact() below)
  dispatches.json        dispatch rows for every Runs & dispatch and LLM & prompts ticket
  prs.json               LinearViewer PRs merged in the window, with their files
  census.json            the counts the paper quotes

Population: the four lanes filed at 12:08Z on 13 Nov 2026 and every ticket under them,
over the window 13 Nov 12:08Z to 14 Nov 10:00Z. Lane membership is by parent, written out
below so a reader can check it.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from collections import Counter, defaultdict

LANES = {
    'Jira': [4445, 4450, 4451, 4452, 4473],
    'Front end': [4446, 4463, 4471, 4472],
    'Runs & dispatch': [4447] + list(range(4453, 4463)) + [4474, 4475, 4476],
    'LLM & prompts': [4448] + list(range(4464, 4471)),
}
LANE_OF = {f'LIN-{n}': lane for lane, ns in LANES.items() for n in ns}
WINDOW = ('2026-11-13T12:08', '2026-11-14T10:00')

# A directed message is a comment posted on one lane's ticket that is written to that lane
# by the other: its heading names its source lane's ticket and addresses the reader
# ("From LIN-…", "Reply from LIN-…", "Correction from…", "Heads-up from…", "Seam notice…",
# "renewed ask", "addition to the renewed ask"), or it is the other lane's work posted on
# this lane's ticket. Read by hand from every comment that names the other lane's tickets
# (the mention census below), and listed by id so a reader can open each one.
# The last field is read by hand: the comment by the receiving lane that answers it, or
# None. A reply need not quote the id (08c9c898 answers d3ba7421 by naming "LIN-4447's
# three moves"), so the id-citation lists the script prints are a floor, not the answer.
DIRECTED = [
    # (comment id prefix, posted on, written by lane, asks for a reply?, answered by)
    ('d3ba7421', 'LIN-4448', 'Runs & dispatch', True, '08c9c898'),  # proposal: three seam moves
    ('08c9c898', 'LIN-4447', 'LLM & prompts', False, None),         # reply: agree to all three
    ('097a3442', 'LIN-4447', 'LLM & prompts', False, None),         # correction: Runs files edited
    ('1a2e7cba', 'LIN-4448', 'Runs & dispatch', True, None),        # LIN-4458 renewed classifier ask
    ('0510ffe0', 'LIN-4448', 'Runs & dispatch', True, None),        # LIN-4459 renewed live-wait ask
    ('b564445b', 'LIN-4448', 'Runs & dispatch', True, None),        # LIN-4459 addition to the ask
    ('15de14a7', 'LIN-4447', 'LLM & prompts', False, None),         # LIN-4467 heads-up
    ('b555094d', 'LIN-4447', 'LLM & prompts', True, None),          # LIN-4468 seam notice ("say so here")
    ('3300ab65', 'LIN-4447', 'LLM & prompts', False, None),         # LIN-4470 after-read, after Done
    ('36a9d8e0', 'LIN-4447', 'LLM & prompts', False, None),         # LIN-4470 control read, after Done
    ('29848ba2', 'LIN-4447', 'LLM & prompts', False, None),         # LIN-4470 comparison, after Done
]
DIRECTED_IDS = {d[0] for d in DIRECTED}

# Comments sometimes name a commit's author in brackets after its sha ("<sha> (<Name>)").
# Those names can identify an employer, which the archive never publishes, so the snapshot
# replaces them before anything is written. Only the bracketed name changes; the sha stays.
AUTHOR_AFTER_SHA = re.compile(r'\b([0-9a-f]{7,40}) \(([A-Z][A-Za-z]+)\)')


def redact(issue):
    for c in issue.get('comments', []):
        c['body'] = AUTHOR_AFTER_SHA.sub(r'\1 (committer redacted)', c['body'])
    if issue.get('description'):
        issue['description'] = AUTHOR_AFTER_SHA.sub(r'\1 (committer redacted)', issue['description'])
    return issue


def get(path):
    base = os.environ['HARBOUR_LOCAL_BASE'].rstrip('/')
    for attempt in range(5):
        try:
            with urllib.request.urlopen(f'{base}/api/proxy/{path}') as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get('Retry-After', '5')))
                continue
            raise
    raise RuntimeError(path)


def main(out):
    os.makedirs(f'{out}/issues', exist_ok=True)
    issues = {}
    for ident in sorted(LANE_OF):
        d = redact(get(f'issues/{ident}'))
        issues[ident] = d
        with open(f'{out}/issues/{ident}.json', 'w') as f:
            json.dump(d, f, indent=1, sort_keys=True)
        time.sleep(1.1)

    # 1. Mentions: comments on one lane's tickets naming another lane's ticket.
    mentions = Counter()
    mention_rows = []
    by_id = {}
    for ident, d in issues.items():
        me = LANE_OF[ident]
        for c in d.get('comments', []):
            by_id[c['id'][:8]] = (ident, c)
            if not (WINDOW[0] <= c['createdAt'] < WINDOW[1]):
                continue
            named = {LANE_OF[i] for i in re.findall(r'LIN-\d{4}', c['body']) if i in LANE_OF}
            others = sorted(named - {me})
            for o in others:
                mentions[f'{me} -> {o}'] += 1
            if others:
                mention_rows.append([c['createdAt'], ident, me, others, c['id'][:8]])

    # 2. Directed messages, with whether any comment by the receiving lane cites each.
    directed = []
    for cid, posted_on, writer, asks, answered_by in DIRECTED:
        ident, c = by_id[cid]
        assert ident == posted_on, (cid, ident, posted_on)
        receiver = LANE_OF[posted_on]
        cited_by_receiver = sorted(
            f"{i}:{x['id'][:8]}" for i, d in issues.items() if LANE_OF[i] == receiver
            for x in d.get('comments', [])
            if cid in x['body'] and x['id'][:8] != cid and x['id'][:8] not in DIRECTED_IDS)
        cited_by_writer = sorted(
            f"{i}:{x['id'][:8]}" for i, d in issues.items() if LANE_OF[i] == writer
            for x in d.get('comments', []) if cid in x['body'])
        directed.append({
            'id': cid, 'at': c['createdAt'], 'posted_on': posted_on, 'writer': writer,
            'heading': c['body'].splitlines()[0][:120],
            'asks_for_reply': asks, 'answered_by': answered_by,
            'cited_by_receiving_lane': cited_by_receiver,
            'cited_by_writing_lane': cited_by_writer,
        })

    # 3. Dispatch rows for the two tidy lanes' tickets (when each lane's sessions ran, and on
    # which ticket: finding 3 needs the children's rows, not only the parents').
    disp = {}
    for ident in sorted(i for i, lane in LANE_OF.items() if lane in ('Runs & dispatch', 'LLM & prompts')):
        rows = get(f'dispatch?issueIdentifier={ident}&limit=100')['items']
        time.sleep(1.1)
        disp[ident] = sorted(
            ({k: r[k] for k in ('id', 'kind', 'dispatchedAt', 'status', 'sessionId', 'closedReason')}
             for r in rows), key=lambda r: r['dispatchedAt'])
    with open(f'{out}/dispatches.json', 'w') as f:
        json.dump(disp, f, indent=1)

    # 4. Merged PRs in the window and the files more than one lane touched.
    raw = subprocess.run(
        ['gh', 'pr', 'list', '--state', 'merged', '--limit', '80',
         '--json', 'number,title,mergedAt,files'], capture_output=True, text=True, check=True).stdout
    prs = [p for p in json.loads(raw) if WINDOW[0] <= p['mergedAt'] < WINDOW[1]]
    files = defaultdict(set)
    per_lane = Counter()
    pr_rows = []
    for p in prs:
        ident = re.search(r'LIN-\d{4}', p['title']).group(0)
        lane = LANE_OF[ident]
        per_lane[lane] += 1
        paths = [f['path'] for f in p['files']]
        pr_rows.append({'number': p['number'], 'mergedAt': p['mergedAt'], 'ticket': ident,
                        'lane': lane, 'files': paths})
        for path in paths:
            files[path].add(lane)
    with open(f'{out}/prs.json', 'w') as f:
        json.dump(sorted(pr_rows, key=lambda r: r['mergedAt']), f, indent=1)
    shared = {p: sorted(s) for p, s in files.items() if len(s) > 1}
    pair = Counter()
    for s in shared.values():
        for i, a in enumerate(s):
            for b in s[i + 1:]:
                pair[f'{a} + {b}'] += 1

    census = {
        'window': WINDOW,
        'lanes': {k: [f'LIN-{n}' for n in v] for k, v in LANES.items()},
        'comment_mentions_by_lane_pair': dict(mentions),
        'comments_naming_another_lane': len(mention_rows),
        'directed_messages': directed,
        'merged_prs_by_lane': dict(per_lane),
        'merged_prs': len(prs),
        'files_changed': len(files),
        'files_changed_by_more_than_one_lane': len(shared),
        'shared_files_by_lane_pair': dict(pair),
        'shared_files': shared,
        'mention_rows': sorted(mention_rows),
    }
    with open(f'{out}/census.json', 'w') as f:
        json.dump(census, f, indent=1, sort_keys=True)
    print(json.dumps({k: census[k] for k in (
        'comments_naming_another_lane', 'merged_prs_by_lane', 'merged_prs', 'files_changed',
        'files_changed_by_more_than_one_lane', 'shared_files_by_lane_pair')}, indent=1))
    for m in directed:
        print(m['at'][5:16], m['id'], m['writer'], '->', m['posted_on'],
              'asks:', m['asks_for_reply'], 'answered by:', m['answered_by'],
              '| receiving-lane tickets cite it:', m['cited_by_receiving_lane'] or 'none')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
