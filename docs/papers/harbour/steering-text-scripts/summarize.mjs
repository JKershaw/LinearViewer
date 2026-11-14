// LIN-4478: the paper's git figures, from the outputs of layers.mjs and commits.mjs.
// Usage: node summarize.mjs layers.json commits.json  (writes steering-commits.csv beside commits.json)
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';

const [layersPath, commitsPath] = process.argv.slice(2);
const weeks = JSON.parse(readFileSync(layersPath, 'utf8'));
const commits = JSON.parse(readFileSync(commitsPath, 'utf8'));
const CARRIED = ['stage prompts', 'runner contract and kickoffs', 'agent API text', 'CLAUDE.md', 'area notes'];
const STEERING = [...CARRIED, 'architecture docs', 'other docs'];
const CUT = /\b(trim|cut|shorten|simplif\w*|prune|slim|shrink|remov\w*|retir\w*|delet\w*|drop\w*|consolidat\w*|dedup\w*|fold\w*|one home|once|tidy|leaner|smaller|revert\w*|one path|one source|one owner|collapse\w*)\b/i;
const kb = (b) => (b / 1024).toFixed(0);

console.log('# Weekly steering and carried text (KB), and product code (KB)');
for (const w of weeks) {
  const st = STEERING.reduce((a, l) => a + w.bytes[l], 0), ca = CARRIED.reduce((a, l) => a + w.bytes[l], 0);
  console.log(w.week, w.sha.slice(0, 9), 'steering', kb(st), 'carried', kb(ca), 'product', kb(w.bytes['product code']), 'ratio', (st / w.bytes['product code']).toFixed(2));
}
const subjectOf = (c) => /^Merge pull request/.test(c.subject)
  ? execFileSync('git', ['log', '-1', '--format=%b', c.sha], { encoding: 'utf8' }).split('\n')[0] : c.subject;

for (const [name, set] of [['steering', STEERING], ['carried', CARRIED]]) {
  const rows = [];
  for (const c of commits) {
    let net = 0, grew = 0, shrank = 0, touched = false;
    for (const l of set) { const L = c.layers[l]; if (!L) continue; touched = true; net += L.net; grew += L.grew; shrank += L.shrank; }
    if (touched) rows.push({ ...c, net, grew, shrank });
  }
  const g = rows.reduce((a, r) => a + r.grew, 0), s = rows.reduce((a, r) => a + r.shrank, 0);
  console.log(`\n# ${name}: ${commits.length} first-parent commits, ${rows.length} touch it, ${rows.filter((r) => r.net > 0).length} grow it, ${rows.filter((r) => r.net < 0).length} shrink it; added ${kb(g)} KB, removed ${kb(s)} KB, ratio ${(g / s).toFixed(2)}`);
  for (const r of rows) r.subj = subjectOf(r);
  for (const [label, lo, hi] of [['all', '0', '9'], ['to September', '0', '2026-09-30'], ['October on', '2026-10-01', '9']]) {
    const R = rows.filter((r) => r.day >= lo && r.day <= hi), C = R.filter((r) => CUT.test(r.subj));
    console.log(`  ${label}: cut-worded ${C.length} (${C.filter((r) => r.net > 0).length} grew, ${C.filter((r) => r.net < 0).length} shrank, net ${kb(C.reduce((a, r) => a + r.net, 0))} KB); other ${R.length - C.length} (net ${kb(R.filter((r) => !CUT.test(r.subj)).reduce((a, r) => a + r.net, 0))} KB)`);
  }
  console.log(`  shrinks of 1 KB or more:`);
  for (const r of rows.filter((r) => r.net <= -1024).sort((a, b) => a.net - b.net)) {
    const other = (l) => kb(commits.find((c) => c.sha === r.sha).layers[l]?.net || 0);
    console.log(`   ${r.day} ${r.sha} ${(r.net / 1024).toFixed(1)} KB | ref docs ${other('architecture docs')}+${other('other docs')} product ${other('product code')} tests ${other('tests')} | ${r.subj.slice(0, 100)}`);
  }
  if (name === 'steering') {
    const csv = ['sha,day,' + STEERING.map((l) => `"${l}"`).join(',') + ',subject'];
    for (const r of rows) csv.push([r.sha, r.day, ...STEERING.map((l) => r.layers[l]?.net || 0), JSON.stringify(r.subj)].join(','));
    writeFileSync(join(dirname(commitsPath), 'steering-commits.csv'), csv.join('\n') + '\n');
  }
}
