// AI-path coverage floors for a router replay (LIN-3880).
//
// A replay compares what two sides answer. If the fakes never let a request
// reach the model call, both sides answer the same 500 and the replay reads
// clean while judging nothing. The harness counts what each request reached
// (cfg.aiCounters) and this module judges the totals against floors the target
// names (cfg.aiFloors): each floor is a counter key, a minimum, and the tier that
// has to have run for the floor to mean anything.
//
// Pure: no I/O. The harness calls evaluateAiCoverage once per run and prints the
// result; exit 3 is the harness's, on a `fail` verdict.

export const AI_FLOOR_MODES = ['fail', 'warn', 'off'];

/**
 * @param {object} p
 * @param {{old: Record<string, number>, new: Record<string, number>}} p.counts
 * @param {Array<{key: string, min: number, needs: 'gen'|'edge'}>} p.floors
 * @param {string[]} p.tiers tiers the run executed
 * @param {'fail'|'warn'|'off'} [p.mode='fail']
 * @param {boolean} [p.only=false] a --only run is one scenario: not a coverage run
 * @returns {{mode: string, verdict: 'pass'|'fail'|'warn'|'off'|'skip', reason?: string,
 *   floors: Array<{key: string, min: number, needs: string, judged: boolean}>,
 *   sides: Record<'old'|'new', {counts: Record<string, number>, missed: Array<{key: string, min: number, have: number}>}>}}
 */
export function evaluateAiCoverage({ counts, floors, tiers, mode = 'fail', only = false }) {
  if (!AI_FLOOR_MODES.includes(mode)) throw new Error(`ai floor mode must be one of ${AI_FLOOR_MODES.join(', ')}, got "${mode}"`);
  const judged = (f) => tiers.includes(f.needs);
  const report = {
    mode,
    verdict: 'pass',
    floors: floors.map(f => ({ key: f.key, min: f.min, needs: f.needs, judged: judged(f) })),
    sides: {},
  };
  for (const side of ['old', 'new']) {
    const have = counts[side] || {};
    report.sides[side] = {
      counts: have,
      missed: floors.filter(judged).filter(f => (have[f.key] || 0) < f.min).map(f => ({ key: f.key, min: f.min, have: have[f.key] || 0 })),
    };
  }
  if (mode === 'off') return { ...report, verdict: 'off' };
  if (only) return { ...report, verdict: 'skip', reason: 'a --only run is one scenario, not a coverage run' };
  if (!tiers.includes('gen') && !tiers.includes('edge')) return { ...report, verdict: 'skip', reason: 'no gen or edge tier ran' };
  const missed = Object.values(report.sides).some(s => s.missed.length > 0);
  if (!missed) return report;
  return { ...report, verdict: mode === 'warn' ? 'warn' : 'fail' };
}
