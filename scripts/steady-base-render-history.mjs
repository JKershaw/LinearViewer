// LIN-3143: run steady-base-render.mjs against the last first-parent commit of each month, each in a throwaway git worktree that borrows this checkout's node_modules.
// Usage: node scripts/steady-base-render-history.mjs [rev=HEAD] [--json]
import { execFileSync } from 'child_process';
import { mkdtempSync, symlinkSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const rev = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD';
const repo = resolve(new URL('..', import.meta.url).pathname);
const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const seen = new Map();
for (const l of git(['log', '--first-parent', '--format=%H %cs', rev]).trim().split('\n')) {
  const [sha, day] = l.split(' ');
  if (!seen.has(day.slice(0, 7))) seen.set(day.slice(0, 7), sha);
}
const out = [];
for (const [month, sha] of [...seen.entries()].reverse()) {
  const dir = mkdtempSync(join(tmpdir(), 'steady-base-'));
  try {
    git(['worktree', 'add', '--detach', dir, sha]);
    symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
    copyFileSync(join(repo, 'scripts', 'steady-base-render.mjs'), join(dir, 'steady-base-render.mjs'));
    // The script resolves the repo root as its parent directory, so run it from a scripts/ copy.
    execFileSync('mkdir', ['-p', join(dir, 'scripts')]);
    copyFileSync(join(repo, 'scripts', 'steady-base-render.mjs'), join(dir, 'scripts', 'steady-base-render.mjs'));
    const json = execFileSync('node', [join(dir, 'scripts', 'steady-base-render.mjs'), '--json'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NODE_ENV: 'test' } });
    out.push({ month, sha: sha.slice(0, 8), sizes: JSON.parse(json.trim().split('\n').pop()) });
  } catch (e) {
    out.push({ month, sha: sha.slice(0, 8), sizes: null });
  } finally {
    try { git(['worktree', 'remove', '--force', dir]); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  const keys = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'autopilot kickoff', 'proxy preamble (auto-appended)', 'CLAUDE.md (read on demand)'];
  console.log(['month', 'sha', ...keys.map((k) => k.split(' ')[0])].join('\t'));
  for (const r of out) console.log([r.month, r.sha, ...keys.map((k) => r.sizes?.[k] ?? '-')].join('\t'));
}
