/**
 * A page-module fixture for tests/unit/import-world.test.js (LIN-4471): module state that a fresh import must not share.
 * Not under public/, so no page loads it and the import-layout check does not see it.
 */
let count = 0;

export function bump() {
  count += 1;
  return count;
}

export function current() {
  return count;
}
