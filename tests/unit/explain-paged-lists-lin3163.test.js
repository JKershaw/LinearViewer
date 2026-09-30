/**
 * Unit tests for scripts/explain-paged-lists-lin3163.js (LIN-3163).
 *
 * The script's explain-collection half needs a real production MongoDB and is
 * operator-run, but its VERDICT is pure. These tests pin that verdict against
 * fixture explain JSON so a future edit to the pass criteria is caught here,
 * not only by an operator reading production output.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  EXTENDED_INDEX_NAMES,
  collectPlanStages,
  evaluatePagedListExplain,
  evaluateCountExplain,
  evaluateAcceptance
} from '../../scripts/explain-paged-lists-lin3163.js';

const EXTENDED = EXTENDED_INDEX_NAMES['proxy-events'];

// A sort-free, index-backed page: LIMIT -> FETCH -> IXSCAN.
function passExplain({ indexName = EXTENDED, limit = 50, docs = 50, keys = 50, returned = 50 } = {}) {
  return {
    queryPlanner: {
      winningPlan: {
        stage: 'LIMIT',
        limitAmount: limit,
        inputStage: {
          stage: 'FETCH',
          inputStage: { stage: 'IXSCAN', indexName }
        }
      }
    },
    executionStats: { totalKeysExamined: keys, totalDocsExamined: docs, nReturned: returned }
  };
}

describe('collectPlanStages', () => {
  test('flattens inputStage chains and inputStages arrays', () => {
    const stages = collectPlanStages({
      stage: 'LIMIT',
      inputStage: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'x' } }
    });
    assert.deepStrictEqual(stages.map(s => s.stage), ['LIMIT', 'FETCH', 'IXSCAN']);
  });

  test('walks an SBE nested queryPlan', () => {
    const stages = collectPlanStages({ stage: 'LIMIT', queryPlan: { stage: 'IXSCAN', indexName: 'y' } });
    assert.deepStrictEqual(stages.map(s => s.stage), ['LIMIT', 'IXSCAN']);
  });
});

describe('evaluatePagedListExplain (LIN-3163)', () => {
  test('PASS: IXSCAN on the expected extended index with no SORT/COLLSCAN', () => {
    const verdict = evaluatePagedListExplain({ explain: passExplain(), expectedIndex: EXTENDED, limit: 50, skip: 0 });
    assert.strictEqual(verdict.pass, true, verdict.reasons.join('; '));
    assert.strictEqual(verdict.indexName, EXTENDED);
    assert.strictEqual(verdict.hasSort, false);
    assert.strictEqual(verdict.hasCollscan, false);
  });

  test('FAIL: a blocking SORT stage anywhere in the plan', () => {
    const explain = {
      queryPlanner: {
        winningPlan: {
          stage: 'LIMIT',
          inputStage: { stage: 'FETCH', inputStage: { stage: 'SORT', inputStage: { stage: 'IXSCAN', indexName: EXTENDED } } }
        }
      },
      executionStats: { totalKeysExamined: 141449, totalDocsExamined: 50 }
    };
    const verdict = evaluatePagedListExplain({ explain, expectedIndex: EXTENDED, limit: 50, skip: 0 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /SORT/.test(r)), verdict.reasons.join('; '));
  });

  test('FAIL: a COLLSCAN', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: { totalKeysExamined: 0, totalDocsExamined: 141449 }
    };
    const verdict = evaluatePagedListExplain({ explain, expectedIndex: EXTENDED, limit: 50, skip: 0 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /COLLSCAN/.test(r)));
  });

  test('FAIL: the wrong index wins (the vestigial expiry index)', () => {
    const explain = passExplain({ indexName: 'urlKey_1_expiresAt_1' });
    const verdict = evaluatePagedListExplain({ explain, expectedIndex: EXTENDED, limit: 50, skip: 0 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /expected/.test(r)), verdict.reasons.join('; '));
  });

  test('FAIL: docsExamined exceeds the page budget', () => {
    const explain = passExplain({ docs: 5000, keys: 5000 });
    const verdict = evaluatePagedListExplain({ explain, expectedIndex: EXTENDED, limit: 50, skip: 0 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /totalDocsExamined/.test(r)));
  });

  test('FAIL: keysExamined exceeds skip+limit on a deep page', () => {
    const explain = passExplain({ docs: 50, keys: 9000 });
    const verdict = evaluatePagedListExplain({ explain, expectedIndex: EXTENDED, limit: 50, skip: 5000 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /totalKeysExamined/.test(r)));
  });

  test('PASS: the task-bounded agent-status exception (SORT bounded by the task index)', () => {
    const explain = {
      queryPlanner: {
        winningPlan: {
          stage: 'LIMIT',
          inputStage: { stage: 'FETCH', inputStage: { stage: 'SORT', inputStage: { stage: 'IXSCAN', indexName: 'urlKey_1_taskIdentifier_1' } } }
        }
      },
      executionStats: { totalKeysExamined: 12, totalDocsExamined: 12 }
    };
    const verdict = evaluatePagedListExplain({
      explain,
      expectedIndex: EXTENDED,
      limit: 20,
      skip: 0,
      maxDocs: 12,
      allowTaskBoundedIndex: 'urlKey_1_taskIdentifier_1'
    });
    assert.strictEqual(verdict.pass, true, verdict.reasons.join('; '));
  });

  test('FAIL: the task-bounded exception still refuses a COLLSCAN', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'SORT', inputStage: { stage: 'COLLSCAN' } } },
      executionStats: { totalKeysExamined: 0, totalDocsExamined: 141449 }
    };
    const verdict = evaluatePagedListExplain({
      explain,
      expectedIndex: EXTENDED,
      limit: 20,
      maxDocs: 141449,
      allowTaskBoundedIndex: 'urlKey_1_taskIdentifier_1'
    });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /COLLSCAN/.test(r)));
  });

  test('FAIL: a missing/errored explain is not silently a pass', () => {
    const verdict = evaluatePagedListExplain({ explain: null, expectedIndex: EXTENDED, limit: 50 });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /winningPlan/.test(r)));
  });
});

describe('evaluateCountExplain (LIN-3163)', () => {
  test('PASS: COUNT_SCAN examining no documents', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'COUNT_SCAN', indexName: 'urlKey_1_timestamp_-1__id_-1' } },
      executionStats: { totalDocsExamined: 0, totalKeysExamined: 141449 }
    };
    const verdict = evaluateCountExplain(explain);
    assert.strictEqual(verdict.pass, true, verdict.reasons.join('; '));
  });

  test('FAIL: a COLLSCAN count', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: { totalDocsExamined: 141449, totalKeysExamined: 0 }
    };
    const verdict = evaluateCountExplain(explain);
    assert.strictEqual(verdict.pass, false);
  });

  test('FAIL: a count that examines documents', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'COUNT_SCAN', indexName: 'x' } },
      executionStats: { totalDocsExamined: 5, totalKeysExamined: 5 }
    };
    const verdict = evaluateCountExplain(explain);
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.reasons.some(r => /expected 0/.test(r)));
  });
});

describe('evaluateAcceptance (LIN-3163)', () => {
  const allIndexes = {
    'proxy-events': [EXTENDED_INDEX_NAMES['proxy-events']],
    'foreman-status': [EXTENDED_INDEX_NAMES['foreman-status']],
    'llm-call-log': [EXTENDED_INDEX_NAMES['llm-call-log']],
    'prompt-traces': [EXTENDED_INDEX_NAMES['prompt-traces']]
  };

  test('PASS when every extended index is present and every shape passes', () => {
    const verdict = evaluateAcceptance({
      indexes: allIndexes,
      findShapes: [{ key: 'proxy-events page 1', explain: passExplain(), expectedIndex: EXTENDED, limit: 50, skip: 0 }],
      countShapes: [{ key: 'count', explain: { queryPlanner: { winningPlan: { stage: 'COUNT_SCAN' } }, executionStats: { totalDocsExamined: 0 } } }]
    });
    assert.strictEqual(verdict.pass, true, JSON.stringify(verdict.rows));
  });

  test('FAIL when an extended index is missing', () => {
    const verdict = evaluateAcceptance({
      indexes: { ...allIndexes, 'prompt-traces': [] },
      findShapes: [],
      countShapes: []
    });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.rows.some(r => /prompt-traces/.test(r.key) && !r.pass));
  });

  test('FAIL when any one shape fails', () => {
    const bad = {
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: { totalDocsExamined: 141449, totalKeysExamined: 0 }
    };
    const verdict = evaluateAcceptance({
      indexes: allIndexes,
      findShapes: [{ key: 'bad shape', explain: bad, expectedIndex: EXTENDED, limit: 50, skip: 0 }],
      countShapes: []
    });
    assert.strictEqual(verdict.pass, false);
    assert.ok(verdict.rows.some(r => r.key === 'bad shape' && !r.pass));
  });
});