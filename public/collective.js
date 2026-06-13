/**
 * Collective Page Client-Side Logic (LIN-450, V1).
 *
 * - Hydration of config from window.__COLLECTIVE_DATA__
 * - Start a discussion: collect selected workspaces + channel + topic + target,
 *   POST to /collective/start (multi-workspace dispatch fan-out)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ms).toLocaleDateString();
}

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
    const body = msg.message || '';
    const time = relativeTime(msg.timestamp);

    li.innerHTML = `
      <span class="collective-msg-nick">${escapeHtml(nick)}</span>
      <span class="collective-msg-body">${escapeHtml(body)}</span>
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

  const checks = Array.from(document.querySelectorAll('.collective-ws-check:checked'));
  const workspaceUrlKeys = checks.map(c => c.value);
  if (workspaceUrlKeys.length === 0) {
    setStartStatus('Select at least one workspace.', true);
    return;
  }

  const channel = (document.getElementById('collective-channel')?.value || '').trim();
  const topic = (document.getElementById('collective-topic')?.value || '').trim();
  const target = document.getElementById('collective-target')?.value || 'cli';

  const btn = document.getElementById('collective-start');
  if (btn) { btn.disabled = true; btn.textContent = 'dispatching…'; }
  setStartStatus('');

  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/collective/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceUrlKeys, channel, topic, target }),
    });
    if (res.status === 401) { window.location.href = '/logout'; return; }
    const data = await res.json();
    if (!res.ok) {
      setStartStatus(data.error || 'Failed to start discussion.', true);
      return;
    }

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
    setStartStatus('Failed to start discussion.', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'start discussion'; }
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
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/collective/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, message }),
    });
    if (res.status === 401) { window.location.href = '/logout'; return; }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPollStatus(data.error || 'say failed');
      return;
    }
    input.value = '';
    // If we weren't already watching this channel, start now.
    if (!activeChannel) startPolling(channel);
    else pollState();
  } catch (e) {
    console.error('Say failed:', e);
    setPollStatus('say failed');
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
