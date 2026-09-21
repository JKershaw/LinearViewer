// Unit tests for the chat tool catalog's declared provider-scope tiers
// (LIN-2971).
//
// Run with: node --test tests/unit/chat-tools-scope-tiers.test.js
//
// DATA ONLY: `CHAT_TOOL_SCOPE_TIERS` annotates each tool schema (across
// CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA, and REMEMBER_TOOL_SCHEMA) with the
// provider-scope tier its executor actually reads/writes — row, workspace, or
// fleet — or an explicit `null` for a tool whose executor touches no scoped
// resource at all. It changes no tool's behavior; tests/unit/chat-tools.test.js
// covers that and is untouched by this file.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  CHAT_TOOL_SCHEMAS,
  FOLLOW_UP_TOOL_SCHEMA,
  REMEMBER_TOOL_SCHEMA,
  CHAT_TOOL_SCOPE_TIERS,
  CHAT_TOOL_SCOPE_TIER_VALUES,
} from '../../lib/chat-tools.js';

const ALL_SCHEMAS = [...CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA, REMEMBER_TOOL_SCHEMA];
const ALL_TOOL_NAMES = ALL_SCHEMAS.map(s => s.function.name);

describe('CHAT_TOOL_SCOPE_TIERS (LIN-2971)', () => {
  // The durable half of the ticket: a tool added to any of the three schema
  // collections without a tier entry fails this test, rather than silently
  // going unscoped the way get_stack/resolveRepoAllowlist did before.
  test('every schema — including the two write schemas outside CHAT_TOOL_SCHEMAS — declares a tier', () => {
    for (const name of ALL_TOOL_NAMES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CHAT_TOOL_SCOPE_TIERS, name),
        `"${name}" has no entry in CHAT_TOOL_SCOPE_TIERS — a tool must declare its ` +
        'scope tier (or explicit null for "makes no provider call") before it ships'
      );
    }
  });

  test('CHAT_TOOL_SCOPE_TIERS has no stray entries for names that are not an actual schema', () => {
    for (const name of Object.keys(CHAT_TOOL_SCOPE_TIERS)) {
      assert.ok(
        ALL_TOOL_NAMES.includes(name),
        `CHAT_TOOL_SCOPE_TIERS declares a tier for "${name}", which is not a schema in ` +
        'CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA, or REMEMBER_TOOL_SCHEMA'
      );
    }
  });

  test('every declared tier is either an explicit null or a recognized tier value', () => {
    for (const [name, tier] of Object.entries(CHAT_TOOL_SCOPE_TIERS)) {
      assert.ok(
        tier === null || CHAT_TOOL_SCOPE_TIER_VALUES.includes(tier),
        `"${name}" declares an unrecognized tier: ${JSON.stringify(tier)}`
      );
    }
  });

  // Pins the tier assignments this ticket verified against each executor at
  // HEAD (see the CHAT_TOOL_SCOPE_TIERS doc comment in lib/chat-tools.js for
  // the per-tool reasoning), so a future edit that silently reclassifies a
  // tool is caught even though the completeness checks above would still pass.
  test('tier assignments match what this ticket verified against each executor', () => {
    assert.deepStrictEqual(CHAT_TOOL_SCOPE_TIERS, {
      lookup_task: 'row',
      search_tasks: 'row',
      get_relations: 'row',
      get_comments: 'row',
      get_children_status: 'row',
      get_history: 'row',
      get_brief: 'row',
      get_recap: 'row',
      get_stack: 'workspace',
      list_task_sessions: 'fleet',
      get_session: 'fleet',
      list_active_sessions: 'fleet',
      list_pending_decisions: 'fleet',
      get_pr_status: 'workspace',
      send_follow_up: 'fleet',
      remember: null,
    });
  });
});
