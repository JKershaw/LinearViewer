/**
 * LIN-3604 replay preload: frozen clock, shortened keepalive timers, captured console.
 *
 * Loaded with `node --import` into BOTH the old-tree and the new-tree run, so the two
 * runs see the same clock and the same timers. The clock never advances (Date.now() is
 * constant; `new Date()` is the same instant), so any age/window arithmetic in the
 * routes is identical on both sides.
 */
const FIXED_MS = Date.parse('2026-10-17T12:00:00.000Z');
const RealDate = Date;

class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_MS);
    else super(...args);
  }
  static now() { return FIXED_MS; }
}
globalThis.Date = FrozenDate;

// The keepalive flushes 25s after arming and heartbeats every 15s. Shorten the first to
// a few ms (so a "slow" recommendation overtakes it) and make the heartbeat effectively
// never fire (so a flushed body is exactly one space, not a timing-dependent count).
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 10000 ? 15 : ms, ...rest);
globalThis.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms >= 10000 ? 3_600_000 : ms, ...rest);

// Console capture: the runner points `globalThis.__replayConsole` at a fresh array per input.
import { format } from 'node:util';
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => {
    if (globalThis.__replayConsole) globalThis.__replayConsole.push([level, format(...args)]);
  };
}
