/**
 * Unit tests for lib/render-escalation-kpis.js (LIN-1736)
 *
 * Run with: node --test tests/unit/render-escalation-kpis.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderEscalationKpisPage } from '../../lib/render-escalation-kpis.js';

function baseKpis(overrides = {}) {
  return {
    escalationRate: { raisedInWindow: 5, perDay: 0.17, targetPerDay: null, overTarget: null },
    timeToResponse: { count: 3, medianMs: 3600000, maxMs: 7200000 },
    falseEscalation: { dismissed: 1, answered: 2, total: 3, rate: 1 / 3 },
    unansweredAge: { count: 2, staleCount: 1, maxAgeMs: 90000000, staleThresholdMs: 86400000 },
    ...overrides,
  };
}

describe('renderEscalationKpisPage', () => {
  test('renders a complete HTML document with all four stat cards', () => {
    const html = renderEscalationKpisPage('Acme', {
      urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }],
      kpis: baseKpis(), windowDays: 30, generatedAt: '2026-08-23T00:00:00.000Z',
    });
    assert.ok(html.startsWith('<!DOCTYPE') || html.includes('<html'), 'a full document');
    assert.ok(html.includes('Escalation KPIs'));
    for (const testId of ['kpi-escalation-rate', 'kpi-time-to-response', 'kpi-false-escalation', 'kpi-unanswered-age']) {
      assert.ok(html.includes(`data-testid="${testId}"`), `missing ${testId}`);
    }
  });

  test('shows "no target set" when targetPerDay is null, and the target value when supplied', () => {
    const noTarget = renderEscalationKpisPage('Acme', { kpis: baseKpis(), windowDays: 30 });
    assert.ok(noTarget.includes('no target set'));

    const withTarget = renderEscalationKpisPage('Acme', {
      kpis: baseKpis({ escalationRate: { raisedInWindow: 5, perDay: 0.17, targetPerDay: 2, overTarget: false } }),
      windowDays: 30,
    });
    assert.ok(withTarget.includes('target'));
    assert.ok(!withTarget.includes('no target set'));
  });

  test('a stale unanswered count renders the warn accent class', () => {
    const html = renderEscalationKpisPage('Acme', { kpis: baseKpis({ unansweredAge: { count: 1, staleCount: 1, maxAgeMs: 90000000, staleThresholdMs: 86400000 } }), windowDays: 30 });
    assert.ok(/kpi-card--warn"[^>]*data-testid="kpi-unanswered-age"/.test(html) || html.includes('kpi-card--warn'));
  });

  test('zero resolved rulings in the window renders an honest empty state, not a fabricated 0%', () => {
    const html = renderEscalationKpisPage('Acme', {
      kpis: baseKpis({ timeToResponse: { count: 0, medianMs: null, maxMs: null }, falseEscalation: { dismissed: 0, answered: 0, total: 0, rate: null } }),
      windowDays: 30,
    });
    assert.ok(html.includes('no rulings resolved in this window'));
  });

  test('escapes the workspace name in the title', () => {
    const html = renderEscalationKpisPage('<script>alert(1)</script>', { kpis: baseKpis(), windowDays: 30 });
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test('the window selector preselects the requested windowDays', () => {
    const html = renderEscalationKpisPage('Acme', { kpis: baseKpis(), windowDays: 90 });
    assert.ok(html.includes('<option value="90" selected>90 days</option>'));
  });
});
