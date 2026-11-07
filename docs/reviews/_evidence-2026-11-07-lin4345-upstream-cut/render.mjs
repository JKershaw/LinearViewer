// node render.mjs <worktree> <kind> <issue.json> <out>   (#2348's harness, with the stage kind as an argument)
process.env.NODE_ENV = 'test';
import { readFileSync, writeFileSync } from 'node:fs';
const [wt, kind, issuePath, out] = process.argv.slice(2);
const { generatePrompt } = await import(`${wt}/lib/prompt-templates.js`);
const issue = { id: 'replay', state: { name: 'In Progress', type: 'started' }, ...JSON.parse(readFileSync(issuePath, 'utf8')), comments: [] };
const context = { parent: null, siblings: [], project: { name: 'Harbour' }, children: [], comments: [] };
writeFileSync(out, generatePrompt(kind, issue, context).prompt);
