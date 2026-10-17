// perturb.cjs <name> <in> <out>  -- behaviour-preserving text perturbations of lib/dispatch-entrance.js
const fs = require('fs'); const acorn = require('acorn');
const [name, inp, out] = process.argv.slice(2);
let src = fs.readFileSync(inp, 'utf8');
const once = (s, a, b) => { const i = s.indexOf(a); if (i < 0 || s.indexOf(a, i + 1) > -1) throw new Error(`anchor not unique: ${a.slice(0, 60)}`); return s.slice(0, i) + b + s.slice(i + a.length); };
// mask strings and comments with spaces (keep newlines) so word replacements only touch code
function codeMask(s) {
  const comments = []; const toks = [];
  acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments, onToken: toks });
  const keep = new Array(s.length).fill(false);
  for (const t of toks) if (t.type.label === 'name' || t.type.keyword) for (let i = t.start; i < t.end; i++) keep[i] = true;
  return keep;
}
function renameWords(s, map) {
  const keep = codeMask(s);
  return s.replace(/[A-Za-z_$][\w$]*/g, (w, off) => (map[w] && keep[off] ? map[w] : w));
}
switch (name) {
  case 'indent': // +2 spaces on every non-empty line
    src = src.split('\n').map(l => (l.length ? '  ' + l : l)).join('\n'); break;
  case 'nocomment': {
    const comments = []; acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
    const a = src.split('');
    for (const c of comments) for (let i = c.start; i < c.end; i++) if (a[i] !== '\n') a[i] = ' ';
    src = a.join(''); break;
  }
  case 'rename': // local names only (none exported, none a factory option key)
    src = renameWords(src, { isFollowUp: 'resuming', createKit: 'laneKit', kit: 'lk', STEPS: 'CHECKS', ROW_FIELDS: 'ROW_RULES', receiptFor: 'receipt', parentRun: 'parentRow', proxyContextPolicy: 'contextPolicy', rowFor: 'rowOf' }); break;
  case 'fields': // fields: row (the factory drops undefined keys)
    src = src.replace(/        fields: \{\n(          \w+: row\.\w+,?\n)+        \}\n/, '        fields: row\n'); if (!/fields: row\n/.test(src)) throw new Error('fields anchor'); break;
  case 'callshape': // build the factory argument first, then call
    src = once(src, '      const item = await createDispatchItem({\n        store: dispatchQueueStore,', '      const factoryArgs = {\n        store: dispatchQueueStore,');
    src = once(src, '          issueSource: row.issueSource\n        }\n      });\n      return item;', '          issueSource: row.issueSource\n        }\n      };\n      return createDispatchItem(factoryArgs);'); break;
  case 'declared': { // one declaration builder instead of two literals
    const a = src.indexOf("                ...(declare === 'M1'"); const b = src.indexOf('                    : {})\n', a);
    if (a < 0 || b < 0) throw new Error('declared anchor');
    src = src.slice(0, a) + "                ...declaration(declare, req, ctx)\n" + src.slice(b + '                    : {})\n'.length);
    src = once(src, 'const attachFailed = () =>', "const declaration = (site, req, ctx) => (site ? {\n  declaredGrants: ['dispatch'],\n  declaredSite: site,\n  grantOwnerAccountId: site === 'M1' ? req.proxyCreatedBy : (req.session?.accountId || null),\n  workspaceId: site === 'M1' ? req.proxyWorkspaceId : ctx.workspace.id\n} : {});\n\nconst attachFailed = () =>"); break;
  }
  case 'access': // resolveProviderAccess called through destructured names
    src = once(src, 'await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source });', 'await resolveProviderAccess(who.urlKey, req.proxyCreatedBy, req, { source });'); break;
  case 'gate': // follow-up gate as an early-return helper call
    src = once(src, '          if (isFollowUp) {\n            return provisionResumeCredential({', '          if (policyIsFollowUp(isFollowUp)) {\n            return provisionResumeCredential({');
    src = once(src, 'const attachFailed = () =>', 'const policyIsFollowUp = (v) => v === true;\n\nconst attachFailed = () =>'); break;
  default: throw new Error('unknown ' + name);
}
fs.writeFileSync(out, src);
