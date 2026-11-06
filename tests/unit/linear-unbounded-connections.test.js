/**
 * LIN-4322: source-level check for unbounded Linear connections.
 *
 * Linear returns a connection's default page of 50 when a query names no
 * `first:`/`last:`, and says nothing about the rest. Every connection selected
 * inside a gql template in lib/providers/linear/index.js must therefore carry a
 * `first:` or `last:` argument (a deliberate bound), or be allowlisted below
 * with a written reason. The check reads gql templates only, not arbitrary JS.
 *
 * Run with: node --test tests/unit/linear-unbounded-connections.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = new URL('../../lib/providers/linear/index.js', import.meta.url);

// Every `const NAME = gql\`...\`` template in the source, with its body.
export function gqlTemplates(src) {
  return [...src.matchAll(/const (\w+) = gql`([\s\S]*?)`/g)].map((m) => ({ name: m[1], body: m[2] }));
}

// Connection selections in a gql body: `field(args?) { nodes`. A selection is
// bounded when its argument list carries `first:` or `last:`.
export function unboundedConnections(body) {
  const out = [];
  for (const m of body.matchAll(/(\w+)\s*(?:\(([^()]*)\))?\s*\{\s*nodes\b/g)) {
    const args = m[2] ?? '';
    if (!/\b(first|last)\s*:/.test(args)) out.push(m[1]);
  }
  return out;
}

// Connections that may go unbounded on purpose. Each key is `TEMPLATE.field`
// and each value is the reason it is allowed to read past Linear's default page.
// The nested issue lists that LIN-4322 fixes (comments, children, relations,
// inverseRelations on the issue-detail read; comments on the comments and
// close-out read; relations on the relations read) are paged by pageConnection
// and are not listed here.
const ALLOWLIST = {
  // A single issue's own labels. Expected to stay far below one page; not
  // verified against live data. Not a gate input, so left unpaged here.
  'API_ISSUE_FIELDS.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); not a gate input',
  'API_ISSUES_QUERY.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); not a gate input',
  'API_ISSUES_QUERY_ALL.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); not a gate input',
  'ISSUE_FIELDS_FRAGMENT.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); not a gate input',
  'ISSUE_FIELDS_SLIM_FRAGMENT.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); not a gate input',
  'ISSUE_DETAIL_QUERY.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); prompt context',
  'FOCUSED_CHILD_QUERY.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); prompt context',
  'ISSUE_LABELS_QUERY.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); label add/remove read',
  'SEARCH_QUERY.labels': 'an issue\'s own label set, expected far below 50 per issue (not checked live); search result',
  'UPDATE_ISSUE_LABELS_MUTATION.labels': 'an issue\'s own label set returned by the label mutation; expected far below 50',

  // Workspace-level lists, not issue reads. Named as follow-ups: each can exceed
  // one page in a large workspace and needs paging in its own change.
  'PROJECTS_QUERY.projects': 'workspace project list, not an issue read; can exceed 50 in a large workspace; follow-up LIN-4328',
  'API_PROJECTS_QUERY.projects': 'workspace project list, not an issue read; can exceed 50 in a large workspace; follow-up LIN-4328',
  'CYCLES_QUERY.cycles': 'workspace cycle list, not an issue read; can exceed 50 over time; follow-up LIN-4328',
  'CYCLES_QUERY_ALL.cycles': 'workspace cycle list, not an issue read; can exceed 50 over time; follow-up LIN-4328',
  'LABELS_QUERY.issueLabels': 'workspace label list, not an issue read; can exceed 50 in a large workspace; follow-up LIN-4328',
  'TEAMS_QUERY.teams': 'workspace team list, a handful of teams; not an issue read',
  'STATES_QUERY.workflowStates': 'one team\'s workflow states, a handful; not an issue read',

  // Issue reads that can exceed one page and are outside this change's scope.
  'CYCLE_DETAIL_QUERY.issues': 'issues of one cycle, an issue read that can exceed 50; follow-up LIN-4326',
  'ISSUE_DETAIL_FIELDS_QUERY.comments': 'detail-surface comments for the attachment gallery; a long trail can exceed 50 and drop image refs; follow-up LIN-4326',

  // Prompt-context reads. Their bounds are prompt-rendering decisions, not drains,
  // so they stay on the check's list as named follow-ups.
  'ISSUE_DETAIL_QUERY.inverseRelations': 'prompt-context inverse relations; the bound is a prompt-rendering decision; follow-up LIN-4325',
  'ISSUE_DETAIL_QUERY.children': 'prompt-context grandchildren, nested under children(first: 101); bound is a prompt-rendering decision; follow-up LIN-4325',
  'ISSUE_DETAIL_QUERY.relations': 'prompt-context relations of the children, nested under children(first: 101); bound is a prompt-rendering decision; follow-up LIN-4325',
  'FOCUSED_CHILD_QUERY.comments': 'focused child\'s comments feeding the recommendation prompt; the bound is a prompt-rendering decision; follow-up LIN-4325',

  // Dashboard tree read: relations drive the blocked view, not the close-out gate.
  'ISSUE_FIELDS_FRAGMENT.relations': 'dashboard tree relations for blocked-ness; can exceed 50 in principle; not a gate input; follow-up LIN-4327',
  'ISSUE_FIELDS_SLIM_FRAGMENT.relations': 'dashboard tree relations for blocked-ness; can exceed 50 in principle; not a gate input; follow-up LIN-4327',
};

test('scanner: a bare connection is unbounded, a first:/last: one is bounded', () => {
  const body = `
    issue(id: $id) {
      comments { nodes { id } }
      children(first: 101) { nodes { id } }
      history(last: 50) { nodes { id } }
      labels { nodes { name } }
    }`;
  assert.deepEqual(unboundedConnections(body).sort(), ['comments', 'labels']);
});

test('every unbounded Linear connection in a gql template is bounded or allowlisted with a reason', () => {
  const src = readFileSync(SOURCE, 'utf8');
  const hits = [];
  for (const t of gqlTemplates(src)) {
    for (const field of unboundedConnections(t.body)) hits.push(`${t.name}.${field}`);
  }
  const unique = [...new Set(hits)].sort();
  const unlisted = unique.filter((k) => !(k in ALLOWLIST));
  assert.deepEqual(unlisted, [], `unbounded connections with no fix or allowlist reason: ${unlisted.join(', ')}`);
});

test('the allowlist holds only live entries, each with a written reason', () => {
  const src = readFileSync(SOURCE, 'utf8');
  const live = new Set();
  for (const t of gqlTemplates(src)) {
    for (const field of unboundedConnections(t.body)) live.add(`${t.name}.${field}`);
  }
  const stale = Object.keys(ALLOWLIST).filter((k) => !live.has(k));
  assert.deepEqual(stale, [], `allowlist entries no longer match a source hit: ${stale.join(', ')}`);
  for (const [key, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 0, `${key} needs a reason`);
  }
});
