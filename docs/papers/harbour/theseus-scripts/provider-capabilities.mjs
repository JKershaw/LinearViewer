// theseus: which declared surface methods each registered provider implements.
// Usage: node provider-capabilities.mjs <repoDir>  → JSON on stdout
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href;
const { PROVIDER_SURFACE } = await import(root + 'lib/providers/interface.js');
await import(root + 'lib/providers/index.js');
const { getAllProviders } = await import(root + 'lib/providers/registry.js');
const implemented = {};
for (const p of getAllProviders()) implemented[p.name] = p.getCapabilities().implemented;
console.log(JSON.stringify({ surface: Object.values(PROVIDER_SURFACE).flat(), implemented }));
