// Every bare import in the kit is declared in package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const here = new URL('./', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);

// Real import statements only (parsed, not pattern-matched), so source text held in a test fixture is not read as an import.
const specifiers = (src) => {
  const out = [];
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  simple(ast, {
    ImportDeclaration: (n) => out.push(n.source.value),
    ExportNamedDeclaration: (n) => n.source && out.push(n.source.value),
    ExportAllDeclaration: (n) => out.push(n.source.value),
    ImportExpression: (n) => n.source.type === 'Literal' && out.push(n.source.value),
  });
  return out;
};
const packageName = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);

test('every bare import in scripts/code-shape/*.mjs is declared in package.json', () => {
  const bare = new Map();
  for (const f of readdirSync(here).filter((n) => n.endsWith('.mjs'))) {
    for (const s of specifiers(readFileSync(new URL(f, here), 'utf8'))) {
      if (s.startsWith('.') || s.startsWith('/') || s.startsWith('node:') || builtinModules.includes(s)) continue;
      bare.set(packageName(s), f);
    }
  }
  assert.ok(bare.has('acorn'), 'the scan sees the acorn import');
  const undeclared = [...bare].filter(([name]) => !declared.has(name)).map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(undeclared, []);
});
