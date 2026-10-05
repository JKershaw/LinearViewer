// LIN-3143: render every worker template and the orchestrator kickoffs for an empty mock issue and print their fixed size (bytes, ~tokens at 4 bytes/token).
// Usage: node scripts/steady-base-render.mjs [--json]   (steady-base-render-history.mjs runs this same file against older commits)
import { readFileSync, existsSync } from 'fs';

// Deliberately minimal: an empty description, no parent, siblings, comments or
// attachments, so what is left is the template's own fixed text.
const issue = {
  identifier: 'LIN-1', title: 'x', description: '', url: '',
  state: { name: 'Todo', type: 'unstarted' }, priority: 0, labels: [],
};
const context = { comments: [], siblings: [], children: [], attachments: [] };
const root = new URL('../', import.meta.url);
const bytes = (s) => (typeof s === 'string' ? Buffer.byteLength(s) : null);
// Older commits lack some modules or exports; each row degrades to null rather than failing the run.
const tryImport = async (p) => { try { return existsSync(new URL(p, root)) ? await import(new URL(p, root).href) : {}; } catch { return {}; } };

const rows = [];
const templates = await tryImport('lib/prompt-templates.js');
for (const key of Object.keys(templates.PROMPT_TEMPLATES || {})) {
  let out = null;
  try { out = templates.generatePrompt(key, issue, context, {}); } catch {}
  rows.push([key, bytes(out?.prompt ?? out)]);
}
// The AI path: the meta-prompt a cheap model read to WRITE the worker prompt, on every recommend-and-dispatch,
// until LIN-3300; since then the routing prompt it reads to pick the stage (null where a commit lacks it).
const mp = await tryImport('lib/prompts/meta-prompt-template.js');
const sr = await tryImport('lib/stage-router.js');
const cs = await tryImport('lib/completion-signals.js');
const or = await tryImport('lib/openrouter.js');
const routerArgs = {
  issueContext: '', identifier: 'LIN-1', hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0,
  remainingCount: 0, hasComments: false, commentCount: 0, aiHints: templates.formatAIHintsForMetaPrompt?.() ?? '',
  actionVocabulary: templates.getAIRecommendationActionNames?.().join(', '), completionSignals: cs.formatAllSignalsForMetaPrompt?.() ?? '',
};
let meta = null;
try { meta = mp.buildMetaPromptTemplate?.(routerArgs); } catch {}
rows.push(['meta-prompt (AI path, per recommendation)', bytes(meta)]);
let router = null;
// Since LIN-3300's stage selector the routing prompt takes the selector's args.
try { router = sr.buildRouterPrompt?.(or.buildSelectorArgs ? or.buildSelectorArgs({ ...issue }, {}) : routerArgs); } catch {}
rows.push(['routing prompt (per recommendation)', bytes(router)]);
const ap = await tryImport('lib/prompts/autopilot-kickoff.js');
let apText = null;
try { apText = ap.buildAutopilotKickoff?.({ baseUrl: 'http://x', issue }); } catch {}
rows.push(['autopilot kickoff', bytes(typeof apText === 'object' && apText ? apText.prompt : apText)]);
const pr = await tryImport('lib/prompts/passage-runner-kickoff.js');
rows.push(['passage-runner kickoff', bytes(pr.buildPassageRunnerKickoff?.())]);
const wl = await tryImport('lib/prompts/worker-lane-kickoff.js');
rows.push(['worker-lane kickoff', bytes(wl.buildWorkerLaneKickoff?.())]);
const pp = await tryImport('lib/proxy-preamble.js');
let pre = null;
try { pre = pp.buildProxyContextPreamble?.({ baseUrl: 'http://x', token: 't', issueIdentifier: 'LIN-1' }); } catch {}
rows.push(['proxy preamble (auto-appended)', bytes(pre)]);
const file = (p) => (existsSync(new URL(p, root)) ? Buffer.byteLength(readFileSync(new URL(p, root))) : null);
rows.push(['CLAUDE.md (read on demand)', file('CLAUDE.md')]);
// Already inside the autopilot kickoff (the Handbook); listed for reference, never add it on top.
rows.push(['  of which: operating manual', file('docs/autopilot-operating-manual.md')]);

if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(rows)));
else for (const [k, b] of rows) console.log(`${k.padEnd(36)} ${String(b ?? '-').padStart(7)} bytes  ~${b == null ? '-' : Math.round(b / 4)} tokens`);
