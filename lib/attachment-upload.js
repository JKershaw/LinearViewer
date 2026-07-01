/**
 * Base64 image decode + raster magic-byte sniffing (LIN-636 / LIN-682).
 *
 * Shared by every route that accepts an agent/human-supplied image destined
 * for `provider.uploadFile()`: the feedback widget's `/api/feedback` route
 * (`routes/workspace-api.js`) and the agent-facing proxy attachment upload
 * route (`routes/proxy.js`, LIN-891). Kept in `lib/` — not either route file
 * — so both consumers import the SAME guard rather than risking a drifted
 * reimplementation.
 */

/**
 * Sniff the raster image type from a buffer's magic bytes (LIN-682).
 *
 * Security helper shared by the upload decode path (entry gate) and the
 * `/api/image` proxy (delivery gate). Returns the canonical content type for a
 * recognised raster image, or `null` for anything else — crucially including
 * `image/svg+xml`, HTML, and JS, which must never be trusted from a declared
 * content type and must never be served inline same-origin.
 *
 * Allowed raster types: PNG, JPEG, GIF, WEBP. No new dependency — pure byte
 * inspection.
 *
 * @param {Buffer} bytes
 * @returns {('image/png'|'image/jpeg'|'image/gif'|'image/webp')|null}
 */
export function sniffRasterType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  // PNG: 89 50 4E 47 (\x89PNG)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46 38 (GIF8 — covers GIF87a/GIF89a)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  // WEBP: 'RIFF' at 0, 'WEBP' at offset 8
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Decode an uploaded screenshot/image into raw bytes for the upload seam (LIN-636).
 *
 * Accepts either a base64 data URL string (`data:image/png;base64,…`, what a
 * browser produces via canvas.toDataURL / FileReader.readAsDataURL) or an
 * object `{ data, contentType?, filename? }` carrying raw base64. Returns
 * `{ bytes, contentType, filename }`, or `null` if the input is not a usable
 * base64 image. A filename is synthesised from the content type when absent.
 *
 * Security (LIN-682): the client-declared content type is NOT trusted. The bytes
 * are sniffed (`sniffRasterType`) and only raster images (PNG/JPEG/GIF/WEBP) are
 * accepted; the stored content type is derived from the bytes, not the input.
 * SVG and any non-raster payload fall through to the existing `null` (400) path.
 *
 * @param {string|{data?: string, contentType?: string, filename?: string}} image
 * @returns {{bytes: Buffer, contentType: string, filename: string}|null}
 */
export function parseFeedbackImage(image) {
  let base64;
  let contentType;
  let filename;

  if (typeof image === 'string') {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(image.trim());
    // Require a base64 data URL — raw (URL-encoded) data URLs are not images.
    if (!match || !match[2]) return null;
    contentType = match[1] || 'application/octet-stream';
    base64 = match[3];
  } else if (image && typeof image === 'object' && typeof image.data === 'string') {
    base64 = image.data;
    contentType = typeof image.contentType === 'string' && image.contentType
      ? image.contentType
      : 'application/octet-stream';
    filename = typeof image.filename === 'string' && image.filename ? image.filename : undefined;
  } else {
    return null;
  }

  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (!bytes || bytes.length === 0) return null;

  // Security (LIN-682): ignore the client-declared content type — sniff the
  // actual bytes and accept only raster images. SVG/HTML/JS and anything else
  // fall through to the existing null (400) path. The stored content type is the
  // sniffed one, so a mislabeled upload can never reach the provider as SVG.
  const sniffed = sniffRasterType(bytes);
  if (!sniffed) return null;
  contentType = sniffed;

  if (!filename) {
    const ext = (contentType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    filename = `feedback.${ext}`;
  }
  return { bytes, contentType, filename };
}
