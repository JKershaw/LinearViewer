// =============================================================================
// Periodicals fixture (LIN-341)
//
// A ready-to-render `trees`-entry for the synthetic Periodicals group. Mirrors
// what fetchAndPrepareProjects assembles when the `periodicals` workspace flag
// is on: a synthetic project + the periodical template rows from
// lib/periodicals.js. Use this to render the Periodicals group in unit tests
// (e.g. renderPage([testMockPeriodicalsTree], ...)) without standing up the full
// server assembly path.
// =============================================================================
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';
import { buildPeriodicalNodes } from '../../lib/periodicals.js';

export const testMockPeriodicalsTree = {
  project: {
    id: PERIODICALS_PROJECT_ID,
    name: 'Periodicals',
    content: null,
    url: null,
    sortOrder: Number.MAX_SAFE_INTEGER
  },
  incomplete: buildPeriodicalNodes(),
  completed: [],
  completedCount: 0
};
