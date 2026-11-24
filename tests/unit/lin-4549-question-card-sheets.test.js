/**
 * LIN-4549 (LIN-4546 piece 1): every surface that draws the question record card loads the card's rules.
 *
 * The card is one leaf, lib/question-record-card.js. Its rules lived in public/session.css, which Home, the task page and the run
 * page load, while Observation (the rulings tab) and Flight Companion draw the same card and load style.css but not session.css,
 * so the card drew unstyled there. The rules now live in public/style.css, the sheet every page loads.
 *
 * The guard, in three parts:
 *   1. Every file that draws the card (it imports the leaf's render function, or writes the card's test id into markup) is on
 *      DRAWERS, and every entry on DRAWERS still draws it. A new drawing surface fails here until it names its pages.
 *   2. A drawer under lib/ that hands its markup to another file (Home's section, lib/waiting-section.js) names every file that
 *      imports its renderer: a page it lists, or a fragment host whose markup lands on one of those pages.
 *   3. Each page a drawer names loads, in every stylesheet list its renderer passes, a rule for each class the card draws that
 *      any sheet styles. The classes come from rendering the leaf, so a new class the card draws is covered the day it lands.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheets } from '../helpers/css-rules.js';
import { classesOf } from '../measures/css-cascade.mjs';
import { renderQuestionRecordCard } from '../../lib/question-record-card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LEAF = 'lib/question-record-card.js';

/**
 * The surfaces that draw the card, each with the page renderer(s) whose stylesheet lists must carry its rules.
 * `fragments`: a file that imports this drawer's renderer to answer a fragment, mapped to the page the fragment lands on.
 * `notDrawnOn`: a stylesheet list the same page renderer passes for a page that cannot show the card, with why.
 */
const DRAWERS = {
  'lib/waiting-section.js': {
    pages: ['lib/render.js'],
    fragments: { 'server.js': 'lib/render.js' }, // GET /workspace/:urlKey/api/home-waiting, merged into Home's section.
    notDrawnOn: [{ list: ['/style.css'], why: 'the signed-out landing page, the other branch of the same renderer' }],
  },
  'lib/render-session.js': { pages: ['lib/render-session.js'] },
  'lib/render-task-page.js': { pages: ['lib/render-task-page.js'] },
  'public/observation.js': { pages: ['lib/render-observation.js'] },
  'public/flight-companion.js': { pages: ['lib/render-flight-companion.js'] },
  // LIN-4551: the styleguide draws the card's states with its own renderer (inert samples).
  'lib/render-styleguide.js': { pages: ['lib/render-styleguide.js'] },
};

/** The source files a drawer can live in: lib/ (recursive), routes/, public/*.js and server.js, repo-relative. */
function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(d.name)) out.push(rel);
    }
  };
  for (const dir of ['lib', 'routes']) if (existsSync(join(root, dir))) walk(dir);
  if (existsSync(join(root, 'public'))) {
    for (const d of readdirSync(join(root, 'public'))) if (/\.js$/.test(d)) out.push(`public/${d}`);
  }
  if (existsSync(join(root, 'server.js'))) out.push('server.js');
  return out;
}

/** The names a file imports from a module whose path ends in `/<base>`. */
function importedNames(text, base) {
  const names = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    if (!m[2].endsWith(`/${base}`)) continue;
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Whether a file draws the card: it imports the leaf's render function, or writes the card's test id as markup (an attribute,
 * `setAttribute` or `dataset.testid`). Reading the id in a selector (`[data-testid="question-record-card"]`) is not drawing.
 */
function drawsCard(text) {
  if (importedNames(text, 'question-record-card.js').some((n) => n === 'renderQuestionRecordCard' || n === 'renderQuestionRecordCards')) return true;
  if (/(?<!\[)data-testid=\\?["']question-record-card\\?["']/.test(text)) return true;
  if (/setAttribute\(\s*['"]data-testid['"]\s*,\s*['"]question-record-card['"]\s*\)/.test(text)) return true;
  return /dataset\.testid\s*=\s*['"]question-record-card['"]/.test(text);
}

/** Every file under `root` that draws the card, the leaf itself aside. */
function drawingFiles(root) {
  return sourceFiles(root).filter((f) => f !== LEAF && drawsCard(readFileSync(join(root, f), 'utf8'))).sort();
}

/**
 * The stylesheet lists one renderer passes, read as tests/measures/css-cascade.mjs reads them: every array on a `stylesheets:`
 * line (a ternary holds two), and a one-line `const NAME = [...]` it passes by name.
 */
function sheetListsOf(text) {
  const lines = text.split('\n');
  const consts = new Map();
  for (const line of lines) {
    const c = line.match(/^(?:const|let) ([A-Z_]+) = \[([^\]]*)\];/);
    if (c) consts.set(c[1], [...c[2].matchAll(/'(\/[^']+\.css)'/g)].map((x) => x[1]));
  }
  const lists = [];
  for (const line of lines) {
    if (!line.includes('stylesheets:')) continue;
    for (const m of line.matchAll(/\[([^\[\]]*)\]/g)) {
      const names = [...m[1].matchAll(/'(\/[^']+\.css)'/g)].map((x) => x[1]);
      if (names.length) lists.push(names);
    }
    for (const m of line.matchAll(/stylesheets: ([A-Z_]+)\b/g)) if (consts.has(m[1])) lists.push(consts.get(m[1]));
  }
  return lists;
}

/**
 * The classes the card draws, over its interactive and its read-only face. LIN-4553: the sample draws every part of the card,
 * so its task line (identifier, linked, then title) and its full ask behind the fold are checked on every page too; the first
 * sample had neither a task nor a longer ask, so those rules were never asked for.
 */
function cardClasses() {
  const row = {
    questionId: 'q-1', short: 'Which?', asks: 'Which?\n\nThe background:\n- one\n- two', options: ['a', 'b'], recommended: 'b',
    ifUnanswered: null, state: 'resumable', interactive: true, ticket: 'LIN-1', title: 'The task',
  };
  const ctx = { urlKey: 'w', taskHref: (identifier) => `/workspace/w/task/${identifier}` };
  const html = renderQuestionRecordCard(row, ctx) + renderQuestionRecordCard({ ...row, interactive: false }, ctx);
  const classes = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  return classes;
}

/** Classes some rule in `sheets` names (any compound of any selector). */
function styledClasses(sheets) {
  const out = new Set();
  for (const sheet of sheets) for (const rule of sheet.rules) for (const sel of rule.selectors) for (const c of classesOf(sel)) out.add(c);
  return out;
}

/** Every public sheet, parsed. */
function allSheets(root) {
  return readSheets(readdirSync(join(root, 'public')).filter((f) => f.endsWith('.css')).map((f) => `/${f}`), join(root, 'public'));
}

/**
 * The problems the guard finds under `root`, as plain sentences: unlisted drawers, stale entries, an unaccounted importer of a
 * drawer's renderer, and each page list that leaves out a rule the card needs.
 */
function guardProblems(root, drawers = DRAWERS) {
  const problems = [];
  const drawing = drawingFiles(root);
  for (const f of drawing) if (!drawers[f]) problems.push(`${f} draws the question card but is not on DRAWERS: name the pages it draws on`);
  for (const f of Object.keys(drawers)) if (!drawing.includes(f)) problems.push(`${f} is on DRAWERS but no longer draws the question card`);

  // A lib drawer's renderer: every importer is a page it names or a fragment host.
  for (const [file, entry] of Object.entries(drawers)) {
    if (!file.startsWith('lib/') || entry.pages.includes(file)) continue;
    const base = file.split('/').pop();
    for (const f of sourceFiles(root)) {
      if (f === file) continue;
      const names = importedNames(readFileSync(join(root, f), 'utf8'), base).filter((n) => /^render/.test(n));
      if (!names.length) continue;
      if (entry.pages.includes(f) || (entry.fragments && entry.fragments[f])) continue;
      problems.push(`${f} imports ${names.join(', ')} from ${file} (it draws the question card) but is neither a page nor a fragment host on its DRAWERS entry`);
    }
  }

  const styledAnywhere = styledClasses(allSheets(root));
  const needed = [...cardClasses()].filter((c) => styledAnywhere.has(c)).sort();
  for (const [file, entry] of Object.entries(drawers)) {
    for (const page of entry.pages) {
      const lists = sheetListsOf(readFileSync(join(root, page), 'utf8'));
      if (!lists.length) { problems.push(`${page} (a page ${file} draws on) passes no stylesheet list the guard can read`); continue; }
      const exempt = (entry.notDrawnOn || []).map((e) => e.list.join(' '));
      for (const list of lists) {
        if (exempt.includes(list.join(' '))) continue;
        const styled = styledClasses(readSheets(list, join(root, 'public')));
        const missing = needed.filter((c) => !styled.has(c));
        if (missing.length) problems.push(`${page} [${list.join(', ')}] draws the question card (${file}) but no sheet it loads styles: ${missing.map((c) => `.${c}`).join(' ')}`);
      }
    }
  }
  return problems;
}

describe('LIN-4549: every surface that draws the question card loads its rules', () => {
  test('the live tree: every drawer is listed, and every page it draws on loads the card\'s rules', () => {
    const problems = guardProblems(ROOT);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
  });

  test('the card draws classes a sheet styles (the check above is not vacuous)', () => {
    const styledAnywhere = styledClasses(allSheets(ROOT));
    const needed = [...cardClasses()].filter((c) => styledAnywhere.has(c));
    for (const c of ['sess-qcard', 'sess-qcard-question', 'sess-qcard-options', 'sess-qcard-input', 'sess-qcard-dismiss', 'sess-qcard-answer']) {
      assert.ok(needed.includes(c), `.${c} is drawn and styled`);
    }
  });

  test('the card\'s rules live once, in style.css: session.css names no .sess-qcard class', () => {
    const [style, session] = readSheets(['/style.css', '/session.css']);
    const card = (sheet) => [...styledClasses([sheet])].filter((c) => /^sess-qcard/.test(c));
    assert.ok(card(style).includes('sess-qcard'), 'style.css styles .sess-qcard');
    assert.deepEqual(card(session), [], 'session.css keeps no card rule (no rule in both sheets)');
  });
});

describe('LIN-4549 guard: the witnesses (a synthetic tree, so each failure is seen)', () => {
  const scratch = [];
  test.after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** A root with the real public/ sheets and leaf, plus the given files. */
  function tree(files) {
    const dir = mkdtempSync(join(tmpdir(), 'lin-4549-guard-'));
    scratch.push(dir);
    const put = (rel, text) => { mkdirSync(join(dir, dirname(rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    for (const f of readdirSync(join(ROOT, 'public'))) if (f.endsWith('.css')) put(`public/${f}`, readFileSync(join(ROOT, 'public', f), 'utf8'));
    put(LEAF, readFileSync(join(ROOT, LEAF), 'utf8'));
    for (const [rel, text] of Object.entries(files)) put(rel, text);
    return dir;
  }
  const PAGE = "export const html = renderPage({ stylesheets: ['/style.css', '/observation.css'] });\n";
  const DRAWER = "import { renderQuestionRecordCard } from '../lib/question-record-card.js';\n";

  test('a new drawing surface not on the list fails', () => {
    const root = tree({ 'public/new-surface.js': DRAWER, 'lib/render-new.js': PAGE });
    const problems = guardProblems(root, {});
    assert.ok(problems.some((p) => p.startsWith('public/new-surface.js draws the question card but is not on DRAWERS')), problems.join('\n'));
  });

  test('a listed surface that stops drawing the card fails (no stale entry)', () => {
    const root = tree({ 'lib/render-new.js': PAGE });
    const problems = guardProblems(root, { 'public/gone.js': { pages: ['lib/render-new.js'] } });
    assert.ok(problems.some((p) => p.startsWith('public/gone.js is on DRAWERS but no longer draws')), problems.join('\n'));
  });

  test('a page whose sheets carry no card rule fails, naming the classes', () => {
    // The real style.css with its card rules taken out: the shape of Observation before the move.
    const root = tree({ 'public/new-surface.js': DRAWER, 'lib/render-new.js': PAGE });
    const style = readFileSync(join(root, 'public/style.css'), 'utf8').replace(/\.sess-qcard/g, '.retired-qcard');
    writeFileSync(join(root, 'public/style.css'), style);
    writeFileSync(join(root, 'public/session.css'), '.sess-qcard { padding: 1rem; }\n.sess-qcard-input { width: 100%; }\n');
    const problems = guardProblems(root, { 'public/new-surface.js': { pages: ['lib/render-new.js'] } });
    assert.ok(problems.some((p) => p.includes('lib/render-new.js [/style.css, /observation.css]') && p.includes('.sess-qcard ') && p.includes('.sess-qcard-input')), problems.join('\n'));
  });

  test('an importer of a lib drawer\'s renderer that is neither its page nor a fragment host fails', () => {
    const section = `${DRAWER}function renderSection() { return renderQuestionRecordCard({}, {}); }\n`;
    const root = tree({
      'lib/section.js': section,
      'lib/render-home.js': `import { renderSection } from './section.js';\n${PAGE}`,
      'lib/render-other.js': `import { renderSection } from './section.js';\n${PAGE}`,
    });
    const problems = guardProblems(root, { 'lib/section.js': { pages: ['lib/render-home.js'] } });
    assert.ok(problems.some((p) => p.startsWith('lib/render-other.js imports renderSection from lib/section.js')), problems.join('\n'));
    assert.ok(!problems.some((p) => p.startsWith('lib/render-home.js imports')), 'the named page is accepted');
  });

  test('reading the card\'s test id in a selector is not drawing it', () => {
    assert.equal(drawsCard("document.querySelectorAll('[data-testid=\"question-record-card\"]')"), false);
    assert.equal(drawsCard('<div data-testid="question-record-card">'), true);
    assert.equal(drawsCard("el.setAttribute('data-testid', 'question-record-card')"), true);
  });

});
