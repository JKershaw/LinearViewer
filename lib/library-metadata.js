/**
 * Curated Library metadata (LIN-3344, Part A of LIN-3342). DATA ONLY.
 *
 * Everything here is a hand-written constant the catalog cannot derive from the
 * documents themselves:
 *
 * - `START_HERE` — the six "Start here" items in the ticket's order, with the
 *   ticket's one-line notes verbatim. Item #1 links the Archive, not a Library
 *   page; #2–#6 resolve through the catalog by `slug`.
 * - `LISTED_DOCS` — the 14 documents from elsewhere in `docs/`, which today
 *   live outside `docs/papers/harbour/` and carry no front matter. Their
 *   `date` and `author` are written here (plan rule 7): the date the text
 *   states, else the file's first-commit date read once by the implementer;
 *   the author the text states, else "John Kershaw and Claude" (the research's
 *   recommended default). The 14 listed docs and the two papers lacking front
 *   matter are the only documents that need this table.
 * - `PAPER_METADATA_OVERRIDES` — the two `docs/papers/harbour/` papers with no
 *   front matter (`fleet-complexity-read`, `what-should-an-agent-leave-behind-evidence`).
 *
 * A wrong date is a one-line correction here; the table is deliberately data,
 * not logic, so review can read it at a glance. Paths are relative to the
 * injectable docs root.
 */

/**
 * The six "Start here" items, ticket order, notes verbatim. `href` is for the
 * Archive item; `slug` names a catalog document for the rest.
 * @type {{href?: string, slug?: string, title: string, note: string}[]}
 */
export const START_HERE = [
  {
    href: '/archive/2',
    title: 'The Harbour Archive (#2).',
    note: 'Six months of the project, January to July 2026, laid out as a museum.',
  },
  {
    slug: 'doc/the-folded-loop',
    title: 'The Folded Loop.',
    note: 'An outsider reads the project cold and finds its point: who gets to say the work is done.',
  },
  {
    slug: 'doc/ladder',
    title: 'The ladder.',
    note: 'Six rungs from asking a chatbot one question to handing agents the backlog, and what it takes to climb each one.',
  },
  {
    slug: 'writing-length',
    title: 'Does the writing get longer faster than the ideas do?',
    note: "Do agents' reviews grow faster than what they have to say? Yes, by about 1.6×.",
  },
  {
    slug: 'review-loops',
    title: 'Why does a plan go round plan-review more than once?',
    note: 'Plan review sent back 83 of 94 plans, and not because of the design.',
  },
  {
    slug: 'learning-while-the-tools-change',
    title: 'Learning While the Tools Change.',
    note: 'Experience, AI skill and the tools change at different speeds. What a team needs most is calibrated distrust.',
  },
];

/**
 * The 14 listed documents (paths relative to the docs root), each with the
 * date and author the text states, else first-commit date + the default author.
 * @type {{path: string, date: string, author: string}[]}
 */
export const LISTED_DOCS = [
  { path: 'the-folded-loop.md', date: '2026-08-22', author: 'John Kershaw and Claude (Fable 5)' },
  { path: 'drift-at-every-altitude.md', date: '2026-05-29', author: 'John Kershaw and Claude' },
  { path: 'escalation-philosophy.md', date: '2026-07-18', author: 'John Kershaw and Claude' },
  { path: 'ladder.md', date: '2026-09-19', author: 'John Kershaw and Claude' },
  { path: 'executive-summary-agent-dev-controls.md', date: '2026-06-10', author: 'John Kershaw and Claude' },
  { path: 'north-star.md', date: '2026-05-29', author: 'John Kershaw and Claude' },
  { path: 'v1.md', date: '2026-09-19', author: 'John Kershaw and Claude' },
  { path: 'charter/charter.md', date: '2026-07-19', author: 'John Kershaw and Claude' },
  { path: 'autopilot.md', date: '2026-06-05', author: 'John Kershaw and Claude' },
  { path: 'autopilot-operating-manual-v2.md', date: '2026-06-07', author: 'John Kershaw and Claude' },
  { path: 'direction-layer-proposal.md', date: '2026-05-16', author: 'John Kershaw and Claude' },
  { path: 'collective-session-2026-06-12.md', date: '2026-06-12', author: 'John Kershaw and Claude' },
  { path: 'flight-companion-session-2026-08-02.md', date: '2026-08-02', author: 'John Kershaw and Claude' },
  { path: 'passage-planner-session-2026-08-03.md', date: '2026-08-03', author: 'John Kershaw and Claude' },
];

/**
 * Overrides for front-matter-less papers in `docs/papers/harbour/`, keyed by
 * file name. Same date/author rule as `LISTED_DOCS`.
 * @type {Record<string, {date: string, author: string}>}
 */
export const PAPER_METADATA_OVERRIDES = {
  'fleet-complexity-read.md': { date: '2026-09-29', author: 'John Kershaw and Claude' },
  'what-should-an-agent-leave-behind-evidence.md': { date: '2026-09-20', author: 'Codex' },
};
