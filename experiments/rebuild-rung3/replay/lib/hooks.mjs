// Module-resolution hook (runs on the loader thread).
//
// Copies of the routes file live in a private work dir with no node_modules.
// Their relative imports are rewritten textually (lib/prepare.mjs); this hook is
// the backstop for everything else a copy imports: bare specifiers ('express')
// and any relative specifier the textual rewrite could not see. Both are
// resolved as if the importing file sat at <repo>/routes/proxy-reads.js, so
// every copy shares the exact same module instances as the harness.
//
// Every resolution is reported to the main thread (import side-effect census:
// which modules a copy's import pulled in for the first time).

let workDirUrl = null;
let repoParentUrl = null;
let port = null;

export async function initialize(data) {
  workDirUrl = data.workDirUrl;
  repoParentUrl = data.repoParentUrl;
  port = data.port;
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  let r;
  let via = 'direct';
  if (workDirUrl && parent.startsWith(workDirUrl) && !specifier.startsWith('file:') && !specifier.startsWith('node:')) {
    r = await nextResolve(specifier, { ...context, parentURL: repoParentUrl });
    via = 'hook';
  } else {
    r = await nextResolve(specifier, context);
  }
  port?.postMessage({ parent, specifier, url: r.url, via });
  return r;
}
