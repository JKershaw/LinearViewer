/**
 * LIN-4393's real sessions (LIN-4405 fixture): `GET /api/proxy/cost/LIN-4393` on 10 Nov 2026, after LIN-4404 landed
 * (task-life window, per-dispatch `firstRequestAt`/`lastRequestAt`). Token counts are dropped (the timeline does not
 * read them). The wire strips each lineage's `incomplete` and the read's `lineagesTruncated`, so they are set here from
 * what the read reported: every lineage complete (`totalUsd` was a figure, `noTelemetryCount` 0), nothing truncated.
 * `pricedUsd` is the read's own; with no Harbour calls passed in (the timeline passes none) `totalUsd` equals it.
 *
 * The merge: PR #2377 (https://github.com/JKershaw/LinearViewer/pull/2377), GitHub `merged_at` 2026-11-08T15:34:51Z,
 * the time a close-out event records as `prMergedAt` (LIN-3713).
 */

export const LIN_4393_SESSIONS = [
  {
    rootItemId: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
    kind: 'autopilot',
    dispatchedAt: '2026-11-08T14:45:06.721Z',
    harness: 'claude-code',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    costUsd: 0.8398737000000001,
    durationMs: 3795220,
    dispatches: [
      {
        itemId: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        kind: 'autopilot',
        dispatchedAt: '2026-11-08T14:45:06.721Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 9,
            costUsd: 0.2718226
          }
        ],
        requests: 9,
        costUsd: 0.2718226,
        firstRequestAt: '2026-11-08T14:45:19.013Z',
        lastRequestAt: '2026-11-08T14:45:56.932Z'
      },
      {
        itemId: '43dcde42-4aa7-41cc-a089-f11754ea387b',
        kind: 'wake',
        dispatchedAt: '2026-11-08T14:47:18.210Z',
        followUpTo: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 5,
            costUsd: 0.0889743
          }
        ],
        requests: 5,
        costUsd: 0.0889743,
        firstRequestAt: '2026-11-08T14:47:24.721Z',
        lastRequestAt: '2026-11-08T14:47:50.169Z'
      },
      {
        itemId: '3d4aaf93-c1cc-4d7a-b745-ea6ca76c4647',
        kind: 'wake',
        dispatchedAt: '2026-11-08T14:52:02.156Z',
        followUpTo: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 5,
            costUsd: 0.0917858
          }
        ],
        requests: 5,
        costUsd: 0.0917858,
        firstRequestAt: '2026-11-08T14:52:12.910Z',
        lastRequestAt: '2026-11-08T14:52:28.581Z'
      },
      {
        itemId: 'c63c6855-aec8-42a5-a2a7-176ffe6e3be5',
        kind: 'wake',
        dispatchedAt: '2026-11-08T15:30:03.958Z',
        followUpTo: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 8,
            costUsd: 0.1940923
          }
        ],
        requests: 8,
        costUsd: 0.1940923,
        firstRequestAt: '2026-11-08T15:30:14.247Z',
        lastRequestAt: '2026-11-08T15:30:47.892Z'
      },
      {
        itemId: '06a2334a-d215-4dd8-a392-db840459bde3',
        kind: 'wake',
        dispatchedAt: '2026-11-08T15:33:04.339Z',
        followUpTo: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 4,
            costUsd: 0.09118760000000001
          }
        ],
        requests: 4,
        costUsd: 0.09118760000000001,
        firstRequestAt: '2026-11-08T15:33:11.825Z',
        lastRequestAt: '2026-11-08T15:33:27.331Z'
      },
      {
        itemId: '2ae6d4d8-06f3-4c9b-9d45-026bc5cbad1e',
        kind: 'wake',
        dispatchedAt: '2026-11-08T15:47:58.722Z',
        followUpTo: 'aac50384-a59a-4497-8e6d-fde2bb158b41',
        byModel: [
          {
            model: 'claude-sonnet-5-5',
            requests: 4,
            costUsd: 0.10201110000000001
          }
        ],
        requests: 4,
        costUsd: 0.10201110000000001,
        firstRequestAt: '2026-11-08T15:48:07.920Z',
        lastRequestAt: '2026-11-08T15:48:21.275Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '0af0901c-705d-404e-ba31-f391a8a8b4ce',
    kind: 'close-out',
    dispatchedAt: '2026-11-08T15:33:19.785Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 1.6063451999999998,
    durationMs: 878808,
    dispatches: [
      {
        itemId: '0af0901c-705d-404e-ba31-f391a8a8b4ce',
        kind: 'close-out',
        dispatchedAt: '2026-11-08T15:33:19.785Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 45,
            costUsd: 1.6063451999999998
          }
        ],
        requests: 45,
        costUsd: 1.6063451999999998,
        firstRequestAt: '2026-11-08T15:33:32.797Z',
        lastRequestAt: '2026-11-08T15:47:57.908Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: 'ed2ccbe7-bf13-432a-a52e-59572d778a19',
    kind: 'review',
    dispatchedAt: '2026-11-08T15:30:40.944Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'medium',
    costUsd: 0.9839708000000001,
    durationMs: 143243,
    dispatches: [
      {
        itemId: 'ed2ccbe7-bf13-432a-a52e-59572d778a19',
        kind: 'review',
        dispatchedAt: '2026-11-08T15:30:40.944Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 18,
            costUsd: 0.9839708000000001
          }
        ],
        requests: 18,
        costUsd: 0.9839708000000001,
        firstRequestAt: '2026-11-08T15:30:50.537Z',
        lastRequestAt: '2026-11-08T15:33:03.614Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '3878654a-a0d9-4a4d-a12d-06a30a3bb027',
    kind: 'implementation',
    dispatchedAt: '2026-11-08T14:52:21.848Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 6.952966999999999,
    durationMs: 2262002,
    dispatches: [
      {
        itemId: '3878654a-a0d9-4a4d-a12d-06a30a3bb027',
        kind: 'implementation',
        dispatchedAt: '2026-11-08T14:52:21.848Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 78,
            costUsd: 5.082193600000001
          }
        ],
        requests: 78,
        costUsd: 5.082193600000001,
        firstRequestAt: '2026-11-08T14:52:34.893Z',
        lastRequestAt: '2026-11-08T15:15:37.556Z'
      },
      {
        itemId: 'b3cc4c7d-cf3e-4065-9799-460b2d2346f4',
        kind: 'leftover',
        dispatchedAt: '2026-11-08T15:15:38.933Z',
        followUpTo: '3878654a-a0d9-4a4d-a12d-06a30a3bb027',
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 26,
            costUsd: 1.8707733999999998
          }
        ],
        requests: 26,
        costUsd: 1.8707733999999998,
        firstRequestAt: '2026-11-08T15:15:43.504Z',
        lastRequestAt: '2026-11-08T15:30:03.047Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '68f67079-d12b-4554-92f9-1d3abc83a0ea',
    kind: 'plan',
    dispatchedAt: '2026-11-08T14:47:43.984Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 1.9293415999999997,
    durationMs: 258049,
    dispatches: [
      {
        itemId: '68f67079-d12b-4554-92f9-1d3abc83a0ea',
        kind: 'plan',
        dispatchedAt: '2026-11-08T14:47:43.984Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 31,
            costUsd: 1.9293415999999997
          }
        ],
        requests: 31,
        costUsd: 1.9293415999999997,
        firstRequestAt: '2026-11-08T14:47:59.524Z',
        lastRequestAt: '2026-11-08T14:52:01.482Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '8887e5bc-4460-4b5a-94a7-bd57a320ff8a',
    kind: 'scoping',
    dispatchedAt: '2026-11-08T14:45:51.091Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 0.6435784000000001,
    durationMs: 87016,
    dispatches: [
      {
        itemId: '8887e5bc-4460-4b5a-94a7-bd57a320ff8a',
        kind: 'scoping',
        dispatchedAt: '2026-11-08T14:45:51.091Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 15,
            costUsd: 0.6435784000000001
          }
        ],
        requests: 15,
        costUsd: 0.6435784000000001,
        firstRequestAt: '2026-11-08T14:46:05.997Z',
        lastRequestAt: '2026-11-08T14:47:17.579Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '2430d226-73cd-4430-b127-37fc5b90167b',
    kind: 'survey-place',
    dispatchedAt: '2026-11-08T14:41:00.074Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 0.9241177999999999,
    durationMs: 155612,
    dispatches: [
      {
        itemId: '2430d226-73cd-4430-b127-37fc5b90167b',
        kind: 'survey-place',
        dispatchedAt: '2026-11-08T14:41:00.074Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 22,
            costUsd: 0.9241177999999999
          }
        ],
        requests: 22,
        costUsd: 0.9241177999999999,
        firstRequestAt: '2026-11-08T14:41:33.720Z',
        lastRequestAt: '2026-11-08T14:43:35.124Z'
      }
    ],
    telemetry: true,
    incomplete: false
  },
  {
    rootItemId: '26ea49ac-7386-4378-a925-da99cbf1f75d',
    kind: 'survey-task',
    dispatchedAt: '2026-11-08T14:40:59.557Z',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    effort: 'high',
    costUsd: 0.8699514,
    durationMs: 140735,
    dispatches: [
      {
        itemId: '26ea49ac-7386-4378-a925-da99cbf1f75d',
        kind: 'survey-task',
        dispatchedAt: '2026-11-08T14:40:59.557Z',
        followUpTo: null,
        byModel: [
          {
            model: 'claude-opus-5-5',
            requests: 20,
            costUsd: 0.8699514
          }
        ],
        requests: 20,
        costUsd: 0.8699514,
        firstRequestAt: '2026-11-08T14:41:12.387Z',
        lastRequestAt: '2026-11-08T14:43:18.622Z'
      }
    ],
    telemetry: true,
    incomplete: false
  }
];

export const LIN_4393_PRICED_USD = 14.750145899999998;

export const LIN_4393_MERGE_EVENTS = [
  { by: 'close-out', merged: true, prUrl: 'https://github.com/JKershaw/LinearViewer/pull/2377', prMergedAt: '2026-11-08T15:34:51.000Z', at: '2026-11-08T15:35:20.000Z' },
];

/** A time after the task finished (its last session ended 15:48:21). */
export const LIN_4393_NOW = '2026-11-10T09:00:00.000Z';
