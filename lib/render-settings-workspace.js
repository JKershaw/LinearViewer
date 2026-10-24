/**
 * Settings › workspace areas built from the shell's rows (LIN-3846): Running,
 * Agent access and Change log. (Sources, Models and Health keep the existing
 * builders in render-settings.js, which they wrap.)
 *
 * Who a setting affects is in the group title; a change for everyone asks why
 * in place (`askInPlace` with `askWhy`) and lands in the change log. Halt is a
 * request the runner honours, so the controls are owner-only: a member sees
 * the state and a note instead of the buttons. The routes refuse a member too
 * (routes/settings.js, lib/runner-owner-gate.js); the note is not the guard.
 */

import { escapeHtml } from './utils/html.js';
import { drillRow, actionRow, askInPlace, group } from './render-settings-shell.js';

const workspaceUrl = (urlKey, suffix) => `/workspace/${encodeURIComponent(urlKey)}${suffix}`;

const staticRow = (label, valueHtml, testid = '') =>
  `
      <div class="settings-row settings-row-static line"${testid ? ` data-testid="${escapeHtml(testid)}"` : ''}>
        <span class="settings-row-label">${escapeHtml(label)}</span>
        <span class="settings-row-value">${valueHtml}</span>
      </div>`;

const noteHtml = (text, testid = '') => `<p class="settings-note"${testid ? ` data-testid="${escapeHtml(testid)}"` : ''}>${escapeHtml(text)}</p>`;

function formatWhen(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

const HALT_VALUE = { none: 'Running', pause: 'Paused', stop: 'Stopped' };

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export function runningBody({
  urlKey, workspaceName = 'this workspace', isOwner = false, runSetup = false, hasRunner = false,
  lastPoll = null, haltMode = 'none', periodicals = false, error = null, changed = null
}) {
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (changed ? `<p class="settings-note settings-flash" data-testid="settings-flash">${escapeHtml(changed)}</p>` : '');

  const runnerRows = hasRunner
    ? `${staticRow('Last poll', lastPoll ? `${escapeHtml(formatWhen(lastPoll.at))} · ${escapeHtml(lastPoll.kind)}` : 'not seen yet', 'settings-runner-last-poll')}${actionRow({ label: 'Runner set-up guide', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-guide' })}${actionRow({ label: 'New runner prompt', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-new-prompt' })}`
    : (runSetup ? actionRow({ label: 'Set up a runner', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-setup' }) : '');
  const runnerNote = hasRunner
    ? 'Last poll is the runner key’s last use: Harbour gets no heartbeat from the runner, so this says nothing about whether it is up. A new runner prompt does not revoke the old key; that works until it expires or you revoke it. Run buttons show for the workspace owner.'
    : (runSetup ? 'No runner yet. Run buttons appear for the workspace owner once one is set up.' : 'No runner yet. The workspace owner can set one up.');
  const runner = group({ title: 'Runner', testid: 'settings-section-runner', rowsHtml: runnerRows, note: runnerNote });

  // Pause / stop / resume: owner-only, asked in place with a reason.
  const haltAction = urlKeyPath => workspaceUrl(urlKey, urlKeyPath);
  const haltForm = (mode, summary, willHappen, confirmLabel, tone) => askInPlace({
    summary, willHappen, askWhy: true, tone, confirmLabel,
    action: haltAction('/settings/running/halt'), fields: [['mode', mode]], testid: `settings-halt-${mode}`
  });
  let haltRows = staticRow('Runs', escapeHtml(HALT_VALUE[haltMode] || HALT_VALUE.none), 'settings-halt-state');
  if (isOwner) {
    if (haltMode !== 'pause') haltRows += haltForm('pause', 'Pause runs', 'New steps wait. Steps already running carry on. The runner applies this on its next poll.', 'Pause runs', 'red');
    if (haltMode !== 'stop') haltRows += haltForm('stop', 'Stop runs', 'Running sessions are stopped too. The queue is not cleared. The runner applies this on its next poll.', 'Stop runs', 'red');
    if (haltMode !== 'none') haltRows += haltForm('resume', 'Resume runs', 'Runs start again. The runner applies this on its next poll.', 'Resume runs', 'teal');
  }
  const periodicalsRow = askInPlace({
    summary: periodicals ? 'Turn off periodic reviews' : 'Turn on periodic reviews',
    willHappen: periodicals
      ? 'Periodic reviews stop appearing on Home for everyone in this workspace.'
      : 'Periodic reviews appear on Home for everyone in this workspace.',
    askWhy: true, tone: 'teal', confirmLabel: periodicals ? 'Turn off' : 'Turn on',
    action: workspaceUrl(urlKey, '/settings/workspace-features'),
    fields: [['feature', 'periodicals'], ['enabled', periodicals ? 'false' : 'true']],
    testid: 'settings-toggle-periodicals'
  });
  const everyone = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-workspace-features',
    rowsHtml: `${haltRows}${staticRow('Periodic reviews', periodicals ? 'On' : 'Off', 'settings-periodicals-state')}${periodicalsRow}`,
    note: `Pausing or stopping is for the workspace owner${isOwner ? '' : ' (you are not the owner, so these buttons are hidden)'}. Periodic reviews are 16 weekly templates you run by hand from Home; nothing runs them on a schedule. Every change here asks why and goes into the change log, where it can be undone.`
  });

  const links = group({
    title: 'Queue',
    rowsHtml: drillRow({ label: 'Queue and history', value: 'Dispatch', href: workspaceUrl(urlKey, '/dispatch'), testid: 'settings-link-dispatch' })
  });
  return `${flash}${runner}${everyone}${links}`;
}

// ---------------------------------------------------------------------------
// Agent access
// ---------------------------------------------------------------------------

function keyRow(k) {
  const expiry = k.expiresAt ? `expires ${formatWhen(k.expiresAt)}` : 'no expiry';
  const used = k.lastUsedAt ? `last used ${formatWhen(k.lastUsedAt)}` : 'never used';
  const owner = k.hasOwner ? '' : ' · no owner · re-issue';
  const revoke = k.revoke.allowed
    ? `<button type="button" class="action-btn settings-action-red settings-key-revoke" data-revoke-route="${escapeHtml(k.revoke.route)}" data-testid="settings-key-revoke">Revoke this key</button><p class="settings-ask-text">Anything using this key stops working. This cannot be undone.</p>`
    : `<p class="settings-note" data-testid="settings-key-owner-only">${escapeHtml(k.revoke.ownerOnlyNote)}</p>`;
  const body = `
          <p class="settings-ask-text">${escapeHtml(k.can)}${k.label ? ` · ${escapeHtml(k.label)}` : ''}</p>
          <p class="settings-ask-text">${escapeHtml(expiry)} · ${escapeHtml(used)}${escapeHtml(owner)}</p>${revoke}`;
  return drillRow({
    label: k.waiting ? `${k.kind} (waiting to be used)` : k.kind,
    value: `${k.lastUsedAt ? used : expiry}${k.hasOwner ? '' : ' · no owner'}`,
    bodyHtml: body, testid: `settings-key-${k.source}`
  });
}

function newKeyBody(urlKey) {
  return `
          <form class="settings-form settings-newkey-form" data-newkey-route="${escapeHtml(workspaceUrl(urlKey, '/api/proxy/tokens'))}" data-testid="settings-newkey-form">
            <label class="settings-ask-label">Name <input type="text" name="label" maxlength="100" class="settings-newkey-label" placeholder="What is it for?"></label>
            <label class="settings-ask-label"><input type="radio" name="scope" value="read" checked> Read</label>
            <label class="settings-ask-label"><input type="radio" name="scope" value="readWrite"> Read and update</label>
            <p class="settings-ask-text">It lasts 90 days and is shown once. Keys that can start runs are minted by the workspace owner only, from the agent prompt.</p>
            <button type="submit" class="action-btn settings-newkey-submit" data-testid="settings-newkey-submit">Create key</button>
            <p class="settings-newkey-secret" data-testid="settings-newkey-secret" hidden></p>
          </form>`;
}

export function agentAccessBody({ urlKey, keys = [], workspaceName = 'this workspace', modelWrites = false, error = null, changed = null }) {
  const list = keys.length
    ? keys.map(keyRow).join('')
    : staticRow('Keys', 'none yet', 'settings-keys-empty');
  const keysGroup = group({
    title: 'Keys that can get into this workspace',
    testid: 'settings-section-keys',
    rowsHtml: `${list}${drillRow({ label: 'New key', value: 'Read, or read and update', bodyHtml: newKeyBody(urlKey), testid: 'settings-newkey' })}`,
    note: 'One list from the Proxy and Dispatch stores. Each says what it can do, never where it came from.'
  });
  const links = group({
    title: 'Related',
    rowsHtml: `${drillRow({ label: 'Event log', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy#events'), testid: 'settings-link-events' })}${drillRow({ label: 'Agent prompt', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy'), testid: 'settings-link-agent-prompt' })}`
  });
  // LIN-3854: whether agents with a read-write proxy token may change model routing. For everyone,
  // so it asks why in place and is logged (no proxy endpoint can change it).
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (changed ? '<p class="settings-note settings-flash" data-testid="settings-flash">Saved.</p>' : '');
  const modelWritesGroup = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-agent-models',
    rowsHtml: `${staticRow('Agents can change models', modelWrites ? 'On' : 'Off', 'settings-modelRoutingProxyWrites-state')}${askInPlace({
      summary: modelWrites ? 'Stop agents changing models' : 'Let agents change models',
      willHappen: modelWrites
        ? 'Agents with a read-write proxy token can only read the model table again.'
        : 'Agents with a read-write proxy token can change which model each job runs on, apply a preset or undo a change. Every change they make is logged and can be undone.',
      askWhy: true, tone: modelWrites ? 'red' : 'teal', confirmLabel: modelWrites ? 'Turn off' : 'Turn on',
      action: workspaceUrl(urlKey, '/settings/workspace-features'),
      fields: [['feature', 'modelRoutingProxyWrites'], ['enabled', modelWrites ? 'false' : 'true']],
      testid: 'settings-toggle-modelRoutingProxyWrites'
    })}`,
    note: 'Off by default, and no proxy endpoint can change this switch. Any member may change it; the change goes into the change log.'
  });
  return `${flash}${keysGroup}${modelWritesGroup}${links}`;
}

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

function changeRow(row, { urlKey, isOwner }) {
  const meta = `${row.actorName} · ${formatWhen(row.at)}${row.reason ? ` · “${row.reason}”` : ''}`;
  const labelHtml = `
        <span class="settings-row-label">${escapeHtml(row.summary)}<span class="settings-row-note">${escapeHtml(meta)}</span></span>`;
  let tail = '';
  if (row.kind === 'undo') tail = '<span class="settings-row-value">undo</span>';
  else if (row.undone) tail = '<span class="settings-row-value">undone</span>';
  else if (row.undoable) {
    if (row.setting === 'halt' && !isOwner) {
      tail = '<span class="settings-row-value" data-testid="settings-change-owner-only">Only the owner can undo this</span>';
    } else {
      return `
      <div class="settings-row settings-change-row" data-testid="settings-change-${escapeHtml(row.source)}" data-change-id="${escapeHtml(row.id)}">${labelHtml}
        ${askInPlace({
          summary: 'Undo', willHappen: 'This puts the setting back as it was before this change, and is logged as a new entry. It is refused if the setting has changed since.',
          askWhy: true, tone: 'teal', confirmLabel: 'Undo this change',
          action: workspaceUrl(urlKey, `/settings/change-log/${encodeURIComponent(row.source)}/${encodeURIComponent(row.id)}/undo`),
          testid: `settings-undo-${row.id}`
        })}
      </div>`;
    }
  }
  return `
      <div class="settings-row settings-row-static line settings-change-row" data-testid="settings-change-${escapeHtml(row.source)}" data-change-id="${escapeHtml(row.id)}">${labelHtml}
        ${tail}
      </div>`;
}

export function changeLogBody({ urlKey, rows = [], isOwner = false, error = null, undone = null }) {
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (undone ? '<p class="settings-note settings-flash" data-testid="settings-flash">Change undone.</p>' : '');
  const body = rows.length
    ? rows.map(r => changeRow(r, { urlKey, isOwner })).join('')
    : staticRow('Changes', 'none yet', 'settings-change-empty');
  return `${flash}${group({
    title: 'Changes made for everyone',
    testid: 'settings-section-change-log',
    rowsHtml: body,
    note: 'Every change that affects everyone in the workspace, from any area, newest first. Model routing changes are listed here too. Key changes, custom prompts and sources are not settings changes and are not logged.'
  })}`;
}
