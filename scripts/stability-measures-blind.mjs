// Measure 1, no new mess (LIN-4422): the blind-read sample and its tally. Pure, like the core: landings, numstat
// records and the recorded Balance cells come in as data, rows come out.
//
// The one Balance-to-sign rule. A blind reader's Balance cell becomes a sign here and nowhere else: the paper's
// coding (docs/papers/harbour/cleaner-than-it-started-scripts/code-blind.mjs) imports codeBalance, so the measure's
// tally and the paper's codes cannot drift on the edge cells: `**mixed (leans worse)**` is mixed (0, flagged leans),
// `**better** (small)` is better (+1), and a cell with no leading sign word (`(with #3)`, a row linked to an earlier
// one) has no sign. Scores as in docs/papers/harbour/cleaner-than-it-started.md: better +1, neutral or mixed 0, worse -1.
//
// The sample (the plan's P1.4). An ordinary landing names its own ticket (the core's ownTicket) and touches a path
// outside docs/. One landing per ticket, its first ordinary landing in the window: the ruling on lin4399-m1m4-placeholder
// says "a sample of the window's tickets", so a ticket landed in pieces is read once, not once per piece. From those, up
// to SAMPLE_SIZE landings evenly spaced in landing order (oldest first), so a re-run of the same window picks the same
// commits. The reader prompt is frozen at
// docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md.
//
// signs.json is one object keyed by full commit sha, each value that reader's Balance cell copied verbatim. A sampled
// commit with no entry, or with a cell that has no sign, is unreadable (the read is partial); it is never neutral.

import { mean, notMeasured, ownTicket, percent, round, row } from './stability-measures-core.mjs';

export const SAMPLE_SIZE = 8;
export const PENDING_BLIND = 'pending blind reads';
export const SIGN_SCORE = Object.freeze({ better: 1, neutral: 0, mixed: 0, worse: -1 });

/**
 * A Balance cell → { balance, sign, score, leans }. `balance` is the cell with bold markers removed and trimmed;
 * `sign` its leading word (better, neutral, mixed or worse, lower-cased) or null; `score` from SIGN_SCORE or null;
 * `leans` is 'worse' when the cell says "leans worse", else null.
 */
export function codeBalance(raw) {
  const balance = String(raw ?? '').replace(/\*\*/g, '').trim();
  const sign = (balance.match(/^(better|neutral|mixed|worse)\b/i) || [])[1]?.toLowerCase() ?? null;
  return { balance, sign, score: sign === null ? null : SIGN_SCORE[sign], leans: /leans worse/i.test(balance) ? 'worse' : null };
}

const outsideDocs = (files) => files.some((f) => !f.path.startsWith('docs/'));

/**
 * The window's ordinary landings, oldest first, one per ticket. `landings` are parseLandingLog() records (subject and
 * body, newest first as git logs them); `numstat` are parseNumstat() records of the same window (files per commit).
 * A landing whose files were not read is not ordinary: `unread` counts them, so a short numstat is not a short sample.
 */
export function ordinaryLandings(landings, numstat) {
  const filesOf = new Map(numstat.map((c) => [c.commit, c.files]));
  const seen = new Map();
  let unread = 0;
  let repeat = 0;
  for (const l of [...landings].reverse()) {
    const ticket = ownTicket(l.subject, l.body);
    if (!ticket) continue;
    const files = filesOf.get(l.commit);
    if (!files) { unread++; continue; }
    if (!outsideDocs(files)) continue;
    if (seen.has(ticket)) { seen.get(ticket).laterLandings.push(l.commit); repeat++; continue; }
    seen.set(ticket, { commit: l.commit, ticket, date: l.date, subject: l.subject, laterLandings: [] });
  }
  return { ordinary: [...seen.values()], unread, repeatLandings: repeat };
}

/**
 * Up to `size` items evenly spaced through `items` (kept in their order): item floor((2i + 1) * n / 2size) for
 * i = 0..size-1, the middle of each of `size` equal stretches. Fewer items than `size`: all of them.
 */
export function evenSample(items, size = SAMPLE_SIZE) {
  if (items.length <= size) return [...items];
  return Array.from({ length: size }, (_, i) => items[Math.floor(((2 * i + 1) * items.length) / (2 * size))]);
}

/** The sample row: which commits a blind reader reads, and the rule that picked them. */
export function sampleRow({ landings, numstat, size = SAMPLE_SIZE, reference = null }) {
  if (!landings.length) return notMeasured('sample', 'no landings in the window', { reference });
  const { ordinary, unread, repeatLandings } = ordinaryLandings(landings, numstat);
  if (!ordinary.length) {
    return unread
      ? notMeasured('sample', `no ordinary landing could be read (${unread} landing(s) had no file list)`, { reference })
      : notMeasured('sample', 'no ordinary landings in the window (none names a ticket and touches code outside docs/)', { reference });
  }
  const sample = evenSample(ordinary, size);
  const value = {
    rule: `up to ${size} ordinary landings (own ticket, a path outside docs/; one per ticket, its first), evenly spaced in landing order`,
    landings: landings.length, ordinary: ordinary.length, repeatLandings, size, sampled: sample.length,
    commits: sample,
  };
  return row('sample', value, { unreadable: unread, reason: unread ? `${unread} ticket landing(s) had no file list` : null, reference });
}

/**
 * The blind tally over the sample. `signs` is the parsed signs.json (sha → Balance cell), null when no --blind was
 * given (the row reads `pending blind reads`), or { reason } when the file could not be read.
 */
export function blindRow({ sample, signs, reference = null }) {
  if (sample.status === 'not measured') return notMeasured('blind', `no sample: ${sample.reason}`, { reference });
  if (signs == null) return notMeasured('blind', PENDING_BLIND, { reference });
  if (signs.reason) return notMeasured('blind', `signs unreadable: ${signs.reason}`, { reference });
  const counts = { better: 0, neutral: 0, mixed: 0, worse: 0 };
  const scores = [];
  const perCommit = [];
  const missing = [];
  const unsigned = [];
  for (const s of sample.value.commits) {
    const cell = signs[s.commit];
    if (typeof cell !== 'string') { missing.push(s.commit); perCommit.push({ commit: s.commit, ticket: s.ticket, sign: null }); continue; }
    const coded = codeBalance(cell);
    if (coded.sign === null) { unsigned.push(s.commit); perCommit.push({ commit: s.commit, ticket: s.ticket, sign: null, balance: coded.balance }); continue; }
    counts[coded.sign]++;
    scores.push(coded.score);
    perCommit.push({ commit: s.commit, ticket: s.ticket, sign: coded.sign, score: coded.score, leans: coded.leans, balance: coded.balance });
  }
  const sampled = new Set(sample.value.commits.map((s) => s.commit));
  const notSampled = Object.keys(signs).filter((k) => !sampled.has(k));
  const why = [
    missing.length ? `${missing.length} sampled commit(s) have no sign in signs.json` : null,
    unsigned.length ? `${unsigned.length} Balance cell(s) have no leading sign word` : null,
    notSampled.length ? `${notSampled.length} key(s) name no sampled commit (keys are full shas)` : null,
  ].filter(Boolean).join('; ');
  if (!scores.length) return notMeasured('blind', `no sampled commit has a readable sign (${why})`, { reference });
  const neutralOrBetter = counts.better + counts.neutral + counts.mixed;
  const value = {
    read: scores.length, sampled: sample.value.sampled,
    neutralOrBetter, neutralOrBetterShare: percent(neutralOrBetter, scores.length),
    worse: counts.worse,
    meanSign: round(mean(scores), 2),
    counts, perCommit, missing, unsigned, notSampled,
  };
  const unreadable = missing.length + unsigned.length;
  return row('blind', value, { unreadable, reason: unreadable ? why : null, reference });
}
