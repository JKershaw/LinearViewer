// Census review (LIN-3629): rank the census's groups by places x change, decide which ones the
// Drift & Coherence review must rule on, tag each against the previous edition. Pure: no acorn, no
// git. The own-churn read is injected (census-review.mjs passes `ownChurnByPattern`). It reports
// measurements for a reviewer to read; nothing here gates anything.
import { groupKey } from './census-diff.mjs';

// The census's own order: score, then more files, then decision text (`<`, not localeCompare).
export const byRank = (a, b) => b.score - a.score || b.fileCount - a.fileCount || (a.decision < b.decision ? -1 : a.decision > b.decision ? 1 : 0);

// ERE-escape a literal. No `\b`: it is not portable across git's regex backends.
export const ereEscape = (s) => s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');

const QUOTE = '[\'"`]';

// The line pattern whose add/remove in the group's files counts as a change to the decision itself.
// null for clone and record groups, which have no literal to search for.
export const ownChurnPattern = (g) => {
  const quoted = (alts) => `${QUOTE}(${alts.map(ereEscape).join('|')})${QUOTE}`;
  switch (g.detector) {
    case 'set': case 'discrim': case 'set+discrim':
      return g.members?.length ? { pattern: quoted(g.members), ignoreCase: false } : null;
    case 'const': {
      const name = g.sites[0]?.label;
      return name ? { pattern: ereEscape(name), ignoreCase: false } : null;
    }
    case 'contract': {
      const m = /^text contract (heading|marker): (.+)$/.exec(g.decision);
      if (!m) return null;
      // Headings are lowercased by the census, so they match without case; whitespace runs are one gap.
      if (m[1] === 'heading') return { pattern: m[2].trim().split(/\s+/).map(ereEscape).join('[[:space:]]+'), ignoreCase: true };
      return { pattern: ereEscape(m[2]), ignoreCase: false };
    }
    case 'cmp':
      return g.value ? { pattern: quoted([g.value]), ignoreCase: false } : null;
    default:
      return null;
  }
};

const brief = (g) => ({ id: g.id, detector: g.detector, decision: g.decision, score: g.score, fileCount: g.fileCount, areaCount: g.areaCount, areas: g.areas, files: g.files, siteCount: g.siteCount });

// head / previous: census reports. ownChurn(group, { pattern, ignoreCase }) -> distinct commit count.
export const reviewCensus = ({ head, previous = null, top = 25, ownChurn }) => {
  const rankable = (r) => r.groups.filter((g) => g.rankable).sort(byRank);
  const ranked = rankable(head);
  const prevQueues = new Map();
  if (previous) for (const g of rankable(previous)) { const k = groupKey(g); if (!prevQueues.has(k)) prevQueues.set(k, []); prevQueues.get(k).push(g); }

  const groups = ranked.map((g, i) => {
    const rank = i + 1;
    const mustRule = rank <= top || g.areaCount >= 3;
    const table = !mustRule && (g.fileCount >= 3 || g.areaCount >= 2);
    let status = null;
    if (previous) {
      // Duplicate keys pair off in rank order; a leftover is new (head) or gone (previous).
      const prev = prevQueues.get(groupKey(g))?.shift();
      status = !prev ? 'new' : g.siteCount > prev.siteCount ? 'grown' : g.siteCount < prev.siteCount ? 'shrunk' : 'unchanged';
    }
    const out = { rank, ...brief(g), churn: g.churn, mustRule, table, status };
    if (mustRule || table) {
      // Only the groups someone reads get the git reads; clone and record groups have none (null, not 0).
      const spec = ownChurnPattern(g);
      out.ownChurn = spec ? { commits: ownChurn(g, spec), pattern: spec.pattern } : null;
    }
    if (mustRule) out.sites = g.sites.map((s) => `${s.file}:${s.line}`);
    return out;
  });
  const gone = [...prevQueues.values()].flat().sort(byRank).map(brief);
  return {
    counts: {
      groups: groups.length,
      mustRule: groups.filter((g) => g.mustRule).length,
      table: groups.filter((g) => g.table).length,
      unranked: head.groups.length - ranked.length,
      gone: gone.length,
    },
    groups,
    gone,
  };
};
