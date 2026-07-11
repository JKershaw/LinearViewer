/**
 * lib/transcript-spend.js  (LIN-1235, Track B / D3 — the inside view)
 *
 * Pure, network-free analysis of a worker's Claude Code session transcript
 * (`~/.claude/projects/…/<sessionId>.jsonl`). Track A (`session-telemetry.js`)
 * could only COUNT tools from heartbeats and hit a wall: Bash is ~60% of calls
 * and a heartbeat can't say what a Bash call *did* (`git log` = orient?
 * `npm test` = verify? a real change?). The transcript carries the actual
 * command, file target, per-turn token usage, and tool-result bytes — exactly the
 * signal needed to split a session's spend into orientation / core / rework.
 *
 * The classifier is the load-bearing piece. Dispatched sessions run with NO
 * Grep/Glob tool (verified: a `<tool_use_error>` "No such tool available: Grep"),
 * so search routes through Bash `grep`/`find` — Bash command classification is
 * not optional, it is the whole point.
 *
 * Six classes:
 *   ORIENT   — re-grounding: Read/LS; Bash git-archaeology (log/diff/show/status/
 *              blame), file reads (cat/head/tail), search (grep/find/rg). The
 *              extraneous-load proxy this study exists to size.
 *   CORE     — the actual change: Edit/Write/MultiEdit; mutating Bash (git
 *              commit/add/push, mkdir, sed -i).
 *   VERIFY   — confirming the change: Bash matching the wall-clock CI signature
 *              (npm test, playwright, node --test, tsc, gh pr checks, build).
 *   COORD    — coordination/reporting, NOT task work: mcp__*, ToolSearch,
 *              WebFetch, and — critically — proxy/api curls (the appended
 *              proxy-context block makes workers curl the proxy heavily).
 *   SCAFFOLD — pure shell plumbing with no information content (echo/cd/export).
 *   UNKNOWN  — unrecognised Bash (python3 one-offs, novel tools). Kept DISTINCT
 *              so it is never silently miscounted as orientation.
 *
 * Orientation ratio is reported THREE ways (LIN-1235 decision): by tool-count
 * (comparable to Track A's 18%), by tool-result bytes (context ingested — the
 * headline "load" measure), and by the output tokens of the issuing turns. The
 * spread between them IS the D2↔D3 calibration.
 */

// ─── the CI/verify signature (kept in lockstep with wall-clock-summary.js) ────
// Re-declared here rather than imported so this module stays a leaf with no
// coupling to the wall-clock analysis; the pattern is asserted equal in tests.
const VERIFY_BASH =
  /\b(npm\s+(?:run\s+)?test|npm\s+run\s+build|yarn\s+test|pnpm\s+test|playwright|vitest|jest|pytest|node\s+--test|tsc\b|typecheck|gh\s+(?:pr\s+)?checks|actions\/runs|workflow\s+run|eslint|\blint\b|\bbuild\b)/i;

// Proxy / control-plane calls — coordination, never orientation. Anchored to the
// proxy host + api path so a bare word like "dispatch" in prose can't match.
const COORD_BASH = /(projects\.jkershaw\.com|\/api\/proxy\/|\/api\/dispatch\/)/i;

// Mutating filesystem / git — a real change, so CORE.
const CORE_BASH =
  /\b(git\s+(?:commit|add|push|apply|restore|reset|stash|merge|rebase)|git\s+checkout\s+-b|mkdir|sed\s+-i|patch\s|npm\s+install|npm\s+ci)\b/i;

// Orientation Bash: git archaeology, file reads, search, tree/stat.
const ORIENT_BASH =
  /\b(git\s+(?:log|status|diff|show|blame|branch|remote)|ls|cat|find|grep|rg|head|tail|tree|wc|which|stat|file|diff)\b/i;

// Pure scaffolding: only echo/cd/export/pwd/true/sleep/source with no real verb.
const SCAFFOLD_BASH = /^(?:\s*(?:echo|cd|export|pwd|true|:|sleep|source|set)\b[^&|;]*(?:[&|;]+\s*)?)+$/i;

/**
 * Classify one Bash command by its dominant intent. Order matters: a proxy curl
 * dominates (COORD) even if the line also greps; verify beats generic mutation;
 * a real verb beats scaffolding.
 * @param {string} command
 * @returns {{cls: string, kind: 'bash'}}
 */
function classifyBash(command) {
  const c = typeof command === 'string' ? command : '';
  let cls;
  if (COORD_BASH.test(c)) cls = 'COORD';
  else if (VERIFY_BASH.test(c)) cls = 'VERIFY';
  else if (CORE_BASH.test(c)) cls = 'CORE';
  else if (ORIENT_BASH.test(c)) cls = 'ORIENT';
  else if (SCAFFOLD_BASH.test(c.trim())) cls = 'SCAFFOLD';
  else cls = 'UNKNOWN';
  return { cls, kind: 'bash' };
}

const NAMED = {
  Read: 'ORIENT', LS: 'ORIENT', Grep: 'ORIENT', Glob: 'ORIENT', NotebookRead: 'ORIENT',
  Edit: 'CORE', Write: 'CORE', MultiEdit: 'CORE', NotebookEdit: 'CORE',
  WebFetch: 'COORD', WebSearch: 'COORD', ToolSearch: 'COORD',
  Task: 'COORD', Agent: 'COORD',
};

/**
 * Classify a single tool_use into a spend class.
 * @param {string} name  tool name
 * @param {Object} input tool input (carries the Bash command / file target)
 * @returns {{cls: string, kind: string}}
 */
export function classifyTool(name, input) {
  if (name === 'Bash') return classifyBash((input || {}).command);
  if (name && name.startsWith('mcp__')) return { cls: 'COORD', kind: 'mcp' };
  if (NAMED[name]) return { cls: NAMED[name], kind: 'named' };
  return { cls: 'UNKNOWN', kind: 'named' };
}

// The file target a tool acts on, when it names one.
function toolTarget(name, input) {
  const i = input || {};
  return i.file_path || i.path || i.notebook_path || null;
}

const UUID_SEG = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//gi;

/**
 * Normalise a per-session workspace-clone path to a repo-relative path so the
 * SAME logical file matches across sessions (each session runs in its own
 * `…/…-workspaces/<uuid>/…` clone, so absolute paths never collide — the H4
 * measurement trap). Returns null for session-local scratch (`tool-results/…`,
 * `.claude/…`) which is not a shareable repo read.
 * @param {string|null} p
 * @returns {string|null}
 */
export function normalizeRepoPath(p) {
  if (!p || typeof p !== 'string') return null;
  // Take the tail after the LAST uuid directory segment (the projects path
  // carries the uuid twice: …-workspaces-<uuid>/<uuid>/…).
  let rel = p;
  let last = -1, m;
  UUID_SEG.lastIndex = 0;
  while ((m = UUID_SEG.exec(p))) last = m.index + m[0].length;
  if (last >= 0) rel = p.slice(last);
  // Also handle the `-workspaces/<uuid>/` clone form (uuid not slash-wrapped at start).
  rel = rel.replace(/^.*?-workspaces\/[0-9a-f-]{36}\//i, '');
  if (/^tool-results\//.test(rel) || rel.includes('/.claude/') || rel.startsWith('.claude/')) return null;
  return rel;
}

// ─── transcript parse (tolerant, real shapes) ────────────────────────────────

function resultBytes(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const c of content) {
      if (c && typeof c === 'object' && typeof c.text === 'string') n += c.text.length;
    }
    return n;
  }
  return 0;
}

/**
 * Parse transcript JSONL lines into an ordered event stream:
 *   { type:'assistant', ts, model, usage, tools:[{id,name,input,cls,kind,target}] }
 *   { type:'result',    ts, toolUseId, bytes, isError }
 * Non-message and malformed lines are skipped without throwing.
 *
 * @param {string[]|string} lines  array of JSONL strings (or one big string)
 * @returns {Array<Object>}
 */
export function parseTranscriptLines(lines) {
  const arr = Array.isArray(lines) ? lines : String(lines || '').split('\n');
  const events = [];
  for (const line of arr) {
    if (!line || !line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = o && o.message;
    if (!m || typeof m !== 'object') continue;
    const content = Array.isArray(m.content) ? m.content : [];
    const ts = o.timestamp || null;

    if (m.role === 'assistant') {
      const tools = [];
      for (const c of content) {
        if (c && c.type === 'tool_use') {
          const { cls, kind } = classifyTool(c.name, c.input);
          tools.push({ id: c.id || null, name: c.name, input: c.input || {}, cls, kind, target: toolTarget(c.name, c.input) });
        }
      }
      events.push({ type: 'assistant', ts, model: m.model || null, usage: m.usage || null, tools });
    } else if (m.role === 'user') {
      for (const c of content) {
        if (c && c.type === 'tool_result') {
          events.push({ type: 'result', ts, toolUseId: c.tool_use_id || null, bytes: resultBytes(c.content), isError: !!c.is_error });
        }
      }
    }
  }
  return events;
}

// ─── per-session spend metrics ───────────────────────────────────────────────

const CLASSES = ['ORIENT', 'CORE', 'VERIFY', 'COORD', 'SCAFFOLD', 'UNKNOWN'];
const ratioOf = (part, whole) => (whole > 0 ? part / whole : 0);

/**
 * Roll an event stream up into a session spend profile.
 * @param {Array<Object>} events  from parseTranscriptLines
 * @param {{sessionId?: string}} [meta]
 * @returns {Object} the per-session metrics
 */
export function sessionSpend(events, meta = {}) {
  const toolCounts = Object.fromEntries(CLASSES.map((k) => [k, 0]));
  const resultBytesByClass = Object.fromEntries(CLASSES.map((k) => [k, 0]));
  const outputTokensByClass = Object.fromEntries(CLASSES.map((k) => [k, 0]));

  // Map tool_use id → its class, so a later tool_result's bytes attribute to it.
  const idClass = new Map();
  const totals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  let model = null;

  const filesReadSet = new Set();
  const filesEditedSet = new Set();
  const editSeq = []; // file paths of CORE edits, in order
  let toolsBeforeFirstCore = 0;
  let sawCore = false;
  let toolCount = 0;
  let verifyFailToEdit = 0;
  let lastResultWasFailedVerify = false;
  let firstTs = null, lastTs = null;

  for (const e of events) {
    if (e.ts) { firstTs = firstTs || e.ts; lastTs = e.ts; }

    if (e.type === 'assistant') {
      if (e.model && !model) model = e.model;
      const u = e.usage || {};
      totals.input += u.input_tokens || 0;
      totals.output += u.output_tokens || 0;
      totals.cacheCreation += u.cache_creation_input_tokens || 0;
      totals.cacheRead += u.cache_read_input_tokens || 0;

      // Attribute this turn's output tokens across the classes of tools it launched.
      const out = u.output_tokens || 0;
      const n = e.tools.length || 1;
      const share = out / n;

      for (const t of e.tools) {
        toolCounts[t.cls] += 1;
        outputTokensByClass[t.cls] += share;
        if (t.id) idClass.set(t.id, t.cls);
        toolCount += 1;

        if (!sawCore && t.cls !== 'CORE') toolsBeforeFirstCore += 1;

        if (t.cls === 'CORE') {
          sawCore = true;
          const rel = normalizeRepoPath(t.target);
          if (rel) { editSeq.push(rel); filesEditedSet.add(rel); }
          // A CORE edit immediately following a failed VERIFY = a fix loop.
          if (lastResultWasFailedVerify) verifyFailToEdit += 1;
        } else if (t.cls === 'ORIENT' && t.target) {
          const rel = normalizeRepoPath(t.target);
          if (rel) filesReadSet.add(rel);
        }
      }
      // Whether the NEXT edit counts as a fix is decided by the most recent result;
      // an assistant turn with tools resets the "just failed a verify" latch unless
      // this very turn is the fixing edit (handled above before this reset).
      if (e.tools.some((t) => t.cls !== 'VERIFY')) lastResultWasFailedVerify = false;
    } else if (e.type === 'result') {
      const cls = idClass.get(e.toolUseId) || 'UNKNOWN';
      resultBytesByClass[cls] += e.bytes || 0;
      // Track a failed verify so a following edit reads as rework.
      if (cls === 'VERIFY' && e.isError) lastResultWasFailedVerify = true;
    }
  }

  // Rework: any file edited more than once.
  const editCounts = {};
  for (const f of editSeq) editCounts[f] = (editCounts[f] || 0) + 1;
  const reworkFiles = Object.keys(editCounts).filter((f) => editCounts[f] > 1);
  const reworkEditCount = Object.values(editCounts).reduce((a, n) => a + Math.max(0, n - 1), 0);

  const totalResultBytes = CLASSES.reduce((a, k) => a + resultBytesByClass[k], 0);
  const totalOutputAttributed = CLASSES.reduce((a, k) => a + outputTokensByClass[k], 0);

  return {
    sessionId: meta.sessionId || null,
    model,
    turns: events.filter((e) => e.type === 'assistant').length,
    toolCount,
    toolCounts,
    resultBytesByClass,
    outputTokensByClass,
    totals,
    orientation: {
      byCount: ratioOf(toolCounts.ORIENT, toolCount),
      byResultBytes: ratioOf(resultBytesByClass.ORIENT, totalResultBytes),
      byOutputTokens: ratioOf(outputTokensByClass.ORIENT, totalOutputAttributed),
    },
    // Same three lenses on the non-coordination denominator (task work only), so
    // orchestration curls don't wash out the worker signal.
    orientationOfWork: {
      byCount: ratioOf(toolCounts.ORIENT, toolCount - toolCounts.COORD),
    },
    editBearing: filesEditedSet.size > 0,
    toolsBeforeFirstCore: sawCore ? toolsBeforeFirstCore : null,
    reworkFiles,
    reworkEditCount,
    verifyFailToEdit,
    filesRead: [...filesReadSet],
    filesEdited: [...filesEditedSet],
    durationMs: firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : null,
  };
}

// ─── H4: cross-session file-read overlap ─────────────────────────────────────

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export const __internal = {
  classifyBash, jaccard, CLASSES,
  VERIFY_BASH, COORD_BASH, CORE_BASH, ORIENT_BASH, SCAFFOLD_BASH,
};
