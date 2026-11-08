#!/usr/bin/env node
/**
 * LIN-4358: replay a brief against a live model, twice, and say what happened.
 *
 * 1. The 7 Nov 2026 request exactly: a bare `max_tokens: 3000`, no reasoning field,
 *    no catalog sizing (`allowPartial`, cold catalog). Prints finish_reason,
 *    completion and reasoning tokens: this is the experiment that says why Haiku 5.5
 *    stopped at ~400 visible tokens on LIN-4352 (hidden reasoning, a provider error, or
 *    a dropped stream).
 * 2. Today's call layer: the live catalog warmed, then `generateBrief` as the routes run
 *    it (catalog-sized budget, one retry, whole or TruncatedOutputError). Prints every
 *    call-log row and the brief's size and sections.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/replay-brief.mjs <snapshots.json> [model]
 *
 * <snapshots.json> is the body of GET /api/proxy/issues/<id>/snapshots (the newest
 * snapshot is replayed; pass `?limit=` to pick). The model defaults to
 * anthropic/claude-haiku-5.5. Spends two or three model calls on the caller's key.
 */
import fs from 'node:fs';
import { streamChat, setLlmCallRecorder } from '../lib/openrouter.js';
import { getModelCatalog, _resetCatalogCacheForTests } from '../lib/openrouter-catalog.js';
import { generateBrief, buildBriefMessages } from '../lib/brief.js';

const [snapPath, model = 'anthropic/claude-haiku-5.5'] = process.argv.slice(2);
if (!snapPath || !process.env.OPENROUTER_API_KEY) {
  console.error('Usage: OPENROUTER_API_KEY=... node scripts/replay-brief.mjs <snapshots.json> [model]');
  process.exit(2);
}

const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')).snapshots?.[0];
if (!snap?.snapshot) {
  console.error('No snapshot in that file.');
  process.exit(2);
}
const issue = { identifier: snap.taskIdentifier, ...snap.snapshot };
const context = { issue, parent: snap.snapshot.parent, children: snap.snapshot.children || [], comments: snap.snapshot.comments || [] };
const rows = [];
setLlmCallRecorder((r) => rows.push(r));
const row = (r) => `finishReason=${r.finishReason} completion=${r.completionTokens} reasoning=${r.reasoningTokens} maxTokens=${r.maxTokens}${r.retry ? ` retry=${r.retry}` : ''} provider=${r.provider}`;

console.log(`Replaying ${issue.identifier} @ ${snap.capturedAt} on ${model}`);

// 1. The old request, byte for byte: cold catalog, bare cap, partial allowed.
_resetCatalogCacheForTests();
let visible = '';
await streamChat(buildBriefMessages(issue, context), {
  model, maxTokens: 3000, temperature: 0, allowPartial: true, callMeta: { feature: 'brief-replay-bare' }
}, (type, data) => { if (type === 'token') visible += data.token; });
console.log(`\n[1] bare max_tokens 3000: ${row(rows.at(-1))}; visible ${visible.length} chars`);

// 2. Today's call layer.
const catalog = await getModelCatalog();
console.log(`\n[2] catalog warmed (${catalog.length} models); generateBrief:`);
const before = rows.length;
try {
  const { brief } = await generateBrief(issue, context, { model, callMeta: { feature: 'brief-replay' } });
  const sections = (brief.match(/^## .+$/gm) || []).join(' | ');
  console.log(`  WHOLE: ${brief.length} chars; sections: ${sections}`);
} catch (err) {
  console.log(`  REFUSED: ${err.message}`);
}
for (const r of rows.slice(before)) console.log(`  call: ${row(r)}`);
