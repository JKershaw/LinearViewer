/**
 * The script lists the renderers declare (LIN-4471): `scripts: [...]` properties and `const SCRIPTS = [...]` declarations,
 * read as text. An entry is `{ src, module }`: a string is a classic `<script src>`, `{ module: '/x.js' }` a module. Shared
 * by tests/unit/bridge-inventory.test.js and tests/unit/shared-modules.test.js, so the reader is written once.
 */
export function scriptLists(src) {
  const lists = [];
  const re = /(?:\bscripts\s*:|\bconst\s+SCRIPTS\s*=)\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const entries = [];
    const entry = /\{\s*module:\s*'([^']+)'\s*\}|'([^']+)'/g;
    let e;
    while ((e = entry.exec(m[1]))) entries.push(e[1] !== undefined ? { src: e[1], module: true } : { src: e[2], module: false });
    lists.push(entries);
  }
  return lists;
}
