// LIN-3194: the steady-base menu. Holds every option's checked size (paper and section cited in `src`), merges overlapping
// savings once per cost factor, multiplies factors into stacks, and counts the expedition's own archive from git. No proxy calls.
// Usage: node scripts/survey-menu-analyse.mjs [--out data/survey-menu/menu.json] [--print]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'data/survey-menu/menu.json');

// ---- The menu --------------------------------------------------------------------------------------------------------------
// lo/hi are shares of September's fleet weighted tokens (both repos; child-named rule unless the source says otherwise), as the
// cited paper states them at version 2 or later. `derived` marks a figure this paper computed from checked figures; it is not itself
// checked. Risk to correctness: 0 none or positive, 1 low, 2 low–medium, 3 medium, 4 high. Factors: F1 supervision plumbing
// (tokens in supervisor sessions that observable state decides), F2 legs that need not run, F3 tokens per session, F4 which changes
// get the full process, F5 hours not tokens, F6 enablers and landing (no saving of their own).
const OPTIONS = [
  { id: 'M1', row: 'map 1', label: 'Stop waking parents for "still waiting"', factor: 'F1', repo: 'both', lo: 5.7, hi: 5.7, risk: 2, effort: 'S–M',
    src: 'held-or-fresh v2 §Options A (−5.7 points is map row 1); wake-inventory v2 §Findings (35% of wakes are relayed re-arms, 97% quiet)' },
  { id: 'M2', row: 'map 2', label: "Passage layer's bookkeeping in code", factor: 'F1', repo: 'both', lo: 4.1, hi: 4.1, risk: 1, effort: 'M',
    src: 'held-or-fresh v2 §Options A (−4.1 points is the Runner, map row 2); survey-check (the Runner and legs are all of September\'s supervision rise)' },
  { id: 'M3', row: 'map 3', label: 'Deterministic conductor for the supervision cycle (contains M1, M2, M5)', factor: 'F1', repo: 'both', lo: 10, hi: 27, risk: 3, effort: 'L',
    src: 'what-supervisors-do v2 §Findings (77% of supervision tokens mechanical, about 27% of fleet tokens); held-or-fresh v2 §Options A (−10% by class, −14% if code could tell which wakes change nothing)' },
  { id: 'M4', row: 'map 16', label: 'Lean relay: judgement steps start fresh from a small handoff', factor: 'F1', repo: 'both', lo: 9, hi: 19, risk: 3, effort: 'L',
    src: 'held-or-fresh v2 §Options B (A plus a further 0–9 points at a 20k handoff; −19% as a bound); prototype-concepts v2 §Options C (the handoff needs a done-and-answered list)' },
  { id: 'M5', row: 'judgement 2', label: 'Rule-class calls in code (loop bound, retry once, proceed when a blocker is Done)', factor: 'F1', repo: 'both', lo: 0.3, hi: 1, risk: 1, effort: 'S',
    src: 'where-judgement-happens v2 §Options 2 (under 1% of ticket cost; removes the engine\'s 9 misroutes)' },
  { id: 'M6', row: 'cost-mix 2', label: 'Lighter orchestration of split families (parents at half their spend)', factor: 'F1', repo: 'LV', lo: 0, hi: 6.5, risk: 2, effort: 'M',
    src: 'cost-mix v2 §Options 2 (1.1× alone; parent-only spend 13% of the budget); its mechanical part is inside M3, so 0 marks full overlap', derived: true },
  { id: 'M7', row: 'map 15', label: 'A child of an approved plan does not plan again', factor: 'F2', repo: 'LV', lo: 1, hi: 3, risk: 3, effort: 'S',
    src: 'step-overlap v2 §Options A (perhaps 1–3%; ceiling 3.9% of tokens, 4.3% weighted)' },
  { id: 'M8', row: 'map 8', label: 'Stop review and close-out rounds that change nothing', factor: 'F2', repo: 'LV', lo: 1, hi: 3, risk: 1, effort: 'S',
    src: 'why-legs-repeat v2 §Findings (repeats 10% of tokens; 44 of 430 repeat dispatches are close-outs; 20 of 20 close-out repeats changed nothing); which-rules-pay v2 §Findings (mutation check led ~36 of 88 extra legs, 97 test-or-wording changes). 44/430 × 10% ≈ 1% is this paper\'s arithmetic; the mutation rounds are unsized', derived: true },
  { id: 'M34', row: 'hides C', label: 'Give the periodicals the alarm log instead of a search for runtime faults', factor: 'F2', repo: 'LV', lo: 0, hi: 3.1, risk: 1, effort: 'S',
    src: 'what-hides-between-sessions v2 §Options C (up to 3.1% of September\'s tokens per batch spent where no cross-session instance was found first)' },
  { id: 'M9', row: 'map 13', label: 'Stop the bootstrap summary for the roles that still run it', factor: 'F3', repo: 'SD', lo: 3, hi: 5, risk: 1, effort: 'S',
    src: 'starting-context v2 §Options A (3.0% own turns plus up to 2.4% carried; survey-check-8 raised it from 3% to about 5%)' },
  { id: 'M10', row: 'map 14', label: 'A short file pointer between sessions on one ticket (not a map or wiki)', factor: 'F3', repo: 'LV', lo: 1.5, hi: 2, risk: 2, effort: 'S–M',
    src: 'starting-context v2 §Options B–D (bounded by re-finding 4.9–12.1%; C 0.1–2%; D about 1.4%); prototype-concepts v2 §Options A (~1.5–2%)' },
  { id: 'M11', row: 'context E', label: 'Answer deterministic research questions with a tool', factor: 'F3', repo: 'LV', lo: 1, hi: 2, risk: 1, effort: 'M',
    src: 'starting-context v2 §Options E (research legs 5.3% of tokens; perhaps 1–2%)' },
  { id: 'M12', row: 'map 17', label: 'Lighter legs everywhere: fewer tracker reads and writes, brief passed inline', factor: 'F3', repo: 'both', lo: 10, hi: 15, risk: 2, effort: 'M',
    src: 'replay-small-work v2 §Options 2 (tracker calls 25% and remote work 4% of tokens; halving saves about 15%); survey-check-11 (about 15 points truly avoidable). The low end nets out the 35% of tokens in supervision sessions M3 already removes, assuming an even spread', derived: true },
  { id: 'M13', row: 'judgement 3', label: 'Close-out at a cheaper tier, with a frontier step for the open questions', factor: 'F3', repo: 'LV', lo: 1, hi: 3, risk: 3, effort: 'S',
    src: 'where-judgement-happens v2 §Options 3 (2–5% of ticket cost); starting-context v2 §Findings (close-out is 5.2% of fleet tokens); prototype-concepts v2 §Options F (a fixture eval first)', derived: true },
  { id: 'M14', row: 'overlap B', label: 'The plan states what it adds to the research and cites the rest', factor: 'F3', repo: 'LV', lo: 0.2, hi: 1, risk: 1, effort: 'S',
    src: 'step-overlap v2 §Options B (under 1% of a four-step ticket\'s tokens)' },
  { id: 'M16', row: 'map 7', label: 'A light lane for small, non-credential changes, classified by the paths touched', factor: 'F4', repo: 'both', lo: 8, hi: 12, risk: 3, effort: 'M',
    src: 'cost-mix v2 §Options 1 (1.08–1.14×); replay-small-work v2 §Options 1 (saves 8–12% of tokens); proportional-process-backtest v2 (13–18% of hours, 21–30% of dispatches at most)' },
  { id: 'M17', row: 'cost-mix 4', label: 'Size the gates to the change: hold credentials and 300+ lines, halve the rest (contains M16)', factor: 'F4', repo: 'both', lo: 8, hi: 17, risk: 3, effort: 'M',
    src: 'cost-mix v2 §Options 4 (1.2× on the 0–299-line changes it touches, which is a 17% cut); the 50–299 band holds 11 of 43 catches' },
  // Hours, not tokens.
  { id: 'M18', row: 'map 5', label: 'Make the flaky browser specs robust', factor: 'F5', repo: 'LV', lo: 0, hi: 0, risk: 0, effort: 'S–M', hours: '38 red PR runs, 54 re-runs, about 3 runner-hours of re-runs; none before two workers',
    src: 'browser-flakes v2 §Findings; test-estate v2 §Findings (flakes are the biggest cause of red CI)' },
  { id: 'M19', row: 'map 6', label: 'Retire census pins for an import-graph check', factor: 'F5', repo: 'LV', lo: 0, hi: 0, risk: 1, effort: 'S', hours: 'about 18 tickets since June exist to repair or bump a pin, about five pure bumps',
    src: 'test-estate v2 §Findings; survey-check-2' },
  { id: 'M20', row: 'map 9', label: 'Loosen text pins on prompt prose; keep the branch pins', factor: 'F5', repo: 'LV', lo: 0, hi: 0, risk: 1, effort: 'M', hours: 'friction on every prompt change; prose pins caught 3 of 19 deleted lines',
    src: 'test-estate v2 §Findings' },
  { id: 'M21', row: 'hides A', label: 'Run the cross-session detectors live, outside the processes they watch', factor: 'F5', repo: 'both', lo: 0, hi: 1, risk: 1, effort: 'M', hours: '42 hours of supervisors waiting on lost wakes and 165 hours of stalls in September; discovery a median 16 h after onset, detectors 5 h earlier on 7 of 19',
    src: 'what-hides-between-sessions v2 §Options A; survey-check-10 (7 of 19, not 9; about 40 real unrecorded faults)' },
  { id: 'M22', row: 'hides B', label: "Make the runner's completion post tell the truth", factor: 'F5', repo: 'SD', lo: 0, hi: 0, risk: 0, effort: 'S', hours: '23 failed terminal posts logged as posted since July, 8 in September',
    src: 'what-hides-between-sessions v2 §Options B' },
  { id: 'M23', row: 'hides E', label: 'An alarm for duplicate launches', factor: 'F5', repo: 'SD', lo: 0.15, hi: 0.15, risk: 1, effort: 'S', hours: '5 duplicate pairs a month',
    src: 'what-hides-between-sessions v2 §Options E' },
  // Enablers and landing: no saving of their own.
  { id: 'M24', row: 'map 10', label: 'Keep the evidence for the project\'s lifetime (phase C remaining)', factor: 'F6', repo: 'LV', status: 'in progress, LIN-3157', src: 'steady-base.md map row 10' },
  { id: 'M25', row: 'map 11', label: 'Freeze prompt sizes; new lessons land as code first', factor: 'F6', repo: 'both', src: 'steady-base.md map row 11; how-process-changes-land v2 §Findings 3 (adds outnumber removals about six to one)' },
  { id: 'M26', row: 'landing 1', label: 'Every process change names its read and its retirement before it lands', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 1' },
  { id: 'M27', row: 'landing 2', label: 'One process change at a time, between passages, with nothing else in its four weeks', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 2' },
  { id: 'M28', row: 'landing 3', label: 'Shadow mode for the mechanical supervision rows, with cutover and deletion in the same series', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 3' },
  { id: 'M29', row: 'landing 4', label: 'Holdout by lineage for ticket-level changes', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 4' },
  { id: 'M30', row: 'landing 5', label: 'Burn down what is half-finished before a new trial', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 5 (47 items in code, 100 follow-ups, 114 residue tickets)' },
  { id: 'M31', row: 'landing 6', label: 'Report the pooled headline and one per-change rule side by side', factor: 'F6', repo: 'both', src: 'how-process-changes-land v2 §Options 6' },
  { id: 'M32', row: 'proto D', label: 'Check a Harbour paper before it merges, not after', factor: 'F6', repo: 'LV', src: 'prototype-concepts v2 §Options D (about 20 of 24 checks corrected a load-bearing claim after merge)' },
  { id: 'M33', row: 'proto F', label: 'A per-step fixture eval with three runs per arm before a step changes tier', factor: 'F6', repo: 'LV', src: 'prototype-concepts v2 §Options F' },
  { id: 'M35', row: 'hides D', label: 'Retire vigilance text where a detector takes over (inside M25)', factor: 'F6', repo: 'both', src: 'what-hides-between-sessions v2 §Options D (retire only after M21 has run a month)' },
];

const DONE = [
  { row: 'map 4', label: 'Fix the four idling test files', ticket: 'LIN-3158', effect: 'serial unit suite 266 s → 175 s', src: 'steady-base.md map row 4; test-estate v2' },
  { row: 'map 12', label: 'Hygiene in simple-dispatcher: stale mutants, the gate, the iTerm test', ticket: 'LIN-3160', effect: 'three stale mutants re-anchored, 47/47', src: 'steady-base.md map row 12' },
  { row: 'map 5 (unit part)', label: 'Unit flakes: a fixture clock race', ticket: 'LIN-3159', effect: 'done', src: 'steady-base.md map row 5' },
];

const NOT_RECOMMENDED = [
  { label: 'The relay as proposed, with today\'s orientation', why: '0% (−17% to +9%): no reliable saving', src: 'held-or-fresh v2 §Options D' },
  { label: 'Plan review re-derives less', why: 'at most ~2%, and plan review\'s finds are new; high risk', src: 'step-overlap v2 §Options C' },
  { label: 'Writing less, for tokens\' sake', why: 'ticket text is 1.3–2.4% of carried context', src: 'step-overlap v2 §Options E' },
  { label: 'A graph-structured investigation for research legs', why: 'a median 1.44× the tokens for more coverage', src: 'prototype-concepts v2 §Options G' },
  { label: 'A reader-and-inference pass on every check', why: 'a cost, not a saving', src: 'prototype-concepts v2 §Options E' },
  { label: 'Switching model tiers as the cost lever', why: 'whole-life cost per correct change is about the same at frontier and mid tier (ratio 0.91, 0.70–1.21)', src: 'model-choice v2 §Findings' },
  { label: 'A lighter plan review or review on the strength of the judgement paper', why: 'gates and makers make 158 of 260 consequential decisions', src: 'where-judgement-happens v2 §Options 5' },
];

// ---- Factor unions and stacks ------------------------------------------------------------------------------------------------
// Within a factor, options share a pool, so a union is the largest option that contains the others, or the sum of disjoint pools
// where the source says they are disjoint. Across factors the multiples multiply: 1 / (1 − share) per factor.
const mult = (share) => 1 / (1 - share / 100);
const FACTORS = {
  F1: { name: 'Supervision plumbing (map rows 1–3, 16; judgement 2; cost-mix 2)', union: { lo: 10, hi: 27 },
    note: 'M1 + M2 by class is 10; 14 if code could tell which wakes change nothing; 27 is every mechanical supervision token. M4, M5 and M6 sit inside that range.' },
  F2: { name: 'Legs that need not run (map rows 8, 15; hides C)', union: { lo: 2, hi: 6 },
    note: 'M7 (1–3) and M8 (1–3) are disjoint pools and add; M34\'s 0–3.1 is an upper bound the union does not add.' },
  F3: { name: 'Tokens per session (map rows 13, 14, 17; context E; judgement 3; overlap B)', union: { lo: 16.7, hi: 28 },
    note: 'M9 3–5, M10 1.5–2, M11 1–2, M12 10–15, M13 1–3, M14 0.2–1, added as disjoint pools. Without M12 it is 6.7–13.' },
  F4: { name: 'Which changes get the full process (map row 7; cost-mix 1, 4)', union: { lo: 8, hi: 17 },
    note: 'M17 contains M16: the same small-change spend, cut further.' },
};
const F3_NO_M12 = { lo: 6.7, hi: 13 };

const stack = (name, parts, members) => {
  const lo = parts.reduce((p, q) => p * mult(q.lo), 1), hi = parts.reduce((p, q) => p * mult(q.hi), 1);
  const addLo = mult(parts.reduce((p, q) => p + q.lo, 0)), addHi = mult(parts.reduce((p, q) => p + q.hi, 0));
  return { name, members, parts, multiple: { lo: r2(lo), hi: r2(hi) }, savedShare: { lo: r1(100 * (1 - 1 / lo)), hi: r1(100 * (1 - 1 / hi)) }, ifAdded: { lo: r2(addLo), hi: r2(addHi) },
    creditHeld: { lo: r2(heldCredit(lo)), hi: r2(heldCredit(hi)) } };
};
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const CRED = 9.7; // cost-mix v2 §Findings: credentials and auth, child-named share of September's tokens.
const heldCredit = (m) => 1 / (CRED / 100 + (1 - CRED / 100) / m); // the stack applied to everything but credential work

const STACKS = [
  stack('S0 Quick and reliability-neutral', [{ f: 'F3', ...F3_NO_M12, lo: 4.7, hi: 8 }], ['M9', 'M10', 'M14', 'M18', 'M19', 'M20', 'M22', 'M23']),
  stack('S1 Plumbing code can see', [{ f: 'F1', lo: 10, hi: 14 }, { f: 'F2', ...FACTORS.F2.union }, { f: 'F3', lo: 4.7, hi: 8 }], ['S0', 'M1', 'M2', 'M5', 'M7', 'M8']),
  stack('S1+ Plumbing code can see, plus proportionality', [{ f: 'F1', lo: 10, hi: 14 }, { f: 'F2', ...FACTORS.F2.union }, { f: 'F3', lo: 4.7, hi: 8 }, { f: 'F4', ...FACTORS.F4.union }], ['S1', 'M16', 'M17']),
  stack('S2 The conductor', [{ f: 'F1', lo: 14, hi: 27 }, { f: 'F2', ...FACTORS.F2.union }, { f: 'F3', lo: 4.7, hi: 8 }], ['S0', 'M3', 'M21', 'M7', 'M8']),
  stack('S3 The conductor, plus proportionality', [{ f: 'F1', lo: 14, hi: 27 }, { f: 'F2', ...FACTORS.F2.union }, { f: 'F3', lo: 4.7, hi: 8 }, { f: 'F4', ...FACTORS.F4.union }], ['S2', 'M16', 'M17']),
  stack('S4 The whole menu', [{ f: 'F1', lo: 14, hi: 27 }, { f: 'F2', ...FACTORS.F2.union }, { f: 'F3', ...FACTORS.F3.union }, { f: 'F4', ...FACTORS.F4.union }], ['S3', 'M12', 'M13', 'M11', 'M4']),
];
// The sum of every token option's high end, counted as if none overlapped.
const naiveSum = r1(OPTIONS.filter((o) => o.hi > 0 && o.factor !== 'F5').reduce((p, o) => p + o.hi, 0));
// cost-mix v2 §Findings: the bound with credentials held and everything else cut by a factor.
const BOUND = { creditHeld: { x3: 2.5, x10: 5.3, ceiling: 10.3 }, creditAndFleetHeld: { ceiling: 2.7, ceilingWithoutRulings: 3.7 }, options1to4: '1.7–1.8' };
const twoX = STACKS.filter((s) => s.multiple.hi >= 2).map((s) => s.name);

// ---- The expedition's archive, from git ----------------------------------------------------------------------------------------
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const anchor = readFileSync('docs/steady-base.md', 'utf8');
const evidence = anchor.slice(anchor.indexOf('## The evidence'), anchor.indexOf('## Decisions'));
const docs = [...new Set([...evidence.matchAll(/\]\(papers\/harbour\/([a-z0-9-]+)\.md\)/g)].map((m) => m[1]))]
  .filter((s) => !evidence.split('\n').find((l) => l.startsWith('| Earlier:') && l.includes(`(papers/harbour/${s}.md)`)));
const docRows = docs.map((slug) => {
  const t = readFileSync(`docs/papers/harbour/${slug}.md`, 'utf8');
  const fm = t.slice(0, t.indexOf('\n---', 4));
  const g = (k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '';
  return { slug, words: t.split(/\s+/).filter(Boolean).length, version: Number(g('version')) || 1, date: g('date'), check: /^survey-check|-check$/.test(slug) };
});
const scriptAdds = git('log', '--diff-filter=A', '--format=%ad', '--date=short', '--name-only', '--', 'scripts/survey-*.mjs', 'scripts/steady-base-*.mjs')
  .split('\n').filter(Boolean);
let d = null; const scripts = [];
for (const l of scriptAdds) { if (/^\d{4}-\d{2}-\d{2}$/.test(l)) d = l; else scripts.push({ path: l, added: d }); }
const sinceSep29 = scripts.filter((s) => s.added >= '2026-09-29');
const anchorCommits = git('rev-list', '--count', 'HEAD', '--', 'docs/steady-base.md');
const anchorFirst = git('log', '--diff-filter=A', '--format=%ad', '--date=short', '--', 'docs/steady-base.md');
const archive = {
  documents: docRows.length, papers: docRows.filter((r) => !r.check).length, checks: docRows.filter((r) => r.check).length,
  words: docRows.reduce((p, r) => p + r.words, 0), atVersion2OrLater: docRows.filter((r) => !r.check && r.version >= 2).length,
  // fleet-complexity-read.md carries no header; its body dates it 29 September 2026.
  dates: { first: '2026-09-29', firstWithHeader: docRows.map((r) => r.date).filter(Boolean).sort()[0], last: docRows.map((r) => r.date).filter(Boolean).sort().at(-1) },
  scripts: { all: scripts.length, sinceSep29: sinceSep29.length, sinceSep29Lines: sinceSep29.reduce((p, s) => p + (existsSync(s.path) ? readFileSync(s.path, 'utf8').split('\n').length : 0), 0) },
  anchor: { commits: Number(anchorCommits), added: anchorFirst, words: anchor.split(/\s+/).filter(Boolean).length },
  docRows,
};

const result = { generatedAt: new Date().toISOString(), head: git('rev-parse', '--short', 'HEAD'), options: OPTIONS, done: DONE, notRecommended: NOT_RECOMMENDED, factors: FACTORS, stacks: STACKS, naiveSum, bound: BOUND, reach2x: twoX, archive };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2));

console.log(`options ${OPTIONS.length} (token-sized ${OPTIONS.filter((o) => o.hi > 0 && o.factor !== 'F5').length}, hours ${OPTIONS.filter((o) => o.factor === 'F5').length}, enablers ${OPTIONS.filter((o) => o.factor === 'F6').length}); done ${DONE.length}; not recommended ${NOT_RECOMMENDED.length}`);
console.log(`naive sum of every token option's high end: ${naiveSum}% of the budget`);
for (const s of STACKS) console.log(`${s.name}: ×${s.multiple.lo}–${s.multiple.hi} (saves ${s.savedShare.lo}–${s.savedShare.hi}%; if added instead ×${s.ifAdded.lo}–${s.ifAdded.hi}; credentials held ×${s.creditHeld.lo}–${s.creditHeld.hi})`);
console.log(`reach 2× at the top of their range: ${twoX.join('; ') || 'none'}`);
console.log(`archive: ${archive.documents} documents (${archive.papers} papers, ${archive.checks} checks), ${archive.words.toLocaleString()} words, ${archive.dates.first}–${archive.dates.last}; ${archive.atVersion2OrLater} papers at v2+; scripts ${archive.scripts.all} (${archive.scripts.sinceSep29} added since 29 Sep, ${archive.scripts.sinceSep29Lines.toLocaleString()} lines); anchor ${archive.anchor.commits} commits since ${archive.anchor.added}, ${archive.anchor.words.toLocaleString()} words`);
console.log(`wrote ${out}`);
