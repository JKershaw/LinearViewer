// probe-residue.mjs <repo> <sha> — validation-only probe: remaining fence-strip parses and tolerant timestamp parses.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const [repo, sha] = process.argv.slice(2);
const acorn = createRequire(`${repo}/package.json`)('acorn');
const walk = createRequire(`${repo}/package.json`)('acorn-walk');
const g = (a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
const files = g(['ls-tree', '-r', '--name-only', sha]).split('\n').filter((p) => /\.m?js$/.test(p) && !/\.min\./.test(p) && (p === 'server.js' || /^(lib|routes|public)\//.test(p)));
const fence = [], ts = [];
for (const p of files) {
  const src = g(['show', `${sha}:${p}`]);
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true, allowReturnOutsideFunction: true }); } catch { try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); } catch { continue; } }
  walk.full(ast, (n) => {
    if (!/Function/.test(n.type)) return;
    const body = src.slice(n.start, n.end);
    if (body.length > 3000) return;
    const name = n.id?.name || '';
    if (/```|\\`\\`\\`|`{3}/.test(body) && /JSON\.parse/.test(body)) fence.push(`${p}:${n.loc.start.line} ${name} (${body.split('\n').length} lines)`);
    if (/(Date\.parse|new Date\([^)]*\)\.getTime|\.getTime\(\))/.test(body) && /(Number\.isFinite|isNaN|Number\.isNaN)/.test(body) && body.split('\n').length <= 14 && !/toEpochMs\(/.test(body)) ts.push(`${p}:${n.loc.start.line} ${name} (${body.split('\n').length} lines)`);
  });
}
console.log(JSON.stringify({ sha, fenceStripJsonParsers: [...new Set(fence)], tolerantTimestampParsers: [...new Set(ts)] }, null, 1));
