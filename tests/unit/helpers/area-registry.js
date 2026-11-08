// The product's area registry, docs/areas/areas.json (LIN-4371), read the one way every test
// reads it: areas in order, first matching pattern wins. Before LIN-4371 three tests each carried
// their own copy of the path and of this lookup (the registry was scripts/code-shape/areas.json).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The path's one spelling, product-owned (LIN-4383); this helper keeps its own lookup, which returns the area object (tests need the slug).
import { REGISTRY_PATH } from '../../../lib/prompts/area-registry-path.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export { REGISTRY_PATH };

export function loadAreas(root = ROOT) {
  return JSON.parse(readFileSync(join(root, REGISTRY_PATH), 'utf8')).areas;
}

const AREAS = loadAreas();

/** Every area whose patterns match `path`, in registry order. The first is the file's area. */
export function areasMatching(path, areas = AREAS) {
  return areas.filter((a) => (a.match || []).some((m) => new RegExp(m).test(path)));
}

/** The area `path` belongs to (first match), or undefined when no area claims it. */
export function areaOf(path, areas = AREAS) {
  return areasMatching(path, areas)[0];
}

/** The name of the area `path` belongs to, or undefined. */
export const areaNameOf = (path, areas = AREAS) => areaOf(path, areas)?.name;
