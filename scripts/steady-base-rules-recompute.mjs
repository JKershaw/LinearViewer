// LIN-3143: recompute the rule-inventory tables in docs/papers/harbour/steady-base.md from the committed, hand-built docs/papers/harbour/steady-base-rules.json.
// Usage: node scripts/steady-base-rules-recompute.mjs [--json]
import { readFileSync } from 'fs';

const { rules } = JSON.parse(readFileSync(new URL('../docs/papers/harbour/steady-base-rules.json', import.meta.url), 'utf8'));
const tally = (rs, f) => rs.reduce((a, r) => ((a[r[f]] = (a[r[f]] || 0) + 1), a), {});
const bySource = {};
for (const r of rules) (bySource[r.source] ||= []).push(r);
const rows = Object.entries(bySource).map(([source, rs]) => ({
  source, census: !rs[0].sampled, rules: rs.length, bytes: rs.reduce((s, r) => s + r.bytes, 0),
  enforcement: tally(rs, 'enforcement'), class: tally(rs, 'class'),
  restatedElsewhere: rs.filter((r) => r.duplicated_in.length).length, citesTicket: rs.filter((r) => r.tickets.length).length,
}));
const census = rules.filter((r) => !r.sampled);
const summary = {
  census: { rules: census.length, bytes: census.reduce((s, r) => s + r.bytes, 0), enforcement: tally(census, 'enforcement'), class: tally(census, 'class'), restatedElsewhere: census.filter((r) => r.duplicated_in.length).length },
  all: { rules: rules.length, bytes: rules.reduce((s, r) => s + r.bytes, 0), enforcement: tally(rules, 'enforcement'), class: tally(rules, 'class') },
  runtimeCode: rules.filter((r) => r.enforcement === 'runtime-code').map((r) => `${r.source}:${r.line} ${r.enforcement_evidence} — ${r.summary}`),
};
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, summary }, null, 1));
else {
  console.log('source            census rules  bytes  runtime pinned prose-only | keep convert tier retire | restated cites');
  for (const r of rows) console.log(`${r.source.padEnd(18)} ${r.census ? 'yes' : 'no '} ${String(r.rules).padStart(5)} ${String(r.bytes).padStart(6)}  ${String(r.enforcement['runtime-code'] || 0).padStart(7)} ${String(r.enforcement['prose-pinned-by-test'] || 0).padStart(6)} ${String(r.enforcement['prose-only'] || 0).padStart(10)} | ${String(r.class['keep-prose'] || 0).padStart(4)} ${String(r.class['convert-to-code'] || 0).padStart(7)} ${String(r.class['scope-to-risk-tier'] || 0).padStart(4)} ${String(r.class.retire || 0).padStart(6)} | ${String(r.restatedElsewhere).padStart(8)} ${String(r.citesTicket).padStart(5)}`);
  console.log(JSON.stringify(summary, null, 1));
}
