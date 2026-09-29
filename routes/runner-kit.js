/**
 * The runner kit, served (LIN-3098 S3, NB4):
 *
 *   GET /runner-kit/:file     (broker.mjs, runner.mjs)
 *
 * The served runner prompt tells a person's Claude Code session to fetch these
 * two files and verify each against the sha256 the prompt pins, instead of
 * transcribing ~73 KB of security-relevant code out of the prompt. Public: the
 * kit is Harbour's own open source (the repository is public) and holds no
 * secret, and the session needs it before it holds any credential.
 *
 * Only the allow-listed file names are served, read from lib/runner-kit at
 * HEAD, so the bytes always match what lib/prompts/runner-kickoff.js pins.
 * Each file is read once and served from memory after that, the same way the
 * builder computes its pins once per process.
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RUNNER_KIT_DIR, RUNNER_KIT_FILES } from '../lib/prompts/runner-kickoff.js';

export function createRunnerKitRoutes({ kitDir = RUNNER_KIT_DIR } = {}) {
  const router = Router();
  const cache = new Map();

  router.get('/runner-kit/:file', (req, res) => {
    const { file } = req.params;
    if (!RUNNER_KIT_FILES.includes(file)) {
      return res.status(404).json({ error: 'Not a runner kit file' });
    }
    let body = cache.get(file);
    if (!body) {
      try {
        body = readFileSync(join(kitDir, file));
      } catch {
        return res.status(404).json({ error: 'Not a runner kit file' });
      }
      cache.set(file, body);
    }
    res.set('Cache-Control', 'no-store');
    res.type('text/javascript; charset=utf-8').send(body);
  });

  return router;
}
