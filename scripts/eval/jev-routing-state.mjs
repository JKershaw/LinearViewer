/**
 * Distilled-state builder for the LIN-3107 Jev routing evaluation.
 *
 * Jev's published guidance names raw-thread, multi-hop reads as a weak spot and asks for
 * relevant, filtered named-field state with a direct typed question. This module turns a
 * context bundle (the exact shape `getRecommendation` consumes:
 * `{issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild}`)
 * into that distilled state.
 *
 * Deterministic facts are NOT re-implemented here: `assembleNodeFacts` /
 * `selectFocusSubtask` / `isTerminalState` / `extractSessionFit` are imported from
 * lib/recommendation-facts.js (LIN-434) — the same unit-tested seam `buildMetaPrompt`
 * consumes (lib/openrouter.js) — so the counts and the frontier child can never drift
 * from the live meta-prompt.
 */
import {
  assembleNodeFacts,
  selectFocusSubtask,
  isTerminalState,
  extractSessionFit,
} from '../../lib/recommendation-facts.js';

/** Collapse markdown/whitespace and truncate — extractive only, never model-summarised. */
export function digest(text, max = 240) {
  if (!text) return null;
  const flat = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

// Lexical proxies for the behaviours the state must surface without the raw thread: a
// session-fit verdict, landed work, a review verdict, an override, and — the hard case —
// a later finding that REFUTES an earlier one. These are deliberately conservative and
// documented as a lexical proxy (a stand-in for a semantic read, not a replacement).
const SIGNAL_TAGS = [
  ['session-fit', /\b(needs?\s+multiple\s+sessions|fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session)\b/i],
  ['plan', /(^|\n)#{1,3}[^\n]*\bplan\b/i],
  ['review-verdict', /(###\s*[^\n]*verdict|verdict:\s*(approve|request changes)|\brequest changes\b)/i],
  ['approved', /(verdict:\s*approve|approved\b|\bapprove\b)/i],
  ['landed', /\b(PR\s*#?\d+|merged|CI green|CI ✅|squash-merged)\b/i],
  ['override', /autopilot verb override/i],
  ['blocked', /\b(blocked|waiting on|depends on|dependency)\b/i],
  ['completed-prep', /(research (complete|findings|done)|planning complete|plan ready|ready for implementation)/i],
];

const DIVERGENCE_MARKERS = [
  /\brefut(e|es|ed|ing)\b/i,
  /\bcontradict(s|ed|ing|ion)\b/i,
  /\bdoes not fire\b/i,
  /\bunreliable\b/i,
  /\bfalse negative\b/i,
  /\bnot (been )?(run|produced|validated|confirmed)\b/i,
  /\bunvalidated\b/i,
  /\bre-?investigate\b/i,
  /\brelocated\b/i,
  /\bwrong goalpost\b/i,
];

/**
 * Per-comment digest + lexical signal tags + a code-computed divergence marker.
 * The marker flags a trail where a later comment appears to refute/contradict an earlier
 * finding — the fix-before-validate trap shape (HAR-697 mechanism D) — so the state can
 * carry it without the raw thread's distractors. Extractive, bounded, reproducible.
 */
export function summarizeTrail(comments = []) {
  const ordered = comments
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const entries = ordered.map((c, i) => {
    const body = c.body || '';
    const tags = SIGNAL_TAGS.filter(([, re]) => re.test(body)).map(([t]) => t);
    const divMarkers = DIVERGENCE_MARKERS.filter((re) => re.test(body)).map((re) => re.source);
    return {
      index: i,
      user: c.user || 'Unknown',
      createdAt: c.createdAt || null,
      digest: digest(body, 220),
      tags,
      divergenceHits: divMarkers.length,
    };
  });
  const marked = entries.some((e, i) =>
    i > 0 && e.divergenceHits > 0 && entries.slice(0, i).some((p) => p.digest)
  );
  const markers = entries.filter((e) => e.divergenceHits > 0).map((e) => e.index);
  return {
    count: ordered.length,
    entries,
    divergenceMarker: { flagged: marked, commentIndexes: markers },
  };
}

/**
 * Build the distilled state for one routing decision.
 *
 * `deferEligible` / `deferTarget` implement the eval-wide defer rule: `defer` is eligible
 * only for a node with a real, non-terminal child, per `selectFocusSubtask` /
 * `isTerminalState` (the same helpers lib/recommend-recurse.js uses). A leaf, or a node
 * whose children are all terminal, yields `false` / `null`.
 */
export function buildDistilledState(bundle = {}) {
  const issue = bundle.issue || {};
  const children = bundle.children || [];
  const comments = bundle.comments || [];
  const facts = assembleNodeFacts(issue, children);
  const focus = selectFocusSubtask(children);
  const deferEligible = focus != null;
  const trail = summarizeTrail(comments);

  return {
    identifier: issue.identifier || null,
    title: issue.title || null,
    state: { name: issue.state?.name || 'Unknown', type: issue.state?.type || 'unknown' },
    labels: issue.labels || [],
    isTerminal: facts.isTerminal,
    hasSubtasks: children.length > 0,
    nodeFacts: {
      subtaskCount: children.length,
      completedCount: facts.completedCount,
      inProgressCount: facts.inProgressCount,
      remainingCount: facts.remainingCount,
      hasOpenChildren: facts.hasOpenChildren,
      // frontierFacts null on a leaf, matching assembleNodeFacts' own contract.
      frontierFacts: facts.frontierFacts,
    },
    sessionFit: extractSessionFit(issue.description),
    deferEligible,
    deferTarget: focus ? focus.identifier : null,
    descriptionDigest: digest(issue.description, 600),
    trailSummary: trail.entries,
    divergenceMarker: trail.divergenceMarker,
  };
}

/** Expose the raw primitives the tests assert against (all from the shared seam). */
export { assembleNodeFacts, selectFocusSubtask, isTerminalState, extractSessionFit };
