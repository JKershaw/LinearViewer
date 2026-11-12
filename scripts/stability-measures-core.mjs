// The Stability Review's five measures, per piece of work (LIN-4399; this core, LIN-4420). Pure: the reads come in
// as data (numstat text, shape totals at two commits, Waiting counts, CI runs) and the ordered reading comes out.
// No I/O here: scripts/stability-measures.mjs does the git, shape and `gh` reads and hands their results over.
//
// Every row has one shape, { key, value, reference, status, reason, unreadable }, in one of three states:
//   measured      value set, reason null, unreadable 0;
//   partial       value set from what could be read, `unreadable` counts what could not, `reason` names it;
//   not measured  value null, reason says why, unreadable null.
// A source that is missing or unreadable is `not measured`, never 0. Zero is a reading: a commit that can be read and
// has no notes directory has 0 Waiting entries. Later pieces (LIN-4421..LIN-4423) add rows of the same shape.

export const SCOPE_INCLUDE = '^(server\\.js$|(lib|routes|public)/.*\\.[cm]?js$)';
export const NOT_BUILT = 'not built yet';

export const STATUS = Object.freeze({ MEASURED: 'measured', PARTIAL: 'partial', NOT_MEASURED: 'not measured' });

/** A row read in full, or in part when `unreadable` > 0 (then `reason` names what was not read). */
export function row(key, value, { unreadable = 0, reason = null, reference = null } = {}) {
  if (value == null) throw new TypeError(`${key}: a row with no value is notMeasured, not row`);
  if (unreadable > 0 && !reason) throw new TypeError(`${key}: a partial read names what it could not read`);
  return { key, value, reference, status: unreadable > 0 ? STATUS.PARTIAL : STATUS.MEASURED, reason: unreadable > 0 ? reason : null, unreadable };
}

/** A row whose source could not be read: no value, never a zero. */
export function notMeasured(key, reason, { reference = null } = {}) {
  if (!reason) throw new TypeError(`${key}: not measured needs a reason`);
  return { key, value: null, reference, status: STATUS.NOT_MEASURED, reason, unreadable: null };
}

const round = (n, places) => (n == null ? null : Math.round(n * 10 ** places) / 10 ** places);
const perLanding = (n, landings) => round(n / landings, 1);

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── churn ────────────────────────────────────────────────────────────────────
/**
 * `git log --format=@%H --numstat` text → [{ commit, files: [{ path, added, deleted }] }], one entry per commit in
 * log order. A binary file's counts are null (numstat prints `-`).
 */
export function parseNumstat(text) {
  const commits = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) { commits.push({ commit: line.slice(1), files: [] }); continue; }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || !commits.length) continue;
    const num = (s) => (s === '-' ? null : Number(s));
    commits.at(-1).files.push({ path: m[3], added: num(m[1]), deleted: num(m[2]) });
  }
  return commits;
}

/**
 * Added and deleted lines over the window's landings, on the files `inScope` accepts. The denominator is the landings,
 * every first-parent commit, whether it touched the scope or not. An in-scope binary file has no line counts: it is
 * counted as unreadable, so the read is partial rather than short.
 */
export function churnRow(landings, inScope, { reference } = {}) {
  if (!landings.length) return notMeasured('churn', 'no landings in the window', { reference });
  let added = 0;
  let deleted = 0;
  let binary = 0;
  for (const { files } of landings) {
    for (const f of files) {
      if (!inScope(f.path)) continue;
      if (f.added == null) { binary++; continue; }
      added += f.added;
      deleted += f.deleted;
    }
  }
  const n = landings.length;
  const value = {
    landings: n, added, deleted, net: added - deleted,
    perLanding: { added: perLanding(added, n), deleted: perLanding(deleted, n), net: perLanding(added - deleted, n) },
    deletedPerAdded: added ? round(deleted / added, 2) : null,
  };
  return row('churn', value, { unreadable: binary, reason: binary ? `${binary} in-scope binary file change(s) have no line counts` : null, reference });
}

// ── lines ────────────────────────────────────────────────────────────────────
// Comment-only share is over all lines, blanks included: 78,976 / 200,226 = 39.44% at 5334c81a (not 42.5%, the share
// of code + comment). The denominator is pinned by a test.
const endpoint = ({ codeLines, commentLines, blankLines }) => {
  const total = codeLines + commentLines + blankLines;
  return { code: codeLines, comment: commentLines, blank: blankLines, total, commentShare: total ? round((commentLines / total) * 100, 2) : null };
};

/**
 * Net production lines between two commits, from the shape kit's totals at each (measureShape's `totals`, with its
 * `scope.parseFailures.length` as `parseFailures`). Code, comment-only and blank stay apart; the comment-only share is
 * given at both ends. Files the counter could not parse are the partial-read count.
 */
export function linesRow({ base, head, landings, reference }) {
  if (!base || !head) return notMeasured('lines', 'shape totals missing at an endpoint', { reference });
  if (!landings) return notMeasured('lines', 'no landings in the window', { reference });
  const b = endpoint(base.totals);
  const h = endpoint(head.totals);
  const net = { total: h.total - b.total, code: h.code - b.code, comment: h.comment - b.comment, blank: h.blank - b.blank };
  const value = {
    base: b, head: h, net,
    perLanding: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, perLanding(v, landings)])),
  };
  const unreadable = (base.parseFailures ?? 0) + (head.parseFailures ?? 0);
  return row('lines', value, { unreadable, reason: unreadable ? `${unreadable} in-scope file(s) did not parse (base ${base.parseFailures}, head ${head.parseFailures})` : null, reference });
}

// ── CI ───────────────────────────────────────────────────────────────────────
/**
 * Median minutes of successful `test.yml` runs on main whose head sha is a window landing; duration is updatedAt −
 * startedAt. `runs` is null when the listing could not be read (then `reason` says why). Landings with no matched run
 * make the read partial: a listing that stopped short, or a landing whose CI did not pass, both show as unreadable.
 */
export function ciRow({ runs, reason, landingShas, listingCapped = false, reference }) {
  if (runs == null) return notMeasured('ci', reason ?? 'CI runs not read', { reference });
  if (!landingShas.length) return notMeasured('ci', 'no landings in the window', { reference });
  const wanted = new Set(landingShas);
  const matched = runs.filter((r) => wanted.has(r.headSha) && (r.conclusion == null || r.conclusion === 'success'));
  if (!matched.length) return notMeasured('ci', `no successful run matched any of the ${landingShas.length} landings`, { reference });
  const minutes = matched.map((r) => (new Date(r.updatedAt) - new Date(r.startedAt)) / 60000);
  const landingsWithRun = new Set(matched.map((r) => r.headSha)).size;
  const missing = landingShas.length - landingsWithRun;
  const value = { medianMinutes: round(median(minutes), 2), runs: matched.length, landingsWithRun, landings: landingShas.length, listingCapped };
  const why = [missing ? `${missing} landing(s) have no successful run` : null, listingCapped ? 'the run listing hit its limit' : null].filter(Boolean).join('; ');
  return row('ci', value, { unreadable: missing, reason: missing ? why : null, reference });
}

// ── Waiting ──────────────────────────────────────────────────────────────────
/**
 * Waiting entries at the window's two ends for one source. `base` and `head` are each { count } or { reason } (the
 * count read, or why it could not be). Totals at both ends, the change, and the change per landing.
 */
export function waitingRow(key, { base, head, landings, reference, detail = {} }) {
  const missing = [base?.reason && `base: ${base.reason}`, head?.reason && `head: ${head.reason}`].filter(Boolean);
  if (!base || !head) missing.push('endpoint not read');
  if (missing.length) return notMeasured(key, missing.join('; '), { reference });
  if (!landings) return notMeasured(key, 'no landings in the window', { reference });
  const change = head.count - base.count;
  return row(key, { ...detail, base: base.count, head: head.count, change, perLanding: round(change / landings, 2) }, { reference });
}

/** Harbour and the runner apart, and their sum, which exists only when both were read. */
export function waitingRows({ harbour, runner, landings, references = {} }) {
  const h = waitingRow('waiting.harbour', { ...harbour, landings, reference: references['waiting.harbour'] });
  const r = runner.reason
    ? notMeasured('waiting.runner', runner.reason, { reference: references['waiting.runner'] })
    : waitingRow('waiting.runner', { ...runner, landings, reference: references['waiting.runner'] });
  const unread = [h, r].filter((x) => x.status === STATUS.NOT_MEASURED).map((x) => x.key);
  const total = unread.length
    ? notMeasured('waiting.total', `${unread.join(' and ')} not measured`, { reference: references['waiting.total'] })
    : waitingRow('waiting.total', {
      base: { count: h.value.base + r.value.base }, head: { count: h.value.head + r.value.head }, landings, reference: references['waiting.total'],
    });
  return [h, r, total];
}

// ── the reading ──────────────────────────────────────────────────────────────
/** The five measures in the order they win when they clash (LIN-4399's ask). */
export const MEASURES = Object.freeze([
  { rank: 1, key: 'no-new-mess', title: 'No new mess' },
  { rank: 2, key: 'curve', title: 'The curve' },
  { rank: 3, key: 'speed', title: 'Speed' },
  { rank: 4, key: 'seat', title: "The person's seat" },
  { rank: 5, key: 'cost', title: 'Cost per finished task' },
]);

/**
 * The ordered reading. `rows` maps a measure key to its rows; a measure with none yet reads `not measured: not built
 * yet`. The curve opens with net production lines, then churn, CI and Waiting; tickets minted per landing is a later
 * piece's row (LIN-4421).
 */
export function buildReading({ window, rows = {}, references = {} }) {
  const curve = rows.curve ?? [];
  const withMinted = curve.some((r) => r.key === 'minted') ? curve : [...curve, notMeasured('minted', NOT_BUILT, { reference: references.minted })];
  const filled = { ...rows, curve: withMinted };
  return {
    window,
    measures: MEASURES.map((m) => ({
      ...m,
      rows: filled[m.key]?.length ? filled[m.key] : [notMeasured(m.key, NOT_BUILT, { reference: references[m.key] })],
    })),
  };
}

// ── the opening table (stderr) ───────────────────────────────────────────────
const num = (n) => (n == null ? '—' : n.toLocaleString('en-GB'));
const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('en-GB')}`);

const summarise = (r) => {
  const v = r.value;
  switch (r.key) {
    case 'lines': return `net ${signed(v.net.total)} (code ${signed(v.net.code)}, comment-only ${signed(v.net.comment)}, blank ${signed(v.net.blank)}); ${signed(v.perLanding.total)} per landing; totals ${num(v.base.total)} → ${num(v.head.total)}; comment-only share ${v.base.commentShare}% → ${v.head.commentShare}%`;
    case 'churn': return `${num(v.added)} added, ${num(v.deleted)} deleted over ${v.landings} landings; ${v.perLanding.added} added and ${v.perLanding.deleted} deleted per landing; ${v.deletedPerAdded} deleted per added`;
    case 'ci': return `median ${v.medianMinutes} min over ${v.runs} runs (${v.landingsWithRun} of ${v.landings} landings)`;
    default:
      if (r.key.startsWith('waiting.')) return `${num(v.base)} → ${num(v.head)} (${signed(v.change)}, ${signed(v.perLanding)} per landing)${v.branch ? `; ${v.branch} ${v.baseSha?.slice(0, 9)}..${v.headSha?.slice(0, 9)}` : ''}`;
      return JSON.stringify(v);
  }
};

/** One line per row, measures in order: the review's opening table. */
export function formatTable(reading) {
  const { window: w } = reading;
  const lines = [`stability measures ${w.base.slice(0, 9)}..${w.head.slice(0, 9)} (${w.baseDate} → ${w.headDate}), ${w.landings} landings`];
  for (const m of reading.measures) {
    lines.push(`${m.rank}. ${m.title}`);
    for (const r of m.rows) {
      const body = r.status === STATUS.NOT_MEASURED ? `not measured: ${r.reason}` : summarise(r);
      const tail = r.status === STATUS.PARTIAL ? ` [partial: ${r.unreadable} unreadable — ${r.reason}]` : '';
      const ref = r.reference != null ? ` (8 Nov: ${typeof r.reference === 'object' ? JSON.stringify(r.reference) : r.reference})` : '';
      lines.push(`   ${r.key.padEnd(16)} ${body}${tail}${ref}`);
    }
  }
  return lines.join('\n');
}
