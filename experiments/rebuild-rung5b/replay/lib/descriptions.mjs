// --descriptions <file.json>: real-text display hook. Takes an array of
// Markdown strings (task descriptions) and renders each through every path
// lib/render.js puts a description on screen:
//   desc-auth     renderDetailsContent, signed-in (the lazy /api/detail
//                 fragment): escaped first-3-lines, or the truncated view +
//                 base64 data-raw-desc the client feeds to marked/DOMPurify
//   desc-landing  renderDetailsContent, landing: the `---` prompt-block split
//                 or escaped first-3-lines
//   desc-page     renderPage: the same text as a project's content (150-char
//                 word-boundary truncation) and as an issue's description
//                 (lowercased into data-search-text)
// No server-side Markdown renderer exists in render.js at f4749b91 (the client
// renders data-raw-desc); a rebuild that adds one shows up here as a change.
import fs from 'node:fs';

export function descriptionInputs(file, deps) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list) || list.some(s => typeof s !== 'string')) throw new Error(`${file}: expected a JSON array of strings`);
  const out = [];
  list.forEach((md, i) => {
    const issue = { id: `desc-${i}`, identifier: `DESC-${i}`, title: `Description ${i}`, description: md, url: `https://linear.app/x/issue/DESC-${i}`, state: { name: 'Todo', type: 'unstarted' } };
    out.push({ id: `desc:${i}:auth`, tier: 'descriptions', module: 'render', export: 'renderDetailsContent', args: [issue, { urlKey: 'acme', provider: { __provider: 'linear' }, featureFlags: {}, section: 'project' }], descIndex: i });
    out.push({ id: `desc:${i}:landing`, tier: 'descriptions', module: 'render', export: 'renderDetailsContent', args: [issue, { isLanding: true }], descIndex: i });
    const project = { id: `proj-${i}`, name: `Project ${i}`, content: md, url: 'https://linear.app/x/project/p', sortOrder: 1 };
    const w = deps.worldTrees([{ ...issue, project: { id: project.id, name: project.name } }], [project], deps);
    out.push({ id: `desc:${i}:page`, tier: 'descriptions', module: 'render', export: 'renderPage', args: [w.trees, w.inProgressTrees, w.recentActivityTrees, 'Org', { urlKey: 'acme', workspaces: [{ id: 'w', urlKey: 'acme', name: 'Acme' }] }], descIndex: i });
  });
  return { inputs: out, count: list.length };
}
