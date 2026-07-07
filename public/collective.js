/**
 * Collective Page Client-Side Logic (LIN-450, V1; character picker LIN-1048).
 *
 * - Hydration of config from window.__COLLECTIVE_DATA__ (incl. saved characters)
 * - Start a discussion: collect selected characters + channel + topic + target,
 *   POST to /collective/start (character fan-out)
 * - Define a new character: repo + five persona fields + name (+ save), added to
 *   the picker as a selectable row
 * - Launch a preset meeting (LIN-1050): expand a built-in/custom preset's
 *   repo-agnostic roster against one chosen repo, replace the character picker
 *   with it (chair seat placed first — see launchPreset), and thread the
 *   preset's objective/exitCondition/defaultTopic into the SAME start flow
 * - Live transcript: visibility-gated 5s poll of /api/collective/state, rendered
 *   incrementally by Yap cursor (copied from the pipeline poll pattern)
 * - Inject human input: POST to /api/collective/say
 *
 * Loaded only on the /collective page. Requires common.js (provides escapeHtml).
 */

let collectiveData = null;
let pollId = null;
let visibilityHandler = null;
let cursor = 0;
let activeChannel = null;

const POLL_MS = 5000;
const seenIds = new Set();

// Characters defined in-page this session (not yet persisted). Keyed by a local
// `pending-N` id so a checked row maps back to the full persona object.
const pendingById = new Map();
let pendingSeq = 0;

// Active preset launch context (LIN-1050): set by launchPreset(), read by
// startDiscussion() to thread facilitator/objective/exitCondition into the
// SAME /start POST — there is no second dispatch path. null when no preset is
// active (the pre-LIN-1050 manual-character flow is byte-identical).
let activePreset = null;

// ─── Character selection ──────────────────────────────────────────────────────

// Resolve a checked row's id to its full character object — either a stored
// character from the embedded config or an in-page pending one.
function characterById(id) {
  if (pendingById.has(id)) return pendingById.get(id);
  return (collectiveData?.characters || []).find(c => c.id === id) || null;
}

function selectedCharacters() {
  const checks = Array.from(document.querySelectorAll('.collective-char-check:checked'));
  return checks.map(c => characterById(c.value)).filter(Boolean);
}

// Build a character from the define-new form and add it to the picker as a
// checked (selected) row so the next start includes it.
function addDefinedCharacter() {
  // A manual add customizes beyond the preset, so drop any active preset
  // context — otherwise a stale facilitator/objective could get threaded into
  // a roster the user is now hand-assembling.
  activePreset = null;

  const repo = document.getElementById('collective-char-repo');
  if (!repo || !repo.value) {
    setStartStatus('Pick a repo to ground the character in.', true);
    return;
  }
  const workspaceUrlKey = repo.value;
  const workspaceName = repo.selectedOptions[0]?.dataset.name || '';
  const name = (document.getElementById('collective-char-name')?.value || '').trim();
  const save = !!document.getElementById('collective-char-save')?.checked;

  const persona = {};
  document.querySelectorAll('.collective-char-persona').forEach(inp => {
    const v = (inp.value || '').trim();
    if (v) persona[inp.dataset.field] = v;
  });

  const id = `pending-${pendingSeq++}`;
  pendingById.set(id, { id, workspaceUrlKey, workspaceName, name, save, ...persona });

  const list = document.getElementById('collective-char-list');
  if (list) {
    list.querySelector('.collective-char-none')?.remove();
    const label = document.createElement('label');
    label.className = 'collective-char-row';
    label.dataset.testid = 'collective-character';
    label.dataset.kind = save ? 'custom' : 'recent';
    // value is a controlled `pending-N` token; user strings go in via textContent.
    label.innerHTML = '<input type="checkbox" class="collective-char-check" checked>'
      + '<span class="collective-char-name"></span>'
      + '<span class="collective-char-repo"></span>'
      + '<span class="collective-char-kind">new</span>';
    label.querySelector('.collective-char-check').value = id;
    label.querySelector('.collective-char-name').textContent = name || persona.role || 'Implementer';
    label.querySelector('.collective-char-repo').textContent = workspaceName;
    list.appendChild(label);
  }

  // Reset the form for the next character.
  const nameEl = document.getElementById('collective-char-name');
  if (nameEl) nameEl.value = '';
  document.querySelectorAll('.collective-char-persona').forEach(inp => { inp.value = ''; });
  const saveEl = document.getElementById('collective-char-save');
  if (saveEl) saveEl.checked = false;
  setStartStatus('');
}

// ─── Preset launch (LIN-1050) ─────────────────────────────────────────────────

function presetById(id) {
  return (collectiveData?.presets || []).find(p => p.id === id) || null;
}

// Expand a preset's repo-agnostic roster against ONE chosen repo (the resolved
// design: a single repo backs the whole roster, not a per-seat binding),
// replace the character picker with the expanded roster, and remember the
// preset's meeting fields so startDiscussion() threads them into the SAME
// /start POST. A preset launch is a full swap of the picker, not an add-on —
// mixing an arbitrary hand-picked roster with a preset's would reopen the
// facilitator-ambiguity/>4-seat problems the preset exists to avoid.
//
// Facilitator-ordering fix (load-bearing, not cosmetic — LIN-1050 plan beat
// 3 §7): /start designates the facilitator as the FIRST characters[] entry
// whose workspaceUrlKey matches the `facilitator` body field. Every expanded
// seat here shares the SAME repoKey, so array order is the only
// disambiguator — the facilitator seat is inserted into the picker BEFORE
// every other seat.
function launchPreset(preset, repoKey) {
  if (!preset || !Array.isArray(preset.roster) || preset.roster.length === 0) {
    setStartStatus('That preset has no roster to launch.', true);
    return;
  }
  if (!repoKey) {
    setStartStatus('Pick a repo to launch this preset into.', true);
    return;
  }
  const repoSelect = document.getElementById('collective-preset-repo');
  const opt = Array.from(repoSelect?.options || []).find(o => o.value === repoKey);
  const workspaceName = opt?.dataset.name || '';

  // Full swap: clear whatever the picker currently holds (stored + pending).
  pendingById.clear();
  const list = document.getElementById('collective-char-list');
  if (list) list.innerHTML = '';

  const facilitatorSeat = preset.roster.find(s => s.isFacilitator);
  const restSeats = preset.roster.filter(s => !s.isFacilitator);
  const orderedSeats = facilitatorSeat ? [facilitatorSeat, ...restSeats] : restSeats;

  orderedSeats.forEach((seat, i) => {
    const id = `preset-${preset.id}-${i}`;
    const { isFacilitator, ...persona } = seat;
    pendingById.set(id, { id, workspaceUrlKey: repoKey, workspaceName, ...persona });

    if (list) {
      const label = document.createElement('label');
      label.className = 'collective-char-row';
      label.dataset.testid = 'collective-character';
      label.dataset.kind = 'preset';
      // value is a controlled `preset-<id>-N` token; user strings go in via textContent.
      label.innerHTML = '<input type="checkbox" class="collective-char-check" checked>'
        + '<span class="collective-char-name"></span>'
        + '<span class="collective-char-repo"></span>'
        + '<span class="collective-char-kind"></span>';
      label.querySelector('.collective-char-check').value = id;
      label.querySelector('.collective-char-name').textContent = seat.name || seat.role || 'Implementer';
      label.querySelector('.collective-char-repo').textContent = workspaceName;
      label.querySelector('.collective-char-kind').textContent = isFacilitator ? 'chair' : 'preset';
      list.appendChild(label);
    }
  });

  // The chair seat is always bound to the same chosen repo, so `facilitator`
  // names that repo — combined with the ordering above, /start's "first match
  // wins" pre-pass resolves to exactly the marked seat.
  activePreset = {
    facilitator: facilitatorSeat ? repoKey : null,
    objective: preset.objective || null,
    exitCondition: preset.exitCondition || null,
  };

  const topicEl = document.getElementById('collective-topic');
  if (topicEl && preset.defaultTopic) topicEl.value = preset.defaultTopic;

  setStartStatus(`Loaded "${preset.name}" (${orderedSeats.length} seat${orderedSeats.length === 1 ? '' : 's'}) — review and start when ready.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// relativeTime is canonical in common.js (window.relativeTime, LIN-421) and is
// polymorphic over ISO strings / millisecond numbers; called here via the bare
// global (msg.timestamp is ms). Converges onto the shared "Behavior B" format.

function setStartStatus(text, isError) {
  const el = document.getElementById('collective-start-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

function setPollStatus(text) {
  const el = document.getElementById('collective-poll-status');
  if (el) el.textContent = text || '';
}

// ─── Transcript rendering ───────────────────────────────────────────────────

function appendMessages(messages) {
  const list = document.getElementById('collective-transcript');
  const empty = document.getElementById('collective-transcript-empty');
  if (!list) return;

  let added = 0;
  for (const msg of messages) {
    const id = msg.id;
    if (id != null && seenIds.has(id)) continue;
    if (id != null) seenIds.add(id);

    const li = document.createElement('li');
    li.className = 'collective-msg';
    if (msg.type === 'action') li.classList.add('collective-msg-action');

    const nick = msg.nick || '?';
    const body = msg.text || '';
    const time = relativeTime(msg.timestamp);

    // Speaker → neutral role StatusPill; body → inset Surface (LIN-861). The old
    // per-page hook classes ride along as `className` so the E2E selectors and the
    // IRC label-column / action-time layout rules in collective.css still apply.
    const nickPill = renderStatusPill({ label: nick, variant: 'tag', className: 'collective-msg-nick' });
    const bodySurface = renderSurface({
      body: escapeHtml(body),
      variant: 'inset',
      as: 'span',
      className: 'collective-msg-body',
    });

    li.innerHTML = `
      ${nickPill}
      ${bodySurface}
      <span class="collective-msg-time">${escapeHtml(time)}</span>`;
    list.appendChild(li);
    added += 1;
  }

  if (added > 0 && empty) empty.classList.add('hidden');

  // Follow the feed to the bottom when the user is already near it.
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  if (added > 0 && nearBottom) {
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollState() {
  if (!collectiveData || !activeChannel) return;
  const urlKey = collectiveData.urlKey;
  if (!urlKey) return;

  try {
    const url = `/workspace/${encodeURIComponent(urlKey)}/api/collective/state`
      + `?channel=${encodeURIComponent(activeChannel)}&since=${cursor}`;
    // Raw fetch carve-out: this is a background poller with bespoke per-status
    // handling (503 → "Yap not configured", non-ok → "● disconnected") that
    // window.api()'s throw-on-non-2xx path can't express; it must stay on raw
    // fetch so a transient poll failure degrades the status line, not the page.
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = '/logout';
      return;
    }
    if (res.status === 503) {
      setPollStatus('Yap not configured');
      return;
    }
    if (!res.ok) {
      setPollStatus('● disconnected');
      return;
    }

    const data = await res.json();
    if (data.truncated) {
      // Buffer rolled past us — reset cursor and seen set to catch up cleanly.
      cursor = 0;
      seenIds.clear();
    }
    appendMessages(data.messages || []);
    if (typeof data.cursor === 'number') cursor = data.cursor;
    setPollStatus('● live');
  } catch (e) {
    setPollStatus('● disconnected');
    console.warn('Collective poll failed:', e);
  }
}

function startPolling(channel) {
  activeChannel = channel;
  cursor = 0;
  seenIds.clear();
  const label = document.getElementById('collective-channel-label');
  if (label) label.textContent = channel;

  if (pollId) clearInterval(pollId);
  pollState();
  pollId = setInterval(() => {
    if (!document.hidden) pollState();
  }, POLL_MS);

  if (!visibilityHandler) {
    visibilityHandler = () => { if (!document.hidden) pollState(); };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

// ─── Start a discussion ─────────────────────────────────────────────────────

async function startDiscussion() {
  const urlKey = collectiveData?.urlKey;
  if (!urlKey) return;

  const characters = selectedCharacters();
  if (characters.length === 0) {
    setStartStatus('Select or define at least one character.', true);
    return;
  }

  const channel = (document.getElementById('collective-channel')?.value || '').trim();
  const topic = (document.getElementById('collective-topic')?.value || '').trim();
  const target = document.getElementById('collective-target')?.value || 'cli';

  const btn = document.getElementById('collective-start');
  if (btn) { btn.disabled = true; btn.textContent = 'dispatching…'; }
  setStartStatus('');

  // A launched preset's meeting fields ride the SAME POST — no second dispatch
  // path (LIN-1050). Omitted entirely when no preset is active, so the manual
  // character flow's request body is byte-identical to pre-LIN-1050.
  const body = { characters, channel, topic, target };
  if (activePreset) {
    if (activePreset.facilitator) body.facilitator = activePreset.facilitator;
    if (activePreset.objective) body.objective = activePreset.objective;
    if (activePreset.exitCondition) body.exitCondition = activePreset.exitCondition;
  }

  try {
    // Default on401 (→ /logout) matches the prior manual redirect. Server
    // errors throw with .body; the catch surfaces data.error inline as before.
    const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/collective/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const ok = (data.dispatched || []).filter(d => d.ok);
    const failed = (data.dispatched || []).filter(d => !d.ok);
    const nicks = ok.map(d => d.nick).join(', ');
    let summary = `dispatched ${ok.length} participant${ok.length === 1 ? '' : 's'} to ${data.channel}`;
    if (nicks) summary += ` (${nicks})`;
    if (failed.length) summary += ` · ${failed.length} failed`;
    setStartStatus(summary, failed.length > 0);

    startPolling(data.channel);
  } catch (e) {
    console.error('Start failed:', e);
    setStartStatus((e.body && e.body.error) || 'Failed to start discussion.', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'start discussion'; }
  }
}

// ─── View & copy the participant prompt ──────────────────────────────────────

async function viewPrompt() {
  const urlKey = collectiveData?.urlKey;
  if (!urlKey) return;

  const channel = (document.getElementById('collective-channel')?.value || '').trim();
  const topic = (document.getElementById('collective-topic')?.value || '').trim();
  const wrap = document.getElementById('collective-prompt-wrap');
  const pre = document.getElementById('collective-prompt-preview');
  const btn = document.getElementById('collective-view-prompt');

  // Thread the first selected character so the preview matches what that
  // participant will actually be dispatched (LIN-1048). None selected → the
  // server builds the default participant preview, as before.
  const character = selectedCharacters()[0] || null;

  if (btn) { btn.disabled = true; btn.textContent = 'loading…'; }
  try {
    const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/collective/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, topic, character }),
    });
    if (pre) pre.textContent = data.prompt || '';
    if (wrap) wrap.classList.remove('hidden');
  } catch (e) {
    console.error('Preview failed:', e);
    setStartStatus((e.body && e.body.error) || 'Could not build the prompt.', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'view prompt'; }
  }
}

async function copyPrompt() {
  const pre = document.getElementById('collective-prompt-preview');
  const btn = document.getElementById('collective-prompt-copy');
  if (!pre || !btn) return;
  try {
    await navigator.clipboard.writeText(pre.textContent || '');
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
  } catch (e) {
    console.error('Copy failed:', e);
    btn.textContent = 'failed';
    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
  }
}

// ─── Inject human input ─────────────────────────────────────────────────────

async function sayMessage() {
  const urlKey = collectiveData?.urlKey;
  const input = document.getElementById('collective-say-input');
  if (!urlKey || !input) return;

  const message = input.value.trim();
  if (!message) return;
  const channel = activeChannel || (document.getElementById('collective-channel')?.value || '').trim();
  if (!channel) return;

  const btn = document.getElementById('collective-say-btn');
  if (btn) btn.disabled = true;

  try {
    await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/collective/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, message }),
    });
    input.value = '';
    // If we weren't already watching this channel, start now.
    if (!activeChannel) startPolling(channel);
    else pollState();
  } catch (e) {
    console.error('Say failed:', e);
    setPollStatus((e.body && e.body.error) || 'say failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Initialization ─────────────────────────────────────────────────────────

function init() {
  collectiveData = window.__COLLECTIVE_DATA__;
  if (!collectiveData) {
    console.warn('Collective: no initial data');
    return;
  }

  document.getElementById('collective-start')?.addEventListener('click', startDiscussion);
  document.getElementById('collective-char-add')?.addEventListener('click', addDefinedCharacter);
  document.getElementById('collective-preset-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.collective-preset-launch');
    if (!btn) return;
    const preset = presetById(btn.dataset.presetId);
    const repoKey = document.getElementById('collective-preset-repo')?.value || '';
    launchPreset(preset, repoKey);
  });
  document.getElementById('collective-view-prompt')?.addEventListener('click', viewPrompt);
  document.getElementById('collective-prompt-copy')?.addEventListener('click', copyPrompt);
  document.getElementById('collective-say-btn')?.addEventListener('click', sayMessage);
  document.getElementById('collective-say-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sayMessage(); }
  });

  // If Yap is configured, begin watching the default channel immediately so a
  // discussion already in progress (or started elsewhere) shows up.
  if (collectiveData.yapConfigured && collectiveData.defaultChannel) {
    startPolling(collectiveData.defaultChannel);
  }
}

window.addEventListener('beforeunload', () => {
  if (pollId) { clearInterval(pollId); pollId = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
});

document.addEventListener('DOMContentLoaded', init);
