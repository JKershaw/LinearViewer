// LIN-3950: the Legal pages move onto the Plain layout, and their copy must not change. This compares
// the visible text of every heading and section body with a snapshot taken before the move
// (tests/fixtures/legal-copy-lin3950.json). The markup changes on purpose; the words do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPrivacyPolicy, renderTermsOfService } from '../../lib/render-legal.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/legal-copy-lin3950.json');
const snapshot = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ').trim();

// LIN-4567: the pages sit in the public frame, so the heading is the frame's one h1 and the sections are h2 under it
// (they were a Plain-title h2 and h3 sections under a "Harbour" h1). The words are still the snapshot's.
function pageCopy(html) {
  const heading = text(html.match(/<main[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/)[1]);
  const sections = [...html.matchAll(/<section class="section[^"]*"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/g)]
    .map((m) => ({ title: text(m[1]), body: text(m[2]) }));
  return { heading, sections };
}

test('the Privacy Policy copy is unchanged by the Plain move', () => {
  assert.deepEqual(pageCopy(renderPrivacyPolicy()), snapshot.privacy);
});

test('the Terms of Service copy is unchanged by the Plain move', () => {
  assert.deepEqual(pageCopy(renderTermsOfService()), snapshot.terms);
});
