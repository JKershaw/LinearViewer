// balance-sign.mjs — the one Balance-to-sign rule for the hand-run blind passes (LIN-4422; moved here by LIN-4439).
//
// A blind reader's Balance cell becomes a sign here and nowhere else. code-blind.mjs imports it, and re-running that on
// either frozen folder must reproduce its blind-codes.json (tests/unit/stability-measures.test.js checks every frozen
// cell). It lived in scripts/stability-measures-blind.mjs while the Stability Review scored a sample of landings from
// these cells; LIN-4439 retired that sample (measure 1 now counts the pre-merge `## Blind read` comments), so the rule
// came back to its one remaining user. It imports nothing, so the freeze fixture needs no file from outside this folder.
//
// The edge cells: `**mixed (leans worse)**` is mixed (0, flagged leans), `**better** (small)` is better (+1), and a cell
// with no leading sign word (`(with #3)`, a row linked to an earlier one) has no sign. Scores as in
// docs/papers/harbour/cleaner-than-it-started.md: better +1, neutral or mixed 0, worse -1.

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
