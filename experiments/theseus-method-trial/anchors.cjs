// Map mutation-gate anchors (exact substrings) to file:line at a commit, read from git objects.
const { execFileSync } = require('child_process');
const REPO = '/home/user/simple-dispatcher', C = process.argv[2] || 'HEAD';
const g = (a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const src = g(['show', `${C}:test/system/mutation/run-mutations.js`]);
const m = {}; eval(src.slice(src.indexOf('const MUTANTS'), src.indexOf('];', src.indexOf('const MUTANTS')) + 2).replace('const MUTANTS', 'm.list').replace(/\bHARBOUR\b/g, "'HARBOUR'"));
for (const x of m.list) {
  if (x.dir === 'HARBOUR') { console.log(`HARBOUR  ${x.file}  (${x.name.slice(0, 60)})`); continue; }
  let text; try { text = g(['show', `${C}:${x.file}`]); } catch { console.log(`MISSING ${x.file}`); continue; }
  const i = text.indexOf(x.find), j = text.indexOf(x.find, i + 1);
  const line = i < 0 ? 'NOMATCH' : text.slice(0, i).split('\n').length + (j >= 0 ? ' (AMBIGUOUS)' : '');
  console.log(`${x.file}:${line}  ${x.find.replace(/\s+/g, ' ').slice(0, 80)}`);
}
