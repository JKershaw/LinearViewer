/**
 * LIN-4549 (LIN-4546 piece 1): testing data shaped like a real workspace's questions and notes, for the test-only seeds in
 * routes/test.js (`POST /test/seed-question-record` with `long: true`, `POST /test/seed-owner-findings`) and the running runs of
 * tests/fixtures/question-records.js. Nothing in the app reads this file outside those, and the test routes are mounted only
 * when NODE_ENV === 'test'.
 *
 * A real question record carries an agent's whole ask: several hundred words of background, with paragraphs and lists, and
 * three or four options that are each a long sentence. A real owner has dozens of findings addressed to them, some a line,
 * some a paragraph, many naming internal ids. Pure data and builders: no I/O.
 */

/** Long asks, each several hundred words with paragraphs, a bulleted list and a numbered list, as a stage writes one. */
const LONG_ASKS = [
  [
    'The task asks for the rulings page to be rebuilt, but the plan and the code disagree about where the card\'s styling should live, and the choice changes what three later pieces can do, so I would rather ask than guess.',
    '',
    'Background. The question card is drawn by one renderer, lib/question-record-card.js, and five surfaces show it: Home, the rulings page, the task page, the run page and Flight Companion. Its rules live in public/session.css, which Home, the task page and the run page load. Observation and Flight Companion load public/style.css but not session.css, so on those two pages the card draws with no styling at all: a tiny text box, a bare "Answer", a browser-grey dismiss button, and options touching each other. That is the gap the ticket describes.',
    '',
    'What I found while reading the code:',
    '- session.css also carries the run page\'s own layout (the overview, the steps, the transcript), so loading it on Observation would bring roughly six hundred lines of rules that do not belong there and could collide with Observation\'s own .obs-* rules on narrow screens.',
    '- style.css is loaded by every page, including the landing page, and it is already 149 KB; the UI finish goal asks for the CSS to be small and coherent enough to rebuild in one pass.',
    '- Two of the card\'s rules (the dark-theme Answer colour and the 480px padding) sit in blocks shared with other run-page controls, so moving them means splitting those blocks.',
    '- A guard test could pin "every page that draws the card loads a sheet that styles it", which would have caught this when Flight Companion first drew the card.',
    '',
    'The routes I can see:',
    '1. Move the card\'s rules into style.css, split the shared blocks, and add the guard test. Every page gets the card styled the same; style.css grows by about a hundred lines.',
    '2. Add a small card sheet (question-card.css) and load it on each of the five pages. Nothing grows for pages that never draw a card, but each new surface has to remember the sheet, which is how this gap opened.',
    '3. Load session.css on Observation and Flight Companion as well. The smallest change, but it brings the run page\'s layout along and leaves the card\'s look owned by the run page.',
    '',
    'I recommend the first: one sheet every page loads cannot be forgotten by the next surface, the guard test holds it, and the growth is small next to what the later pieces remove. If I hear nothing I will take the first route and say so in the PR, so a reviewer can push back before anything merges.',
  ].join('\n'),
  [
    'Before I change how Home keeps a card across a repaint, I need to know which of the three current behaviours is the intended one, because the plan says "keep today\'s union" and the three copies disagree in ways a person would notice.',
    '',
    'Today there are three rules for keeping a question card in place when the page repaints:',
    '- Home\'s live Waiting section (public/question-cards.js) keeps a card that is settled, has typed words, holds focus, or has a disabled control or an answer in flight. It does not keep a card on which only an option was chosen, so choosing an option and then waiting for a refresh loses the choice.',
    '- Observation\'s rulings tab (public/observation.js) keeps a card that is settled, has typed words, has a chosen option, or holds focus. It does not keep one with an answer in flight, so a slow answer can be repainted mid-request and the outcome lands on a detached card.',
    '- Home\'s opened task (public/prompt-section.js) keeps the card only while it holds typed words, focus or an answer in flight, gated on the card key.',
    '',
    'The union of the three is: settled, typed words, a chosen option, focus inside the card, any disabled control, or an answer in flight. That is what I plan to build as one rule, used by all three hosts, with a unit for each host and an end-to-end check on Home that types, chooses, holds focus and then runs a refresh with a new question arriving.',
    '',
    'Two side effects I want you to know about before they happen:',
    '1. On Observation a card with an answer in flight will now be kept, so the outcome text always lands on the card the person pressed. I think that is strictly better.',
    '2. On Home a card with only a chosen option will now be kept across the live refresh. A person who chose an option and walked away will find it still chosen, rather than reset. That is a visible change, though a small one.',
    '',
    'I recommend building the union as planned. If you would rather Home kept its current behaviour for a chosen option, I can exempt it, but then the three hosts keep diverging, which is the finding this piece closes.',
  ].join('\n'),
  [
    'The findings addressed to you have grown to several dozen, and the ticket asks for them to sit in a quieter group below the questions with only the first few showing. Before I pick the number, I want to check what you expect to see first, because the order changes which notes you ever read.',
    '',
    'What Home shows today: every open finding addressed to the owner is printed as raw text under the questions. Each line carries the internal task id (for example task-037eb576), the raw person id it was addressed to, and the first part of the note cut off mid-sentence, with no link and no way to clear it. With dozens of them the questions are pushed off the first screen on a phone.',
    '',
    'What the rebuilt group would show, for each finding:',
    '- the task\'s identifier in mono and its title in the page face, linking to the task page;',
    '- one short line of the note, cut at a word boundary, with the full note on the task page;',
    '- a clear control that ends the finding as done, so it leaves the list everywhere at once.',
    '',
    'The order is the open question. The options I can see are:',
    '1. Newest first, showing five before the fold. The latest notes are the ones most likely to still matter, and older ones are one tap away.',
    '2. Grouped by task, showing the three tasks with the most open notes. A task with many notes is probably where attention is needed, but a single urgent note on a quiet task sinks.',
    '3. Oldest first, showing five. Nothing is forgotten, but the first screen fills with notes that may already be stale.',
    '',
    'I recommend newest first with five before the fold, because it keeps Home quiet and puts the freshest notes where a glance lands. If I hear nothing I will build that and note it in the PR so it can be changed in review.',
  ].join('\n'),
];

/** Each ask's options: three or four long sentences, as a stage writes them. The recommended one is not first, so the card's ordering shows. */
const LONG_OPTIONS = [
  [
    'Add a small card sheet, question-card.css, and load it on each of the five pages that draw the card, accepting that a new surface must remember to load it',
    'Move the card\'s rules into public/style.css, the sheet every page loads, split the two shared blocks, and add a guard test that fails when a drawing surface loads no card rules',
    'Load public/session.css on Observation and Flight Companion as well, accepting that the run page\'s layout comes along and the card\'s look stays owned by the run page',
    'Leave the styling as it is for now and file the gap as a follow-up under the UI finish goal, so this piece only changes behaviour and not looks',
  ],
  [
    'Keep Home\'s current behaviour for a card on which only an option was chosen, so the three hosts keep one difference that is documented beside the rule',
    'Build the union as planned: settled, typed words, a chosen option, focus, any disabled control, or an answer in flight, one rule for all three hosts',
    'Use the narrowest rule instead (typed words or an answer in flight only), so a refresh is more eager and a person sees new questions sooner',
  ],
  [
    'Group the findings by task and show the three tasks with the most open notes before the fold, accepting that a single urgent note on a quiet task sinks',
    'Show the newest findings first, five before the fold, each with the task identifier and title, a short line of the note and a clear control',
    'Show the oldest findings first, five before the fold, so nothing is forgotten even though the first screen may fill with stale notes',
    'Show no findings on Home at all and move them to the task pages only, with a count on Home that links to a list',
  ],
];

const LONG_IF_UNANSWERED = [
  'I take the recommended route, move the card\'s rules into style.css with the guard test, and say so in the PR so review can push back before it merges.',
  'I build the union of the three rules as planned and list both visible side effects in the PR.',
  'I build newest first with five before the fold and note it in the PR so the number and order can be changed in review.',
];

/**
 * One long question, varied by `variant` (any integer; it wraps), for `POST /test/seed-question-record` with `long: true`.
 * The recommended option is the second, so a card that puts it first visibly reorders the list.
 * @param {number} [variant]
 * @returns {{asks: string, options: string[], recommended: string, ifUnanswered: string}}
 */
export function longQuestion(variant = 0) {
  const n = ((Number(variant) || 0) % LONG_ASKS.length + LONG_ASKS.length) % LONG_ASKS.length;
  const options = LONG_OPTIONS[n];
  return { asks: LONG_ASKS[n], options: [...options], recommended: options[1], ifUnanswered: LONG_IF_UNANSWERED[n] };
}

/** Finding notes as stages and reviews write them: some a short line, some a paragraph, many naming internal ids and paths. */
const FINDING_SAYS = [
  'The rulings page draws the question card with no styling: Observation loads style.css but not session.css.',
  'task-037eb576: the plan names public/question-cards.js mergeWaitingCards, but the merge also keys .waiting-card wrappers that no renderer draws any more. Delete the branch with the merge, or the next reader will think a ruling card can still arrive.',
  'Review blind-read: the PR changes the badge count but the count line on Home still reads ruling.rows. The two can disagree when a question is open on a task the owner cannot see.',
  'Could not run the Flight Companion E2E locally (no browser in this sandbox). Run: npx playwright test tests/e2e/flight-companion.spec.js',
  'person:acct-4f1c2e9a asked on the task page why the question shows twice. The pinned card and the records section both draw it; one of them should defer to the other.',
  'Leftover: the dark-theme Answer colour rule in public/session.css is shared with .sess-proposal-apply. Splitting it is outside this piece; filing here so it is not lost.',
  'The guard test for type sizes (tests/unit/lin-4107-type-sizes.test.js) will need an allowlist entry when the card\'s task identifier goes mono.',
  'finding-68be8578: the nav badge counts open question records across every workspace, but Home\'s "Waiting on you" counts only this workspace. A person with two workspaces sees 3 on the badge and 1 on Home.',
  'Home\'s records only appear on reload (finding-d4767b81): the live fragment carries questions but not records, so a finding written while Home is open never shows until the page is reloaded.',
  'A dismissal is stored as withdrawn, which is the word for an agent taking its own question back. The task page then reads "withdrawn by person:acct-4f1c2e9a", which is wrong on both counts.',
  'The task page Records section shows ISO times (2026-11-24T09:52:17.341Z) and raw kinds (verdict, change). A person reading it needs "3 hours ago" and "review" / "pull request".',
  'CI note: e2e shard 3 timed out twice on lin-4242-waiting-live.spec.js while the fragment refresh raced the seed. It passed on retry; worth a look if it repeats.',
  'The Runs tab shows every open question card above the runs, so with four questions open the first run is below the fold at 390px.',
  'Observation\'s rulings row draws its own task head (identifier and title) above the card. Once the card draws its own task line, the head should go or the identifier shows twice.',
  'Plan-review note: the plan says "no bridge back to a global" for the waiting merge, but public/home-placement.js reads QuestionCards.cardHoldsInput from the classic global. That read has to move with the rule.',
  'The option buttons centre long sentences inside .btn, which wraps them into narrow centred columns at 390px. Left-aligned rows would read better.',
  'The "if you don\'t answer" line repeats the run state in words a person cannot act on ("Nothing further runs; the run has ended."). Consider hiding it when the run has ended.',
  'Leftover from LIN-4541: routes/dashboard-rulings.js still sends `question` beside `asks` for the feed\'s other readers. Nothing reads `question` any more; it can go with the next change there.',
];

/**
 * `count` findings' notes, cycling through the realistic set and numbering the repeats, so dozens of findings read as distinct
 * notes rather than one note copied.
 * @param {number} count
 * @returns {string[]}
 */
export function findingNotes(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = FINDING_SAYS[i % FINDING_SAYS.length];
    const round = Math.floor(i / FINDING_SAYS.length);
    out.push(round === 0 ? base : `${base} (seen again in run ${round + 1})`);
  }
  return out;
}

/** The progress line a running task's runner last posted, as a runner writes it. */
export const RUNNING_PROGRESS = [
  'Reading the plan and the area notes; staleness check clean.',
  'Moved the card rules into style.css; running the guard test.',
  'E2E for the Home refresh is green locally; pushing the branch.',
  'Waiting on CI for the second push; two jobs still running.',
];
