// LIN-3151: pin friction from git: non-merge commits whose test edits are literal-only (or a count bump), and merged PRs split into production / test / docs lines with the test lines split into pin edits, new tests and the rest.
// Usage: node scripts/survey-tests-friction-git.mjs [--since 2026-06-01] [--sd ../simple-dispatcher] [--out data/survey-tests/friction.json]
// Path classes are survey-effort-git.mjs's (copied, so the numbers compare), plus Harbour's prompt text from survey-growth-git.mjs,
// which counts as docs/prompt text. A removed/added line pair is a literal edit when the two lines are equal once string
// literals, template literals without ${}, regex literals, numbers, comments and whitespace are normalised. Pairs are
// positional within each -U0 hunk; a hunk whose removed and added counts differ has no pairs (all of its lines are unpaired).
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve, basename } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-06-01');
const out = arg('--out', 'data/survey-tests/friction.json');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 30 });

// From survey-effort-git.mjs (tests and docs beside production) and survey-growth-git.mjs (Harbour prompt text).
export const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
export const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p);
export const isPrompt = (p) => /^lib\/(prompts\/|prompt-(templates|template-defs|formatters)\.js$|proxy-(instructions|preamble)\.js$)/.test(p);
const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);
export const classOf = (p) => (isNoise(p) ? 'noise' : isTest(p) ? 'test' : isDoc(p) || isPrompt(p) ? 'doc' : 'prod');

// An assertion line, or the continuation of one (a bare literal argument such as `  147,` or `  147);`).
const ASSERT = /\bassert\b|\bexpect\s*\(|\.(ok|equal|strictEqual|deepStrictEqual|deepEqual|notEqual|match|doesNotMatch|includes|throws|rejects)\s*\(|\.length\b/;
const BARE_ARG = /^[NSR][,)\]}; ]*$/;
const TEST_CASE = /^\s*(it|test|t\.test|describe)(\.only|\.skip|\.todo)?\s*\(/;
// Pin, census and source-scan test files: by name, or by content (reads a source file and matches text in it; names a census or
// inventory). A numeric-count content rule (`.length, NN`) was tried and dropped: it caught ordinary behaviour tests.
const PIN_NAME = /census|inventory|(^|[-_.])pins?([-_.]|$)|parity|allow-?list|witness|drift|roster/i;
const SOURCE_READ = /readFileSync\([^\n]*(\blib\b|\broutes\b|\bpublic\b|\bprompts\b|server\.js|CLAUDE\.md|\.m?js['"`])/;
const TEXT_ASSERT = /assert\.(match|doesNotMatch)\s*\(|\.includes\s*\(|\.match\s*\(/;
const CENSUS_WORD = /\b(census|inventory|roster)\b/i;
export function pinFileReason(path, text) {
  if (!/\.[mc]?js$/.test(path)) return null;
  if (PIN_NAME.test(basename(path))) return 'name';
  if (text && SOURCE_READ.test(text) && TEXT_ASSERT.test(text)) return 'source-scan';
  if (text && CENSUS_WORD.test(text)) return 'census-word';
  return null;
}

// Replace literals with placeholders. keepNumbers leaves numbers alone, so a pair equal under full normalisation but not
// under this one differs only in numbers.
const REGEX_OK_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|case|in|of|void|delete)$/;
export function normalise(line, keepNumbers = false) {
  let o = ''; let i = 0; const s = line;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { o += '//C'; break; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); o += '/*C*/'; if (e < 0) break; i = e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1; let tpl = false;
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; else if (c === '`' && s[j] === '$' && s[j + 1] === '{') tpl = true; j++; }
      o += tpl ? s.slice(i, j + 1) : 'S'; i = j + 1; continue;
    }
    if (c === '/' && REGEX_OK_AFTER.test(o.trimEnd())) {
      let j = i + 1; let cls = false;
      while (j < s.length && (cls || s[j] !== '/')) { if (s[j] === '\\') j++; else if (s[j] === '[') cls = true; else if (s[j] === ']') cls = false; j++; }
      if (j < s.length) { j++; while (/[a-z]/.test(s[j] || '')) j++; o += 'R'; i = j; continue; }
    }
    if (/\d/.test(c) && !/[\w$]/.test(s[i - 1] || '')) {
      const m = s.slice(i).match(/^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?n?)/i);
      o += keepNumbers ? m[0] : 'N'; i += m[0].length; continue;
    }
    o += c; i++;
  }
  return o.replace(/\s+/g, ' ').trim();
}
export function pairKind(a, b) {
  if (a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()) return 'same';
  const na = normalise(a); const nb = normalise(b);
  if (na !== nb) return 'code';
  if (normalise(a, true) === normalise(b, true)) return 'literal';
  // Numbers differ; anything else too? Swap numbers in and compare with strings still normalised.
  return normalise(a.replace(/\d+/g, '0'), true) === normalise(b.replace(/\d+/g, '0'), true) ? 'number' : 'literal';
}
const isAssertCtx = (a, b) => ASSERT.test(a) || ASSERT.test(b) || BARE_ARG.test(normalise(a));

// Parse a -U0 patch into files with hunks of removed/added lines.
function parsePatch(text) {
  const files = []; let f = null; let h = null; let header = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      f = { path: m ? m[2] : line.slice(11), hunks: [] }; files.push(f); header = true; h = null; continue;
    }
    if (!f) continue;
    if (line.startsWith('@@')) { h = { del: [], add: [] }; f.hunks.push(h); header = false; continue; }
    if (header || !h) continue;
    if (line[0] === '-') h.del.push(line.slice(1));
    else if (line[0] === '+') h.add.push(line.slice(1));
  }
  return files;
}

// Classify one test file's hunks. Buckets are disjoint and in lines (added + removed).
function testFileLines(f, pinReason) {
  const r = { lines: 0, literalAssert: 0, literalOther: 0, numberAssert: 0, same: 0, newTests: 0, pinFile: 0, pinFileByName: 0, other: 0, pairs: { same: 0, literal: 0, number: 0, code: 0 }, unpaired: 0 };
  const pin = (n) => { r.pinFile += n; if (pinReason === 'name') r.pinFileByName += n; };
  for (const h of f.hunks) {
    const n = h.del.length + h.add.length; r.lines += n;
    if (h.del.length === h.add.length) {
      h.del.forEach((a, i) => {
        const b = h.add[i]; const k = pairKind(a, b); r.pairs[k]++;
        if (k === 'same') r.same += 2;
        else if (k === 'code') { if (pinReason) pin(2); else r.other += 2; }
        else if (isAssertCtx(a, b)) { r.literalAssert += 2; if (k === 'number') r.numberAssert += 2; }
        else if (pinReason) pin(2);
        else r.literalOther += 2;
      });
    } else {
      r.unpaired += n;
      if (!h.del.length && h.add.some((l) => TEST_CASE.test(l))) r.newTests += n;
      else if (pinReason) pin(n);
      else r.other += n;
    }
  }
  return r;
}

function readBlobs(cwd, rev, paths) {
  if (!paths.length) return [];
  const buf = execFileSync('git', ['cat-file', '--batch'], { cwd, input: paths.map((p) => `${rev}:${p}`).join('\n') + '\n', maxBuffer: 1 << 30 });
  const res = []; let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(10, i); const size = Number(buf.slice(i, nl).toString().split(' ')[2]);
    if (!Number.isFinite(size)) { i = nl + 1; res.push(''); continue; }
    res.push(buf.slice(nl + 1, nl + 1 + size).toString('utf8')); i = nl + 1 + size + 1;
  }
  return res;
}

// Summarise a patch: lines per class, test buckets, pin files touched.
function summarise(cwd, rev, files) {
  const s = { lines: { prod: 0, test: 0, doc: 0 }, files: { prod: 0, test: 0, doc: 0 }, t: null, pinFiles: [] };
  const testFiles = files.filter((f) => classOf(f.path) === 'test');
  const texts = readBlobs(cwd, rev, testFiles.map((f) => f.path));
  const t = { lines: 0, literalAssert: 0, literalOther: 0, numberAssert: 0, same: 0, newTests: 0, pinFile: 0, pinFileByName: 0, other: 0, pairs: { same: 0, literal: 0, number: 0, code: 0 }, unpaired: 0 };
  for (const f of files) {
    const c = classOf(f.path); if (c === 'noise') continue;
    const n = f.hunks.reduce((a, h) => a + h.del.length + h.add.length, 0);
    if (!n) continue;
    s.lines[c] += n; s.files[c]++;
  }
  testFiles.forEach((f, i) => {
    const reason = pinFileReason(f.path, texts[i]);
    if (reason) s.pinFiles.push(`${f.path} (${reason})`);
    const r = testFileLines(f, reason);
    for (const k of Object.keys(t)) if (k === 'pairs') for (const p of Object.keys(t.pairs)) t.pairs[p] += r.pairs[p]; else t[k] += r[k];
  });
  s.t = t;
  return s;
}

const heads = {}; const commits = []; const prs = [];
for (const [repo, cwd] of Object.entries(repos)) {
  heads[repo] = git(cwd, ['rev-parse', '--short=8', 'origin/main']).trim();
  // A. Every non-merge commit reachable from origin/main since the cut-off (PR-branch commits included).
  const firstParentSet = new Set(git(cwd, ['log', 'origin/main', '--first-parent', '--no-merges', `--since=${since}`, '--format=%H']).trim().split('\n'));
  const log = git(cwd, ['log', 'origin/main', '--no-merges', `--since=${since}`, '-p', '-U0', '--no-color', '--format=@@@FRICTION%x09%H%x09%cI%x09%s']);
  for (const chunk of log.split(/^@@@FRICTION\t/m).filter(Boolean)) {
    const nl = chunk.indexOf('\n');
    const [sha, date, subject] = chunk.slice(0, nl).split('\t');
    const s = summarise(cwd, sha, parsePatch(chunk.slice(nl + 1)));
    const t = s.t;
    const edits = t.pairs.literal + t.pairs.number;
    const literalOnly = s.lines.test > 0 && t.unpaired === 0 && t.pairs.code === 0 && edits > 0;
    const countBump = literalOnly && t.pairs.literal === 0 && t.numberAssert === 2 * t.pairs.number;
    let kind = null;
    if (literalOnly && !s.lines.prod && !s.lines.doc) kind = countBump ? 'count-bump' : 'pin-edit';
    else if (literalOnly && !s.lines.prod && s.lines.doc) kind = 'pin-with-doc';
    const squashPR = firstParentSet.has(sha) && /\(#\d+\)$/.test(subject);
    commits.push({ repo, sha: sha.slice(0, 8), date, squashPR, testLiteralOnly: literalOnly, hasAssertLiteralEdit: t.literalAssert > 0, month: date.slice(0, 7), subject: subject.slice(0, 120), lines: s.lines, files: s.files, testPairs: t.pairs, testUnpaired: t.unpaired, numberAssertLines: t.numberAssert, kind });
  }
  // B. Merged PRs on the first-parent line: merge commits (diff M^1 M) and squash merges, a single-parent commit whose
  // subject ends "(#N)" (diff C^1 C). Both repos use both styles over the window.
  const firstParent = git(cwd, ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
  for (const line of firstParent) {
    const [sha, parents, date, subject] = line.split('\t');
    const [p1, p2] = parents.split(' ');
    const style = p2 ? 'merge' : /\(#\d+\)$/.test(subject) ? 'squash' : null;
    if (!style) continue;
    const s = summarise(cwd, sha, parsePatch(git(cwd, ['diff', '-U0', '--no-color', p1, sha])));
    const t = s.t;
    const branchSubjects = p2 ? git(cwd, ['log', '--format=%s', `${p1}..${p2}`]) : '';
    const ids = [...new Set(((subject + '\n' + branchSubjects).match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
    const pinEdit = t.literalAssert + t.pinFile;
    const nonDoc = s.lines.prod + s.lines.test;
    prs.push({
      repo, pr: Number((subject.match(/#(\d+)/) || [])[1]) || null, style, sha: sha.slice(0, 8), date, month: date.slice(0, 7),
      subject: subject.slice(0, 140), ids, lines: s.lines, files: s.files,
      test: { literalAssert: t.literalAssert, numberAssert: t.numberAssert, pinFile: t.pinFile, pinFileByName: t.pinFileByName, newTests: t.newTests, literalOther: t.literalOther, whitespace: t.same, other: t.other },
      testShareOfNonDoc: nonDoc ? +(s.lines.test / nonDoc).toFixed(3) : null,
      pinShareOfTest: s.lines.test ? +(pinEdit / s.lines.test).toFixed(3) : null,
      pinShareOfTestStrict: s.lines.test ? +((t.literalAssert + t.pinFileByName) / s.lines.test).toFixed(3) : null,
      pinOnlyTests: s.lines.test > 0 && pinEdit + t.same === s.lines.test,
      pinOnlyTestsStrict: s.lines.test > 0 && t.literalAssert + t.pinFileByName + t.same === s.lines.test,
      pinFiles: s.pinFiles,
    });
  }
}

// Summaries per repo and month.
const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const hist = (vals, edges) => edges.slice(0, -1).map((lo, i) => ({ bin: `${lo}-${edges[i + 1]}`, n: vals.filter((v) => v >= lo / 100 && (i === edges.length - 2 ? v <= edges[i + 1] / 100 : v < edges[i + 1] / 100)).length }));
const summary = {};
for (const repo of Object.keys(repos)) {
  summary[repo] = {};
  for (const m of [...months, 'all']) {
    const cs = commits.filter((c) => c.repo === repo && (m === 'all' || c.month === m));
    const touching = cs.filter((c) => c.lines.test > 0);
    const n = (k) => cs.filter((c) => c.kind === k).length;
    const ps = prs.filter((p) => p.repo === repo && (m === 'all' || p.month === m));
    const withTests = ps.filter((p) => p.lines.test > 0);
    const pinOnly = (cap) => ps.filter((p) => p.pinOnlyTests && p.lines.prod <= cap).length;
    summary[repo][m] = {
      commits: cs.length, commitsTouchingTests: touching.length,
      pinEdit: n('pin-edit'), countBump: n('count-bump'), pinWithDoc: n('pin-with-doc'),
      pinOrBumpPctOfAll: pct(n('pin-edit') + n('count-bump'), cs.length),
      pinOrBumpPctOfTestTouching: pct(n('pin-edit') + n('count-bump'), touching.length),
      squashCommits: cs.filter((c) => c.squashPR).length,
      testLiteralOnlyAnyProd: cs.filter((c) => c.testLiteralOnly).length,
      withAssertLiteralEdit: touching.filter((c) => c.hasAssertLiteralEdit).length,
      allThreePctOfTestTouching: pct(n('pin-edit') + n('count-bump') + n('pin-with-doc'), touching.length),
      prs: ps.length, squashPRs: ps.filter((p) => p.style === 'squash').length, prsWithTests: withTests.length,
      testOver50PctOfNonDoc: ps.filter((p) => p.testShareOfNonDoc > 0.5).length,
      pinOver50PctOfTest: withTests.filter((p) => p.pinShareOfTest > 0.5).length,
      pinOver50PctOfTestStrict: withTests.filter((p) => p.pinShareOfTestStrict > 0.5).length,
      pinOnlyTestsStrictProdLe10: ps.filter((p) => p.pinOnlyTestsStrict && p.lines.prod <= 10).length,
      prsWithNumberAssertEdit: ps.filter((p) => p.test.numberAssert > 0).length,
      pinOver25PctOfTest: withTests.filter((p) => p.pinShareOfTest > 0.25).length,
      pinOnlyTestsProdLe0: pinOnly(0), pinOnlyTestsProdLe10: pinOnly(10), pinOnlyTestsProdLe50: pinOnly(50), pinOnlyTestsAnyProd: pinOnly(Infinity),
      prsTouchingPinFiles: ps.filter((p) => p.pinFiles.length).length,
      testLines: ps.reduce((a, p) => a + p.lines.test, 0),
      pinEditLines: ps.reduce((a, p) => a + p.test.literalAssert + p.test.pinFile, 0),
      newTestLines: ps.reduce((a, p) => a + p.test.newTests, 0),
    };
  }
  const ps = prs.filter((p) => p.repo === repo);
  const edges = [0, 10, 25, 50, 75, 90, 100];
  summary[repo].distributions = {
    testShareOfNonDoc: hist(ps.map((p) => p.testShareOfNonDoc).filter((v) => v !== null), edges),
    pinShareOfTest: hist(ps.map((p) => p.pinShareOfTest).filter((v) => v !== null), edges),
    pinShareOfTestStrict: hist(ps.map((p) => p.pinShareOfTestStrict).filter((v) => v !== null), edges),
  };
}

mkdirSync(dirname(out), { recursive: true });
const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
writeFileSync(out, JSON.stringify({ ...prev, since, generatedAt: new Date().toISOString(), heads, summary, prs, commits }, null, 1));
for (const [repo, s] of Object.entries(summary)) {
  console.log(`\n${repo}`);
  for (const m of [...months, 'all']) console.log(m.padEnd(8), JSON.stringify(s[m]));
  console.log('dist', JSON.stringify(s.distributions));
}
