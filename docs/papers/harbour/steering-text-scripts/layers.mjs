// LIN-4478: bytes of the text that steers Harbour's agents, by layer, at the last
// first-parent commit of each ISO week, from git history alone (blob sizes via ls-tree).
// Usage: node docs/papers/harbour/steering-text-scripts/layers.mjs [rev=HEAD] > layers.json
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 30 });

const RUNNER = /^(docs\/runner-prompt\.md|docs\/worker-lane-prompt\.md|docs\/passage-(runner|planner)-prompt\.md|docs\/autopilot-orchestrator-prompt\.md|docs\/autopilot-operating-manual[^/]*\.md|docs\/autopilot-kickoff\.md|lib\/prompts\/[^/]*kickoff[^/]*\.js|lib\/prompts\/autopilot-(manual|precedence)\.js|lib\/prompts\/flight-companion-brief\.js)$/;
const STAGE = /^(lib\/prompt-template-defs\.js|lib\/prompt-templates\.js|lib\/prompt-formatters\.js|lib\/prompt-contract\.js|lib\/prompts\/stage-kinds\.js|lib\/prompts\/meta-prompt-template\.js|lib\/stage-router\.js|lib\/prompts\/brief-writer\.js|lib\/prompts\/stage-intent\.js|lib\/prompts\/stage-catalogue\.js|lib\/prompts\/leftover-words\.js|lib\/prompts\/survey-words\.js|lib\/prompts\/blind-read-words\.js|lib\/prompts\/revision-brief\.js|lib\/completion-signals\.js)$/;
const API = /^(lib\/proxy-instructions\.js|lib\/proxy-preamble\.js)$/;

export function layerOf(p) {
  if (p === 'CLAUDE.md') return 'CLAUDE.md';
  if (STAGE.test(p)) return 'stage prompts';
  if (RUNNER.test(p)) return 'runner contract and kickoffs';
  if (API.test(p)) return 'agent API text';
  if (!p.endsWith('.md')) {
    if (/^(lib|routes|public)\/.*\.(js|mjs|css|html)$/.test(p) || p === 'server.js') return 'product code';
    if (/^tests\/.*\.(js|mjs)$/.test(p)) return 'tests';
    return null;
  }
  if (p.startsWith('docs/areas/')) return 'area notes';
  if (p.startsWith('docs/architecture/')) return 'architecture docs';
  if (p.startsWith('docs/papers/')) return 'papers';
  if (p.startsWith('docs/archive/')) return 'archived docs';
  if (p.startsWith('docs/reviews/')) return 'periodical reports';
  if (p.startsWith('docs/plans/') || p.startsWith('plans/')) return 'plans';
  if (p.startsWith('docs/')) return 'other docs';
  if (p.startsWith('plans/')) return 'plans';
  return null;
}

export const LAYERS = ['stage prompts', 'runner contract and kickoffs', 'agent API text', 'CLAUDE.md', 'area notes', 'architecture docs', 'other docs', 'papers', 'periodical reports', 'plans', 'archived docs', 'product code', 'tests'];

function weekly(rev) {
  const byWeek = new Map();
  for (const l of git('log', '--first-parent', '--format=%H %cs', rev).trim().split('\n')) {
    const [sha, day] = l.split(' ');
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    if (!byWeek.has(wk)) byWeek.set(wk, { sha, day });
  }
  return [...byWeek.entries()].reverse().map(([week, v]) => ({ week, ...v }));
}

export function sizes(sha) {
  const out = Object.fromEntries(LAYERS.map((l) => [l, 0]));
  for (const line of git('ls-tree', '-r', '-l', sha).split('\n')) {
    const m = line.match(/^\S+ blob \S+\s+(\d+)\t(.+)$/);
    if (!m) continue;
    const l = layerOf(m[2]);
    if (l) out[l] += Number(m[1]);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rev = process.argv[2] || 'HEAD';
  console.log(JSON.stringify(weekly(rev).map((w) => ({ ...w, bytes: sizes(w.sha) }))));
}
