// Shared plumbing for the code-shape kit (LIN-3628): scope, area map, argv, git object reads.
// No acorn here: the cores import it and each CLI loads its core through loadCore(), so a missing
// install is one clear message. The tools read committed git objects only (no checkout) and
// report measurements; none of them gates anything.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_AREAS = fileURLToPath(new URL('./areas.json', import.meta.url));

// Defaults: JavaScript minus dependencies, vendored dirs, minified files and tests.
export const DEFAULT_INCLUDE = '\\.(js|mjs|cjs)$';
export const DEFAULT_EXCLUDE = '(^|/)node_modules/|(^|/)vendor(ed)?/|\\.min\\.js$|(^|/)(tests?|__tests__)/|\\.(test|spec)\\.';

// --include / --exclude each replace only their own default; they never stack onto it.
export const compileScope = ({ include, exclude } = {}) => {
  const inc = new RegExp(include ?? DEFAULT_INCLUDE);
  const exc = new RegExp(exclude ?? DEFAULT_EXCLUDE);
  return (path) => inc.test(path) && !exc.test(path);
};

export class UsageError extends Error {}

// Area guide in the seams.mjs format. Without --areas the file beside the tool is used if present;
// an explicit path that is missing or malformed is a usage error, never a silent fallback.
export const loadAreas = (path) => {
  const explicit = path != null;
  const source = explicit ? path : DEFAULT_AREAS;
  let areaMap;
  try {
    areaMap = JSON.parse(readFileSync(source, 'utf8'));
    if (!Array.isArray(areaMap?.areas)) throw new Error('no "areas" array');
    compileGuide(areaMap);
  } catch (e) {
    if (explicit) throw new UsageError(`--areas ${path}: ${e.message}`);
    return { areaMap: null, source: null };
  }
  return { areaMap, source };
};

export const compileGuide = (areaMap) =>
  areaMap.areas.map((a) => ({ name: a.name, rx: a.match.map((m) => new RegExp(m)) }));

// The area a file belongs to; a file no area claims (or no map at all) falls under its top-level directory.
export const areaOf = (guide, path) => (guide ? guide.find((a) => a.rx.some((r) => r.test(path)))?.name : null) ?? path.split('/')[0];

// argv -> { positional, flags }. `spec` maps each flag to 'value' or 'bool'; anything else is a usage error.
export const parseArgs = (argv, spec) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const kind = spec[a];
    if (!kind) throw new UsageError(`unknown flag ${a}`);
    if (kind === 'bool') { flags[a] = true; continue; }
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    flags[a] = argv[++i];
  }
  return { positional, flags };
};

// Dynamic import of a core. Without acorn installed, say so and exit 2.
export const loadCore = async (url) => {
  try {
    return await import(url);
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && /acorn/.test(e.message)) {
      console.error('run npm install');
      process.exit(2);
    }
    throw e;
  }
};

// Runs a CLI body: usage errors and git failures exit 2 with the message, nothing else is swallowed.
export const runCli = async (main) => {
  try {
    await main();
  } catch (e) {
    if (e instanceof UsageError) { console.error(e.message); process.exit(2); }
    throw e;
  }
};

export const emitJson = (value, replacer) => process.stdout.write(`${JSON.stringify(value, replacer, 1)}\n`);

// ── git (object store only) ──────────────────────────────────────────────────
export const git = (repo, args, { input, raw = false } = {}) => {
  const r = spawnSync('git', ['-C', repo, '-c', 'core.quotepath=off', ...args], { input, maxBuffer: 1 << 30, encoding: raw ? 'buffer' : 'utf8' });
  if (r.error) throw new UsageError(`git: ${r.error.message}`);
  if (r.status !== 0) throw new UsageError(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

export const resolveCommit = (repo, commit) => git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();

export const commitDateOf = (repo, sha) => git(repo, ['show', '-s', '--format=%cI', sha]).trim();

// Blob entries (regular files only) of a commit: [{ path, oid }].
export const listBlobs = (repo, sha) =>
  git(repo, ['ls-tree', '-rz', '--full-tree', sha]).split('\0').filter(Boolean).map((rec) => {
    const tab = rec.indexOf('\t');
    const [mode, type, oid] = rec.slice(0, tab).split(' ');
    return { mode, type, oid, path: rec.slice(tab + 1) };
  }).filter((e) => e.type === 'blob' && (e.mode === '100644' || e.mode === '100755'));

// Contents of the given blobs in one cat-file call: { path: text }.
export const readBlobs = (repo, entries) => {
  const files = {};
  if (!entries.length) return files;
  const out = git(repo, ['cat-file', '--batch'], { input: Buffer.from(entries.map((e) => `${e.oid}\n`).join('')), raw: true });
  let off = 0;
  for (const e of entries) {
    const nl = out.indexOf(10, off);
    const size = Number(out.slice(off, nl).toString().split(' ')[2]);
    files[e.path] = out.slice(nl + 1, nl + 1 + size).toString('utf8');
    off = nl + 1 + size + 1;
  }
  return files;
};

// The in-scope files of a commit: { sha, commitDate, files }.
export const readCommit = (repo, commit, inScope) => {
  const sha = resolveCommit(repo, commit);
  const entries = listBlobs(repo, sha).filter((e) => inScope(e.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  return { sha, commitDate: commitDateOf(repo, sha), files: readBlobs(repo, entries) };
};

// Contents of named paths at a commit; a path absent there reads as ''.
export const readPaths = (repo, sha, paths) => {
  const have = new Map(listBlobs(repo, sha).map((e) => [e.path, e]));
  const present = paths.filter((p) => have.has(p)).map((p) => have.get(p));
  const got = readBlobs(repo, present);
  return Object.fromEntries(paths.map((p) => [p, got[p] ?? '']));
};

// Paths that differ between two commits (renames split into delete + add, so a move counts on both sides).
export const changedPaths = (repo, a, b) =>
  git(repo, ['diff', '--name-only', '--no-renames', '-z', a, b]).split('\0').filter(Boolean);

// Commits per file in the window ending at <sha>: Map<path, Set<commit>>. The file list is passed
// on stdin after `--` (so a long list cannot overflow argv) with literal pathspecs (so `[id].js` is not a glob).
export const churnByFile = (repo, sha, commitDate, days, paths) => {
  const fileCommits = new Map();
  if (!paths.length) return fileCommits;
  const since = new Date(new Date(commitDate).getTime() - days * 86400e3).toISOString();
  const log = git(repo, ['--literal-pathspecs', 'log', '--stdin', `--since=${since}`, '--format=@%H', '--name-only', '--no-renames'],
    { input: `${sha}\n--\n${paths.join('\n')}\n` });
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) cur = line.slice(1);
    else if (line && cur) { if (!fileCommits.has(line)) fileCommits.set(line, new Set()); fileCommits.get(line).add(cur); }
  }
  return fileCommits;
};

// Extract a commit's tree into an existing directory (git archive | tar -x).
export const archiveTo = (repo, sha, dir) => {
  if (spawnSync('tar', ['--version']).error) throw new UsageError('tar is not on PATH (git archive extraction needs it)');
  const archive = git(repo, ['archive', sha], { raw: true });
  const r = spawnSync('tar', ['-x', '-C', dir], { input: archive, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new UsageError(`tar -x: ${r.stderr}`);
};
