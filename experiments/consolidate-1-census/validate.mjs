// validate.mjs <repo> <census.json> — recall of the census against known-decisions.sh's signatures.
// A known decision is "rediscovered" when some census group holds >= 2 of the signature's files.
// Harbour-specific knowledge lives only here, never in census.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [repo, censusPath] = process.argv.slice(2);
const census = JSON.parse(readFileSync(censusPath, 'utf8'));
const sha = census.commit;
const SIGS = {
  terminalStates: "\\['completed', ?'canceled', ?'duplicate'\\]",
  fenceParse: 'fence = text\\.match\\(/```',
  tsParse: 'function (toMillis|toMs|_epoch)\\(',
  fmtDuration: 'function format(Duration|Elapsed)\\(',
  stampClassifier: 'decision-withdrawal-reversed',
  sessionClass: 'isStandaloneSession|isTerminalLoop',
  shipLayout: 'orderByDependency|computeProximityRings',
  segmentRank: 'SEGMENT_RANK',
  ledgerHeading: 'What CI Did Not Prove',
  pageShell: 'deployInfo: getDeployInfo\\(\\)',
  storeClear: 'async clear\\(urlKey\\)',
};
const out = {};
for (const [name, rx] of Object.entries(SIGS)) {
  const r = spawnSync('git', ['-C', repo, 'grep', '-l', '-E', rx, sha, '--', 'server.js', 'lib', 'routes', 'public'], { encoding: 'utf8' });
  const files = r.stdout.split('\n').filter(Boolean).map((l) => l.slice(sha.length + 1)).filter((f) => !/\.min\./.test(f));
  const set = new Set(files);
  const hits = census.groups
    .map((g) => ({ g, overlap: g.files.filter((f) => set.has(f)) }))
    .filter((x) => x.overlap.length >= 2)
    .sort((a, b) => b.overlap.length - a.overlap.length || a.g.fileCount - b.g.fileCount);
  const covered = new Set(hits.flatMap((h) => h.overlap));
  out[name] = {
    signatureFiles: files.length,
    rediscovered: hits.length > 0,
    coveredFiles: covered.size,
    best: hits.slice(0, 3).map((h) => ({ id: h.g.id, detector: h.g.detector, overlap: h.overlap.length, groupFiles: h.g.fileCount, decision: h.g.decision.slice(0, 120) })),
  };
}
const nonZero = Object.values(out).filter((v) => v.signatureFiles > 0);
console.log(JSON.stringify({ commit: sha, recall: `${nonZero.filter((v) => v.rediscovered).length}/${nonZero.length}`, decisions: out }, null, 1));
