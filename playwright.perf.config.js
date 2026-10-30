import base from './playwright.config.js';

// LIN-4024: the shape measure (tests/perf) runs on its own, on one worker, outside the E2E pool. Rendering a Home of a few
// thousand tasks is synchronous work on the server every spec shares, so beside the timing-sensitive specs it made them
// flake. See the header of tests/perf/lin-4024-home-shape.spec.js.
export default { ...base, testDir: './tests/perf', workers: 1 };
