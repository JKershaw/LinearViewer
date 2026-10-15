// audit-subagent.mjs <subagent-transcript.jsonl> <roomDir>
// Checks a Claude Code sub-agent's transcript against the clean-room rule:
// every path it touched is inside <roomDir>; no git; no web tools other than the
// two allowed documentation hosts. Prints every tool call and exits 1 on any violation.
// Sub-agent transcripts live at ~/.claude/projects/<cwd-slug>/<sessionId>/subagents/agent-<id>.jsonl
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [file, roomArg] = process.argv.slice(2)
if (!file || !roomArg) { console.error('usage: node audit-subagent.mjs <transcript.jsonl> <roomDir>'); process.exit(2) }
const room = resolve(roomArg).replace(/\/$/, '')
const ALLOWED_HOSTS = ['developer.atlassian.com', 'spec.commonmark.org', 'commonmark.org']
const calls = []
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let e; try { e = JSON.parse(line) } catch { continue }
  const content = e?.message?.content
  if (!Array.isArray(content)) continue
  for (const c of content) if (c?.type === 'tool_use') calls.push({ name: c.name, input: c.input || {} })
}
const violations = []
for (const [i, { name, input }] of calls.entries()) {
  // every string value in the call, unescaped (scanning JSON.stringify output would turn a quoted
  // path into one ending in a backslash and flag it falsely)
  const strings = []
  // text the call WRITES (file content, edit strings, prompts) is not an access, so it is not scanned
  const NOT_ACCESS = new Set(['content', 'new_string', 'old_string', 'edits', 'prompt', 'description', 'subject', 'activeForm', 'todos', 'query'])
  const walk = (v, k) => { if (NOT_ACCESS.has(k)) return; if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(vv, kk)) }
  walk(input, '')
  const why = []
  // absolute paths anywhere in the call must sit inside the room (system binaries excepted)
  for (const p of strings.join('\n').match(/\/(?:home|tmp|root|Users|var|opt|etc|private|mnt|srv)\/[^\s"'\\;|&)<>`]*/g) || []) {
    const q = p.replace(/\/+$/, '')
    if (!(q === room || q.startsWith(room + '/'))) why.push(`path outside room: ${p}`)
  }
  if (/(^|[\s'"=(;&|])\.\.(\/|$|[\s'";&|])/.test(input.command || input.path || input.file_path || input.pattern || '')) why.push('parent-directory reference (..)')
  if (/(^|[\s;&|(])git(\s|$)/.test(input.command || '')) why.push('git used')
  // relative paths resolve against the session's working directory (the repo checkout), so every
  // shell command must first enter the room
  if (name === 'Bash' && !new RegExp('^\\s*cd\\s+[\'"]?' + room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?[\'"]?\\s*(&&|;|$)').test(input.command || '')) why.push('shell command does not start by entering the room (cd <room> &&)')
  if (/(^|[\s;&|(])(cd|pushd)\s+(~|\$HOME)/.test(input.command || '')) why.push('home directory')
  if (name === 'WebFetch' || name === 'WebSearch') {
    const host = (() => { try { return new URL(input.url).hostname } catch { return '' } })()
    if (name === 'WebSearch' || !ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h))) why.push(`web: ${name} ${input.url || input.query || ''}`)
  }
  if (!['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'NotebookEdit'].includes(name)) why.push(`unexpected tool: ${name}`)
  if ((name === 'Glob' || name === 'Grep') && !input.path) why.push(`${name} without an explicit path (searches the working directory)`)
  const summary = (input.command || input.file_path || input.path || input.url || input.pattern || '').toString().split('\n')[0].slice(0, 140)
  console.log(`${String(i + 1).padStart(3)} ${name.padEnd(9)} ${why.length ? 'VIOLATION' : 'ok       '} ${summary}`)
  for (const w of why) { console.log(`      ↳ ${w}`); violations.push({ call: i + 1, name, why: w }) }
}
console.log(`\n${calls.length} tool calls; ${violations.length} violation(s); room ${room}`)
process.exit(violations.length ? 1 : 0)
