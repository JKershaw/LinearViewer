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
//   - `md:<base64url(url)>`  markdown-embedded image (decode → SSRF-guard → relay)
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
// mapped to the canonical shape. Mirrors the linear-cli extraction + image-ext
// filter (reference only — not imported). Non-image links are skipped.
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
        const atts = markdownImageAttachments(c.body);
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
