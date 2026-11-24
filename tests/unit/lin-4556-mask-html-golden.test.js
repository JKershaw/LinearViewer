/**
 * LIN-4556 (LIN-4508 piece A), beat 2: `maskSecretsInHtml` output, frozen BEFORE the
 * plain-text masker is extracted out of it.
 *
 * `routes/task-share.js` serves every shared task page through `maskSecretsInHtml`, so its
 * output must stay byte-identical when the module is refactored to call the shared
 * plain-text core. This file feeds it a corpus that walks each branch the HTML path has
 * (text nodes, quoted and unquoted attributes, comments, entity-decoded quote rules, a hit
 * spanning an entity, overlapping rules, adjacent hits, a `<br>`-split PEM, a literal
 * `&lt;br&gt;` PEM, script/style bodies, short and clean input) and pins each output
 * exactly, plus the `hits` list. The expected values were recorded from main at 4368dec9d,
 * before the refactor; none may change.
 *
 * Token-shaped values come from tests/fixtures/secret-scan-fixtures.js (assembled from
 * parts, on the scanner's fixture allowlist), never written whole here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecretsInHtml } from '../../lib/mask-secrets-in-html.js';
import { FIXTURE_SECRETS as F } from '../fixtures/secret-scan-fixtures.js';

const pemLines = F.privateKey.split('\n');
const bearer = `Authorization: Bearer ${F.bootstrapToken}`;

// [name, input, expected html, expected hits]
const CASES = [
  ['clean page is returned unchanged', '<div class="x"><p>Nothing to see &amp; nothing hidden.</p></div>', '<div class="x"><p>Nothing to see &amp; nothing hidden.</p></div>', []],
  ['empty string', '', '', []],
  ['text under 8 chars is never scanned', '<p>ghp_x</p>', '<p>ghp_x</p>', []],
  ['GitHub token in a text node', `<p>token ${F.githubPat} here</p>`, '<p>token [redacted] here</p>', ['github-pat']],
  ['Linear key in a double-quoted attribute', `<a title="${F.linearApiKey}">x</a>`, '<a title="[redacted]">x</a>', ['linear-api-key']],
  ['Anthropic key in a single-quoted attribute', `<a data-k='${F.anthropicApiKey}'>x</a>`, "<a data-k='[redacted]'>x</a>", ['anthropic-api-key']],
  ['unquoted attribute value', `<a data-k=${F.githubOauth}>x</a>`, '<a data-k=[redacted]>x</a>', ['github-oauth']],
  ['comment body', `<!-- ${F.githubAppToken} -->`, '<!-- [redacted] -->', ['github-app-token']],
  ['quote-dependent rule after entity decoding', `<p>api_key = &quot;${F.genericSecretValue}&quot;</p>`, '<p>[redacted]</p>', ['generic-secret-assignment']],
  ['a hit ending inside an entity takes the whole entity', `<p>${F.githubPat.slice(0, -1)}&#${F.githubPat.charCodeAt(F.githubPat.length - 1)}; ok</p>`, '<p>[redacted] ok</p>', ['github-pat']],
  ['overlapping rules collapse into one mask', `<p>${bearer}</p>`, '<p>[redacted]</p>', ['bearer-auth-token', 'harbour-bootstrap-token']],
  ['two adjacent tokens each masked', `<p>${F.githubPat} ${F.linearApiKey}</p>`, '<p>[redacted] [redacted]</p>', ['github-pat', 'linear-api-key']],
  ['PEM whole in one text node', `<pre>${F.privateKey}</pre>`, '<pre>[redacted]</pre>', ['private-key-block']],
  ['PEM split across <br> tags keeps the tags', `<p>${pemLines.join('<br>')}</p>`, '<p>[redacted]<br>[redacted]<br>[redacted]<br>[redacted]</p>', ['private-key-block']],
  ['PEM with a literal &lt;br&gt; between lines', `<p>${pemLines.join('&lt;br&gt;')}</p>`, '<p>[redacted]</p>', ['private-key-block']],
  ['script and style bodies are never scanned', `<script>const k = '${F.githubPat}';</script><style>/* ${F.githubPat} */</style>`, `<script>const k = '${F.githubPat}';</script><style>/* ${F.githubPat} */</style>`, []],
  ['a token between decoded angle brackets is masked, the brackets kept', `<p>&lt;${F.githubPat}&gt;</p>`, '<p>&lt;[redacted]&gt;</p>', ['github-pat']],
  ['secret across two separate tags is not joined', `<b>${F.githubPat.slice(0, 10)}</b><i>${F.githubPat.slice(10)}</i>`, `<b>${F.githubPat.slice(0, 10)}</b><i>${F.githubPat.slice(10)}</i>`, []]
];

describe('LIN-4556 golden: maskSecretsInHtml is byte-identical across the extraction', () => {
  for (const [name, input, expected, hits] of CASES) {
    test(name, () => {
      const out = maskSecretsInHtml(input);
      assert.equal(out.html, expected);
      assert.deepEqual(out.hits, hits);
    });
  }

  test('a clean input comes back as the SAME string (no copy)', () => {
    const s = '<p>plain words only, nothing secret here</p>';
    assert.equal(maskSecretsInHtml(s).html, s);
  });

  test('non-string input passes through untouched', () => {
    assert.deepEqual(maskSecretsInHtml(null), { html: null, hits: [] });
    assert.deepEqual(maskSecretsInHtml(undefined), { html: undefined, hits: [] });
  });
});
