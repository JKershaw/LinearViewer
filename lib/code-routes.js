/**
 * The code routes (LIN-4465): the routes code settles, without a routing call, in the order
 * this list gives. lib/openrouter.js codeRouteOf iterates it, and the first match decides.
 * Each entry is `{name, emits, route(issue, context)}`:
 *   - `name` is the route's own name; it is the entry's identity in the docs and the tests;
 *   - `emits` lists every `codeRoute` value the route can put on a prompt trace (the trace store
 *     names what each one means); an entry with no `emits` is refused by its test;
 *   - `route` returns `{action, codeRoute, why, wait?}` or null (the route stands aside).
 *
 * The order is the contract. `skipLiveWait` (recommend-and-dispatch's `force` or `followUpTo`)
 * drops the first entry only, so the first entry must stay the live-stage wait, which is pinned
 * by tests/unit/lin-4465-code-routes.test.js.
 *
 * The routes and their reasons live in their own modules, named here: the live-stage wait
 * (lib/recommendation-live-wait.js), the review loop bound (lib/recommendation-facts.js,
 * reviewLoopStop; its two reasons are written in the entry below), the blind read before
 * close-out (lib/recommendation-blind-read.js) and the look-first sequence
 * (lib/recommendation-look-first.js). None reads a model's verdict.
 */
import { liveWaitOf } from './recommendation-live-wait.js';
import { reviewLoopStop } from './recommendation-facts.js';
import { blindReadStep } from './recommendation-blind-read.js';
import { lookFirstStep } from './recommendation-look-first.js';

export const CODE_ROUTES = Object.freeze([
  Object.freeze({
    name: 'live-wait',
    emits: Object.freeze(['live-wait']),
    // A live stage run: no step and no prompt, and no selector call either.
    route(issue, context) {
      const live = liveWaitOf(context.allRuns);
      return live ? { action: null, codeRoute: 'live-wait', wait: live.wait, why: live.why } : null;
    }
  }),
  Object.freeze({
    name: 'review-bound',
    emits: Object.freeze(['blocked']),
    route(issue, context) {
      const stop = reviewLoopStop(issue, context.comments || []);
      if (!stop) return null;
      const why = stop === 'ceiling'
        ? 'the plan-review loop reached its ceiling of 5 reviews since the last Approve, whatever the findings count'
        : 'the plan-review loop reached its bound: the plan has been sent back repeatedly since its last Approve and the findings are not narrowing';
      return { action: 'blocked', codeRoute: 'blocked', why: `${why}, with no person's comment since the latest verdict.` };
    }
  }),
  Object.freeze({
    name: 'blind-read',
    emits: Object.freeze(['blind-read', 'blocked']),
    route(issue, context) {
      const read = blindReadStep(issue, context);
      return read ? { action: read.step, codeRoute: read.codeRoute, why: read.why } : null;
    }
  }),
  Object.freeze({
    name: 'look-first',
    emits: Object.freeze(['look-first']),
    route(issue, context) {
      const look = lookFirstStep(issue, context);
      return look ? { action: look.step, codeRoute: 'look-first', why: look.why } : null;
    }
  })
]);
