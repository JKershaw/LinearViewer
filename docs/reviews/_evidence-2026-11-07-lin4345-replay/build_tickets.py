import json, sys
sp = sys.argv[1]
END = '*End of what was asked. Steps write below this line; nothing above it changes.*'
cases = {'4085': '2026-11-01T18:19:44.010Z', '1596': '2026-07-26T16:39:44.005Z'}
for t, at in cases.items():
    d = json.load(open(f'{sp}/replay/snap{t}.json'))
    snaps = {s['capturedAt']: s['snapshot'] for s in d['snapshots']}
    first = snaps[min(snaps)]['description']  # as filed
    sn = snaps[at]
    desc = sn['description']
    assert desc.startswith(first[:200]), t
    # The filed request is the message and its page/browser capture; the origin
    # (triage-first) marker goes below the block, as feedback filing does now.
    marker_at = desc.index('**Origin')
    filed = desc[:marker_at].rstrip().rstrip('-').rstrip()
    rest = desc[marker_at:]
    sealed = f'## As asked\n\n{filed}\n\n{END}\n\n{rest}'
    meta = {'identifier': f'LIN-{t}', 'title': sn['title'], 'description': sealed,
            'labels': [l if isinstance(l, str) else l.get('name') for l in (sn.get('labels') or [])]}
    json.dump(meta, open(f'{sp}/replay/issue-{t}.json', 'w'))
    lines = [f'# LIN-{t}: {sn["title"]}', '', f'State: {(sn.get("state") or {}).get("name") if isinstance(sn.get("state"), dict) else sn.get("state")}',
             f'Labels: {", ".join(meta["labels"]) or "none"}', '', '## Description', '', sealed, '', '## Comments (oldest first)', '']
    for c in sorted(sn['comments'], key=lambda c: c.get('createdAt', '')):
        user = c.get('user', {}).get('name') if isinstance(c.get('user'), dict) else c.get('user')
        lines += [f'### {c.get("createdAt")} — {user}', '', c['body'], '']
    open(f'{sp}/replay/ticket-{t}.md', 'w').write('\n'.join(lines))
    print(t, 'filed', len(filed), 'desc', len(sealed), 'comments', len(sn['comments']))
