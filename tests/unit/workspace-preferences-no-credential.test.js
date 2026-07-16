// LIN-1331 (Phase E) structural guard. lib/workspace-preferences.js is
// workspace-owned and stores NO credential by design (see the module's
// ownership header) — a personal API key/provider token follows the account
// unless explicitly workspace-scoped, and none of this store's settings are.
//
// This pins that invariant at the source level: zero matches of credential
// *field-name* patterns in the file. Deliberately word-boundary on the field
// names (not the bare substring `openrouter`), so it does not false-positive
// on this file's free-tier **model id** references (`resolveFreeTierModel`,
// `OPENROUTER_FREE_TIER_MODEL`), which are not credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(join(root, 'lib/workspace-preferences.js'), 'utf8');

const CREDENTIAL_FIELD_NAME_PATTERN = /\b(openRouterApiKey|apiKey|api_key|accessToken|secret|password|credential)\b/gi;

test('lib/workspace-preferences.js stores no credential (field-name guard)', () => {
  const matches = SOURCE.match(CREDENTIAL_FIELD_NAME_PATTERN) || [];
  assert.deepEqual(
    matches,
    [],
    `expected zero credential field-name matches in lib/workspace-preferences.js, found: ${matches.join(', ')}`
  );
});
