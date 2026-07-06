/**
 * Built-in Collective preset meetings (LIN-1050, S4).
 *
 * A preset is a named, repo-agnostic BUNDLE that expands into the existing
 * S1-S3 character/facilitator fan-out (routes/collective.js `/start`): a
 * roster of <=4 seats (personas, minus any repo binding) with exactly one
 * seat marked as the facilitator, plus meeting-level `objective`,
 * `exitCondition`, and `defaultTopic` — the same three fields `/start`
 * already accepts for the chair (LIN-1049). No new dispatch mechanism is
 * introduced; a preset is only a pre-filled roster + meeting metadata.
 *
 * Built-in presets are FROZEN MODULE CONSTANTS, not seeded database rows —
 * they must exist before any user has connected a repo, be byte-identical
 * for every user/workspace, and never need a seeding migration. This mirrors
 * how lib/prompt-template-defs.js separates built-in defs from the
 * user-owned CustomPromptsStore; lib/collective-presets-store.js is that
 * sibling for custom presets.
 *
 * A preset seat is intentionally repo-agnostic: it carries NO
 * `workspaceUrlKey`. Binding a seat to a connected repo happens only at
 * launch time (a later beat) — definition-time binding would be unworkable
 * (the 6 built-ins ship before any repo is connected, and a custom preset
 * with a hardcoded key would break across sessions/users/reconnects).
 *
 * Shape (see also lib/collective-presets-store.js for the custom half):
 * {
 *   id:            string,   // 'builtin:<slug>' for built-ins
 *   kind:          'builtin',
 *   name:          string,   // display label
 *   objective:     string,   // meeting objective -> /start `objective`
 *   exitCondition: string,   // concrete, checkable exit -> /start `exitCondition`
 *   defaultTopic:  string,   // -> /start `topic`
 *   roster: [ {              // 1..MAX_PRESET_SEATS entries; exactly one isFacilitator
 *     name:          string,
 *     role, lens, objective, value, disposition,  // the five CHARACTER_FIELDS, verbatim
 *     isFacilitator: boolean,
 *   } ],
 * }
 */

import { DEFAULT_COLLECTIVE_TOPIC } from './prompts/collective-participant.js';

/** Hard ceiling on seats per meeting (incl. the facilitator) — past ~4, LLM failure modes compound faster than value. */
export const MAX_PRESET_SEATS = 4;

/**
 * Validate a preset's roster invariants: 1..MAX_PRESET_SEATS seats, exactly
 * one facilitator, every seat repo-agnostic and fully specified. Shared by
 * the built-in self-check below and the custom preset store's save-time
 * validation, so the two paths cannot drift apart.
 *
 * @param {Array} roster
 * @throws {Error} on any invariant violation
 */
export function validatePresetRoster(roster) {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_PRESET_SEATS) {
    throw new Error(`roster must have between 1 and ${MAX_PRESET_SEATS} seats`);
  }
  let facilitators = 0;
  for (const seat of roster) {
    if (!seat || typeof seat !== 'object') {
      throw new Error('every roster seat must be an object');
    }
    if (seat.workspaceUrlKey) {
      throw new Error('preset seats must be repo-agnostic (no workspaceUrlKey)');
    }
    for (const f of ['name', 'role', 'lens', 'objective', 'value', 'disposition']) {
      if (typeof seat[f] !== 'string' || !seat[f].trim()) {
        throw new Error(`every roster seat requires a non-empty "${f}"`);
      }
    }
    if (seat.isFacilitator === true) facilitators++;
  }
  if (facilitators !== 1) {
    throw new Error('roster must have exactly one facilitator seat');
  }
}

/**
 * Validate the full preset bundle (meeting fields + roster). Shared by the
 * built-in self-check and lib/collective-presets-store.js's `createCustom`.
 *
 * @param {Object} data - { name, objective, exitCondition, defaultTopic, roster }
 * @throws {Error} on any invariant violation
 */
export function validatePreset(data = {}) {
  for (const f of ['name', 'objective', 'exitCondition', 'defaultTopic']) {
    if (typeof data[f] !== 'string' || !data[f].trim()) {
      throw new Error(`preset requires a non-empty "${f}"`);
    }
  }
  validatePresetRoster(data.roster);
}

function seat({ name, role, lens, objective, value, disposition, isFacilitator = false }) {
  return Object.freeze({ name, role, lens, objective, value, disposition, isFacilitator });
}

function builtinPreset({ slug, name, objective, exitCondition, defaultTopic, roster }) {
  const preset = Object.freeze({
    id: `builtin:${slug}`,
    kind: 'builtin',
    name,
    objective,
    exitCondition,
    defaultTopic,
    roster: Object.freeze(roster.map(seat)),
  });
  validatePreset(preset);
  return preset;
}

/**
 * The 6 seed presets (LIN-1050 plan beat 2). Each is 1 facilitator + 3
 * distinct-objective voices = 4 seats (the ceiling honored exactly). These
 * are framing EXAMPLES of meeting shapes, not a closed cast list.
 */
export const BUILTIN_PRESETS = Object.freeze([
  builtinPreset({
    slug: 'standup',
    name: 'Standup',
    objective: "surface each project's current state, next step, and blockers in one clean pass.",
    exitCondition:
      'every seat has reported status + named its single biggest blocker (with an owner where known); ' +
      'John has the cross-project picture; two dead checkpoints -> impasse; John may call it.',
    defaultTopic: 'Where is each project right now, and what’s blocking the next step?',
    roster: [
      {
        name: 'Standup Chair',
        role: 'Standup Chair',
        lens: 'keep it to status + blockers, timebox, park deep-dives',
        objective: 'run a tight status pass across every project',
        value: 'brevity and forward motion',
        disposition: 'timeboxed, redirects tangents to a parking lot',
        isFacilitator: true,
      },
      {
        name: 'Progress reporter',
        role: 'Progress reporter',
        lens: 'what actually shipped since last sync, grounded in the repo not plans',
        objective: 'state real, verifiable progress per project',
        value: 'grounded truth over optimism',
        disposition: 'checks the repo before claiming a status',
      },
      {
        name: 'Blocker hunter',
        role: 'Blocker hunter',
        lens: 'what is stuck and who owns unsticking it',
        objective: "force each project to name its single hardest blocker and who owns it",
        value: 'no unowned blockers',
        disposition: 'insistent, will not let a vague blocker pass',
      },
      {
        name: 'Dependency spotter',
        role: 'Dependency spotter',
        lens: 'where one project’s next step waits on another’s',
        objective: 'flag cross-project dependencies before they cause surprise delays',
        value: 'visibility across project boundaries',
        disposition: 'watches for silent coupling between projects',
      },
    ],
  }),

  builtinPreset({
    slug: 'design-crit',
    name: 'Design crit',
    objective: 'pressure-test a proposed design against its goal, one real alternative, and simplicity.',
    exitCondition:
      "the design's core claim is stated; >=1 concrete alternative weighed; >=1 specific weakness raised AND " +
      'addressed; a keep/revise/reject recommendation exists.',
    defaultTopic: 'Is this the right design, or is there a simpler one that meets the same goal?',
    roster: [
      {
        name: 'Crit Chair',
        role: 'Crit Chair',
        lens: 'critique the design not the designer; force one alternative before any endorsement',
        objective: 'reach a clear keep/revise/reject verdict on the design',
        value: 'rigor without personal attack',
        disposition: 'insists on an alternative before allowing praise',
        isFacilitator: true,
      },
      {
        name: 'Simplicity advocate',
        role: 'Simplicity advocate',
        lens: 'the smallest design that still meets the goal',
        objective: 'challenge every added moving part',
        value: 'minimalism',
        disposition: 'skeptical of complexity, asks "do we need this piece?"',
      },
      {
        name: 'Consumer voice',
        role: 'Consumer voice',
        lens: 'the people/systems that consume this design',
        objective: "does this actually solve the consumer's problem",
        value: 'usability over elegance',
        disposition: 'grounds the discussion in real consumer needs',
      },
      {
        name: 'Edge-case skeptic',
        role: 'Edge-case skeptic',
        lens: 'the inputs/states/failures the design quietly assumes away',
        objective: 'name the edge cases the design has not addressed',
        value: 'robustness',
        disposition: 'probing, hunts for the unstated assumption',
      },
    ],
  }),

  builtinPreset({
    slug: 'architecture-review',
    name: 'Architecture review',
    objective: 'judge whether a proposed architecture holds up under change, scale, and boundaries.',
    exitCondition:
      'seams/boundaries named; coupling & failure modes examined; a fit-for-purpose verdict recorded with the ' +
      'single riskiest assumption.',
    defaultTopic: 'Does this architecture hold up as the system grows and requirements shift?',
    roster: [
      {
        name: 'Architecture Chair',
        role: 'Architecture Chair',
        lens: 'structure & boundaries, not line-level style',
        objective: 'force the riskiest assumption to the surface',
        value: 'structural clarity',
        disposition: 'redirects style nitpicks back to structure',
        isFacilitator: true,
      },
      {
        name: 'Boundaries/coupling analyst',
        role: 'Boundaries/coupling analyst',
        lens: 'module seams & dependencies',
        objective: 'find where this couples tightly or leaks concerns',
        value: 'clean seams',
        disposition: 'traces dependency edges methodically',
      },
      {
        name: 'Scale/operability voice',
        role: 'Scale/operability voice',
        lens: 'behavior under growth, load, and failure',
        objective: 'name what breaks first',
        value: 'operational resilience',
        disposition: 'thinks in failure modes, not happy paths',
      },
      {
        name: 'Evolvability skeptic',
        role: 'Evolvability skeptic',
        lens: 'the next ~3 likely changes',
        objective: 'name what future change this makes expensive',
        value: 'long-term adaptability',
        disposition: 'projects forward, resists local optimization',
      },
    ],
  }),

  builtinPreset({
    slug: 'pre-mortem',
    name: 'Pre-mortem',
    objective: 'assume the effort failed, and enumerate the causes now while they are cheap to fix.',
    exitCondition:
      '>=3 distinct plausible failure causes named; each rated likelihood x impact; the top one has a ' +
      'mitigation or an explicit accept.',
    defaultTopic: "It's six months out and this failed — what killed it?",
    roster: [
      {
        name: 'Pre-mortem Chair',
        role: 'Pre-mortem Chair',
        lens: 'hold the room in the failed-future frame',
        objective: 'block optimism until failures are on the table',
        value: 'honest risk surfacing',
        disposition: 'refuses premature reassurance',
        isFacilitator: true,
      },
      {
        name: 'Technical-risk voice',
        role: 'Technical-risk voice',
        lens: 'how the implementation itself fails: complexity, unknowns, dependencies',
        objective: 'name the technical ways this fails',
        value: 'engineering realism',
        disposition: 'names concrete failure mechanisms, not vague doubt',
      },
      {
        name: 'Adoption/value voice',
        role: 'Adoption/value voice',
        lens: 'how it ships yet delivers no value or nobody uses it',
        objective: 'name the adoption/value failure modes',
        value: 'value delivered, not just shipped',
        disposition: 'questions whether the "done" outcome actually matters',
      },
      {
        name: 'Process/timeline voice',
        role: 'Process/timeline voice',
        lens: 'coordination, scope creep, or timing',
        objective: 'name how process or timeline sinks it',
        value: 'realistic sequencing',
        disposition: 'watches for slippage and silent scope growth',
      },
    ],
  }),

  builtinPreset({
    slug: 'synergy',
    name: 'Synergy',
    objective: 'find the highest-leverage way these projects amplify each other.',
    exitCondition:
      '>=3 concrete collaboration opportunities surfaced; each judged real leverage vs. busywork; the single ' +
      'best one named with a first step.',
    defaultTopic: DEFAULT_COLLECTIVE_TOPIC,
    roster: [
      {
        name: 'Synergy Chair',
        role: 'Synergy Chair',
        lens: 'push past vague "we could integrate" to concrete, testable leverage',
        objective: 'kill fake synergy, land on one real opportunity',
        value: 'concrete leverage over vague optimism',
        disposition: 'pushes for specifics, rejects hand-wavy integration claims',
        isFacilitator: true,
      },
      {
        name: 'Integration scout',
        role: 'Integration scout',
        lens: "where the projects' data/capabilities actually connect",
        objective: 'map concrete integration points',
        value: 'technical feasibility',
        disposition: 'grounds ideas in what actually connects today',
      },
      {
        name: 'Leverage skeptic',
        role: 'Leverage skeptic',
        lens: 'real amplification vs. more surface to maintain',
        objective: 'judge whether each idea is genuine leverage',
        value: 'signal over busywork',
        disposition: 'challenges every proposal to justify its maintenance cost',
      },
      {
        name: 'User-journey voice',
        role: 'User-journey voice',
        lens: 'the end-to-end user',
        objective: 'name the combined experience neither project can do alone',
        value: 'user-centered outcomes',
        disposition: 'keeps the discussion anchored to a real user journey',
      },
    ],
  }),

  builtinPreset({
    slug: 'retro',
    name: 'Retro',
    objective: 'learn from a completed effort — what worked, what did not, what changes next time.',
    exitCondition:
      'keep/stop/change each have >=1 concrete item; every "change" has an owner or a next action; no ' +
      'blameless truth left unsaid.',
    defaultTopic: 'What should we keep, stop, and change based on how this went?',
    roster: [
      {
        name: 'Retro Chair',
        role: 'Retro Chair',
        lens: 'keep it blameless and specific',
        objective: 'convert complaints into ownable changes',
        value: 'blameless honesty',
        disposition: 'redirects blame into concrete action items',
        isFacilitator: true,
      },
      {
        name: 'What-worked voice',
        role: 'What-worked voice',
        lens: 'the practices/decisions that genuinely helped',
        objective: 'name what to keep deliberately',
        value: 'reinforcing what works',
        disposition: 'gives credit precisely, not generically',
      },
      {
        name: 'What-hurt voice',
        role: 'What-hurt voice',
        lens: 'frictions and misses',
        objective: 'surface what hurt honestly, without blame',
        value: 'honest surfacing over comfort',
        disposition: 'direct but never personal',
      },
      {
        name: 'Change agent',
        role: 'Change agent',
        lens: 'turning lessons into action',
        objective: 'turn each lesson into one concrete, ownable change for next time',
        value: 'actionable follow-through',
        disposition: 'insists every lesson lands as a next action',
      },
    ],
  }),
]);
