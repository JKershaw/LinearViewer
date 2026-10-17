#!/usr/bin/env node
// Self-checks for the task-page-loader replay (see ../../replay-kit/lib/selfcheck-cli.mjs).
//   node selfcheck.mjs [--n 3000] [--mutant-n 1500] [--seeds 1,2] [--only M1] [--no-test-tier]
import { runSelfcheck } from '../../replay-kit/lib/selfcheck-cli.mjs';
import { cfg } from './replay.mjs';

const mutants = [
  { id: 'M1-ready', name: 'M1 ready header accepts PR #0 as "no number" (!= null → truthy)', expect: 'detect', kind: 'return',
    pairs: [['closeOut.pr && closeOut.pr.number != null', 'closeOut.pr && closeOut.pr.number']] },
  { id: 'M2-fold', name: 'M2 orchestration rows always fold (task with only check-ins loses its stages)', expect: 'detect', kind: 'return',
    pairs: [['    if (hasWork && ORCHESTRATION_KINDS.has(s.kind)) {', '    if (ORCHESTRATION_KINDS.has(s.kind)) {']] },
  { id: 'M3-cut', name: 'M3 header sentence cut one char early (> → >=)', expect: 'detect', kind: 'return',
    pairs: [['first.length > SENTENCE_MAX_CHARS ?', 'first.length >= SENTENCE_MAX_CHARS ?']] },
  { id: 'M4-exact', name: 'M4 brief/recap hash check: any terminal child counts as exact (every → some)', expect: 'detect', kind: 'return',
    pairs: [['const exact = children.every(', 'const exact = children.some(']] },
  { id: 'M5-descend', name: 'M5 tracker read without noDescend', expect: 'detect', kind: 'storeCalls',
    pairs: [['(access.callScope, identifier, { noDescend: true })', '(access.callScope, identifier, {})']] },
  { id: 'M6-mutate', name: "M6 finished-at reverses the caller's stateTransitions in place", expect: 'detect', kind: 'input-mutation',
    pairs: [['const hit = transitions.find(', 'const hit = transitions.reverse().find(']] },
  { id: 'M7-console', name: 'M7 evidence failure logged with console.warn instead of console.error', expect: 'detect', kind: 'console',
    pairs: [["console.error('Task page evidence read failed:', err.message);", "console.warn('Task page evidence read failed:', err.message);"]] },
  { id: 'M8-clock', name: 'M8 loadTaskPage ignores the injected clock', expect: 'detect', kind: 'return',
    pairs: [['      enrichLoop, deriveSessionWaiting, now: now(),\n    });\n    return { model };\n  }\n\n  /**', '      enrichLoop, deriveSessionWaiting, now: new Date(),\n    });\n    return { model };\n  }\n\n  /**']] },
  { id: 'I1-keyorder', name: 'I1 key order only (must be info, not a difference)', expect: 'info', infoKind: 'key-order',
    pairs: [['    title,\n    issueId: resolvedIssueId,', '    issueId: resolvedIssueId,\n    title,']] },
  { id: 'I2-alias', name: "I2 session's loop copied instead of shared (aliasing only)", expect: 'info', infoKind: 'alias',
    pairs: [['      loop: faceLoop,', '      loop: { ...faceLoop },']] },
];

runSelfcheck(cfg, mutants);
