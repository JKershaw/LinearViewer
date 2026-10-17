// The public surface of the four modules at origin/main f4749b91, and how the
// replay treats each export.
//   html   - returns markup: exact + whitespace + normalised-DOM + contract compare
//   string - returns a short string (compared exactly, then as an HTML fragment)
//   data   - returns data: order-aware deep compare of the return value, plus
//            whether it aliases an argument
//   const  - a value export: deep compare once
// Every call also compares the ARGUMENTS after the call (input mutation is
// observable: server.js passes the same trees to orderIssuesForSwipe and then
// renderPage).

export const SURFACE = {
  render: {
    renderPage: 'html',
    renderDetailsContent: 'html',
    renderDisplayLabels: 'string',
    formatRelativeTime: 'string',
    priorityOptionsHtml: 'html',
    PRIORITY_OPTION_LABELS: 'const',
    // re-exports from lib/render-pages.js (kept by the rebuild as pass-through)
    renderLoginPage: 'html',
    renderErrorPage: 'html',
    renderUpstreamAwareErrorPage: 'html',
    renderWorkspaceNotFoundPage: 'html',
    renderOpenRouterConsentPage: 'html'
  },
  session: {
    renderSessionPage: 'html',
    renderPrLine: 'html'
  },
  swipe: {
    computeGraphFeatures: 'data',
    flattenTrees: 'data',
    isBoostableBug: 'data',
    sortIssuesForSwipe: 'data',
    computeOffPageBlockers: 'data',
    buildWhy: 'data',
    applyBlockingOrder: 'data',
    clusterByParent: 'data',
    buildFilterGroups: 'data',
    orderIssuesForSwipe: 'data',
    renderSwipePage: 'html'
  },
  settings: {
    renderSettingsPage: 'html',
    OPENROUTER_CONSENT_BLAST_RADIUS_COPY: 'const',
    AI_OPERATION_LABELS: 'const'
  }
};

export const MODULE_FILES = { render: 'lib/render.js', session: 'lib/render-session.js', swipe: 'lib/render-swipe.js', settings: 'lib/render-settings.js' };

/** Compare the export surfaces of two module sets. */
export function surfaceDiff(oldMods, newMods) {
  const out = [];
  for (const mod of Object.keys(SURFACE)) {
    const o = oldMods[mod] || {}; const n = newMods[mod] || {};
    const names = new Set([...Object.keys(o), ...Object.keys(n)]);
    for (const name of [...names].sort()) {
      const inO = name in o; const inN = name in n;
      if (inO && !inN) out.push({ module: MODULE_FILES[mod], export: name, kind: 'export-removed', severity: 'contract' });
      else if (!inO && inN) out.push({ module: MODULE_FILES[mod], export: name, kind: 'export-added', severity: 'info' });
      else if (typeof o[name] !== typeof n[name]) out.push({ module: MODULE_FILES[mod], export: name, kind: `export-type ${typeof o[name]}→${typeof n[name]}`, severity: 'contract' });
      else if (typeof o[name] === 'function' && o[name].length !== n[name].length) out.push({ module: MODULE_FILES[mod], export: name, kind: `arity ${o[name].length}→${n[name].length}`, severity: 'info' });
    }
  }
  return out;
}
