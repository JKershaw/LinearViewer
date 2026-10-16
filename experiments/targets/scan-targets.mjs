// scan-targets.mjs: shape facts for every lib/ and routes/ module (code lines, worst function, decision points, exports, boundary hints)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = '/home/user/LinearViewer', kit = '/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/kit/shape.mjs'
const files = []
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) files.push(p) } }
walk(join(root, 'lib')); walk(join(root, 'routes'))
const rows = []
for (const p of files) {
  let j; try { j = JSON.parse(execFileSync('node', [kit, p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch { continue }
  const src = readFileSync(p, 'utf8'); const pf = j.perFunction || []
  const top = pf.slice().sort((a, b) => b.cyclomatic - a.cyclomatic)
  rows.push({ file: p.slice(root.length + 1), code: j.lines.code, worst: j.cyclomatic.max.cyclomatic, worstName: j.cyclomatic.max.name, second: top[1]?.cyclomatic || 0, decisions: j.cyclomatic.total - pf.length, fns: pf.length,
    exports: (src.match(/^export /gm) || []).length, factory: /export function create\w+Routes\(\{/.test(src), render: /^export function render\w*Page/m.test(src), imports: (src.match(/^import /gm) || []).length })
}
console.log(JSON.stringify(rows))
