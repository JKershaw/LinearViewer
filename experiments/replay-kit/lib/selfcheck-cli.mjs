// Generic self-check driver (from rung5d/replay/selfcheck.mjs). A target's
// selfcheck.mjs calls `runSelfcheck(cfg, mutants)`:
//   1. old vs old = 0 differences, 0 info, 0 export diffs on two seeds, with
//      coverage; line coverage of the pinned file must be ≥ cfg.minCoverage (95).
//   2. planted mutants (exact-once text replacements on the pinned copy): each
//      must be caught — `expect:'detect'` (a difference, optionally of `kind`),
//      `expect:'finding'` (a NEW-side finding of `kind`, e.g. privacy-leak),
//      or `expect:'info'` (0 differences but an info group of `infoKind`).
//   node selfcheck.mjs [--n 3000] [--mutant-n 1500] [--seeds 1,2] [--only M3] [--no-test-tier]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function runSelfcheck(cfg, mutants, argv = process.argv.slice(2)) {
  const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
  const n = arg('n', '3000');
  const mn = arg('mutant-n', '1500');
  const seeds = arg('seeds', '1,2').split(',');
  const only = arg('only', null);
  const tiers = argv.includes('--no-test-tier') ? 'edge,gen' : 'test,edge,gen';
  const DIR = path.join(cfg.here, 'work', 'selfcheck');
  fs.mkdirSync(DIR, { recursive: true });
  const PIN = path.join(cfg.pinnedDir, cfg.main);
  const base = fs.readFileSync(PIN, 'utf8');
  const minCov = cfg.minCoverage ?? 95;

  const mutant = (name, pairs) => {
    let src = base;
    for (const [from, to] of pairs) {
      const count = src.split(from).length - 1;
      if (count !== 1) throw new Error(`mutant ${name}: pattern occurs ${count} times: ${from}`);
      src = src.replace(from, to);
    }
    const d = path.join(DIR, `mutant-${name}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, cfg.main), src);
    return d;
  };

  const checks = [
    ...seeds.map(s => ({ id: `identity-s${s}`, name: `identity seed ${s} (old vs old)`, dir: cfg.pinnedDir, seed: s, n, expect: 'none', coverage: true })),
    ...mutants.map(m => ({ ...m, dir: mutant(m.id, m.pairs) })),
  ].filter(c => !only || c.id === only || c.id.startsWith(only));

  const rows = [];
  for (const c of checks) {
    const out = path.join(DIR, `report-${c.id}.json`);
    const args = [path.join(cfg.here, 'replay.mjs'), '--old', cfg.pinnedDir, '--new', c.dir, '--n', c.n || mn, '--seed', c.seed || '1', '--out', out, '--quiet', '--tiers', c.tiers || tiers];
    if (c.coverage) args.push('--coverage');
    const t0 = Date.now();
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' }, maxBuffer: 64 << 20 });
    if (r.status === 2 || !fs.existsSync(out)) { console.error(r.stderr); throw new Error(`replay failed for ${c.name}`); }
    const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
    const T = rep.totals;
    const byTier = Object.fromEntries(Object.entries(T.byTier).map(([k, v]) => [k, v.differing]));
    let ok;
    if (c.expect === 'none') ok = T.differing === 0 && rep.infoGroups.length === 0 && rep.exportsDiff.differences.length === 0;
    else if (c.expect === 'detect') ok = T.differing > 0 && (!c.kind || (T.kinds[c.kind] || 0) > 0);
    else if (c.expect === 'finding') ok = rep.findings.new.groups.some(g => g.kind === c.kind) && (T.kinds[c.kind] || 0) > 0;
    else ok = T.differing === 0 && rep.infoGroups.some(g => g.kind === c.infoKind);
    const row = { check: c.name, id: c.id, ok, differing: T.differing, of: T.inputs, byTier, kinds: T.kinds, groups: rep.groups.length, top: rep.groups[0]?.signature ?? null,
      info: rep.infoGroups.slice(0, 2).map(g => `${g.inputs}× ${g.signature}`), findings: { old: rep.findings.old.inputs, new: rep.findings.new.inputs, newTop: rep.findings.new.groups[0]?.signature ?? null },
      seconds: +((Date.now() - t0) / 1000).toFixed(0), report: out };
    if (c.coverage) {
      const cov = rep.coverage[`old:${cfg.main}`];
      row.coverage = { lines: `${cov.all.linesCovered}/${cov.all.linesTotal} (${cov.all.pct}%)`, pct: cov.all.pct, blocks: `${cov.all.blocksHit}/${cov.all.blocksTotal}`, byTier: Object.fromEntries(Object.entries(cov.byTier).map(([k, v]) => [k, `${v.pct}%`])), unhitBlocks: cov.all.unhitBlocks.map(b => `L${b.line}: ${b.code}`), uncoveredLines: cov.all.uncoveredLines.map(u => u.line) };
      row.ok = row.ok && cov.all.pct >= minCov;
    }
    rows.push(row);
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.check}: ${row.differing}/${row.of} differing ${JSON.stringify(row.byTier)} kinds=${JSON.stringify(row.kinds)} findings old/new=${row.findings.old}/${row.findings.new} (${row.seconds}s)${row.top ? `\n        top: ${row.top}` : ''}${row.info.length ? `\n        info: ${row.info.join(' | ')}` : ''}`);
    if (row.coverage) console.log(`        coverage: lines ${row.coverage.lines}, blocks ${row.coverage.blocks}, by tier ${JSON.stringify(row.coverage.byTier)}\n        unhit blocks: ${row.coverage.unhitBlocks.join(' ; ')}`);
  }
  fs.writeFileSync(path.join(DIR, only ? `selfcheck-${only}.json` : 'selfcheck.json'), JSON.stringify(rows, null, 2));
  process.exitCode = rows.every(r => r.ok) ? 0 : 1;
  return rows;
}
