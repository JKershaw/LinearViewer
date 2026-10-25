/**
 * Feedback intake route (LIN-3893, LIN-2246: extracted from workspace-api.js):
 * POST /api/feedback, with its per-account limiter, its body parser and the
 * constants and helpers only it uses. `registerFeedbackRoutes` puts it on the router
 * createWorkspaceApiRoutes hands it, at the place the feedback block sat in that file
 * (after the scan routes, before the custom-prompts section), so the route table's
 * order and the path's `Allow` (POST) are unchanged. `feedbackSubmitLimiter` is
 * module-scoped here (one instance, however many routers are built) and re-exported
 * by workspace-api.js for its existing importers; the body parser is built per
 * router, inside the wrapper, as it was inside the composer.
 */
import { json } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { badRequest, jsonError } from '../lib/errors.js';
import { getProviderForWorkspace, getProvider } from '../lib/providers/registry.js';
import { refuseCapability } from './workspace-api-steps.js';
import { generatePrompt } from '../lib/prompt-templates.js';
import { PRIORITY_OPTION_LABELS } from '../lib/render.js';
import { attachProxyContext, isCodedGrantRefusal, codedGrantRefusalResponse } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff } from '../lib/prompts/autopilot-kickoff.js';
import { isRetryableRunLimit } from '../lib/plan-allowance.js';
import { resolveChatCredential, checkFreeTierGate, buildRunGate } from '../lib/chat-request.js';
import { parseFeedbackImage } from '../lib/attachment-upload.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from '../lib/dispatch-validation.js';
import { generateFeedbackTitle } from '../lib/feedback-title.js';
import { resolveIssueBinding } from '../lib/workspace.js';
import { resolveRunnerOwnerRefusal } from '../lib/runner-owner-gate.js';
import { shouldMockAi } from '../lib/should-mock-ai.js';
import { requestOriginOrNull, ORIGIN_UNRESOLVED_REFUSAL } from '../lib/public-origin.js';
import { buildMockFeedbackTitle } from '../lib/workspace-api-mocks.js';

// ===========================================================================
// Feedback intake constants (LIN-636 route / LIN-635 widget)
// ===========================================================================
//
// POST /workspace/:urlKey/api/feedback creates a fresh ticket from a feedback
// message — priority, captured page URL + browser, and an optional embedded
// screenshot — then enqueues a triage-style follow-up. It is the ONLY consumer
// of the provider `uploadFile` seam (LIN-636); the feedback widget (LIN-635)
// POSTs here.
//
// Body-size exception, scoped to THIS route only: the global
// `express.json({ limit: '250kb' })` (server.js) is left untouched. That
// global parser only matches `application/json`, so a larger body sent with a
// non-JSON content type (e.g. text/plain) passes through it unparsed; the
// per-route parser below (raised limit) then parses it. LIN-3635: that parser
// matches `text/plain` ONLY — the one type the widget sends — rather than every
// content type, so an arbitrary-type body of any size is no longer buffered. Small
// `application/json` bodies are already parsed by the global parser (larger
// ones are refused 413 there), so they keep the 250kb ceiling — the exception
// cannot leak to other routes.
// Open question (LIN-3635) settled by LIN-3907: the image cap is the one stated
// policy, and the body limit is derived from it. base64 turns the cap into
// ceil(cap * 4 / 3) bytes; the 512 KiB headroom covers the message (<= 10k
// characters, JSON-escaped up to ~60 KB), the title, and the url / userAgent
// fields, which validation does not bound. The 'image too large' arm below is
// reachable only while this limit stays above the cap's base64 size: at a lower
// limit the parser refuses first, as it did at 12mb (LIN-3907). The smaller
// buffer also answers LIN-669 M3 (a raw body and its decoded image held together).
export const MAX_FEEDBACK_IMAGE_BYTES = 7 * 1024 * 1024; // LIN-636 / LIN-3907: the single image policy, equal to the widget cap (LIN-635)
export const FEEDBACK_BODY_LIMIT = Math.ceil(MAX_FEEDBACK_IMAGE_BYTES * 4 / 3) + 512 * 1024;

// LIN-3635 (June review M3): per-ACCOUNT request budget on feedback intake, IP
// fallback when there is no session account (same keying as
// `defaultCopyTokenCreationLimiter`, routes/proxy.js). Not per-IP alone: the
// route is session-authenticated, so the abuser is an account and an office NAT
// would share one budget. 5 / 10 min is a judgment call for a human filing
// feedback (<= 30/hour/account, under the 50/hour free-tier net, so one account
// cannot exhaust the net through this route alone); the net's per-account share
// is LIN-3422. Exported so a test can drive the same instance. Mounted BEFORE
// workspaceFromUrl and the body parser; the skip is for the test environment only.
export const feedbackSubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions, please try again later' },
  keyGenerator: (req) => req.session?.accountId
    ? `account:${req.session.accountId}`
    : ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test'
});
const MAX_FEEDBACK_MESSAGE_LENGTH = 10_000;
const MAX_FEEDBACK_CONTEXT_LENGTH = 2_000; // url / userAgent clamp

// The three explicit post-create actions the feedback widget can request
// (LIN-918). Anything else (including an omitted action) is the legacy plain
// send, which files the ticket only (LIN-3848 removed the `feedbackTriage` flag).
const FEEDBACK_ACTIONS = new Set(['save', 'triage', 'autopilot']);

// Shared framing core: a widget-filed feedback ticket is a raw, un-triaged user
// report, not a scoped task (LIN-918 / LIN-947). Both the persisted description
// marker (LIN-947, stored ON the ticket) and the autopilot kickoff note (LIN-918,
// injected into a run) build on this one sentence so the "raw feedback" framing
// cannot drift apart between the two surfaces.
const FEEDBACK_ORIGIN_FRAMING =
  'this ticket was filed directly from the in-app feedback widget, so it is an ' +
  'unfiltered user report, not a triaged or scoped task';

// Feedback-origin brief injected into a feedback → autopilot kickoff (LIN-918).
// A scoped kickoff now also appends a non-empty caller `goal` as additional
// context (LIN-2818), but this call site passes none — it threads the framing in
// via the dedicated `originNote` seam, which stays the distinct, system-authored
// carrier. It tells the run the ticket is a raw, un-triaged user report whose
// first job is understanding.
const FEEDBACK_AUTOPILOT_ORIGIN_NOTE =
  `**Origin — raw feedback:** ${FEEDBACK_ORIGIN_FRAMING}. Before driving toward a fix, ` +
  'your first job is to *understand* it: read the report closely, reproduce or ground the problem ' +
  'against the current code, and work out what is actually being asked. Treat the description as a ' +
  'starting hypothesis, not a specification.';

// Persisted origin/triage marker written into every widget-filed feedback
// description (LIN-947). Unlike FEEDBACK_AUTOPILOT_ORIGIN_NOTE — which is only
// threaded into an autopilot run — this is stored ON the ticket, so the
// meta-prompt's next-action scorer sees the "raw, un-triaged" signal and routes
// to `triage` (sort intent, confirm priority, scope) instead of skipping ahead
// to look-into/research/implement on a report that only looks intentional.
const FEEDBACK_ORIGIN_TRIAGE_MARKER =
  `**Origin — raw feedback (triage first):** ${FEEDBACK_ORIGIN_FRAMING}. ` +
  'Its natural next step is **triage**: work out what is actually being asked, ' +
  'confirm the real priority, and scope it before any research or implementation.';

// Linear's priority scale is 0 (none) … 4 (low); anything outside it, or not a
// number, files as 0 ("No priority").
function normalizeFeedbackPriority(value) {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  const inScale = Number.isInteger(parsed) && parsed >= 0 && parsed <= 4;
  return inScale ? parsed : 0;
}

/**
 * The team a feedback ticket is filed under, or null when none can be found (the
 * caller answers that with a 422). First hit wins: an explicit body `teamId`,
 * then the `FEEDBACK_TEAM_ID` env, then the provider's first team.
 */
async function resolveFeedbackTeamId(provider, token, bodyTeamId) {
  const explicit = typeof bodyTeamId === 'string' ? bodyTeamId.trim() : '';
  if (explicit) return explicit;
  if (process.env.FEEDBACK_TEAM_ID) return process.env.FEEDBACK_TEAM_ID;
  const cannotListTeams = typeof provider.supports === 'function' && !provider.supports('fetchTeams');
  if (cannotListTeams) return null;
  try {
    const teams = await provider.fetchTeams(token);
    return (Array.isArray(teams) && teams[0]?.id) || null;
  } catch (err) {
    console.error('Feedback team resolution failed:', err.message);
    return null;
  }
}

// A factory run-limit refusal (LIN-3238) in the M4 feedback-widget shape
// `{ launched:false, code, retryable, message }`. RUN_LIMIT_REACHED is terminal;
// RUN_LIMIT_UNVERIFIED (the count could not be read) is retryable. `null` for
// any other error, so the caller keeps its existing logging path. The ticket is
// already filed — this only says why no run started.
function runLimitRefusal(err) {
  const limit = err ? err.runLimit : null;
  if (!limit) return null;
  return {
    launched: false,
    code: limit.code,
    retryable: isRetryableRunLimit(limit.code),
    message: limit.error
  };
}

// The first 400 a feedback body earns before any provider is consulted, or null:
// the model / harness overrides (LIN-1132), then the message.
function feedbackBodyRefusal({ model, harness, message }) {
  const override = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH })
    || validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
  if (override) return override.error;
  if (!message || typeof message !== 'string' || !message.trim()) return 'message is required';
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) return 'message exceeds maximum length';
  return null;
}

// The page URL and browser captured at submit time (LIN-635 S4), as a markdown
// tail for the ticket body. Both come from the client, so each is length-clamped
// and fenced as inline code so it cannot break the body. '' when neither was sent.
function feedbackCaptureBlock({ url, userAgent }) {
  const bullets = [['Page', url], ['Browser', userAgent]]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `- **${label}:** \`${value.trim().slice(0, MAX_FEEDBACK_CONTEXT_LENGTH)}\``);
  return bullets.length ? `\n\n---\n${bullets.join('\n')}` : '';
}

export function registerFeedbackRoutes(router, { workspaceFromUrl, freeTierStore, workspacePreferencesStore, dispatchQueueStore, proxyTokenStore, accountStore, workspaceOwnerCheck }) {
  // ===========================================================================
  // Feedback intake (LIN-636 route / LIN-635 widget) — constants above
  // ===========================================================================

  const feedbackBodyParser = json({ type: 'text/plain', limit: FEEDBACK_BODY_LIMIT });

  // What both post-create follow-ups hand `attachProxyContext`: the workspace
  // proxy block for the filed ticket. LIN-2354 / LIN-2804: provider identity and
  // capability summary come from the declared provider, fallback-free (unlike
  // the capability-shaping `getProviderForWorkspace` read elsewhere). LIN-1376:
  // `createdBy` stamps the launching account so the dispatched session's token
  // resolves under LIN-1366 owner-scoping.
  function feedbackProxyContext({ workspace, issue, baseUrl, session, label, prompt, harness }) {
    const declared = getProvider(workspace.provider)?.ui ?? null;
    return {
      proxyTokenStore,
      urlKey: workspace.urlKey,
      baseUrl,
      issueIdentifier: issue.identifier,
      prompt,
      label,
      harness,
      providerDisplayName: declared?.displayName ?? null,
      providerUi: declared,
      createdBy: session?.accountId || null
    };
  }

  // Why a follow-up that threw produced no run (LIN-3238 free-tier run limit),
  // logged once and handed back in the widget's `{ launched:false, ... }` shape.
  // `null` for any failure the caller should log as a plain enqueue error.
  function reportUnlaunched(lane, err, workspace, issue) {
    const refusal = runLimitRefusal(err);
    if (!refusal) return null;
    console.warn(`Feedback ${lane} not launched: ${refusal.code} (urlKey=${workspace.urlKey}, issue=${issue.identifier})`);
    return refusal;
  }

  // Best-effort triage follow-up after a feedback ticket is filed (LIN-635 S6),
  // on the existing dispatch substrate. Non-fatal: the ticket already exists, so
  // a failure here must not fail the submission. The caller invokes it only for
  // the explicit 'triage' action (LIN-733; the `feedbackTriage` flag was removed
  // in LIN-3848); the prompt always carries this workspace's API proxy block, as the proxy dispatch
  // endpoints' preamble does.
  async function enqueueFeedbackTriage(workspace, issue, priority, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier) return;
    try {
      const { prompt: basePrompt } = generatePrompt(
        'triage',
        { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, state: issue.state, priority, labels: [] },
        { project: null, parent: null, siblings: [] },
        {},
        getProviderForWorkspace(workspace)?.ui || null
      ) || {};
      if (!basePrompt) return;

      // LIN-1139 factory: model/harness resolve from workspace dispatchDefaults
      // (LIN-1138 — no user-supplied pair here beyond the widget override below,
      // LIN-1132) and a blank harness interposes claude-code (LIN-1164). The
      // proxy block is appended inside finalizePrompt, after the harness is
      // known, so its MCP-token-vs-prose branch can follow it (LIN-1155); a
      // single-use bootstrap token is minted per dispatch (LIN-376) and a failed
      // mint leaves the prompt unchanged, so triage still dispatches.
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        proxyTokenStore,
        kind: 'triage',
        // LIN-3238 free-tier run gate, built by the route at the dispatch point;
        // a refusal leaves the filed ticket intact.
        runGate: overrides.runGate || null,
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (harness) => attachProxyContext(
          feedbackProxyContext({ workspace, issue, baseUrl, session, harness, prompt: basePrompt, label: 'feedback-triage' })
        ),
        fields: {
          promptName: 'Triage',
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli',
          // LIN-3126 residual / LIN-3335: the created issue's own kind-only source,
          // so a reply/Close out on this run resolves the same provider. `?? null`,
          // never a `fields` spread (the LIN-3138 census forbids one here).
          issueSource: overrides.bindingPair?.issueSource ?? null
        }
      });
      return null;
    } catch (err) {
      const unlaunched = reportUnlaunched('triage', err, workspace, issue);
      if (unlaunched) return unlaunched;
      console.error('Feedback triage enqueue failed:', err.message);
      return null;
    }
  }

  // Best-effort autopilot follow-up (LIN-918): a SCOPED kickoff for the new
  // ticket carrying the feedback-origin brief through the dedicated `originNote`
  // seam (LIN-2818 lets a kickoff also take a caller `goal`; this system-authored
  // framing stays separate). Same substrate as triage with `kind: 'autopilot'`,
  // and not flag-gated — the user chose it in the widget. The kickoff relies on
  // the +proxy block for API access, so `attachProxyContext` (LIN-1157) mints it
  // here; the store appends the autopilot session-id block.
  //
  // LIN-3136 M4: the run holds the dispatch grant, owner-checked for the
  // submitting session. Resolves `{ launched: true }`, or `{ launched: false,
  // code, retryable, message }` when the run limit or that owner-checked mint
  // refuses (no grant-less fallback); every other failure is swallowed as null.
  // `baseUrl` is a real origin: the submit route refuses the lane first when none
  // resolves (LIN-3908), so there is no silent null guard here.
  async function enqueueFeedbackAutopilot(workspace, issue, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier) return null;
    try {
      const kickoff = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        originNote: FEEDBACK_AUTOPILOT_ORIGIN_NOTE,
        providerUi: getProvider(workspace.provider)?.ui ?? null
      });

      // Same factory contract as the triage twin: LIN-1139/1138 defaults, the
      // LIN-1164 harness interpose, LIN-376 single-use bootstrap minted inside
      // finalizePrompt once the harness is resolved (LIN-1155).
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        proxyTokenStore,
        kind: 'autopilot',
        // LIN-3238: a refusal leaves the filed ticket intact and mints nothing.
        runGate: overrides.runGate || null,
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (harness) => attachProxyContext({
          ...feedbackProxyContext({ workspace, issue, baseUrl, session, harness, prompt: kickoff, label: 'feedback-autopilot' }),
          // LIN-3136 M4: an orchestrator launch, owner-checked for this session.
          declaredGrants: ['dispatch'],
          declaredSite: 'M4',
          grantOwnerAccountId: session?.accountId || null,
          workspaceId: workspace.id
        }),
        fields: {
          promptName: `Autopilot — ${issue.identifier}`,
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli',
          // Same created-issue kind-only source as the triage twin (LIN-3126/3335).
          issueSource: overrides.bindingPair?.issueSource ?? null
        }
      });
      return { launched: true };
    } catch (err) {
      // The run-limit check precedes the grant branch: a run-limit THROW is not
      // a coded grant refusal.
      const unlaunched = reportUnlaunched('autopilot', err, workspace, issue);
      if (unlaunched) return unlaunched;
      if (isCodedGrantRefusal(err)) {
        const refusal = codedGrantRefusalResponse(err, 'an autopilot launch credential');
        console.warn(`Feedback autopilot not launched: ${refusal.code} (urlKey=${workspace.urlKey}, issue=${issue.identifier})`);
        return { launched: false, code: refusal.code, retryable: refusal.retryable, message: refusal.error };
      }
      console.error('Feedback autopilot enqueue failed:', err.message);
      return null;
    }
  }

  // Title resolution (LIN-643). An explicit title always wins (trimmed to
  // 250). Otherwise: when AI is enabled for this user/workspace, generate a
  // concise whole-thought title from the feedback body via the LLM; when AI
  // is off — or generation fails — keep the deterministic first-line slice.
  // Title generation must happen BEFORE provider.createIssue, and never
  // applies the 60-char truncation on the AI path. The post-create triage
  // enqueue is untouched. LIN-3635: the live LLM call is charged to the hourly
  // free-tier net (`checkFreeTierGate`) when it would bill the shared key; a
  // refusal or gate fault keeps the first-line title (the ticket is never
  // refused). Explicit titles and the mock path spend nothing, so are not charged.
  async function resolveFeedbackTitle(req, workspace, { title, message }) {
    if (typeof title === 'string' && title.trim()) {
      return title.trim().slice(0, 250);
    }
    let ticketTitle = `Feedback: ${message.trim().split('\n')[0].slice(0, 60)}`;
    // Key resolution mirrors the recommendation path: user OAuth > env >
    // free-tier. When only the shared free-tier key is available the model
    // is clamped to DEFAULT (forceDefault: isFreeTier), matching every other
    // billed call site (the LIN-513 wiring invariant).
    const mockAi = shouldMockAi(workspace);
    const { apiKey: aiApiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
    if (mockAi || aiApiKey) {
      try {
        if (mockAi) {
          // LIN-2981: a test-mode/local session never reaches the live
          // streamChat call this wraps, matching the other workspace-API AI
          // call sites (routes/workspace-api*.js) that already branch on
          // shouldMockAi.
          ticketTitle = buildMockFeedbackTitle(message);
        } else {
          // A throw from the gate (store fault) lands in the catch below:
          // fail closed, no LLM call, fallback title.
          const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
          if (check) {
            console.warn(`Feedback AI title skipped, free-tier gate refused (urlKey=${workspace.urlKey}): ${check.reason}`);
            return ticketTitle;
          }
          const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'feedback-title', forceDefault: isFreeTier });
          const generated = await generateFeedbackTitle(message.trim(), { apiKey: aiApiKey, model, callMeta: { urlKey: workspace.urlKey } });
          if (generated) ticketTitle = generated;
        }
      } catch (error) {
        // Best-effort: never block ticket creation on title generation.
        console.error('Feedback AI title generation failed, using fallback:', error.message);
      }
    }
    return ticketTitle;
  }

  /**
   * Submit feedback as a new ticket, optionally with an embedded screenshot,
   * then run the widget's chosen post-create action (save / triage / autopilot).
   * @route POST /workspace/:urlKey/api/feedback
   */
  router.post('/workspace/:urlKey/api/feedback', feedbackSubmitLimiter, workspaceFromUrl, feedbackBodyParser, async (req, res) => {
    const { workspace } = req;
    // LIN-3240 (LIN-3126 §2) / LIN-3335: creation targets the workspace's default
    // (active) binding; the pair-era selector is gone, so `null` is the
    // source-only default. Provider call scope: a bare token for Linear/local
    // (byte-identical), or a { token, repo } GitHub App credential so createIssue
    // builds a request-time client from the installation token (LIN-713).
    // uploadFile is capability-gated off for GitHub; fetchTeams (via
    // resolveFeedbackTeamId) ignores its arg.
    const { provider, callScope: token } = resolveIssueBinding(workspace, null);
    const body = req.body || {};

    // The 400s that need no provider, first-error order: the widget's optional
    // per-dispatch model / harness overrides (LIN-1132) — checked with the opaque-
    // field helper the dispatch and proxy routes use (type, length, dangerous
    // characters; NOT a model registry; blank or absent is valid and falls
    // through to the factory's default) — then the message itself.
    const bodyRefusal = feedbackBodyRefusal(body);
    if (bodyRefusal) return badRequest.json(res, bodyRefusal);
    const { message, title, teamId, projectId, image, url, userAgent, model, harness } = body;
    const priority = normalizeFeedbackPriority(body.priority);

    // Clean 422 (never 500) when the workspace's provider can't do the op,
    // mirroring the proxy write surface.
    if (!provider.supports('createIssue')) {
      return refuseCapability(res, provider.name, 'createIssue', 'creating tickets');
    }
    if (image && !provider.supports('uploadFile')) {
      return refuseCapability(res, provider.name, 'uploadFile', 'file uploads');
    }

    const resolvedTeamId = await resolveFeedbackTeamId(provider, token, teamId);
    if (!resolvedTeamId) {
      return jsonError(res, 422, 'Could not resolve a team to file feedback against', {
        code: 'TEAM_UNRESOLVED', provider: provider.name,
      });
    }
    const resolvedProjectId = (typeof projectId === 'string' && projectId.trim()) || process.env.FEEDBACK_PROJECT_ID || null;

    try {
      // The message, then the page / browser capture block (LIN-635 S4).
      const parts = [message.trim() + feedbackCaptureBlock({ url, userAgent })];

      if (image) {
        const parsed = parseFeedbackImage(image);
        if (!parsed) return badRequest.json(res, 'image must be a base64 data URL');
        if (parsed.bytes.length > MAX_FEEDBACK_IMAGE_BYTES) return jsonError(res, 413, 'image too large');
        const assetUrl = await provider.uploadFile(token, parsed.bytes, {
          contentType: parsed.contentType,
          filename: parsed.filename,
        });
        parts.push(`![](${assetUrl})`);
      }

      // LIN-1557: an explicit non-default priority the provider's headless write
      // contract (apiWriteFields()) can't honour is folded into the description as
      // visible text, not dropped silently or refused — this is a fire-and-forget
      // human form with no retry loop, so a hard failure would mean the report is
      // never filed. 0 ("No priority") is indistinguishable from "unset", so it is
      // never folded or forwarded.
      const canSetPriority = provider.apiWriteFields().includes('priority');
      if (priority > 0 && !canSetPriority) {
        parts.push(`---\n**Reported priority:** ${PRIORITY_OPTION_LABELS[priority]}`);
      }

      // Origin/triage marker (LIN-947): always last, so the stored ticket announces
      // itself as raw, un-triaged feedback and the meta-prompt's triage routing
      // activates. It never alters the message, capture block or screenshot above.
      parts.push(`---\n${FEEDBACK_ORIGIN_TRIAGE_MARKER}`);

      const createInput = {
        teamId: resolvedTeamId,
        title: await resolveFeedbackTitle(req, workspace, { title, message }),
        description: parts.join('\n\n'),
      };
      if (resolvedProjectId) createInput.projectId = resolvedProjectId;
      if (priority > 0 && canSetPriority) createInput.priority = priority;

      const created = await provider.createIssue(token, createInput);
      if (!created?.success || !created.issue) {
        return jsonError(res, 502, 'Failed to create feedback ticket');
      }

      // Post-create action (LIN-918); every branch is best-effort and never fails
      // the submission, the ticket already existing. An explicit widget action picks the lane: 'save' files only,
      // 'triage' always enqueues triage, 'autopilot' enqueues a scoped autopilot run
      // carrying the feedback-origin brief. With none (the legacy plain send) the
      // ticket is filed only (LIN-3848).
      // LIN-3908: null when neither PUBLIC_ORIGIN nor a Host header gives an origin.
      const baseUrl = requestOriginOrNull(req);
      // LIN-3238 Q10 free-tier run gate: the title step's `isFreeTier` is scoped to
      // it, so re-derive it at the dispatch point. It goes to both enqueue helpers
      // through `overrides`; a refusal leaves the filed ticket intact and reports
      // why no run started.
      const { isFreeTier: feedbackIsFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
      const runGate = buildRunGate({ isFreeTier: feedbackIsFreeTier, freeTierStore, accountId: req.session?.accountId, accountStore });
      // LIN-3126 residual (producer sweep) / LIN-3335: the feedback rows are
      // issue-addressed and never reach the factory's §5.5a source inheritance (no
      // `followUpTo`), so each carries the created issue's kind-only source — from
      // the SAME resolved binding that produced `provider` / `token`, so the source
      // the issue is created in and the stamped one cannot drift. Selection-only
      // provenance, never a credential (B1).
      const overrides = { model, harness, runGate, bindingPair: provider?.name ? { issueSource: provider.name } : {} };

      // LIN-3383: both lanes enqueue a `cli` row for the owner's runner, so only the
      // workspace owner may start one. Checked only when a lane will actually run —
      // a plain filed ticket reports no refusal and a non-owner's feedback still
      // saves. A refusal skips the enqueue and rides the `{launched:false, code,
      // retryable, message}` response block below.
      // Only the three known actions branch (`save` names no lane); anything else,
      // an omitted action included, is the legacy plain send.
      const action = FEEDBACK_ACTIONS.has(body.action) ? body.action : null;
      const lane = action === 'save' ? null : action;
      const laneRefusal = lane && await resolveRunnerOwnerRefusal({
        ownerCheck: workspaceOwnerCheck,
        workspaceId: workspace.id,
        accountId: req.session?.accountId,
        target: 'cli'
      });
      let launch = null;
      if (laneRefusal) {
        launch = { launched: false, code: laneRefusal.code, retryable: laneRefusal.retryable, message: laneRefusal.error };
      } else if (lane && !baseUrl) {
        // LIN-3908: a feedback lane's run calls back to this workspace, so it needs an origin.
        // With no PUBLIC_ORIGIN and no Host header there is none, and the lane is refused here,
        // where the widget reports it, instead of queued with `http://undefined`.
        launch = { launched: false, ...ORIGIN_UNRESOLVED_REFUSAL };
      } else if (lane === 'triage') {
        launch = await enqueueFeedbackTriage(workspace, created.issue, priority, req.session, baseUrl, overrides);
      } else if (lane === 'autopilot') {
        launch = await enqueueFeedbackAutopilot(workspace, created.issue, req.session, baseUrl, overrides);
      }

      // LIN-3136 M4 / LIN-3238: the ticket is filed either way. A refused run launch
      // (autopilot keeps its key, triage gets a new one) is reported so the widget
      // can say why; every other outcome leaves the response as it was.
      return res.status(201).json({
        success: true,
        issue: created.issue,
        ...(launch?.launched === false ? { [lane]: launch } : {})
      });
    } catch (error) {
      console.error('Feedback submit error:', error);
      return jsonError(res, 500, 'Failed to submit feedback');
    }
  });
}
