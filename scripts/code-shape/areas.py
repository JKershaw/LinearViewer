"""Sort production files into areas by path and aggregate size, giants, copies and cross-area imports."""
import json, os, re, subprocess, sys
from collections import defaultdict

T = os.path.dirname(os.path.abspath(__file__))

L = lambda *names: r'^lib/(' + '|'.join(names) + r')\.js$'
RULES = [
    ('Front end: browser code', r'^public/'),
    ('Front end: server-rendered pages', r'^lib/(render[^/]*|components/.*|tree|ship-layout|swim-graph|swim-lanes|timeline-zoom|parse-landing|mask-secrets-in-html|task-page-href|guest-task-path)\.js$'),
    ('Agent API (proxy)', r'^routes/proxy[^/]*\.js$|^lib/proxy-[^/]*\.js$|' + L('require-grant', 'harbour-feedback-tokens', 'dispatch-tokens', 'settings-proxy-default')),
    ('Runs & dispatch', r'^routes/(dispatch|live-console|runner-kit|runner-setup)\.js$|^lib/runner-kit/|' + L(
        r'dispatch-[^/]*', 'pipeline-loops', r'run-[^/]*', r'wake-[^/]*', 'digest-feedback', 'lineage-closure', 'loop-supersede',
        'follow-up-dispatch', 'follow-on-ratio', r'observation-[^/]*', r'observer-[^/]*', r'liveness-[^/]*', 'completion-signals',
        'agent-status-store', 'unanswered-decisions', 'task-decisions-store', 'shelved-rulings-store', 'dismissal-suggestions-store',
        'close-out-events-store', 'ticket-close-closer', 'plan-review-round-trips', 'poll-halt', 'workspace-halt', 'queue-config',
        r'session-summary[^/]*', 'session-telemetry', 'session-materializer-precompute', 'sessions-feed-cache', 'sessions-view',
        'recent-runs', 'task-run-facts', 'task-cost', 'terminal-marked-task-cost', 'transcript-spend', 'weekly-budget',
        'wall-clock-summary', 'harbour-spawn', 'runner-owner-gate', 'consumer-poll-warning', 'effort-readout', 'escalation-kpis',
        'task-stack', 'task-page-loader', 'task-mode-store', 'task-snapshot-store', 'task-done-cache', 'live-console',
        'periodical-runs', 'periodical-report-gate', 'refresh-on-resolve-gate', 'superseded-selection', 'owner-mint-refusals')),
    ('LLM & prompts', r'^lib/prompts/|' + L(
        r'openrouter[^/]*', r'prompt-[^/]*', 'stage-router', r'recommend[^/]*', r'recommendation-[^/]*', r'chat-[^/]*', 'agent-turn',
        'bash-tool', 'llm-call-log', 'model-pricing', 'should-mock-ai', r'brief[^/]*', r'recap[^/]*', r'collective-[^/]*', 'yap-client',
        'next-run', 'north-star-resolver', 'scan', 'scan-fingerprint', 'audit', 'roadmap', 'context-graph', 'graph-features',
        'library', 'library-metadata', 'custom-prompts-store', 'saved-chat-store', 'file-pointer', 'feedback-title', 'action-kind')),
    ('Auth, accounts & workspaces', r'^routes/(auth|email-auth|github-auth|github-projects-auth|jira-auth|openrouter-auth|provider-auth-routers|account-merge|held-connection)\.js$|' + L(
        r'account-[^/]*', r'connection-[^/]*', r'credential-[^/]*', 'email-auth', 'email-availability', 'email-transport',
        'github-install-flow', 'held-connection-entry', r'owner-[^/]*', 'ownerless-token-policy', 'pat-session', 'persist-binding',
        'rejected-credentials', r'refresh-[^/]*', 'token-refresh', 'suspect-credential-refresh', 'session-store', 'session-options',
        'user-preferences', 'workspace', r'workspace-[^/]*', 'urlkey-holders', 'wake-credential')),
    ('Providers (Linear, GitHub, Jira, local)', r'^lib/providers/|^lib/sample-data/|' + L(
        'linear', 'linear-fetch', 'local-store', 'starter-seed', 'issue-write-validation', 'description-edit', 'github-pr-files',
        'github-pr-status', 'pr-state-copy', 'pr-state-store', 'attachment-upload', 'task-attachments', 'trashed-signal')),
    ('Wiring (server.js)', r'^server\.js$'),
    ('Platform & plumbing', r'^lib/utils/|' + L(
        'db-indexes', 'scheduler', 'hourly-cleanup', 'errors', 'async-errors', 'sse', 'http-keepalive', 'loose-json', 'deploy-info',
        'feature-defaults', 'read-horizon', 'secret-scan', 'scan-public-pages', 'partial-write-error', 'drop-shares-collection',
        'kpi-stats', 'funnel-event-store', 'milestone-funnel', 'free-tier-store', 'plan-fee-config', 'pricing-conformance-sweep',
        'workflow-config')),
    ('Web routes (pages & workspace API)', r'^routes/'),
    ('Other features', r'^lib/'),
]
RULES = [(name, re.compile(rx)) for name, rx in RULES]


def area_of(path, kind):
    if kind == 'sd':
        return 'Simple Dispatcher'
    for name, rx in RULES:
        if rx.search(path):
            return name
    return 'Unclassified'


def measure(repo_dir, sha, kind):
    out = f'{T}/runs/{kind}-{sha[:12]}-pf.json'
    if not os.path.exists(out):
        r = subprocess.run(['node', f'{T}/measure.mjs', repo_dir, sha, kind], capture_output=True, text=True, check=True)
        open(out, 'w').write(r.stdout)
    return json.load(open(out))


def aggregate(d, kind):
    areas = defaultdict(lambda: {'files': 0, 'lines': 0, 'normLines': 0, 'dupLines': 0, 'giants': 0, 'giantLines': 0})
    file_area = {}
    for f in d['perFile']:
        a = area_of(f['path'], kind)
        file_area[f['path']] = a
        s = areas[a]
        s['files'] += 1
        for k in ('lines', 'normLines', 'dupLines', 'giants', 'giantLines'):
            s[k] += f[k]
    edges = defaultdict(int)
    for f in d['perFile']:
        a = file_area[f['path']]
        for imp in f['imports']:
            b = file_area.get(imp)
            if b:
                edges[(a, b)] += 1
    return areas, edges, file_area


if __name__ == '__main__':
    snaps = json.load(open(f'{T}/snaps.json'))
    LV, SD = '/home/user/LinearViewer', '/home/user/simple-dispatcher'
    rows, edge_rows, file_rows = [], [], []
    for s in snaps:
        for kind, repo_dir in (('lv', LV), ('sd', SD)):
            d = measure(repo_dir, s[kind], kind)
            areas, edges, file_area = aggregate(d, kind)
            for a, v in areas.items():
                rows.append({'snapshot': s['label'], 'committedAt': s['lvDate'] if kind == 'lv' else s['sdDate'], 'area': a, **v})
            if kind == 'lv':
                for (a, b), n in edges.items():
                    edge_rows.append({'snapshot': s['label'], 'from': a, 'to': b, 'imports': n})
            if s['label'] == '2026-10-12 now':
                for path, a in file_area.items():
                    file_rows.append({'repo': 'Harbour' if kind == 'lv' else 'Simple Dispatcher', 'path': path, 'area': a})
    json.dump(rows, open(f'{T}/out/areas.json', 'w'))
    json.dump(edge_rows, open(f'{T}/out/area-imports.json', 'w'))
    json.dump(file_rows, open(f'{T}/out/area-files.json', 'w'))
    print(len(rows), 'area rows,', len(edge_rows), 'edge rows,', len(file_rows), 'file rows')
