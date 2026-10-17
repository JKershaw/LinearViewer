import { ensureSnapshot, pinCopy } from '../../replay-kit/lib/sides.mjs';
const S = process.argv[2];
const snap = `${S}/replay-kit/snapshots/91fca7dd`;
ensureSnapshot({ sha: '91fca7dd875bc8842bcbf849ba44ea441bbd6d00', dir: snap });
const a = pinCopy({ sha: '1f8010a09f4fa281fae6e90f0736b152f992f6a0', relPath: 'lib/kpi-stats.js', outDir: `${S}/rung6b/arm/replay91/pinned/old-1f8010a0`, snapshotDir: snap });
const b = pinCopy({ sha: '91fca7dd875bc8842bcbf849ba44ea441bbd6d00', relPath: 'lib/kpi-stats.js', outDir: `${S}/rung6b/arm/replay91/pinned/new-91fca7dd`, snapshotDir: snap });
console.log(JSON.stringify({ old: a.lines, oldRw: a.rewrites.length, nw: b.lines, newRw: b.rewrites.length }));
