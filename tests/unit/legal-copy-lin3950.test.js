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

function pageCopy(html) {
  const heading = text(html.match(/<main[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/)[1]);
  const sections = [...html.matchAll(/<section class="section[^"]*"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<\/section>/g)]
    .map((m) => ({ title: text(m[1]), body: text(m[2]) }));
  return { heading, sections };
}

test('the Privacy Policy copy is unchanged by the Plain move', () => {
  assert.deepEqual(pageCopy(renderPrivacyPolicy()), snapshot.privacy);
});

test('the Terms of Service copy is unchanged by the Plain move', () => {
  assert.deepEqual(pageCopy(renderTermsOfService()), snapshot.terms);
});
