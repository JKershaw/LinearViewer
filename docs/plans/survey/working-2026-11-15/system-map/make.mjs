import fs from 'node:fs';
const S = process.argv[2];
const m = JSON.parse(fs.readFileSync(S + '/map/map.json', 'utf8'));
const X = {
  'front-end-browser': { short: 'Browser code', does: 'The scripts and styles that run in the person’s browser: Home, the task page, Go and Stop, Observation, and each view’s own script.', tests: 21180, c7: 15, w: 12, imp: 0, impNote: 'Loaded by script tags from the pages, not imported.', route: 'About 20,000 lines', box: [60, 92, 250, 74] },
  'front-end-pages': { short: 'Pages', does: 'Server code that renders each page’s HTML, and the shared components the pages are built from.', tests: 25348, c7: 13, w: 15, imp: 51, route: 'About half', box: [60, 200, 250, 74] },
  'web-routes': { short: 'Web routes', does: 'The HTTP door for a person’s browser: the workspace pages and the APIs those pages call.', tests: 20419, c7: 22, w: 7, imp: 1, route: 'About two thirds', box: [340, 200, 280, 74] },
  'agent-api': { short: 'Agent API', does: 'The HTTP door for runners and agents: tokens, reading and writing issues, and asking for the next stage.', tests: 38260, c7: 39, w: 12, imp: 23, route: 'Nearly all', box: [650, 200, 290, 74] },
  'wiring': { short: 'server.js', does: 'One file that mounts every route and starts the scheduled jobs. Home’s route still runs inside it.', tests: 967, c7: 9, w: 2, imp: 0, impNote: 'It is the root. It imports 207 modules.', route: 'All', box: [340, 92, 280, 74] },
  'other-features': { short: 'Other features', does: 'Home’s view of the top task, task state and the as-asked seal. It is also where a file with no home falls.', tests: 5286, c7: 11, w: 6, imp: 21, route: 'Most', box: [60, 330, 140, 92] },
  'task-model': { short: 'Task model', does: 'Orders tasks and reads the links between them.', tests: 930, c7: 0, w: 0, imp: 7, route: 'All', box: [210, 330, 100, 92] },
  'runs-and-dispatch': { short: 'Runs and dispatch', does: 'The queue of prompts waiting for a runner, the record of each run, its evidence and close-out, and the watching of live sessions.', tests: 124529, c7: 49, w: 24, imp: 86, route: 'About half', box: [340, 330, 300, 92] },
  'llm-and-prompts': { short: 'Prompts and models', does: 'The stage selector, the prompt templates, the model client, the chat tools and the Periodicals.', tests: 51491, c7: 56, w: 14, imp: 94, route: 'About 12,000 lines', box: [670, 330, 270, 92] },
  'auth-accounts-and-workspaces': { short: 'Sign-in and workspaces', does: 'Signing in (Linear, Jira, GitHub, email), accounts, workspaces, who belongs to them, and the stored connections.', tests: 51946, c7: 5, w: 4, imp: 84, route: 'Sign-in and the gate', box: [60, 456, 225, 74] },
  'providers': { short: 'Providers', does: 'One module for each tracker (Linear, Jira, GitHub, GitHub Projects, a local store) that reads and writes its issues.', tests: 22920, c7: 7, w: 6, imp: 78, route: 'Linear and GitHub now', box: [300, 456, 200, 74] },
  'platform-and-plumbing': { short: 'Platform plumbing', does: 'Errors, feature flags, the free-tier allowance, database indexes, the secret scan and the scheduler.', tests: 7182, c7: 9, w: 7, imp: 221, route: 'All steps lean on it', box: [515, 456, 200, 74] },
  'reports-and-operator-tools': { short: 'Reports, operator tools', does: 'The KPI page, account erasure and the measuring scripts. It measures the rest and is on no step of the route.', tests: 5329, c7: 7, w: 9, imp: 5, route: 'None', box: [730, 456, 210, 74] },
};
const areas = {};
for (const [slug, a] of Object.entries(m.areas)) areas[slug] = { ...X[slug], name: a.name, lines: a.lines, files: a.files, top: a.top.map(([p, l, s]) => [p.replace(/^(lib|routes|public)\//, ''), l, s]) };
const steps = [
  ['Land on the site', ['wiring', 'front-end-pages']],
  ['Sign in. For Linear this also connects the tracker.', ['auth-accounts-and-workspaces', 'providers']],
  ['Every later request passes the workspace gate', ['wiring', 'auth-accounts-and-workspaces']],
  ['See the issues on Home', ['wiring', 'other-features', 'providers', 'task-model', 'front-end-pages', 'front-end-browser']],
  ['Open the top task and get its prompt', ['web-routes', 'llm-and-prompts', 'platform-and-plumbing']],
  ['Give it somewhere to run: runner setup and a token', ['runs-and-dispatch', 'agent-api', 'front-end-browser']],
  ['Hand over one task: Go', ['front-end-browser', 'web-routes', 'llm-and-prompts', 'runs-and-dispatch']],
  ['A runner takes it', ['runs-and-dispatch', 'agent-api']],
  ['The run works stage by stage through the agent API', ['agent-api', 'runs-and-dispatch', 'llm-and-prompts', 'providers', 'other-features']],
  ['Watch, stop and rule', ['web-routes', 'runs-and-dispatch', 'front-end-pages', 'front-end-browser']],
  ['The pull request with its evidence', ['web-routes', 'runs-and-dispatch', 'providers']],
  ['Close out: the proven merge', ['front-end-browser', 'web-routes', 'runs-and-dispatch', 'providers']],
  ['Share the result (optional)', ['web-routes']],
];
const choices = [
  ['“no frameworks, no build step”', 'A 188-line browser script in January. No reason was written beside it.', ['front-end-browser', 'front-end-pages']],
  ['An issue has Linear’s shape', 'Linear was the only tracker.', ['providers']],
  ['The ticket is the source of truth', 'One record for each job.', ['runs-and-dispatch', 'agent-api']],
  ['Every filed description is sealed as the person’s words', 'So that an ask is never retold.', ['other-features', 'llm-and-prompts']],
  ['Agents post under your account', 'Agents have no accounts of their own.', ['agent-api']],
];
const data = { areas, edges: m.edges, steps, choices, withHeader: m.withHeader, total: m.total };
const tpl = fs.readFileSync(S + '/map/page.html', 'utf8');
fs.writeFileSync(S + '/artifacts/harbour-system-map.html', tpl.replace('__DATA__', JSON.stringify(data)));
let tl = 0, tf = 0; for (const a of Object.values(areas)) { tl += a.lines; tf += a.files; }
console.log('areas', Object.keys(areas).length, 'lines', tl, 'files', tf, 'bytes', fs.statSync(S + '/artifacts/harbour-system-map.html').size);
