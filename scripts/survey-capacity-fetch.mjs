// cheaper-capacity.md: fetch the inputs survey-capacity-analyse.mjs reads, into data/survey-capacity/ (gitignored).
// Usage: HARBOUR_PROXY_TOKEN=<working token> node scripts/survey-capacity-fetch.mjs [--from 3350]
// Public: OpenRouter's model catalog and each `:free` model's endpoint list (no key needed).
// Proxy: every issue (paged), then GET /issues/{id}/cost for each Done ticket numbered --from or above (1.1 s apart; 60/min cap).
import { writeFileSync, mkdirSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg('--from', '3350'));
const OUT = 'data/survey-capacity';
const PROXY = 'https://harbour.cat/api/proxy';
const TOKEN = process.env.HARBOUR_PROXY_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, auth) => {
  const res = await fetch(url, auth ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

mkdirSync(`${OUT}/endpoints`, { recursive: true });
const models = await json('https://openrouter.ai/api/v1/models');
writeFileSync(`${OUT}/openrouter-models.json`, JSON.stringify(models));
for (const m of models.data.filter((x) => x.id.endsWith(':free'))) {
  const [author, slug] = [m.id.slice(0, m.id.indexOf('/')), m.id.slice(m.id.indexOf('/') + 1)];
  writeFileSync(`${OUT}/endpoints/${m.id.replace(/[/:]/g, '_')}.json`, JSON.stringify(await json(`https://openrouter.ai/api/v1/models/${author}/${slug}/endpoints`)));
}

if (!TOKEN) { console.error('HARBOUR_PROXY_TOKEN unset: fetched the public catalog only'); process.exit(0); }
const issues = [];
for (let after = null; ;) {
  const page = await json(`${PROXY}/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`, true);
  issues.push(...page.issues);
  if (!page.pageInfo.hasNextPage) break;
  after = page.pageInfo.endCursor;
  await sleep(1100);
}
writeFileSync(`${OUT}/issues.json`, JSON.stringify(issues));
const done = issues.filter((i) => i.state.type === 'completed' && /^LIN-\d+$/.test(i.identifier) && Number(i.identifier.slice(4)) >= FROM);
const cost = {};
for (const i of done) {
  try { cost[i.identifier] = await json(`${PROXY}/issues/${i.identifier}/cost`, true); } catch (e) { cost[i.identifier] = { error: String(e) }; }
  await sleep(1100);
}
writeFileSync(`${OUT}/cost.json`, JSON.stringify(cost));
console.log(`${models.data.length} models, ${issues.length} issues, ${done.length} cost reads`);
