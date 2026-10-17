// Derive the renderer-owned DOM-contract inventory (tokens the four OLD files
// themselves emit, i.e. appear in their source) from a --inventory report.
//   node build-contract-notes.mjs work/r-cov.json > contract-inventory.json
import fs from 'node:fs';
import path from 'node:path';
import { buildConsumerIndex } from './lib/contract.mjs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const inv = r.inventory;
const src = Object.fromEntries(['render.js', 'render-session.js', 'render-swipe.js', 'render-settings.js'].map(f => [f, fs.readFileSync(path.join('pinned/origin-main', f), 'utf8')]));
const idx = buildConsumerIndex();
const all = fs.readdirSync('/home/user/LinearViewer/public').filter(f => f.endsWith('.js') && !f.endsWith('.min.js')).map(f => fs.readFileSync('/home/user/LinearViewer/public/' + f, 'utf8')).join('\n');
const tests = ['tests/helpers.js', ...fs.readdirSync('/home/user/LinearViewer/tests/e2e').map(f => 'tests/e2e/' + f), ...fs.readdirSync('/home/user/LinearViewer/tests/unit').map(f => 'tests/unit/' + f)].map(f => { try { return fs.readFileSync('/home/user/LinearViewer/' + f, 'utf8'); } catch { return ''; } }).join('\n');
const llms = fs.readFileSync('/home/user/LinearViewer/public/llms.txt', 'utf8');
const css = fs.readdirSync('/home/user/LinearViewer/public').filter(f => f.endsWith('.css')).map(f => fs.readFileSync('/home/user/LinearViewer/public/' + f, 'utf8')).join('\n');
const owners = (tok) => Object.entries(src).filter(([, s]) => s.includes(tok)).map(([f]) => f);
const camel = (a) => a.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const refs = (tok, forms) => ({ js: forms.some(f => all.includes(f)), css: forms.some(f => css.includes(f)), llms: forms.some(f => llms.includes(f)), tests: forms.some(f => tests.includes(f)) });
const out = { dataAttributes: [], testids: [], ids: [], classes: [] };
const ownersRe = (tok) => Object.entries(src).filter(([, s]) => new RegExp(tok.replace(/[-]/g, '\\-') + '(?![a-z-])').test(s)).map(([f]) => f);
for (const a of inv.dataAttributes) { const o = ownersRe(a.token); if (o.length) out.dataAttributes.push({ token: a.token, files: o, ...refs(a.token, [a.token, `dataset.${camel(a.token)}`, `.${camel(a.token)}`]) }); }
for (const t of inv.testids) { const stem = t.token.split('N')[0].replace(/-$/, ''); const o = owners(stem.length > 3 ? stem : t.token); if (o.length) out.testids.push({ token: t.token, files: o, ...refs(t.token, [stem]) }); }
for (const t of inv.ids) { const o = owners(`id="${t.token}"`); if (o.length) out.ids.push({ token: t.token, files: o, ...refs(t.token, [t.token]) }); }
for (const c of inv.classes) { const o = owners(c.token); if (o.length && c.referencedBy.length) out.classes.push({ token: c.token, files: o, ...refs(c.token, [c.token]) }); }
out.counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
console.log(JSON.stringify(out, null, 1));
