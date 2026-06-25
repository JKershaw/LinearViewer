// ---------------------------------------------------------------------------
// Dashboard-side displayable image extraction (LIN-652, parent LIN-612).
// ---------------------------------------------------------------------------
//
// SIBLING to `lib/proxy-wire.js`'s canonical attachment shape — NOT a reuse of
// it, deliberately. The proxy wire serves EXTERNAL consumers and so drops the
// real URL (no-deep-link policy) behind opaque `att:`/`md:` handles that only the
// Bearer-authed, SSRF-guarded relay (LIN-650) can resolve. The dashboard task
// detail is the opposite contract: a SESSION-authed browser that fetches image
// bytes through the LIN-156 `/workspace/:urlKey/api/image` relay, which keys off
// the REAL Linear URL. Same source data (formal attachments + markdown images),
// different exposure surface — which is exactly why this keeps URLs and lives
// here rather than in proxy-wire.
//
// Pure + network-free so it can be unit-tested in isolation and called straight
// from the renderer.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#].*)?$/i;

// True iff a URL string looks like an image by extension (tolerates a trailing
// query string / fragment, e.g. `…/x.png?signature=…`). Mirrors the proxy-wire
// image-ext filter so the two surfaces agree on what counts as an image.
function isImageUrl(url) {
  return typeof url === 'string' && IMAGE_EXT.test(url.trim());
}

// Markdown image references (`![alt](url)`) whose URL looks like an image.
// Non-image links are skipped. Returns `[{ url, title }]`.
function markdownImageRefs(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const alt = (match[1] || '').trim();
    const url = match[2].trim();
    if (isImageUrl(url)) out.push({ url, title: alt || null });
  }
  return out;
}

/**
 * Collect the displayable image attachments for an issue's task-detail view:
 *   - formal Linear attachment nodes whose URL is an image  (source: 'issue')
 *   - markdown-embedded images in the description            (source: 'issue')
 *   - markdown-embedded images in each comment body          (source: 'comment')
 *
 * De-duplicated by URL (first occurrence wins, so an issue-level title/source is
 * kept over a later comment repeat). Accepts the raw `{ nodes }` connection shape
 * the dashboard read returns for `issue.attachments`, or a plain array. Comments
 * are passed in separately (the renderer threads `issue.comments?.nodes`).
 * Tolerates missing/odd input and always returns an array.
 *
 * @param {Object} issue - Issue with optional `description` + `attachments`
 * @param {Array<{body?: string}>} [comments=[]] - Issue comments (oldest-first)
 * @returns {Array<{url: string, title: string|null, source: 'issue'|'comment'}>}
 */
export function collectTaskImages(issue, comments = []) {
  if (!issue || typeof issue !== 'object') return [];

  const seen = new Set();
  const out = [];
  const add = (url, title, source) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: title || null, source });
  };

  // Formal Linear attachment nodes (issue-level). Accept `{ nodes }` or array.
  const rawAttachments = issue.attachments;
  const formal = Array.isArray(rawAttachments)
    ? rawAttachments
    : (rawAttachments && Array.isArray(rawAttachments.nodes) ? rawAttachments.nodes : []);
  for (const a of formal) {
    if (a && isImageUrl(a.url)) add(a.url, a.title, 'issue');
  }

  // Markdown images embedded in the description (issue-level).
  for (const img of markdownImageRefs(issue.description)) add(img.url, img.title, 'issue');

  // Markdown images embedded in each comment body (per-comment).
  for (const c of Array.isArray(comments) ? comments : []) {
    for (const img of markdownImageRefs(c && c.body)) add(img.url, img.title, 'comment');
  }

  return out;
}
