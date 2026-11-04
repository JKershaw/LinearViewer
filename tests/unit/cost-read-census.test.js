/**
 * LIN-4179 census (plan W8): every cost figure is read through the one read, so a surface added later cannot quietly
 * compute its own. Modelled on key-state-census.test.js: the rules are plain data, the check is a pure function over
 * (path, text) pairs, and the synthetic cases below prove the check fails on the violations it names.
 *
 * It fails when a file under lib/, routes/, public/ or server.js:
 *  - imports a lineage fold helper (`foldLineageUsage`, `groupLineageMembership`, `readUsageEntry`, `readRowUsage`,
 *    `lastUsageEntry`, `usageOf`) and is not one of the listed readers;
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
export const FOLD_HELPERS = ['foldLineageUsage', 'groupLineageMembership', 'readUsageEntry', 'readRowUsage', 'lastUsageEntry', 'usageOf'];
export const FOLD_IMPORTERS = {
  // The one cost read: it composes the three decisions (membership, the fold, the usage reader).
  'lib/cost-read.js': ['foldLineageUsage', 'groupLineageMembership', 'readUsageEntry', 'readRowUsage'],
  // The outcome seam (`usageOf`) and the usage reader (`lastUsageEntry`) that the decisions are built on.
  'lib/dispatch-lineage.js': ['lastUsageEntry'],
  'lib/session-telemetry.js': ['lastUsageEntry'],
  // The digest's `kpiUsageEntry` is the named copy of "which entry is a row's usage" (a query cannot call JS). Pinned
  // against lastUsageEntry by tests/unit/cost-read-usage-parity.test.js.
  'lib/digest-feedback.js': ['usageOf', 'evidenceCountOf'],
};

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
