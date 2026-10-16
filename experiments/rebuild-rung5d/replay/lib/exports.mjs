// Export-surface comparison: every export name, its kind and arity (and
// async-ness), every __internal member, constant values, and whether the
// re-exported helpers are the SAME function objects as lib/digest-feedback.js's
// (callers compare identity nowhere today, but a rebuild that forks them
// would be a second definition — LIN-3008's "exactly one definition").
import { describeExports } from './runner.mjs';

export async function describe(sides) {
  const df = await import('/home/user/LinearViewer/lib/digest-feedback.js');
  const refs = {
    'digest-feedback.isDecisionAnswerEntry': ['isDecisionAnswerEntry', df.isDecisionAnswerEntry],
    'digest-feedback.isDecisionLifecycleStampEntry': ['isDecisionLifecycleStampEntry', df.isDecisionLifecycleStampEntry],
    'digest-feedback.resolvedDecisionEvents': ['resolvedDecisionEvents', df.resolvedDecisionEvents],
    'digest-feedback._findLastDecision': ['__internal._findLastDecision', df._findLastDecision],
    'digest-feedback._findDecisionAnswer': ['__internal._findDecisionAnswer', df._findDecisionAnswer],
    'digest-feedback.correlateDecisionCase': ['__internal.correlateDecisionCase', df.correlateDecisionCase],
  };
  const out = {};
  for (const s of sides) {
    const mod = await import(`${s.mainUrl}?inst=exports-${s.label}`);
    out[s.label] = describeExports(mod, Object.fromEntries(Object.entries(refs).map(([k, [p, f]]) => [k, [p, f]])));
  }
  const keys = [...new Set([...Object.keys(out.old), ...Object.keys(out.new)])].sort();
  const differences = keys.filter(k => out.old[k] !== out.new[k]).map(k => ({ name: k, old: out.old[k] ?? '(absent)', new: out.new[k] ?? '(absent)' }));
  return { old: out.old, differences };
}
