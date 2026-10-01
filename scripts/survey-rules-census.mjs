// LIN-3156: merge the 102 review and close-out rules of steady-base-rules.json into distinct rules (restatements folded), and print each distinct rule's members, bytes and origin tickets.
// Usage: node scripts/survey-rules-census.mjs [--json]   (fails loudly unless every census rule lands in exactly one distinct rule)
import { readFileSync } from 'fs';

// A census rule is keyed by template letter + source line + bytes (r = review, c = close-out); the key is unique across the 102.
// Restatements merge when they direct the same act on the same object; a checklist line merges into the rule it summarises.
export const DISTINCT = [
  { id: 'requirements', name: 'Verify against the requirements and acceptance criteria; unaddressed plan requirements are the top gaps', members: ['r1006/158', 'r1028/204', 'r1030/184', 'r1031/92', 'r1055/46'] },
  { id: 'scope-drift', name: 'Check the recorded scope matches what changed; flag plan overrun or staleness', members: ['r1008/279'] },
  { id: 'regression-history', name: 'Read git log of modified files; confirm no fixed bug is reintroduced or revert re-applied', members: ['r1020/161', 'r1023/154', 'r1024/115', 'r1066/31'] },
  { id: 'class-check', name: 'Class check: name the class and its unhandled siblings, or state isolated', members: ['r1035/676', 'r1067/84'] },
  { id: 'inside-outside', name: 'Mark every unhandled instance and ledger item inside/outside; inside items are never filed', members: ['r1039/1095', 'r1039/152', 'r1039/295', 'c1200/519'] },
  { id: 'search-before-filing', name: 'Search relations and existing tickets before filing; link instead of refiling', members: ['r1041/366', 'c1201/337'] },
  { id: 'rulings-check', name: 'Query rulings (incl. resolved) before raising a DECISION; never re-raise a covered finding', members: ['r1043/410', 'c1202/377'] },
  { id: 'test-adequacy', name: 'Tests at the right level (e2e/integration where needed) cover the new behaviour and its interactions', members: ['r1047/280', 'r1049/90', 'r1050/146', 'r1056/38', 'r1057/122', 'r1058/87', 'r1059/87'] },
  { id: 'mutation-check', name: 'Mutation-check load-bearing tests: remove the code path, confirm red, revert, report', members: ['r1051/736', 'r1060/155'] },
  { id: 'quality-checklist', name: 'Checklist: security, error handling, style, performance, production-ready', members: ['r1061/44', 'r1062/35', 'r1063/45', 'r1064/32', 'r1068/34'] },
  { id: 'direct-verification', name: 'Verify visual/behavioural results directly (mockup side-by-side); flag the unverifiable for human testing', members: ['r1072/122', 'r1073/214', 'r1075/186'] },
  { id: 'ledger', name: 'Write the "What CI Did Not Prove" ledger; an empty ledger is stated and passed through', members: ['r1079/1031', 'r1081/521', 'r1090/276', 'r1092/358', 'c1183/327'] },
  { id: 'risk-lanes', name: 'Risk lanes: hard gate only on risky surfaces; named monitor or rollback for the rest', members: ['r1083/554', 'r1085/1144', 'r1086/744', 'r1088/824', 'c1173/706', 'c1174/724', 'c1175/334', 'c1177/1029', 'c1194/601'] },
  { id: 'verdict', name: 'End with an explicit verdict; a non-empty ledger gets "Approve — conditional on close-out"', members: ['r1098/214', 'r1098/280'] },
  { id: 'ci-green-exact-commit', name: 'CI green (or substitute re-run) before Approve and on the exact commit before merge', members: ['r1065/107', 'r1102/465', 'c1143/216', 'c1187/220'] },
  { id: 'role-separation', name: 'Review is write-only: ledger plus verdict; merge, Done and follow-ups belong to close-out', members: ['r1098/102', 'r1102/297', 'r1102/91', 'r1104/378', 'r1117/603'] },
  { id: 'trivial-edit-bound', name: 'Close-out authors only a review-quoted trivial edit; anything else (incl. conflicts) holds and routes to implementation', members: ['r1098/530', 'r1106/463', 'c1158/870', 'c1167/826', 'c1188/873', 'c1200/502'] },
  { id: 'cannot-close', name: 'Cannot-close branch: link the blocker, name its kind as next action, leave open; hold the merge', members: ['r1108/290', 'r1109/151', 'r1110/261', 'r1111/319', 'r1113/216', 'c1196/596'] },
  { id: 'authorization', name: 'Read the verdict; recorded Approve plus discharged ledger is the authorization, no fresh go-ahead', members: ['c1141/112', 'c1179/893'] },
  { id: 'ledger-discharge', name: 'Never merge/Done with an undischarged item; inside discharges by evidence or explicit drop, outside by follow-up', members: ['c1142/172', 'c1166/205', 'c1167/1025', 'c1168/326', 'c1169/121', 'c1171/269'] },
  { id: 'verify-landed', name: 'Verify on the landed commit and set Done in-session', members: ['c1144/286', 'c1189/69'] },
  { id: 'summary-comment', name: 'Close-out summary: what merged, how each ledger item was resolved, final CI state', members: ['c1145/216', 'c1190/103'] },
  { id: 'archive-prune', name: 'Archive a pre-prune snapshot, then prune stage-artifact sections of the description', members: ['c1146/155', 'c1191/134', 'c1209/292', 'c1211/459', 'c1212/335', 'c1213/352', 'c1214/497', 'c1215/272', 'c1216/331', 'c1218/267'] },
  { id: 'follow-up-filing', name: 'File outside follow-ups linked, with a risk-derived priority and a catalog type label', members: ['c1147/324', 'c1192/208', 'c1200/237', 'c1203/271', 'c1204/236', 'c1205/249'] },
];

export const keyOf = (r) => `${r.source === 'review' ? 'r' : 'c'}${r.line}/${r.bytes}`;

export function census(path = 'docs/papers/harbour/steady-base-rules.json') {
  const rules = JSON.parse(readFileSync(path, 'utf8')).rules.filter((r) => r.source === 'review' || r.source === 'close-out');
  const byKey = new Map(rules.map((r) => [keyOf(r), r]));
  const seen = new Map();
  for (const d of DISTINCT) for (const m of d.members) {
    if (!byKey.has(m)) throw new Error(`unknown census key ${m} in ${d.id}`);
    if (seen.has(m)) throw new Error(`${m} in both ${seen.get(m)} and ${d.id}`);
    seen.set(m, d.id);
  }
  const missing = [...byKey.keys()].filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`census rules not assigned: ${missing.join(', ')}`);
  return DISTINCT.map((d) => {
    const ms = d.members.map((k) => byKey.get(k));
    const tickets = [...new Set(ms.flatMap((m) => m.tickets || []))].sort((a, b) => a.split('-')[1] - b.split('-')[1]);
    return {
      ...d, templates: [...new Set(ms.map((m) => m.source))], bytes: ms.reduce((s, m) => s + m.bytes, 0),
      restatements: ms.length, tickets, origin: tickets[0] || null,
      enforcement: [...new Set(ms.map((m) => m.enforcement))], classes: [...new Set(ms.map((m) => m.class))],
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = census();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  else {
    console.log(`${rows.length} distinct rules from ${rows.reduce((s, r) => s + r.restatements, 0)} census rules`);
    for (const r of rows) console.log([r.id.padEnd(22), String(r.restatements).padStart(2), String(r.bytes).padStart(5), r.templates.join('+').padEnd(16), r.tickets.join(',')].join(' '));
  }
}
