// Phase 4 mechanism probe: does a distilled hand-off cut inflation while keeping
// the load-bearing constraint? Generates the INF-1 plan prompt under three upstream
// conditions — thin / raw-deep / distilled-deep — and measures word count + a
// constraint-recall judge. Proves the structural cut BEFORE building the async seam.
import { formatIssueContext } from '../../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

const KEY = process.env.OPENROUTER_API_KEY;
const GEN = 'qwen/qwen3.7-plus';
const JUDGE = 'anthropic/claude-haiku-4.5';
const K = 3;

const issue = {
  identifier: 'INF-1', createdAt: '2026-06-01T00:00:00Z', state: { name: 'In Progress', type: 'started' }, labels: [],
  title: 'Bump the dispatch item TTL from 24h to 48h',
  description: 'Change the dispatch expiry from 24 hours to 48.'
};

// Raw deep upstream — the full ~20-line research artifact (same as the harness corpus).
const RAW = `## Research findings

I traced the dispatch expiry end to end. The TTL constant DISPATCH_TTL_MS lives in lib/dispatch-store.js line 14 (\`24 * 60 * 60 * 1000\`). It is read in three places: the sweep in pruneExpired() (line 88), the poll filter in listAvailable() (line 131), and the expiry stamp written at enqueue() (line 52). The MangoDB file store persists items with an \`expiresAt\` absolute timestamp computed at write time, NOT a relative TTL — so changing the constant only affects items enqueued AFTER the change; existing rows keep their old expiry. There is a unit test tests/unit/dispatch-store.test.js that asserts \`expiresAt - createdAt === 86400000\` (line 41) and an e2e test tests/e2e/dispatch.spec.js that waits on a 24h boundary via a clock mock (line 210). The consumer docs docs/dispatch-integration.md state "Items expire after 24 hours" in two places. The proxy events log records an \`expired\` event type; no schema change needed there. Recommended approach: lift the constant to a named export, update both tests' expected value, update both doc mentions, and add a migration note that in-flight items keep the old expiry. Surface Assessment: [refactor needed: extract DISPATCH_TTL_MS to a single named export consumed by the three call sites before changing the value, so the change lands in one place].`;

// Distilled hand-off — brief-style (Current / Constraints / Changelog), ~5 lines,
// RETAINS the load-bearing constraint (in-flight rows keep old expiry).
const DISTILLED = `**Prior research (distilled hand-off):**
- Current: the 24h TTL is the constant \`DISPATCH_TTL_MS\` in lib/dispatch-store.js, read at enqueue/sweep/poll.
- Recommended: lift it to a named export; update the two tests asserting 86400000 and the two doc mentions of "24 hours".
- **Constraint (load-bearing):** items persist an absolute \`expiresAt\` computed at write time, so changing the constant only affects items enqueued AFTER the change — existing in-flight rows keep their old expiry. Add a migration note.
- Surface Assessment: refactor needed — extract DISPATCH_TTL_MS to one named export before changing the value.`;

function meta(comments) {
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments };
  const ic = formatIssueContext(issue, ctx);
  return buildMetaPromptTemplate({
    issueContext: ic, identifier: 'INF-1', hasSubtasks: false, subtaskCount: 0, completedCount: 0,
    inProgressCount: 0, remainingCount: 0, hasComments: comments.length > 0, commentCount: comments.length,
    aiHints: formatAIHintsForMetaPrompt(), actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(), focusedSubtaskId: null, featureFlags: {}
  });
}
const comment = body => [{ user: 'agent', createdAt: '2026-06-02T00:00:00Z', body }];

async function call(prompt, model, max, temp) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: temp, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  return j.choices ? j.choices[0].message.content : '__ERR__' + JSON.stringify(j).slice(0, 120);
}
const wc = s => (s.trim().match(/\S+/g) || []).length;
const body = out => { const i = out.indexOf('## Prompt'); return i >= 0 ? out.slice(i + 9) : out; };
const CONSTRAINT = 'Does this generated prompt mention that EXISTING / in-flight / already-enqueued dispatch items keep their OLD expiry, i.e. the TTL change only affects items enqueued AFTER the change? Answer ONLY YES or NO.';
async function constraintHeld(text) {
  const p = `${CONSTRAINT}\n\nGENERATED PROMPT:\n${text}\n\nAnswer:`;
  return /yes/i.test(await call(p, JUDGE, 5, 0)) ? 1 : 0;
}

async function arm(label, comments) {
  const m = meta(comments);
  const outs = await Promise.all(Array.from({ length: K }, () => call(m, GEN, 2000, 0.3)));
  const ok = outs.filter(o => !o.startsWith('__ERR__'));
  const words = Math.round(ok.reduce((a, o) => a + wc(body(o)), 0) / ok.length);
  const con = (await Promise.all(ok.map(o => constraintHeld(body(o))))).reduce((a, b) => a + b, 0) / ok.length;
  return { label, words, con: +con.toFixed(2) };
}

const thin = await arm('thin', []);
const raw = await arm('raw-deep', comment(RAW));
const dis = await arm('distilled-deep', comment(DISTILLED));
console.log(`gen=${GEN}  K=${K}\n`);
console.log('upstream          words   inflation(vs thin)   constraint-recall');
for (const r of [thin, raw, dis]) {
  const infl = (r.words / thin.words).toFixed(2) + 'x';
  console.log(`${r.label.padEnd(16)}  ${String(r.words).padStart(5)}        ${infl.padStart(6)}              ${r.con}`);
}
console.log('\nWant: distilled inflation << raw inflation (toward 1.0), constraint-recall stays high.');
