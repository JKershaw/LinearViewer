// LIN-4300 (run 5) re-run of the LIN-3825 N3 spike. Unlike run 4's spike, the messages are built by
// simple-dispatcher's real producer (heartbeat.js buildHeartbeatMessage) at its HEAD, then parsed by
// Harbour's parseHeartbeat (lib/session-telemetry.js). Reads both repos; writes nothing.
// Run from a LinearViewer checkout:
//   node docs/reviews/_evidence-2026-11-05-comprehension/comprehension-debt-heartbeat-spike.mjs <path-to-simple-dispatcher>
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseHeartbeat } from '../../../lib/session-telemetry.js';
const sd = process.argv[2];
if (!sd) { console.error('usage: … <path-to-simple-dispatcher>'); process.exit(2); }
const { buildHeartbeatMessage } = createRequire(import.meta.url)(path.resolve(sd, 'heartbeat.js'));
const base = { phase: 'executing', total: 40, sinceMs: 32000, idleMs: 0, nextMs: 60000, toolCounts: {}, windowTotal: 0 };
const cases = {
  'window with tools': { toolCounts: { Edit: 4, Bash: 2 }, windowTotal: 6 },
  'recovery': { toolCounts: { Bash: 1 }, windowTotal: 1, recovery: true },
  'no tool calls (idle)': { sinceMs: 300000 },
  'tool in flight (running)': { running: true, runningTool: 'Bash', runningMs: 180000 },
  'stalled': { stalled: true, idleMs: 1200000, lastTool: 'Bash' },
  'verifying in background': { awaitingVerify: true, verifyTask: 'npm test', idleMs: 600000 },
};
for (const [name, over] of Object.entries(cases)) {
  const m = buildHeartbeatMessage({ ...base, ...over });
  const p = parseHeartbeat(m);
  console.log(`${name}\n  producer: ${JSON.stringify(m)}\n  parsed:   ${p ? JSON.stringify({ toolCount: p.toolCount, elapsedSeconds: p.elapsedSeconds, breakdown: p.breakdown, total: p.total, state: p.state }) : 'null'}`);
}
