// Shared helpers for the trial instruments. Reads COMMITTED git objects (never the working
// tree) so a measure names exactly one commit, as the essay asks.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/node-tools/node_modules/');
export const acorn = require('acorn');
export const walk = require('acorn-walk');

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.REPO || '/home/user/simple-dispatcher';

export function git(args, opts = {}) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
}
export function resolveCommit(ref) { return git(['rev-parse', ref]).trim(); }
export function listFiles(commit) { return git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean); }
export function show(commit, p) { return git(['show', `${commit}:${p}`]); }

// ---- area map: first match wins -------------------------------------------------------------
export const AREAS = JSON.parse(readFileSync(path.join(here, 'areas.json'), 'utf8'));
function globToRe(g) {
  const re = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp('^' + re + '$');
}
const compiled = AREAS.areas.map(a => ({ name: a.name, res: a.patterns.map(globToRe) }));
export function areaOf(p) {
  for (const a of compiled) if (a.res.some(r => r.test(p))) return a.name;
  return null; // unmapped: reported, never silently filed
}
export const PRODUCTION = new Set(AREAS.production);

// ---- parsing ---------------------------------------------------------------------------------
export function parse(src, onComment, onToken) {
  const opts = { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true, locations: true, onComment, onToken };
  try { return acorn.parse(src, opts); }
  catch (e) { return acorn.parse(src, { ...opts, sourceType: 'module' }); }
}

// Production JS files at a commit (root-level .js in a production area).
export function productionJs(commit) {
  return listFiles(commit).filter(p => p.endsWith('.js') && PRODUCTION.has(areaOf(p)));
}

// 90-day non-merge churn per file, window ending at the commit's own date (reproducible).
export function churn(commit, days = 90) {
  const end = git(['log', '-1', '--format=%cI', commit]).trim();
  const since = new Date(new Date(end).getTime() - days * 86400e3).toISOString();
  const out = git(['log', `--since=${since}`, '--no-merges', '--format=@@%H', '--name-only', commit]);
  const perFile = new Map(); const commitsByFile = new Map(); let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) { cur = line.slice(2); continue; }
    if (!line.trim()) continue;
    perFile.set(line, (perFile.get(line) || 0) + 1);
    if (!commitsByFile.has(line)) commitsByFile.set(line, new Set());
    commitsByFile.get(line).add(cur);
  }
  return { since, end, perFile, commitsByFile };
}
