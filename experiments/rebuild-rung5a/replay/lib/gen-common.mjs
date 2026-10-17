// Seeded generator helpers. Every generated input has its own PRNG derived
// from (seed, tier, index), so `gen-f:1234` is identical at any --n.
import crypto from 'node:crypto';
import { mulberry32 } from './hermetic.mjs';

export function rngFor(seed, tier, index) {
  const h = crypto.createHash('sha256').update(`${seed}|${tier}|${index}`).digest();
  const r = mulberry32(h.readUInt32LE(0));
  const g = {
    seed32: h.readUInt32LE(4),
    next: r,
    chance: (p) => r() < p,
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    weighted: (pairs) => {
      const total = pairs.reduce((s, [w]) => s + w, 0);
      let x = r() * total;
      for (const [w, v] of pairs) { if ((x -= w) < 0) return v; }
      return pairs[pairs.length - 1][1];
    },
    subset: (arr, p = 0.5) => arr.filter(() => r() < p),
    shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  };
  return g;
}

// Response / value helpers for world specs.
export const U = { $u: 1 };
export const res = (v) => ({ k: 'res', v: v === undefined ? U : v });
export const ret = (v) => ({ k: 'ret', v: v === undefined ? U : v });
export const rej = (message = 'store read failed', name = 'Error', props) => ({ k: 'rej', e: { name, message, ...(props ? { props } : {}) } });
export const thr = (message = 'sync failure', name = 'Error') => ({ k: 'throw', e: { name, message } });
export const hang = () => ({ k: 'hang' });
export const seq = (list, then) => ({ seq: list, ...(then ? { then } : {}) });
export const fn = (name, script) => ({ $fn: { name, script } });
export const obj = (name, props, extra = {}) => ({ $obj: { name, props, ...extra } });
export const date = (x) => ({ $date: x });
export const big = (n, ch = 'a', prefix = '', suffix = '') => ({ $str: { n, ch, prefix, suffix } });

export const UUIDS = [
  '123e4567-e89b-42d3-a456-426614174000',
  'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
  '00000000-0000-0000-0000-000000000000',
  'f47ac10b-58cc-4372-a567-0e02b2c3d479'
];
export const BAD_UUIDS = ['not-a-uuid', '123e4567-e89b-42d3-a456-42661417400', ' 123e4567-e89b-42d3-a456-426614174000', '123e4567e89b42d3a456426614174000', 'g23e4567-e89b-42d3-a456-426614174000', ''];
export const UNICODE = ['héllo wörld', '日本語のテキスト', '🚀 launch 🧪', '‮evil', 'zero​width', 'nel\u0085line', 'lone\uD800surrogate', 'tab\tnew\nline\rcr', 'émoji‍👩‍💻'];
export const CONTROL = ['\x00', 'a\x01b', 'del\x7F', 'vt\x0B', 'ff\x0C', 'us\x1F', 'bs\x08', 'so\x0E'];
