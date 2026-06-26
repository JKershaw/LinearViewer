// =============================================================================
// parseFeedbackImage / sniffRasterType — feedback intake decode + raster guard
// =============================================================================
//
// parseFeedbackImage (LIN-636) is the pure decode of the optional screenshot the
// feedback-submit route forwards to the provider `uploadFile` seam. It accepts a
// base64 data URL string or an object `{ data, contentType?, filename? }` and
// returns `{ bytes, contentType, filename }` or null.
//
// LIN-682 (security): it must NOT trust the client-declared content type — the
// bytes are sniffed (`sniffRasterType`) and only raster images (PNG/JPEG/GIF/
// WEBP) are accepted, with the stored content type derived from the bytes. SVG
// and any other non-raster payload are rejected via the existing null path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeedbackImage, sniffRasterType } from '../../routes/workspace-api.js';

// --- Minimal but valid magic-byte fixtures (≥12 bytes so WEBP's offset-8 check
// has room). Real raster files always exceed 12 bytes; these mirror the headers.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');

describe('sniffRasterType (LIN-682)', () => {
  test('recognises each allowed raster type by magic bytes', () => {
    assert.strictEqual(sniffRasterType(PNG), 'image/png');
    assert.strictEqual(sniffRasterType(JPEG), 'image/jpeg');
    assert.strictEqual(sniffRasterType(GIF), 'image/gif');
    assert.strictEqual(sniffRasterType(WEBP), 'image/webp');
  });

  test('rejects SVG and other non-raster payloads', () => {
    assert.strictEqual(sniffRasterType(SVG), null);
    assert.strictEqual(sniffRasterType(Buffer.from('<html><script>x</script>', 'utf8')), null);
    assert.strictEqual(sniffRasterType(Buffer.from('GIF', 'ascii')), null); // too short
    assert.strictEqual(sniffRasterType(Buffer.alloc(0)), null);
    assert.strictEqual(sniffRasterType('not a buffer'), null);
    assert.strictEqual(sniffRasterType(null), null);
  });
});

describe('parseFeedbackImage (LIN-636 / LIN-682)', () => {
  test('decodes a base64 PNG data URL into bytes + content type', () => {
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
    const result = parseFeedbackImage(dataUrl);
    assert.ok(result);
    assert.strictEqual(result.contentType, 'image/png');
    assert.ok(result.bytes.equals(PNG));
    assert.strictEqual(result.filename, 'feedback.png'); // synthesised from sniffed type
  });

  test('accepts an object form with explicit filename', () => {
    const result = parseFeedbackImage({
      data: JPEG.toString('base64'),
      contentType: 'image/jpeg',
      filename: 'shot.jpg',
    });
    assert.ok(result);
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(result.filename, 'shot.jpg');
    assert.ok(result.bytes.equals(JPEG));
  });

  test('derives the content type from the bytes, not the client-declared type', () => {
    // Client lies: declares PNG but the bytes are JPEG. The stored type follows
    // the bytes, so a mislabeled upload can never reach the provider as SVG/HTML.
    const dataUrl = `data:image/png;base64,${JPEG.toString('base64')}`;
    const result = parseFeedbackImage(dataUrl);
    assert.ok(result);
    assert.strictEqual(result.contentType, 'image/jpeg');
  });

  test('rejects an SVG payload even when declared as image/png (stored-XSS guard)', () => {
    const dataUrl = `data:image/png;base64,${SVG.toString('base64')}`;
    assert.strictEqual(parseFeedbackImage(dataUrl), null);
    assert.strictEqual(parseFeedbackImage({ data: SVG.toString('base64'), contentType: 'image/svg+xml' }), null);
  });

  test('rejects non-base64 data URLs', () => {
    assert.strictEqual(parseFeedbackImage('data:image/png,not-base64'), null);
  });

  test('rejects non-image inputs', () => {
    assert.strictEqual(parseFeedbackImage('https://example.com/x.png'), null);
    assert.strictEqual(parseFeedbackImage(null), null);
    assert.strictEqual(parseFeedbackImage(undefined), null);
    assert.strictEqual(parseFeedbackImage(42), null);
    assert.strictEqual(parseFeedbackImage({}), null);
  });

  test('rejects an empty payload', () => {
    assert.strictEqual(parseFeedbackImage('data:image/png;base64,'), null);
  });
});
