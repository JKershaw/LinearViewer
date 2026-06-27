/**
 * Wire-contract neutralization for the consumer proxy API (LIN-310).
 *
 * The proxy speaks a source-neutral, tool-shaped contract:
 *  - nested collections are plain arrays, never a `{ nodes: [...] }` wrapper;
 *  - `labels` is a plain array of names (aligned with the `/stack` flat style),
 *    not an array of `{ id, name, color }` objects — the label catalog lives at
 *    GET /labels for id/colour lookup;
 *  - no field exposes a backend deep-link URL.
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
//   { id, title, contentType, kind }   kind ∈ {'image','file'}
//
// Deliberately NO `url`: the no-deep-link policy this module enforces forbids
// exposing a backend asset URL. Instead `id` is an OPAQUE, server-resolvable
// handle — sufficient for the slice-2 relay (LIN-650) to fetch the bytes
// server-side (Bearer-authed + SSRF-guarded), never a link the consumer can
// dereference directly. Two handle forms, namespaced by prefix so the relay can
// route resolution:
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

// Linear asset hosts that markdown file-link discovery will turn into handles.
// Narrower than the relay's SSRF allowlist on purpose: only the upload/CDN asset
// hosts carry attachable files; `linear.app` deep-links are issue cross-refs.
const UPLOAD_HOSTS = new Set(['uploads.linear.app', 'cdn.linear.app']);

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

// Markdown image references (`![alt](url)`) whose URL looks like an image,
// mapped to the canonical shape (image-ext filter). Non-image links are skipped.
function markdownImageAttachments(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const alt = match[1] || '';
    const url = match[2].trim();
    const contentType = imageContentTypeFromUrl(url);
    if (!contentType) continue; // image-ext filter
    out.push({
      id: encodeAttachmentHandle('md', url),
      title: alt || null,
      contentType,
      kind: 'image',
    });
  }
  return out;
}

// Markdown FILE links (`[text](url)` — NOT `![]()` image embeds) pointing at a
// Linear upload host → canonical shape with kind:'file' (LIN-750). Upload URLs
// are extension-less, so the type is unknowable at discovery time: contentType
// is null and the relay is the sole type-gate. The link text (the filename) is
// carried into the `md:` handle as a `#name=` fragment so the relay can type the
// extension-less bytes — `fetch` never sends a fragment, so egress and the SSRF
// guard are unchanged, and this stays within the existing `md:` URL codec (no
// new handle format). Image embeds carry a leading `!` and are excluded by the
// negative lookbehind, so they stay on the image path and aren't double-captured.
function markdownFileAttachments(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const re = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const label = match[1] || '';
    const url = match[2].trim();
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
      kind: 'file',
    });
  }
  return out;
}

// Formal Linear attachment nodes → canonical shape. kind/contentType derive from
// the URL extension (Linear's Attachment type carries no contentType), then the
// URL is dropped (no-deep-link); the opaque attachment id becomes the handle.
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
      };
    });
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

  // comments: { nodes: [...] } → [...], each carrying its own markdown-image
  // attachments (LIN-649). Linear's Comment type has no formal attachments
  // connection, so per-comment attachments come from `![](…)` images in the
  // body. Absent ⇒ no `attachments` key added (parity preserved).
  if (issue.comments !== undefined) {
    issue.comments = unwrap(issue.comments).map(c => {
      if (c && typeof c === 'object') {
        const atts = [
          ...markdownImageAttachments(c.body),
          ...markdownFileAttachments(c.body),
        ];
        if (atts.length) c.attachments = atts;
      }
      return c;
    });
  }

  // attachments: canonical source-neutral array (LIN-649) = formal Linear
  // attachment nodes + markdown-embedded images in the description. Gated on the
  // raw `{ nodes }` connection being present, which (a) scopes the field to the
  // surfaces that select it (issue detail + write echoes) and leaves the
  // issue-list read untouched, and (b) keeps flattenIssue idempotent — a second
  // pass sees a plain canonical array, not a connection, and skips. Empty ⇒
  // field omitted so issues with nothing attached stay byte-identical.
  const rawAttachments = issue.attachments;
  if (rawAttachments && !Array.isArray(rawAttachments) && Array.isArray(rawAttachments.nodes)) {
    const atts = [
      ...formalAttachments(rawAttachments),
      ...markdownImageAttachments(issue.description),
      ...markdownFileAttachments(issue.description),
    ];
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
