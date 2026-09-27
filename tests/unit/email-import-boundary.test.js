/**
 * LIN-1892 N6: the email modules sit outside the provider/auth import cycle.
 *
 * Builds the static import graph over `lib/`, `routes/` and `server.js`
 * (`import … from`, side-effect `import '…'`, and `export … from`
 * re-exports; dynamic `import()` is excluded, as in the plan's Q13 sweep),
 * finds its strongly connected components with Tarjan's algorithm, and
 * asserts:
 *   - no new email module is a member of any import cycle;
 *   - `lib/email-availability.js` has zero imports (a leaf, so the navbar and
 *     settings cycle members can import it without growing the cycle);
 *   - `lib/email-auth.js` and `lib/email-transport.js` import no cycle member,
 *     directly or transitively, and nothing beyond their planned imports;
 *   - no cycle member imports an email module other than the leaf predicate
 *     (the router and renderers import downward into the cycle, which is
 *     allowed, because nothing in the cycle imports them back).
 * It also runs the plan's Q15 sweep: only `lib/email-availability.js` and
 * `lib/email-transport.js` may read the four email environment variables.
 *
 * Run with: node --test tests/unit/email-import-boundary.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The new S2 modules.
const EMAIL_MODULES = [
  'lib/email-availability.js',
  'lib/email-transport.js',
  'lib/email-auth.js',
  'routes/email-auth.js',
  'lib/render-email-auth.js',
  'lib/render-account-home.js',
];

// Q13 at 2c00dee3 (reproduced by verdict 0def5b66): the provider/auth SCC.
// If a refactor genuinely breaks this cycle, shrink the list; the test only
// requires these to be in ONE component, as a check that the parser works.
const PROVIDER_AUTH_SCC_Q13 = [
  'lib/account-conflict.js',
  'lib/components/navbar.js',
  'lib/github-install-flow.js',
  'lib/providers/index.js',
  'lib/providers/linear/index.js',
  'lib/providers/github/index.js',
  'lib/providers/github-projects/index.js',
  'lib/providers/jira/index.js',
  'lib/render-pages.js',
  'lib/render-settings.js',
  'lib/render.js',
  'routes/auth.js',
  'routes/github-auth.js',
  'routes/github-projects-auth.js',
  'routes/jira-auth.js',
];

// Q15's four, plus EMAIL_LINK_ORIGIN (the link-origin guard added in beat 2).
const EMAIL_ENV_VARS = ['EMAIL_TRANSPORT', 'EMAIL_PROMPT_STEP', 'RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_LINK_ORIGIN'];
const EMAIL_ENV_READERS = ['lib/email-availability.js', 'lib/email-transport.js'];

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listJsFiles(rel));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const toPosix = p => p.split(sep).join('/');

// `import x from '…'`, `import {…} from '…'` (multi-line), `import '…'`,
// `export {…} from '…'`, `export * from '…'`. A statement must start a line.
const IMPORT_RE = /^[ \t]*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm;

function importSpecifiers(source) {
  return [...source.matchAll(IMPORT_RE)].map(m => m[1]);
}

function buildGraph() {
  const files = [...listJsFiles('lib'), ...listJsFiles('routes'), 'server.js'];
  const known = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const edges = new Set();
    for (const spec of importSpecifiers(source)) {
      if (!spec.startsWith('.')) continue;
      const target = toPosix(relative(ROOT, resolve(ROOT, dirname(file), spec)));
      if (known.has(target)) edges.add(target);
    }
    graph.set(file, [...edges]);
  }
  return graph;
}

// Tarjan's strongly-connected-components algorithm (iterative, so a deep
// import chain can't overflow the stack).
function tarjanScc(graph) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];

  for (const start of graph.keys()) {
    if (indices.has(start)) continue;
    const work = [{ node: start, next: 0 }];
    indices.set(start, index); lowlink.set(start, index); index++;
    stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const edges = graph.get(frame.node) || [];
      if (frame.next < edges.length) {
        const to = edges[frame.next++];
        if (!indices.has(to)) {
          indices.set(to, index); lowlink.set(to, index); index++;
          stack.push(to); onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node), indices.get(to)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(frame.node)));
      }
      if (lowlink.get(frame.node) === indices.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

function transitiveImports(graph, file) {
  const seen = new Set();
  const queue = [...(graph.get(file) || [])];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(graph.get(next) || []));
  }
  return seen;
}

describe('email import boundary (LIN-1892 N6)', () => {
  const graph = buildGraph();
  const components = tarjanScc(graph);
  const cycles = components.filter(c => c.length > 1 || (graph.get(c[0]) || []).includes(c[0]));
  const cycleMembers = new Set(cycles.flat());

  test('the parser sees the known provider/auth cycle (Q13), so the checks below are not vacuous', () => {
    const scc = cycles.find(c => c.includes('lib/providers/index.js'));
    assert.ok(scc, 'lib/providers/index.js is in an import cycle');
    for (const member of PROVIDER_AUTH_SCC_Q13) {
      assert.ok(scc.includes(member), `${member} is in the provider/auth SCC`);
    }
  });

  test('no cycle member imports an email module (so none can be pulled into a cycle)', () => {
    for (const member of cycleMembers) {
      const imported = (graph.get(member) || []).filter(f => EMAIL_MODULES.includes(f) && f !== 'lib/email-availability.js');
      assert.deepStrictEqual(imported, [], `${member} imports ${imported.join(', ')}`);
    }
  });

  test('every email module exists and is in no import cycle', () => {
    for (const file of EMAIL_MODULES) {
      assert.ok(existsSync(join(ROOT, file)), `${file} exists`);
      assert.ok(!cycleMembers.has(file), `${file} must not be in an import cycle`);
    }
  });

  test('lib/email-availability.js has zero imports', () => {
    const source = readFileSync(join(ROOT, 'lib/email-availability.js'), 'utf8');
    assert.deepStrictEqual(importSpecifiers(source), []);
    assert.doesNotMatch(source, /\bimport\s*\(/);
  });

  test('lib/email-transport.js and lib/email-auth.js import only node:crypto and lib/email-availability.js', () => {
    for (const file of ['lib/email-transport.js', 'lib/email-auth.js']) {
      const specs = importSpecifiers(readFileSync(join(ROOT, file), 'utf8'));
      for (const spec of specs) {
        assert.ok(['node:crypto', './email-availability.js'].includes(spec), `${file} imports ${spec}`);
      }
    }
  });

  // The router and renderers may import DOWNWARD into the cycle (e.g.
  // routes/email-auth.js → lib/account-conflict.js); no cycle member imports
  // them, so they sit below it. The three lib/email-* modules may not.
  test('the lib/email-* modules reach no cycle member, directly or transitively', () => {
    for (const file of EMAIL_MODULES.filter(f => f.startsWith('lib/email-'))) {
      const reached = [...transitiveImports(graph, file)].filter(f => cycleMembers.has(f));
      assert.deepStrictEqual(reached, [], `${file} reaches cycle members`);
    }
  });

  test('Q15: only email-availability.js and email-transport.js name the email env variables', () => {
    const pattern = new RegExp(`\\b(${EMAIL_ENV_VARS.join('|')})\\b`);
    const offenders = [...graph.keys()]
      .filter(file => !EMAIL_ENV_READERS.includes(file))
      .filter(file => pattern.test(readFileSync(join(ROOT, file), 'utf8')));
    assert.deepStrictEqual(offenders, [], 'server.js and every other module go through lib/email-availability.js (S2-4)');
  });
});
