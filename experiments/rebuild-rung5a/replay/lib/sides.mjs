// Side preparation: copy each side's two target files into a private work
// tree and register the resolve hook (lib/hooks.mjs) that keeps each side's
// factory bound to its OWN validation while sharing every other repo module.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

export const REPO = '/home/user/LinearViewer';
export const REPO_LIB = path.join(REPO, 'lib');
export const TARGETS = ['dispatch-factory.js', 'dispatch-validation.js'];
const HERE = path.dirname(new URL(import.meta.url).pathname);

/** Accept a dir holding the two files directly, or under lib/, or a file list. */
export function locateSrcLib(arg) {
  const abs = path.resolve(arg);
  for (const cand of [abs, path.join(abs, 'lib')]) {
    if (TARGETS.every(f => fs.existsSync(path.join(cand, f)))) return cand;
  }
  const missing = TARGETS.filter(f => !fs.existsSync(path.join(abs, f)) && !fs.existsSync(path.join(abs, 'lib', f)));
  throw new Error(`${arg}: does not contain ${missing.join(' and ')} (directly or under lib/)`);
}

export function prepareSide(label, srcArg, runDir) {
  const srcLib = locateSrcLib(srcArg);
  const root = path.join(runDir, label);
  const workLib = path.join(root, 'lib');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(workLib, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  const files = {};
  for (const f of TARGETS) {
    const src = fs.readFileSync(path.join(srcLib, f));
    fs.writeFileSync(path.join(workLib, f), src);
    files[f] = { src: path.join(srcLib, f), dest: path.join(workLib, f), url: pathToFileURL(path.join(workLib, f)).href, sha: crypto.createHash('sha256').update(src).digest('hex').slice(0, 12) };
  }
  return { label, srcLib, workLib, workLibUrl: pathToFileURL(workLib + path.sep).href, files };
}

export const resolutions = [];
let registered = false;
export function registerHooks(sides, { redirect = {} } = {}) {
  if (registered) throw new Error('hooks already registered');
  registered = true;
  const { port1, port2 } = new MessageChannel();
  port1.on('message', (m) => resolutions.push(m));
  port1.unref();
  register(pathToFileURL(path.join(HERE, 'hooks.mjs')).href, {
    data: {
      sides: sides.map(s => ({ label: s.label, workLib: s.workLib, workLibUrl: s.workLibUrl, srcLib: s.srcLib })),
      repoLib: REPO_LIB,
      redirect,
      port: port2
    },
    transferList: [port2]
  });
}

export async function importSide(side) {
  const before = new Set(Object.keys(globalThis));
  const envBefore = { ...process.env };
  const listenersBefore = process.eventNames().map(e => `${String(e)}:${process.listenerCount(e)}`).join(',');
  const mods = {};
  for (const f of TARGETS) mods[f] = await import(side.files[f].url);
  const census = {
    newGlobals: Object.keys(globalThis).filter(k => !before.has(k)),
    envChanged: Object.keys({ ...envBefore, ...process.env }).filter(k => envBefore[k] !== process.env[k]),
    listenersChanged: listenersBefore !== process.eventNames().map(e => `${String(e)}:${process.listenerCount(e)}`).join(',')
  };
  return { factory: mods['dispatch-factory.js'], validation: mods['dispatch-validation.js'], census };
}
