/**
 * LIN-4179 census (plan W8): every cost figure is read through the one read, so a surface added later cannot quietly
 * compute its own. Modelled on key-state-census.test.js: the rules are plain data, the check is a pure function over
 * (path, text) pairs, and the synthetic cases below prove the check fails on the violations it names.
 *
 * It fails when a file under lib/, routes/, public/ or server.js:
 *  - imports a lineage fold helper (`foldLineageUsage`, `groupLineageMembership`, `readUsageEntry`, `readRowUsage`,
 *    `lastUsageEntry`, `usageOf`) and is not one of the listed readers. LIN-4201 broadens this to EVERY reader of
 *    snapshot usage outside the legacy fold (review notes 1-2): `usageStateOf`, `isRunningTotal`, `countedRowsOf`,
 *    `parseUsage`, `buildRunTelemetry`, and the record fold `foldRequestUsage`, each with its users named;
 *  - reads a run's `telemetry.usage` outside the module that builds it (LIN-4201: a snapshot reader no import names);
 *  - calls a retired cost function (`buildTaskCost`, `joinCostLineages`, `reduceLineageCost`, `summarize`,
 *    `summarizeByIssue`, `summarizeByFeature`) anywhere, or calls `windowedSpend` / `listInHorizon` outside its list;
 *  - formats a dollar figure by hand (`$` + `toFixed` on the same line) outside the one formatter (lib/cost-format.js,
 *    public/cost-format.js). The only exception is a per-token price line, which is a price, not a cost figure.
 *
 * Run with: node --test tests/unit/cost-read-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED_DIRS = ['lib', 'routes', 'public'];
const SCANNED_FILES = ['server.js'];

/** The lineage fold helpers, and which files may import each one (the readers that own a lineage fact). */
export const FOLD_HELPERS = [
  'foldLineageUsage', 'groupLineageMembership', 'readUsageEntry', 'readRowUsage', 'lastUsageEntry', 'usageOf',
  // LIN-4201: the rest of the snapshot-usage readers, and the record fold.
  'usageStateOf', 'isRunningTotal', 'countedRowsOf', 'parseUsage', 'buildRunTelemetry', 'foldRequestUsage',
];
export const FOLD_IMPORTERS = {
  // The one cost read: it composes the three decisions (membership, the fold, the usage reader), and makes the
  // records-or-snapshots decision (LIN-4201 `lineageUsageOf`): the record fold and the snapshot partition are read
  // there and nowhere else. `usageStateOf` is its own export and has no importer: the /kpis harness shares read the
  // record's `harnessReading` instead (LIN-4201 review note 1).
  'lib/cost-read.js': ['foldLineageUsage', 'groupLineageMembership', 'readUsageEntry', 'readRowUsage', 'countedRowsOf', 'foldRequestUsage'],
  // The snapshot pricing guard (model-pricing.js:421): a running total that crosses a long-context tier prices to
  // null. A legacy-fold-only reader: a request record is priced by `priceRequest`, which skips the guard (D5).
  'lib/model-pricing.js': ['isRunningTotal'],
  // The outcome seam (`usageOf`) and the usage reader (`lastUsageEntry`) that the decisions are built on.
  'lib/dispatch-lineage.js': ['lastUsageEntry'],
  'lib/session-telemetry.js': ['lastUsageEntry'],
  // The digest's `kpiUsageEntry` is the named copy of "which entry is a row's usage" (a query cannot call JS). Pinned
  // against lastUsageEntry by tests/unit/cost-read-usage-parity.test.js. It feeds the /kpis aggregation's
  // `usageEntry` (lib/kpi-stats.js:460), the legacy fold's input, and nothing else: legacy-fold-only, kept.
  // `buildRunTelemetry` puts a non-lean run's parsed `[usage]` on `telemetry.usage`: informational, no cost figure reads
  // it (the persisted digest drops it, the lean/non-lean exemption in scripts/lin3014/lib/exemptions.mjs), kept.
  'lib/digest-feedback.js': ['usageOf', 'evidenceCountOf', 'buildRunTelemetry'],
};

/**
 * LIN-4201: files that may read a run's `telemetry.usage` (the parsed snapshot buildRunTelemetry attaches). Only the
 * module that builds it; a cost figure is read through lib/cost-read.js, never from a loop's telemetry.
 * `buildSessionTelemetry` is NOT a usage reader: a session carries no usage since LIN-4136 (session-telemetry.js
 * `_assembleTelemetry`, `withUsage` false), so it is not listed and is left in place (its runtime, metrics, artifacts
 * and model feed lib/pipeline-loops.js `_assembleSession`).
 */
export const TELEMETRY_USAGE_ALLOW = ['lib/session-telemetry.js'];
const TELEMETRY_USAGE = /\btelemetry\??\.usage\b/;

/** Calls that must sit only in the listed files (the readers and their named callers). */
export const CALL_ALLOW = {
  // The store returns docs; the read and the surfaces that ask it for docs.
  listInHorizon: ['lib/llm-call-log.js', 'routes/settings.js', 'routes/ship-biscuit.js', 'routes/dashboard-feed.js', 'routes/proxy-compute.js'],
  // The weekly window read, used only by the workspace KPIs (S12).
  windowedSpend: ['lib/weekly-budget.js', 'lib/workspace-kpi-stats.js'],
};

/** Names that must not exist in code at all (their cost arithmetic moved to lib/cost-read.js). */
export const RETIRED = ['buildTaskCost', 'joinCostLineages', 'reduceLineageCost', 'summarizeByIssue', 'summarizeByFeature'];

/** The store's old summary method: a bare `summarize(` call on the call-log store. */
const RETIRED_CALL = /\.summarize\s*\(/;

/** A `$` + `toFixed` on one line: a hand-made dollar figure. */
const DOLLAR_TOFIXED = /\$\$\{[^}]*\.toFixed\(|'\$'\s*\+[^\n]*\.toFixed\(/;

/** The formatter files themselves, and the lines that are not cost figures. */
export const FORMAT_ALLOW = [
  { file: 'lib/cost-format.js' },
  { file: 'public/cost-format.js' },
  // A model's per-token price in the catalog text, not a cost figure.
  { file: 'lib/openrouter.js', includes: 'per 1M tokens' },
];

const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

/** Named imports of a file: the names in each `import { … } from` statement. */
export function importedNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Every problem in the given files, as readable strings. Pure: the caller supplies `{ path, text }` pairs.
 * @param {Array<{path: string, text: string}>} files  repo-relative POSIX paths
 * @returns {string[]}
 */
export function censusProblems(files) {
  const problems = [];
  for (const { path: file, text } of files) {
    const lines = text.split('\n');

    // 1. Lineage fold helpers imported by a file that is not a listed reader.
    const imported = importedNames(text);
    for (const helper of FOLD_HELPERS) {
      if (!imported.has(helper)) continue;
      const allowed = FOLD_IMPORTERS[file]?.includes(helper);
      if (!allowed) problems.push(`${file} imports ${helper}: a lineage fact is read through lib/cost-read.js, not here`);
    }

    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      const where = `${file}:${index + 1}`;

      // 1b. A loop's parsed snapshot read off its telemetry (LIN-4201).
      if (TELEMETRY_USAGE.test(line) && !TELEMETRY_USAGE_ALLOW.includes(file)) {
        problems.push(`${where} reads telemetry.usage: a cost figure is read through lib/cost-read.js, not a loop's telemetry`);
      }

      // 2. Retired cost functions, anywhere in code.
      for (const name of RETIRED) {
        if (new RegExp(`\\b${name}\\b`).test(line)) problems.push(`${where} uses ${name}, which is retired: its arithmetic lives in lib/cost-read.js`);
      }
      if (RETIRED_CALL.test(line)) problems.push(`${where} calls .summarize(, which is retired: ask lib/cost-read.js for the figure over listInHorizon`);

      // 3. Calls that are allowed only in listed files.
      for (const [name, allowedFiles] of Object.entries(CALL_ALLOW)) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(line) && !allowedFiles.includes(file)) {
          problems.push(`${where} calls ${name}, which only ${allowedFiles.join(', ')} may call`);
        }
      }

      // 4. A hand-made dollar figure.
      if (DOLLAR_TOFIXED.test(line)) {
        const allowed = FORMAT_ALLOW.some(entry => entry.file === file && (entry.includes === undefined || line.includes(entry.includes)));
        if (!allowed) problems.push(`${where} formats a dollar figure by hand ($ and toFixed): use formatUsd (lib/cost-format.js, public/cost-format.js)`);
      }
    });
  }
  return problems;
}

/** Reads the real repo: every .js and .mjs under the scanned directories, plus the scanned files. */
function repoFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?js)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of SCANNED_DIRS) walk(path.join(REPO, dir));
  for (const file of SCANNED_FILES) out.push(path.join(REPO, file));
  return out.map(full => ({ path: path.relative(REPO, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }));
}

describe('the cost census (LIN-4179 W8)', () => {
  test('no file outside the listed readers computes a cost figure by hand', () => {
    assert.deepEqual(censusProblems(repoFiles()), []);
  });

  // Synthetic witnesses: the check must name each violation kind, so a green run means something.
  test('a file importing a lineage fold helper is named', () => {
    const problems = censusProblems([{ path: 'routes/new-surface.js', text: "import { groupLineageMembership } from '../lib/lineage-membership.js';\n" }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /routes\/new-surface\.js imports groupLineageMembership/);
  });

  test('LIN-4201: a new reader of snapshot usage is named, each helper on its own', () => {
    for (const helper of ['usageStateOf', 'isRunningTotal', 'countedRowsOf', 'parseUsage', 'buildRunTelemetry', 'foldRequestUsage']) {
      const problems = censusProblems([{ path: 'lib/new-reader.js', text: `import { ${helper} } from './somewhere.js';\n` }]);
      assert.equal(problems.length, 1, helper);
      assert.match(problems[0], new RegExp(`lib/new-reader\\.js imports ${helper}`));
    }
  });

  test('LIN-4201: the listed users stay allowed, and only for what they are listed for', () => {
    assert.deepEqual(censusProblems([{ path: 'lib/model-pricing.js', text: "import { isRunningTotal } from './row-usage.js';\n" }]), []);
    assert.equal(censusProblems([{ path: 'lib/model-pricing.js', text: "import { countedRowsOf } from './row-usage.js';\n" }]).length, 1);
    // The /kpis harness shares no longer read snapshots themselves (review note 1).
    assert.equal(censusProblems([{ path: 'lib/terminal-marked-task-cost.js', text: "import { usageStateOf } from './cost-read.js';\n" }]).length, 1);
    assert.equal(censusProblems([{ path: 'lib/terminal-marked-task-cost.js', text: "import { isRunningTotal } from './row-usage.js';\n" }]).length, 1);
  });

  test('LIN-4201: reading a loop\'s telemetry.usage outside session-telemetry.js is named', () => {
    const problems = censusProblems([{ path: 'lib/render-x.js', text: 'const cost = loop.telemetry?.usage?.costUsd;\n' }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /reads telemetry\.usage/);
    assert.deepEqual(censusProblems([{ path: 'lib/session-telemetry.js', text: '    if (usage) telemetry.usage = usage;\n' }]), []);
  });

  test('a call to a retired cost function is named, wherever it sits', () => {
    const problems = censusProblems([{ path: 'lib/anything.js', text: 'const x = await store.summarizeByIssue(urlKey, id);\n' }]);
    assert.ok(problems.some(p => /summarizeByIssue/.test(p)), problems.join('\n'));
  });

  test('a windowed call outside its list is named', () => {
    const problems = censusProblems([{ path: 'routes/other.js', text: 'const s = windowedSpend(lineages, a, b);\n' }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /calls windowedSpend/);
  });

  test('a hand-made dollar figure outside the formatter is named, in both template and concatenation form', () => {
    const problems = censusProblems([
      { path: 'lib/render-x.js', text: 'return `$${cost.toFixed(2)}`;\n' },
      { path: 'public/y.js', text: "return '$' + n.toFixed(2);\n" },
    ]);
    assert.equal(problems.length, 2);
  });

  test('the formatter itself and a per-token price line are not violations', () => {
    const problems = censusProblems([
      { path: 'lib/cost-format.js', text: 'return `${sign}$${magnitude.toFixed(2)}`;\n' },
      { path: 'lib/openrouter.js', text: 'return `$${p.prompt.toFixed(2)} in / $${p.completion.toFixed(2)} out per 1M tokens`;\n' },
    ]);
    assert.deepEqual(problems, []);
  });

  test('a comment that names a retired function is not a violation', () => {
    assert.deepEqual(censusProblems([{ path: 'lib/x.js', text: ' * joinCostLineages is gone.\n// summarizeByIssue(x) used to fold cost.\n' }]), []);
  });
});

describe('LIN-4201: buildSessionTelemetry is not a usage reader (kept, not deleted)', async () => {
  const { buildSessionTelemetry } = await import('../../lib/session-telemetry.js');
  test('a session built from loops that posted [usage] carries no usage', () => {
    const feedback = [{ kind: 'usage', message: `[usage] ${JSON.stringify({ model: 'claude-opus-5-5', inputTokens: 10, costUsd: 1 })}` }];
    const telemetry = buildSessionTelemetry({ loops: [{ feedback }, { feedback }] });
    assert.equal('usage' in telemetry, false);
    assert.equal(JSON.stringify(telemetry).includes('costUsd'), false);
  });
});

/**
 * LIN-4276: each rule `lib/cost-read.js` reads has one owner in this file. The dispatch order is `byDispatchOrder`
 * from lineage-membership.js, and the posting-row key list is `postingKeysOf`'s alone. Scoped to lib/cost-read.js:
 * task-board-view.js has an unrelated `rankOf`.
 */
describe('LIN-4276: one dispatch order and one posting-key list in lib/cost-read.js (re-fork guard)', () => {
  const COST_READ = fs.readFileSync(path.join(REPO, 'lib/cost-read.js'), 'utf8');
  const KEY_LIST = /\[\s*row\?\.id\s*,\s*row\?\._id\s*,\s*row\?\.loopId\s*\]/g;

  test('the dispatch order is imported from lineage-membership.js, and no private sort key is defined here', () => {
    assert.match(COST_READ, /import\s*\{[^}]*\bbyDispatchOrder\b[^}]*\}\s*from\s*'\.\/lineage-membership\.js'/);
    assert.doesNotMatch(COST_READ, /\brankOf\b/);
  });

  test('dispatchesOf sorts with the imported order, and no comparator is re-forked under another name', () => {
    assert.match(COST_READ, /\.sort\(byDispatchOrder\)/);
    // An anonymous `(toEpochMs(a.dispatchedAt) ?? Infinity) - ...` comparator is the re-fork; the file's only other
    // Infinity is `?? -Infinity` (the window filter), which this does not match.
    assert.doesNotMatch(COST_READ, /\?\?\s*Infinity/);
  });

  test('the posting-row key list is written once, in postingKeysOf', () => {
    assert.equal((COST_READ.match(KEY_LIST) || []).length, 1);
  });
});
