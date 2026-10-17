import { spawnSync } from 'node:child_process';
const [repo, ...commits] = process.argv.slice(2);
const inScope = (p) => /\.m?js$/.test(p) && !/\.min\.js$/.test(p) && (p === 'server.js' || /^(lib|routes|public)\//.test(p));
const all = new Set();
for (const c of commits) for (const p of spawnSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', c]).stdout.toString().split('\n')) if (inScope(p)) all.add(p);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
process.stdout.write(JSON.stringify({ areas: [...all].sort().map((p) => ({ name: p, match: [`^${esc(p)}$`] })) }));
