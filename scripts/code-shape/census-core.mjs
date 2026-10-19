// Census of decisions held in many places ("specks") — pure core (LIN-3628).
// runCensus is the body of experiments/consolidate-1-census/census.mjs wrapped in a function:
// file contents in, report out. Detectors and thresholds are unchanged except for one addition
// (LIN-3629, detector 5, `cmp`); the git reads, argv and output live in census.mjs. Detectors:
//   1. clone      near-duplicate functions (alpha-renamed structural hash + MinHash/Jaccard)
//   2. set        repeated string sets: array/Set literals and lookup-table keys
//   3. discrim    repeated discriminations: switch / if-chain / ||-chain / ternary-chain
//                 comparing one expression shape against a set of string literals
//                 (2 and 3 share one grouping keyed on the string set, so a status list in one
//                 file and an if-chain over the same statuses in another are one decision)
//   2b. record    repeated record shapes: object literals with >= 5 keys whose key sets agree
//   4. contract   text-protocol contracts: markdown headings / [bracket] markers inside string,
//                 template or regex literals that more than one file writes or parses
//   5. cmp        repeated single comparisons: one subject compared with the same string literal
//                 in more than one file (`x.status === 'blocked'`), unless the comparison is already
//                 inside a set / chain site that the census groups (LIN-3629)
// Nothing in here names anything specific to one codebase.
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';
import { areaOf as areaOfGuide, compileGuide } from './code-shape-lib.mjs';
// ── thresholds (justified in report.md) ─────────────────────────────────────
export const T = {
  cloneMinStatements: 5,        // below this a function is a trivial helper
  cloneMinNodes: 40,            // ... or too few AST nodes to carry a decision
  fuzzyMaxStatements: 60,       // fuzzy pass is for small/medium functions
  shingleK: 5,                  // structural token 5-grams
  fuzzyJaccard: 0.7,            // structural shingle Jaccard for a fuzzy clone edge
  fuzzyVocabJaccard: 0.3,       // ... and at least this much shared vocabulary
  structureOnlyMinStatements: 10, // exact-structure groups with no shared vocabulary rank only above this
  tinyMinNodes: 18,             // tiny pass: 1-4 statement functions with at least this many nodes
  tinyShingleJaccard: 0.5,      // structural 3-gram Jaccard for a tiny-function edge
  tinyVocabJaccard: 0.5,        // ... and IDF-weighted vocabulary Jaccard
  tinyMinFiles: 3,              // a tiny rule counts only when it is in >= 3 files
  vocabMinItems: 8,             // vocabulary pass: at least 8 distinct names/strings
  vocabMaxDf: 300,              // names in more functions than this do not seed candidates
  vocabJaccard: 0.6,            // IDF-weighted vocabulary Jaccard for a dialect-copy edge
  vocabSizeRatio: 0.5,          // ... between functions within 2x of each other's size
  setMinMembers: 2,
  setMergeJaccard: 0.66,        // merge string sets of size >= 3 at this Jaccard (one member drift)
  literalRecordMinPairs: 3,     // literal records: >= 3 identical key=value pairs
  recordMinKeys: 3,            // >= 3 derived key=source pairs
  recordJaccard: 0.7,
  minFiles: 2,
};

// files: { path: text } (already scoped); areaMap: seams-format area map or null;
// fileCommits: Map<path, Set<commit>> for the churn window (see churnByFile).
export function runCensus({ files, areaMap = null, fileCommits = new Map(), commit, commitDate, churnDays = 90, repo = null }) {
  const paths = Object.keys(files).sort();
  const areaGuide = areaMap ? compileGuide(areaMap) : null;
  const areaOf = (p) => areaOfGuide(areaGuide, p);
  const churnOf = (fs) => { const s = new Set(); for (const f of fs) for (const c of fileCommits.get(f) || []) s.add(c); return s.size; };
  // ── parse ────────────────────────────────────────────────────────────────────
  const parseErrors = [];
  const parseSource = (text) => {
    let err;
    for (const sourceType of ['module', 'script']) {
      try {
        return acorn.parse(text, {
          ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true,
          allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
        });
      } catch (e) { err = e; }
    }
    throw err;
  };
  const SKIP = new Set(['type', 'start', 'end', 'loc', 'range', 'raw', 'sourceType']);
  const children = (node) => {
    const out = [];
    for (const k of Object.keys(node)) {
      if (SKIP.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') out.push(c); }
      else if (v && typeof v.type === 'string') out.push(v);
    }
    return out;
  };
  const walk = (node, enter, parent = null) => {
    if (enter(node, parent) === false) return;
    for (const c of children(node)) walk(c, enter, node);
  };
  const isFn = (n) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

  const asts = {};
  for (const p of paths) {
    try { asts[p] = parseSource(files[p]); } catch (e) { parseErrors.push({ file: p, error: String(e.message) }); }
  }

  // ── constant resolution (generic constant propagation for string literals) ──
  // Per file: `const NAME = 'str'` and `const OBJ = { KEY: 'str' }` (so OBJ.KEY resolves).
  // Across files: exported names whose every definition agrees (resolves imported constants
  // without a module resolver; ambiguous names are dropped).
  const fileConsts = {};
  const globalDefs = new Map();
  for (const [p, ast] of Object.entries(asts)) {
    const m = new Map();
    walk(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
        if (n.init.type === 'Literal' && typeof n.init.value === 'string') m.set(n.id.name, n.init.value);
        else if (n.init.type === 'TemplateLiteral' && n.init.expressions.length === 0) m.set(n.id.name, n.init.quasis[0].value.cooked);
        else if (n.init.type === 'ObjectExpression') {
          for (const pr of n.init.properties) {
            if (pr.type === 'Property' && !pr.computed && pr.value.type === 'Literal' && typeof pr.value.value === 'string') {
              const key = pr.key.type === 'Identifier' ? pr.key.name : String(pr.key.value);
              m.set(`${n.id.name}.${key}`, pr.value.value);
            }
          }
        }
      }
    });
    fileConsts[p] = m;
    for (const [k, v] of m) { if (!globalDefs.has(k)) globalDefs.set(k, new Set()); globalDefs.get(k).add(v); }
  }
  const globalConsts = new Map([...globalDefs].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
  const strOf = (p, n) => {
    if (!n) return null;
    if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
    let key = null;
    if (n.type === 'Identifier') key = n.name;
    else if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.property.type === 'Identifier') key = `${n.object.name}.${n.property.name}`;
    if (key == null) return null;
    return fileConsts[p]?.get(key) ?? globalConsts.get(key) ?? null;
  };

  // ── detector 1: functions ────────────────────────────────────────────────────
  const fnName = (fn, parent) => {
    if (fn.id?.name) return fn.id.name;
    if (!parent) return '(anonymous)';
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key) {
      return parent.key.type === 'Identifier' ? parent.key.name : String(parent.key.value ?? '(computed)');
    }
    if (parent.type === 'AssignmentExpression') {
      const l = parent.left;
      if (l.type === 'MemberExpression' && !l.computed) return l.property.name;
      if (l.type === 'Identifier') return l.name;
    }
    return '(anonymous)';
  };

  const countStatements = (fn) => {
    if (fn.body.type !== 'BlockStatement') return 1;
    let n = 0;
    walk(fn.body, (x) => { if (/Statement$|Declaration$/.test(x.type) && x.type !== 'BlockStatement') n++; });
    return n;
  };

  // Serialise a function: identifiers alpha-renamed by first occurrence (property names included,
  // so a rename of anything cannot change the hash), literals replaced by their type.
  // Also returns the structural token stream (for shingles) and the vocabulary (names/strings).
  const normalise = (fn) => {
    const names = new Map();
    const parts = [];
    const tokens = [];
    const vocab = new Set();
    let nodes = 0;
    const visit = (n, parent, key) => {
      nodes++;
      switch (n.type) {
        case 'Identifier': {
          if (!names.has(n.name)) names.set(n.name, names.size);
          parts.push(`$${names.get(n.name)}`);
          tokens.push('I');
          const isProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent.type === 'Property' && key === 'key'));
          const isCallee = parent && parent.type === 'CallExpression' && key === 'callee';
          if (isProp || isCallee) vocab.add(n.name);
          if (parent && parent.type === 'NewExpression' && key === 'callee') vocab.add(`new ${n.name}`);
          if (parent && parent.type === 'BinaryExpression' && parent.operator === 'instanceof' && key === 'right') vocab.add(`instanceof ${n.name}`);
          return;
        }
        case 'PrivateIdentifier': parts.push('#'); tokens.push('I'); return;
        case 'Literal': {
          const t = n.regex ? 'R' : n.value === null ? 'null' : typeof n.value;
          parts.push(`L:${t}`); tokens.push(`L${t}`);
          if (typeof n.value === 'string' && n.value.length > 1 && n.value.length < 60) vocab.add(`'${n.value}`);
          return;
        }
        case 'TemplateElement': parts.push('T'); tokens.push('T'); return;
        default: break;
      }
      const op = n.operator ? `:${n.operator}` : '';
      const kind = n.kind && typeof n.kind === 'string' ? `:${n.kind}` : '';
      tokens.push(n.type + op);
      parts.push(`(${n.type}${op}${kind}${n.async ? ':a' : ''}${n.computed ? ':c' : ''}${n.optional ? ':o' : ''}`);
      for (const k of Object.keys(n)) {
        if (SKIP.has(k)) continue;
        const v = n[k];
        if (Array.isArray(v)) { parts.push('['); for (const c of v) { if (c && typeof c.type === 'string') visit(c, n, k); else parts.push('_'); } parts.push(']'); }
        else if (v && typeof v.type === 'string') visit(v, n, k);
      }
      parts.push(')');
    };
    // The function's own name is not part of its shape.
    for (const prm of fn.params) visit(prm, fn, 'params');
    visit(fn.body, fn, 'body');
    const text = parts.join(' ');
    return { hash: createHash('sha1').update(`${fn.async ? 'a' : ''}${fn.generator ? 'g' : ''}|${text}`).digest('hex').slice(0, 16), tokens, vocab, nodes };
  };

  const h32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const shingles = (tokens) => {
    const s = new Set();
    for (let i = 0; i + T.shingleK <= tokens.length; i++) s.add(h32(tokens.slice(i, i + T.shingleK).join(' ')));
    if (!s.size) s.add(h32(tokens.join(' ')));
    return s;
  };
  const jaccard = (a, b) => {
    if (!a.size && !b.size) return 1;
    let i = 0; const [sm, lg] = a.size < b.size ? [a, b] : [b, a];
    for (const x of sm) if (lg.has(x)) i++;
    return i / (a.size + b.size - i);
  };

  const fns = [];
  const tiny = [];
  const filtered = { trivialFunctions: 0, iifeWrappers: 0, sameFileOnlyCloneGroups: 0 };
  for (const [p, ast] of Object.entries(asts)) {
    walk(ast, (n, parent) => {
      if (!isFn(n)) return;
      // An IIFE wrapper (a whole browser file inside one function) is a module, not a decision.
      if (parent?.type === 'CallExpression' && parent.callee === n && n.loc.end.line - n.loc.start.line > 200) { filtered.iifeWrappers++; return; }
      const statements = countStatements(n);
      const norm = normalise(n);
      if (statements < T.cloneMinStatements || norm.nodes < T.cloneMinNodes) {
        // Tiny helpers are noise one pair at a time, but a tiny rule copied into many files
        // (a tolerant timestamp parse, a normaliser) is exactly a speck: keep them for the tiny pass.
        if (norm.nodes >= T.tinyMinNodes) tiny.push({ file: p, line: n.loc.start.line, name: fnName(n, parent), statements, ...norm });
        else filtered.trivialFunctions++;
        return;
      }
      fns.push({ file: p, line: n.loc.start.line, name: fnName(n, parent), statements, ...norm });
    });
  }

  // Union-find over functions.
  const uf = fns.map((_, i) => i);
  const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) uf[b] = a; };
  const edgeKind = new Map();
  const dialectPairs = new Set();
  {
    const byHash = new Map();
    fns.forEach((f, i) => { if (!byHash.has(f.hash)) byHash.set(f.hash, []); byHash.get(f.hash).push(i); });
    for (const ids of byHash.values()) for (let k = 1; k < ids.length; k++) unite(ids[0], ids[k]);
  }
  // Fuzzy pass: MinHash (64 hashes) + LSH (16 bands x 4 rows) for candidates, exact Jaccard to verify.
  let fuzzyEdges = 0;
  {
    const NH = 64, B = 16, R = 4;
    const seeds = Array.from({ length: NH }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0) ^ 0x5bd1e995);
    const small = fns.map((f, i) => i).filter((i) => fns[i].statements <= T.fuzzyMaxStatements);
    const sh = new Map(small.map((i) => [i, shingles(fns[i].tokens)]));
    const buckets = new Map();
    for (const i of small) {
      const sig = new Array(NH).fill(0xffffffff);
      for (const x of sh.get(i)) for (let j = 0; j < NH; j++) { const v = (Math.imul(x ^ seeds[j], 0x9e3779b1) >>> 0); if (v < sig[j]) sig[j] = v; }
      for (let b = 0; b < B; b++) {
        const key = `${b}:${sig.slice(b * R, b * R + R).join(',')}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(i);
      }
    }
    const seen = new Set();
    for (const ids of buckets.values()) {
      if (ids.length < 2 || ids.length > 400) continue;
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const x = ids[a], y = ids[b];
        if (fns[x].file === fns[y].file) continue;
        const pk = x < y ? `${x},${y}` : `${y},${x}`;
        if (seen.has(pk)) continue; seen.add(pk);
        if (fns[x].hash === fns[y].hash) continue;
        const j = jaccard(sh.get(x), sh.get(y));
        if (j < T.fuzzyJaccard) continue;
        if (jaccard(fns[x].vocab, fns[y].vocab) < T.fuzzyVocabJaccard) continue;
        unite(x, y); fuzzyEdges++;
        edgeKind.set(pk, j);
      }
    }
  }

  // Vocabulary pass: dialect-translated copies (a browser ES5 port of a server function, Map → {} ,
  // for-of → indexed loop) share almost no structure but keep the same property names, callees and
  // strings. IDF-weighted vocabulary Jaccard, so `push`/`length` weigh little and `blocksIds` a lot.
  let vocabEdges = 0;
  {
    const df = new Map();
    for (const f of fns) for (const v of f.vocab) df.set(v, (df.get(v) || 0) + 1);
    const N = fns.length;
    const w = (v) => Math.log(N / (df.get(v) || 1));
    const inv = new Map();
    fns.forEach((f, i) => { if (f.vocab.size < T.vocabMinItems) return; for (const v of f.vocab) if (df.get(v) <= T.vocabMaxDf) { if (!inv.has(v)) inv.set(v, []); inv.get(v).push(i); } });
    const wsum = fns.map((f) => { let t = 0; for (const v of f.vocab) t += w(v); return t; });
    for (let i = 0; i < fns.length; i++) {
      const a = fns[i];
      if (a.vocab.size < T.vocabMinItems) continue;
      const cand = new Set();
      for (const v of a.vocab) for (const j of inv.get(v) || []) if (j > i && fns[j].file !== a.file) cand.add(j);
      for (const j of cand) {
        const b = fns[j];
        if (find(i) === find(j)) continue;
        const ratio = Math.min(a.statements, b.statements) / Math.max(a.statements, b.statements);
        if (ratio < T.vocabSizeRatio) continue;
        let inter = 0;
        for (const v of a.vocab) if (b.vocab.has(v)) inter += w(v);
        const J = inter / (wsum[i] + wsum[j] - inter);
        if (J >= T.vocabJaccard) { unite(i, j); vocabEdges++; dialectPairs.add(i < j ? `${i},${j}` : `${j},${i}`); }
      }
    }
  }

  // Tiny pass.
  const tinyGroups = [];
  {
    const df = new Map();
    for (const f of tiny) for (const v of f.vocab) df.set(v, (df.get(v) || 0) + 1);
    const N = tiny.length;
    const w = (v) => Math.log((N + 1) / (df.get(v) || 1));
    const sh3 = tiny.map((f) => { const s = new Set(); for (let i = 0; i + 3 <= f.tokens.length; i++) s.add(h32(f.tokens.slice(i, i + 3).join(' '))); return s; });
    const wsum = tiny.map((f) => { let t = 0; for (const v of f.vocab) t += w(v); return t; });
    const par = tiny.map((_, i) => i);
    const tf = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const byHash = new Map();
    tiny.forEach((f, i) => { if (byHash.has(f.hash)) par[tf(i)] = tf(byHash.get(f.hash)); else byHash.set(f.hash, i); });
    const inv = new Map();
    tiny.forEach((f, i) => { for (const v of f.vocab) if (df.get(v) <= T.vocabMaxDf) { if (!inv.has(v)) inv.set(v, []); inv.get(v).push(i); } });
    for (let i = 0; i < tiny.length; i++) {
      const cand = new Set();
      for (const v of tiny[i].vocab) for (const j of inv.get(v) || []) if (j > i && tiny[j].file !== tiny[i].file) cand.add(j);
      for (const j of cand) {
        if (tf(i) === tf(j)) continue;
        let inter = 0;
        for (const v of tiny[i].vocab) if (tiny[j].vocab.has(v)) inter += w(v);
        if (inter / (wsum[i] + wsum[j] - inter) < T.tinyVocabJaccard) continue;
        if (jaccard(sh3[i], sh3[j]) < T.tinyShingleJaccard) continue;
        par[tf(j)] = tf(i);
      }
    }
    const comp = new Map();
    tiny.forEach((f, i) => { const r = tf(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(f); });
    for (const members of comp.values()) {
      const fs = new Set(members.map((m) => m.file));
      if (fs.size < T.tinyMinFiles) { filtered.trivialFunctions += members.length; continue; }
      tinyGroups.push(members);
    }
  }

  const groups = [];
  for (const members of tinyGroups) {
    const names = [...new Set(members.map((m) => m.name))];
    const top = names.sort((a, b) => members.filter((m) => m.name === b).length - members.filter((m) => m.name === a).length)[0];
    groups.push({
      detector: 'clone',
      decision: `tiny rule copied as a helper ${top}()${names.length > 1 ? ` (also: ${names.filter((n) => n !== top).slice(0, 4).join(', ')})` : ''}, ${members.length} copies of 1-4 statements`,
      match: 'tiny',
      structureOnly: false,
      statements: Math.max(...members.map((m) => m.statements)),
      sites: members.map((m) => ({ file: m.file, line: m.line, name: m.name, statements: m.statements })),
    });
  }
  const mode = (arr) => { const c = new Map(); for (const a of arr) c.set(a, (c.get(a) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]; };
  {
    const comp = new Map();
    fns.forEach((f, i) => { const r = find(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
    for (const ids of comp.values()) {
      if (ids.length < 2) continue;
      const fs = new Set(ids.map((i) => fns[i].file));
      if (fs.size < T.minFiles) { filtered.sameFileOnlyCloneGroups++; continue; }
      const members = ids.map((i) => fns[i]);
      const exact = new Set(members.map((m) => m.hash)).size === 1;
      const viaVocab = ids.some((x) => ids.some((y) => dialectPairs.has(`${x},${y}`)));
      // Shared vocabulary across the group (pairwise min against the first member).
      let vocabMin = 1;
      for (let k = 1; k < members.length; k++) vocabMin = Math.min(vocabMin, jaccard(members[0].vocab, members[k].vocab));
      const names = [...new Set(members.map((m) => m.name))];
      const stmts = members.map((m) => m.statements).sort((a, b) => a - b);
      groups.push({
        detector: 'clone',
        decision: `near-duplicate function ${mode(members.map((m) => m.name))}()${names.length > 1 ? ` (also: ${names.filter((n) => n !== mode(members.map((m) => m.name))).slice(0, 4).join(', ')})` : ''}, ~${stmts[Math.floor(stmts.length / 2)]} statements${exact ? ', structurally identical' : viaVocab ? ', same vocabulary (dialect copy or close variant)' : ', fuzzy'}`,
        match: exact ? 'exact-structure' : viaVocab ? 'fuzzy+vocabulary' : 'fuzzy',
        structureOnly: vocabMin < 0.2,
        statements: stmts[Math.floor(stmts.length / 2)],
        sites: members.map((m) => ({ file: m.file, line: m.line, name: m.name, statements: m.statements })),
      });
    }
  }

  // ── detectors 2 + 3: string sets and discriminations ─────────────────────────
  const setSites = [];   // { file, line, kind, members:[...], label, shape }
  const shapeOf = (n) => {
    if (!n) return '?';
    switch (n.type) {
      case 'Identifier': return 'ID';
      case 'ThisExpression': return 'this';
      case 'MemberExpression': return n.computed ? `${shapeOf(n.object)}[]` : `${shapeOf(n.object)}.${n.property.name ?? '#'}`;
      case 'ChainExpression': return shapeOf(n.expression);
      case 'CallExpression': return `${shapeOf(n.callee)}()`;
      case 'UnaryExpression': return `${n.operator}${shapeOf(n.argument)}`;
      default: return n.type;
    }
  };
  const tailShape = (s) => { const m = s.match(/\.([^.\[\]()]+)(\(\))?$/); return m ? `.${m[1]}${m[2] || ''}` : s; };
  const declLabel = (parent, grand) => {
    if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
    if (parent?.type === 'NewExpression' && grand?.type === 'VariableDeclarator' && grand.id.type === 'Identifier') return grand.id.name;
    if (parent?.type === 'Property' && parent.key) return parent.key.name ?? String(parent.key.value);
    if (parent?.type === 'MemberExpression') return `[...].${parent.property?.name ?? '?'}`;
    return null;
  };
  const isEq = (op) => op === '===' || op === '==' || op === '!==' || op === '!=';
  // A comparison `E op 'lit'` (either side), returns { shape, value } or null.
  const cmpOf = (p, n) => {
    if (n.type === 'ChainExpression') n = n.expression;
    if (n.type !== 'BinaryExpression' || !isEq(n.operator)) return null;
    const ls = strOf(p, n.left), rs = strOf(p, n.right);
    if (rs != null && ls == null) return { shape: shapeOf(n.left), value: rs, node: n };
    if (ls != null && rs == null) return { shape: shapeOf(n.right), value: ls, node: n };
    return null;
  };
  // cmpOf plus the subject node and the comparison node (for `cmp`, LIN-3629).
  const cmpDetail = (p, n) => {
    if (n.type === 'ChainExpression') n = n.expression;
    const c = cmpOf(p, n);
    if (!c) return null;
    return { ...c, node: n, subject: strOf(p, n.left) != null && strOf(p, n.right) == null ? n.right : n.left };
  };
  // The subject's last name: `a.b.status` and `status` and `getStatus()` read as status / getStatus().
  // A subject that is neither a name, a property nor a call has no name worth a key.
  const subjectName = (n) => {
    if (n.type === 'ChainExpression') return subjectName(n.expression);
    if (n.type === 'Identifier') return n.name;
    if (n.type === 'MemberExpression' && !n.computed && n.property.name) return n.property.name;
    if (n.type === 'CallExpression') { const c = subjectName(n.callee); return c ? `${c}()` : null; }
    return null;
  };
  // `ARR.includes(E)` / `SET.has(E)` with an inline literal receiver is already an array site.
  const flattenLogical = (n, out) => {
    if (n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '&&')) { flattenLogical(n.left, out); flattenLogical(n.right, out); }
    else if (n.type === 'ParenthesizedExpression') flattenLogical(n.expression, out);
    else out.push(n);
    return out;
  };
  // `nodes` are the comparison nodes a site covers, so `cmp` can skip what a grouped site already counts.
  const pushDiscrim = (p, line, kind, cmps) => {
    const byShape = new Map();
    for (const c of cmps) { if (!c) continue; const k = c.shape; if (!byShape.has(k)) byShape.set(k, { vals: new Set(), nodes: [] }); byShape.get(k).vals.add(c.value); byShape.get(k).nodes.push(c.node); }
    for (const [shape, { vals, nodes }] of byShape) if (vals.size >= T.setMinMembers) setSites.push({ file: p, line, kind, members: [...vals], label: shape, shape: tailShape(shape), nodes });
  };

  // Names used as maps: NAME[expr] with a non-literal key, `x in NAME`, Object.keys/values/entries(NAME).
  const mapUses = new Map();
  const filteredLiteralRecords = { count: 0 };
  const literalRecords = [];
  const cmpCands = [];   // { file, line, name, value, node } — every comparison against a string literal
  for (const [p, ast] of Object.entries(asts)) {
    const s = new Set();
    walk(ast, (n) => {
      if (n.type === 'MemberExpression' && n.computed && n.object.type === 'Identifier' && !(n.property.type === 'Literal')) s.add(n.object.name);
      if (n.type === 'BinaryExpression' && n.operator === 'in' && n.right.type === 'Identifier') s.add(n.right.name);
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Object' &&
        ['keys', 'values', 'entries', 'hasOwn'].includes(n.callee.property.name) && n.arguments[0]?.type === 'Identifier') s.add(n.arguments[0].name);
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.property.name === 'hasOwnProperty') s.add(n.callee.object.name);
    });
    mapUses.set(p, s);
  }
  for (const [p, ast] of Object.entries(asts)) {
    const consumedLogical = new Set();
    const consumedIf = new Set();
    const consumedCond = new Set();
    const stack = [];
    const visit = (n, parent) => {
      stack.push(n);
      const grand = stack[stack.length - 3];
      const line = n.loc.start.line;
      if (n.type === 'ArrayExpression' && n.elements.length >= T.setMinMembers) {
        const vals = n.elements.map((e) => (e && e.type !== 'SpreadElement' ? strOf(p, e) : null));
        if (vals.every((v) => v != null)) {
          const isSet = parent?.type === 'NewExpression' && parent.callee.type === 'Identifier' && parent.callee.name === 'Set';
          setSites.push({ file: p, line, kind: isSet ? 'Set' : 'array', members: [...new Set(vals)], label: declLabel(isSet ? parent : parent, isSet ? grand : stack[stack.length - 3]) });
        }
      }
      if (n.type === 'ObjectExpression' && n.properties.length >= T.setMinMembers) {
        const keys = [];
        let allLiteralValues = true;
        for (const pr of n.properties) {
          if (pr.type !== 'Property' || pr.kind !== 'init' || pr.method) { allLiteralValues = false; break; }
          let k = null;
          if (!pr.computed) k = pr.key.type === 'Identifier' ? pr.key.name : String(pr.key.value);
          else k = strOf(p, pr.key);
          if (k == null) { allLiteralValues = false; break; }
          keys.push(k);
          const v = pr.value;
          const lit = v.type === 'Literal' || (v.type === 'TemplateLiteral' && v.expressions.length === 0) || (v.type === 'UnaryExpression' && v.argument.type === 'Literal') || strOf(p, v) != null;
          if (!lit) allLiteralValues = false;
        }
        // Lookup tables: every value a literal AND the object is bound to a name that the file indexes
        // with a computed key (NAME[x]) or enumerates (Object.keys/values/entries/in) — so the keys ARE a
        // domain set (status → rank, kind → label), not just a record that happens to hold literals.
        const bound = parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : null;
        if (allLiteralValues && keys.length >= T.setMinMembers && bound && mapUses.get(p)?.has(bound)) {
          setSites.push({ file: p, line, kind: 'table-keys', members: keys, label: bound });
        } else if (allLiteralValues && keys.length >= T.setMinMembers) {
          // Not a map: a literal record. It is a decision only when the same key=value pairs repeat
          // verbatim (an SSE header preamble, a fetch option bag), handled by the literal-record pass.
          const pairs = n.properties.map((pr, i) => `${keys[i]}=${pr.value.type === 'Literal' ? JSON.stringify(pr.value.value) : strOf(p, pr.value) != null ? JSON.stringify(strOf(p, pr.value)) : '?'}`);
          if (pairs.length >= T.literalRecordMinPairs && !pairs.some((x) => x.endsWith('=?'))) literalRecords.push({ file: p, line, key: [...pairs].sort().join(', ') });
          else filteredLiteralRecords.count++;
        }
      }
      if (n.type === 'SwitchStatement') {
        const vals = n.cases.map((c) => (c.test ? strOf(p, c.test) : null)).filter((v) => v != null);
        if (new Set(vals).size >= T.setMinMembers) setSites.push({ file: p, line, kind: 'switch', members: [...new Set(vals)], label: shapeOf(n.discriminant), shape: tailShape(shapeOf(n.discriminant)), nodes: n.cases.filter((c) => c.test && strOf(p, c.test) != null) });
        const name = subjectName(n.discriminant);
        if (name && n.discriminant.type !== 'UnaryExpression') {
          for (const c of n.cases) { const v = c.test ? strOf(p, c.test) : null; if (v != null) cmpCands.push({ file: p, line: c.loc.start.line, name, value: v, node: c }); }
        }
      }
      if (n.type === 'BinaryExpression' && isEq(n.operator)) {
        const c = cmpDetail(p, n);
        const name = c && subjectName(c.subject);
        if (name) cmpCands.push({ file: p, line, name, value: c.value, node: n });
      }
      if (n.type === 'LogicalExpression' && !consumedLogical.has(n)) {
        const leaves = flattenLogical(n, []);
        const markAll = (x) => { if (x.type === 'LogicalExpression') { consumedLogical.add(x); markAll(x.left); markAll(x.right); } };
        markAll(n);
        pushDiscrim(p, line, 'or-chain', leaves.map((l) => cmpOf(p, l)));
      }
      if (n.type === 'IfStatement' && !consumedIf.has(n)) {
        const cmps = [];
        let cur = n;
        while (cur && cur.type === 'IfStatement') {
          consumedIf.add(cur);
          const leaves = flattenLogical(cur.test, []);
          if (leaves.length === 1) cmps.push(cmpOf(p, leaves[0]));
          cur = cur.alternate;
        }
        if (cmps.filter(Boolean).length >= 2) pushDiscrim(p, line, 'if-chain', cmps);
      }
      if (n.type === 'ConditionalExpression' && !consumedCond.has(n)) {
        const cmps = [];
        let cur = n;
        while (cur && cur.type === 'ConditionalExpression') { consumedCond.add(cur); cmps.push(cmpOf(p, cur.test)); cur = cur.alternate; }
        if (cmps.filter(Boolean).length >= 2) pushDiscrim(p, line, 'ternary-chain', cmps);
      }
      for (const c of children(n)) visit(c, n);
      stack.pop();
    };
    visit(ast, null);
  }

  // Noise filter for sets: members that carry no domain meaning.
  const noiseMember = (s) => s.trim().length === 0 || /^[\s\W]$/.test(s);
  const filteredSets = { emptyOrPunctuation: 0, singleFile: 0 };
  const groupedNodes = new Set();   // comparison nodes inside a site that became a group
  const cleanSites = setSites.filter((s) => {
    s.members = s.members.filter((m) => !noiseMember(m));
    if (s.members.length < T.setMinMembers) { filteredSets.emptyOrPunctuation++; return false; }
    return true;
  });
  // Group: exact canonical set first, then merge sets of size >= 3 at Jaccard >= setMergeJaccard.
  {
    const canon = new Map();
    for (const s of cleanSites) { const k = [...s.members].sort().join('\u0001'); if (!canon.has(k)) canon.set(k, []); canon.get(k).push(s); }
    const keys = [...canon.keys()];
    const sets = keys.map((k) => new Set(k.split('\u0001')));
    const parent = keys.map((_, i) => i);
    const f = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    // Only merge canonical sets that themselves appear in at least one site, using an inverted index.
    const inv = new Map();
    sets.forEach((s, i) => { if (s.size < 3) return; for (const m of s) { if (!inv.has(m)) inv.set(m, []); inv.get(m).push(i); } });
    for (let i = 0; i < sets.length; i++) {
      if (sets[i].size < 3) continue;
      const cand = new Set();
      for (const m of sets[i]) for (const j of inv.get(m) || []) if (j > i) cand.add(j);
      for (const j of cand) if (jaccard(sets[i], sets[j]) >= T.setMergeJaccard) { const a = f(i), b = f(j); if (a !== b) parent[b] = a; }
    }
    const comps = new Map();
    keys.forEach((k, i) => { const r = f(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(...canon.get(k)); });
    for (const sites of comps.values()) {
      const fs = new Set(sites.map((s) => s.file));
      if (fs.size < T.minFiles) { filteredSets.singleFile++; continue; }
      for (const s of sites) for (const x of s.nodes || []) groupedNodes.add(x);
      // Core = members present in at least half the sites.
      const cnt = new Map();
      for (const s of sites) for (const m of new Set(s.members)) cnt.set(m, (cnt.get(m) || 0) + 1);
      const core = [...cnt].filter(([, c]) => c >= sites.length / 2).map(([m]) => m).sort();
      const kinds = [...new Set(sites.map((s) => s.kind))];
      const discrimKinds = kinds.filter((k) => ['switch', 'or-chain', 'if-chain', 'ternary-chain'].includes(k));
      const labels = [...new Set(sites.map((s) => s.label).filter((l) => l && !/^ID$|^\?$/.test(l)))];
      const detectors = [];
      if (kinds.some((k) => ['array', 'Set', 'table-keys'].includes(k))) detectors.push('set');
      if (discrimKinds.length) detectors.push('discrim');
      const shapes = [...new Set(sites.filter((s) => s.shape).map((s) => s.shape))];
      groups.push({
        detector: detectors.join('+'),
        decision: `string set {${core.slice(0, 6).map((m) => `'${m.length > 40 ? `${m.slice(0, 37)}...` : m}'`).join(', ')}${core.length > 6 ? `, +${core.length - 6}` : ''}} as ${kinds.join('/')}${labels.length ? ` [${labels.slice(0, 3).join(', ')}]` : ''}`,
        match: new Set(sites.map((s) => [...s.members].sort().join('\u0001'))).size === 1 ? 'exact-set' : 'near-set',
        members: core,
        shapes,
        sites: sites.map((s) => ({ file: s.file, line: s.line, kind: s.kind, label: s.label ?? null, size: s.members.length })),
      });
    }
  }

  // ── detector 5: repeated single comparisons (LIN-3629) ──────────────────────
  // `x.status === 'blocked'` in several files is one decision with a single member, below the set
  // detector's two-member floor. A comparison already inside a grouped set or chain site is that
  // group's, so it is not counted again; a chain that never formed a group hides nothing.
  // `typeof` checks are not decisions about the domain and are never candidates (their subject is a
  // UnaryExpression, which has no name). The same name on two different objects is one key: the
  // review rules on that noise.
  {
    const by = new Map();
    for (const c of cmpCands) {
      if (groupedNodes.has(c.node) || noiseMember(c.value)) continue;
      const key = `${c.name}\u0001${c.value}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(c);
    }
    for (const cs of by.values()) {
      if (new Set(cs.map((c) => c.file)).size < T.minFiles) continue;
      const { name, value } = cs[0];
      groups.push({
        detector: 'cmp',
        decision: `repeated comparison ${name} == '${value.length > 40 ? `${value.slice(0, 37)}...` : value}'`,
        match: 'exact-comparison',
        subject: name,
        value,
        sites: cs.map((c) => ({ file: c.file, line: c.line, label: name })),
      });
    }
  }

  // Literal records repeated verbatim.
  {
    const by = new Map();
    for (const r of literalRecords) { if (!by.has(r.key)) by.set(r.key, []); by.get(r.key).push(r); }
    for (const [key, sites] of by) {
      if (new Set(sites.map((x) => x.file)).size < T.minFiles) continue;
      groups.push({ detector: 'record', decision: `literal record repeated verbatim {${key.length > 120 ? `${key.slice(0, 117)}...` : key}}`, match: 'exact-literal', sites: sites.map((x) => ({ file: x.file, line: x.line })) });
    }
  }

  // ── detector 2b: record shapes ────────────────────────────────────────────────
  // Source of a value: callee names are kept (they ARE the source), root variables become ID.
  const valueSource = (n) => {
    switch (n.type) {
      case 'Identifier': return 'ID';
      case 'ThisExpression': return 'this';
      case 'AwaitExpression': return `await ${valueSource(n.argument)}`;
      case 'ChainExpression': return valueSource(n.expression);
      case 'MemberExpression': return n.computed ? `${valueSource(n.object)}[]` : `${valueSource(n.object)}.${n.property.name ?? '#'}`;
      case 'CallExpression': return `${n.callee.type === 'Identifier' ? n.callee.name : valueSource(n.callee)}()`;
      default: return n.type;
    }
  };
  const recordSites = [];
  for (const [p, ast] of Object.entries(asts)) {
    walk(ast, (n) => {
      if (n.type !== 'ObjectExpression' || n.properties.length < T.recordMinKeys) return;
      // A record is "assembled the same way" when the same keys are filled from the same sources.
      // Only DERIVED values count (a call or a member chain: `deployInfo: getDeployInfo()`,
      // `urlKey: workspace.urlKey`); shorthand/plain identifiers and literals are a call's own
      // arguments, so a key set alone would just restate a function signature.
      const pairs = [];
      for (const pr of n.properties) {
        if (pr.type !== 'Property' || pr.shorthand) continue;
        const k = !pr.computed ? (pr.key.type === 'Identifier' ? pr.key.name : String(pr.key.value)) : strOf(p, pr.key);
        if (k == null) continue;
        const v = pr.value.type === 'ChainExpression' ? pr.value.expression : pr.value;
        if (v.type === 'CallExpression' || v.type === 'MemberExpression' || v.type === 'AwaitExpression') pairs.push(`${k}=${valueSource(v)}`);
      }
      if (pairs.length < T.recordMinKeys) return;
      recordSites.push({ file: p, line: n.loc.start.line, keys: new Set(pairs) });
    });
  }
  {
    // Cluster around repeated exact key sets first, then attach near sets (Jaccard >= recordJaccard) via an inverted index.
    const parent = recordSites.map((_, i) => i);
    const f = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const inv = new Map();
    recordSites.forEach((s, i) => { for (const k of s.keys) { if (!inv.has(k)) inv.set(k, []); inv.get(k).push(i); } });
    for (let i = 0; i < recordSites.length; i++) {
      const cnt = new Map();
      for (const k of recordSites[i].keys) for (const j of inv.get(k)) if (j > i) cnt.set(j, (cnt.get(j) || 0) + 1);
      for (const [j, c] of cnt) {
        const J = c / (recordSites[i].keys.size + recordSites[j].keys.size - c);
        if (J >= T.recordJaccard) { const a = f(i), b = f(j); if (a !== b) parent[b] = a; }
      }
    }
    const comps = new Map();
    recordSites.forEach((s, i) => { const r = f(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(s); });
    for (const sites of comps.values()) {
      const fs = new Set(sites.map((s) => s.file));
      if (fs.size < T.minFiles) continue;
      const cnt = new Map();
      for (const s of sites) for (const k of s.keys) cnt.set(k, (cnt.get(k) || 0) + 1);
      const core = [...cnt].filter(([, c]) => c >= sites.length * 0.75).map(([k]) => k);
      groups.push({
        detector: 'record',
        decision: `record assembled from the same sources {${core.slice(0, 5).join(', ')}${core.length > 5 ? `, +${core.length - 5}` : ''}}`,
        match: 'near-keys',
        members: core,
        sites: sites.map((s) => ({ file: s.file, line: s.line, size: s.keys.size })),
      });
    }
  }

  // ── detector 2c: repeated named constants ───────────────────────────────────
  // The same constant name bound to the same literal value (string, number, regex, or a literal
  // array/Set of any size, including one member) in >= 2 files: `const X_MS = 600000`,
  // `const WAITING_MARKERS = new Set(['blocked'])`. Catches the one-value decisions the set
  // detector's two-member floor cannot. Names shorter than 4 characters are skipped (i, ms, re).
  const constSites = new Map();
  const literalKey = (p, n) => {
    if (!n) return null;
    if (n.type === 'Literal') return n.regex ? `/${n.regex.pattern}/${n.regex.flags}` : JSON.stringify(n.value);
    if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal') return `-${n.argument.value}`;
    if (n.type === 'BinaryExpression' && ['*', '+'].includes(n.operator)) { const a = literalKey(p, n.left), b = literalKey(p, n.right); if (a != null && b != null && !/^"/.test(a) && !/^"/.test(b)) { try { return String(Function(`return (${a})${n.operator}(${b})`)()); } catch { return null; } } return null; }
    if (n.type === 'ArrayExpression') { const v = n.elements.map((e) => (e ? strOf(p, e) ?? (e.type === 'Literal' ? JSON.stringify(e.value) : null) : null)); return v.every((x) => x != null) && v.length ? `[${[...v].sort().join(',')}]` : null; }
    if (n.type === 'NewExpression' && n.callee.name === 'Set' && n.arguments[0]?.type === 'ArrayExpression') { const k = literalKey(p, n.arguments[0]); return k ? `Set${k}` : null; }
    return null;
  };
  for (const [p, ast] of Object.entries(asts)) {
    walk(ast, (n, parent) => {
      if (n.type !== 'VariableDeclaration' || n.kind !== 'const') return;
      for (const d of n.declarations) {
        if (d.id.type !== 'Identifier' || d.id.name.length < 4 || !/^[A-Z_][A-Z0-9_]*$/.test(d.id.name)) continue; // module-constant naming only
        const v = literalKey(p, d.init);
        if (v == null || v === '""' || v === '0' || v === '1' || v === 'true' || v === 'false' || v === 'null') continue;
        const key = `${d.id.name}=${v}`;
        if (!constSites.has(key)) constSites.set(key, []);
        constSites.get(key).push({ file: p, line: d.loc.start.line, label: d.id.name });
      }
    });
  }
  for (const [key, sites] of constSites) {
    if (new Set(sites.map((s) => s.file)).size < T.minFiles) continue;
    groups.push({ detector: 'const', decision: `named constant ${key.length > 110 ? `${key.slice(0, 107)}...` : key}`, match: 'exact-name-value', sites });
  }

  // ── detector 4: text-protocol contracts ─────────────────────────────────────
  const contractSites = new Map();
  const addContract = (key, site) => { if (!contractSites.has(key)) contractSites.set(key, []); contractSites.get(key).push(site); };
  const unRegex = (src) => src.replace(/\\s[*+?]?/g, ' ').replace(/\\b|\^|\$|\(\?:|\)|\[\^[^\]]*\][*+?]?/g, '').replace(/\\(.)/g, '$1');
  const scanText = (p, line, text, opts = {}) => {
    for (const m of text.matchAll(/(?:^|\n|\\n|`)[ \t]*(#{2,6})[ \t]*([A-Za-z][^\n`#*|]{3,60}?)(?=$|\n|\\n|`|\s*\||\s*$)/g)) {
      const h = m[2].replace(/\s+/g, ' ').replace(/[\s:.\-—]+$/, '').trim().toLowerCase();
      if (h.split(' ').length >= 2 || h.length >= 8) addContract(`heading: ${h}`, { file: p, line });
    }
    if (!opts.headingsOnly) for (const m of text.matchAll(/(?:^|\n|\\n|['"`(\s])(\[[a-z][a-z0-9_-]{2,30}\])/g)) addContract(`marker: ${m[1]}`, { file: p, line });
  };
  for (const [p, ast] of Object.entries(asts)) {
    walk(ast, (n) => {
      if (n.type === 'Literal' && typeof n.value === 'string') scanText(p, n.loc.start.line, n.value);
      else if (n.type === 'Literal' && n.regex) {
        // In a regex an unescaped [...] is a character class, so only escaped \[word\] is a marker.
        for (const m of n.regex.pattern.matchAll(/\\\[([a-z][a-z0-9_-]{2,30})\\\]/g)) addContract(`marker: [${m[1]}]`, { file: p, line: n.loc.start.line });
        scanText(p, n.loc.start.line, unRegex(n.regex.pattern), { headingsOnly: true });
      }
      else if (n.type === 'TemplateLiteral') scanText(p, n.loc.start.line, n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('`'));
    });
  }
  for (const [key, sites] of contractSites) {
    const fs = new Set(sites.map((s) => s.file));
    if (fs.size < T.minFiles) continue;
    groups.push({ detector: 'contract', decision: `text contract ${key}`, match: 'exact-text', sites });
  }

  // ── finish: files, areas, churn, rank ───────────────────────────────────────
  for (const g of groups) {
    const fs = [...new Set(g.sites.map((s) => s.file))].sort();
    g.files = fs;
    g.fileCount = fs.length;
    g.areas = [...new Set(fs.map(areaOf))].sort();
    g.areaCount = g.areas.length;
    g.churn = churnOf(fs);
    g.score = g.fileCount * g.churn;
    g.siteCount = g.sites.length;
    g.sites.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    g.rankable = !(g.detector === 'clone' && g.structureOnly && g.statements < T.structureOnlyMinStatements);
  }
  groups.sort((a, b) => b.score - a.score || b.fileCount - a.fileCount || (a.decision < b.decision ? -1 : 1));
  groups.forEach((g, i) => { g.id = `G${String(i + 1).padStart(4, '0')}`; });

  // Mirror families: file pairs that share >= 3 clone groups are a copied module (typically a
  // browser port of a server module), which a consolidation handles as one decision, not N.
  const pairCount = new Map();
  for (const g of groups.filter((x) => x.detector === 'clone' && x.match !== 'tiny')) {
    const fs = g.files;
    for (let a = 0; a < fs.length; a++) for (let b = a + 1; b < fs.length; b++) {
      const k = `${fs[a]}|${fs[b]}`;
      if (!pairCount.has(k)) pairCount.set(k, []);
      pairCount.get(k).push(g.id);
    }
  }
  const mirrors = [...pairCount].filter(([, ids]) => ids.length >= 3)
    .map(([k, ids]) => { const [a, b] = k.split('|'); return { files: [a, b], areas: [...new Set([areaOf(a), areaOf(b)])], sharedCloneGroups: ids.length, groups: ids, churn: churnOf([a, b]) }; })
    .sort((x, y) => y.sharedCloneGroups - x.sharedCloneGroups);

  const byDetector = {};
  for (const g of groups) {
    const k = g.detector;
    byDetector[k] ??= { groups: 0, sites: 0 };
    byDetector[k].groups++; byDetector[k].sites += g.siteCount;
  }
  const rankable = groups.filter((g) => g.rankable);
  const report = {
    repo,
    commit,
    commitDate,
    churnWindowDays: churnDays,
    scope: { files: paths.length, parsed: Object.keys(asts).length, parseErrors, functionsConsidered: fns.length, tinyFunctionsConsidered: tiny.length, setSites: setSites.length, recordSites: recordSites.length },
    thresholds: T,
    filtered: { ...filtered, ...filteredSets, literalRecordsNotUsedAsMaps: filteredLiteralRecords.count, structureOnlyCloneGroupsUnranked: groups.filter((g) => !g.rankable).length },
    totals: {
      groups: rankable.length, sites: rankable.reduce((a, g) => a + g.siteCount, 0),
      filesInvolved: new Set(rankable.flatMap((g) => g.files)).size,
      crossAreaGroups: rankable.filter((g) => g.areaCount >= 2).length,
      byDetector,
      fuzzyCloneEdges: fuzzyEdges,
      vocabularyCloneEdges: vocabEdges,
    },
    mirrors,
    groups,
  };
  return report;
}

// --redact <regex>: replace matching text in every output string (e.g. to keep vendor or product
// identifiers that appear in the repo's literals out of a published census).
export const serialiseCensus = (report, redact = null) => {
  const redactRx = redact ? new RegExp(redact, 'gi') : null;
  return `${JSON.stringify(report, (k, v) => (redactRx && typeof v === 'string' ? v.replace(redactRx, '<redacted>') : v), 1)}\n`;
};

export const summariseCensus = (report) =>
  `census ${report.commit.slice(0, 8)}: ${report.scope.files} files, ${report.scope.functionsConsidered} functions, ${report.totals.groups} groups (${report.totals.sites} sites), unranked ${report.filtered.structureOnlyCloneGroupsUnranked}`;
