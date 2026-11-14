// Which comments in the lanes' snapshot does Harbour's classifier read as a person's word?
// For docs/papers/harbour/lanes-across-the-seam.md (LIN-4480), finding 4.
//
// Re-run:  git worktree add /tmp/lv-fb358 fb358dbda
//          node person-comments.mjs /tmp/lv-fb358 ../lanes-across-the-seam-evidence/issues
//
// Prints every comment in the census window (13 Nov 12:08Z to 14 Nov 10:00Z) that
// isPersonComment (lib/run-trail.js) accepts and that is not a ruling. Rulings end with the
// mark the in-app route appends and are a person's word by construction. Whether each printed
// comment was in fact written by an agent is read by hand from its text and the dispatch rows.
import fs from 'fs';
import path from 'path';

const [, , checkout, dir] = process.argv;
const { isPersonComment, isRuling } = await import(path.resolve(checkout, 'lib/run-trail.js'));
const rows = [];
for (const f of fs.readdirSync(dir)) {
  const issue = JSON.parse(fs.readFileSync(path.join(dir, f)));
  for (const c of issue.comments || []) {
    if (c.createdAt < '2026-11-13T12:08' || c.createdAt >= '2026-11-14T10:00') continue;
    if (isPersonComment(c.body) && !isRuling(c.body)) {
      rows.push([c.createdAt, f.replace('.json', ''), c.id.slice(0, 8), c.body.split('\n')[0].slice(0, 90)]);
    }
  }
}
rows.sort();
for (const r of rows) console.log(r.join(' | '));
console.log(`${rows.length} non-ruling comments read as a person's`);
