// =============================================================================
// Jira Cloud Provider — Phase 1 (LIN-1885) + Phase 2 writes (LIN-1886, both of
// LIN-275)
// =============================================================================
//
// Phase 1 was read-only Jira Cloud on API-token Basic auth. Phase 2 (LIN-1886)
// adds the write surface: updateIssue (title/description/status transitions),
// createComment, label mutation. Still out of scope: createIssue (deferred
// behind LIN-1557 — no native Jira "team" concept to hang a required teamId
// off), OAuth 3LO (Phase 3), story-point/epic-link mapping (Phase 4). See
// LIN-275's Implementation Plan (Revision 4) and LIN-1886's research comments
// for the full reasoning.
//
// --- Capability profile (LIN-1886) -------------------------------------------
//   write:     true  → overrides getCreateTaskUrl (external "create issue" deep
//                      link) — decoupled from inlineCreate, which stays false
//                      (createIssue is still unimplemented)
//   comments:  true  → fetchIssueComments (read) + createComment (write)
//   subtasks:  true  → Jira's native one-level subtasks map to parent/children
//                      on a best-effort basis (fetchIssueContext)
//   estimates: false → no story-point mapping this phase (Phase 4)
//   teams:     false → fetchTeams returns [] (Jira projects are NOT coerced
//                      into canonical teams — no in-tree `ui.teams` flag exists
//                      to set; teams:false is expressed purely by the empty read)
//   cycles:    false → simply not overridden (no in-tree `ui.cycles` flag
//                      either — cycles:false is the base's un-overridden decline)
//   priority:  false → `ui.priority` override (LIN-1886): priority is hardcoded
//                      0/unmapped in `_toCanonicalIssue`, so the in-app edit
//                      form hides the control rather than lying about it (D3)
//   inlineEdit: true → updateIssue is implemented (LIN-1886); inlineCreate stays
//                      false (createIssue remains deferred)
//
// --- Credential / scope shape --------------------------------------------------
// Jira Basic auth needs THREE fields per request (`email`, `apiToken`, `site`),
// unlike GitHub's bare token/repo-string scope. `_clientFor(scope)` therefore
// accepts only a `{ email, apiToken, site }` credential object (built by
// `getWorkspaceCallScope`'s Jira branch — LIN-1885 beat 3) or falls back to a
// boot-configured `client` (the unit-test / DI path, mirroring
// GitHubProvider._requireClient). There is no bare-string scope for Jira: a
// site alone cannot authenticate, and packing all three into one string was
// explicitly rejected by the LIN-1885 research (a second credential
// representation with two writers/parsers) in favor of this per-provider
// dispatch, which is what `getBindingCallScope`/`getWorkspaceCallScope` already
// are for github vs. everyone else.
//
// --- Write-path design notes (LIN-1886, Revision 4) --------------------------
//   D1 (unrenderable-content refusal): a description-overwrite refuses (422)
//     whenever the CURRENT stored ADF contains anything `markdownToAdf` cannot
//     rebuild from `adfToMarkdown`'s output (`adfHasUnrenderableContent`) —
//     never a silent, corrupting overwrite. The gate is derived from the
//     WRITER's vocabulary, not the reader's (LIN-1886 review Blocker 3).
//   D2 (status transitions): `patch.stateId` resolves to a canonical type via
//     `jiraStateIdToCanonicalType`; a same-category patch is a no-op (no
//     `getTransitions`/`doTransition` call at all); otherwise the first
//     transition whose `to.statusCategory.key` matches wins, a screen-required
//     transition refuses (422), and `canceled`/`duplicate` (unreachable from
//     Jira's statusCategory vocabulary) refuse loudly rather than folding into
//     `done`.
//   D3 (priority exclusion): `patch.priority` is never mapped into the Jira PUT
//     body — silently dropped, mirroring `ui.priority: false` hiding the
//     control client-side.
//   D4 (patch-field refusal): `patch.projectId` (any value) and
//     `patch.parentId === null` refuse (422) — Jira cannot honor either through
//     this integration.
//
// `issueWriteGuard` / `issueDescription` / `issueLabels` / `updateIssueLabels`
// are route-internal reads the write routes call unconditionally (mirrors
// `lib/providers/github/index.js:775-847`) — deliberately OFF the declared
// `PROVIDER_SURFACE`, gated by method EXISTENCE in the routes
// (`denyIfMissingRead`), not by `supports()`.

import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { SOURCE_JIRA } from '../models.js'
// The one "this reference cannot be resolved / this write cannot be honored"
// error class both write surfaces (routes/proxy.js, routes/workspace-api.js)
// already map to a clean 422 — reused for the D1/D2/D4 refusals below (mirrors
// GitHub's `githubStateIdToCanonicalType`, see lib/providers/github/index.js).
import { RefResolutionError } from '../../proxy-ref-resolver.js'
import { createJiraClient } from './client.js'
import { createJiraAuthRoutes } from '../../../routes/jira-auth.js'

export { createJiraClient } from './client.js'

// -----------------------------------------------------------------------------
// Pure state mapping — Jira's `statusCategory.key` → canonical state.
// -----------------------------------------------------------------------------
//
// Jira workflow statuses are fully customizable per-project/per-workflow, so
// the only STABLE signal is the status category every status belongs to:
// `new` | `indeterminate` | `done`. Free-text status names are never mapped
// directly (a "Blocked" status and a "Blocked?" status must not silently
// diverge in meaning). `canceled`/`duplicate` are deliberately NOT reachable
// from statusCategory — Jira has no such category — so an issue Jira itself
// calls "done" (however it got there) always reads as canonical `completed`.
// Exported so the mapping is unit-testable in isolation (mirrors
// githubStateToCanonical).
//
// The canonical state also carries the `id` of the JIRA_STATES entry its
// category maps to (LIN-1886 D2). That stamp is load-bearing, not cosmetic:
// `lib/render-task-edit.js`'s `renderStateControl` preselects the current
// option via `String(state.id) === currentId` FIRST and only falls back to
// matching on NAME. Jira's real per-workflow status names are free text
// ("Ready for QA"), while `states()` is the fixed synthetic vocabulary below —
// so without an id, nothing matched on any custom workflow, the browser
// defaulted the `<select>` to its first option, and a title-only save silently
// regressed the issue's status. The id comes off JIRA_STATES rather than a
// second set of string literals so the two vocabularies cannot drift.
export function jiraStatusCategoryToCanonical(issue = {}) {
  const status = issue?.fields?.status
  const key = status?.statusCategory?.key
  const name = status?.name || 'Unknown'
  if (key === 'new') return { id: stateIdForType('unstarted'), name, type: 'unstarted' }
  if (key === 'indeterminate') return { id: stateIdForType('started'), name, type: 'started' }
  if (key === 'done') return { id: stateIdForType('completed'), name, type: 'completed' }
  // Unrecognized/missing category — a safe, non-terminal default rather than
  // guessing at canceled/duplicate from a status name. Stamped consistently
  // with that type's own id so the exact-id branch always has something to
  // match rather than silently dropping back to name-matching.
  return { id: stateIdForType('unstarted'), name, type: 'unstarted' }
}

/** The JIRA_STATES id for a canonical type — one source of truth for the id stamp above. */
function stateIdForType(type) {
  return JIRA_STATES.find(s => s.type === type)?.id || null
}

/**
 * The canonical type each of Jira's THREE real statusCategory keys maps to —
 * the exact reverse of `jiraStatusCategoryToCanonical`'s `key →type` branches.
 * Used by `updateIssue`'s D2 status-transition write to find which
 * statusCategory a requested canonical type corresponds to on the wire.
 */
const CANONICAL_TYPE_TO_STATUS_CATEGORY = { unstarted: 'new', started: 'indeterminate', completed: 'done' }

/**
 * A FIXED, SYNTHETIC workflow vocabulary (LIN-1886 D2(a)) — `states()` is
 * issue-free (no workflow to introspect without one), so this stands in for a
 * real per-project Jira workflow read. Mirrors GitHub's `GITHUB_STATES`
 * (`lib/providers/github/index.js`): three entries, one per real Jira
 * statusCategory, each carrying `id`/`name`/`type`/`position` — the shape
 * `lib/render-task-edit.js`'s state `<select>` and `routes/task-edit.js`'s
 * `loadStates` both expect. Deliberately NOT real per-workflow Jira status
 * names (those vary per project/workflow and are not a stable vocabulary).
 */
const JIRA_STATES = [
  { id: 'todo', name: 'To Do', type: 'unstarted', position: 0 },
  { id: 'in-progress', name: 'In Progress', type: 'started', position: 1 },
  { id: 'done', name: 'Done', type: 'completed', position: 2 },
]

/**
 * Resolve one of THIS provider's own state ids (as emitted by `states()`) back
 * to a canonical `state.type` (mirrors `githubStateIdToCanonicalType`). Both
 * write PATCH surfaces resolve a symbolic state ref against `states()` and
 * hand the provider `input.stateId` — the provider's own id, not a canonical
 * `state` object — so this is what makes a `stateId` write actually move the
 * issue. An unknown id (e.g. a UUID that slipped past the routes' UUID
 * fast-path without consulting `states()`) is a caller error: a loud 422
 * naming the accepted vocabulary, never a dropped patch and never a 500.
 * @param {string} stateId
 * @returns {string} the canonical state.type
 * @throws {RefResolutionError} 422 when the id is not one this provider emits
 */
export function jiraStateIdToCanonicalType(stateId) {
  const match = JIRA_STATES.find(s => s.id === String(stateId))
  if (match) return match.type
  throw new RefResolutionError(
    `Cannot resolve state '${stateId}' — Jira issues here are only ${JIRA_STATES.map(s => s.id).join(', ')}`,
    { status: 422, candidates: JIRA_STATES.map(s => s.id) },
  )
}

// -----------------------------------------------------------------------------
// ADF (Atlassian Document Format) → Markdown.
// -----------------------------------------------------------------------------
//
// Jira Cloud's `description`/comment `body` fields are ADF documents, not
// plain text or HTML. This is a deliberately MINIMAL renderer covering the
// node/mark types real Jira content actually uses — not a full ADF spec
// implementation. Unknown node types fall through to their child content (if
// any) so an unhandled node degrades to its text rather than vanishing.
// -----------------------------------------------------------------------------
// Markdown ESCAPING on the way out (LIN-1886 review F1, John's Option A).
//
// The read path is half of a round trip: an in-app description edit renders the
// stored ADF to Markdown, hands it to a human, and writes whatever comes back
// through `markdownToAdf`. So any character sequence the WRITER reads as markup
// has to leave here neutralised, or ordinary Jira prose is silently reinterpreted
// on save — `foo_bar_baz` growing an `em` mark, a paragraph beginning `- ` becoming
// a real `bulletList`, a paragraph reading ```` ```js ```` having its text deleted
// outright. The review found 16 such counterexamples.
//
// Refusing that prose was explicitly rejected as the remedy (it would 422 nearly
// every technical description); escaping it is the decision. The cost is visible
// and accepted: the raw textarea now shows `foo\_bar\_baz`. Rendered Markdown is
// unaffected — a backslash escape before ASCII punctuation is CommonMark, so
// `marked` (the dashboard renderer) prints the character, not the backslash.
//
// WHY UNCONDITIONAL, not "escape only where a construct would actually match":
// the cheap-looking version has to reason about how escaping one position changes
// the parse landscape for every later one. Escaping every metacharacter makes the
// argument trivial and total — after the pass, every metacharacter is the second
// half of a `\x` pair, `parseInline` consumes both as one literal, and no
// construct can begin anywhere. Keep it that way.
// -----------------------------------------------------------------------------

/** Every character `parseInline` can OPEN a construct with, plus the escape itself. */
const INLINE_ESCAPE_PATTERN = /[\\`*_~[\]]/g
/** Inside a `code` mark only the fence character and the escape can end the run. */
const CODE_ESCAPE_PATTERN = /[\\`]/g
/** Inside a link's href only an unescaped `)` ends it — the `(`-truncation bug. */
const HREF_ESCAPE_PATTERN = /[\\()]/g

const escapeInlineText = text => String(text).replace(INLINE_ESCAPE_PATTERN, c => `\\${c}`)
const escapeCodeText = text => String(text).replace(CODE_ESCAPE_PATTERN, c => `\\${c}`)
const escapeHref = href => String(href).replace(HREF_ESCAPE_PATTERN, c => `\\${c}`)

/**
 * Neutralise a LEADING token `parseBlock` reads as a block marker. Inline
 * escaping cannot reach these: `#`, `>`, `-` and `.` are not inline markup, they
 * are only markup in first position. Applied per line of a rendered paragraph
 * (`parseBlock` tests the heading/fence/rule forms against the block's first
 * line, and the quote/bullet/ordered forms against EVERY line).
 *
 * A fence marker needs no case here — the inline pass has already escaped its
 * backticks, so ```` ```js ```` leaves as `` \`\`\`js `` and cannot open a block.
 */
function escapeBlockLeader(line) {
  // `(\s|$)`, not `\s`: a line of nothing but hashes is a heading leader too.
  // `parseBlock`'s `^(#{1,6})\s+` is matched against the whole BLOCK, and that
  // `\s+` happily consumes the `\n` a hardBreak rendered — so `"#\nrest"` reads
  // back as `{heading, level:1}` and the `#` line is gone. Requiring whitespace
  // on the same line here is the one-character asymmetry that let that through.
  if (/^#{1,6}(\s|$)/.test(line)) return `\\${line}`
  if (/^>\s/.test(line)) return `\\${line}`
  if (/^-\s/.test(line)) return `\\${line}`
  if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')
  const ordered = line.match(/^\d+\.\s/)
  if (ordered) {
    const digits = ordered[0].length - 2
    return `${line.slice(0, digits)}\\.${line.slice(digits + 1)}`
  }
  return line
}

const MARK_RENDERERS = {
  strong: text => `**${text}**`,
  em: text => `_${text}_`,
  code: text => `\`${text}\``,
  strike: text => `~~${text}~~`,
  link: (text, mark) => `[${text}](${escapeHref(mark?.attrs?.href || '')})`,
}

function renderMarks(text, marks) {
  return (marks || []).reduce((out, mark) => {
    const render = MARK_RENDERERS[mark.type]
    return render ? render(out, mark) : out
  }, text)
}

/**
 * A text run, escaped for the context its marks put it in. A `code` run is
 * fenced by backticks and re-read as one opaque span, so only the backtick and
 * the escape need neutralising there — escaping `_`/`*` inside a code span would
 * be pure noise in the textarea, and `parseInline` would have to strip them back
 * out again. Everything else takes the full inline set.
 */
function renderTextNode(node) {
  const marks = node.marks || []
  const escape = marks.some(m => m?.type === 'code') ? escapeCodeText : escapeInlineText
  return renderMarks(escape(node.text || ''), marks)
}

/**
 * A code BLOCK's body, verbatim. It sits between fences and `parseBlock` reads
 * it back with no inline pass at all, so escaping it would corrupt exactly the
 * content the fence exists to protect.
 */
function renderCodeBlockText(nodes) {
  return (nodes || []).map(n => (n?.type === 'text' ? (n.text || '') : renderAdfNode(n))).join('')
}

function renderAdfNodes(nodes) {
  return (nodes || []).map(renderAdfNode).join('')
}

function renderAdfNode(node) {
  if (!node || typeof node !== 'object') return ''
  switch (node.type) {
    case 'text':
      return renderTextNode(node)
    case 'paragraph':
      return `${renderAdfNodes(node.content).split('\n').map(escapeBlockLeader).join('\n')}\n\n`
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6)
      return `${'#'.repeat(level)} ${renderAdfNodes(node.content)}\n\n`
    }
    case 'bulletList':
      return `${(node.content || []).map(li => `- ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'orderedList':
      return `${(node.content || []).map((li, i) => `${i + 1}. ${renderAdfNodes(li.content).trim()}\n`).join('')}\n`
    case 'codeBlock': {
      const lang = node.attrs?.language || ''
      const code = renderCodeBlockText(node.content).replace(/\n+$/, '')
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`
    }
    case 'blockquote':
      return `${renderAdfNodes(node.content).trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`
    case 'rule':
      return '---\n\n'
    case 'hardBreak':
      return '\n'
    case 'mention':
      return node.attrs?.text || `@${node.attrs?.id || 'user'}`
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url || ''
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || ''
    default:
      return node.content ? renderAdfNodes(node.content) : ''
  }
}

/**
 * Convert an ADF document (Jira's rich-text wire shape) to Markdown.
 * @param {{type?: string, content?: Array}|null|undefined} doc
 * @returns {string}
 */
export function adfToMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  return renderAdfNodes(doc.content).trim()
}

// -----------------------------------------------------------------------------
// Markdown → ADF (LIN-1886, Phase 2) — the write-direction inverse of
// adfToMarkdown/renderAdfNode above. Its vocabulary is a STRICT SUBSET of the
// reader's: paragraphs, headings, bullet/ordered lists, code blocks,
// blockquotes, hr, hard breaks, and the strong/em/code/strike/link marks — but
// NOT mention/emoji/inlineCard/blockCard, which the reader renders and this
// direction has no inverse for. That asymmetry is exactly why the D1 write gate
// is derived from THIS side and not from `renderAdfNode`'s switch (LIN-1886
// review Blocker 3); `WRITER_REBUILDABLE_NODE_TYPES` below enumerates what
// `parseBlock`/`parseInline`/`parseParagraphContent` can emit.
//
// The correspondence is pinned by the ADF → Markdown → ADF property test. Read
// the scope of that claim carefully (LIN-1886 review F2): it is checked over a
// hand-written fixture list AND over a generated cross-product of an adversarial
// text corpus against every structural slot — roughly a thousand documents, both
// directions (permitted ⟹ round-trips, refused ⟹ genuinely lossy). That is a
// strong claim, not a total one: it is evidence over a corpus, not a proof over
// all ADF. When you add a node type, a mark, or an escape, add it to the corpus
// too — the previous framing asserted a general property off 21 chosen fixtures,
// and the gap between those two statements is where the F1 counterexamples lived.
//
// Anything else in the input Markdown degrades to plain text; this function
// never throws — refusal-on-unrenderable-content is
// `adfHasUnrenderableContent`'s job, applied to the STORED ADF being
// overwritten, not to freshly-authored Markdown on its way in.
// -----------------------------------------------------------------------------

// The inline pass is a hand-rolled left-to-right scan rather than one regex
// (`INLINE_PATTERN`, removed in LIN-1886 fix cycle 3). It has to be: the reader
// now escapes Markdown collisions, and honouring a `\x` escape is not something
// a single non-backtracking alternation can express — `[^\]]*` cannot be taught
// that `\]` is a literal rather than the end of the link text, which is exactly
// the bug that lost the link mark on `[a]b](http://x)`.
//
// Scan order is preserved from that pattern and still matters: link before
// strong/code/strike/em, so a link whose text contains another marker character
// is captured whole. Leftmost position wins; at the same position, this order is
// the tiebreak. The vocabulary mirrors MARK_RENDERERS exactly — no mark type is
// parsed here that renderMarks cannot also render.

/**
 * CommonMark's escape rule: a backslash escapes ASCII punctuation and nothing
 * else. This is what keeps a hand-typed `C:\Users\me` or a `\d` in a regex
 * intact — only `\` + punctuation is consumed, so the codec can round-trip its
 * own escapes without eating a user's literal backslashes.
 */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII_PUNCTUATION.test(text[i + 1])

function unescapeInline(text) {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    if (isEscapeAt(text, i)) { out += text[i + 1]; i += 1 } else out += text[i]
  }
  return out
}

// A code span and an href were escaped with a narrower set on the way out (see
// renderTextNode / escapeHref), so they are unescaped with the matching narrower
// set — not `unescapeInline` — or the pass would eat backslashes the writer
// never put there.
const unescapeCode = text => text.replace(/\\([\\`])/g, '$1')
const unescapeHref = text => text.replace(/\\([\\()])/g, '$1')

/**
 * Index of the next UNESCAPED `close` at or after `from`; `-1` if there is none,
 * or if an unescaped `stopAt` character is reached first. `stopAt` reproduces the
 * old pattern's `[^*]+` / `[^~]+` classes: a lone `*` inside `**…**` still means
 * "this is not a strong run", it is only escaped occurrences that stop counting.
 */
function scanForClose(text, from, close, stopAt) {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue }
    if (text.startsWith(close, i)) return i
    if (stopAt && text[i] === stopAt) return -1
  }
  return -1
}

/** `[delimiter, markType, forbidden-inside, how to unescape the content]`. */
const PAIRED_INLINE_MARKS = [
  ['**', 'strong', '*', unescapeInline],
  ['`', 'code', null, unescapeCode],
  ['~~', 'strike', '~', unescapeInline],
  ['_', 'em', null, unescapeInline],
]

/** The construct starting at `i`, or null. */
function matchInlineConstruct(text, i) {
  if (text[i] === '[') {
    const textEnd = scanForClose(text, i + 1, ']', null)
    if (textEnd === -1 || text[textEnd + 1] !== '(') return null
    const hrefEnd = scanForClose(text, textEnd + 2, ')', null)
    if (hrefEnd === -1) return null
    return {
      end: hrefEnd + 1,
      node: {
        type: 'text',
        text: unescapeInline(text.slice(i + 1, textEnd)),
        marks: [{ type: 'link', attrs: { href: unescapeHref(text.slice(textEnd + 2, hrefEnd)) } }],
      },
    }
  }
  for (const [delim, markType, stopAt, unescape] of PAIRED_INLINE_MARKS) {
    if (!text.startsWith(delim, i)) continue
    const close = scanForClose(text, i + delim.length, delim, stopAt)
    // `close === i + delim.length` is an empty run; the old pattern's `+`
    // quantifiers rejected those, so `**` and `____` stay literal.
    if (close === -1 || close === i + delim.length) continue
    return {
      end: close + delim.length,
      node: { type: 'text', text: unescape(text.slice(i + delim.length, close)), marks: [{ type: markType }] },
    }
  }
  return null
}

function parseInline(text) {
  const nodes = []
  let literal = ''
  const flush = () => { if (literal !== '') { nodes.push({ type: 'text', text: literal }); literal = '' } }
  let i = 0
  while (i < text.length) {
    if (isEscapeAt(text, i)) { literal += text[i + 1]; i += 2; continue }
    const match = matchInlineConstruct(text, i)
    if (match) { flush(); nodes.push(match.node); i = match.end; continue }
    literal += text[i]
    i += 1
  }
  flush()
  if (nodes.length === 0) nodes.push({ type: 'text', text: '' })
  return nodes
}

/** A block's text, split on single `\n`s into `hardBreak`-joined inline runs. */
function parseParagraphContent(blockText) {
  const lines = blockText.split('\n')
  const content = []
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    content.push(...parseInline(line))
  })
  return content
}

/** One blank-line-delimited Markdown block → one ADF block node. */
function parseBlock(block) {
  const headingMatch = block.match(/^(#{1,6})\s+([\s\S]*)$/)
  if (headingMatch) {
    return { type: 'heading', attrs: { level: headingMatch[1].length }, content: parseInline(headingMatch[2].trim()) }
  }

  if (/^```/.test(block)) {
    const m = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/)
    const lang = (m?.[1] || '').trim()
    const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return {
      type: 'codeBlock',
      ...(lang ? { attrs: { language: lang } } : {}),
      content: code.length ? [{ type: 'text', text: code }] : [],
    }
  }

  if (block.trim() === '---') {
    return { type: 'rule' }
  }

  const lines = block.split('\n')
  if (lines.length && lines.every(l => l.startsWith('> '))) {
    const inner = lines.map(l => l.slice(2)).join('\n')
    return { type: 'blockquote', content: [{ type: 'paragraph', content: parseParagraphContent(inner) }] }
  }

  if (lines.length && lines.every(l => /^-\s+/.test(l))) {
    return {
      type: 'bulletList',
      content: lines.map(l => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInline(l.replace(/^-\s+/, '')) }],
      })),
    }
  }

  if (lines.length && lines.every(l => /^\d+\.\s+/.test(l))) {
    return {
      type: 'orderedList',
      content: lines.map(l => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInline(l.replace(/^\d+\.\s+/, '')) }],
      })),
    }
  }

  return { type: 'paragraph', content: parseParagraphContent(block) }
}

/**
 * What `markdownToAdf` splits a document into blocks on — TWO LITERAL NEWLINES,
 * nothing else. The gate's shape rules test the same pattern against a rendered
 * body, so the two cannot drift: a rule that refuses a "blank" line the split
 * does not actually break on (`"\n \n"` — trailing whitespace on an otherwise
 * blank line, very common in pasted code) refuses content that round-trips
 * perfectly. Share the constant; do not re-type the regex at a use site.
 */
const BLOCK_SPLIT_PATTERN = /\n{2,}/

/**
 * Convert Markdown to an ADF document — the write-direction inverse of
 * `adfToMarkdown`. Unsupported/unrecognized Markdown constructs degrade to a
 * plain paragraph of text rather than throwing; refusing unrenderable content
 * is `adfHasUnrenderableContent`'s job, applied to the EXISTING stored ADF a
 * write is about to overwrite; that gate's node set and structural rules are
 * derived from THIS function, so it can never itself manufacture something the
 * gate would flag.
 * @param {string|null|undefined} markdown
 * @returns {{type: 'doc', version: 1, content: Array}}
 */
export function markdownToAdf(markdown) {
  const text = String(markdown ?? '')
  if (!text.trim()) return { type: 'doc', version: 1, content: [] }
  const blocks = text
    .split(BLOCK_SPLIT_PATTERN)
    .map(b => b.replace(/^\n+|\n+$/g, ''))
    .filter(b => b.length > 0)
  return { type: 'doc', version: 1, content: blocks.map(parseBlock) }
}

// -----------------------------------------------------------------------------
// Unrenderable-content detection (LIN-1886, D1 policy) — a pure recursive walk
// over an ADF tree, gating a WRITE.
//
// THIS SET IS DERIVED FROM THE WRITER (`markdownToAdf`), NOT THE READER
// (`renderAdfNode`). That distinction is the whole of LIN-1886 review Blocker 3:
// the set used to mirror `renderAdfNode`'s switch — i.e. "what the reader can
// turn into Markdown" — which is the wrong question for a write. A write does
// read-then-rewrite, so the property it needs is
//
//     markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// and that does NOT hold across the reader's vocabulary. `mention`, `emoji`,
// `inlineCard` and `blockCard` all render to Markdown fine but have NO
// Markdown→ADF inverse anywhere in `parseBlock`/`parseInline`, so gating on the
// reader's set let ordinary Jira content (an @-mention, a smart link, an emoji)
// be flattened into one anonymous text run by a 200-OK write. Everything listed
// below is a type `parseBlock`/`parseInline`/`parseParagraphContent` can
// actually EMIT; keep this list in lockstep with those three functions, never
// with `renderAdfNode`'s switch.
// -----------------------------------------------------------------------------
const WRITER_REBUILDABLE_NODE_TYPES = new Set([
  'doc', 'text', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'blockquote', 'rule', 'hardBreak',
])

/**
 * `parseParagraphContent` (the only thing that emits `hardBreak`) is reached
 * ONLY for a paragraph block and a blockquote's inner text. Heading content and
 * a listItem's paragraph go through bare `parseInline`, which has no line
 * concept — so a `\n` the reader emits inside either one is re-read as a block
 * boundary (a list item becomes a plain paragraph; a heading swallows a literal
 * newline). Hence: a hardBreak under a heading or a listItem is unrebuildable.
 */
function containsHardBreak(nodes) {
  return (nodes || []).some(n => n?.type === 'hardBreak' || (Array.isArray(n?.content) && containsHardBreak(n.content)))
}

/**
 * The STRUCTURAL half of the same derivation (LIN-1886 review Blocker 3). The
 * node types above are necessary but not sufficient: `markdownToAdf` builds
 * each of these containers in exactly one fixed shape, so a stored node of a
 * permitted type in a shape the writer never emits is just as unrebuildable as
 * an unmodeled type. Each rule below is pinned by a fixture in the ADF→md→ADF
 * property test (tests/unit/jira-provider.test.js).
 *
 * `true` = the writer cannot rebuild this node, so a write must refuse.
 */
/**
 * The `attrs` each rebuildable node type is allowed to carry, and what
 * `markdownToAdf` would have to see in order to re-emit them (LIN-1886 review
 * F1 sub-class (b)). Everything not listed here must carry NO `attrs` at all:
 * the writer emits none for it, so any stored `attrs` object — even an empty
 * one — cannot survive a write. This is the rule that catches the review's
 * `heading {level: 7}` (clamped to 6).
 *
 * `orderedList` is the one CONTENT-PRESERVING exception, per John's ruling
 * `d38d3755` ("the identity value is harmless"). The reader renumbers every
 * ordered list from 1 regardless of what is stored, so dropping an identity
 * `{order: 1}` — or a bare `{}` — changes not one rendered character.
 * `{order: 5}` is different in kind: dropping it silently renumbers 5,6 → 1,2,
 * which is the review's original counterexample and is still refused.
 *
 * MEASURED, because "harmless" and "deep-equals" are not the same claim: the
 * two newly-permitted shapes do NOT deep-equal round-trip. `markdownToAdf`
 * emits no `attrs` key at all (`parseBlock`'s `orderedList` branch), so both
 * `{order: 1}` and `{}` come back as a node with the key ABSENT — a mismatch
 * under `deepEqual` and `deepStrictEqual` alike. That is a real exception to
 * the invariant documented on `adfHasUnrenderableContent` below, named there
 * rather than papered over, and pinned by the `WRITER_PERMITTED_LOSSY_ADF`
 * fixtures — which assert the permit, the rendered-output identity, AND the
 * deep-equal failure together, so none of the three can drift unnoticed.
 *
 * Only the EXACT identity `1` is permitted, which is narrower than the
 * ruling's literal "refuse `order > 1`": `{order: 0}` or `{order: -3}` would
 * renumber a visibly 0-based list to 1-based, so they are not identity values
 * and not harmless. Refusing a non-identity `order` rather than modelling it
 * stands, per the earlier human decision: "refuse … e.g. `orderedList` with
 * `order ≠ 1` UNTIL THE WRITER MODELS THE ATTRIBUTE". Modelling it means the
 * reader numbering from `attrs.order` and the writer reading the first list
 * number back, which changes what hand-authored `5. foo` means — a behaviour
 * change outside this cycle. Re-review `5ae61f22` recorded that modelling it
 * would not close the deep-equal gap anyway, and that is now measured too:
 * stamping `{order: 1}` on every emitted list would merely move the mismatch
 * onto the far commoner list that stores no `attrs` at all.
 */
const WRITER_EMITTED_ATTRS = {
  // `parseBlock` always stamps `{level}` on a heading, from the `#` run length.
  heading: node => {
    const level = node.attrs?.level
    return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.attrs).length === 1
  },
  // `parseBlock` emits an `orderedList` with NO attrs and `renderAdfNode`
  // renumbers from 1, so an identity `{order: 1}` (or a bare `{}`) is dropped
  // by a write without changing a rendered character — permitted, and the one
  // place this gate trades strict deep-equality for content fidelity. Anything
  // else is a real renumber or a real loss: a non-identity `order`, a
  // non-integer, or any additional key.
  orderedList: node => {
    if (node.attrs === undefined) return true
    const keys = Object.keys(node.attrs)
    if (keys.length === 0) return true
    return keys.length === 1 && node.attrs.order === 1
  },
  // `parseBlock` stamps `{language}` ONLY when the fence carries one, and reads
  // it back through `.trim()` — so a blank or space-padded language is lost.
  codeBlock: node => {
    if (node.attrs === undefined) return true
    const lang = node.attrs?.language
    return typeof lang === 'string' && lang !== '' && lang === lang.trim()
      && !/\n/.test(lang) && Object.keys(node.attrs).length === 1
  },
}

function attrsAreUnrebuildable(node) {
  const check = WRITER_EMITTED_ATTRS[node.type]
  if (check) return !check(node)
  return node.attrs !== undefined
}

/**
 * The inline Markdown a container's single paragraph child renders to. Used by
 * the trim rules below — several containers `.trim()` their rendered content on
 * the way out, or have it trimmed on the way back in, so leading/trailing
 * whitespace in the STORED text is destroyed by the round trip even though every
 * node type involved is perfectly rebuildable.
 */
function renderedParagraphText(node) {
  const paragraph = node.content?.[0]
  return renderAdfNodes(paragraph?.content)
}

function nodeShapeIsUnrebuildable(node, ctx) {
  if (attrsAreUnrebuildable(node)) return true
  switch (node.type) {
    // A heading's content goes through bare `parseInline` — see containsHardBreak.
    // Its text is also trimmed twice on the way back (`^(#{1,6})\s+` eats the
    // leading run, then `.trim()`), and an empty heading loses the `# ` marker
    // entirely and re-reads as a paragraph of literal `#`. A blank line inside
    // it splits the block in two, taking the `# ` with it.
    case 'heading': {
      if (containsHardBreak(node.content)) return true
      const text = renderAdfNodes(node.content)
      return text === '' || text !== text.trim() || BLOCK_SPLIT_PATTERN.test(text)
    }
    // `renderAdfNode` emits `\n\n` per paragraph and `markdownToAdf` splits
    // blocks on exactly that, so a TOP-LEVEL paragraph that renders to nothing
    // is DROPPED (the review's empty spacer paragraph) and one whose text
    // carries a blank line is TORN IN TWO. Leading/trailing newlines are
    // stripped by the block split's own `replace(/^\n+|\n+$/g, '')`.
    //
    // The empty case is top-level ONLY. Nested in a list item, an empty
    // paragraph is the perfectly rebuildable `- ` line of a multi-item list;
    // it is only lossy when it lands at the document's own trailing edge,
    // where `adfToMarkdown`'s final `.trim()` eats the marker's space — and
    // THAT is caught by the document-edge rule in `adfHasUnrenderableContent`,
    // which sees the whole render rather than one node. Refusing it here as
    // well would refuse the mid-list case needlessly.
    case 'paragraph': {
      const text = renderAdfNodes(node.content)
      if (text === '') return Boolean(ctx?.topLevel)
      return /^\n|\n$/.test(text) || BLOCK_SPLIT_PATTERN.test(text)
    }
    // `parseBlock` always builds `{blockquote, content: [{paragraph, ...}]}` —
    // exactly one paragraph child. A stored blockquote holding two paragraphs
    // collapses into one hardBreak-joined paragraph; one holding a codeBlock or
    // heading loses that child's block type entirely.
    case 'blockquote': {
      if (!(node.content?.length === 1 && node.content[0]?.type === 'paragraph')) return true
      // `renderAdfNode` trims before prefixing each line with `> `.
      const text = renderedParagraphText(node)
      return text !== text.trim()
    }
    // `parseBlock` always builds `{listItem, content: [{paragraph, ...}]}` —
    // exactly one paragraph child. This is also what makes NESTED LISTS
    // unrebuildable at any depth: a nested list lives as a second child of its
    // parent listItem, so every nesting level trips this rule (the writer would
    // otherwise re-emit the nested items as flat siblings of the outer list).
    case 'listItem': {
      if (!(node.content?.length === 1 && node.content[0]?.type === 'paragraph')) return true
      // A `- ` line the reader broke across two lines no longer parses as a
      // list at all — `parseBlock` requires EVERY line of the block to carry
      // the bullet, so the whole list degrades to one paragraph.
      if (containsHardBreak(node.content)) return true
      // `renderAdfNode` trims each item before prefixing its marker, and
      // `parseBlock` strips the marker with a greedy `^-\s+` / `^\d+\.\s+` that
      // eats any leading whitespace with it. So `"  padded  "` is destroyed in
      // both directions (LIN-1886 review F1 sub-class (b)).
      const text = renderedParagraphText(node)
      return text !== text.trim()
    }
    // `markdownToAdf` splits its input into blocks on blank lines BEFORE
    // `parseBlock` ever sees a fence, so a fenced body containing a blank line
    // (or an empty one) is torn into two blocks and the closing ``` leaks out
    // as literal paragraph text. The reader also strips trailing newlines off
    // the body, so a fence is only rebuildable as a single non-empty text run
    // with no blank line and no leading/trailing newline.
    case 'codeBlock': {
      if (node.content?.length !== 1 || node.content[0]?.type !== 'text') return true
      const code = node.content[0].text || ''
      return code === '' || BLOCK_SPLIT_PATTERN.test(code) || /^\n|\n$/.test(code)
    }
    default:
      return false
  }
}

function nodeHasUnrenderableContent(node, ctx = {}) {
  if (!node || typeof node !== 'object') return false
  if (!WRITER_REBUILDABLE_NODE_TYPES.has(node.type)) return true
  if (nodeShapeIsUnrebuildable(node, ctx)) return true
  // A code block's body is the one place a `\n`-bearing text run IS rebuildable
  // (it is fenced and read back verbatim). Its shape rule above has already
  // validated that single child in full, so stop here rather than recursing into
  // it and tripping the newline rule below on legitimate multi-line code.
  if (node.type === 'codeBlock') return false
  if (node.type === 'text') {
    // `parseParagraphContent` splits every `\n` into a `hardBreak`, so a stored
    // run carrying one re-reads as several runs. The writer never emits such a
    // run — `parseInline` only ever sees one line. A HEADING is the exception:
    // its content goes through bare `parseInline`, which has no line concept and
    // hands the newline straight back (the heading's own shape rule above still
    // refuses a blank line or an edge newline, which would break the block).
    if (/\n/.test(node.text || '') && !ctx.newlinesSurviveInText) return true
    if (Array.isArray(node.marks)) {
      // An empty run cannot carry a mark home: `**` / `__` / `~~~~` are all
      // empty-content forms the inline pass rejects (its `+` quantifiers), so
      // they re-read as literal text and the mark is lost. A `link` is the one
      // exception — `[](href)` has always allowed empty link text.
      if ((node.text || '') === '' && node.marks.some(m => m?.type !== 'link')) return true
      // Marks are derived from MARK_RENDERERS directly (never a second
      // hand-copied list) — `matchInlineConstruct` parses exactly that
      // vocabulary back.
      for (const mark of node.marks) {
        if (!Object.prototype.hasOwnProperty.call(MARK_RENDERERS, mark?.type)) return true
      }
      // ...but only ONE mark per run. The inline pass is a single non-nesting
      // left-to-right scan, so a strong+em run renders `_**x**_` and re-parses
      // as ONE em run whose literal text is `**x**` — a mark silently lost and
      // raw Markdown leaked into the body (LIN-1886 review Blocker 3, confirmed
      // by the property test).
      if (node.marks.length > 1) return true
      // A link's href rides the `](…)` slot, which is line-bounded and (since
      // fix cycle 3) paren-escaped. A newline in it would still break the block.
      const link = node.marks.find(m => m?.type === 'link')
      if (link && /\n/.test(link.attrs?.href || '')) return true
    }
  }
  if (Array.isArray(node.content)) {
    // `topLevel` never propagates — only `adfHasUnrenderableContent` sets it.
    const childCtx = node.type === 'heading' ? { newlinesSurviveInText: true } : {}
    for (let i = 0; i < node.content.length; i += 1) {
      if (nodeHasUnrenderableContent(node.content[i], childCtx)) return true
      // Two adjacent UNMARKED runs render as one uninterrupted stretch of text,
      // and `parseInline` accumulates contiguous literal text into a single
      // node — so the split between them is not recoverable. (Adjacent runs
      // carrying a mark are fine: their delimiters survive and re-split them,
      // which is why this is narrowed to unmarked pairs rather than any pair.)
      if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.content[i])) return true
    }
  }
  return false
}

const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length > 0)

/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. The invariant this gate exists to buy is:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc,
 *           EXCEPT for the two enumerated classes below
 *
 * — asserted, in both directions, over the fixture list and the generated
 * adversarial corpus in `tests/unit/jira-provider.test.js`. See the note above
 * `WRITER_REBUILDABLE_NODE_TYPES` for exactly how far that evidence reaches.
 *
 * The exceptions are ENUMERATED rather than papered over. This docstring
 * previously asserted the invariant unqualified, and it was not true; an
 * overclaiming property is what let a real defect sit through three review
 * cycles, so the wording is now the weakest claim the evidence actually
 * supports and no weaker (LIN-1886, John's ruling `d38d3755`). Both exceptions
 * are STRUCTURE-ONLY — neither changes a rendered character — and both are
 * pinned by fixtures, so a regression that widened either one would fail.
 *
 *   1. **An empty, unmarked text run — tracked as LIN-1939.** Pre-existing and
 *      orthogonal: it is NOT introduced by LIN-1886 (the identical probe gives
 *      byte-identical results at this head and at the pre-change base) and is
 *      deliberately not fixed here. `{type: 'text', text: ''}` carrying no
 *      marks slips both guards below — the empty-run rule needs the run to
 *      CARRY a mark, the adjacent-unmarked-pair rule needs BOTH neighbours
 *      unmarked — and the round trip drops it:
 *
 *          { type: 'paragraph', content: [
 *              { type: 'text', text: '' },
 *              { type: 'text', text: 'x', marks: [{ type: 'em' }] } ] }
 *
 *      → permitted; renders `_x_`; re-reads WITHOUT the empty run. Nothing
 *      visible is lost (the run is empty), but the document is restructured
 *      under a 200. See LIN-1939 before relying on the invariant for a
 *      mark-adjacency case.
 *
 *   2. **An `orderedList`'s identity `attrs`** — `{order: 1}`, or a bare `{}`,
 *      permitted by `WRITER_EMITTED_ATTRS` above per the same ruling. The
 *      writer emits no `attrs` key at all, so the key is ABSENT after the
 *      round trip. The rendered Markdown is identical either way (the reader
 *      renumbers from 1 regardless), which is the sense in which the identity
 *      value is harmless; the deep-equality is nevertheless genuinely lost, so
 *      it is named here rather than claimed away. A non-identity `order` is
 *      still refused, because dropping THAT renumbers the list.
 *
 * Everything else this gate permits deep-equals in the strict sense.
 *
 * The gate is derived from the WRITER's vocabulary, not the reader's (LIN-1886
 * review Blocker 3 — deriving it from the reader is what let a 200-OK append
 * flatten a mention/emoji/smart-link description into one anonymous text run).
 * Five things trip it, checked recursively through the WHOLE tree (a table
 * nested three levels inside an otherwise-modeled list is still caught):
 *   - a node `type` outside `WRITER_REBUILDABLE_NODE_TYPES`;
 *   - a permitted type in a shape the writer never emits
 *     (`nodeShapeIsUnrebuildable` — a multi-paragraph blockquote, a listItem
 *     holding anything but one paragraph (hence any nested list), a fenced code
 *     body with a blank line, a hardBreak inside a heading or a list item);
 *   - `attrs` the writer cannot re-emit (`WRITER_EMITTED_ATTRS` — a
 *     NON-IDENTITY `orderedList` `order`, a heading `level` outside 1-6, a
 *     padded `codeBlock` language: LIN-1886 review F1 sub-class (b));
 *   - whitespace a `.trim()` on either side of the round trip destroys — at a
 *     list item, a blockquote, a heading, or the document's own edges;
 *   - a text node carrying a mark outside `MARK_RENDERERS`'s keys, MORE THAN
 *     ONE mark, or an embedded newline outside a fence.
 *
 * WHAT IS NOT ON THIS LIST, and deliberately (LIN-1886 review F1, human
 * decision `599551c2`): Markdown-syntax collisions in ordinary prose. A
 * paragraph reading `- not a list`, or `foo_bar_baz`, or ```` ```js ```` is NOT
 * refused — `adfToMarkdown` escapes it and it round-trips faithfully. Refusing
 * prose was rejected as a remedy; escaping is the one this cycle implements.
 *
 * Used to refuse (422) an in-app description overwrite that would silently
 * destroy Jira-native content — never used to reject a READ. `adfToMarkdown`
 * still renders mentions, emoji and cards for display; only the write tightens.
 *
 * Mirrors `adfToMarkdown`'s own contract: the wrapper's `type` (`'doc'` on a
 * real Jira document) is never itself validated, only `doc.content` — so a
 * bare `{ content: [...] }`, exactly what `adfToMarkdown`'s own test literals
 * use, is inspected the same way a `{ type: 'doc', content: [...] }` document
 * would be.
 * @param {object|null|undefined} doc - an ADF document (or any ADF node)
 * @returns {boolean}
 */
export function adfHasUnrenderableContent(doc) {
  if (!doc || typeof doc !== 'object') return false
  if ((doc.content || []).some(node => nodeHasUnrenderableContent(node, { topLevel: true }))) return true
  // The document's OWN edges. `adfToMarkdown` finishes with a `.trim()`, which
  // is invisible to any per-node rule: every node here can be individually
  // rebuildable and the first block's leading space still be eaten. The
  // trailing side ignores the block-separating newlines every renderer emits —
  // those are structure, not content — and asks only about what precedes them.
  const raw = renderAdfNodes(doc.content)
  if (raw !== raw.trimStart()) return true
  const withoutBlockBreaks = raw.replace(/\n+$/, '')
  return withoutBlockBreaks !== withoutBlockBreaks.trimEnd()
}

// -----------------------------------------------------------------------------
// The exact `fields` a JQL search must request (LIN-1885 beat 1 review
// blocker) — `/rest/api/3/search/jql` returns only issue IDs by default, so
// every field `_toCanonicalIssue`/`fetchIssueContext` reads off `jira.fields`
// below MUST be listed here or it silently comes back `undefined`. Verified
// against both read sites by hand at beat time; keep this list and those two
// functions in lockstep.
// -----------------------------------------------------------------------------
export const JIRA_ISSUE_FIELDS = [
  'summary', 'status', 'description', 'project', 'parent',
  'assignee', 'labels', 'created', 'duedate', 'resolutiondate',
]

/** JQL scoping every mapped project's issues (LIN-1885 beat 1 review finding #2)
 *  — bounds a dashboard render to the site's own projects instead of an
 *  unfiltered site-wide walk (the "one bad script" pattern the shared
 *  per-tenant burst bucket punishes), and Jira now rejects a bare
 *  `ORDER BY key ASC` with no filter clause as `400 Bad Request` anyway. */
function projectScopedJql(projectKeys) {
  const keys = projectKeys.filter(Boolean)
  if (!keys.length) return null
  const list = keys.map(key => `"${key}"`).join(',')
  return `project in (${list}) ORDER BY key ASC`
}

/** Best-effort human org name from a Jira site URL, for the dashboard header. */
function orgNameFromSite(site) {
  if (!site) return 'Jira'
  try {
    return new URL(site).hostname.replace(/\.atlassian\.net$/, '') || 'Jira'
  } catch {
    return 'Jira'
  }
}

export class JiraProvider extends ProviderInterface {
  /**
   * @param {{ client?: object, clientFactory?: (credential: {email,apiToken,site}) => object, site?: string }} [opts]
   *   client        — boot-configured REST boundary (unit-test / single-tenant DI path).
   *   clientFactory — test/DI seam: builds the PER-REQUEST client from a Basic-auth
   *                   credential. Production leaves it unset, so `_clientForCredential`
   *                   mints a real createJiraClient; tests inject the fake.
   *   site          — default tenant base URL, used only by getCreateTaskUrl (the
   *                   "+ Add task" deep link) when no per-call scope is available —
   *                   mirrors GitHubProvider's single-default-repo limitation.
   */
  constructor({ client, clientFactory, site } = {}) {
    super()
    this.name = 'jira'
    this.client = client || null
    this.clientFactory = clientFactory || null
    this.site = site || null
  }

  /** Boot-time DI, mirroring LocalProvider.configure({ store }) / GitHubProvider.configure. */
  configure({ client, clientFactory, site } = {}) {
    if (client) this.client = client
    if (clientFactory) this.clientFactory = clientFactory
    if (site) this.site = site
    return this
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('JiraProvider: client not configured (call configure({ client }) at boot)')
    }
    return this.client
  }

  /**
   * Resolve the REST client for a single read call. `scope` is one of the two
   * Jira credential shapes (both produced by `getWorkspaceCallScope` /
   * `getBindingCallScope`), or absent, falling back to the boot-configured
   * `client` (unit tests / DI):
   *
   *   - Basic (Phase 1, LIN-1885): `{ email, apiToken, site }`
   *   - OAuth 3LO (Phase 3, LIN-1887): `{ authType: 'oauth', accessToken, cloudId, site }`
   *
   * Discriminated on `authType`, so the Phase 1 shape — validated in production
   * on 2026-08-07 and still live — takes a byte-identical path.
   *
   * Both arms FAIL CLOSED and loudly on a missing field. That is load-bearing
   * beyond hygiene: `getWorkspaceCallScope` (LIN-1887 Step 6) now returns no
   * scope at all rather than guessing when a workspace has several Jira bindings
   * and the mirrored token matches none of them, and this throw is what turns
   * that refusal into a visible failure instead of a silent call against the
   * boot-configured default client.
   *
   * @param {{authType?: string, email?: string, apiToken?: string, accessToken?: string, cloudId?: string, site?: string}} [scope]
   * @returns {object}
   */
  _clientFor(scope) {
    if (scope && typeof scope === 'object') {
      if (scope.ambiguousCallScope) {
        throw new Error('JiraProvider: this workspace has several Jira bindings and the active one could not be identified — refusing to guess which site to call')
      }
      if (scope.authType === 'oauth') {
        const { accessToken, cloudId, site } = scope
        if (!accessToken || !cloudId) {
          throw new Error('JiraProvider: OAuth credential is missing accessToken/cloudId (cannot build a request-time client)')
        }
        return this._clientForCredential({ authType: 'oauth', accessToken, cloudId, site })
      }
      const { email, apiToken, site } = scope
      if (!apiToken || !site) {
        throw new Error('JiraProvider: credential is missing apiToken/site (cannot build a request-time client)')
      }
      return this._clientForCredential({ email, apiToken, site })
    }
    return this._requireClient()
  }

  /** Per-credential REST client — a real createJiraClient in production, the injected fake in tests. */
  _clientForCredential(credential) {
    return this.clientFactory ? this.clientFactory(credential) : createJiraClient(credential)
  }

  /** The tenant base URL for this call — the per-call scope's `site`, else the boot default. */
  _resolveSite(scope) {
    const site = (scope && typeof scope === 'object' ? scope.site : null) || this.site
    return site ? String(site).replace(/\/+$/, '') : null
  }

  // ---------------------------------------------------------------------------
  // Shape mapping: Jira REST issue/project → canonical shapes.
  // ---------------------------------------------------------------------------

  _toCanonicalIssue(jira, site) {
    const fields = jira.fields || {}
    const done = fields.status?.statusCategory?.key === 'done'
    return {
      source: SOURCE_JIRA, // provenance stamp (LIN-561)
      id: jira.id, // the immutable issue id is the opaque identity; `key` is human-readable only
      identifier: jira.key,
      title: fields.summary || '',
      description: adfToMarkdown(fields.description),
      estimate: null, // capability: estimates:false (Phase 4)
      priority: 0,
      sortOrder: 0,
      createdAt: fields.created || null,
      dueDate: fields.duedate || null,
      completedAt: done ? (fields.resolutiondate || null) : null,
      url: site && jira.key ? `${site}/browse/${jira.key}` : null,
      // Best-effort: Jira's native one-level subtask parent link.
      parent: fields.parent ? { id: fields.parent.id, identifier: fields.parent.key } : null,
      project: fields.project ? { id: fields.project.id, name: fields.project.name } : null,
      state: jiraStatusCategoryToCanonical(jira),
      assignee: fields.assignee ? { name: fields.assignee.displayName } : null,
      labels: { nodes: (fields.labels || []).map(name => ({ name })) },
      // No typed relations mapped this phase (epic-link deferred to Phase 4).
      relations: { nodes: [] },
    }
  }

  /**
   * `url` is the user-FACING "View in Jira →" link (`lib/render.js` renders
   * canonical `project.url` as the detail link), so it must be the browsable
   * project page — NOT `project.self`, which is the REST *resource* URL
   * (`.../rest/api/3/project/10000`, raw JSON) — that was LIN-1885 beat 2
   * review finding #4. Mirrors GitHub's `milestone.html_url` (a distinct
   * browsable link, not its REST `url`).
   */
  _toCanonicalProject(project, site) {
    return {
      id: project.id,
      name: project.name,
      content: null,
      url: site && project.key ? `${site}/browse/${project.key}` : null,
      sortOrder: 0,
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Projects + issues for the dashboard, mirroring the GitHub/Local
   * `fetchProjects` shape. `scope` is the per-request Basic-auth credential.
   * Issues are fetched with a JQL scoped to the site's own projects (LIN-1885
   * beat 1 review finding #2) — projects must resolve first, so this is
   * sequential rather than the prior Promise.all; an unfiltered `ORDER BY key
   * ASC` is both unbounded (a full-tenant page walk) and, since the beat 1
   * migration to `/search/jql`, rejected outright (`400`) as a filterless
   * query. No projects → no scoped JQL to run, so issues short-circuits to [].
   * @returns {Promise<{organizationName, projects, issues}>}
   */
  async fetchProjects(scope, _teamId = null, _opts = {}) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const projects = await client.listAllProjects()
    const jql = projectScopedJql(projects.map(p => p.key))
    const issues = jql ? await client.searchAllIssues(jql, { fields: JIRA_ISSUE_FIELDS }) : []
    return {
      organizationName: orgNameFromSite(site),
      projects: projects.map(p => this._toCanonicalProject(p, site)),
      issues: issues.map(i => this._toCanonicalIssue(i, site)),
    }
  }

  /**
   * Jira projects are NOT coerced into canonical teams (capability teams:false).
   * Returning [] rather than throwing keeps the dashboard's
   * fetchAndPrepareProjects provider-agnostic, mirroring GitHub/Local.
   */
  async fetchTeams(_scope) {
    return []
  }

  /**
   * A single Jira issue → the same canonical render shape fetchProjects emits
   * per node (mirrors GitHubProvider.fetchIssueFields). Backs the dashboard's
   * lazy per-issue detail load (LIN-442) — without this, expanding an issue
   * row 404s/silently fails to load its description/comments toggle even
   * though the row itself rendered fine from fetchProjects' bulk read.
   */
  async fetchIssueFields(scope, issueId) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) throw new Error(`Issue not found: ${issueId}`)
    return this._toCanonicalIssue(jira, site)
  }

  /**
   * Single-issue context for the detail/recommendation surfaces. Children are
   * Jira's native one-level subtasks (`parent = "<key>"`), fetched best-effort;
   * siblings/cousins stay empty this phase (no team/cross-project traversal).
   */
  async fetchIssueContext(scope, issueId) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) throw new Error(`Issue not found: ${issueId}`)
    const fields = jira.fields || {}
    const children = jira.key
      ? await client.searchAllIssues(`parent = "${jira.key}" ORDER BY key ASC`, { fields: JIRA_ISSUE_FIELDS })
      : []
    return {
      issue: {
        id: jira.id,
        identifier: jira.key,
        title: fields.summary || '',
        description: adfToMarkdown(fields.description),
        url: site && jira.key ? `${site}/browse/${jira.key}` : null,
        state: jiraStatusCategoryToCanonical(jira),
        labels: fields.labels || [],
      },
      parent: fields.parent ? { id: fields.parent.id, identifier: fields.parent.key, title: null } : null,
      siblings: [],
      siblingsTotal: 0,
      parentChildCount: null,
      cousins: [],
      cousinsTotal: 0,
      project: fields.project ? { name: fields.project.name, description: null } : null,
      children: children.map(c => this._toCanonicalIssue(c, site)),
      // Pass `scope` (not the resolved client) so the nested read rebuilds its
      // own request-time client from the credential, mirroring GitHub's pattern.
      comments: await this.fetchIssueComments(scope, issueId),
    }
  }

  /** Comments for an issue, oldest-first. Implementing this sets ui.comments=true. */
  async fetchIssueComments(scope, issueId) {
    const client = this._clientFor(scope)
    const comments = await client.listAllComments(issueId)
    return comments
      .map(c => ({
        id: String(c.id),
        body: adfToMarkdown(c.body),
        createdAt: c.created,
        user: c.author?.displayName || 'jira',
      }))
      .sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0))
  }

  /** Lightweight project list (no issues) — reuses the fetchProjects mapping. */
  async fetchProjectsList(scope) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const projects = await client.listAllProjects()
    return projects.map(p => this._toCanonicalProject(p, site))
  }

  /** The fixed synthetic workflow vocabulary (LIN-1886 D2(a)) — see JIRA_STATES. */
  async states(_scope, _teamId = null) {
    return JIRA_STATES.map(s => ({ ...s }))
  }

  /**
   * Distinct labels on the site — Jira labels are real, global (not
   * per-project), read via `GET /rest/api/3/label`. Shape mirrors GitHub's
   * `labels()` (`{ id: name, name }`, id = name) so `resolveLabelInput`
   * (routes/proxy.js) and `issueLabels`/`updateIssueLabels` below compare like
   * with like.
   */
  async labels(scope) {
    const client = this._clientFor(scope)
    const names = await client.listAllLabels()
    return names.map(name => ({ id: name, name }))
  }

  // ---------------------------------------------------------------------------
  // Route-internal reads (LIN-1886) — the write routes call these
  // UNCONDITIONALLY before mutating. Deliberately OFF the declared
  // PROVIDER_SURFACE (route-internal data-fetch, not a capability), mirroring
  // `lib/providers/github/index.js:775-847`'s issueWriteGuard/issueDescription/
  // issueLabels/updateIssueLabels — `supports()` stays false for all four; the
  // routes gate on method EXISTENCE (`denyIfMissingRead`) instead.
  // ---------------------------------------------------------------------------

  /**
   * Trashed probe + team scope (`{ id, trashed, team }` or null). Jira has no
   * soft-delete, so `trashed` is always false. `team.id` MUST be non-null: the
   * routes pass it to `resolveStateInput` to scope a symbolic `stateId`
   * (`states()` ignores it, but a null team.id 422s "the issue's team could not
   * be determined" before `states()` is ever consulted) — the issue's own
   * project key is a stable, always-present placeholder, mirroring GitHub's
   * `team: { id: repo || 'github' }`.
   * @returns {Promise<Object|null>}
   */
  async issueWriteGuard(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    const teamId = jira.fields?.project?.key || jira.fields?.project?.id || 'jira'
    return { id: jira.id, trashed: false, team: { id: String(teamId) } }
  }

  /**
   * The issue's description as MARKDOWN (`{ id, description, trashed }` or
   * null) — a plain string, matching every other provider's `issueDescription`
   * (`github/index.js`'s `gh.body ?? ''`, `local/index.js`, `linear/index.js`).
   *
   * The string is the CONTRACT, not an incidental convenience: `routes/proxy.js`'s
   * shared `applyDescriptionEdit` is a markdown-string read-modify-write over
   * this field (`merge(issue.description || '')` → `appendBlock`/`replace` in
   * `lib/description-edit.js`, both of which `String(...)` their input). Handed
   * the raw ADF object, that splice stringified it to `"[object Object]"`, so
   * `.../description/append` DESTROYED the stored body and
   * `.../description/replace` could never match — LIN-1886's review Blocker 1.
   *
   * Nothing needs the unconverted wire shape here: `updateIssue`'s D1 refusal
   * check reads the CURRENT stored ADF independently, off its own
   * `client.getIssue(issueId)` call, and never consults this method. So the
   * append/replace lane round-trips ADF→markdown→splice→`markdownToAdf`, while
   * an issue whose stored ADF carries unrenderable content is still refused
   * (422, no write) by that same D1 guard on the way back through `updateIssue`.
   * @returns {Promise<Object|null>}
   */
  async issueDescription(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    return { id: jira.id, description: adfToMarkdown(jira.fields?.description), trashed: false }
  }

  /**
   * Current label set + trashed flag (`{ id, trashed, labels: { nodes } }` or
   * null) for the label add/remove read-modify-write. Jira labels are
   * name-keyed (like GitHub's), so each node is `{ id: name, name }`.
   * @returns {Promise<Object|null>}
   */
  async issueLabels(scope, issueId) {
    const client = this._clientFor(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return null
    return {
      id: jira.id,
      trashed: false,
      labels: { nodes: (jira.fields?.labels || []).map(name => ({ id: name, name })) },
    }
  }

  /**
   * Write a full label set onto an issue (the write half of the label RMW).
   *
   * Diffed against the CURRENT set and emitted as ONE atomic Jira
   * `PUT /issue/{id}` with `update: { labels: [{add}, {remove}, ...] }` — Jira
   * supports this natively (unlike GitHub's per-label REST endpoints), so no
   * per-label round trip is needed. Re-reads and returns the canonical issue
   * (mirrors GitHub's `updateIssueLabels` return shape: `{ success, issue }`,
   * which `routes/proxy.js` echoes through `writeRejected` + `flattenIssue`).
   * @returns {Promise<{success: boolean, issue: Object|null}>}
   */
  async updateIssueLabels(scope, issueId, labelIds) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)
    const jira = await client.getIssue(issueId)
    if (!jira) return { success: false, issue: null }
    const current = jira.fields?.labels || []
    const desired = (labelIds || []).map(id => String(id))
    const toAdd = desired.filter(name => !current.includes(name))
    const toRemove = current.filter(name => !desired.includes(name))
    if (toAdd.length || toRemove.length) {
      await client.updateIssue(issueId, {
        update: { labels: [...toAdd.map(name => ({ add: name })), ...toRemove.map(name => ({ remove: name }))] },
      })
    }
    const fresh = await client.getIssue(issueId)
    if (!fresh) return { success: false, issue: null }
    return { success: true, issue: this._toCanonicalIssue(fresh, site) }
  }

  // ---------------------------------------------------------------------------
  // Writes (LIN-1886)
  // ---------------------------------------------------------------------------

  /**
   * Update an issue: title/description (D1-guarded), status transition
   * (D2), with `priority` silently excluded (D3) and `projectId`/top-level
   * `parentId` refused (D4). ALWAYS re-reads after any write and returns the
   * canonical mapped issue — never trusts the write response body, since a
   * 204 (title/description PUT) or the transition POST's body is not the full
   * issue shape `_toCanonicalIssue` needs (L4 finding).
   *
   * EVERY refusable check runs before the FIRST write (LIN-1886 review N1) —
   * D4's field refusals, D1's unrenderable-description guard, and the whole of
   * D2's transition resolution. A patch this method refuses therefore leaves
   * the issue untouched; a partially-applied "not updated" is not a state a
   * caller can be handed.
   * @returns {Promise<Object|null>} updated issue (canonical), or null if missing.
   */
  async updateIssue(scope, issueId, patch = {}) {
    const client = this._clientFor(scope)
    const site = this._resolveSite(scope)

    // D4 policy: refuse (422) any patch field this provider cannot genuinely
    // honor, before any read or write is attempted.
    if (patch.projectId) {
      throw new RefResolutionError(
        'Jira does not support moving an issue between projects through this integration yet',
        { status: 422 },
      )
    }
    if (patch.parentId === null) {
      throw new RefResolutionError(
        'Jira does not support promoting an issue to top-level through this integration yet',
        { status: 422 },
      )
    }

    const current = await client.getIssue(issueId)
    if (!current) return null

    // D3: patch.priority is intentionally never read here — silently excluded
    // from the Jira PUT body (mirrors ui.priority: false hiding the control).
    const fields = {}
    if (patch.title != null) fields.summary = patch.title
    if (patch.description !== undefined) {
      // D1: refuse loudly rather than silently destroy Jira-native content this
      // integration cannot round-trip losslessly.
      //
      // The message is the ENTIRE UX of this refusal, so it names the causes
      // that actually fire (LIN-1886 review F3 — it used to say only "a table,
      // attachment, panel, unsupported text formatting", written before
      // `641c7f01` widened the trigger set to mentions, emoji, smart links and
      // the structural rules, and a mention is the most common trigger of all).
      // Keep it in step with `adfHasUnrenderableContent`'s rule list; ordinary
      // Markdown-looking prose is deliberately absent because fix cycle 3
      // escapes it rather than refusing it.
      if (adfHasUnrenderableContent(current.fields?.description)) {
        throw new RefResolutionError(
          "Cannot overwrite this issue's description: it contains Jira content this integration "
          + 'cannot round-trip losslessly — an @-mention, emoji, smart link, table, attachment or '
          + 'panel; a nested list, a multi-paragraph quote, or a code block containing a blank '
          + 'line; text carrying two formatting marks at once; or a numbered list that does not '
          + 'start at 1. Edit the description in Jira instead',
          { status: 422 },
        )
      }
      fields.description = markdownToAdf(patch.description)
    }

    // D2: RESOLVE the status-transition intent completely — every branch that
    // can refuse (an unknown stateId, a canonical type Jira has no category
    // for, no matching transition, a screen-required transition) runs HERE,
    // before the first write is issued. A refusal must leave the issue exactly
    // as it was; issuing the field PUT first meant a refused transition still
    // renamed the issue while telling the caller nothing was updated
    // (LIN-1886 review N1). Skip-on-unchanged is unchanged: when the current
    // canonical type already matches, no getTransitions/doTransition call is
    // made at all.
    let transitionId = null
    if (patch.stateId != null) {
      const targetType = jiraStateIdToCanonicalType(patch.stateId)
      const currentType = jiraStatusCategoryToCanonical(current).type
      if (targetType !== currentType) {
        const targetCategoryKey = CANONICAL_TYPE_TO_STATUS_CATEGORY[targetType]
        if (!targetCategoryKey) {
          // canceled/duplicate are unreachable from Jira's statusCategory
          // vocabulary — refuse loudly, never silently fold into 'done'.
          throw new RefResolutionError(
            `Jira has no '${targetType}' status category to transition to`,
            { status: 422 },
          )
        }
        const { transitions } = await client.getTransitions(issueId)
        const match = (transitions || []).find(t => t.to?.statusCategory?.key === targetCategoryKey)
        if (!match) {
          throw new RefResolutionError(
            `No available Jira transition moves this issue to '${targetType}' from its current status`,
            { status: 422 },
          )
        }
        if (match.fields && Object.keys(match.fields).length > 0) {
          throw new RefResolutionError(
            `Jira transition '${match.name}' requires a screen (additional required fields) this integration cannot drive`,
            { status: 422 },
          )
        }
        transitionId = match.id
      }
    }

    // --- Writes only past this point; nothing below can refuse. --------------
    let didWrite = false
    if (Object.keys(fields).length > 0) {
      await client.updateIssue(issueId, { fields })
      didWrite = true
    }
    if (transitionId != null) {
      await client.doTransition(issueId, transitionId)
      didWrite = true
    }

    const fresh = didWrite ? await client.getIssue(issueId) : current
    if (!fresh) return null
    return this._toCanonicalIssue(fresh, site)
  }

  /**
   * Create a comment from Markdown, converting to ADF on the way in. Jira's
   * comment-create response returns the full comment object (unlike the
   * sparse 204 an issue PUT returns), so this trusts the response directly
   * rather than re-reading.
   * @returns {Promise<Object>} the created comment (canonical shape, matching
   *   `fetchIssueComments`'s per-comment shape).
   */
  async createComment(scope, issueId, body) {
    const client = this._clientFor(scope)
    const adf = markdownToAdf(body)
    const created = await client.createComment(issueId, { body: adf })
    if (!created) throw new Error(`Issue not found: ${issueId}`)
    return {
      id: String(created.id),
      body: adfToMarkdown(created.body),
      createdAt: created.created,
      user: created.author?.displayName || 'jira',
    }
  }

  /** Thin single-label wrapper over `updateIssueLabels` (capability-gate completeness only — no production call site; the routes read-modify-write via `updateIssueLabels` directly). */
  async addLabel(scope, issueId, label) {
    const current = await this.issueLabels(scope, issueId)
    if (!current) return false
    const names = (current.labels?.nodes || []).map(n => n.name)
    if (names.includes(label)) return true
    const result = await this.updateIssueLabels(scope, issueId, [...names, label])
    return !!result.success
  }

  /** Thin single-label wrapper over `updateIssueLabels` (see addLabel). */
  async removeLabel(scope, issueId, label) {
    const current = await this.issueLabels(scope, issueId)
    if (!current) return false
    const names = (current.labels?.nodes || []).map(n => n.name)
    const result = await this.updateIssueLabels(scope, issueId, names.filter(n => n !== label))
    return !!result.success
  }

  // ---------------------------------------------------------------------------
  // URLs / UI capability surface
  // ---------------------------------------------------------------------------

  /**
   * Jira's "create issue" deep link (the global create dialog, project-scoped
   * when `projectId` is known). Overriding this is what makes `ui.write` true
   * (render gates "+ Add task" on it) — this is an EXTERNAL link, not an
   * in-app write; createIssue/updateIssue stay unimplemented this phase.
   * Uses the boot-configured default `site` (single-tenant limitation,
   * mirrors GitHubProvider.getCreateTaskUrl's single-default-repo note).
   */
  getCreateTaskUrl(_urlKey, projectId) {
    if (!this.site) return 'https://www.atlassian.com/software/jira'
    const base = String(this.site).replace(/\/+$/, '')
    return projectId
      ? `${base}/secure/CreateIssue.jspa?pid=${encodeURIComponent(projectId)}`
      : `${base}/secure/CreateIssue!default.jspa`
  }

  /**
   * `write`/`comments`/`inlineCreate`/`inlineEdit` all auto-derive from the base
   * getter (getCreateTaskUrl override + fetchIssueComments/createComment
   * implemented + createIssue still NOT implemented (LIN-1557), updateIssue NOW
   * implemented (LIN-1886) → inlineEdit flips true, inlineCreate stays false).
   * Override only the abstract flags Jira's own schema decides: subtasks (native
   * one-level parent/child, best-effort mapped), estimates (no story-point field
   * this phase — Phase 4), priority (LIN-1886 D3: priority is hardcoded 0/
   * unmapped in `_toCanonicalIssue`, so the in-app edit form hides the control
   * rather than lying about it), plus displayName (LIN-1885 research: `server.js`'s
   * bound-binding row reads `ui.displayName`, a DIFFERENT source than the
   * Settings add-list's static `displayName` — without this override a bound
   * Jira workspace would render lowercase `jira`).
   */
  get ui() {
    return { ...super.ui, estimates: false, subtasks: true, priority: false, displayName: 'Jira' }
  }

  // ---------------------------------------------------------------------------
  // Auth — the Jira consumer of the LIN-562 binding seam (LIN-1885 beat 2)
  // ---------------------------------------------------------------------------

  /**
   * Validate a Basic-auth credential via a lightweight read probe (LIN-1885):
   * `GET /rest/api/3/myself`. Mirrors the settings refresh route's READ_PROBES
   * pattern (`server.js` ~2770-2787) in spirit, but Jira's Phase 1 read surface
   * has no `fetchViewer`/`fetchOrganization`/`fetchProjectsList` to reuse
   * through that generic list, so the probe is a direct client call instead.
   * Used by `routes/jira-auth.js`'s link handler to validate-then-link
   * synchronously — a failed probe throws (the client's status-carrying
   * error), never silently linking a dead credential.
   * @param {{email: string, apiToken: string, site: string}} credential
   * @returns {Promise<{accountId: string, emailAddress?: string, displayName?: string}>}
   */
  async validateCredential(credential) {
    // LIN-1887: takes either credential shape verbatim — Basic
    // `{email, apiToken, site}` or OAuth `{authType:'oauth', accessToken, cloudId, site}`
    // — because `createJiraClient` already forks on `authType` and this is a
    // pass-through. `GET /rest/api/3/myself` is deliberately the identity probe
    // for BOTH shapes (rather than `api.atlassian.com/me` for OAuth): it needs no
    // scope beyond `read:jira-user`, so it does not widen the D2 consent set, and
    // it returns the same Atlassian `accountId`, so a human upgrading a Basic
    // link to OAuth resolves to the same Harbour account instead of colliding
    // with themselves.
    const client = this._clientForCredential(credential)
    return client.getMyself()
  }

  /**
   * The Jira auth router (LIN-1885). Mounted by server.js's per-provider
   * auth-mount loop (it iterates `getAllProviders().getAuthRouter()`). Mirrors
   * GitHubProvider.getAuthRouter — folds routes/jira-auth.js behind the
   * provider and injects `this` so the route drives the provider's seam.
   * @param {{sessionStore: Object, accountStore: Object, accountWorkspaceStore: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) {
    return createJiraAuthRoutes({ ...opts, provider: this })
  }
}

/** Singleton Jira provider (client/site injected at boot via configure()). */
export const jiraProvider = new JiraProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module is what populates the registry under
// 'jira'; server.js's side-effect import (LIN-1885 beat 4) is what makes that
// import actually happen at boot.
registerProvider(jiraProvider)
