// LIN-3606: isBlocked is owned by lib/providers/state-map.js; lib/tree.js is a
// re-exporting shim; the proxy routes import the state predicates from the owner.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as stateMap from '../../lib/providers/state-map.js'
import * as tree from '../../lib/tree.js'

describe('LIN-3606 isBlocked ownership', () => {
  it('tree.js re-exports the very same isBlocked / isTerminalState as state-map.js', () => {
    assert.equal(tree.isBlocked, stateMap.isBlocked)
    assert.equal(tree.isTerminalState, stateMap.isTerminalState)
  })

  it('isBlocked: open blocker blocks, terminal blocker and non-blocks relation do not', () => {
    const rel = (type, stateType) => ({ inverseRelations: { nodes: [{ type, issue: { state: { type: stateType } } }] } })
    assert.equal(stateMap.isBlocked(rel('blocks', 'started')), true)
    assert.equal(stateMap.isBlocked(rel('blocks', 'completed')), false)
    assert.equal(stateMap.isBlocked(rel('blocks', 'canceled')), false)
    assert.equal(stateMap.isBlocked(rel('related', 'started')), false)
    assert.equal(stateMap.isBlocked({}), false)
  })
})
