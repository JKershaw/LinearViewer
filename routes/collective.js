/**
 * Collective routes — the experimental cross-project discussion (LIN-450, V1).
 *
 * Anchored at /workspace/:urlKey/collective (reusing workspaceFromUrl + the
 * pipeline feature-gate-redirect-to-settings pattern), the page is *anchored* to
 * one workspace for auth/navbar/gate but *operates* over the user-selected subset
 * of `session.workspaces`: it fans a participant prompt out to each selected
 * workspace's unchanged dispatch route, and fronts a thin Yap proxy to render the
 * live channel and inject the human's input.
 *
 *   GET  /workspace/:urlKey/collective              — page shell (gated)
 *   POST /workspace/:urlKey/collective/start        — multi-workspace dispatch fan-out
 *   GET  /workspace/:urlKey/api/collective/state     — JSON poll fronting yap.poll
 *   POST /workspace/:urlKey/api/collective/say       — inject human input via yap.say
 *
 * V1 scope: rigging + one reusable participant prompt template. Recaps, a durable
 * transcript store, auto-cadence, and the within-a-project variant are deferred.
 */

import { Router } from 'express';
import { renderCollectivePage } from '../lib/render-collective.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { normalizeYapChannel, nickFromWorkspaceName, randomChannelName } from '../lib/yap-client.js';
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHANNEL,
  DEFAULT_COLLECTIVE_TOPIC,
  CHARACTER_FIELDS,
} from '../lib/prompts/collective-participant.js';

// Substrate is DECIDED (John, 2026-06-13): full Claude Code sessions only.
// `dash` is pure-code-change execution and `local`/Harbour OS isn't a fan-out
// target here, so the Collective accepts only cli/web.
const COLLECTIVE_TARGETS = ['cli', 'web'];

// A stable observer nick the server uses to read the channel on the human's
// behalf (poll needs a nick). The human's own posts go out under their say nick.
const OBSERVER_NICK = 'linearviewer';
const DEFAULT_HUMAN_NICK = 'John';

const MAX_SAY_LENGTH = 2000;
const MAX_NICK_LENGTH = 32;

/**
 * Pull the five persona fields off a client-supplied character, trimmed, omitting
 * any that are empty/missing. An empty result ({}) merges over
 * DEFAULT_COLLECTIVE_CHARACTER in buildCollectiveParticipantPrompt to reproduce
 * the byte-identical default participant — so a character with no persona fields
 * is exactly the pre-LIN-1048 default fan-out. Never trust extra client keys
 * (name/save/id/workspaceUrlKey) into the persona overlay.
 */
function pickCharacterFields(character = {}) {
  const out = {};
  for (const f of CHARACTER_FIELDS) {
    if (typeof character[f] === 'string' && character[f].trim()) {
      out[f] = character[f].trim();
    }
  }
  return out;
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl      - middleware: session + req.workspace
 * @param {Object}   deps.dispatchQueueStore    - dispatch store (addItem)
 * @param {Object}   [deps.proxyTokenStore]     - proxy token store (mint readWrite per participant)
 * @param {Object|null} deps.yapClient          - Yap HTTP client (null when YAP_BASE_URL unset)
 * @param {Function} deps.getOpenRouterSource   - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo         - () → deploy metadata
 * @returns {Router}
 */
export function createCollectiveRoutes({
  workspaceFromUrl,
  dispatchQueueStore,
  proxyTokenStore,
  collectiveCharactersStore,
  yapClient,
  getOpenRouterSource,
  getDeployInfo,
}) {
  const router = Router();

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/collective', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors pipeline).
    if (featureFlags.collective !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      // Saved custom + auto-recorded recent characters for this anchor workspace.
      const characters = collectiveCharactersStore
        ? await collectiveCharactersStore.list(workspace.urlKey)
        : [];

      const html = renderCollectivePage(
        {
          workspaces: (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name })),
          characters,
          // A fresh, friendly channel suggestion per page load (words + date),
          // so each new discussion lands in its own channel by default.
          defaultChannel: randomChannelName(),
          defaultTopic: DEFAULT_COLLECTIVE_TOPIC,
          yapConfigured: !!yapClient,
        },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags,
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Collective page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Collective page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/collective`,
      });
      res.status(500).send(html);
    }
  });

  // ─── Start: multi-workspace dispatch fan-out ─────────────────────────────────

  router.post('/workspace/:urlKey/collective/start', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.collective !== true) {
      return res.status(403).json({ error: 'Collective feature is not enabled' });
    }

    const { channel: rawChannel, characters: rawCharacters, target: rawTarget, topic: rawTopic } = req.body || {};

    const channel = normalizeYapChannel(rawChannel || DEFAULT_COLLECTIVE_CHANNEL);
    if (!channel) {
      return res.status(400).json({ error: 'A valid channel name is required' });
    }

    const target = rawTarget || 'cli';
    if (!COLLECTIVE_TARGETS.includes(target)) {
      return res.status(400).json({ error: `target must be one of: ${COLLECTIVE_TARGETS.join(', ')}` });
    }

    if (!Array.isArray(rawCharacters) || rawCharacters.length === 0) {
      return res.status(400).json({ error: 'Select at least one character' });
    }

    // Each character carries its own repo binding (workspaceUrlKey). Resolve that
    // binding against session.workspaces — never trust the client, and never
    // dispatch to a workspace the user isn't connected to. A character whose bound
    // workspace is no longer connected (a stale binding) is dropped silently; the
    // 400 stays only when NONE of the characters resolve to a connected workspace.
    const connected = req.session.workspaces || [];
    const byKey = new Map(connected.map(w => [w.urlKey, w]));
    const roster = [];
    for (const c of rawCharacters) {
      if (!c || typeof c !== 'object') continue;
      const ws = byKey.get(c.workspaceUrlKey);
      if (!ws) continue; // stale repo binding — drop
      roster.push({ ws, character: pickCharacterFields(c), raw: c });
    }

    if (roster.length === 0) {
      return res.status(400).json({ error: 'None of the selected characters are bound to a connected workspace' });
    }

    const topic = (typeof rawTopic === 'string' && rawTopic.trim())
      ? rawTopic.trim().slice(0, 500)
      : DEFAULT_COLLECTIVE_TOPIC;

    const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
    const yapBaseUrl = yapClient?.baseUrl || process.env.YAP_BASE_URL || '';
    const yapPassword = process.env.YAP_PASSWORD || null;

    // Assign distinct nicks across the selected set (Yap nicks are forgeable, but
    // distinct nicks keep the transcript legible). Disambiguate slug collisions.
    const usedNicks = new Set();
    const assignNick = (name) => {
      let base = nickFromWorkspaceName(name);
      let nick = base;
      let n = 2;
      while (usedNicks.has(nick.toLowerCase())) {
        const suffix = `-${n++}`;
        nick = `${base.slice(0, MAX_NICK_LENGTH - suffix.length)}${suffix}`;
      }
      usedNicks.add(nick.toLowerCase());
      return nick;
    };

    // The fan-out iterates over CHARACTERS (LIN-1048): the caller supplies a
    // roster of personas, each bound to a connected workspace. A character with
    // no persona fields collapses (via pickCharacterFields → the builder's merge)
    // to the byte-identical DEFAULT_COLLECTIVE_CHARACTER participant, so the
    // default fan-out is unchanged; a filled-in character prepends its persona
    // block. `anchorKey` is the workspace the picker/store live under.
    const anchorKey = req.workspace.urlKey;

    const dispatched = [];
    for (const { ws, character, raw } of roster) {
      const nick = assignNick(ws.name);

      // Best-effort: mint a readWrite proxy token so the participant can pull its
      // own workspace's Linear context (and act ONLY when John approves in
      // channel). If the store is absent or minting fails, dispatch without it —
      // the discussion still works; the participant just lacks Linear access.
      let proxyToken = null;
      if (proxyTokenStore) {
        try {
          const minted = await proxyTokenStore.createToken(ws.urlKey, { scope: 'readWrite', label: 'collective' });
          proxyToken = minted?.token || null;
        } catch (err) {
          console.error(`Collective: proxy token mint failed for ${ws.urlKey}:`, err.message);
        }
      }

      const prompt = buildCollectiveParticipantPrompt({
        channel,
        nick,
        yapBaseUrl,
        yapPassword,
        topic,
        proxyBaseUrl: proxyToken ? proxyBaseUrl : null,
        proxyToken,
        character,
      });

      try {
        const item = await dispatchQueueStore.addItem(ws.urlKey, {
          prompt,
          promptName: 'collective-participant',
          kind: 'custom',
          target,
          dispatchedBy: req.session.linearUserId || null,
        });
        dispatched.push({ urlKey: ws.urlKey, name: ws.name, nick, id: item._id, ok: true });

        // Remember this dispatched character for the picker. The store is
        // partitioned by the anchor workspace but the record carries its own repo
        // binding. A newly-defined character the user opted to save (`save`) is
        // persisted as `custom` first; every dispatched character is then recorded
        // as `recent` (recordRecent dedupes against an existing custom/recent, so a
        // saved character is not double-listed). We do NOT gate on `!raw.id`: the
        // real client (public/collective.js addDefinedCharacter) assigns every
        // define-new row a local `pending-N` id, so `!raw.id` would make custom
        // persistence unreachable from the UI (LIN-1048). Re-saving is idempotent —
        // createCustom dedupes by identity (repo binding + persona) and promotes a
        // twin in place — so dropping the guard cannot double-list.
        if (collectiveCharactersStore) {
          const record = {
            workspaceUrlKey: ws.urlKey,
            workspaceName: ws.name,
            name: typeof raw.name === 'string' ? raw.name : '',
            ...character,
          };
          if (raw.save) {
            try {
              await collectiveCharactersStore.createCustom(anchorKey, record);
            } catch (saveErr) {
              // A full custom store (or bad input) must not block the dispatch —
              // the participant is already queued. Surface it in logs only.
              console.error(`Collective: save custom character failed for ${anchorKey}:`, saveErr.message);
            }
          }
          await collectiveCharactersStore.recordRecent(anchorKey, record);
        }
      } catch (err) {
        console.error(`Collective: dispatch failed for ${ws.urlKey}:`, err.message);
        dispatched.push({ urlKey: ws.urlKey, name: ws.name, nick, ok: false, error: 'dispatch failed' });
      }
    }

    res.status(201).json({ channel, topic, target, dispatched });
  });

  // ─── Preview: build the participant prompt without dispatching ───────────────
  // Lets the user view (and copy) exactly the prompt each participant receives,
  // for the chosen channel/topic. Uses a sample nick and a placeholder Linear
  // token so the full shape — including the auto-appended Linear-access block —
  // is visible without minting a real token.

  router.post('/workspace/:urlKey/collective/preview', workspaceFromUrl, (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.collective !== true) {
      return res.status(403).json({ error: 'Collective feature is not enabled' });
    }

    const { channel: rawChannel, topic: rawTopic, nick: rawNick, character: rawCharacter } = req.body || {};
    const channel = normalizeYapChannel(rawChannel || DEFAULT_COLLECTIVE_CHANNEL);
    if (!channel) {
      return res.status(400).json({ error: 'A valid channel name is required' });
    }
    const topic = (typeof rawTopic === 'string' && rawTopic.trim())
      ? rawTopic.trim().slice(0, 500)
      : DEFAULT_COLLECTIVE_TOPIC;

    // Representative nick: the supplied one, else the first connected workspace,
    // else a generic placeholder.
    const sampleNick = (typeof rawNick === 'string' && nickFromWorkspaceName(rawNick))
      ? nickFromWorkspaceName(rawNick)
      : nickFromWorkspaceName(req.session.workspaces?.[0]?.name || 'your-project');

    // Thread the selected character so preview matches dispatch (LIN-1048): an
    // empty/absent character collapses to the default participant, exactly as
    // /start does. Omitting this is the preview/dispatch-divergence bug.
    const character = (rawCharacter && typeof rawCharacter === 'object')
      ? pickCharacterFields(rawCharacter)
      : null;

    const prompt = buildCollectiveParticipantPrompt({
      channel,
      nick: sampleNick,
      yapBaseUrl: yapClient?.baseUrl || process.env.YAP_BASE_URL || '',
      yapPassword: process.env.YAP_PASSWORD || null,
      topic,
      proxyBaseUrl: `${req.protocol}://${req.get('host')}`,
      proxyToken: 'YOUR_READWRITE_PROXY_TOKEN', // placeholder — real token minted at dispatch
      character,
    });

    res.json({ channel, topic, nick: sampleNick, prompt });
  });

  // ─── JSON poll: render the live channel ──────────────────────────────────────

  router.get('/workspace/:urlKey/api/collective/state', workspaceFromUrl, async (req, res) => {
    if (!yapClient) {
      return res.status(503).json({ error: 'Yap is not configured (set YAP_BASE_URL)' });
    }

    const channel = normalizeYapChannel(req.query.channel || DEFAULT_COLLECTIVE_CHANNEL);
    if (!channel) {
      return res.status(400).json({ error: 'A valid channel name is required' });
    }
    const since = Math.max(parseInt(req.query.since, 10) || 0, 0);

    try {
      const result = await yapClient.poll(channel, OBSERVER_NICK, since);
      // Normalise Yap's message shape for the client: Yap returns the body in a
      // `text` field (verified against the live server), with `message` used
      // only on the outbound say request. Expose a stable shape so the renderer
      // never has to guess the field name.
      const messages = (result.messages || []).map(m => ({
        id: m.id,
        nick: m.nick || '?',
        text: m.text ?? m.message ?? '',
        type: m.type || 'message',
        timestamp: m.timestamp ?? null,
      }));
      res.json({
        channel,
        messages,
        cursor: result.cursor ?? since,
        truncated: !!result.truncated,
      });
    } catch (error) {
      console.error('Collective state error:', error.message);
      res.status(502).json({ error: 'Could not reach Yap', detail: error.detail || null });
    }
  });

  // ─── Inject human input ──────────────────────────────────────────────────────

  router.post('/workspace/:urlKey/api/collective/say', workspaceFromUrl, async (req, res) => {
    if (!yapClient) {
      return res.status(503).json({ error: 'Yap is not configured (set YAP_BASE_URL)' });
    }

    const { channel: rawChannel, message, nick: rawNick } = req.body || {};
    const channel = normalizeYapChannel(rawChannel || DEFAULT_COLLECTIVE_CHANNEL);
    if (!channel) {
      return res.status(400).json({ error: 'A valid channel name is required' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_SAY_LENGTH) {
      return res.status(400).json({ error: `message exceeds maximum length of ${MAX_SAY_LENGTH}` });
    }

    const nick = (typeof rawNick === 'string' && nickFromWorkspaceName(rawNick))
      ? nickFromWorkspaceName(rawNick)
      : DEFAULT_HUMAN_NICK;

    try {
      const result = await yapClient.say(channel, nick, message);
      res.json({ ok: true, id: result.id ?? null, timestamp: result.timestamp ?? null });
    } catch (error) {
      console.error('Collective say error:', error.message);
      res.status(502).json({ error: 'Could not post to Yap', detail: error.detail || null });
    }
  });

  return router;
}
