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
  DEFAULT_COLLECTIVE_CHARACTER,
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
  yapClient,
  getOpenRouterSource,
  getDeployInfo,
}) {
  const router = Router();

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/collective', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors pipeline).
    if (featureFlags.collective !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const html = renderCollectivePage(
        {
          workspaces: (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name })),
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

    const { channel: rawChannel, workspaceUrlKeys, target: rawTarget, topic: rawTopic } = req.body || {};

    const channel = normalizeYapChannel(rawChannel || DEFAULT_COLLECTIVE_CHANNEL);
    if (!channel) {
      return res.status(400).json({ error: 'A valid channel name is required' });
    }

    const target = rawTarget || 'cli';
    if (!COLLECTIVE_TARGETS.includes(target)) {
      return res.status(400).json({ error: `target must be one of: ${COLLECTIVE_TARGETS.join(', ')}` });
    }

    if (!Array.isArray(workspaceUrlKeys) || workspaceUrlKeys.length === 0) {
      return res.status(400).json({ error: 'Select at least one workspace' });
    }

    // Resolve the selected subset against session.workspaces — never trust the
    // route key to bound the fan-out, and never dispatch to a workspace the user
    // isn't connected to.
    const connected = req.session.workspaces || [];
    const byKey = new Map(connected.map(w => [w.urlKey, w]));
    const selected = workspaceUrlKeys
      .filter((k, i) => typeof k === 'string' && workspaceUrlKeys.indexOf(k) === i) // dedupe
      .map(k => byKey.get(k))
      .filter(Boolean);

    if (selected.length === 0) {
      return res.status(400).json({ error: 'None of the selected workspaces are connected to this session' });
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

    // The fan-out iterates over CHARACTERS, not raw workspaces (LIN-1047, seam
    // for LIN-820). The default roster is exactly one generic Implementer
    // character per selected workspace — the DEFAULT_COLLECTIVE_CHARACTER, which
    // makes buildCollectiveParticipantPrompt emit output byte-for-byte identical
    // to the pre-refactor per-workspace dispatch. No multi-character roster or
    // selection exists yet; that is a later subtask (LIN-1048+).
    const participants = selected.map(ws => ({ ws, character: DEFAULT_COLLECTIVE_CHARACTER }));

    const dispatched = [];
    for (const { ws, character } of participants) {
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

    const { channel: rawChannel, topic: rawTopic, nick: rawNick } = req.body || {};
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

    const prompt = buildCollectiveParticipantPrompt({
      channel,
      nick: sampleNick,
      yapBaseUrl: yapClient?.baseUrl || process.env.YAP_BASE_URL || '',
      yapPassword: process.env.YAP_PASSWORD || null,
      topic,
      proxyBaseUrl: `${req.protocol}://${req.get('host')}`,
      proxyToken: 'YOUR_READWRITE_PROXY_TOKEN', // placeholder — real token minted at dispatch
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
