/**
 * LIN-4531 leftover: one in-process line per key, the rule two writers shared as copies (lib/records/writes.js, the ticket
 * step per task; lib/question-answers.js, the answer and the dismiss per question). It lives in Records because the Records
 * leaf imports only its own modules (tests/unit/lin-4493-records-boundary.test.js); a writer outside Records imports it here.
 *
 * `createSerialLine()` returns `run(key, fn)`: calls for one key run one at a time in this process, in call order; calls for
 * different keys do not wait on each other. Each entry is the running step's tail promise, removed when that step settles, so
 * the line holds nothing between steps. A step that throws does not stop the next one. Across processes it guards nothing:
 * each caller names its own cross-request guard.
 * @returns {(key: string, fn: () => Promise<any>) => Promise<any>}
 */
export function createSerialLine() {
  const inLine = new Map();
  return function run(key, fn) {
    const prev = inLine.get(key) ?? Promise.resolve();
    const step = prev.then(() => fn());
    const tail = step.catch(() => {});
    inLine.set(key, tail);
    return step.finally(() => { if (inLine.get(key) === tail) inLine.delete(key); });
  };
}
