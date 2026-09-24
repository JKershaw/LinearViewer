#!/usr/bin/env node
/**
 * scripts/lin3014/build-measure.mjs (LIN-3014)
 *
 * Assembles the mongosh measurement script from `measure.template.js` plus
 * the captured `/kpis` pipelines (`capture-kpis.mjs`'s output) and the
 * `classify()` implementation in `lib/classify.mjs` — spliced in verbatim
 * (not hand-copied) so the unit-tested classifier and the one that actually
 * runs against production can never drift apart.
 *
 * Usage: node scripts/lin3014/build-measure.mjs <kpis-reads.ejson> <out/measure.js>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Pull the `classify` function body out of `lib/classify.mjs`'s source text
 * and drop the `export` keyword — mongosh's `--file` scripts aren't ES
 * modules, so the spliced copy must be a plain function declaration.
 *
 * @param {string} classifySource - the raw text of lib/classify.mjs
 * @returns {string}
 */
export function extractClassifyFn(classifySource) {
  const match = classifySource.match(/export function classify\([\s\S]*?\n}\n/);
  if (!match) {
    throw new Error('build-measure: could not find "export function classify(...) { ... }" in lib/classify.mjs');
  }
  return match[0].replace(/^export /, '');
}

/**
 * Splice the classify function and the captured KPI EJSON into the
 * template, replacing both placeholders.
 *
 * @param {Object} opts
 * @param {string} opts.templateSource
 * @param {string} opts.classifyFnSource - as returned by extractClassifyFn
 * @param {string} opts.kpisEjson - raw EJSON text (capture-kpis.mjs's output file contents)
 * @returns {string}
 */
export function buildMeasureScript({ templateSource, classifyFnSource, kpisEjson }) {
  if (!templateSource.includes('/* __CLASSIFY_FN__ */')) {
    throw new Error('build-measure: measure.template.js is missing the __CLASSIFY_FN__ placeholder');
  }
  if (!templateSource.includes('__KPIS_EJSON__')) {
    throw new Error('build-measure: measure.template.js is missing the __KPIS_EJSON__ placeholder');
  }
  return templateSource
    .replace('/* __CLASSIFY_FN__ */', classifyFnSource)
    .replace('__KPIS_EJSON__', JSON.stringify(kpisEjson));
}

async function main() {
  const [, , kpisPath, outPath] = process.argv;
  if (!kpisPath || !outPath) {
    console.error('usage: node scripts/lin3014/build-measure.mjs <kpis-reads.ejson> <out/measure.js>');
    process.exitCode = 1;
    return;
  }
  const classifySource = readFileSync(join(here, 'lib', 'classify.mjs'), 'utf8');
  const templateSource = readFileSync(join(here, 'measure.template.js'), 'utf8');
  const kpisEjson = readFileSync(kpisPath, 'utf8');
  const script = buildMeasureScript({
    templateSource,
    classifyFnSource: extractClassifyFn(classifySource),
    kpisEjson
  });
  writeFileSync(outPath, script);
  console.log(`wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
