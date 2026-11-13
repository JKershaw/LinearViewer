/**
 * The code routes (LIN-4465): the routes code settles, without a routing call, in the order
 * this list gives. lib/openrouter.js codeRouteOf iterates it, and the first match decides.
 * Each entry is `{name, emits, route(issue, context)}`:
 *   - `name` is the route's own name; it is the entry's identity in the docs and the tests;
 *   - `emits` lists every `codeRoute` value the route can put on a prompt trace; each value's
 *     meaning is written beside it below (this list is where they are defined), and an entry with
 *     no `emits` is refused by its test. A value can be emitted by more than one entry (`blocked`);
 *     stored traces may also carry the legacy `look-first-wait` (LIN-4370's look-first-only wait),
 *     which no entry emits now;
 *   - `route` returns `{action, codeRoute, why, wait?}` or null (the route stands aside).
 *
 * The order is the contract. `skipLiveWait` (recommend-and-dispatch's `force` or `followUpTo`)
 * drops the first entry only, so the first entry must stay the live-stage wait, which is pinned
 * by tests/unit/lin-4465-code-routes.test.js.
 *
 * Each route's rule and reasons live in the module its entry imports (the review loop bound's in
 * lib/recommendation-facts.js, beside the bound), and every entry only delegates. None reads a
 * model's verdict.
 */
import { liveWaitOf } from './run-live-wait.js';
import { reviewLoopStep } from './recommendation-facts.js';
import { blindReadStep } from './recommendation-blind-read.js';
import { lookFirstStep } from './recommendation-look-first.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

export const CODE_ROUTES = Object.freeze([
  Object.freeze({
    name: 'live-wait',
    // 'live-wait': a stage run on the ticket is queued or running, so no stage is sent and no model
    // is asked; the answer is wait.
    emits: Object.freeze(['live-wait']),
    // A live stage run: no step and no prompt, and no selector call either.
    route(issue, context) {
      const live = liveWaitOf(context.allRuns);
      return live ? { action: null, codeRoute: 'live-wait', wait: live.wait, why: live.why } : null;
    }
  }),
  Object.freeze({
    name: 'review-bound',
    // 'blocked': the plan-review loop bound or ceiling stopped the ticket for a person.
    emits: Object.freeze(['blocked']),
    route(issue, context) {
      const loop = reviewLoopStep(issue, context.comments || []);
      return loop ? { action: loop.step, codeRoute: loop.codeRoute, why: loop.why } : null;
    }
  }),
  Object.freeze({
    // LIN-4466: the route's name is the stage kind it sends, the same concept, so it imports the kind.
    name: BLIND_READ_KIND,
    // 'blind-read': an approving review has no blind read on record, so code sends `blind-read`.
    // 'blocked': two ended blind reads since the review left none on record (the same value the
    // review-bound entry emits, for a different cause; the trace's `why` says which).
    emits: Object.freeze([BLIND_READ_KIND, 'blocked']),
    route(issue, context) {
      const read = blindReadStep(issue, context);
      return read ? { action: read.step, codeRoute: read.codeRoute, why: read.why } : null;
    }
  }),
  Object.freeze({
    name: 'look-first',
    // 'look-first': a fresh unsized leaf is sent its next look-first step (survey-task,
    // survey-place, then scoping) with no model call.
    emits: Object.freeze(['look-first']),
    route(issue, context) {
      const look = lookFirstStep(issue, context);
      return look ? { action: look.step, codeRoute: 'look-first', why: look.why } : null;
    }
  })
]);
