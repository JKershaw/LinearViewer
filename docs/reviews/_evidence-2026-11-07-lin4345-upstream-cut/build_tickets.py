"""python3 -I build_tickets.py <dir-with-snap*.json> <outdir>
Seals the filed request into an `## As asked` block the way #2348's build_tickets.py does,
and writes issue-<case>.json (for render.mjs) and ticket-<case>.md (what the run reads)."""
import json, sys
sp, out = sys.argv[1], sys.argv[2]
END = '*End of what was asked. Steps write below this line; nothing above it changes.*'
cases = {'4085-scoping': ('4085', '2026-11-01T17:35:35.250Z'),
         '4085-plan': ('4085', '2026-11-01T17:39:57.470Z'),
         '4085-review': ('4085', '2026-11-01T18:19:44.010Z'),
         '998-plan': ('998', '2026-07-04T09:14:33.430Z')}
for case, (t, at) in cases.items():
    d = json.load(open(f'{sp}/snap{t}.json'))
    snaps = {s['capturedAt']: s['snapshot'] for s in d['snapshots']}
    first = snaps[min(snaps)]['description']  # as filed
    sn = snaps[at]
    desc = sn['description']
    assert desc.startswith(first[:200]), case
    # The filed request is the message and its page/browser capture; the origin
    # (triage-first) marker and everything after it go below the block.
    marker_at = desc.index('**Origin')
    filed = desc[:marker_at].rstrip().rstrip('-').rstrip()
    rest = desc[marker_at:]
    sealed = f'## As asked\n\n{filed}\n\n{END}\n\n{rest}'
    labels = [l if isinstance(l, str) else l.get('name') for l in (sn.get('labels') or [])]
    meta = {'identifier': f'LIN-{t}', 'title': sn['title'], 'description': sealed, 'labels': [{'name': l} for l in labels]}
    json.dump(meta, open(f'{out}/issue-{case}.json', 'w'))
    state = sn.get('state')
    state = state.get('name') if isinstance(state, dict) else state
    lines = [f'# LIN-{t}: {sn["title"]}', '', f'State: {state}', f'Labels: {", ".join(labels) or "none"}', '',
             '## Description', '', sealed, '', '## Comments (oldest first)', '']
    for c in sorted(sn['comments'], key=lambda c: c.get('createdAt', '')):
        user = c.get('user', {}).get('name') if isinstance(c.get('user'), dict) else c.get('user')
        lines += [f'### {c.get("createdAt")} — {user}', '', c['body'], '']
    open(f'{out}/ticket-{case}.md', 'w').write('\n'.join(lines))
    print(case, 'filed', len(filed), 'desc', len(sealed), 'comments', len(sn['comments']))
