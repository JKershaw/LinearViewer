/**
 * The `Implementation Plan` heading (`#`–`###`, anywhere in the text): its one spelling, in a leaf so that a module the
 * stage-kind record imports (lib/asked-of.js, through lib/size-of-move.js) can read it without pulling in
 * lib/run-trail.js (LIN-4502). Its readers: a plan comment (lib/run-trail.js `isPlanComment`, which re-exports it) and a
 * task's `asked`, which stops before a plan heading (lib/asked-of.js `askedOf`, LIN-4501).
 */
export const PLAN_HEADING_ANY = /^#{1,3}[ \t]+Implementation Plan\b/im;
