// LIN-3825 N3 spike: run parseHeartbeat (lib/session-telemetry.js) over message shapes simple-dispatcher heartbeat.js buildHeartbeatMessage emits.
// Run from a LinearViewer checkout: node docs/reviews/_evidence-2026-10-23/comprehension-debt-heartbeat-spike.mjs
import { parseHeartbeat } from '../../../lib/session-telemetry.js';
for (const m of ['[working · editing] 6 tools in 32s: Edit×4, Bash×2 · 40 total','[working] no tool calls in 5m · 40 total','[working · running] Bash running for 3m','[stalled?] no activity for 20m','[working · verifying] 3 tools in 10s: Bash×3 · 9 total'])
  console.log(JSON.stringify(m), '=>', JSON.stringify(parseHeartbeat(m)));
