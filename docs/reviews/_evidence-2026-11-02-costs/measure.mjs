// Measure local Claude Code transcripts: what the runner's walkUsage would post vs per-message truth.
import fs from 'node:fs'; import path from 'node:path';
const LV = process.argv[2]; const ROOT = process.argv[3]; const SINCE = Date.parse(process.argv[4]);
const { computeUsageCostUsd, resolveWorkerModelId, getModelRate } = await import(path.join(LV, 'lib/model-pricing.js'));
const F = ['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'];
function parse(file) {
  const msgs = new Map(); let lastModel = null; let side = 0; let rawLines = 0; let first = null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => { if (!l) return; let e; try { e = JSON.parse(l); } catch { return; }
    if (e.type !== 'assistant' || !e.message?.usage) return; rawLines++;
    if (e.isSidechain) side++; if (first === null && e.timestamp) first = Date.parse(e.timestamp);
    const u = e.message.usage; const k = e.message.id ? 'id:' + e.message.id : 'line:' + i;
    const f = Object.fromEntries(F.map(x => [x, Number(u[x]) || 0])); f.h1 = Number(u.cache_creation?.ephemeral_1h_input_tokens) || 0; f.model = e.message.model;
    const s = msgs.get(k); if (s) { for (const x of [...F, 'h1']) s[x] = Math.max(s[x], f[x]); return; }
    msgs.set(k, f); if (e.message.model) lastModel = e.message.model; });
  return { msgs: [...msgs.values()], lastModel, side, rawLines, first };
}
const toU = (t, model) => ({ model, harness: 'claude-code', inputTokens: t.input_tokens, outputTokens: t.output_tokens, cacheCreationInputTokens: t.cache_creation_input_tokens, cacheCreation1hInputTokens: t.h1, cacheReadInputTokens: t.cache_read_input_tokens });
const sum = (ms) => ms.reduce((a, m) => { for (const x of [...F, 'h1']) a[x] += m[x]; return a; }, Object.fromEntries([...F, 'h1'].map(x => [x, 0])));
function perMessageCost(ms) { let c = 0, unpriced = 0; for (const m of ms) { const v = computeUsageCostUsd({ ...toU(m, m.model), harness: 'opencode' /* per-request: tier gate applies per message */ }); if (v === null) { if (m.model !== '<synthetic>') unpriced++; } else c += v; } return { c, unpriced }; }
const out = { sessions: 0, mixedModel: 0, relayNull: 0, relayNullHaiku: 0, relayUsd: 0, truthMainUsd: 0, truthSubUsd: 0, subFiles: 0, sessionsWithSub: 0, sideInMain: 0, unpricedMsgs: 0, byModel: {}, rows: [] };
for (const d of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, d); if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue; const fp = path.join(dir, f); if (fs.statSync(fp).mtimeMs < SINCE) continue;
    const p = parse(fp); if (p.msgs.length === 0) continue; if (process.argv[5] === 'started' && !(p.first >= SINCE)) continue; out.sessions++;
    const models = new Set(p.msgs.map(m => m.model).filter(m => m && m !== '<synthetic>')); if (models.size > 1) out.mixedModel++;
    out.sideInMain += p.side;
    const relay = computeUsageCostUsd(toU(sum(p.msgs), p.lastModel));
    if (relay === null) { out.relayNull++; if (/haiku/.test(p.lastModel || '')) out.relayNullHaiku++; } else out.relayUsd += relay;
    const tm = perMessageCost(p.msgs); out.truthMainUsd += tm.c; out.unpricedMsgs += tm.unpriced;
    for (const m of p.msgs) { const k = m.model; out.byModel[k] ??= { msgs: 0, usd: 0 }; out.byModel[k].msgs++; }
    const subDir = path.join(dir, f.replace(/\.jsonl$/, ''), 'subagents'); let subUsd = 0, nsub = 0;
    if (fs.existsSync(subDir)) for (const sf of fs.readdirSync(subDir)) { if (!sf.endsWith('.jsonl')) continue; nsub++; const sp = parse(path.join(subDir, sf)); const sc = perMessageCost(sp.msgs); subUsd += sc.c; out.unpricedMsgs += sc.unpriced; for (const m of sp.msgs) { out.byModel['sub:' + m.model] ??= { msgs: 0 }; out.byModel['sub:' + m.model].msgs++; } }
    out.subFiles += nsub; if (nsub) out.sessionsWithSub++; out.truthSubUsd += subUsd;
    out.rows.push({ s: f.slice(0, 8), lastModel: p.lastModel, models: [...models], relay, main: +tm.c.toFixed(3), sub: +subUsd.toFixed(3), nsub });
  }
}
out.rows.sort((a, b) => (b.main + b.sub) - (a.main + a.sub));
console.log(JSON.stringify({ ...out, rows: out.rows.filter(r => r.relay === null || r.models.length > 1 || r.nsub > 0) }, null, 1));
