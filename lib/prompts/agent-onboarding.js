/**
 * Agent onboarding guide and landing prompt (LIN-4085).
 *
 * Two texts an agent reads before it has any Harbour context:
 *   - the guide, `docs/agent-onboarding.md`, served at `/getting-started.md`
 *     and `/getting-started` (routes/getting-started.js);
 *   - the landing prompt, the text a person copies from under the sign-in
 *     buttons on `/`. Its one slot is the deployment origin.
 *
 * The guide follows the runner-prompt pattern (lib/prompts/runner-kickoff.js):
 * served text is everything after the file's first `---` line, read once and
 * cached for the process. A failed read returns a minimal fallback that is not
 * cached, so a later call retries. Every `{{NAME}}` is filled from its source
 * per request; an unknown placeholder is an error, never shipped as raw braces.
 *
 * Placeholders: BASE_URL (the validated origin, from the request), SIGN_IN_DOORS
 * (from signInDoors(), the hero's own list) and FREE_TIER_SENTENCE (from
 * isFreeTierOffered()). No token or credential is ever templated in here.
 *
 * This module is not generalised: one guide and one landing prompt justify
 * about 100 lines, not a shared helper. A third user should extract it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The guide source, at HEAD. */
export const GUIDE_PATH = join(HERE, '..', '..', 'docs', 'agent-onboarding.md');

/** The placeholders the guide may use. Anything else is an error. */
const KNOWN_PLACEHOLDERS = new Set(['BASE_URL', 'SIGN_IN_DOORS', 'FREE_TIER_SENTENCE']);
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/** The landing prompt. `{{BASE_URL}}` is the only slot. */
export const LANDING_AGENT_PROMPT_TEMPLATE = [
  'I want to set up Harbour, the control plane for AI-assisted software work at {{BASE_URL}}, for my work. Before you do anything else, fetch the onboarding guide at {{BASE_URL}}/getting-started.md, read all of it, and follow it.',
  'Ask me what I want from Harbour, and whether I already keep my work in a task tracker, before you pick a path or create anything. Some steps need me to sign in or click in my browser. The guide says which.',
  'If you cannot fetch that address, ask me to open {{BASE_URL}}/getting-started in my browser and paste the page here.',
].join('\n\n');

/** Replace every placeholder in `template` from `values`; unknown names throw. */
function fill(template, values) {
  return template.replace(PLACEHOLDER, (_, name) => {
    if (!(name in values)) throw new Error(`unknown placeholder {{${name}}}`);
    return values[name];
  });
}

/**
 * The served guide body for a raw source file: everything after its first
 * `---` line (or the whole file when there is none), trimmed. Throws when the
 * body uses a placeholder this module does not know.
 * @param {string} raw
 * @returns {string} the template, placeholders still in place
 */
export function parseAgentOnboardingTemplate(raw) {
  const lines = raw.split('\n');
  const divider = lines.findIndex((line) => line.trim() === '---');
  const template = (divider === -1 ? raw : lines.slice(divider + 1).join('\n')).trim() + '\n';
  const unknown = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((name) => !KNOWN_PLACEHOLDERS.has(name));
  if (unknown.length) throw new Error(`unknown placeholder(s): ${[...new Set(unknown)].join(', ')}`);
  return template;
}

/** Minimal fallback when the guide cannot be read or filled. Never cached. */
export function agentOnboardingFallback(baseUrl) {
  return `# Harbour onboarding

The onboarding guide could not be loaded. Ask the person to open ${baseUrl}/llms.txt
instead, and to say what they want from Harbour before you do anything else.
`;
}

const absolute = (href, base) => (href.startsWith('/') ? `${base}${href}` : href);

/**
 * A builder over one guide file, with its own cache. Exported for tests;
 * production uses `buildAgentOnboarding` below.
 */
export function createAgentOnboardingBuilder({ guidePath = GUIDE_PATH } = {}) {
  let cached = null;

  /**
   * @param {{baseUrl: string, doors?: {label: string, href: string}[], freeTierEnabled?: boolean}} params
   * @returns {string} the guide as markdown, every placeholder filled
   */
  return function build({ baseUrl, doors = [], freeTierEnabled = false } = {}) {
    if (!baseUrl) throw new Error('buildAgentOnboarding requires a baseUrl');
    const base = String(baseUrl).replace(/\/+$/, '');
    if (cached === null) {
      try {
        cached = parseAgentOnboardingTemplate(readFileSync(guidePath, 'utf-8'));
      } catch (err) {
        console.error('Failed to build the agent onboarding guide:', err.message);
        return agentOnboardingFallback(base);
      }
    }
    return fill(cached, {
      BASE_URL: base,
      SIGN_IN_DOORS: doors.map((d) => `- [${d.label}](${absolute(d.href, base)})`).join('\n'),
      FREE_TIER_SENTENCE: freeTierEnabled
        ? 'This deployment has a free tier, so no OpenRouter key is needed to start.'
        : 'This deployment has no free tier, so writing prompts needs the person\'s own OpenRouter key.',
    });
  };
}

/** The onboarding guide, served from docs/agent-onboarding.md at HEAD. */
export const buildAgentOnboarding = createAgentOnboardingBuilder();

/**
 * The landing prompt for a deployment origin. Static text apart from the origin.
 * @param {{baseUrl: string}} params
 * @returns {string}
 */
export function renderLandingAgentPrompt({ baseUrl }) {
  if (!baseUrl) throw new Error('renderLandingAgentPrompt requires a baseUrl');
  return fill(LANDING_AGENT_PROMPT_TEMPLATE, { BASE_URL: String(baseUrl).replace(/\/+$/, '') });
}
