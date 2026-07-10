/**
 * "The Ship's Biscuit" — the editor-in-chief prompt (LIN-818, V1).
 *
 * ONE cheap LLM call after the deterministic model is built (lib/ship-biscuit.js):
 * the editor reads the window's addressable source slices and emits the FRONT PAGE
 * (a synthesised lede) plus an INDEX of article *stubs* — `{ id, section, headline,
 * dek, weight, sourceRefs }`. It generates NO article bodies; those are the deferred
 * on-demand V2 pass. This mirrors lib/next-run.js in shape (deterministic context →
 * LLM → parsed JSON), and like it is a standalone generation surface, so it is
 * exempt from the both-paths recommendation-prompt parity rule.
 *
 * Grounding contract (§B): each stub's `sourceRefs` is stored BY VALUE — the parser
 * resolves the editor's referenced ids back to the model's full SourceRef objects
 * (headline + content snapshot) and pins those onto the stub, so the durable edition
 * keeps its grounding after the 30-day-TTL source rows age out. Unknown ids the model
 * invents are dropped (the grounding guard, mirroring next-run's id validation).
 *
 * Quiet-window honesty is enforced deterministically OUTSIDE the LLM:
 * `buildQuietEdition` produces an honest "slow news day" edition with an empty index,
 * so a quiet window can never fabricate headlines regardless of model behaviour.
 */

import { formatEditionContext } from '../ship-biscuit.js';

const MAX_LEDE = 4000;
// Lead-story fields on the front page (LIN-1198, Theme B). A real newspaper lead
// headline is shorter than its standfirst (dek), which is in turn shorter than the
// lede — so the clamps mirror MAX_LEDE's approach but step down in length.
const MAX_FRONT_HEADLINE = 160;
const MAX_STANDFIRST = 400;
const MAX_HEADLINE = 200;
const MAX_DEK = 500;
const MAX_STUBS = 20;
const VALID_SECTIONS = ['Front Page', 'The Wire', 'Deep Dive', 'The Column', 'Weather'];

export const EDITOR_SYSTEM_PROMPT = `You are the editor-in-chief of "The Ship's Biscuit", a light in-house newspaper an engineer picks up to catch up on what an autonomous software "autopilot" has been doing over a time window. You are given a deterministic digest of the window's activity as a list of source slices, each with a stable id. Produce a FRONT PAGE and an INDEX of article stubs — headlines and one-line teasers only, NO article bodies. Write like a real newspaper or blog: short, plain, and easy to skim. Reply with a single JSON object and nothing else.

Schema:
{
  "frontPage": {
    "headline":   string,      // the lead-story headline — a real newspaper headline for the single most important thing this window. Short, plain, concrete. NOT the masthead/brand, NOT the lede reworded, NOT a slogan. Obey the short-not-shouty rule below.
    "standfirst": string,      // OPTIONAL. A short bridging sentence (a "dek"/standfirst) that sits under the headline and leads into the lede. One plain sentence. Omit it (or leave empty) if it would just repeat the headline or lede.
    "lede": string   // 1-2 short paragraphs for the front page. Lead with the single most important thing, in plain language. Warm, readable, honest, no jargon. Ground it ONLY in the provided slices.
  },
  "index": [
    {
      "section":    string,      // one of: "The Wire" (recent/factual), "Deep Dive" (analysis), "The Column" (light/opinionated), "Weather" (by-the-numbers)
      "headline":   string,      // a short, plain headline that reads on its own — concrete, no jargon
      "dek":        string,      // a short one-line teaser under the headline (a "dek") — plain and concrete, not dense
      "weight":     number,      // 1-5; higher = more front-of-paper prominence
      "sourceRefs": [string]     // the exact ids of the source slices this article would be built from — copied verbatim from the provided list
    }
  ]
}

Rules:
- Keep it short and plain. Write the way a real newspaper or blog would for a reader skimming in a hurry: short sentences, everyday words, no jargon or filler. Brevity must come from the writing itself — never from padding, and never trust length limits to trim for you (they cut mid-sentence).
- The front-page "headline" is a real headline, not a shout: keep it short and plain — no ALL-CAPS, no exclamation-mark spam, no clickbait. It must be distinct from the lede (not the lede reworded) and grounded in the slices. "standfirst" is optional — include it only when it genuinely bridges the headline into the lede; omit it otherwise.
- Ground EVERYTHING in the provided source slices. Never invent events, tasks, headlines, or numbers that the slices do not evidence.
- "sourceRefs" MUST be exact ids from the provided list (e.g. "session:abc", "status:def"). An article with no real source id is not allowed.
- Do NOT write article bodies. Headlines + deks + section + weight + sourceRefs only. The bodies are generated later, on demand.
- Order the index by weight (most prominent first). A quiet window should have few, honest stubs — never padded.
- If the digest says there is NO activity (a slow news day), return a short honest headline + lede saying so (omit the standfirst) and an EMPTY index. Do not fabricate a paper.
- "weight" is a number 1-5. "section" must be one of the four listed values.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

/**
 * Build the messages array for the editor-in-chief call.
 * @param {Object} model - buildEditionModel output.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildEditorMessages(model) {
  return [
    { role: 'system', content: EDITOR_SYSTEM_PROMPT },
    { role: 'user', content: formatEditionContext(model) }
  ];
}

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function normalizeSection(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return VALID_SECTIONS.includes(v) ? v : 'The Wire';
}

function normalizeWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/**
 * Pull a JSON object out of a raw model reply, tolerating code fences and prose
 * around it (mirrors lib/next-run.js extractJsonObject).
 * @param {string} raw
 * @returns {Object|null}
 */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    text = text.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse a raw editor reply into a normalized edition body, resolving each stub's
 * `sourceRefs` ids back to the model's full SourceRef objects (headline + content
 * snapshot) so the durable edition carries its grounding BY VALUE (§B). Stubs that
 * reference no known source id are dropped (grounding guard). Deterministic stub ids
 * are assigned in order (`art-1`, `art-2`, …). Never throws — a malformed reply
 * yields an empty index, and the caller can fall back to the quiet edition. The
 * lead-story `headline`/`standfirst` are clamped like `lede`; `standfirst` is optional
 * and defaults to '' when absent (LIN-1198).
 *
 * @param {string} raw - Raw model text.
 * @param {Object} model - buildEditionModel output (source of id → SourceRef).
 * @returns {{ frontPage: { headline: string, standfirst: string, lede: string }, index: Array }}
 */
export function parseEditorResponse(raw, model) {
  const byId = new Map((model?.sources || []).map(s => [s.id, s]));
  const parsed = extractJsonObject(raw);
  if (!parsed) return { frontPage: { headline: '', standfirst: '', lede: '' }, index: [] };

  const fp = parsed.frontPage ?? {};
  // Lead-story fields (LIN-1198). headline/standfirst clamp exactly like lede does
  // (clampText); standfirst is optional, so an absent field is simply the empty string.
  const headline = clampText(fp.headline ?? parsed.headline, MAX_FRONT_HEADLINE);
  const standfirst = clampText(fp.standfirst ?? parsed.standfirst, MAX_STANDFIRST);
  const lede = clampText(fp.lede ?? parsed.lede, MAX_LEDE);

  const rawIndex = Array.isArray(parsed.index) ? parsed.index : [];
  const index = [];
  for (const item of rawIndex) {
    const headline = clampText(item?.headline, MAX_HEADLINE);
    if (!headline) continue;
    // Resolve + validate sourceRefs against the real model ids; drop hallucinated ones.
    const ids = Array.isArray(item?.sourceRefs) ? item.sourceRefs : [];
    const seen = new Set();
    const sourceRefs = [];
    for (const id of ids) {
      if (typeof id !== 'string' || seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      const src = byId.get(id);
      // Snapshot BY VALUE so the stub stays grounded after the source TTLs out (§B).
      sourceRefs.push({ id: src.id, kind: src.kind, headline: src.headline, snapshot: src.snapshot });
    }
    // A stub with no resolvable source is ungrounded — drop it.
    if (sourceRefs.length === 0) continue;
    index.push({
      id: `art-${index.length + 1}`,
      section: normalizeSection(item?.section),
      headline,
      dek: clampText(item?.dek, MAX_DEK),
      weight: normalizeWeight(item?.weight),
      sourceRefs
    });
    if (index.length >= MAX_STUBS) break;
  }
  // Stable prominence order (desc weight), preserving input order within a weight.
  index.sort((a, b) => b.weight - a.weight);
  // Re-id after sort so ids reflect final display order deterministically.
  index.forEach((stub, i) => { stub.id = `art-${i + 1}`; });

  return { frontPage: { headline, standfirst, lede }, index };
}

/**
 * Classify what a NON-QUIET editor reply amounts to (LIN-1185).
 *
 * A quiet model never reaches the LLM — the route builds the quiet edition
 * deterministically without a call. So this only ever sees the parsed body of a
 * model that HAD news to report. An empty body here therefore means the reply was
 * unusable, not that the week was quiet: the overwhelmingly common cause is a JSON
 * reply truncated by the output-token cap (`finishReason: 'length'`), which
 * `extractJsonObject` cannot parse. Returning a quiet ("slow news day") edition in
 * that case is the exact silent-degrade defect that surfaced as "week newspaper
 * returns no results" — so this reports the failure instead, letting the caller
 * surface it rather than swallow it.
 *
 * Pure; never throws. The success case (any headline, lede, or stub) is `ok: true`;
 * this widens the pre-fix degrade condition (`!lede && index.length === 0`) with
 * `hasHeadline` (LIN-1198) so a valid-but-terse headline-only edition is NOT
 * misclassified as a silent degrade-to-quiet / false "slow news day" failure, while a
 * genuinely empty reply still fails exactly as before.
 *
 * @param {{ frontPage?: { headline?: string, lede?: string }, index?: Array }} body - parseEditorResponse output.
 * @param {string|null} [finishReason] - streamChat 'done' finishReason ('length' ⇒ truncated).
 * @returns {{ ok: boolean, truncated: boolean, reason: (null|'truncated'|'unparseable') }}
 */
export function assessEditorOutcome(body, finishReason) {
  const hasHeadline = typeof body?.frontPage?.headline === 'string' && body.frontPage.headline.length > 0;
  const hasLede = typeof body?.frontPage?.lede === 'string' && body.frontPage.lede.length > 0;
  const hasIndex = Array.isArray(body?.index) && body.index.length > 0;
  if (hasHeadline || hasLede || hasIndex) return { ok: true, truncated: false, reason: null };
  const truncated = finishReason === 'length';
  return { ok: false, truncated, reason: truncated ? 'truncated' : 'unparseable' };
}

/**
 * Deterministic honest "slow news day" edition — no LLM call. Used whenever the model
 * is quiet, so quiet-window honesty is guaranteed regardless of model behaviour.
 * @param {Object} model - buildEditionModel output.
 * @returns {{ frontPage: { headline: string, standfirst: string, lede: string }, index: Array }}
 */
export function buildQuietEdition(model) {
  const days = model?.windowDays ?? 7;
  const window = days === 1 ? 'day' : `${days} days`;
  return {
    frontPage: {
      // Lead-story shape (LIN-1198): an honest headline, no standfirst (optional, and
      // there is nothing to bridge into on a slow news day).
      headline: 'A slow news day aboard',
      standfirst: '',
      lede: `A quiet ${window} aboard. Nothing crossed the wire in this window — no autopilot sessions, no status to report. A slow news day, honestly reported.`
    },
    index: []
  };
}

/**
 * Deterministic test-mode edition built from the model's real source slices (no LLM),
 * so e2e/local sessions get a grounded front page with inert headlines without an
 * OpenRouter key. Mirrors lib/next-run.js's buildMockResponse: it synthesises from the
 * SAME deterministic model the live path feeds the LLM, so mock and live share a shape.
 * For a quiet model it degrades to the honest slow-news-day edition.
 *
 * @param {Object} model - buildEditionModel output.
 * @returns {{ frontPage: { headline: string, standfirst: string, lede: string }, index: Array }}
 */
export function buildMockEdition(model) {
  if (!model || model.isQuiet) return buildQuietEdition(model);
  const sources = model.sources || [];
  const index = sources.slice(0, MAX_STUBS).map((src, i) => ({
    id: `art-${i + 1}`,
    section: src.kind === 'session' ? 'The Wire' : 'Deep Dive',
    headline: src.headline,
    dek: src.kind === 'session'
      ? `The autopilot ${src.snapshot?.outcome || 'was dispatched'}.`
      : `Status update on ${src.snapshot?.taskIdentifier || 'the work'}.`,
    weight: src.weight,
    sourceRefs: [{ id: src.id, kind: src.kind, headline: src.headline, snapshot: src.snapshot }]
  }));
  index.sort((a, b) => b.weight - a.weight);
  index.forEach((stub, i) => { stub.id = `art-${i + 1}`; });
  const total = model.counts.total;
  // Lead story derived from the same deterministic model the live path feeds the LLM,
  // so mock + quiet carry the new headline/standfirst shape identically (LIN-1198).
  const headline = `${total} item${total === 1 ? '' : 's'} crossed the wire`;
  const standfirst = `${model.counts.sessions} autopilot session(s) and ${model.counts.status} status update(s) over the last ${model.windowDays} day(s).`;
  const lede = `${total} item${total === 1 ? '' : 's'} crossed the wire over the last ${model.windowDays} day(s): `
    + `${model.counts.sessions} autopilot session(s) and ${model.counts.status} status update(s). The headlines below lead the edition.`;
  return { frontPage: { headline, standfirst, lede }, index };
}
