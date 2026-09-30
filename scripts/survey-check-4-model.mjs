// LIN-3171: the independent check of model-choice.md (LIN-3165). Re-derives its load-bearing figures from the git-ignored snapshots
// and tests them three ways: (1) a full dispatch count, following each follow-up to the root of its followUpTo chain as
// what-doubled-the-dispatches.md (LIN-3170) does, in place of model-choice's count of dispatches whose own log block names the
// ticket; (2) the implementer tier read from the runner's own implementation launches, in place of the Co-Authored-By trailer
// majority; (3) what kind of work the frontier-implemented changes of 13 July–30 August were. No proxy calls.
// Usage: node scripts/survey-check-4-model.mjs [dispatches|tier|selection|arith|all]   (default: all)
//        node scripts/survey-check-4-model.mjs variant <dir> [--rule full|root]   (inputs for re-running survey-model-analyse.mjs; see below)
// Reads (run from the repo root; the survey scripts write them):
//   data/survey-model/{analysis,runner,git}.json   survey-model-{git,runner,analyse}.mjs (LIN-3165)
//   data/survey-doubling/{runner,transcripts}.json  survey-doubling-{runner,transcripts}.mjs (LIN-3170): followUpTo roots, prompt lengths
//   data/survey/reliability-tracker.json            titles and parents
// Runner implementation tier: the payload tier of the ticket's fresh implementation sessions, the kind read exactly from a transcript
// (29 August on) or decoded from the logged bootstrap prompt length (survey-doubling-analyse.mjs's decoder, copied here because
// importing that script runs it). Kinds cannot be read before 16 July, so changes whose sessions all predate that have none.
import { readFileSync } from 'fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const mode = process.argv[2] || 'all';
const A = read('data/survey-model/analysis.json');
const mc = read('data/survey-model/runner.json').rows;
const dblRows = read('data/survey-doubling/runner.json').rows;
const tx = read('data/survey-doubling/transcripts.json').items;
const tracker = read('data/survey/reliability-tracker.json');
const gitRows = new Map(read('data/survey-model/git.json').rows.map((r) => [r.id, r]));
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const f = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const TIERS = ['frontier', 'mid', 'cheap'];
const tierOf = (m) => (!m ? 'unstated' : /opus|fable/i.test(m) ? 'frontier' : /sonnet/i.test(m) ? 'mid' : 'cheap');

// ---- Own dispatches and hours per ticket, three ways. 'mc': model-choice's (the dispatch's own Issue line). 'full': the same items
// and hours, a follow-up with no Issue line credited to its followUpTo root's ticket. 'root': one rule for every period, a follow-up
// always charged to the ticket of the session it entered (its root's Issue line), its own Issue line ignored. From 13 September
// (LIN-2121) a wake's own Issue line names the triggering child, not the session it enters, so 'mc' and 'full' charge a wake into an
// epic autopilot or passage Runner to a child change only from that date. Hours: model-choice's per-dispatch share.
const dbl = new Map(dblRows.map((r) => [r.item, r]));
const rootTicket = (d) => { const x = dbl.get(d.item); if (!x) return d.issue; if (x.shape === 'fresh' || x.root === x.item) return x.issueLine || d.issue; return dbl.get(x.root)?.issueLine || null; };
const own = { mc: new Map(), full: new Map(), root: new Map() };
const add = (m, k, d) => { if (!k) return; const o = m.get(k) || { n: 0, h: 0, timed: 0 }; o.n++; if (d.workH != null) { o.h += d.workH; o.timed++; } m.set(k, o); };
for (const d of mc) { add(own.mc, d.issue, d); add(own.full, d.issue || dbl.get(d.item)?.issue, d); add(own.root, rootTicket(d), d); }
const RULE = process.argv.includes('--rule') ? process.argv[process.argv.indexOf('--rule') + 1] : 'full'; // for `variant`: full | root

// ---- Runner implementation tier per ticket.
const items = dblRows.filter((r) => ['fresh', 'cold', 'warm'].includes(r.shape));
const takesFollowUp = new Set(items.filter((r) => r.shape !== 'fresh').map((r) => r.root));
const LEN = { 3: 'bug', 4: 'plan', 6: 'review', 7: 'blocked', 8: 'research', 9: 'autopilot|close-out', 11: 'plan-review', 14: 'implementation' };
function decode(r) {
  if (r.promptLen == null || r.promptLen > 2000) return null;
  const res = r.promptLen - (r.issueLine ? r.issueLine.length : 0);
  if (!r.issueLine) return res === 385 ? 'other' : null;
  for (const base of [524, 392, 292]) { const k = LEN[res - base]; if (!k) continue; if (base === 524 && !['plan', 'research', 'implementation'].includes(k)) continue; return k === 'autopilot|close-out' ? (takesFollowUp.has(r.item) ? 'autopilot' : 'close-out') : k; }
  return null;
}
const sessionsOf = new Map();
for (const r of items) if (r.shape === 'fresh' && r.issue) {
  let k = tx[r.item]?.kind || decode(r) || (r.harness === 'opencode' ? 'cheap harness, kind unread' : 'kind unread'); if (k === 'implement') k = 'implementation';
  (sessionsOf.get(r.issue) || sessionsOf.set(r.issue, []).get(r.issue)).push({ kind: k, tier: tierOf(r.model || r.launchModel), at: r.at, exact: !!tx[r.item] });
}
for (const v of sessionsOf.values()) v.sort((a, b) => a.at.localeCompare(b.at));
const runnerTier = (id) => {
  const impl = (sessionsOf.get(id) || []).filter((s) => s.kind === 'implementation' && s.tier !== 'unstated');
  if (!impl.length) return null;
  const n = Object.fromEntries(TIERS.map((t) => [t, impl.filter((s) => s.tier === t).length]));
  const top = Object.entries(n).sort((a, b) => b[1] - a[1]);
  return top[0][1] === top[1][1] ? 'mixed' : top[0][0];
};

const changes = A.changes;
const scored = changes.filter((c) => c.scored && c.prodLines > 0);
const inP = (c, a, z) => c.week >= a && c.week < z;
const CHOSEN = ['2026-07-13', '2026-08-31']; const SEPT = ['2026-08-31', '2026-10-01'];
const REW = new Set(['escaped bug', 'named fix']); const CEIL = new Set(['escaped bug', 'named fix', 'same-file fix']);

// Cost table as survey-model-analyse.mjs's costTable, with the own-cost map switchable (rework re-priced with the same map).
function table(cs, m) {
  const O = own[m]; const g = (xs) => xs.filter((c) => c.good).length;
  const withD = cs.filter((c) => O.has(c.id)); const timed = cs.filter((c) => O.get(c.id)?.timed);
  const rw = (c, set) => sum(c.events.filter((e) => set.has(e.kind) && e.day <= 30).map((e) => (O.get(e.fixer)?.timed ? O.get(e.fixer).h : 0) * e.share));
  const gt = g(timed);
  return { n: cs.length, good: g(cs), goodShare: cs.length ? g(cs) / cs.length : null, esc: cs.filter((c) => c.escStrict).length,
    dpg: g(withD) ? sum(withD.map((c) => O.get(c.id).n)) / g(withD) : null, hpg: gt ? sum(timed.map((c) => O.get(c.id).h)) / gt : null,
    wlF: gt ? sum(timed.map((c) => O.get(c.id).h + rw(c, REW))) / gt : null, wlC: gt ? sum(timed.map((c) => O.get(c.id).h + rw(c, CEIL))) / gt : null,
    rwF: timed.length ? sum(timed.map((c) => rw(c, REW))) / timed.length : null, rwC: timed.length ? sum(timed.map((c) => rw(c, CEIL))) / timed.length : null };
}
const row = (label, t) => console.log(`  ${label.padEnd(34)} n ${String(t.n).padStart(3)} | good ${f(t.goodShare * 100, 0)}% | strict esc ${t.esc} | disp/good ${f(t.dpg)} | own h/good ${f(t.hpg, 2)} | whole-life h/good ${f(t.wlF, 2)}–${f(t.wlC, 2)} | rework h/change ${f(t.rwF, 2)}–${f(t.rwC, 2)}`);
const fisher = (a, n1, b, n2) => { const K = a + b, N = n1 + n2; const lc = (n, k) => { let x = 0; for (let i = 0; i < k; i++) x += Math.log(n - i) - Math.log(i + 1); return x; }; let p = 0; for (let k = 0; k <= a; k++) p += Math.exp(lc(n1, k) + lc(n2, K - k) - lc(N, K)); return p; };
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [((c - h) / d) * 100, ((c + h) / d) * 100]; };

if (mode === 'dispatches' || mode === 'all') {
  console.log('== 1. Dispatches and hours per correct change: model-choice count (Issue line) against the full count (followUpTo root)');
  for (const [a, z] of [['2026-07-12', '2026-08-31'], ['2026-08-31', '2026-09-13'], ['2026-09-13', '2026-10-01']]) {
    const xs = mc.filter((d) => d.at >= a && d.at < z); const withId = xs.filter((d) => d.issue); const withRoot = xs.filter((d) => d.issue || dbl.get(d.item)?.issue);
    const H = sum(xs.map((d) => d.workH)); const Hid = sum(withId.map((d) => d.workH)); const Hroot = sum(withRoot.map((d) => d.workH));
    console.log(`  fleet ${a}..${z}: dispatches ${xs.length}, with own Issue line ${withId.length} (${f((withId.length / xs.length) * 100, 0)}%), with a ticket via root ${withRoot.length} (${f((withRoot.length / xs.length) * 100, 0)}%) | hours ${f(H, 0)}, on dispatches with own Issue line ${f(Hid, 0)} (${f((Hid / H) * 100, 0)}%), via root ${f(Hroot, 0)} (${f((Hroot / H) * 100, 0)}%) | follow-ups carrying a session (and so hours): ${xs.filter((d) => d.shape !== 'launch' && d.session).length} of ${xs.filter((d) => d.shape !== 'launch').length}`);
  }
  for (const [name, a, z] of [['default era (1 Jun–12 Jul)', '2026-06-01', '2026-07-13'], ['chosen tier (13 Jul–30 Aug)', ...CHOSEN], ['September (provisional)', ...SEPT], ['step before (29 Jun–12 Jul)', '2026-06-29', '2026-07-13'], ['step after (13–26 Jul)', '2026-07-13', '2026-07-27']]) {
    console.log(` ${name}`);
    for (const t of [...TIERS, null]) { const cs = scored.filter((c) => inP(c, a, z) && c.implementer === t); if (!cs.length) continue; row(`${t || 'tier not stated'}, model-choice count`, table(cs, 'mc')); row(`${t || 'tier not stated'}, full count`, table(cs, 'full')); row(`${t || 'tier not stated'}, root count`, table(cs, 'root')); }
  }
  const moved = mc.filter((d) => d.issue && rootTicket(d) !== d.issue && d.shape !== 'launch');
  console.log(`  follow-ups whose own Issue line names another ticket than the session they entered: ${JSON.stringify(moved.reduce((m, d) => { const k = d.at < '2026-09-13' ? 'before 13 Sep' : 'from 13 Sep'; m[k] = (m[k] || 0) + 1; return m; }, {}))}`);
}

// Implementer under the alternative rule: lineage where it exists (as the paper), else the runner's implementation tier, else trailer.
for (const c of changes) { c.runnerTier = runnerTier(c.id); c.alt = c.lineageTier || (c.runnerTier && c.runnerTier !== 'mixed' ? c.runnerTier : null) || (c.writerTier === 'unattributed' ? null : c.writerTier); }

if (mode === 'tier' || mode === 'all') {
  console.log('\n== 2. Tier attribution');
  const sept = changes.filter((c) => c.lineageTier && c.runnerTier);
  console.log(`  decoder check, changes with both a lineage tier and a runner implementation tier: agree ${sept.filter((c) => c.lineageTier === c.runnerTier).length} of ${sept.length}`);
  const lt = changes.filter((c) => c.lineageTier && c.writerTier !== 'unattributed');
  console.log(`  lineage vs trailer (paper's 137 of 178): agree ${lt.filter((c) => c.lineageTier === c.writerTier).length} of ${lt.length}; disagreements ${JSON.stringify(lt.filter((c) => c.lineageTier !== c.writerTier).reduce((m, c) => ((m[`lineage ${c.lineageTier}/trailer ${c.writerTier}`] = (m[`lineage ${c.lineageTier}/trailer ${c.writerTier}`] || 0) + 1), m), {}))}`);
  const noLin = changes.filter((c) => !c.lineageTier); const rOnly = noLin.filter((c) => c.runnerTier && c.runnerTier !== 'mixed');
  console.log(`  all ${changes.length} changes since June: lineage tier ${changes.length - noLin.length}; else a single runner implementation tier ${rOnly.length} (differs from the trailer's ${rOnly.filter((c) => c.runnerTier !== c.writerTier).length}); else trailer ${noLin.filter((c) => !(c.runnerTier && c.runnerTier !== 'mixed') && c.writerTier !== 'unattributed').length}; neither ${changes.filter((c) => !c.alt).length}`);
  const ch = scored.filter((c) => inP(c, ...CHOSEN));
  console.log(`  13 Jul–30 Aug code changes: implementer from ${JSON.stringify(ch.reduce((m, c) => ((m[c.implementerFrom || 'none'] = (m[c.implementerFrom || 'none'] || 0) + 1), m), {}))}`);
  const x = {}; for (const c of ch) { const k = `paper ${c.implementer || 'not stated'} → runner ${c.runnerTier || 'no implementation launch read'}`; x[k] = (x[k] || 0) + 1; }
  for (const [k, v] of Object.entries(x).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`);
  const withBoth = ch.filter((c) => c.implementer && c.runnerTier && c.runnerTier !== 'mixed');
  console.log(`  trailer vs runner, where both are single-tier: agree ${withBoth.filter((c) => c.implementer === c.runnerTier).length} of ${withBoth.length}; trailer frontier → runner mid ${withBoth.filter((c) => c.implementer === 'frontier' && c.runnerTier === 'mid').length} of ${withBoth.filter((c) => c.implementer === 'frontier').length}; trailer mid → runner frontier ${withBoth.filter((c) => c.implementer === 'mid' && c.runnerTier === 'frontier').length} of ${withBoth.filter((c) => c.implementer === 'mid').length}`);
  console.log(' 13 Jul–30 Aug, implementer = lineage, else runner implementation tier, else trailer:');
  for (const t of [...TIERS, null]) { const cs = ch.filter((c) => c.alt === t); if (!cs.length) continue; row(`${t || 'tier not stated'}, model-choice count`, table(cs, 'mc')); row(`${t || 'tier not stated'}, full count`, table(cs, 'full')); row(`${t || 'tier not stated'}, root count`, table(cs, 'root')); }
  console.log(' September (provisional), alternative rule:');
  for (const t of TIERS) { const cs = scored.filter((c) => inP(c, ...SEPT) && c.alt === t); for (const m of ['mc', 'full', 'root']) row(`${t}, ${m} count`, table(cs, m)); }
  const fr = ch.filter((c) => c.alt === 'frontier'), md = ch.filter((c) => c.alt === 'mid');
  console.log(`  strict escapes frontier ${fr.filter((c) => c.escStrict).length} of ${fr.length}, mid ${md.filter((c) => c.escStrict).length} of ${md.length}; one-sided Fisher p ${f(fisher(fr.filter((c) => c.escStrict).length, fr.length, md.filter((c) => c.escStrict).length, md.length), 3)}`);
  console.log(' Only changes the runner shows implemented at a single tier (no trailer fallback):');
  for (const t of ['frontier', 'mid']) { const cs = ch.filter((c) => c.runnerTier === t); row(`${t}, full count`, table(cs, 'full')); }
  // The LIN-3155 re-count on its own weeks (13 July–21 September, all scored changes), by trailer and by the alternative rule.
  const later = changes.filter((c) => c.scored && c.week >= '2026-07-13' && c.week <= '2026-09-21');
  for (const [label, key] of [['trailer (paper)', 'writerTier'], ['lineage, else runner, else trailer', 'alt']]) {
    const g = (t) => later.filter((c) => (key === 'alt' ? c.alt === t : c.writerTier === t));
    const a = g('frontier'), b = g('mid'); const ea = a.filter((c) => c.escStrict).length, eb = b.filter((c) => c.escStrict).length;
    console.log(`  13 Jul–21 Sep strict escapes by ${label}: frontier ${ea} of ${a.length} (${f((ea / a.length) * 100)}%, 95% ${wilson(ea, a.length).map((v) => f(Math.max(v, 0))).join('–')}), mid ${eb} of ${b.length} (${f((eb / b.length) * 100)}%, 95% ${wilson(eb, b.length).map((v) => f(v)).join('–')}); Fisher p ${f(fisher(ea, a.length, eb, b.length), 4)}`);
  }
  // Ties: the trailer rule's sort puts frontier first, so a change with as many frontier as mid trailers is frontier.
  const tie = (c) => { const w = gitRows.get(c.id)?.writer; return w && w.frontier > 0 && w.frontier === w.mid; };
  console.log(`  trailer ties (frontier = mid commits) resolved to frontier: 13 Jul–30 Aug ${ch.filter((c) => c.implementer === 'frontier' && tie(c)).length} of ${ch.filter((c) => c.implementer === 'frontier').length}; 13 Jul–21 Sep ${later.filter((c) => c.writerTier === 'frontier' && tie(c)).length} of ${later.filter((c) => c.writerTier === 'frontier').length}`);
  // The 12 July step's after-fortnight under the alternative rule (before 16 July no kind can be read, so the before-fortnight stays as the paper has it).
  console.log(' 13–26 Jul (the step\'s after-fortnight), alternative rule:');
  for (const t of ['frontier', 'mid']) row(`${t}, full count`, table(scored.filter((c) => inP(c, '2026-07-13', '2026-07-27') && c.alt === t), 'full'));
  const sp = scored.filter((c) => inP(c, ...SEPT)); console.log(`  September code changes: implementer from ${JSON.stringify(sp.reduce((m, c) => ((m[c.implementerFrom || 'none'] = (m[c.implementerFrom || 'none'] || 0) + 1), m), {}))}`);
  // Bootstrap: frontier/mid ratio of whole-life ceiling hours per correct change, resampling changes within each tier (2,000 draws, fixed seed).
  let seed = 3171; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const boot = (fr, md, m) => { const O = own[m]; const wl = (cs) => { const tm = cs.filter((c) => O.get(c.id)?.timed); const g = tm.filter((c) => c.good).length; return g ? sum(tm.map((c) => O.get(c.id).h + sum(c.events.filter((e) => CEIL.has(e.kind) && e.day <= 30).map((e) => (O.get(e.fixer)?.timed ? O.get(e.fixer).h : 0) * e.share)))) / g : NaN; };
    const rs = []; for (let i = 0; i < 2000; i++) { const s = (xs) => xs.map(() => xs[Math.floor(rnd() * xs.length)]); rs.push(wl(s(fr)) / wl(s(md))); } rs.sort((a, b) => a - b); return [wl(fr) / wl(md), rs[50], rs[1949]]; };
  for (const [label, key, m, a, z] of [['paper assignment, model-choice count', 'implementer', 'mc', ...CHOSEN], ['paper assignment, full count', 'implementer', 'full', ...CHOSEN], ['alternative rule, full count', 'alt', 'full', ...CHOSEN], ['runner tier only, merge weeks 20 Jul–2 Aug, full count', 'runnerTier', 'full', '2026-07-20', '2026-08-03']]) {
    const cs = scored.filter((c) => inP(c, a, z)); const [r, lo, hi] = boot(cs.filter((c) => c[key] === 'frontier'), cs.filter((c) => c[key] === 'mid'), m);
    console.log(`  whole-life ceiling h per correct change, frontier/mid, ${label}: ${f(r, 2)} (bootstrap 95% ${f(lo, 2)}–${f(hi, 2)})`);
  }
  // Hand-check list: every trailer-frontier change the runner shows implemented at mid.
  console.log('  trailer frontier, runner mid (13 Jul–30 Aug):', ch.filter((c) => c.implementer === 'frontier' && c.runnerTier === 'mid').map((c) => c.id).join(' '));
}

if (mode === 'selection' || mode === 'all') {
  console.log('\n== 3. What the frontier-implemented changes of 13 Jul–30 Aug were (paper\'s assignment)');
  const listById = new Map(tracker.list.map((t) => [t.identifier, t]));
  const children = new Map(); for (const t of tracker.list) if (t.parent) children.set(t.parent, (children.get(t.parent) || 0) + 1);
  const ch = scored.filter((c) => inP(c, ...CHOSEN));
  const cls = (c) => {
    const ss = sessionsOf.get(c.id) || []; const impl = ss.filter((s) => s.kind === 'implementation');
    const firstFrontierImpl = impl.find((s) => s.tier === 'frontier');
    const earlierLower = firstFrontierImpl && impl.some((s) => s.at < firstFrontierImpl.at && s.tier !== 'frontier');
    const title = listById.get(c.id)?.title || '';
    return {
      runner: c.runnerTier || (ss.length ? 'no implementation launch read' : 'no fresh session with this ticket'),
      rescue: !!earlierLower, autopilot: ss.some((s) => s.kind === 'autopilot'), parent: (children.get(c.id) || 0) > 0,
      paperish: /\b(paper|survey|research|study|audit)\b/i.test(title), docsHeavy: (gitRows.get(c.id)?.docLines || 0) > c.prodLines,
      preKinds: ss.length > 0 && ss.every((s) => s.at < '2026-07-16'), title,
    };
  };
  for (const t of ['frontier', 'mid']) {
    const cs = ch.filter((c) => c.implementer === t).map((c) => ({ c, k: cls(c) }));
    const cnt = (p) => cs.filter(({ k }) => p(k)).length;
    console.log(`  ${t} (n ${cs.length}): runner implementation tier ${JSON.stringify(cs.reduce((m, { k }) => ((m[k.runner] = (m[k.runner] || 0) + 1), m), {}))}`);
    console.log(`    rescue (frontier implementation after a lower-tier one) ${cnt((k) => k.rescue)} | an autopilot session on the ticket ${cnt((k) => k.autopilot)} | parent ticket ${cnt((k) => k.parent)} | paper/survey/research-worded title ${cnt((k) => k.paperish)} | more doc lines than production lines ${cnt((k) => k.docsHeavy)} | all sessions before kinds are readable (16 Jul) ${cnt((k) => k.preKinds)}`);
    if (t === 'frontier') for (const grp of ['no implementation launch read', 'no fresh session with this ticket']) { const g = cs.filter(({ k }) => k.runner === grp); if (g.length) console.log(`    ${grp}: ${g.map(({ c, k }) => `${c.id} "${k.title.slice(0, 50)}"`).join('; ')}`); }
  }
  const frClean = ch.filter((c) => c.implementer === 'frontier' && c.runnerTier === 'frontier');
  const frOther = ch.filter((c) => c.implementer === 'frontier' && c.runnerTier !== 'frontier');
  row('paper-frontier, runner frontier', table(frClean, 'full')); row('paper-frontier, runner not frontier', table(frOther, 'full'));
  row('paper-mid', table(ch.filter((c) => c.implementer === 'mid'), 'full'));
  // When the runner launched implementation sessions at each tier: fresh implementation launches by week of launch.
  const wk = {}; for (const v of sessionsOf.values()) for (const s of v) if (s.kind === 'implementation' && s.at >= '2026-07-13' && s.at < '2026-08-31') { const d = s.at.slice(0, 10); const k = d < '2026-07-23' ? '16–22 Jul' : d < '2026-07-28' ? '23–27 Jul' : d < '2026-08-07' ? '28 Jul–6 Aug' : '7–30 Aug'; ((wk[k] ||= {})[s.tier] = (wk[k][s.tier] || 0) + 1); }
  console.log('  implementation launches by tier:', JSON.stringify(wk));
  const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const rf = ch.filter((c) => c.runnerTier === 'frontier'), rm = ch.filter((c) => c.runnerTier === 'mid');
  console.log(`  runner-frontier changes by merge week ${JSON.stringify(rf.reduce((m, c) => ((m[c.week] = (m[c.week] || 0) + 1), m), {}))}; median production lines runner-frontier ${med(rf.map((c) => c.prodLines))}, runner-mid ${med(rm.map((c) => c.prodLines))}; high-risk ${f((rf.filter((c) => c.risk === 'high').length / rf.length) * 100, 0)}% vs ${f((rm.filter((c) => c.risk === 'high').length / rm.length) * 100, 0)}%`);
  console.log(' Same merge weeks (20 Jul–2 Aug), runner implementation tier:');
  for (const t of ['frontier', 'mid']) row(`${t}, full count`, table(ch.filter((c) => inP(c, '2026-07-20', '2026-08-03') && c.runnerTier === t), 'full'));
}

// variant: write model-choice's own inputs with the two corrections applied, so the unchanged survey-model-analyse.mjs can re-run on
// them: runner.json with each follow-up credited to its root's ticket, git.json with writerTier replaced by the runner implementation
// tier where one is read (the analyser still prefers lineage). Then: cd <dir> && node <repo>/scripts/survey-model-analyse.mjs
if (mode === 'variant') {
  const { mkdirSync, writeFileSync, symlinkSync, existsSync } = await import('fs');
  const { resolve, join } = await import('path');
  const dir = resolve(process.argv[3] || 'data/survey-check-4/variant');
  mkdirSync(join(dir, 'data/survey-model'), { recursive: true }); mkdirSync(join(dir, 'docs/papers/harbour'), { recursive: true });
  const r = read('data/survey-model/runner.json'); r.rows = r.rows.map((d) => ({ ...d, issue: RULE === 'root' ? rootTicket(d) : d.issue || dbl.get(d.item)?.issue || null }));
  writeFileSync(join(dir, 'data/survey-model/runner.json'), JSON.stringify(r));
  const g = read('data/survey-model/git.json'); let moved = 0;
  g.rows = g.rows.map((x) => { const t = runnerTier(x.id); if (t && t !== 'mixed' && t !== x.writerTier) { moved++; return { ...x, writerTier: t }; } return x; });
  writeFileSync(join(dir, 'data/survey-model/git.json'), JSON.stringify(g));
  for (const [src, dst] of [['data/survey-model/cost.json', 'data/survey-model/cost.json'], ['data/survey', 'data/survey'], ['docs/papers/harbour/reliability-baseline-defects.json', 'docs/papers/harbour/reliability-baseline-defects.json']]) if (!existsSync(join(dir, dst))) symlinkSync(resolve(src), join(dir, dst));
  console.log(`wrote ${dir}: ${r.rows.filter((d) => d.issue).length} of ${r.rows.length} dispatches now carry a ticket; ${moved} changes take the runner's implementation tier in place of the trailer's`);
}

if (mode === 'arith' || mode === 'all') {
  console.log('\n== 4. Prose arithmetic');
  const [lo, hi] = wilson(14, 365); console.log(`  mid 14/365 = ${f((14 / 365) * 100)}%, Wilson 95% ${f(lo)}–${f(hi)}; frontier 0/171 Wilson upper ${f(wilson(0, 171)[1])}%; Fisher one-sided p ${f(fisher(0, 171, 14, 365), 4)}`);
  // Exact conditional bound on the mid/frontier escape-rate ratio, given 14 escapes in all: P(frontier gets 0) = (1-p)^14, p = n1/(n1 + n2 R).
  for (const [lab, alpha] of [['one-sided 95%', 0.05], ['two-sided 95%', 0.025]]) { const p = 1 - alpha ** (1 / 14); console.log(`  ratio lower bound (${lab}, exact conditional): ${f((171 / p - 171) / 365, 2)}`); }
  const t = A.tail; console.log(`  afterlife share by day 7: frontier ${t.frontier[7]}, mid ${t.mid[7]}; after day 30: frontier ${f(1 - t.frontier[30], 2)}, mid ${f(1 - t.mid[30], 2)}`);
  const c = A.byTierPeriod; for (const k of ['chosen tier|frontier', 'chosen tier|mid']) console.log(`  ${k}: rework ceiling/whole-life ceiling ${f((c[k].reworkCeilHPerChange / c[k].wholeLifeCeilH) * 100)}%`);
}
