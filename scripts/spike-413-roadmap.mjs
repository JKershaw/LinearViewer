/**
 * Research spike: confirm the roadmap "generate" HTTP 413 is caused by the
 * request body exceeding express.json({ limit: '250kb' }) (server.js:254).
 *
 * Part A — Sizing: build the real roadmap model with lib/roadmap.js across a
 *   range of workspace sizes, then measure the exact JSON payload the client
 *   sends (getRoadmapModelPayload → { velocity, milestones, criticalPaths,
 *   risks }). Reports per-field breakdown and the size at which it crosses the
 *   250 KB body limit.
 *
 * Part B — Reproduction: stand up a minimal Express app with the same
 *   express.json({ limit: '250kb' }) middleware and POST an oversized body to
 *   confirm the server returns 413 from the body parser before any route runs.
 *
 * Run: node scripts/spike-413-roadmap.mjs
 */

import express from 'express';
import {
  calculateVelocity, buildExecutionQueue, groupByProject,
  projectTimeline, findCriticalPaths, assessRisks
} from '../lib/roadmap.js';

const LIMIT_BYTES = 250 * 1024; // express '250kb' === 250 * 1024 bytes (bytes lib)

// ---------------------------------------------------------------------------
// Synthetic raw Linear issues — shaped exactly like fetchProjects() output,
// the same input server.js:1049-1062 feeds into the deterministic layer.
// ---------------------------------------------------------------------------

const LOREM =
  'Implement and verify the change end to end, including edge cases around ' +
  'auth, pagination, and error handling. Coordinate with the platform team ' +
  'before merging and update the integration docs accordingly.';

function makeWorkspace({ projects, issuesPerProject, subtaskRatio = 0.5 }) {
  const projectList = [];
  const issues = [];
  const now = Date.now();
  const day = 86400000;

  for (let p = 0; p < projects; p++) {
    const projectId = `proj_${p}`;
    projectList.push({
      id: projectId,
      name: `Project ${p} — Platform Initiative`,
      content: LOREM + ' ' + LOREM // project description (truncated to ~200 in model)
    });

    let parentId = null;
    for (let i = 0; i < issuesPerProject; i++) {
      const id = `iss_${p}_${i}`;
      const isSubtask = i > 0 && Math.random() < subtaskRatio;
      // ~30% completed (feeds recentlyCompleted + velocity), rest open
      const completed = Math.random() < 0.3;
      issues.push({
        id,
        identifier: `LIN-${p}${String(i).padStart(3, '0')}`,
        title: `Task ${i} in project ${p}: ${LOREM.slice(0, 60)}`,
        description: LOREM, // truncated to 200 chars by firstParaTruncated in the model
        state: completed
          ? { type: 'completed', name: 'Done' }
          : { type: i % 3 === 0 ? 'started' : 'unstarted', name: 'Todo' },
        priority: (i % 4) + 1,
        estimate: i % 5 === 0 ? null : (i % 5),
        assignee: i % 7 === 0 ? null : { name: `Dev ${i % 5}` },
        labels: { nodes: [{ name: 'backend' }, { name: 'p1' }] },
        project: { id: projectId, name: `Project ${p} — Platform Initiative` },
        dueDate: i % 6 === 0 ? new Date(now + 30 * day).toISOString().slice(0, 10) : null,
        parent: isSubtask && parentId ? { id: parentId } : null,
        relations: { nodes: i % 4 === 0 && i + 1 < issuesPerProject
          ? [{ type: 'blocks', relatedIssue: { id: `iss_${p}_${i + 1}` } }]
          : [] },
        createdAt: new Date(now - (40 + i) * day).toISOString(),
        completedAt: completed ? new Date(now - (i % 30) * day).toISOString() : null
      });
      if (!isSubtask) parentId = id;
    }
  }
  return { projects: projectList, issues };
}

// Build the model exactly as server.js does, then the client payload exactly
// as public/roadmap.js getRoadmapModelPayload() does.
function buildClientPayload({ projects, issues }) {
  const velocity = calculateVelocity(issues, 90);
  const executionQueue = buildExecutionQueue(issues);
  const completedIssues = issues
    .filter(i => i.state?.type === 'completed')
    .map(i => ({ // issueToRoadmapCard shape is internal; groupByProject re-cards remaining only
      ...i
    }));
  // groupByProject expects already-carded completed issues; reuse the lib import
  // by importing issueToRoadmapCard would be cleaner, but server passes carded.
  const milestones = groupByProject(executionQueue, projects,
    issues.filter(i => i.state?.type === 'completed').map(cardify));
  const timedMilestones = projectTimeline(milestones, velocity);
  const criticalPaths = findCriticalPaths(executionQueue);
  const risks = assessRisks(timedMilestones, criticalPaths, velocity);

  // Client strips executionQueue + analysis (public/roadmap.js:84-91)
  return {
    velocity,
    milestones: timedMilestones,
    criticalPaths: Object.fromEntries(criticalPaths), // JSON.stringify of a Map → {} otherwise
    risks
  };
}

// Mirror of issueToRoadmapCard (server passes carded completed issues to groupByProject)
function cardify(issue) {
  const firstPara = (s, max = 200) => {
    if (!s) return null;
    const fp = (String(s).split(/\n\s*\n/)[0] || '').trim().replace(/\s+/g, ' ');
    if (!fp) return null;
    return fp.length > max ? fp.slice(0, max - 3) + '...' : fp;
  };
  return {
    id: issue.id, identifier: issue.identifier || '', title: issue.title || '',
    description: firstPara(issue.description), stateType: issue.state?.type || 'unstarted',
    stateName: issue.state?.name || '', priority: issue.priority || 0,
    estimate: issue.estimate || null, assignee: issue.assignee?.name || null,
    labels: (issue.labels?.nodes || []).map(l => l.name),
    projectName: issue.project?.name || null, projectId: issue.project?.id || null,
    dueDate: issue.dueDate || null, parentId: issue.parent?.id || null,
    blocksIds: [], createdAt: issue.createdAt || null, completedAt: issue.completedAt || null
  };
}

function bytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

// ---------------------------------------------------------------------------
// Part A — Sizing sweep
// ---------------------------------------------------------------------------
function partA() {
  console.log('═'.repeat(70));
  console.log('PART A — Roadmap client payload size vs workspace size');
  console.log('Body limit: express.json({ limit: \'250kb\' }) = ' + kb(LIMIT_BYTES));
  console.log('═'.repeat(70));

  const scenarios = [
    { projects: 5, issuesPerProject: 20 },
    { projects: 10, issuesPerProject: 40 },
    { projects: 15, issuesPerProject: 60 },
    { projects: 20, issuesPerProject: 80 },
    { projects: 25, issuesPerProject: 100 },
    { projects: 30, issuesPerProject: 120 }
  ];

  console.log(
    '\n' +
    'projects'.padEnd(9) + 'issues'.padEnd(8) + 'total'.padEnd(8) +
    'payload'.padEnd(11) + 'milestones'.padEnd(12) + 'over 250KB?'
  );
  console.log('─'.repeat(70));

  let firstOver = null;
  for (const s of scenarios) {
    const ws = makeWorkspace(s);
    const payload = buildClientPayload(ws);
    const total = bytes(payload);
    const mSize = bytes(payload.milestones);
    const over = total > LIMIT_BYTES;
    if (over && !firstOver) firstOver = { ...s, total };
    console.log(
      String(s.projects).padEnd(9) +
      String(s.issuesPerProject).padEnd(8) +
      String(s.projects * s.issuesPerProject).padEnd(8) +
      kb(total).padEnd(11) +
      (((mSize / total) * 100).toFixed(0) + '%').padEnd(12) +
      (over ? '❌ 413' : '✓ ok')
    );
  }

  // Field breakdown at the largest scenario
  const big = makeWorkspace(scenarios[scenarios.length - 1]);
  const p = buildClientPayload(big);
  console.log('\nField breakdown (largest scenario):');
  for (const k of ['velocity', 'milestones', 'criticalPaths', 'risks']) {
    console.log('  ' + k.padEnd(15) + kb(bytes(p[k])).padStart(10) +
      '  (' + ((bytes(p[k]) / bytes(p)) * 100).toFixed(0) + '%)');
  }

  console.log('\nConclusion (A): ' + (firstOver
    ? `payload crosses ${kb(LIMIT_BYTES)} at ~${firstOver.projects} projects × ` +
      `${firstOver.issuesPerProject} issues (${kb(firstOver.total)}). ` +
      `milestones dominate → large workspaces exceed the body limit.`
    : 'no scenario exceeded the limit in this sweep.'));
  return firstOver;
}

// ---------------------------------------------------------------------------
// Part B — Reproduce the 413 from the actual middleware
// ---------------------------------------------------------------------------
async function partB() {
  console.log('\n' + '═'.repeat(70));
  console.log('PART B — Reproduce 413 from express.json({ limit: \'250kb\' })');
  console.log('═'.repeat(70));

  const app = express();
  app.use(express.json({ limit: '250kb' })); // identical to server.js:254
  let routeRan = false;
  app.post('/api/roadmap/narrative/technical', (req, res) => {
    routeRan = true; // we want to PROVE this never runs on an oversized body
    res.json({ ok: true });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/api/roadmap/narrative/technical`;

  async function post(sizeBytes) {
    // Build a valid JSON body of roughly the requested size
    const filler = 'x'.repeat(Math.max(0, sizeBytes - 20));
    const body = JSON.stringify({ roadmapModel: filler });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    let errType = null;
    try { errType = (await res.text()).slice(0, 120); } catch {}
    return { status: res.status, bodyBytes: Buffer.byteLength(body), errType };
  }

  const under = await post(200 * 1024); // 200 KB — under limit
  routeRan = false;
  const over = await post(300 * 1024);  // 300 KB — over limit

  console.log(`\n  200 KB body → HTTP ${under.status}  (route ran: ${under.status === 200})`);
  console.log(`  300 KB body → HTTP ${over.status}  (route ran this request: ${routeRan})`);
  console.log(`  300 KB response snippet: ${JSON.stringify(over.errType)}`);

  server.close();

  const confirmed = over.status === 413 && routeRan === false;
  console.log('\nConclusion (B): ' + (confirmed
    ? 'oversized body → HTTP 413 emitted by the body parser BEFORE the route ran. '
    + 'This is synchronous middleware rejection → near-instant, no LLM call.'
    : `unexpected: status=${over.status}, routeRan=${routeRan}`));
  return confirmed;
}

const over = partA();
const confirmed = await partB();

console.log('\n' + '═'.repeat(70));
console.log('SPIKE VERDICT');
console.log('═'.repeat(70));
console.log(over && confirmed
  ? 'CONFIRMED: large roadmap payloads exceed the 250 KB body limit, and the\n'
  + 'middleware rejects them with an instant 413 before any handler/LLM runs.\n'
  + 'Both the size mechanism and the failure mode are reproduced.'
  : 'INCONCLUSIVE — see section conclusions above.');
