// LIN-3210 (sub-task (c) of LIN-3197): the D7 join to the M23 `launch.duplicate` alarm and the
// bucket split. Imported by survey-hides-detect-sessions.mjs; it does nothing when run.
//
// Event shape (simple-dispatcher, `dispatcher.js:1162`):
//   launch.duplicate = { session, item, issueIdentifier, kind, otherSession, otherItem, otherPhase, otherParked }
// where `session` is the NEWLY LAUNCHED session (`ownSessionId`, `dispatcher.js:1144`) and
// `otherSession` is the pre-existing non-terminal one. The join key is `(issue|kind, second session
// id)` — D7's later launch is the alarm's `session`.
//
// Buckets are mutually exclusive, precedence:
//   alarmed > alreadyEnded > parkedOnly > unalarmed
// `alreadyEnded` is R2: the first session ended (terminal) before the second launched
// (`overlapMin === 0`), so the (b) alarm — which scans only non-terminal sessions — cannot fire.
// It is reported apart from both `unalarmed` and `parkedOnly` so "zero unalarmed duplicates" does
// not read red when the code is behaving correctly.

const short = (id) => String(id == null ? '' : id).slice(0, 8);
const key = (issue, kind, sessionId) => `${issue}|${kind}|${short(sessionId)}`;

// Returns the pairs with a `bucket` on every `set: 'hit'` row (non-hits are left as-is).
export function joinDuplicateAlarms(pairs, duplicates = []) {
  const alarmed = new Set(duplicates.map((d) => key(d.issueIdentifier, d.kind, d.session)));
  return pairs.map((p) => {
    if (p.set !== 'hit') return p;
    let bucket;
    if (alarmed.has(key(p.issue, p.kind, p.second))) bucket = 'alarmed';
    else if (p.overlapMin === 0) bucket = 'alreadyEnded';
    else if (p.firstParked) bucket = 'parkedOnly';
    else bucket = 'unalarmed';
    return { ...p, bucket };
  });
}

export function bucketCounts(rows) {
  const c = { alarmed: 0, unalarmed: 0, parkedOnly: 0, alreadyEnded: 0 };
  for (const p of rows) if (p.set === 'hit' && p.bucket in c) c[p.bucket]++;
  return c;
}
