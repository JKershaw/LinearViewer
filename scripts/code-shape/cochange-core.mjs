// Change coupling (LIN-3860): which areas land in the same change. Pure: git log text and a compiled
// area guide in, a report of facts out. No git, no fs, no acorn. It reports and never gates.

const HEADER = /^@([0-9a-f]{40}|[0-9a-f]{64})$/;

// `git log --first-parent --diff-merges=first-parent --name-only --format=@%H` -> [{ sha, files }].
// A header is an @ followed by a full object name; any other non-empty line is a file, so a path
// such as `@scope/x.js` is not mistaken for a commit.
export const parseChangeLog = (text) => {
  const changes = [];
  for (const line of text.split('\n')) {
    const m = HEADER.exec(line);
    if (m) changes.push({ sha: m[1], files: [] });
    else if (line && changes.length) changes.at(-1).files.push(line);
  }
  return changes;
};

// First matching area, as in areas.json. Unlike code-shape-lib's areaOf, a file no area claims is
// null, not its top-level directory: tests/ and docs/ must not become areas.
const claimedBy = (guide, path) => guide.find((a) => a.rx.some((r) => r.test(path)))?.name ?? null;

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const buildReport = ({ changes, guide, commit, windowStart, windowEnd, days, shallow }) => {
  const pairCounts = new Map();
  const unmapped = new Set();
  let multi = 0;
  for (const { files } of changes) {
    const areas = new Set();
    for (const f of files) {
      const a = claimedBy(guide, f);
      if (a === null) unmapped.add(f);
      else areas.add(a);
    }
    if (areas.size < 2) continue;
    multi++;
    const names = [...areas].sort(byCode);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = JSON.stringify([names[i], names[j]]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const pairs = [...pairCounts].map(([k, n]) => ({ areas: JSON.parse(k), changes: n }))
    .sort((x, y) => y.changes - x.changes || byCode(x.areas[0], y.areas[0]) || byCode(x.areas[1], y.areas[1]));
  return { commit, windowStart, windowEnd, days, changes: changes.length, shallow, changesTouchingMultipleAreas: multi, unmappedFiles: unmapped.size, pairs };
};

export const summariseCochange = (r) =>
  `cochange ${r.commit.slice(0, 7)}: ${r.changes} changes in ${r.days} days, ${r.changesTouchingMultipleAreas} touch 2+ areas, ${r.pairs.length} pairs, ${r.unmappedFiles} unmapped files${r.shallow ? ', shallow clone' : ''}`;
