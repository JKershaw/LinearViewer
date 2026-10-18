// Fixtures for the code-shape tests: a throwaway git repo with fixed dates. No network, no real repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const makeRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-test-'));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return {
    dir,
    git,
    // Writes the files (null deletes), commits at a fixed date, returns the sha.
    commit(files, date, message = 'c') {
      for (const [p, text] of Object.entries(files)) {
        if (text === null) { rmSync(join(dir, p), { force: true }); continue; }
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), text);
      }
      git('add', '-A');
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
      return git('rev-parse', 'HEAD').trim();
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};
