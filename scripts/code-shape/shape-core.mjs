// Code-shape facts for one ES module, computed from an acorn AST.
// See kit/README.md "shape.mjs" for the exact definitions; they are restated
// in the `definitions` block of the output so a JSON file is self-describing.

import * as acorn from 'acorn'

export const DEFINITIONS = {
  codeLines: 'lines holding at least one non-whitespace character outside a comment (a line with code + trailing comment counts as code)',
  commentLines: 'lines holding comment text and no code',
  blankLines: 'lines with only whitespace',
  functions: 'every FunctionDeclaration, FunctionExpression and ArrowFunctionExpression (callbacks and one-line arrows included); class methods would count too',
  functionLines: 'spanLines = last line - first line + 1 of the function node; codeLines = code lines (as above) inside that span, including nested functions',
  maxNesting: "ESLint max-depth: +1 entering if / switch / try / for / for-in / for-of / while / do-while / with; an `else if` does not add a level; each function starts again at 0 (nested functions measured separately)",
  cyclomatic: 'ESLint `complexity` style: 1 per function + 1 for each if (incl. else-if), ?: , && , || , ?? (anywhere, not only inside conditions, since each short-circuits), for, for-in, for-of, while, do-while, catch, case with a test (not default), logical assignment (&&= ||= ??=), and default value (AssignmentPattern). Optional chaining (?.) is NOT counted; it is reported separately as optionalChains. Module-level code is its own unit "<module>" with base 1. total = sum over all units.',
  cyclomaticConditionsOnly: 'same as cyclomatic, except && / || / ?? are counted only when they sit inside the test of an if, ?:, while, do-while or for (classic McCabe "boolean operators in conditions")',
  regexLiterals: 'regular-expression literals /.../ (new RegExp(...) calls reported separately as regexConstructors)',
  topLevelDeclarations: 'top-level function / class declarations and variable declarators (exported or not); imports counted separately',
}

const CONTROL_DEPTH = new Set(['IfStatement', 'SwitchStatement', 'TryStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'WithStatement'])
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const TEST_OWNERS = new Set(['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement'])

export function parseModule(source) {
  const comments = []
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true, onComment: comments })
  return { ast, comments }
}

/** Children of an ESTree node in source order. */
export function childNodes(node) {
  const out = []
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'type') continue
    const v = node[key]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') out.push([key, c]) } else if (v && typeof v.type === 'string') out.push([key, v])
  }
  return out.sort((a, b) => a[1].start - b[1].start)
}

export function lineClassification(source, comments) {
  const lines = source.split('\n')
  const lineStart = []
  let off = 0
  for (const l of lines) { lineStart.push(off); off += l.length + 1 }
  const inComment = new Uint8Array(source.length)
  for (const c of comments) inComment.fill(1, c.start, c.end)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop() // trailing newline ends the last line; it does not start a new one
  const kinds = lines.map((line, i) => {
    let code = false
    let comment = false
    for (let j = 0; j < line.length; j += 1) {
      if (/\s/.test(line[j])) continue
      if (inComment[lineStart[i] + j]) comment = true; else { code = true; break }
    }
    return code ? 'code' : comment ? 'comment' : 'blank'
  })
  return kinds // index 0 = line 1
}

function functionName(node, parent, grandParentName, source) {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name
  if (node.id?.name) return node.id.name
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name
  if (parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') {
    const key = parent.key.type === 'Identifier' ? parent.key.name : source.slice(parent.key.start, parent.key.end)
    return parent.__ownerName ? `${parent.__ownerName}.${key}` : key
  }
  if (parent?.type === 'AssignmentExpression') return source.slice(parent.left.start, parent.left.end)
  return `${grandParentName || '<module>'}/λ@${node.loc.start.line}`
}

export function analyse(source) {
  const { ast, comments } = parseModule(source)
  const kinds = lineClassification(source, comments)
  const codeLinesBetween = (a, b) => { let n = 0; for (let l = a; l <= b; l += 1) if (kinds[l - 1] === 'code') n += 1; return n }

  const units = [] // functions + <module>
  const moduleUnit = { name: '<module>', kind: 'module', startLine: 1, endLine: kinds.length, decisions: 1, decisionsCondOnly: 1, maxDepth: 0, breakdown: {} }
  units.push(moduleUnit)
  const counters = { regexLiterals: 0, regexConstructors: 0, optionalChains: 0, stringLiterals: 0, templateLiterals: 0 }

  function bump(unit, kind, inCondition, isLogical) {
    unit.decisions += 1
    if (!isLogical || inCondition) unit.decisionsCondOnly += 1
    unit.breakdown[kind] = (unit.breakdown[kind] || 0) + 1
  }

  // walk(node, parent, unit, depth, inCondition, ownerName)
  function walk(node, parent, unit, depth, inCondition, ownerName) {
    let nextUnit = unit
    let nextDepth = depth
    if (FUNCTION_TYPES.has(node.type)) {
      const name = functionName(node, parent, unit.kind === 'module' ? null : unit.name, source)
      nextUnit = {
        name,
        kind: node.type,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        spanLines: node.loc.end.line - node.loc.start.line + 1,
        codeLines: codeLinesBetween(node.loc.start.line, node.loc.end.line),
        params: node.params.length,
        decisions: 1,
        decisionsCondOnly: 1,
        maxDepth: 0,
        breakdown: {},
        enclosing: unit.kind === 'module' ? null : unit.name,
      }
      units.push(nextUnit)
      nextDepth = 0
      inCondition = false
    } else if (CONTROL_DEPTH.has(node.type)) {
      const isElseIf = node.type === 'IfStatement' && parent?.type === 'IfStatement' && parent.alternate === node
      if (!isElseIf) nextDepth = depth + 1
      if (nextDepth > nextUnit.maxDepth) nextUnit.maxDepth = nextDepth
    }

    switch (node.type) {
      case 'IfStatement': bump(nextUnit, 'if'); break
      case 'ConditionalExpression': bump(nextUnit, 'ternary'); break
      case 'ForStatement': bump(nextUnit, 'for'); break
      case 'ForInStatement': bump(nextUnit, 'forIn'); break
      case 'ForOfStatement': bump(nextUnit, 'forOf'); break
      case 'WhileStatement': bump(nextUnit, 'while'); break
      case 'DoWhileStatement': bump(nextUnit, 'doWhile'); break
      case 'CatchClause': bump(nextUnit, 'catch'); break
      case 'SwitchCase': if (node.test) bump(nextUnit, 'case'); break
      case 'AssignmentPattern': bump(nextUnit, 'defaultValue'); break
      case 'LogicalExpression': bump(nextUnit, node.operator === '&&' ? 'and' : node.operator === '||' ? 'or' : 'nullish', inCondition, true); break
      case 'AssignmentExpression': if (['&&=', '||=', '??='].includes(node.operator)) bump(nextUnit, 'logicalAssign'); break
      case 'Literal':
        if (node.regex) counters.regexLiterals += 1
        else if (typeof node.value === 'string') counters.stringLiterals += 1
        break
      case 'TemplateLiteral': counters.templateLiterals += 1; break
      case 'NewExpression':
      case 'CallExpression':
        if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp') counters.regexConstructors += 1
        if (node.optional) counters.optionalChains += 1
        break
      case 'MemberExpression': if (node.optional) counters.optionalChains += 1; break
      default: break
    }

    let objectOwner = ownerName
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') objectOwner = node.id.name
    for (const [key, child] of childNodes(node)) {
      if (node.type === 'ObjectExpression' && child.type === 'Property') child.__ownerName = objectOwner
      const childInCondition = inCondition || (TEST_OWNERS.has(node.type) && key === 'test')
      walk(child, node, nextUnit, nextDepth, childInCondition, objectOwner)
    }
  }
  walk(ast, null, moduleUnit, 0, false, null)

  // Top-level declarations and exports.
  const topLevel = []
  const exported = []
  let imports = 0
  const declNames = decl => {
    if (!decl) return []
    if (decl.type === 'VariableDeclaration') return decl.declarations.map(d => ({ name: d.id.type === 'Identifier' ? d.id.name : source.slice(d.id.start, d.id.end), kind: decl.kind }))
    if (decl.type === 'FunctionDeclaration') return [{ name: decl.id?.name ?? 'default', kind: 'function' }]
    if (decl.type === 'ClassDeclaration') return [{ name: decl.id?.name ?? 'default', kind: 'class' }]
    return []
  }
  for (const stmt of ast.body) {
    if (stmt.type === 'ImportDeclaration') { imports += 1; continue }
    if (stmt.type === 'ExportNamedDeclaration') {
      const names = declNames(stmt.declaration)
      for (const n of names) { topLevel.push({ ...n, exported: true, line: stmt.loc.start.line }); exported.push(n.name) }
      for (const s of stmt.specifiers || []) exported.push(s.exported.name ?? s.exported.value)
      continue
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      exported.push('default')
      for (const n of declNames(stmt.declaration)) topLevel.push({ ...n, exported: true, line: stmt.loc.start.line })
      continue
    }
    if (stmt.type === 'ExportAllDeclaration') { exported.push(stmt.exported ? (stmt.exported.name ?? stmt.exported.value) : '*'); continue }
    for (const n of declNames(stmt)) topLevel.push({ ...n, exported: false, line: stmt.loc.start.line })
  }

  const functions = units.filter(u => u.kind !== 'module')
  const fnRows = units.map(u => ({
    name: u.name,
    kind: u.kind,
    startLine: u.startLine,
    endLine: u.endLine,
    spanLines: u.spanLines ?? null,
    codeLines: u.codeLines ?? null,
    params: u.params ?? null,
    cyclomatic: u.decisions,
    cyclomaticConditionsOnly: u.decisionsCondOnly,
    maxNesting: u.maxDepth,
    decisionPoints: u.breakdown,
    enclosing: u.enclosing ?? null,
  }))
  const sumBreakdown = {}
  for (const u of units) for (const [k, v] of Object.entries(u.breakdown)) sumBreakdown[k] = (sumBreakdown[k] || 0) + v
  const longestSpan = functions.reduce((best, f) => (!best || f.spanLines > best.spanLines ? f : best), null)
  const longestCode = functions.reduce((best, f) => (!best || f.codeLines > best.codeLines ? f : best), null)
  const mostComplex = units.reduce((best, f) => (!best || f.decisions > best.decisions ? f : best), null)

  return {
    lines: {
      total: kinds.length,
      code: kinds.filter(k => k === 'code').length,
      comment: kinds.filter(k => k === 'comment').length,
      blank: kinds.filter(k => k === 'blank').length,
    },
    bytes: Buffer.byteLength(source, 'utf8'),
    functions: {
      count: functions.length,
      byKind: functions.reduce((acc, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc }, {}),
      longestBySpan: longestSpan ? { name: longestSpan.name, spanLines: longestSpan.spanLines, codeLines: longestSpan.codeLines, startLine: longestSpan.startLine } : null,
      longestByCodeLines: longestCode ? { name: longestCode.name, spanLines: longestCode.spanLines, codeLines: longestCode.codeLines, startLine: longestCode.startLine } : null,
    },
    maxNesting: Math.max(0, ...units.map(u => u.maxDepth)),
    cyclomatic: {
      total: units.reduce((s, u) => s + u.decisions, 0),
      totalConditionsOnly: units.reduce((s, u) => s + u.decisionsCondOnly, 0),
      decisionPoints: Object.values(sumBreakdown).reduce((a, b) => a + b, 0),
      decisionPointsByKind: sumBreakdown,
      max: mostComplex ? { name: mostComplex.name, cyclomatic: mostComplex.decisions } : null,
      unitsOver10: units.filter(u => u.decisions > 10).map(u => u.name),
    },
    regexLiterals: counters.regexLiterals,
    regexConstructors: counters.regexConstructors,
    optionalChains: counters.optionalChains,
    stringLiterals: counters.stringLiterals,
    templateLiterals: counters.templateLiterals,
    imports,
    topLevelDeclarations: { count: topLevel.length, items: topLevel },
    exportedNames: exported,
    perFunction: fnRows,
  }
}

/**
 * Map a 1-based line to the TOP-LEVEL unit containing it: a top-level function
 * (nested callbacks and inner helpers roll up to it), an object-literal method
 * (`MARK_RENDERERS.link`), or `<module:NAME>` for a top-level non-function
 * declaration (a regex constant, a table).
 */
export function lineOwner(report, line) {
  let best = null
  for (const f of report.perFunction) {
    if (f.kind === 'module' || f.enclosing) continue
    if (line < f.startLine || line > f.endLine) continue
    if (!best || f.startLine >= best.startLine) best = f
  }
  if (best) return best.name
  const top = report.topLevelDeclarations.items.filter(d => d.line <= line).pop()
  return top ? `<module:${top.name}>` : '<module>'
}
