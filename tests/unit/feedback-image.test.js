// =============================================================================
// parseFeedbackImage — feedback-submit intake decode (LIN-636)
// =============================================================================
//
// Pure decode of the optional screenshot the feedback-submit route forwards to
// the provider `uploadFile` seam. Accepts a base64 data URL string or an object
// `{ data, contentType?, filename? }`; returns `{ bytes, contentType, filename }`
// or null for anything that is not a usable base64 image.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeedbackImage } from '../../routes/workspace-api.js';

describe('parseFeedbackImage (LIN-636)', () => {
  test('decodes a base64 data URL into bytes + content type', () => {
    const png = Buffer.from('hello-png');
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const result = parseFeedbackImage(dataUrl);
    assert.ok(result);
    assert.strictEqual(result.contentType, 'image/png');
    assert.ok(result.bytes.equals(png));
    assert.strictEqual(result.filename, 'feedback.png'); // synthesised from content type
  });

  test('accepts an object form with explicit filename', () => {
    const bytes = Buffer.from('jpegdata');
    const result = parseFeedbackImage({
      data: bytes.toString('base64'),
      contentType: 'image/jpeg',
      filename: 'shot.jpg',
    });
    assert.ok(result);
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(result.filename, 'shot.jpg');
    assert.ok(result.bytes.equals(bytes));
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
