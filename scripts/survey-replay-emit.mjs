// LIN-3189: renders the reviewer, close-out and blind-reader prompts for one replayed ticket from survey-replay-prepare.mjs's fixed PROMPTS, as the replay handed them out.
// Usage (from the LinearViewer checkout): node scripts/survey-replay-emit.mjs <reviewer|closeout|blind|blind2> LIN-n --root <replay worktree dir> --subagents <replay session's subagents dir>
// closeout embeds the reviewer's last message, read from its "[replay LIN-n reviewer]" transcript. blind embeds the original and the
// replay diffs against the shared parent (node_modules and package-lock.json excluded), the original as A when the ticket number is
// odd; blind2, added after the pre-registration, swaps them. Prompts are written to <root>/prompts. No proxy calls.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
const [role, id] = process.argv.slice(2);
const opt = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const R = opt('--root'); const SUB = opt('--subagents');
if (!R) throw new Error('--root is required');
process.argv = [process.argv[0], 'x', '--root', R];
const log = console.log; console.log = () => {};
const { PROMPTS } = await import(join(process.cwd(), 'scripts/survey-replay-prepare.mjs'));
console.log = log;
const sel = JSON.parse(readFileSync('data/survey-replay/selection.json', 'utf8')).selected.find((s) => s.id === id);
const t = JSON.parse(readFileSync('data/survey/reliability-tracker.json', 'utf8')).list.find((x) => x.identifier === id);
const ctx = { id, repo: sel.repo, wt: join(R, id), title: t.title, description: t.description, parent: sel.merge.parent };
if (role === 'closeout') {
  if (!SUB) throw new Error('--subagents is required for closeout');
  const dir = SUB;
  let review = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const first = lines.find((e) => e.type === 'user');
    const c = first?.message?.content; const text = typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('');
    if (!text.startsWith(`[replay ${id} reviewer]`)) continue;
    for (const e of lines) if (e.type === 'assistant') { const tx = (e.message.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'); if (tx.trim()) review = tx; }
  }
  if (!review) throw new Error('no review transcript for ' + id);
  ctx.review = review;
}
if (role === 'blind' || role === 'blind2') {
  const { execFileSync } = await import('child_process');
  const repo = sel.repo === 'LinearViewer' ? process.cwd() : join(process.cwd(), '../simple-dispatcher');
  const diff = (to) => execFileSync('git', ['-C', repo, 'diff', sel.merge.parent, to, '--', '.', ':!node_modules', ':!package-lock.json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const replayHead = execFileSync('git', ['-C', join(R, id), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const original = diff(sel.merge.sha), replay = diff(replayHead);
  // blind2 (added after pre-registration): the same prompt with A and B swapped, to measure position bias.
  const originalIsA = (+id.slice(4) % 2 === 1) !== (role === 'blind2');
  Object.assign(ctx, { wt: join(R, `${id}-parent`), diffA: originalIsA ? original : replay, diffB: originalIsA ? replay : original });
}
const text = role === 'blind2' ? PROMPTS.blind(ctx).replace(`[replay ${id} blind]`, `[replay ${id} blind2]`) : PROMPTS[role](ctx);
writeFileSync(join(R, 'prompts', `${id}-${role}.md`), text);
log(`wrote ${id}-${role}.md`);
