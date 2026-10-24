// LIN-3921: the provider index files import selectFocusSubtask from its owner
// (lib/recommendation-facts.js), not through lib/tree.js's re-export. The re-export
// stays for scripts and tests; this pins the provider import source so the
// "pages ⇄ Providers" knot does not re-tie through tree.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as owner from '../../lib/recommendation-facts.js'
import * as tree from '../../lib/tree.js'

const here = dirname(fileURLToPath(import.meta.url))
const providers = ['linear', 'local', 'jira']

const importLine = (provider) => {
  const source = readFileSync(join(here, '..', '..', 'lib', 'providers', provider, 'index.js'), 'utf8')
  return source.split('\n').find((line) => line.includes('selectFocusSubtask') && line.startsWith('import'))
}

for (const provider of providers) {
  test(`lib/providers/${provider}/index.js imports selectFocusSubtask from its owner`, () => {
    assert.equal(importLine(provider), "import { selectFocusSubtask } from '../../recommendation-facts.js'")
  })
}

test('tree.js still re-exports the same selectFocusSubtask binding', () => {
  assert.equal(tree.selectFocusSubtask, owner.selectFocusSubtask)
})
