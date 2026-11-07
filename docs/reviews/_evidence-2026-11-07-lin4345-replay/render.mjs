// node render.mjs <worktree> <issue.json> <out>
process.env.NODE_ENV = 'test';
import { readFileSync, writeFileSync } from 'node:fs';
const [wt, issuePath, out] = process.argv.slice(2);
const { generatePrompt } = await import(`${wt}/lib/prompt-templates.js`);
const issue = { id: 'replay', state: { name: 'In Progress', type: 'started' }, ...JSON.parse(readFileSync(issuePath, 'utf8')), comments: [] };
const context = { parent: null, siblings: [], project: { name: 'Harbour' }, children: [], comments: [] };
writeFileSync(out, generatePrompt('review', issue, context).prompt);
