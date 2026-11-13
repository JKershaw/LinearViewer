/**
 * Synthetic witness-test texts for tests/unit/bridge-inventory.test.js (LIN-4471): the inputs the witness-order check
 * reads, right and wrong. They live here, not in the suite, because the classic-loader census
 * (tests/unit/classic-loader-census.test.js) reads suite text for `loadWorld(`, and a fixture that names it is not a
 * classic suite. The census reads tests/unit/*.js only, never this directory.
 */

/** In the right order: the consumer is read and run, and only then is the bridge installed. */
export const rightOrderByRun = (consumer) => `
  const SRC = readFileSync(join(__dirname, '../../public${consumer}'), 'utf8');
  const world = loadWorld({ scripts: [] });
  world.run(SRC);
  loadCostFormat(world.sandbox);
`;

/** The wrong order: the bridge is installed first, then the consumer runs. */
export const swappedByRun = (consumer) => `
  import { loadCostFormat } from '../fixtures/browser-cost-format.js';
  const SRC = readFileSync(join(__dirname, '../../public${consumer}'), 'utf8');
  const world = loadWorld({ scripts: [] });
  loadCostFormat(world.sandbox); world.run(SRC);
`;

/** The consumer is loaded by a loadWorld scripts list. `first` puts the bridge call before that load. */
export const byScriptsList = (consumer, { first = false } = {}) => {
  const file = consumer.replace(/^\//, '');
  return first
    ? `loadCostFormat(sandbox); const world = loadWorld({ scripts: ['${file}'] });`
    : `const world = loadWorld({ window: {}, scripts: ['${file}'] }); loadCostFormat(world.sandbox);`;
};

/** A witness whose loadWorld lists some other script, so it never loads the consumer. */
export const otherScriptOnly = "loadWorld({ scripts: ['common.js'] }); loadCostFormat(x);";
