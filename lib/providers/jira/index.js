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
const MARK_RENDERERS = {
  strong: text => `**${text}**`,
  em: text => `_${text}_`,
  code: text => `\`${text}\``,
  strike: text => `~~${text}~~`,
  link: (text, mark) => `[${text}](${mark?.attrs?.href || ''})`,
}

function renderMarks(text, marks) {
  return (marks || []).reduce((out, mark) => {
    const render = MARK_RENDERERS[mark.type]
    return render ? render(out, mark) : out
  }, text)
}

function renderAdfNodes(nodes) {
  return (nodes || []).map(renderAdfNode).join('')
}

function renderAdfNode(node) {
  if (!node || typeof node !== 'object') return ''
  switch (node.type) {
    case 'text':
      return renderMarks(node.text || '', node.marks)
    case 'paragraph':
      return `${renderAdfNodes(node.content)}\n\n`
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
      const code = renderAdfNodes(node.content).replace(/\n+$/, '')
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
// `parseBlock`/`parseInline`/`parseParagraphContent` can emit, and the ADF →
// Markdown → ADF property test pins the correspondence.
//
// Anything else in the input Markdown degrades to plain text; this function
// never throws — refusal-on-unrenderable-content is
// `adfHasUnrenderableContent`'s job, applied to the STORED ADF being
// overwritten, not to freshly-authored Markdown on its way in.
// -----------------------------------------------------------------------------

// Inline scan order matters: link before strong/code/strike/em so a link whose
// text happens to contain another marker character is still captured whole by
// the `[...]("...")` alternative first (leftmost-position wins in a single
// left-to-right `exec` walk; among alternatives at the SAME position, pattern
// order is the tiebreak). Mirrors MARK_RENDERERS' vocabulary exactly — no mark
// type is parsed here that renderMarks cannot also render.
const INLINE_PATTERN = /\[([^\]]*)\]\(([^)]*)\)|\*\*([^*]+)\*\*|`([^`]+)`|~~([^~]+)~~|_([^_]+)_/g

function parseInline(text) {
  const nodes = []
  let lastIndex = 0
  let m
  INLINE_PATTERN.lastIndex = 0
  while ((m = INLINE_PATTERN.exec(text))) {
    if (m.index > lastIndex) nodes.push({ type: 'text', text: text.slice(lastIndex, m.index) })
    if (m[1] !== undefined) {
      nodes.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] || '' } }] })
    } else if (m[3] !== undefined) {
      nodes.push({ type: 'text', text: m[3], marks: [{ type: 'strong' }] })
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'text', text: m[4], marks: [{ type: 'code' }] })
    } else if (m[5] !== undefined) {
      nodes.push({ type: 'text', text: m[5], marks: [{ type: 'strike' }] })
    } else if (m[6] !== undefined) {
      nodes.push({ type: 'text', text: m[6], marks: [{ type: 'em' }] })
    }
    lastIndex = INLINE_PATTERN.lastIndex
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', text: text.slice(lastIndex) })
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
    .split(/\n{2,}/)
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
function nodeShapeIsUnrebuildable(node) {
  switch (node.type) {
    // A heading's content goes through bare `parseInline` — see containsHardBreak.
    case 'heading':
      return containsHardBreak(node.content)
    // `parseBlock` always builds `{blockquote, content: [{paragraph, ...}]}` —
    // exactly one paragraph child. A stored blockquote holding two paragraphs
    // collapses into one hardBreak-joined paragraph; one holding a codeBlock or
    // heading loses that child's block type entirely.
    case 'blockquote':
      return !(node.content?.length === 1 && node.content[0]?.type === 'paragraph')
    // `parseBlock` always builds `{listItem, content: [{paragraph, ...}]}` —
    // exactly one paragraph child. This is also what makes NESTED LISTS
    // unrebuildable at any depth: a nested list lives as a second child of its
    // parent listItem, so every nesting level trips this rule (the writer would
    // otherwise re-emit the nested items as flat siblings of the outer list).
    case 'listItem':
      if (!(node.content?.length === 1 && node.content[0]?.type === 'paragraph')) return true
      // A `- ` line the reader broke across two lines no longer parses as a
      // list at all — `parseBlock` requires EVERY line of the block to carry
      // the bullet, so the whole list degrades to one paragraph.
      return containsHardBreak(node.content)
    // `markdownToAdf` splits its input into blocks on blank lines BEFORE
    // `parseBlock` ever sees a fence, so a fenced body containing a blank line
    // (or an empty one) is torn into two blocks and the closing ``` leaks out
    // as literal paragraph text. The reader also strips trailing newlines off
    // the body, so a fence is only rebuildable as a single non-empty text run
    // with no blank line and no leading/trailing newline.
    case 'codeBlock': {
      if (node.content?.length !== 1 || node.content[0]?.type !== 'text') return true
      const code = node.content[0].text || ''
      return code === '' || /\n[ \t]*\n/.test(code) || /^\n|\n$/.test(code)
    }
    default:
      return false
  }
}

function nodeHasUnrenderableContent(node) {
  if (!node || typeof node !== 'object') return false
  if (!WRITER_REBUILDABLE_NODE_TYPES.has(node.type)) return true
  if (nodeShapeIsUnrebuildable(node)) return true
  if (node.type === 'text' && Array.isArray(node.marks)) {
    // Marks are derived from MARK_RENDERERS directly (never a second hand-copied
    // list) — `INLINE_PATTERN` parses exactly that vocabulary back.
    for (const mark of node.marks) {
      if (!Object.prototype.hasOwnProperty.call(MARK_RENDERERS, mark?.type)) return true
    }
    // ...but only ONE mark per run. `INLINE_PATTERN` is a single non-nesting
    // left-to-right scan, so a strong+em run renders `_**x**_` and re-parses as
    // ONE em run whose literal text is `**x**` — a mark silently lost and raw
    // Markdown leaked into the body (LIN-1886 review Blocker 3, confirmed by
    // the property test).
    if (node.marks.length > 1) return true
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (nodeHasUnrenderableContent(child)) return true
    }
  }
  return false
}

/**
 * True if `doc` contains anything `markdownToAdf` cannot reconstruct from
 * `adfToMarkdown(doc)`. The invariant this gate exists to buy is:
 *
 *     adfHasUnrenderableContent(doc) === false
 *       ⟹  markdownToAdf(adfToMarkdown(doc)) preserves the stored content
 *
 * i.e. it is derived from the WRITER's vocabulary, not the reader's (LIN-1886
 * review Blocker 3 — deriving it from the reader is what let a 200-OK append
 * flatten a mention/emoji/smart-link description into one anonymous text run).
 * Three things trip it, checked recursively through the WHOLE tree (a table
 * nested three levels inside an otherwise-modeled list is still caught):
 *   - a node `type` outside `WRITER_REBUILDABLE_NODE_TYPES`;
 *   - a permitted type in a shape the writer never emits
 *     (`nodeShapeIsUnrebuildable` — a multi-paragraph blockquote, a listItem
 *     holding anything but one paragraph (hence any nested list), a fenced code
 *     body with a blank line, a hardBreak inside a heading or a list item);
 *   - a text node carrying a mark outside `MARK_RENDERERS`'s keys, or MORE THAN
 *     ONE mark.
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
  return (doc.content || []).some(nodeHasUnrenderableContent)
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
   * Resolve the REST client for a single read call. `scope` is either a
   * `{ email, apiToken, site }` Basic-auth credential (the production path,
   * once LIN-1885 beat 3 wires `getWorkspaceCallScope`) or absent, falling back
   * to the boot-configured `client` (unit tests / DI).
   * @param {{email?: string, apiToken?: string, site?: string}} [scope]
   * @returns {object}
   */
  _clientFor(scope) {
    if (scope && typeof scope === 'object') {
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
      // D1: refuse loudly rather than silently destroy Jira-native content
      // (a table, panel, unsupported mark, ...) this integration cannot
      // round-trip losslessly.
      if (adfHasUnrenderableContent(current.fields?.description)) {
        throw new RefResolutionError(
          "Cannot overwrite this issue's description: it contains Jira content (a table, attachment, panel, unsupported text formatting, or similar) this integration cannot round-trip losslessly",
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
  async validateCredential({ email, apiToken, site }) {
    const client = this._clientForCredential({ email, apiToken, site })
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
