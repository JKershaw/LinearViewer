/**
 * LIN-4492 (plan decision 2a): the mint census. Every call that mints a proxy credential in lib/, routes/ and
 * server.js is found by its CALL, not by a helper's name (the LIN-4468 lesson: a bare `createToken(` is
 * invisible to a helper-name search), and each call site is classified with the origin it mints
 * (`dispatch` or `person`) and the run it carries. A new mint anywhere fails here until it is listed.
 *
 * The scan is AST-based (acorn), so a call in a comment or a string is not counted, and the receiver is read,
 * so the queue-token store's own `createToken` (lib/dispatch-tokens.js) is out of scope by name, not by luck.
 *
 * Two plants prove the scan can fail: a new `proxyTokenStore.createToken(` in a fresh route, and a `personMint(`
 * outside the two person sites.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import * as acorn from 'acorn';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** The calls that mint a proxy credential, and the marker that makes a mint a person's. */
const MINT_CALLS = new Set(['createToken', 'mintGrantBootstrap', 'provisionBootstrapToken', 'provisionResumeCredential', 'attachProxyContext']);
const PERSON_MARKER = 'personMint';

/**
 * Every mint call site, keyed `file | enclosing function | callee`, with its count, its origin and its run source.
 * Origin: `dispatch` (a credential Harbour mints for a dispatched session) or `person` (a credential a person
 * holds). Run source: where the run the credential carries comes from.
 */
const SITE_TABLE = [
  // The dispatch factory's finalize callbacks. The factory allocates the row's id and run before it calls them
  // and hands them both as the third argument (lib/dispatch-factory.js step 7).
  { key: 'lib/chat-tools.js | finalizePrompt | provisionResumeCredential', count: 1, origin: 'dispatch', run: 'factory: the resumed run (a custom send_follow_up)' },
  { key: 'lib/dispatch-entrance.js | finalizePrompt | provisionResumeCredential', count: 1, origin: 'dispatch', run: 'factory: the row\'s own run (stage follow-up) or the resumed run (custom resume)' },
  { key: 'lib/dispatch-entrance.js | finalizePrompt | attachProxyContext', count: 1, origin: 'dispatch', run: 'factory: the launched row\'s own run, none for a kind that starts no run' },
  { key: 'lib/follow-up-dispatch.js | finalizePrompt | provisionResumeCredential', count: 1, origin: 'dispatch', run: 'factory: the row\'s own run or the resumed run' },
  { key: 'routes/workspace-api-feedback.js | finalizePrompt | attachProxyContext', count: 2, origin: 'dispatch', run: 'factory: triage starts a run (its own id); autopilot takes none (kind autopilot, no runRecordId passed)' },
  { key: 'routes/collective.js | finalizePrompt | attachProxyContext', count: 1, origin: 'dispatch', run: 'none: a collective participant is kind custom and starts no run' },
  { key: 'routes/collective.js | finalizePrompt | provisionBootstrapToken', count: 1, origin: 'dispatch', run: 'none: as the attach above' },
  // The helpers and the preamble's mints (lib/proxy-preamble.js). They take `runRecordId` from their caller.
  { key: 'lib/proxy-preamble.js | provisionBootstrapToken | createToken', count: 1, origin: 'dispatch', run: 'param: the runRecordId its caller passed (none by default)' },
  { key: 'lib/proxy-preamble.js | provisionBootstrapToken | mintGrantBootstrap', count: 1, origin: 'dispatch', run: 'param: the runRecordId its caller passed (none by default)' },
  { key: 'lib/proxy-preamble.js | attachProxyContext | provisionBootstrapToken', count: 1, origin: 'dispatch', run: 'internal: attachProxyContext\'s runRecordId' },
  { key: 'lib/proxy-preamble.js | provisionResumeCredential | attachProxyContext', count: 2, origin: 'dispatch', run: 'internal: provisionResumeCredential\'s runRecordId' },
  { key: 'lib/proxy-preamble.js | provisionResumeCredential | provisionBootstrapToken', count: 2, origin: 'dispatch', run: 'internal: provisionResumeCredential\'s runRecordId' },
  // The wake: the credential is filed under the parent session's run (stampForWakeParent), as the wake row is.
  { key: 'lib/wake-credential.js | buildWakeCredentialProvisioner | provisionResumeCredential', count: 1, origin: 'dispatch', run: 'the resumed parent session\'s run (stampForWakeParent)' },
  // The runner's refire broker (routes/dispatch.js): the refired row's run, or none for a refire with no row.
  { key: 'routes/dispatch.js | createDispatchRoutes | provisionResumeCredential', count: 1, origin: 'dispatch', run: 'the refired row\'s run (stampFromRow)' },
  { key: 'routes/dispatch.js | createDispatchRoutes | createToken', count: 1, origin: 'dispatch', run: 'the named row\'s run (stampForItem); none without an itemId' },
  // The person's own mints: the owner's runner and agent copies, the tokens page, and the test seams. They act as the
  // person (lib/stage-writes.js personMint), so no run is carried.
  { key: 'routes/proxy-tokens-admin.js | createTokensAdminRoutes | mintGrantBootstrap', count: 1, origin: 'person', run: 'none: a person\'s credential' },
  { key: 'routes/proxy-tokens-admin.js | createTokensAdminRoutes | createToken', count: 1, origin: 'person', run: 'none: a person\'s credential' },
  { key: 'routes/test.js | seedRunnerKey | mintGrantBootstrap', count: 1, origin: 'person', run: 'none: a test seam acting as the owner' },
  { key: 'routes/test.js | createTestRoutes | createToken', count: 1, origin: 'person', run: 'none: a test seam acting as the session account' }
];

/**
 * Calls on a receiver that is NOT the proxy token store: they mint a queue (dispatch) token, which carries no
 * origin or run and is not a proxy credential. Listed with the reason so a new one is a decision, not a silence.
 */
const OUT_OF_SCOPE = [
  { key: 'routes/dispatch.js | createDispatchRoutes | createToken', receiver: 'dispatchTokenStore', count: 1, reason: 'the queue token store (lib/dispatch-tokens.js), not a proxy credential' },
  { key: 'routes/test.js | seedRunnerKey | createToken', receiver: 'dispatchTokenStore', count: 1, reason: 'the e2e queue token' },
  { key: 'routes/test.js | createTestRoutes | createToken', receiver: 'dispatchTokenStore', count: 1, reason: 'the e2e queue token (second seam)' }
];

/** Files that may call the person marker. Only the person sites above, and nothing else in lib/ or routes/. */
const PERSON_FILES = new Set(['routes/proxy-tokens-admin.js', 'routes/test.js']);

/** Every .js/.mjs file under lib/ (except runner-kit, which mints nothing here) and routes/, plus server.js. */
function productionFiles(repo = REPO) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { if (name !== 'runner-kit' && name !== 'node_modules') walk(abs); }
      else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(abs);
    }
  };
  walk(join(repo, 'lib'));
  walk(join(repo, 'routes'));
  out.push(join(repo, 'server.js'));
  return out.map((abs) => ({ file: relative(repo, abs), src: readFileSync(abs, 'utf8') }));
}

/**
 * Scan source files for mint calls. Returns `{ sites: Map<key, count>, outOfScope: Map<key, count>, personCalls: string[] }`.
 * `files` is `[{file, src}]`, so a plant is a synthetic file in the same list.
 */
export function scanMintCalls(files) {
  const sites = new Map();
  const outOfScope = new Map();
  const personCalls = [];
  for (const { file, src } of files) {
    let ast;
    try {
      ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true });
    } catch (err) {
      throw new Error(`mint census cannot parse ${file}: ${err.message}`);
    }
    const stack = [];
    const enclosing = () => {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
      return '(top)';
    };
    (function walk(node) {
      if (!node || typeof node.type !== 'string') return;
      let pushed = false;
      if (node.type === 'FunctionDeclaration' && node.id) { stack.push(node.id.name); pushed = true; }
      else if (node.type === 'VariableDeclarator' && node.id?.name && node.init && /Function|Arrow/.test(node.init.type)) { stack.push(node.id.name); pushed = true; }
      else if (node.type === 'Property' && node.key?.name && node.value && /Function/.test(node.value.type)) { stack.push(node.key.name); pushed = true; }
      else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') { stack.push(null); pushed = true; }
      if (node.type === 'CallExpression') {
        const c = node.callee;
        let callee = null;
        let receiver = '';
        if (c.type === 'Identifier' && (MINT_CALLS.has(c.name) || c.name === PERSON_MARKER)) callee = c.name;
        if (c.type === 'MemberExpression' && !c.computed && c.property?.name && (MINT_CALLS.has(c.property.name) || c.property.name === PERSON_MARKER)) {
          callee = c.property.name;
          receiver = src.slice(c.object.start, c.object.end);
        }
        if (callee === PERSON_MARKER) personCalls.push(`${file} | ${enclosing()}`);
        else if (callee) {
          const key = `${file} | ${enclosing()} | ${callee}`;
          if (receiver === 'dispatchTokenStore') outOfScope.set(key, (outOfScope.get(key) || 0) + 1);
          else sites.set(key, (sites.get(key) || 0) + 1);
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) for (const x of v) walk(x);
        else if (v && typeof v.type === 'string') walk(v);
      }
      if (pushed) stack.pop();
    })(ast);
  }
  return { sites, outOfScope, personCalls };
}

/** The violations of the census against the tables. Empty when the set is exactly what is listed. */
export function censusViolations(files) {
  const v = [];
  const { sites, outOfScope, personCalls } = scanMintCalls(files);
  const byKey = new Map(SITE_TABLE.map(r => [r.key, r]));
  for (const [key, count] of sites) {
    const row = byKey.get(key);
    if (!row) v.push(`unlisted mint site: ${key} (x${count})`);
    else if (row.count !== count) v.push(`count drift: ${key} expected x${row.count}, found x${count}`);
  }
  for (const row of SITE_TABLE) if (!sites.has(row.key)) v.push(`stale table row: ${row.key}`);
  for (const row of OUT_OF_SCOPE) {
    if (!outOfScope.has(row.key)) v.push(`stale out-of-scope row: ${row.key}`);
  }
  for (const [key] of outOfScope) if (!OUT_OF_SCOPE.some(r => r.key === key)) v.push(`unlisted out-of-scope mint: ${key}`);
  for (const call of personCalls) {
    const file = call.split(' | ')[0];
    if (!PERSON_FILES.has(file)) v.push(`person marker outside the person sites: ${call}`);
  }
  return v;
}

describe('LIN-4492: every credential mint call is classified by origin and run', () => {
  test('the production mint set is exactly the table, with its counts', () => {
    assert.deepEqual(censusViolations(productionFiles()), []);
  });

  test('every row names an origin of dispatch or person, and a run source', () => {
    for (const row of SITE_TABLE) {
      assert.ok(['dispatch', 'person'].includes(row.origin), row.key);
      assert.ok(typeof row.run === 'string' && row.run.length > 0, row.key);
    }
  });

  test('the person marker is only spread by the two person files, and the literal origin is only set by the helper', () => {
    const files = productionFiles();
    for (const { file, src } of files) {
      if (file === 'lib/stage-writes.js') continue;
      assert.equal(/origin:\s*'person'/.test(src), false, `${file} sets origin: 'person' by literal; use personMint()`);
    }
  });

  test('appendAutopilotSessionRef is gone from production code (LIN-4492 retires it)', () => {
    for (const { file, src } of productionFiles()) {
      assert.equal(src.includes('appendAutopilotSessionRef'), false, file);
    }
  });

  test('plant: a new proxy-token mint in a fresh route is refused as unlisted', () => {
    const planted = [...productionFiles(), {
      file: 'routes/new-mint.js',
      src: "export function mount(router, proxyTokenStore) {\n  router.post('/api/new-mint', async (req, res) => {\n    const t = await proxyTokenStore.createToken(req.urlKey, { kind: 'bootstrap' });\n    res.json({ t });\n  });\n}\n"
    }];
    const v = censusViolations(planted);
    assert.ok(v.some(m => m.startsWith('unlisted mint site: routes/new-mint.js | mount | createToken')), v.join('\n'));
  });

  test('plant: a bare helper-free mintGrantBootstrap in an existing dispatch file is refused as unlisted', () => {
    const files = productionFiles().map(({ file, src }) => (file === 'lib/chat-tools.js'
      ? { file, src: `${src}\nexport async function rogue(proxyTokenStore, urlKey) {\n  return proxyTokenStore.mintGrantBootstrap({ urlKey, workspaceId: 'w', ownerAccountId: 'o', grants: ['dispatch'] });\n}\n` }
      : { file, src }));
    const v = censusViolations(files);
    assert.ok(v.some(m => m.startsWith('unlisted mint site: lib/chat-tools.js | rogue | mintGrantBootstrap')), v.join('\n'));
  });

  test('plant: the person marker in a dispatch file is refused', () => {
    const files = productionFiles().map(({ file, src }) => (file === 'lib/chat-tools.js'
      ? { file, src: `${src}\nexport const asPerson = (o) => personMint(o);\n` }
      : { file, src }));
    const v = censusViolations(files);
    assert.ok(v.some(m => m.startsWith('person marker outside the person sites: lib/chat-tools.js')), v.join('\n'));
  });

  test('a call in a comment or a string is not a mint', () => {
    const files = [{ file: 'lib/example.js', src: "// proxyTokenStore.createToken(x)\nexport const s = 'proxyTokenStore.createToken(x)';\n" }];
    const { sites } = scanMintCalls(files);
    assert.equal(sites.size, 0);
  });
});
