// LIN-3147: tracker growth per ISO week — tickets created and closed, open pile, description and comment words — from a census of the issue list plus every 10th ticket's detail, over the local proxy at ≤15 requests/minute.
// Usage: node scripts/survey-growth-tracker.mjs fetch [cache=data/survey/tracker-cache.json]   (≈25 min)
//        node scripts/survey-growth-tracker.mjs report [cache] [--json]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';

// Every 10th identifier: created/closed dates and comments are only on the per-issue read.
export const STEP = 10;
export const isoWeek = (iso) => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
export const words = (s) => ((s || '').match(/\S+/g) || []).length;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

async function fetchAll(cachePath) {
  const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (path) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(4200); // ≈14/min: three survey sessions and a check share the proxy's 60/min
      const res = await fetch(`${B}${path}`);
      if (res.status === 429) { await sleep(30000); continue; }
      if (!res.ok) return null;
      return res.json();
    }
    return null;
  };
  mkdirSync(dirname(cachePath), { recursive: true });
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { list: null, detail: {} };
  const save = () => writeFileSync(cachePath, JSON.stringify(cache));
  if (!cache.list) {
    const list = []; let after = null;
    do {
      const page = await get(`/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (!page) throw new Error('issue list page failed');
      for (const i of page.issues) list.push({ identifier: i.identifier, state: i.state?.type, labels: i.labels, parent: i.parent?.identifier || null, descWords: words(i.description) });
      after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    cache.list = list; cache.listFetchedAt = new Date().toISOString(); save();
  }
  const max = Math.max(...cache.list.map((i) => Number(i.identifier.split('-')[1]) || 0));
  for (let n = STEP; n <= max; n += STEP) {
    const key = `LIN-${n}`;
    if (cache.detail[key] !== undefined) continue;
    const d = await get(`/issues/${key}`);
    cache.detail[key] = d && {
      createdAt: d.createdAt, completedAt: d.completedAt, canceledAt: d.canceledAt || null, state: d.state?.type,
      descWords: words(d.description),
      comments: (d.comments || []).map((c) => ({ words: words(c.body), createdAt: c.createdAt })),
    };
    save();
  }
}

export function report(cache) {
  const list = cache.list.filter((i) => /^LIN-\d+$/.test(i.identifier));
  const byState = {};
  for (const i of list) byState[i.state] = (byState[i.state] || 0) + 1;
  const sample = Object.entries(cache.detail).filter(([, d]) => d && d.createdAt);
  const weeks = new Set();
  for (const [, d] of sample) { weeks.add(isoWeek(d.createdAt)); if (d.completedAt) weeks.add(isoWeek(d.completedAt)); }
  const all = [...weeks].sort();
  // Weekly series, scaled ×STEP back to the population; "closed" = completed (Done). Canceled tickets
  // carry no close date on this read, so they leave the pile only if canceledAt is present.
  const rows = all.map((w) => {
    const end = new Date(w + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    const endIso = end.toISOString();
    const created = sample.filter(([, d]) => isoWeek(d.createdAt) === w);
    const closed = sample.filter(([, d]) => d.completedAt && isoWeek(d.completedAt) === w);
    const open = sample.filter(([, d]) => d.createdAt < endIso && !(d.completedAt && d.completedAt < endIso) && !(d.canceledAt && d.canceledAt < endIso) && !(d.state === 'canceled' && !d.canceledAt));
    const commentsInWeek = sample.flatMap(([, d]) => d.comments.filter((c) => isoWeek(c.createdAt) === w));
    return {
      week: w,
      created: created.length * STEP,
      closed: closed.length * STEP,
      openPile: open.length * STEP,
      medianDescWords: median(created.map(([, d]) => d.descWords)),
      medianCommentWordsPerTicket: median(created.map(([, d]) => d.comments.reduce((s, c) => s + c.words, 0))),
      commentWordsPosted: commentsInWeek.reduce((s, c) => s + c.words, 0) * STEP,
      sampleCreated: created.length,
    };
  });
  const capped = sample.filter(([, d]) => d.comments.length >= 50).length;
  return { population: list.length, byState, sampled: sample.length, commentsCappedAt50: capped, listFetchedAt: cache.listFetchedAt, weeks: rows };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [mode, cachePath = 'data/survey/tracker-cache.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (mode === 'fetch') await fetchAll(cachePath);
  else if (mode === 'report') {
    const out = report(JSON.parse(readFileSync(cachePath, 'utf8')));
    if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
    else {
      console.log(`population ${out.population} ${JSON.stringify(out.byState)}; sampled every ${STEP}th: ${out.sampled}; comments capped at 50: ${out.commentsCappedAt50}`);
      console.log('week        created closed openPile medDescW medCommentW/ticket commentWordsPosted');
      for (const r of out.weeks) console.log(`${r.week} ${String(r.created).padStart(7)} ${String(r.closed).padStart(6)} ${String(r.openPile).padStart(8)} ${String(r.medianDescWords).padStart(8)} ${String(r.medianCommentWordsPerTicket).padStart(18)} ${String(r.commentWordsPosted).padStart(18)}`);
    }
  } else { console.error('usage: fetch|report [cache] [--json]'); process.exit(1); }
}
