/**
 * tests/fixtures/dispatch-launch-failures.js
 *
 * LIN-2872 — verbatim stored feedback of the live incident rows the
 * duplicate-dispatch launch-time-failure exemption was filed for, plus the
 * negative fixtures (dispatchs that genuinely RAN before they failed) the
 * predicate must refuse to exempt.
 *
 * The three incident rows (a995b517, 2c174598, ce42c335) were fetched via
 * `GET /api/proxy/dispatch/<id>` over the workspace proxy and copied into this
 * file VERBATIM — message/timestamp/kind/rootItemId exactly as stored, nothing
 * trimmed or normalised. This is the review's explicit ask (F1): fixtures must
 * be re-derived from a live row, never from the marker vocabulary alone.
 *
 * Note the shape that defeated two prior passes: each row carries the executor's
 * `[working] Session launched …` announcement AND the opencode reaper's
 * post-failure liveness poll `[working] (opencode — Ns so far; next check in
 * 30s)`. BOTH are liveness, not work; a deny-list that exempts only `Session
 * launched` still trips on the reaper poll. `isLaunchTimeFailure` must be an
 * ALLOW-LIST of work evidence so a new liveness line cannot defeat it again.
 */

export const LIN2872_INCIDENT_ROW_IDS = ['a995b517', '2c174598', 'ce42c335'];

export const LIN2872_INCIDENT_FEEDBACK = {
  a995b517: [
    {
      message: '[started] Running task in linearviewer (opencode)\nTask: implement — "# Implement LIN-2787: Label catalog: `?teamId=` silently hides workspace-level labels, so close-outs…" (9495 chars)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:33:07.866Z'
    },
    {
      message: '[working] Session launched (session: 4cbf91c1, tty: unknown)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:33:07.884Z'
    },
    {
      message: '[failed] opencode runner error: message request failed: HTTP 500 {"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_745a1bc2"}}',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:33:14.803Z',
      rootItemId: 'a995b517-2d4b-43d7-a9a3-8a682dc09214',
      kind: 'status'
    },
    {
      message: '[working] (opencode — 12s so far; next check in 30s)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:33:20.149Z',
      rootItemId: 'a995b517-2d4b-43d7-a9a3-8a682dc09214',
      kind: 'heartbeat'
    },
    {
      message: '[failed] opencode exited with code 1',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:33:20.584Z',
      rootItemId: 'a995b517-2d4b-43d7-a9a3-8a682dc09214',
      kind: 'status'
    }
  ],
  '2c174598': [
    {
      message: '[started] Running task in linearviewer (opencode)\nTask: implement — "# Implement LIN-2787: Label catalog: `?teamId=` silently hides workspace-level labels, so close-outs…" (10297 chars)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:38:24.908Z'
    },
    {
      message: '[working] Session launched (session: 9337c501, tty: unknown)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:38:24.921Z'
    },
    {
      message: '[failed] opencode runner error: message request failed: HTTP 500 {"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_d2531cc2"}}',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:38:30.931Z',
      rootItemId: '2c174598-9cd3-4944-86d7-f8196099f152',
      kind: 'status'
    },
    {
      message: '[working] (opencode — 11s so far; next check in 30s)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:38:36.721Z',
      rootItemId: '2c174598-9cd3-4944-86d7-f8196099f152',
      kind: 'heartbeat'
    },
    {
      message: '[failed] opencode exited with code 1',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T17:38:37.180Z',
      rootItemId: '2c174598-9cd3-4944-86d7-f8196099f152',
      kind: 'status'
    }
  ],
  ce42c335: [
    {
      message: '[started] Running task in linearviewer (opencode)\nTask: close-out — "# Close Out LIN-2121: Back-fill issueIdentifier onto wake dispatch rows so issue-scoped listing can …" (17021 chars)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T18:53:03.706Z'
    },
    {
      message: '[working] Session launched (session: 99de7ffe, tty: unknown)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T18:53:03.736Z'
    },
    {
      message: '[failed] opencode runner error: opencode serve never became ready within 20000ms (last error: fetch failed)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T18:58:13.257Z',
      rootItemId: 'ce42c335-84eb-40d3-9789-df108818b489',
      kind: 'status'
    },
    {
      message: '[working] (opencode — 5m 13s so far; next check in 30s)',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T18:58:16.700Z',
      rootItemId: 'ce42c335-84eb-40d3-9789-df108818b489',
      kind: 'heartbeat'
    },
    {
      message: '[failed] opencode exited with code 1',
      url: null,
      urlLabel: null,
      timestamp: '2026-09-13T18:58:17.193Z',
      rootItemId: 'ce42c335-84eb-40d3-9789-df108818b489',
      kind: 'status'
    }
  ]
};

/**
 * A dispatch that genuinely RAN before it failed — it posted a CATEGORIZED
 * heartbeat (the `[working · <category>]` lead heartbeat.js:282 emits for a
 * window with completed tools) and only then terminal `[failed]`. This is real
 * work evidence, so `isLaunchTimeFailure` must return FALSE (the window stays).
 */
export const CATEGORIZED_BEAT_THEN_FAILED = [
  { message: '[started] Running task in linearviewer (opencode)', url: null, urlLabel: null, timestamp: '2026-09-14T10:00:00.000Z' },
  { message: '[working] Session launched (session: 11111111, tty: unknown)', url: null, urlLabel: null, timestamp: '2026-09-14T10:00:00.100Z' },
  { message: '[working · editing] 4 tools in 20s: editing 3, search 1 · 4 total · next heartbeat in ≤30s', url: null, urlLabel: null, timestamp: '2026-09-14T10:00:25.000Z', rootItemId: 'cat-fixture', kind: 'heartbeat' },
  { message: '[failed] tests red', url: null, urlLabel: null, timestamp: '2026-09-14T10:01:00.000Z', rootItemId: 'cat-fixture', kind: 'status' }
];

/**
 * A dispatch that genuinely RAN before it failed — it posted a `[usage]` row
 * whose parsed payload has `outputTokens > 0` (opencode-runner.js posts one
 * `[usage]` entry per turn) and only then terminal `[failed]`. Token output is
 * real work evidence, so `isLaunchTimeFailure` must return FALSE.
 */
export const USAGE_OUTPUT_TOKENS_THEN_FAILED = [
  { message: '[started] Running task in linearviewer (opencode)', url: null, urlLabel: null, timestamp: '2026-09-14T11:00:00.000Z' },
  { message: '[working] Session launched (session: 22222222, tty: unknown)', url: null, urlLabel: null, timestamp: '2026-09-14T11:00:00.100Z' },
  {
    message: '[usage] {"schema":1,"harness":"opencode","model":"deepseek/deepseek-v4.1-flash","inputTokens":5529,"outputTokens":25811,"cacheCreationInputTokens":145449,"cacheReadInputTokens":4588835,"costUsd":null}',
    url: null,
    urlLabel: null,
    timestamp: '2026-09-14T11:05:00.000Z',
    rootItemId: 'usage-fixture',
    kind: 'usage'
  },
  { message: '[failed] boom', url: null, urlLabel: null, timestamp: '2026-09-14T11:05:30.000Z', rootItemId: 'usage-fixture', kind: 'status' }
];
