// CSS measures for the Settings untangle series (LIN-3886 / LIN-3887).
// Usage: node tests/measures/css-measures.mjs [repoDir] <commit> [--dup-blocks] [--sites]  → JSON on stdout
// Reads committed git objects (public/*.css at <commit>), never the working tree. Exits 0 whatever
// the numbers are: this reports, it does not gate. Test-side only: not part of `npm test`.
//
// The rules (written down so every later move counts the same way; the parent ticket's older
// "about 860" literal and "33" button counts used a rule it never wrote down):
//
//   CSS lines         Newline count (`wc -l`) over `public/*.css`, top level only.
//   Spacing           Strip comments, then take every `padding*`, `margin*`, `gap`, `row-gap` and
//                     `column-gap` declaration. LITERAL: the value, with every `var(...)` removed,
//                     still holds a non-zero length in px, rem, em, %, vh, vw or ch. TOKEN: the value
//                     contains `var(--space-`. A declaration can be both.
//   Distinct sizes    Distinct trimmed values of `font-size` declarations, comments stripped.
//   Button classes    Distinct class names in `public/*.css` selectors containing `btn` or `button`.
//   Breakpoints       Distinct px values of `min-width` / `max-width` in `@media` preludes.
//
// Also reported, so a drift from an older count is explained and not hidden: `literalExCh` (literal
// spacing declarations whose only non-zero lengths are not `ch`), and per-width breakpoint counts.
//
// `--sites` lists every literal spacing declaration as file:line.
// `--dup-blocks` lists rule bodies of 4 or more declarations that appear byte-identically (after
// comment stripping and trimming) in 2 or more files, sorted by body: the completeness bound for
// "a rule written in several places".
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SPACING_PROP = /^(?:padding(?:-[a-z]+)*|margin(?:-[a-z]+)*|gap|row-gap|column-gap)$/;
const LENGTH = /(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vh|vw|ch)(?![a-z])/gi;

// Comments become their own newlines, so line numbers computed on the result still match the file.
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Removes every var(...) call, including nested parentheses in its fallback.
const withoutVars = (value) => {
  let out = '';
  for (let i = 0; i < value.length;) {
    if (value.startsWith('var(', i)) {
      let depth = 0;
      let j = i + 3;
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')' && --depth === 0) break;
      }
      i = j + 1;
    } else out += value[i++];
  }
  return out;
};

// Non-zero lengths in a value, as unit strings.
const nonZeroUnits = (value) => {
  const units = [];
  for (const m of value.matchAll(LENGTH)) if (parseFloat(m[1]) !== 0) units.push(m[2].toLowerCase());
  return units;
};

// [{ prop, value, index }] for every declaration whose name passes `want`.
const declarations = (css, want) => {
  const out = [];
  for (const m of css.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    const prop = m[1].toLowerCase();
    if (want(prop)) out.push({ prop, value: m[2].trim(), index: m.index });
  }
  return out;
};

const sortedCounts = (map) => Object.fromEntries([...map].sort((a, b) => a[0] - b[0]));

// files: { 'public/x.css': text }  →  the measures (a pure function of the texts).
export const measureCss = (files) => {
  const paths = Object.keys(files).sort();
  const perFileLines = {};
  let lines = 0;
  const spacing = { declarations: 0, literal: 0, literalExCh: 0, token: 0, both: 0 };
  const sizeValues = new Set();
  let sizeDeclarations = 0;
  const sizeTokens = new Set();
  const buttonClasses = new Set();
  const widths = new Map();

  for (const path of paths) {
    const raw = files[path];
    perFileLines[path] = (raw.match(/\n/g) || []).length;
    lines += perFileLines[path];
    const css = stripComments(raw);

    for (const d of declarations(css, (p) => SPACING_PROP.test(p))) {
      spacing.declarations++;
      const units = nonZeroUnits(withoutVars(d.value));
      const literal = units.length > 0;
      const token = d.value.includes('var(--space-');
      if (literal) spacing.literal++;
      if (units.some((u) => u !== 'ch')) spacing.literalExCh++;
      if (token) spacing.token++;
      if (literal && token) spacing.both++;
    }

    for (const d of declarations(css, (p) => p === 'font-size')) {
      sizeDeclarations++;
      sizeValues.add(d.value);
    }
    for (const m of css.matchAll(/(--font-size-[a-z0-9-]+)\s*:/gi)) sizeTokens.add(m[1]);

    // Selector preludes: the text before each `{`, excluding at-rules.
    for (const m of css.matchAll(/([^{};]+)\{/g)) {
      const prelude = m[1].trim();
      if (prelude.startsWith('@')) {
        if (!/^@media/i.test(prelude)) continue;
        for (const w of prelude.matchAll(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
          const px = Number(w[1]);
          if (!widths.has(px)) widths.set(px, { total: 0, files: {} });
          const slot = widths.get(px);
          slot.total++;
          slot.files[path] = (slot.files[path] || 0) + 1;
        }
        continue;
      }
      for (const c of prelude.matchAll(/\.(-?[_a-z][\w-]*)/gi)) {
        if (/btn|button/i.test(c[1])) buttonClasses.add(c[1]);
      }
    }
  }

  return {
    cssLines: { total: lines, files: paths.length, perFile: perFileLines },
    spacing,
    fontSize: { declarations: sizeDeclarations, distinct: sizeValues.size, tokens: [...sizeTokens].sort() },
    buttonClasses: { count: buttonClasses.size, names: [...buttonClasses].sort() },
    breakpoints: { distinct: widths.size, widths: sortedCounts(widths) },
  };
};

// Every LITERAL spacing declaration (the rule above) as { file, line, prop, value }: the sites behind
// the `spacing.literal` count, so a note can cite them and a later move can diff them.
export const spacingSites = (files) => {
  const out = [];
  for (const path of Object.keys(files).sort()) {
    const css = stripComments(files[path]);
    for (const d of declarations(css, (p) => SPACING_PROP.test(p))) {
      if (nonZeroUnits(withoutVars(d.value)).length) {
        // `index` is the start of the matched separator; the property name starts at the next letter.
        const at = css.indexOf(d.prop, d.index);
        out.push({ file: path, line: lineOf(css, at), prop: d.prop, value: d.value });
      }
    }
  }
  return out;
};

// Rule bodies of >= minDecls declarations repeated byte-identically in >= 2 files.
export const dupBlocks = (files, minDecls = 4) => {
  const bodies = new Map();
  for (const path of Object.keys(files).sort()) {
    const css = stripComments(files[path]);
    for (const m of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
      const body = m[2].trim();
      const count = body.split(';').filter((s) => s.trim()).length;
      if (count < minDecls) continue;
      const selector = m[1].trim().replace(/\s+/g, ' ');
      if (!bodies.has(body)) bodies.set(body, { body, declarations: count, sites: [] });
      bodies.get(body).sites.push({ file: path, line: lineOf(css, m.index + m[1].length - m[1].trimStart().length), selector });
    }
  }
  return [...bodies.values()]
    .filter((b) => new Set(b.sites.map((s) => s.file)).size >= 2)
    .sort((a, b) => (a.body < b.body ? -1 : a.body > b.body ? 1 : 0));
};

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

export const readPublicCss = (repo, commit) => {
  const sha = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  const paths = git(repo, ['ls-tree', '--name-only', sha, 'public/']).split('\n').filter((p) => /^public\/[^/]+\.css$/.test(p));
  const files = {};
  for (const p of paths) files[p] = git(repo, ['show', `${sha}:${p}`]);
  return { sha, files };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [repo, commit] = args.length >= 2 ? args : ['.', args[0]];
  if (!commit) {
    console.error('usage: node tests/measures/css-measures.mjs [repoDir] <commit> [--dup-blocks] [--sites]');
    process.exit(2);
  }
  const { sha, files } = readPublicCss(repo, commit);
  const result = { commit: sha, ...measureCss(files) };
  if (process.argv.includes('--dup-blocks')) result.dupBlocks = dupBlocks(files);
  if (process.argv.includes('--sites')) result.spacingSites = spacingSites(files);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
