/**
 * Wire-contract neutralization for the consumer proxy API (LIN-310).
 *
 * The proxy speaks a source-neutral, tool-shaped contract:
 *  - nested collections are plain arrays, never a `{ nodes: [...] }` wrapper;
 *  - `labels` is a plain array of names (aligned with the `/stack` flat style),
 *    not an array of `{ id, name, color }` objects — the label catalog lives at
 *    GET /labels for id/colour lookup;
 *  - no field exposes a backend deep-link URL, except for formal (`att:`)
 *    attachment projection where `url` identifies the link target (metadata) so
 *    an agent can identify a link attachment even when the relay blocks the
 *    host (LIN-1673). Markdown (`md:`) attachments remain without `url`.
 *
 * Opaque IDs and identifiers (e.g. "LIN-123") are left untouched by decision.
 *
 * These transforms run as a post-fetch pass at the response boundary — the
 * GraphQL queries are unchanged, so the upstream shape is reshaped here once,
 * consistently, for every read seam and write echo. All transforms mutate in
 * place, are idempotent, and are defensive: an already-flat array passes
 * through untouched and a missing collection is left absent.
 */

// Unwrap a `{ nodes: [...] }` connection into a plain array. Tolerates an
// already-flat array and a missing/null connection.
function unwrap(conn) {
  if (Array.isArray(conn)) return conn;
  if (conn && Array.isArray(conn.nodes)) return conn.nodes;
  return [];
}

// ---------------------------------------------------------------------------
// Canonical attachment shape (LIN-649, parent LIN-612) — defined ONCE here.
// ---------------------------------------------------------------------------
//
// This module is the single owner of the source-neutral attachment contract so
// the shape cannot drift across the read/feedback/UI slices that consume it.
//
//   { id, title, contentType, kind, url? }   kind ∈ {'image','file'}
//
// Formal (`att:`) attachments carry `url` so an agent can identify the link
// target from metadata even when the relay blocks the host (LIN-1673). Markdown
// (`md:`) attachments remain without `url` — the narrower policy reverses only
// one field on one handle kind, scoped to the deadlock LIN-1673 fixes.
// Instead `id` is an OPAQUE, server-resolvable handle — sufficient for the
// slice-2 relay (LIN-650) to fetch the bytes server-side (Bearer-authed +
// SSRF-guarded), never a link the consumer can dereference directly. Two handle
// forms, namespaced by prefix so the relay can route resolution:
//   - `att:<attachmentId>`  formal Linear attachment node (resolve id → bytes)
//   - `md:<base64url(url)>`  markdown-embedded image OR a non-image file link
//                            (decode → SSRF-guard → relay). Non-image file links
//                            (LIN-750) carry a `#name=<filename>` fragment so the
//                            relay can type the extension-less upload bytes; the
//                            fragment is never sent on egress.
// The encode/decode pair lives together here to keep that format single-source.

const IMAGE_EXT_CONTENT_TYPE = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

// Recognised image content-type from a URL's extension, or null. Tolerates a
// trailing query string / fragment (`…/x.png?signature=…`).
function imageContentTypeFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  return IMAGE_EXT_CONTENT_TYPE[m[1].toLowerCase()] || null;
}

// Non-image text/source files the relay (LIN-750) is willing to serve, by
// extension. Deliberately small and explicit. Source files (`.jsx`/`.ts`/…) are
// served as `text/plain` — the consumer reads the bytes; we never hand back an
// executable/renderable content-type for arbitrary uploaded source.
const FILE_EXT_CONTENT_TYPE = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  js: 'text/plain',
  mjs: 'text/plain',
  cjs: 'text/plain',
  jsx: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  css: 'text/plain',
  html: 'text/plain',
  htm: 'text/plain',
  xml: 'text/plain',
  yml: 'text/plain',
  yaml: 'text/plain',
};

// Linear asset hosts that markdown discovery will turn into handles. Narrower
// than the relay's SSRF allowlist on purpose: only the upload/CDN asset hosts
// carry attachable files; `linear.app` deep-links are issue cross-refs.
const LINEAR_UPLOAD_HOSTS = ['uploads.linear.app', 'cdn.linear.app'];

// GitHub user-content asset hosts (LIN-771). The dedicated upload CDNs that carry
// pasted images / uploaded files embedded in issue & comment markdown. We add ONLY
// the dedicated `*.githubusercontent.com` asset hosts — NOT bare `github.com`,
// which (exactly like `linear.app` above) also carries issue/PR cross-reference
// links that are not uploads and must never be discovered as attachments. The
// `github.com/user-attachments/assets/<id>` form is host-ambiguous (it lives on
// `github.com`) and 302-redirects to a signed asset, so it needs path-aware
// discovery + redirect-following in the relay; that is sequenced with S4/S5
// (LIN-773/774, the relay-safety slices) — see the relay note in routes/proxy.js.
// Exported so the relay's SSRF allowlist (ATTACHMENT_ALLOWED_HOSTS) adds the same
// GitHub hosts from a single source — the two allowlists must move in lockstep or
// discovery emits a handle the relay refuses.
export const GITHUB_UPLOAD_HOSTS = [
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
];

// Discovery is keyed on the upload HOST, so a single union allowlist is itself
// provider-aware: every asset host belongs to exactly one provider, so the host
// found in a body unambiguously identifies its source. This keeps the collector
// pure and provider-agnostic — the per-provider on/off switch for whether
// attachments are surfaced at all is the `ui.attachments` capability flag
// (LIN-771), read by the render/prompt surfaces (S3+), not here.
const UPLOAD_HOSTS = new Set([...LINEAR_UPLOAD_HOSTS, ...GITHUB_UPLOAD_HOSTS]);

/**
 * Resolve an allowlisted relay content-type from a filename (or URL) by its
 * extension, covering BOTH images (the shared IMAGE_EXT_CONTENT_TYPE) and the
 * non-image text/source set the relay will serve (FILE_EXT_CONTENT_TYPE), or
 * null when the extension isn't allowlisted. The relay (LIN-750) is the sole
 * type-gate: discovery emits extension-less upload links with contentType:null,
 * so an attachment can be discovered yet cleanly rejected here. Single-sourced
 * here so the "what type is this" notion can't drift from discovery.
 */
export function relayContentTypeFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name.trim());
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return IMAGE_EXT_CONTENT_TYPE[ext] || FILE_EXT_CONTENT_TYPE[ext] || null;
}

/**
 * Encode an opaque, namespaced attachment handle. `att` handles carry the raw
 * (already-opaque) attachment id; `md` handles base64url-encode the source URL
 * so no clickable deep link is exposed on the wire. Slice 2 (LIN-650) decodes.
 */
export function encodeAttachmentHandle(type, value) {
  if (type === 'att') return `att:${value}`;
  return `md:${Buffer.from(String(value), 'utf8').toString('base64url')}`;
}

/**
 * Decode a handle produced by `encodeAttachmentHandle` into `{ type, value }`
 * (`value` is the attachment id for `att`, the source URL for `md`). Returns
 * null for anything that isn't a recognised handle. The slice-2 relay owns the
 * SSRF-guard + fetch; this only reverses the transport encoding.
 */
export function decodeAttachmentHandle(handle) {
  if (typeof handle !== 'string') return null;
  if (handle.startsWith('att:')) return { type: 'att', value: handle.slice(4) };
  if (handle.startsWith('md:')) {
    try {
      return { type: 'md', value: Buffer.from(handle.slice(3), 'base64url').toString('utf8') };
    } catch {
      return null;
    }
  }
  return null;
}

// Markdown inline-upload discovery — a single HOST-ANCHORED pass (LIN-770).
//
// Both markdown forms are matched in one sweep: an image embed `![alt](url)` and
// a plain link `[label](url)`. An embed/link IS an attachment iff its URL host is
// a Linear upload host (`UPLOAD_HOSTS`) — discovery is keyed on the HOST, never
// the file extension or which markdown form was used. This replaces the earlier
// extension-keyed image collector + syntax-keyed file collector, whose pairing
// missed two real cases (the LIN-748 "2 of 4" bug): an extension-less image embed
// (no `.jpg` in the URL → the image-ext filter dropped it) and an angle-bracket-
// wrapped URL `(<url>)` (which made `new URL()` throw → the file pass dropped it).
//
// Per match:
//   - `kind` comes from the leading `!` (`image` vs `file`) — the markdown form,
//     not the extension; Linear upload URLs are extension-less.
//   - surrounding `<>` are stripped from the captured URL before parsing, so
//     `(<url>)` links resolve instead of throwing.
//   - `contentType` is always null: the relay (LIN-750) is the sole type-gate,
//     not discovery.
//   - the alt/link text (the filename) is carried into the `md:` handle as a
//     `#name=<filename>` fragment for BOTH kinds, so extension-less uploads can
//     be typed/served safely. `fetch` never sends a fragment, so egress and the
//     SSRF guard are unchanged, and this stays within the existing `md:` codec.
//
// A single regex with an optional leading `!` matches each upload once (the `!`
// is consumed as part of the embed match, so an image embed is never also matched
// as a plain link), so there is no double-capture across the two forms.
function markdownAttachments(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const re = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const kind = match[1] === '!' ? 'image' : 'file';
    const label = match[2] || '';
    let url = match[3].trim();
    // Strip a single layer of surrounding angle brackets: `(<url>)` → `url`.
    if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1).trim();
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue; // not a parseable absolute URL → not an upload link
    }
    if (!UPLOAD_HOSTS.has(host)) continue;
    const title = label || null;
    const value = title ? `${url}#name=${encodeURIComponent(title)}` : url;
    out.push({
      id: encodeAttachmentHandle('md', value),
      title,
      contentType: null,
      kind,
    });
  }
  return out;
}

// Formal Linear attachment nodes → canonical shape. kind/contentType derive from
// the URL extension (Linear's Attachment type carries no contentType). The URL
// is preserved as metadata so agents can identify link attachments even when the
// relay blocks the host (LIN-1673); markdown (`md:`) attachments remain without
// `url` — the narrower policy reverses only one field on one handle kind.
function formalAttachments(conn) {
  return unwrap(conn)
    .filter(a => a && typeof a === 'object')
    .map(a => {
      const contentType = imageContentTypeFromUrl(a.url);
      return {
        id: encodeAttachmentHandle('att', a.id),
        title: a.title || null,
        contentType,
        kind: contentType ? 'image' : 'file',
        url: a.url || null,
      };
    });
}

/**
 * Pure, provider-agnostic attachment collector (LIN-771) — the single discovery
 * source for `flattenIssue` (description block + comment block). Given the raw
 * pieces of an issue, it returns the canonical source-neutral attachment array.
 * It owns NO provider knowledge: discovery is host-anchored (`UPLOAD_HOSTS`), so
 * a Linear-sourced body yields Linear handles and a GitHub-sourced body yields
 * GitHub handles through the very same code, with no Linear-shaped `{nodes}`
 * assumption (S1 replaced that path; LIN-770).
 *
 * Inputs (all optional; each absent input contributes nothing):
 *   - `formalAttachmentNodes` — the formal attachment connection/array (Linear's
 *     `attachments` field). `unwrap` tolerates a `{nodes}` connection OR an
 *     already-flat array OR absence.
 *   - `description` — a markdown body whose inline upload-host `![](…)`/`[](…)`
 *     links become handles.
 *   - `comments` — an array of comment objects whose bodies are ALSO swept for
 *     inline uploads and folded into the returned array. The two `flattenIssue`
 *     call sites deliberately use only a SUBSET each (the issue block passes
 *     formal+description and NOT comments, preserving the contract that
 *     `issue.attachments` excludes comment images; the per-comment block passes a
 *     single comment body as `description`). `comments` is honoured here so this
 *     stays the one place that knows how to turn any issue-shaped source into the
 *     canonical array — the aggregate path the prompt/read surfaces (S3) consume.
 */
export function collectIssueAttachments({ description, comments, formalAttachmentNodes } = {}) {
  const out = [
    ...formalAttachments(formalAttachmentNodes),
    ...markdownAttachments(description),
  ];
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (c && typeof c === 'object') out.push(...markdownAttachments(c.body));
    }
  }
  return out;
}

/**
 * Reshape a raw issue (or issue-like object) into the neutral wire contract,
 * in place, and return it. Safe to call on any object: only the fields present
 * are touched.
 */
export function flattenIssue(issue) {
  if (!issue || typeof issue !== 'object') return issue;

  // labels: { nodes: [{ id, name, color }] } → ["bug", ...]
  if (issue.labels !== undefined) {
    issue.labels = unwrap(issue.labels)
      .map(l => (typeof l === 'string' ? l : l && l.name))
      .filter(Boolean);
  }

  // children: { nodes: [...] } → [...] (each child neutralized too)
  if (issue.children !== undefined) {
    issue.children = unwrap(issue.children).map(flattenIssue);
  }

  // team: lift a flat `teamId` scalar from the nested team object (LIN-589), so
  // a consumer can resolve the issue's team-scoped states/labels without a
  // separate /teams call + inference. Done here — the one shared post-fetch pass
  // over reads, write echoes, and nested children — so the flat id stays
  // consistent everywhere instead of being derived per route. The nested
  // `team: { id, name }` is left in place, mirroring `project: { id, name }`.
  // Only acts when the upstream selected `team`; teamless shapes pass through.
  if (issue.team !== undefined) {
    issue.teamId = issue.team && issue.team.id != null ? issue.team.id : null;
  }

  // comments: { nodes: [...] } → [...], each carrying its own markdown inline-
  // upload attachments (LIN-649/LIN-770). Linear's Comment type has no formal
  // attachments connection, so per-comment attachments come from host-anchored
  // `![](…)`/`[](…)` upload links in the body. Absent ⇒ no `attachments` key
  // added (parity preserved).
  if (issue.comments !== undefined) {
    issue.comments = unwrap(issue.comments).map(c => {
      if (c && typeof c === 'object') {
        // A comment is a description-only source: route it through the same pure
        // collector (no formal nodes, no nested comments) so discovery has a
        // single owner. Contract preserved: empty ⇒ no `attachments` key added.
        const atts = collectIssueAttachments({ description: c.body });
        if (atts.length) c.attachments = atts;
      }
      return c;
    });
  }

  // attachments: canonical source-neutral array (LIN-649) = formal Linear
  // attachment nodes + host-anchored markdown inline uploads in the description
  // (images and files, LIN-770). Gated on the
  // raw `{ nodes }` connection being present, which (a) scopes the field to the
  // surfaces that select it (issue detail + write echoes) and leaves the
  // issue-list read untouched, and (b) keeps flattenIssue idempotent — a second
  // pass sees a plain canonical array, not a connection, and skips. Empty ⇒
  // field omitted so issues with nothing attached stay byte-identical.
  const rawAttachments = issue.attachments;
  if (rawAttachments && !Array.isArray(rawAttachments) && Array.isArray(rawAttachments.nodes)) {
    // Issue-level array = formal nodes + description uploads. Comments are NOT
    // passed: per the wire contract, comment images live under each comment's own
    // `attachments`, not the issue array (the aggregate is an S3 read-surface
    // concern). Same single collector, restricted inputs.
    const atts = collectIssueAttachments({
      description: issue.description,
      formalAttachmentNodes: rawAttachments,
    });
    if (atts.length) issue.attachments = atts;
    else delete issue.attachments;
  }

  // relations / inverseRelations: { nodes: [...] } → [...]
  if (issue.relations !== undefined) {
    issue.relations = unwrap(issue.relations);
  }
  if (issue.inverseRelations !== undefined) {
    issue.inverseRelations = unwrap(issue.inverseRelations);
  }

  // Drop backend-revealing deep-link URLs (opaque ids/identifiers stay).
  delete issue.url;

  return issue;
}

/**
 * Strip the backend deep-link URL from a project (or any object that should
 * not expose one), in place. Returns the object.
 */
export function neutralizeProject(project) {
  if (project && typeof project === 'object') delete project.url;
  return project;
}

/**
 * Flatten a cycle's nested `issues` connection into a plain array, in place,
 * neutralizing each issue. Returns the cycle.
 */
export function flattenCycle(cycle) {
  if (!cycle || typeof cycle !== 'object') return cycle;
  if (cycle.issues !== undefined) {
    cycle.issues = unwrap(cycle.issues).map(flattenIssue);
  }
  delete cycle.url;
  return cycle;
}

/**
 * Build the neutral relations payload for GET .../relations from a raw issue:
 * both directions as plain arrays.
 */
export function flattenRelations(issue) {
  return {
    relations: unwrap(issue && issue.relations),
    inverseRelations: unwrap(issue && issue.inverseRelations)
  };
}
