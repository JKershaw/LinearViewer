// The fixed mutation operator set, applied to EVERY applicable site.
//
// Mutants are text splices over acorn node ranges, so comments (which are not
// AST nodes) are never touched and everything outside the spliced range stays
// byte-identical. Each operator's rule is stated in OPERATORS below and in
// kit/README.md. Bump OPERATOR_SET_VERSION if a rule changes, so results from
// different versions are never compared silently.

import * as acorn from 'acorn'
import { parseModule, childNodes } from './shape-core.mjs'

export const OPERATOR_SET_VERSION = 'adf-kit-ops/1'

export const OPERATORS = {
  'negate-cond': 'test of if / ?: / while / do-while / for  T → !(T)',
  'eq-flip': '=== ↔ !==, == ↔ !=',
  'boundary': '< ↔ <=, > ↔ >=',
  'logical-swap': '&& → ||, || → &&, ?? → &&',
  'bool-flip': 'true ↔ false',
  'string-empty': "non-empty string literal → '' and non-empty untagged template literal → '' (skips import/export sources, directives, object-literal keys)",
  'string-fill': "empty string literal '' → '__MUTANT__'",
  'not-remove': '!X → (X)',
  'arith': 'binary + ↔ -, * ↔ /, % → *; assignment += ↔ -=, *= ↔ /=; update ++ ↔ --',
  'return-value': 'return <literal> → return undefined (literal = string/number/boolean/regex literal, template, array or object literal; `null` → undefined, `undefined` → null); same for an arrow whose expression body is such a literal',
  'delete-call': 'an expression statement that is a call (incl. optional call, awaited call) → `;`',
  'index-swap': 'x[0] ↔ x[1] (computed member with literal 0 or 1)',
  'regex-anchor': 'regex literal: drop a leading ^ ; separately, drop a trailing unescaped $',
  'number-shift': 'numeric literal n → n+1 and → n-1 (not on x[0]/x[1], which index-swap covers)',
}

const SWAP = {
  'eq-flip': { '===': '!==', '!==': '===', '==': '!=', '!=': '==' },
  boundary: { '<': '<=', '<=': '<', '>': '>=', '>=': '>' },
  arith: { '+': '-', '-': '+', '*': '/', '/': '*', '%': '*' },
  arithAssign: { '+=': '-=', '-=': '+=', '*=': '/=', '/=': '*=' },
  logical: { '&&': '||', '||': '&&', '??': '&&' },
}

function isLiteralish(n) {
  if (!n) return false
  if (n.type === 'Literal') return true
  if (n.type === 'TemplateLiteral') return true
  if (n.type === 'ArrayExpression' || n.type === 'ObjectExpression') return true
  if (n.type === 'Identifier' && n.name === 'undefined') return true
  return false
}

function returnReplacement(n, src) {
  if (n.type === 'Literal' && n.value === null && !n.regex) return 'undefined'
  if (n.type === 'Identifier' && n.name === 'undefined') return 'null'
  void src
  return 'undefined'
}

/** Replace exactly one operator token in the gap between two operand nodes. */
function operatorSplice(src, left, right, op, newOp) {
  const gap = src.slice(left.end, right.start)
  if (gap.includes('/*') || gap.includes('//')) return null
  const idx = gap.indexOf(op)
  if (idx === -1) return null
  const start = left.end + idx
  return { start, end: start + op.length, replacement: newOp }
}

export function generateMutants(source) {
  const { ast } = parseModule(source)
  const sites = []
  const lineStarts = [0]
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') lineStarts.push(i + 1)
  const lineOf = offset => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1 }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
  }
  const add = (operator, node, start, end, replacement, note) => {
    sites.push({ operator, nodeType: node.type, start, end, replacement, note })
  }

  function visit(node, parent, parentKey) {
    switch (node.type) {
      case 'IfStatement':
      case 'ConditionalExpression':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForStatement':
        if (node.test) add('negate-cond', node.test, node.test.start, node.test.end, `!(${source.slice(node.test.start, node.test.end)})`)
        break
      case 'BinaryExpression': {
        for (const [operator, table] of [['eq-flip', SWAP['eq-flip']], ['boundary', SWAP.boundary], ['arith', SWAP.arith]]) {
          const to = table[node.operator]
          if (!to) continue
          const sp = operatorSplice(source, node.left, node.right, node.operator, to)
          if (sp) add(operator, node, sp.start, sp.end, sp.replacement)
        }
        break
      }
      case 'LogicalExpression': {
        const to = SWAP.logical[node.operator]
        const sp = to && operatorSplice(source, node.left, node.right, node.operator, to)
        if (sp) add('logical-swap', node, sp.start, sp.end, sp.replacement)
        break
      }
      case 'AssignmentExpression': {
        const to = SWAP.arithAssign[node.operator]
        const sp = to && operatorSplice(source, node.left, node.right, node.operator, to)
        if (sp) add('arith', node, sp.start, sp.end, sp.replacement)
        break
      }
      case 'UpdateExpression': {
        const to = node.operator === '++' ? '--' : '++'
        const arg = source.slice(node.argument.start, node.argument.end)
        add('arith', node, node.start, node.end, node.prefix ? `${to}${arg}` : `${arg}${to}`)
        break
      }
      case 'UnaryExpression':
        if (node.operator === '!') add('not-remove', node, node.start, node.end, `(${source.slice(node.argument.start, node.argument.end)})`)
        break
      case 'Literal': {
        const isImportSource = parent && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(parent.type) && parentKey === 'source'
        const isKey = parent && parent.type === 'Property' && parentKey === 'key' && !parent.computed
        const isDirective = parent && parent.type === 'ExpressionStatement' && parent.directive
        if (typeof node.value === 'boolean') add('bool-flip', node, node.start, node.end, String(!node.value))
        else if (typeof node.value === 'string' && !isImportSource && !isKey && !isDirective) {
          if (node.value === '') add('string-fill', node, node.start, node.end, "'__MUTANT__'")
          else add('string-empty', node, node.start, node.end, "''")
        } else if (typeof node.value === 'number' && !isKey) {
          const isIndex = parent && parent.type === 'MemberExpression' && parent.computed && parentKey === 'property' && (node.value === 0 || node.value === 1)
          if (isIndex) add('index-swap', node, node.start, node.end, node.value === 0 ? '1' : '0')
          else {
            for (const delta of [1, -1]) {
              const v = node.value + delta
              add('number-shift', node, node.start, node.end, v < 0 ? `(${v})` : String(v), delta > 0 ? '+1' : '-1')
            }
          }
        } else if (node.regex) {
          const { pattern, flags } = node.regex
          if (pattern.startsWith('^')) add('regex-anchor', node, node.start, node.end, `/${pattern.slice(1) || '(?:)'}/${flags}`, 'drop ^')
          if (pattern.endsWith('$')) {
            let bs = 0
            for (let i = pattern.length - 2; i >= 0 && pattern[i] === '\\'; i -= 1) bs += 1
            if (bs % 2 === 0) add('regex-anchor', node, node.start, node.end, `/${pattern.slice(0, -1) || '(?:)'}/${flags}`, 'drop $')
          }
        }
        break
      }
      case 'TemplateLiteral':
        if (!(parent && parent.type === 'TaggedTemplateExpression')) {
          const empty = node.expressions.length === 0 && node.quasis.every(q => q.value.cooked === '')
          if (!empty) add('string-empty', node, node.start, node.end, "''")
        }
        break
      case 'ReturnStatement':
        if (node.argument && isLiteralish(node.argument)) add('return-value', node.argument, node.argument.start, node.argument.end, returnReplacement(node.argument, source))
        break
      case 'ArrowFunctionExpression':
        if (node.expression && isLiteralish(node.body)) add('return-value', node.body, node.body.start, node.body.end, returnReplacement(node.body, source))
        break
      case 'ExpressionStatement': {
        let e = node.expression
        if (e.type === 'AwaitExpression') e = e.argument
        if (e.type === 'ChainExpression') e = e.expression
        if (e.type === 'CallExpression') add('delete-call', node, node.start, node.end, ';')
        break
      }
      default:
        break
    }
    for (const [key, child] of childNodes(node)) visit(child, node, key)
  }
  visit(ast, null, null)

  // Materialise, validate syntax, dedupe on resulting source text.
  const seen = new Map()
  const mutants = []
  let duplicates = 0
  const lines = source.split('\n')
  sites.sort((a, b) => a.start - b.start || a.end - b.end)
  for (const s of sites) {
    const mutated = source.slice(0, s.start) + s.replacement + source.slice(s.end)
    if (mutated === source) { duplicates += 1; continue }
    if (seen.has(mutated)) { duplicates += 1; continue }
    const { line, column } = lineOf(s.start)
    const endPos = lineOf(s.end)
    let syntaxError = null
    try { acorn.parse(mutated, { ecmaVersion: 'latest', sourceType: 'module' }) } catch (err) { syntaxError = err.message }
    const mutatedLines = mutated.split('\n')
    const lineCount = endPos.line - line + 1
    const newLineCount = s.replacement.split('\n').length
    const m = {
      id: `M${String(mutants.length + 1).padStart(4, '0')}`,
      operator: s.operator,
      note: s.note,
      line,
      column,
      original: source.slice(s.start, s.end),
      replacement: s.replacement,
      lineBefore: lines.slice(line - 1, line - 1 + lineCount).join('\n'),
      lineAfter: mutatedLines.slice(line - 1, line - 1 + newLineCount).join('\n'),
      syntaxError,
      source: mutated,
    }
    seen.set(mutated, m.id)
    mutants.push(m)
  }
  return { mutants, duplicates, sitesConsidered: sites.length }
}
