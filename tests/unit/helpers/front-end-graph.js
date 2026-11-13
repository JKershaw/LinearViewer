/**
 * The import graph of `public/` (LIN-4471): the parse, the specifier rule and the flat-layout rule, shared by
 * tests/unit/front-end-import-layout.test.js and tests/unit/bridge-inventory.test.js. The allow-list is read from
 * SHARED_MODULES (lib/vendor-assets.js), never copied here: a second hand-kept list of leaves is the twin this check
 * exists to prevent.
 *
 * The rule a `public/` module's specifier must meet:
 *  - `./x.js`: a file directly in public/ (public/ stays flat), and it exists;
 *  - `../lib/x.js`: the served URL `/lib/x.js` is a SHARED_MODULES key, mapping to `lib/x.js`. The browser resolves
 *    `../lib/x.js` from `/page.js` to `/lib/x.js`; Node resolves it from `public/page.js` to `lib/x.js`. The same
 *    string means the same file in both places only because public/ is flat and served at the URL root.
 * Anything else (a bare specifier, an absolute one, a nested or unlisted path) is a violation.
 */
import * as acorn from 'acorn';

/** Each module-level import, re-export and literal dynamic import of `src`: `{ specifier, start }`. */
export function importSpecifiers(src, { sourceType = 'module' } = {}) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true });
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') && node.source) {
      found.push({ specifier: node.source.value, start: node.start });
    }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
      found.push({ specifier: node.source.value, start: node.start });
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast);
  return found;
}

/**
 * Violations of the layout rule for one `public/` file. `file` is its name under public/ (flat, so no slash), `publicNames`
 * the set of `.js` files directly in public/, `sharedModules` the SHARED_MODULES map (served URL -> repo path).
 */
export function importViolations({ file, src, publicNames, sharedModules }) {
  const problems = [];
  for (const { specifier, start } of importSpecifiers(src)) {
    const where = `${file}@${start}`;
    if (specifier.startsWith('./')) {
      const name = specifier.slice(2);
      if (name.includes('/')) problems.push(`${where}: "${specifier}" is nested; public/ stays flat`);
      else if (!publicNames.has(name)) problems.push(`${where}: "${specifier}" is not a file in public/`);
    } else if (specifier.startsWith('../lib/')) {
      const rest = specifier.slice('../lib/'.length);
      const url = `/lib/${rest}`;
      if (rest.includes('/')) problems.push(`${where}: "${specifier}" is nested under lib/; a leaf is one file, one route`);
      else if (sharedModules[url] !== `lib/${rest}`) problems.push(`${where}: "${specifier}" is not a SHARED_MODULES leaf (lib/vendor-assets.js)`);
    } else {
      problems.push(`${where}: "${specifier}" is not a relative ./x.js or ../lib/x.js specifier (a bare or absolute one cannot resolve in both browser and Node)`);
    }
  }
  return problems;
}
