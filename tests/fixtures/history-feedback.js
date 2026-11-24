/**
 * LIN-4541: old feedback rows, written as they were stored, for a spec that renders one. No route writes the decision kinds
 * now (a runner post of `decision` or `decision-withdrawn` is refused 422; the answer, withdrawal and reversal writers are
 * gone), so a spec that pins how an old row still displays writes it through the test seam (routes/test.js
 * POST /test/seed-history-feedback), after taking the item the ordinary way.
 */
import { expect } from '@playwright/test';

/** Append `entries` ({kind, message}) to the taken item's history document, in order. */
export async function seedHistoryFeedback(page, urlKey, itemId, entries) {
  const res = await page.request.post('/test/seed-history-feedback', { data: { urlKey, itemId, entries } });
  expect(res.status(), `history seed failed: ${await res.text()}`).toBe(200);
}
