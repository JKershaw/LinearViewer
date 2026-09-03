#!/usr/bin/env node
/**
 * LIN-2360 mechanical decomposition tables (ci-gate-sweep.mjs shape).
 *
 * Emits the two tables the routes/proxy.js decomposition plan rests on. Both are
 * DERIVED FROM SOURCE at whatever HEAD you run them on — never hand-enumerated.
 * Three successive hand-enumerations each missed a whole category (findings F1, G1,
 * G2, G3 on LIN-2360); this script exists so the fourth doesn't have to be trusted.
 *
 *   node scripts/proxy-decomposition-tables.mjs            # both tables, text
 *   node scripts/proxy-decomposition-tables.mjs --table=a  # symbol -> destination
 *   node scripts/proxy-decomposition-tables.mjs --table=b  # test pin -> breaking stage
 *   node scripts/proxy-decomposition-tables.mjs --json     # machine-readable
 *
 * TABLE A — every symbol defined in routes/proxy.js (module scope AND in-closure)
 *   -> the set of route regions that reference it, transitively through helpers
 *   -> ONE named destination module.
 *   Rule: 0 regions => stays in the composer; exactly 1 => that region's module;
 *   2 or more => routes/proxy-context.js, so no route module ever imports another.
 *
 * TABLE B — every source-scanning / census test pin that binds against
 *   routes/proxy.js -> the earliest stage at which it BREAKS (loud) or GOES
 *   VACUOUS (silent, the dangerous class: an absence assertion whose subject has
 *   moved out passes forever).
 *
 * Regions are contiguous route-index ranges in registration order, which the plan's
 * hard invariant preserves. The script re-derives the ranges' boundaries every run
 * and fails loudly if the 55-endpoint shape drifts.
 *
 * KNOWN LIMITATION (Table B): a pin is only extracted when its pattern is a literal
 * regex or string in the source. A pattern BUILT AT RUNTIME is invisible to this scan.
 * One such pin exists today - free-tier-model-clamp-wiring.test.js greps with the
 * template `${fn}({`, and its hard `assert.equal(billedClampCount, 17)` therefore has
 * to be reasoned about by hand: routes/proxy.js holds 5 of the 17 billed sites, and
 * ONE of them is inside computeRecommendation, which is a shared helper, so the count
 * drops to 16 at stage 2. Such files still surface in the census-site list below,
 * which is why that list is printed separately rather than folded into the pin table.
 *
 * DEPENDENCY NOTE: uses the Babel parser already bundled inside the `playwright`
 * devDependency, so this adds no package. That is an internal path and can move on a
 * Playwright upgrade; if the require below throws, that is why.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
// Required by absolute path on purpose: playwright's package `exports` map does not
// expose this file, so a bare deep specifier is refused.
const BABEL = join(ROOT, 'node_modules/playwright/lib/transform/babelBundle.js');
let babelParse, traverse;
try { ({ babelParse, traverse } = require(BABEL)); }
catch (e) {
  console.error(`Cannot load the Babel parser bundled in playwright:\n  ${BABEL}\n  ${e.message}`);
  console.error('Run `npm install` from the repo root first; if Playwright moved the path, update BABEL above.');
  process.exit(2);
}

const PROXY = 'routes/proxy.js';
const src = readFileSync(join(ROOT, PROXY), 'utf8');
const ast = babelParse(src, PROXY, false);

// ---------------------------------------------------------------- regions ----
// [label, firstRouteIdx, lastRouteIdx, destination module, stage]
const REGIONS = [
  ['A', 0, 4, 'proxy-tokens-admin.js', 3],
  ['B', 5, 5, 'proxy-instructions.js', 3],
  ['C', 6, 6, 'proxy-instructions.js', 3],
  ['D', 7, 19, 'proxy-reads.js', 4],
  ['E', 20, 31, 'proxy-writes.js', 4],
  ['F', 32, 43, 'proxy-compute.js', 5],
  ['G', 44, 45, 'proxy-kickoff.js', 5],
  ['H', 46, 49, 'proxy-kickoff.js', 5],
  ['I', 50, 54, 'proxy-dispatch.js', 6],
];
const REGION_MODULE = Object.fromEntries(REGIONS.map(r => [r[0], r[3]]));
const REGION_STAGE = Object.fromEntries(REGIONS.map(r => [r[0], r[4]]));
const ORDER = REGIONS.map(r => r[0]);
const regionOf = i => (REGIONS.find(r => i >= r[1] && i <= r[2]) || [])[0];

const METHODS = new Set(['get', 'post', 'patch', 'put', 'delete', 'all', 'use', 'options', 'head']);
const routes = [];
traverse(ast, {
  CallExpression(p) {
    const c = p.node.callee;
    if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier'
        && c.object.name === 'router' && METHODS.has(c.property?.name)) {
      routes.push({ start: p.node.start, end: p.node.end, line: p.node.loc.start.line,
                    method: c.property.name.toUpperCase() });
    }
  },
});
routes.sort((a, b) => a.start - b.start);
routes.forEach((r, i) => { r.idx = i; r.region = regionOf(i); });

if (routes.length !== 55) {
  console.error(`ENDPOINT DRIFT: found ${routes.length} route registrations, expected 55.`);
  console.error('The region ranges above are index-based; re-derive them before trusting either table.');
  process.exit(1);
}

// ------------------------------------------------------- symbols + refs ------
let programPath = null, cprPath = null;
traverse(ast, { Program(p) { programPath = p; } });
traverse(ast, {
  Function(p) {
    const name = p.node.id?.name
      || (p.parent?.type === 'VariableDeclarator' ? p.parent.id?.name : null);
    if (name === 'createProxyRoutes') cprPath = p;
  },
});
if (!cprPath) { console.error('createProxyRoutes not found in routes/proxy.js'); process.exit(1); }

const EXPORT_MARKERS = new Set(['ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportSpecifier']);
const symbols = new Map();
for (const [tier, scopePath] of [['module', programPath], ['closure', cprPath]]) {
  for (const [name, binding] of Object.entries(scopePath.scope.bindings)) {
    const d = binding.path.node;
    // Span the whole STATEMENT, not just the declarator: a pin matching
    // `const CONTEXT_FETCH_TIMEOUT_MS = ...` starts at `const`, which is before the
    // declarator node and would otherwise fall outside every interval and look like
    // it never moves.
    const par = binding.path.parentPath?.node;
    const stmtStart = par && (par.type === 'VariableDeclaration' || par.type === 'ExportNamedDeclaration')
      ? par.start : d.start;
    const grand = binding.path.parentPath?.parentPath?.node;
    const outerStart = grand && grand.type === 'ExportNamedDeclaration' ? grand.start : stmtStart;
    let exported = false;
    // Babel lists the `export` declaration itself as a referencePath. That is an
    // export marker, not a use site: counting it makes every `export const X` look
    // like it has a module-top consumer and forces it to ctx for no reason.
    const refs = binding.referencePaths.concat(binding.constantViolations)
      .filter(rp => (EXPORT_MARKERS.has(rp.node.type) ? (exported = true, false) : true));
    symbols.set(`${tier}::${name}`, {
      name, tier, kind: binding.kind, nodeType: d.type, exported,
      start: Math.min(outerStart, d.start), end: d.end, line: d.loc?.start.line ?? null, refs,
      refCount: refs.length,
    });
  }
}

// Innermost containing interval decides which unit a reference belongs to.
const intervals = [
  ...routes.map(r => ({ type: 'route', region: r.region, start: r.start, end: r.end })),
  ...[...symbols].filter(([, s]) => s.start != null)
    .map(([key, s]) => ({ type: 'symbol', key, start: s.start, end: s.end })),
];
function innermost(pos) {
  let best = null;
  for (const iv of intervals) {
    if (pos >= iv.start && pos <= iv.end
        && (!best || iv.end - iv.start < best.end - best.start)) best = iv;
  }
  return best;
}

for (const [key, rec] of symbols) {
  rec.directRegions = new Set();
  rec.viaSymbols = new Set();
  rec.atComposer = false;
  rec.atModuleTop = false;
  for (const rp of rec.refs) {
    const pos = rp.node.start;
    if (pos >= rec.start && pos <= rec.end) continue;   // self / recursive
    const enc = innermost(pos);
    if (!enc) {
      if (pos >= cprPath.node.start && pos <= cprPath.node.end) rec.atComposer = true;
      else rec.atModuleTop = true;
      continue;
    }
    if (enc.type === 'route') rec.directRegions.add(enc.region);
    else if (enc.key !== key) rec.viaSymbols.add(enc.key);
  }
  rec.regions = new Set(rec.directRegions);
}

// A helper used only by another helper still belongs to whatever regions reach it.
// This transitive step is what every hand-enumeration of this file has got wrong.
for (let i = 0; i < 500; i++) {
  let changed = false;
  for (const [, rec] of symbols) {
    for (const sk of rec.viaSymbols) {
      const other = symbols.get(sk);
      if (!other) continue;
      for (const r of other.regions) if (!rec.regions.has(r)) { rec.regions.add(r); changed = true; }
      if (other.atComposer && !rec.atComposer) { rec.atComposer = true; changed = true; }
    }
  }
  if (!changed) break;
}

const isImport = r => r.kind === 'module';
for (const [, rec] of symbols) {
  rec.regionList = ORDER.filter(r => rec.regions.has(r));
  rec.modules = [...new Set(rec.regionList.map(r => REGION_MODULE[r]))];
  const reexport = rec.exported ? ' (+ re-export from routes/proxy.js)' : '';
  if (isImport(rec)) {
    rec.class = 'import';
    rec.destination = rec.modules.length === 0
      ? (rec.refCount === 0 ? 'UNUSED import' : 'routes/proxy.js (composer import)')
      : rec.modules.length === 1 && !rec.atComposer && !rec.atModuleTop
        ? `import moves to ${rec.modules[0]}`
        : `import duplicated in: ${rec.modules.join(' + ')}`;
  } else if (rec.modules.length === 0) {
    rec.class = rec.refCount === 0 ? (rec.exported ? 'entry' : 'dead') : 'composer';
    rec.destination = rec.refCount === 0
      ? (rec.exported ? 'routes/proxy.js (public entry point)' : 'DEAD (0 references)')
      : 'routes/proxy.js (composer only)';
  } else if (rec.modules.length === 1 && !rec.atComposer && !rec.atModuleTop) {
    rec.class = 'single-module';
    rec.destination = `routes/${rec.modules[0]}${reexport}`;
  } else {
    rec.class = 'shared';
    rec.destination = `routes/proxy-context.js${reexport}`;
  }
  rec.stage = rec.class === 'shared' ? 2
    : rec.regionList.length ? Math.min(...rec.regionList.map(r => REGION_STAGE[r])) : null;
}

/** Where does the text at this offset in routes/proxy.js end up, and at which stage? */
function destinationAt(pos) {
  const enc = innermost(pos);
  if (!enc) return { where: 'routes/proxy.js', stage: null, via: 'module scope / preamble' };
  if (enc.type === 'route') {
    return { where: `routes/${REGION_MODULE[enc.region]}`, stage: REGION_STAGE[enc.region],
             via: `route region ${enc.region}` };
  }
  const rec = symbols.get(enc.key);
  return { where: rec.destination, stage: rec.stage, via: `symbol ${rec.name} (${rec.class})` };
}

// ------------------------------------------------------------- Table B -------
const PROXY_PATH_RE = /routes\/proxy\.js$|lib\/proxy-credential-trail\.js$|routes\/proxy-[a-z-]+\.js$/;
const testFiles = execFileSync('find', [join(ROOT, 'tests'), '-name', '*.test.js', '-o', '-name', '*.spec.js'],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

const calleeText = n => !n ? '?'
  : n.type === 'Identifier' ? n.name
  : n.type === 'MemberExpression' ? `${calleeText(n.object)}.${n.property.name ?? n.property.value ?? '?'}`
  : n.type === 'CallExpression' ? `${calleeText(n.callee)}()`
  : n.type;
const strVal = n => n?.type === 'StringLiteral' ? n.value
  : n?.type === 'TemplateLiteral' && n.quasis.length === 1 ? n.quasis[0].value.raw : null;

function enclosingTest(p) {
  for (let cur = p; cur; cur = cur.parentPath) {
    const n = cur.node;
    if (n?.type === 'CallExpression' && n.callee?.type === 'Identifier' && /^(test|it|describe)$/.test(n.callee.name)) {
      const t = n.arguments[0];
      return { name: t?.type === 'StringLiteral' ? t.value : '(anon)', line: n.loc.start.line };
    }
  }
  return null;
}

const scanners = [], censusPins = [], rawPins = [];
for (const file of testFiles) {
  const text = readFileSync(file, 'utf8');
  if (!/routes\/proxy/.test(text)) continue;
  let tAst;
  try { tAst = babelParse(text, file, false); } catch { continue; }

  // Taint: which identifiers in this test hold routes/proxy.js source text? Identifying
  // pins by pattern alone over-fires wildly - assert.equal(x, 'canceled') is not a scan.
  const tainted = new Set();
  const isTainted = (n, d = 0) => {
    if (!n || d > 12) return false;
    switch (n.type) {
      case 'Identifier': return tainted.has(n.name);
      case 'StringLiteral': case 'TemplateLiteral': { const v = strVal(n); return !!v && PROXY_PATH_RE.test(v); }
      case 'BinaryExpression': return isTainted(n.left, d + 1) || isTainted(n.right, d + 1);
      case 'MemberExpression': return isTainted(n.object, d + 1);
      case 'ArrayExpression': return (n.elements || []).some(e => isTainted(e, d + 1));
      case 'AwaitExpression': return isTainted(n.argument, d + 1);
      case 'CallExpression':   // src.slice()/.match(), and helper-mediated read(f)/count(read(f), re)
        return isTainted(n.callee, d + 1) || (n.arguments || []).some(a => isTainted(a, d + 1));
      default: return false;
    }
  };
  const decls = [];
  traverse(tAst, { VariableDeclarator(p) { if (p.node.id.type === 'Identifier') decls.push(p.node); } });
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const d of decls) if (!tainted.has(d.id.name) && isTainted(d.init)) { tainted.add(d.id.name); changed = true; }
    if (!changed) break;
  }
  if (!tainted.size) continue;
  scanners.push({ file: relative(ROOT, file), tainted: [...tainted] });

  traverse(tAst, {
    StringLiteral(p) {   // census file lists / maps that name routes/proxy.js by path
      if (!/routes\/proxy\.js$/.test(p.node.value)) return;
      const par = p.parentPath; if (!par) return;
      const shape = par.node.type === 'ArrayExpression' ? 'array'
        : par.node.type === 'ObjectProperty' ? 'object map' : 'inline read() arg';
      const owner = par.parentPath;
      censusPins.push({ file: relative(ROOT, file), line: p.node.loc.start.line, shape,
        list: owner?.node.type === 'VariableDeclarator' ? owner.node.id.name : '(inline)' });
    },
    CallExpression(p) {
      const n = p.node, ct = calleeText(n.callee), short = ct.split('.').pop().replace('()', '');
      if (short === 'replace' || short === 'split' || short === 'readFileSync') return;   // normalisation / IO
      const args = n.arguments || [];
      const subject = /^assert(\.|$)/.test(ct) ? args[0]
        : n.callee.type === 'MemberExpression' ? n.callee.object
        : args.find(a => isTainted(a));
      if (!subject || !isTainted(subject)) return;
      const block = enclosingTest(p);
      for (const arg of args) {
        if (arg?.type === 'RegExpLiteral') {
          rawPins.push({ file: relative(ROOT, file), line: n.loc.start.line, assertion: ct,
            subject: calleeText(subject), block, kind: 'regex',
            raw: `/${arg.pattern}/${arg.flags}`, pattern: arg.pattern, flags: arg.flags });
        } else if (arg?.type === 'StringLiteral' && arg.value.length >= 8
                   && /indexOf|includes|lastIndexOf|search|startsWith|endsWith/.test(short)) {
          rawPins.push({ file: relative(ROOT, file), line: n.loc.start.line, assertion: ct,
            subject: calleeText(subject), block, kind: 'string',
            raw: JSON.stringify(arg.value), pattern: arg.value, flags: '' });
        }
      }
    },
  });
}

const pins = [], skipped = [];
for (const pin of rawPins) {
  // A dotAll pattern with several unbounded quantifiers backtracks catastrophically
  // against a 400KB+ subject. Skipped and reported, never silently dropped.
  if (pin.kind === 'regex' && pin.flags.includes('s') && (pin.pattern.match(/\.[*+]/g) || []).length >= 2) {
    skipped.push(pin); continue;
  }
  const offsets = [];
  try {
    if (pin.kind === 'regex') {
      const re = new RegExp(pin.pattern, pin.flags.includes('g') ? pin.flags : pin.flags + 'g');
      for (let m, guard = 0; (m = re.exec(src)) !== null && guard < 5000; guard++) {
        offsets.push(m.index);
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      for (let i = src.indexOf(pin.pattern); i !== -1 && offsets.length < 5000; i = src.indexOf(pin.pattern, i + 1)) offsets.push(i);
    }
  } catch { continue; }
  const dests = offsets.map(o => destinationAt(o));
  const stages = dests.map(d => d.stage).filter(s => s != null);
  const a = pin.assertion;
  const pinClass = /doesNotMatch|notMatch|notOk/.test(a) ? 'ABSENCE (silent: goes vacuous)'
    : /indexOf|includes|lastIndexOf/.test(a) ? 'EXTRACTION (loud)'
    : /^assert\.(match|ok)$/.test(a) ? 'PRESENCE (loud only when the LAST match leaves)'
    : /\.match$|matchAll/.test(a) ? 'COUNT (loud on the FIRST match that leaves)'
    : `OTHER (${a})`;
  pins.push({ ...pin, pinClass, binds: offsets.length > 0, matchCount: offsets.length,
    lines: offsets.slice(0, 8).map(o => src.slice(0, o).split('\n').length),
    destinations: [...new Set(dests.map(d => d.where))], vias: [...new Set(dests.map(d => d.via))],
    earliestStage: stages.length ? Math.min(...stages) : null,
    latestStage: stages.length ? Math.max(...stages) : null,
    breaksAt: stages.length ? (/PRESENCE/.test(pinClass) ? Math.max(...stages) : Math.min(...stages)) : null });
}

// An absence assertion never matches, so it cannot locate itself. Anchor it to the
// bound pins in its own test block: once THOSE leave routes/proxy.js the guard is
// trivially satisfied forever. This is the F2/G2 failure class, made computable.
const bound = pins.filter(p => p.binds);
const key = p => `${p.file}::${p.block ? p.block.line : '-'}`;
const blockStage = new Map(), fileStage = new Map();
for (const p of bound) {
  if (p.earliestStage == null) continue;
  blockStage.set(key(p), Math.min(blockStage.get(key(p)) ?? 99, p.earliestStage));
  fileStage.set(p.file, Math.min(fileStage.get(p.file) ?? 99, p.earliestStage));
}
for (const p of pins) {
  if (p.binds) continue;
  const viaBlock = blockStage.get(key(p));
  p.anchorStage = viaBlock ?? fileStage.get(p.file) ?? null;
  p.anchorBasis = viaBlock != null ? 'bound pins in the same test block' : 'file-level fallback';
  p.goesVacuousAt = /ABSENCE/.test(p.pinClass) ? p.anchorStage : null;
}

// ---------------------------------------------------------------- output -----
const args = process.argv.slice(2);
const want = (args.find(a => a.startsWith('--table=')) || '--table=both').split('=')[1];
if (args.includes('--json')) {
  console.log(JSON.stringify({
    head: { endpoints: routes.length, lines: src.split('\n').length, bytes: Buffer.byteLength(src) },
    tableA: [...symbols.values()].map(r => ({
      name: r.name, tier: r.tier, kind: r.kind, line: r.line, exported: r.exported,
      refCount: r.refCount, regions: r.regionList, destination: r.destination,
      class: r.class, stage: r.stage })),
    tableB: { scanners, censusPins, pins, skipped },
  }, null, 1));
  process.exit(0);
}

console.log(`routes/proxy.js @ HEAD: ${src.split('\n').length} lines, ${Buffer.byteLength(src)} bytes, ${routes.length} endpoints\n`);
if (want === 'a' || want === 'both') {
  console.log('='.repeat(100));
  console.log('TABLE A - every symbol defined in routes/proxy.js -> one destination');
  console.log('='.repeat(100));
  const rows = [...symbols.values()].sort((a, b) =>
    a.tier === b.tier ? a.line - b.line : a.tier === 'module' ? -1 : 1);
  const defs = rows.filter(r => !isImport(r));
  console.log(`\n${defs.length} defined symbols (${defs.filter(r => r.tier === 'module').length} module-scope, ${defs.filter(r => r.tier === 'closure').length} in-closure) + ${rows.length - defs.length} imports\n`);
  console.log(['symbol', 'tier', 'line', 'refs', 'regions', 'destination'].join('\t'));
  for (const r of defs) {
    console.log([r.name, r.tier, r.line, r.refCount, r.regionList.join('') || '-', r.destination].join('\t'));
  }
  const counts = defs.reduce((m, r) => (m[r.destination.split(' (')[0]] = (m[r.destination.split(' (')[0]] || 0) + 1, m), {});
  console.log('\nBy destination:');
  for (const [d, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${d}`);
}
if (want === 'b' || want === 'both') {
  console.log('\n' + '='.repeat(100));
  console.log('TABLE B - every source-scan / census pin -> earliest stage it breaks or goes vacuous');
  console.log('='.repeat(100));
  console.log(`\n${scanners.length} test files scan proxy source as text:`);
  for (const s of scanners) console.log(`  ${s.file}`);
  console.log(`\n${censusPins.length} census sites name routes/proxy.js by path (each must gain the new modules):`);
  for (const c of censusPins) console.log(`  ${c.file}:${c.line}  ${c.list} [${c.shape}]`);
  if (skipped.length) {
    console.log(`\n${skipped.length} pattern(s) NOT evaluated (catastrophic backtracking) - review by hand:`);
    for (const s of skipped) console.log(`  ${s.file}:${s.line}  ${s.raw}`);
  }
  console.log(`\n${bound.length} pins bind against routes/proxy.js:\n`);
  console.log(['file', 'line', 'class', 'pattern', 'n', 'breaks', 'destinations'].join('\t'));
  for (const p of bound.sort((a, b) => (a.breaksAt ?? 99) - (b.breaksAt ?? 99))) {
    console.log([p.file.replace('tests/unit/', ''), p.line, p.pinClass.split(' ')[0],
      p.raw.slice(0, 44), p.matchCount, p.breaksAt ?? '-',
      p.destinations.map(d => d.replace('routes/', '')).join(',')].join('\t'));
  }
  const vac = pins.filter(p => p.goesVacuousAt != null);
  console.log(`\n${vac.length} ABSENCE assertions - these pass forever once their anchor moves out (SILENT):\n`);
  for (const p of vac) {
    console.log(`  ${p.file}:${p.line}  ${p.raw}`);
    console.log(`      test: ${(p.block?.name || '?').slice(0, 78)}`);
    console.log(`      GOES VACUOUS AT STAGE ${p.goesVacuousAt}  (anchor: ${p.anchorBasis})`);
  }
  const byFile = {};
  for (const p of bound) {
    if (p.earliestStage == null) continue;
    byFile[p.file] = Math.min(byFile[p.file] ?? 99, p.earliestStage);
  }
  for (const p of vac) if (p.goesVacuousAt != null) byFile[p.file] = Math.min(byFile[p.file] ?? 99, p.goesVacuousAt);
  console.log('\nEarliest stage each file must be re-pointed by:\n');
  for (const [f, s] of Object.entries(byFile).sort((a, b) => a[1] - b[1])) console.log(`  stage ${s}  ${f}`);
}
