// LIN-3179: shared helpers for the step-overlap survey: which step wrote each comment, text units, and the overlap measures (restated units, verbatim 6-grams, code references).
// Imported by survey-overlap-analyse.mjs and survey-overlap-digests.mjs; it does nothing when run.
import { legOf } from './survey-rules-timeline.mjs';

export const STEPS = ['description', 'research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'];
const ORCH = new Set(['autopilot', 'wake', 'blocked', 'custom', 'triage', 'periodical', 'retrospective-audit', 'scoping', 'look-into', 'bug', 'spike', 'design', 'breakdown']);
export const stepOfKind = (k) => (STEPS.includes(k) ? k : k && ORCH.has(k) ? 'orchestrator' : k ? 'other' : null);

// Which step wrote a comment: the posting session's kind where a transcript recorded the post, else the heading reader.
export function attribute(comment, postKind) {
  if (postKind) return { step: stepOfKind(postKind), how: 'transcript' };
  const h = legOf(comment.body || '');
  return { step: h === 'orchestrator' ? 'orchestrator' : h, how: 'heading' };
}

// The plan step writes its plan into the description, and research and close-out often add sections there too
// (lib/prompt-template-defs.js: plan "Document plan in description", research "Record each class … in the description").
// Split the description at its level-2 headings and give each section to the step its heading names; the rest is the ticket as filed.
export function splitDescription(desc) {
  const out = { description: [], research: [], plan: [], 'close-out': [] }; let cur = 'description';
  for (const line of String(desc || '').split('\n')) {
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      const t = h[1].toLowerCase();
      cur = /^\W*research|research (findings|outcome|update)/.test(t) ? 'research'
        : /implementation plan|^\W*plan\b|plan of record|strategy framing|scope assessment|plan-review gate|surface list|session fit/.test(t) ? 'plan'
          : /shipped|close-?out|deviations from the plan|stage progress/.test(t) ? 'close-out' : 'description';
    }
    out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

export const words = (s) => (String(s).match(/\S+/g) || []).length;
const STOP = new Set('the a an and or of to in on for is are was were be been it its this that with as at by from not no but if then so we i you they he she which what when where who how all any each per into out up down over under than too very can could should would will may might must do does did done has have had our your their them these those there here also only just more most less such via vs'.split(' '));
export const content = (s) => String(s).toLowerCase().replace(/`[^`]*`/g, (m) => ` ${m.replace(/[^a-z0-9_./:-]/g, ' ')} `).match(/[a-z0-9_./:-]{2,}/g)?.filter((w) => !STOP.has(w)) || [];

// Units: paragraphs and list items with at least 8 content words; headings, verdict lines, tables' rule lines and code fences dropped.
export function units(text) {
  const out = []; let fence = false; let buf = [];
  const flush = () => { const u = buf.join(' ').trim(); buf = []; if (content(u).length >= 8) out.push(u); };
  for (const raw of String(text).split('\n')) {
    const l = raw.trimEnd();
    if (/^\s*```/.test(l)) { fence = !fence; flush(); continue; }
    if (fence) continue;
    if (!l.trim() || /^\s*#/.test(l) || /^\s*\|?\s*:?-{3,}/.test(l)) { flush(); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*\|/.test(l)) { flush(); buf.push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '')); flush(); continue; }
    buf.push(l.trim());
  }
  flush();
  return out;
}

const jacc = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
// Share of B's units whose content-word set has Jaccard ≥ t with some unit of A (a restated unit), weighted by words.
export function restated(aText, bText, t = 0.5) {
  const A = units(aText).map((u) => new Set(content(u))); const Bu = units(bText);
  if (!A.length || !Bu.length) return null;
  let hit = 0; let all = 0;
  for (const u of Bu) { const s = new Set(content(u)); const w = words(u); all += w; if (A.some((a) => jacc(s, a) >= t)) hit += w; }
  return all ? hit / all : null;
}
// Share of B's word 6-grams that occur verbatim in A.
export function verbatim(aText, bText, n = 6) {
  const g = (s) => { const w = content(s); const out = []; for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' ')); return out; };
  const A = new Set(g(aText)); const Bg = g(bText);
  if (!A.size || !Bg.length) return null;
  return Bg.filter((x) => A.has(x)).length / Bg.length;
}
// Code references: file paths, path:line anchors, backticked identifiers and short shas.
export function refs(text) {
  const s = String(text); const out = new Set();
  for (const m of s.matchAll(/\b((?:lib|routes|public|tests?|scripts|docs|e2e)\/[\w./-]+\.\w+|[\w-]+\.(?:m?js|md|json|sh))(?::\d+)?/g)) out.add(m[1].replace(/^.*\//, (x) => x));
  for (const m of s.matchAll(/`([A-Za-z_$][\w$]{3,})(?:\(\))?`/g)) out.add(m[1]);
  return out;
}
export function refShare(aText, bText) {
  const A = refs(aText); const Bs = refs(bText);
  if (!A.size || !Bs.size) return null;
  return [...Bs].filter((x) => A.has(x)).length / Bs.size;
}

// Which of a ticket's comments entered a read's result: share of the comment's 120-character chunks found in the text.
const norm = (s) => String(s).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\s+/g, ' ');
export function seenShare(body, readText) {
  const b = norm(body); const t = norm(readText);
  if (b.length < 120) return t.includes(b.slice(0, 60)) ? 1 : 0;
  const n = Math.min(12, Math.floor(b.length / 120)); let hit = 0;
  for (let i = 0; i < n; i++) { const at = Math.floor((i * (b.length - 120)) / Math.max(1, n - 1)); if (t.includes(b.slice(at, at + 120))) hit++; }
  return hit / n;
}

export const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
export const quart = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; return [q(0.25), q(0.5), q(0.75)]; };
