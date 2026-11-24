/**
 * LIN-4553 (LIN-4546 piece 5): the task titles a question card names when the caller's cheap sources miss them.
 *
 * Every surface that draws a question card (the Questions feed, the run page, Flight Companion) names its task by identifier and
 * title. Each caller first hands lib/open-questions.js the titles it already holds (the held issue set, the runs it read), and
 * the reader then reads the asking run's own row. A question whose task is in none of those (a cold held set and a run older
 * than the feed's window) still needs its title, so this asks the tracker for that one issue, bounded so it can neither slow
 * nor break the surface:
 *
 *   - at most `maxPerCall` lookups start per call; the rest wait for a later call;
 *   - a call waits at most `waitMs` for them; a lookup still running finishes in the background and fills the cache, so the
 *     next poll has the title;
 *   - a found title is kept `hitTtlMs`, a miss (no title, an error, an unknown issue) `missTtlMs`, so the 5 s badge poll never
 *     repeats a tracker read; one lookup per ticket runs at a time;
 *   - a lookup that throws reads as no title, and the call never throws.
 *
 * It imports nothing: the caller injects how one title is read (`fetchTitle`), and the clock. The cache is per workspace key, so
 * it is a registered key-state holder (lib/key-state-holders.js, `question-task-titles`).
 */

const SEP = '\u0000';

/**
 * @param {object} deps
 * @param {(workspace: object, ticket: string) => Promise<string|null>} deps.fetchTitle - one issue's title from the tracker
 * @param {() => number} [deps.now]
 * @param {number} [deps.hitTtlMs]
 * @param {number} [deps.missTtlMs]
 * @param {number} [deps.waitMs]
 * @param {number} [deps.maxPerCall]
 * @param {number} [deps.maxEntries] - the cache's bound; the oldest entry goes first
 */
export function createQuestionTaskTitles({
  fetchTitle,
  now = () => Date.now(),
  hitTtlMs = 10 * 60 * 1000,
  missTtlMs = 2 * 60 * 1000,
  waitMs = 800,
  maxPerCall = 8,
  maxEntries = 500,
} = {}) {
  // `${urlKey}\0${ticket}` -> { title: string|null, at: number } once settled, or { pending: Promise } while a lookup runs.
  const entries = new Map();

  const keyOf = (urlKey, ticket) => `${urlKey}${SEP}${ticket}`;

  function fresh(entry) {
    if (!entry || entry.pending) return false;
    return now() - entry.at < (entry.title ? hitTtlMs : missTtlMs);
  }

  function settle(key, title) {
    entries.delete(key);
    entries.set(key, { title: typeof title === 'string' && title.trim() ? title.trim() : null, at: now() });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  function start(workspace, key, ticket) {
    let pending;
    try {
      pending = Promise.resolve(fetchTitle(workspace, ticket));
    } catch {
      pending = Promise.resolve(null);
    }
    const settled = pending.then((title) => settle(key, title), () => settle(key, null));
    entries.set(key, { pending: settled });
    return settled;
  }

  /**
   * The titles this lookup can give for `tickets` in `workspace`, by ticket: the cached ones at once, and the new lookups that
   * finish within `waitMs`. Never throws.
   * @param {object} workspace - the workspace the tickets are in (its `urlKey` keys the cache; `fetchTitle` reads the rest)
   * @param {string[]} tickets
   * @returns {Promise<Object<string, string>>}
   */
  async function titlesFor(workspace, tickets) {
    const urlKey = workspace?.urlKey;
    if (!urlKey || typeof fetchTitle !== 'function' || !Array.isArray(tickets)) return {};
    const waiting = [];
    let started = 0;
    for (const ticket of new Set(tickets.filter((t) => typeof t === 'string' && t))) {
      const key = keyOf(urlKey, ticket);
      const entry = entries.get(key);
      if (fresh(entry)) continue;
      if (entry?.pending) { waiting.push(entry.pending); continue; }
      if (started >= maxPerCall) continue;
      started += 1;
      waiting.push(start(workspace, key, ticket));
    }
    if (waiting.length) {
      let timer;
      await Promise.race([
        Promise.allSettled(waiting),
        new Promise((resolve) => { timer = setTimeout(resolve, waitMs); }),
      ]);
      clearTimeout(timer);
    }
    const out = {};
    for (const ticket of tickets) {
      const entry = entries.get(keyOf(urlKey, ticket));
      if (entry && !entry.pending && entry.title) out[ticket] = entry.title;
    }
    return out;
  }

  /** Forget one workspace key's titles (the key-state reset). */
  function clear({ urlKey } = {}) {
    const prefix = `${urlKey}${SEP}`;
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
  }

  /** How many titles this lookup holds for one workspace key (the key-state probe). */
  function countFor({ urlKey } = {}) {
    const prefix = `${urlKey}${SEP}`;
    let n = 0;
    for (const key of entries.keys()) if (key.startsWith(prefix)) n += 1;
    return n;
  }

  return { titlesFor, clear, countFor };
}
