// LIN-3151: find tickets whose main deliverable is bumping a pinned count or fixing a text pin, from the cached proxy snapshot and the git friction rows, and write the classified list into friction.json.
// Usage: node scripts/survey-tests-friction-tickets.mjs [--cache data/survey-tests/proxy] [--out data/survey-tests/friction.json] [--candidates]
// Needs survey-tests-friction-proxy.mjs `list` (and optionally `search`) and survey-tests-friction-git.mjs run first. --candidates
// prints every candidate with its matching description excerpt, for hand review. Candidates come from three sources: a title rule,
// a description rule, and the LIN-ids of merged PRs whose test changes are pin-dominated. Each candidate's class is set by hand in
// CLASS below after reading its title and description (and the PR diff where one exists); a candidate not in CLASS is 'unreviewed'.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cache = arg('--cache', 'data/survey-tests/proxy');
const out = arg('--out', 'data/survey-tests/friction.json');

const TITLE = /re-?pin|\bpin(s|ned)?\b[^.]{0,60}\b(count|literal|census|string|sentence|text)|census|count[- ]?(pin|guard)|\bbump\b|stale[^.]{0,40}\b(test|pin|literal|count|roster|fixture)|\b\d+\s*(→|->)\s*\d+\b|expectedGateCalls|inventory[- ]test|roster is stale|template count|test literal|test pins?\b|pinned test|snapshots? after|blind[^.]{0,40}\bpin\b|guard hole|re-?baseline|golden (body|bodies|file)/i;
const DESC = /(bump|re-?pin|update|move|correct)\w*[^.\n]{0,50}\b(census|count pin|pinned (count|literal|string)|test literal|hard-?coded (count|literal))|census (literal|moved|bump)|(census|count|literal)[^.\n]{0,30}\b\d+\s*(→|->|to)\s*\d+\b/i;

// Hand classification. pin-bump: the main deliverable is updating a pinned literal or count (or adding one count entry to a census).
// pin-caused: a pin forced or shaped the work but the ticket also changes behaviour or adds real coverage.
// not-pin: matched a rule by vocabulary only (pinned headers, census as a product feature, dependency bumps, new pins as coverage).
export const CLASS = {
  // pin-bump. The note's first word is the subtype: count (a pinned literal or count moves), census (a census's file list or rows
  // widened), repair (a blind or phrase-locked pin rewritten), prose (a hand-written count in docs or comments corrected), snapshot.
  'LIN-687': ['pin-bump', 'prose: stale corrective/advisory counts in the periodicals header comment'],
  'LIN-1033': ['pin-bump', 'snapshot: re-baseline tests/visual snapshots after a header change'],
  'LIN-1520': ['pin-bump', 'census: destroy-path census is file-scoped, count six not five'],
  'LIN-1547': ['pin-bump', 'repair: pin wiring args in a regression witness + comment-safe guard grep (PR #996, tests only)'],
  'LIN-1919': ['pin-bump', 'census: widen the Linear-egress census file list to routes/dashboard.js'],
  'LIN-2164': ['pin-bump', 'repair: blind 30-day TTL pin made a value pin + wiring pin'],
  'LIN-2315': ['pin-bump', 'repair: phrase-locked prompt guards rewritten field-scoped (PR #1260, tests only)'],
  'LIN-2557': ['pin-bump', 'census: rateLimit( census file list misses extracted sub-routers'],
  'LIN-2593': ['pin-bump', 'census: two Linear-egress census file lists miss extracted sub-routers'],
  'LIN-2903': ['pin-bump', 'repair: CLAUDE.md anchor resolver made content-checking (SD PR #241, tests only)'],
  'LIN-2985': ['pin-bump', 'count: add one file\'s checkFreeTierGate count to expectedGateCalls (PR #1542, 1 test line)'],
  'LIN-2988': ['pin-bump', 'count: pin flight-companion.js at 2 (canceled, superseded by LIN-2989)'],
  'LIN-2989': ['pin-bump', 'count: pin flight-companion.js checkFreeTierGate count (2) + exhaustiveness check (PR #1564, tests only)'],
  'LIN-3031': ['pin-bump', 'census: endpoint-inventory witness misses the 3 proxy-rulings URL forms (71 -> 74)'],
  'LIN-3115': ['pin-bump', 'prose: stale "14" prompt-template count in landing copy and executive summary; widen the guard'],
  'LIN-3133': ['pin-bump', 'count: inert DI prep whose measurable effect is the DI census +2 deps, split out so a later PR does not carry the bump (PR #1607, prod 8 lines)'],
  'LIN-1614': ['pin-bump', 'snapshot: re-baseline the /kpis visual snapshot after a headline landed'],
  'LIN-2481': ['pin-bump', 'prose: CLAUDE.md instance-key roster says two families, is three'],
  // pin-caused: real change, and a pin had to move with it (or shaped the plan).
  'LIN-308': ['pin-caused', 'read endpoints onto providers; shape-parity and source-scan pins moved'],
  'LIN-311': ['pin-caused', 'prompt/playbook text change; text pins moved with it'],
  'LIN-369': ['pin-caused', 'new periodical; registry count assertion 5 -> 6'],
  'LIN-370': ['pin-caused', 'new periodical; count 6 -> 7'],
  'LIN-371': ['pin-caused', 'new periodical; count 8 -> 9'],
  'LIN-420': ['pin-caused', 'errors helper adoption (712 prod lines); one text pin moved'],
  'LIN-430': ['pin-caused', 'prompt text change; one text pin moved'],
  'LIN-520': ['pin-caused', 'new periodical; count 10 -> 11'],
  'LIN-526': ['pin-caused', 'new template would bump template count 14 -> 15 (canceled)'],
  'LIN-542': ['pin-caused', 'new periodical; count 9 -> 10'],
  'LIN-548': ['pin-caused', 'prompt text change; one text pin moved'],
  'LIN-579': ['pin-caused', 'framing strings neutralised; text pins moved'],
  'LIN-580': ['pin-caused', 'remove linear-cli.js; source-scan pins updated'],
  'LIN-856': ['pin-caused', 'theme migration; markup text pins moved'],
  'LIN-919': ['pin-caused', 'brand wordmark gains .cat; one text pin moved (PR #835)'],
  'LIN-1038': ['pin-caused', 'new periodical; count 11 -> 12'],
  'LIN-1039': ['pin-caused', 'new periodical; count 11 -> 12'],
  'LIN-1110': ['pin-caused', 'prompt change with a drift guard over two messages'],
  'LIN-1116': ['pin-caused', 'landing hero wordmark; one text pin moved (PR #853)'],
  'LIN-1203': ['pin-caused', 'timeout removal; parity-test file edited'],
  'LIN-1332': ['pin-caused', 'identity refactor; census/source-scan pins moved'],
  'LIN-1336': ['pin-caused', 'new periodical; count 13 -> 14'],
  'LIN-1362': ['pin-caused', 'preamble text removed; text pins moved'],
  'LIN-1495': ['pin-caused', 'BUILDER_VERSION 4 -> 5 edits a version pin in a test'],
  'LIN-1545': ['pin-caused', 'credential delete hardening + census'],
  'LIN-1596': ['pin-caused', 'KPI headline; e2e card/chart counts 11 -> 12, 9 -> 10'],
  'LIN-1602': ['pin-caused', 'new prompt template; three files pin the template count'],
  'LIN-1689': ['pin-caused', 'new periodical; count 14 -> 15'],
  'LIN-1766': ['pin-caused', 'usage parser + BUILDER_VERSION 5 -> 6 pin'],
  'LIN-1789': ['pin-caused', 'feedback vocabulary + v7 bump pin'],
  'LIN-1892': ['pin-caused', 'email auth; index test count 4 -> 5'],
  'LIN-2044': ['pin-caused', 'provider routing fix; three pinning/census tests updated'],
  'LIN-2182': ['pin-caused', 'loop derivation + BUILDER_VERSION 8 -> 9 pin'],
  'LIN-2261': ['pin-caused', 'new prompt template; template-count pins moved'],
  'LIN-2311': ['pin-caused', 'prompt text change; text pins moved (PR #1256)'],
  'LIN-2322': ['pin-caused', 'label routes; endpoint inventory 67 -> 68 + per-file breakdown'],
  'LIN-2360': ['pin-caused', 'proxy split plan; alias/consumer counts corrected (canceled)'],
  'LIN-2534': ['pin-caused', 'LIN-679 extraction; route-count guards re-based 53 -> 48'],
  'LIN-2535': ['pin-caused', 'LIN-679 extraction; route-count guards 48 -> 47'],
  'LIN-2537': ['pin-caused', 'LIN-679 extraction; count guards moved (PR #1373)'],
  'LIN-2539': ['pin-caused', 'LIN-679 extraction; pin migration section (PR #1378)'],
  'LIN-2540': ['pin-caused', 'LIN-679 extraction; count guards moved (PR #1379)'],
  'LIN-2601': ['pin-caused', 'umbrella for census/witness hygiene exposed by the proxy split (no own deliverable)'],
  'LIN-2648': ['pin-caused', 'ledger projection + BASIS_VERSION bump pin'],
  'LIN-2683': ['pin-caused', 'stale caption; two test pins lock the stale text'],
  'LIN-2923': ['pin-caused', 'close-out template claim corrected; pins moved (PR #1505)'],
  'LIN-2966': ['pin-caused', 'chat turn-core consolidation; source-scan pins moved'],
  'LIN-2968': ['pin-caused', 'rename of the agent-turn core; source-scan pins dominate the test diff (PR #1531)'],
  'LIN-2969': ['pin-caused', 'SSE reader consolidation; source-scan pins moved (PR #1534)'],
  'LIN-2970': ['pin-caused', 'chat-request preamble; source-scan pins moved'],
  'LIN-2978': ['pin-caused', 'chat-request adoption at six sites; gate census moved (PR #1540)'],
  'LIN-3025': ['pin-caused', 'halt endpoints; endpoint inventory 68 -> 71'],
  'LIN-3034': ['pin-caused', 'withdrawal derivation + BUILDER_VERSION pin'],
  'LIN-3059': ['pin-caused', 'agent credential; DI census 137 -> 145 deps, inventory 71 -> 74'],
  'LIN-3074': ['pin-caused', 'halt copy + runbook; pinned test moves with the copy'],
  'LIN-3098': ['pin-caused', 'runner prompt route; inventory 74 -> 75'],
  'LIN-3134': ['pin-caused', 'declared-mint mechanism (inert) + censuses'],
  'LIN-3135': ['pin-caused', 'broker re-declare; census mutation tests'],
  'LIN-3138': ['pin-caused', 'declared-mint mechanism, no callers; factory pins, golden, censuses'],
  'LIN-3139': ['pin-caused', 'callers + wake census'],
  'LIN-2884': ['pin-caused', 'parent of the T1/T2 slices; census literals planned per slice'],
  // not-pin: vocabulary match only, or a new pin written as coverage (not maintenance).
  'LIN-312': ['not-pin', 'parity validation of an API, not a test pin'],
  'LIN-688': ['not-pin', 'dependency bump'],
  'LIN-904': ['not-pin', 'phase enum 13 -> 8 (product change)'],
  'LIN-912': ['not-pin', 'phase enum 13 -> 8 (product change)'],
  'LIN-1366': ['not-pin', 'proxy token owner scoping'],
  'LIN-1389': ['not-pin', 'new pin as coverage'],
  'LIN-1492': ['not-pin', 'new test proving a query clamp'],
  'LIN-1493': ['not-pin', 'duplicate of LIN-1492'],
  'LIN-1551': ['not-pin', 'post-deploy watch'],
  'LIN-1653': ['not-pin', 'new count guard as coverage'],
  'LIN-1700': ['not-pin', 'hook sentinel bug'],
  'LIN-1804': ['not-pin', 'new pin as coverage'],
  'LIN-1844': ['not-pin', 'witness run'],
  'LIN-1855': ['not-pin', 'corrects a figure in a ticket description (tracker text only)'],
  'LIN-1864': ['not-pin', 'new parity pin as coverage'],
  'LIN-1901': ['not-pin', 'stale fixture masking a real gap (behaviour tests)'],
  'LIN-2279': ['not-pin', 'new pin as coverage'],
  'LIN-2302': ['not-pin', 'five shipped-prose false claims, one a count'],
  'LIN-2319': ['not-pin', 'false rationale comment in a test'],
  'LIN-2380': ['not-pin', 'review report count corrections'],
  'LIN-2405': ['not-pin', 'behaviour fix with its own test update'],
  'LIN-2408': ['not-pin', 'census is a product feature (fleet census)'],
  'LIN-2409': ['not-pin', 'census is a product feature'],
  'LIN-2438': ['not-pin', 'census is a product feature'],
  'LIN-2442': ['not-pin', 'census is a product feature'],
  'LIN-2449': ['not-pin', 'census is a product feature'],
  'LIN-2487': ['not-pin', 'census is a product feature'],
  'LIN-2543': ['not-pin', 'new shared DI-witness helper (coverage) (PR #1377, tests only)'],
  'LIN-2617': ['not-pin', 'census is a product feature'],
  'LIN-2619': ['not-pin', 'census is a product feature (PR #1400)'],
  'LIN-2646': ['not-pin', 'census is a product feature'],
  'LIN-2655': ['not-pin', 'census is a product feature'],
  'LIN-2669': ['not-pin', 'census is a product feature'],
  'LIN-2671': ['not-pin', 'census is a product feature'],
  'LIN-2685': ['not-pin', 'census is a product feature'],
  'LIN-2750': ['not-pin', 'SD disclosures and CI gate'],
  'LIN-2780': ['not-pin', 'new text pin as coverage'],
  'LIN-2799': ['not-pin', 'new pin as coverage'],
  'LIN-2977': ['not-pin', 'new text pin as coverage'],
  'LIN-3105': ['not-pin', 'review report count corrections'],
};

const issues = JSON.parse(readFileSync(join(cache, 'issues.json'), 'utf8'));
const search = existsSync(join(cache, 'search.json')) ? JSON.parse(readFileSync(join(cache, 'search.json'), 'utf8')) : {};
const friction = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { prs: [] };
const num = (id) => +id.slice(4);

// PRs whose test side is pin-dominated: pin edits > 50% of test lines, or tests only pin edits with production <= 50 lines,
// or a numeric literal edited in an assertion with production <= 20 lines.
const flaggedPRs = (friction.prs || []).filter((p) => (p.pinOnlyTests && p.lines.prod <= 50) || p.pinShareOfTest > 0.5 || (p.test.numberAssert > 0 && p.lines.prod <= 20));
const fromGit = new Map();
for (const p of flaggedPRs) for (const id of p.ids.slice(0, 1)) (fromGit.get(id) || fromGit.set(id, []).get(id)).push(`${p.repo}#${p.pr}`);
const searched = new Set(Object.values(search).flat().map((i) => i.identifier));

const byId = new Map(issues.map((i) => [i.identifier, i]));
const candidates = [];
for (const i of issues) {
  const why = [];
  if (TITLE.test(i.title)) why.push('title');
  if (DESC.test(i.description || '')) why.push('description');
  if (fromGit.has(i.identifier)) why.push(`git ${fromGit.get(i.identifier).join(',')}`);
  if (why.length) candidates.push({ id: i.identifier, title: i.title, state: i.state?.name, why, inSearch: searched.has(i.identifier), class: CLASS[i.identifier]?.[0] || 'unreviewed', note: CLASS[i.identifier]?.[1] || null });
}
for (const id of fromGit.keys()) if (!byId.has(id)) candidates.push({ id, title: null, state: 'not in snapshot', why: [`git ${fromGit.get(id).join(',')}`], class: CLASS[id]?.[0] || 'unreviewed', note: CLASS[id]?.[1] || null });
candidates.sort((a, b) => num(a.id) - num(b.id));

if (process.argv.includes('--candidates')) {
  for (const c of candidates) {
    const d = byId.get(c.id)?.description || '';
    const m = d.match(DESC); const at = m ? Math.max(0, m.index - 120) : 0;
    console.log(`\n${c.id} [${c.state}] (${c.why.join('; ')}) ${c.class}\n  ${c.title}\n  ${d.slice(at, at + 360).replace(/\s+/g, ' ')}`);
  }
}

// Population: every ticket in the snapshot, and those numbered at or after the first ticket of the window (--first, default LIN-304:
// the highest LIN-id named in either repo's history before 2026-06-01 is LIN-303).
const first = num(arg('--first', 'LIN-304'));
const inWindow = issues.filter((i) => num(i.identifier) >= first);
const count = (arr, k) => arr.filter((c) => c.class === k).length;
const inW = candidates.filter((c) => num(c.id) >= first);
const tickets = {
  generatedAt: new Date().toISOString(), population: { snapshot: issues.length, fromFirstId: inWindow.length, firstId: `LIN-${first}`, completedFromFirstId: inWindow.filter((i) => i.state?.type === 'completed').length },
  searchTerms: Object.keys(search), candidates: candidates.length,
  counts: Object.fromEntries(['pin-bump', 'pin-caused', 'not-pin', 'unreviewed'].map((k) => [k, { all: count(candidates, k), fromFirstId: count(inW, k) }])),
  list: candidates,
};
writeFileSync(out, JSON.stringify({ ...friction, tickets }, null, 1));
console.log(JSON.stringify({ ...tickets, list: undefined }, null, 1));
