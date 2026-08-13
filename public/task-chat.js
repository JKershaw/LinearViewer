/**
 * Task Chat client (experimental).
 *
 * Drives the "talk to a task" page: enter a task identifier, ask it questions,
 * and stream its first-person answers. History lives here in the browser and is
 * replayed to the server on each turn (ephemeral — a reload starts fresh). The
 * SSE reader mirrors the roadmap chat consumer.
 */
(function () {
  'use strict';

  var data = window.__TASK_CHAT_DATA__ || {};
  var urlKey = data.urlKey || '';
  var savedChatsAvailable = data.savedChatsAvailable === true;
  // LIN-1910: the resolved provider hint carried from the dashboard's Chat
  // deep-link (lib/render.js chatHref), valid only while the input still
  // holds the SAME identifier it was minted for — see send() below.
  var prefillTask = data.defaultTask || '';
  var prefillSource = data.defaultSource || '';

  var idInput = document.getElementById('task-chat-id');
  var questionInput = document.getElementById('task-chat-question');
  var sendBtn = document.getElementById('task-chat-send');
  var transcript = document.getElementById('task-chat-transcript');
  var emptyState = document.getElementById('task-chat-empty');
  var activeLabel = document.getElementById('task-chat-active-label');
  var resetBtn = document.getElementById('task-chat-reset');

  // Saved chats (LIN-1008) — present only when a user identity is available.
  var saveBtn = document.getElementById('task-chat-save');
  var savedList = document.getElementById('task-chat-saved-list');
  var savedEmpty = document.getElementById('task-chat-saved-empty');

  if (!idInput || !questionInput || !sendBtn || !transcript) return;

  var chatHistory = [];   // [{ role, content }] for the active task
  var activeTask = '';     // the task identifier chatHistory belongs to
  var streaming = false;

  function readSSEStream(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (!part.trim()) continue;
          var type = 'message';
          var eventData = '';
          var lines = part.split('\n');
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (line.indexOf('event: ') === 0) type = line.slice(7);
            else if (line.indexOf('data: ') === 0) eventData = line.slice(6);
          }
          if (eventData) {
            try { onEvent(type, JSON.parse(eventData)); }
            catch (e) { onEvent(type, eventData); }
          }
        }
        return pump();
      });
    }
    return pump();
  }

  function setEmptyVisible(visible) {
    if (emptyState) emptyState.classList.toggle('hidden', !visible);
  }

  // Speaker → StatusPill: the user's "you" is a neutral tag chip that takes the
  // shared self-turn accent (chat-msg--you); the task's own turn reads as
  // in-progress (◐). Body → Surface, via the shared ChatUI helper (LIN-1298) —
  // the `task-chat-msg-*` classes ride along as hooks so the per-role colour
  // (now unified via chat.css) and E2E selectors still resolve. The streaming
  // cursor MUST stay on the SSE text node (`.task-chat-msg-body`, the element
  // send() writes textContent into), so it's the text span, not the wrapper,
  // that toggles `.chat-cursor`.
  function appendBubble(role, text) {
    var whoLabel = role === 'user' ? 'you' : (activeTask || 'task');
    var li = window.ChatUI.appendMessage(transcript, {
      who: whoLabel,
      whoState: role === 'user' ? undefined : 'in-progress',
      whoClass: 'task-chat-msg-who',
      self: role === 'user',
      text: text,
      textClass: 'task-chat-msg-body',
      bodyClass: 'task-chat-msg-surface',
      liClass: 'task-chat-msg task-chat-msg-' + role,
    });
    setEmptyVisible(false);
    return li.querySelector('.task-chat-msg-body');
  }

  // Human-readable label for a `tool` SSE breadcrumb (LIN-990). Derived from the
  // streamChatWithTools event shape ({ phase, name, arguments, error }). Returns
  // '' for phases we don't surface (e.g. 'result') so the caller can skip them.
  function toolBreadcrumbLabel(data) {
    if (!data || typeof data !== 'object') return '';
    var name = data.name || 'tool';
    var args = data.arguments || {};
    if (data.phase === 'call') {
      if (name === 'lookup_task' || name === 'get_relations') {
        return args.issueId ? 'looked up ' + args.issueId : name;
      }
      if (name === 'search_tasks') {
        return args.query ? 'searched "' + args.query + '"' : name;
      }
      if (name === 'send_follow_up') {
        // LIN-1073 review: this is the catalog's one WRITE tool — the generic
        // fallback below would hide a real side effect (a queued dispatch
        // follow-up) behind an anonymous tool name, so it must always name the
        // session it targeted and a snippet of what was sent.
        if (!args.sessionId) return name;
        var prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        var snippet = prompt ? ': "' + (prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt) + '"' : '';
        return 'sent a follow-up to session ' + args.sessionId + snippet;
      }
      return name;
    }
    if (data.phase === 'error') {
      return name + ' failed: ' + (data.error || 'unknown error');
    }
    if (data.phase === 'cap') {
      return 'reached the tool-lookup limit';
    }
    return '';
  }

  // Render a tool breadcrumb into the transcript. Breadcrumbs are surfaced to the
  // reader but are NOT chat history — they never enter `chatHistory` and are not
  // assistant content. Inserted BEFORE the (streaming) answer bubble so the log
  // reads: you → ↳ lookup → the task's answer.
  function appendToolBreadcrumb(label, beforeLi) {
    if (!label) return;
    window.ChatUI.appendNote(transcript, '↳ ' + label, { liClass: 'task-chat-tool', before: beforeLi });
    setEmptyVisible(false);
  }

  function resetConversation() {
    chatHistory = [];
    activeTask = '';
    transcript.innerHTML = '';
    if (activeLabel) activeLabel.textContent = '';
    if (resetBtn) resetBtn.classList.add('hidden');
    updateSaveVisibility();
    setEmptyVisible(true);
  }

  // ─── Saved chats (LIN-1008) ─────────────────────────────────────────────────

  // The save button appears once there is a non-empty conversation to save (and
  // only when saved chats are available at all — no button is rendered otherwise).
  function updateSaveVisibility() {
    if (!saveBtn) return;
    var canSave = savedChatsAvailable && !!activeTask && chatHistory.length > 0;
    saveBtn.classList.toggle('hidden', !canSave);
  }

  function renderSavedRows(chats) {
    if (!savedList) return;
    savedList.innerHTML = '';
    var hasChats = Array.isArray(chats) && chats.length > 0;
    if (savedEmpty) savedEmpty.classList.toggle('hidden', hasChats);
    if (!hasChats) return;

    chats.forEach(function (chat) {
      var li = document.createElement('li');
      li.className = 'task-chat-saved-item';
      li.setAttribute('data-saved-id', chat.id);

      var meta = chat.taskIdentifier ? chat.taskIdentifier : 'chat';
      var count = (chat.turnCount || 0) + ' turn' + (chat.turnCount === 1 ? '' : 's');
      var openBtn = '<button type="button" class="action-btn task-chat-saved-open" data-testid="task-chat-saved-open">open</button>';
      var delBtn = '<button type="button" class="action-btn task-chat-saved-delete" data-testid="task-chat-saved-delete">delete</button>';

      li.innerHTML =
        '<span class="task-chat-saved-meta">' + window.escapeHtml(meta) + '</span>' +
        '<span class="task-chat-saved-title">' + window.escapeHtml(chat.title || 'Saved chat') + '</span>' +
        '<span class="task-chat-saved-count">' + window.escapeHtml(count) + '</span>' +
        '<span class="task-chat-saved-actions">' + openBtn + delBtn + '</span>';

      savedList.appendChild(li);
    });
  }

  function loadSavedList() {
    if (!savedChatsAvailable || !savedList) return;
    window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/saved', { on401: false })
      .then(function (body) { renderSavedRows(body && body.chats); })
      .catch(function () { /* leave the empty state as-is on error */ });
  }

  function saveCurrentChat() {
    if (!savedChatsAvailable || !activeTask || chatHistory.length === 0) return;
    if (saveBtn) saveBtn.disabled = true;
    window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIdentifier: activeTask, transcript: chatHistory }),
      on401: false,
      toastOnError: true
    }).then(function () {
      loadSavedList();
      if (typeof window.toast === 'function') window.toast('Chat saved', { type: 'success' });
    }).catch(function () {
      /* error surfaced via toastOnError */
    }).then(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
  }

  // Resume: re-hydrate a saved transcript into the client and continue chatting
  // through the unchanged replay-each-turn model (there is no live session).
  function openSavedChat(id) {
    if (!id) return;
    window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/saved/' + encodeURIComponent(id), { on401: false })
      .then(function (body) {
        var chat = body && body.chat;
        if (!chat) return;
        chatHistory = (chat.transcript || []).map(function (t) { return { role: t.role, content: t.content }; });
        activeTask = chat.taskIdentifier || '';
        idInput.value = activeTask;
        transcript.innerHTML = '';
        chatHistory.forEach(function (turn) { appendBubble(turn.role, turn.content); });
        if (activeLabel) activeLabel.textContent = activeTask ? 'talking to ' + activeTask : '';
        if (resetBtn) resetBtn.classList.remove('hidden');
        setEmptyVisible(chatHistory.length === 0);
        updateSaveVisibility();
        questionInput.focus();
      })
      .catch(function () {
        if (typeof window.toast === 'function') window.toast('Could not open that chat', { type: 'error' });
      });
  }

  function deleteSavedChat(id) {
    if (!id) return;
    window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/saved/' + encodeURIComponent(id), {
      method: 'DELETE',
      on401: false
    }).then(function () { loadSavedList(); })
      .catch(function () {
        if (typeof window.toast === 'function') window.toast('Could not delete that chat', { type: 'error' });
      });
  }

  function setBusy(busy) {
    streaming = busy;
    sendBtn.disabled = busy;
    questionInput.disabled = busy;
    idInput.disabled = busy;
  }

  function send() {
    if (streaming) return;
    var taskId = (idInput.value || '').trim();
    var question = (questionInput.value || '').trim();
    if (!taskId) { idInput.focus(); return; }
    if (!question) { questionInput.focus(); return; }

    // Switching tasks starts a fresh conversation — history is per-task.
    if (taskId !== activeTask) {
      chatHistory = [];
      transcript.innerHTML = '';
      activeTask = taskId;
      if (activeLabel) activeLabel.textContent = 'talking to ' + taskId;
      if (resetBtn) resetBtn.classList.remove('hidden');
    }

    appendBubble('user', question);
    chatHistory.push({ role: 'user', content: question });
    updateSaveVisibility();
    questionInput.value = '';

    var answerEl = appendBubble('assistant', '');
    answerEl.classList.add('chat-cursor');
    var answerLi = answerEl.closest('li'); // tool breadcrumbs insert before this
    var answerText = '';
    setBusy(true);

    var priorHistory = chatHistory.slice(0, -1); // server re-adds the question

    // LIN-1910: the source hint is only trustworthy while `taskId` is still the
    // identifier it was minted for — the moment the user types a different id,
    // it no longer describes the row the link was generated for, so it's
    // dropped rather than carried along.
    var sourceHint = (taskId === prefillTask) ? prefillSource : '';
    var sourceQuery = sourceHint ? ('?source=' + encodeURIComponent(sourceHint)) : '';

    // Raw fetch carve-out: Server-Sent Events stream consumed via the reader
    // below; window.api() parses the body as JSON and would break the stream,
    // so the SSE reader keeps its own response handling.
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/' + encodeURIComponent(taskId) + sourceQuery, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ question: question, history: priorHistory })
    }).then(function (response) {
      if (!response.ok) {
        return response.json().then(function (body) {
          answerEl.classList.remove('chat-cursor');
          answerEl.textContent = '[error: ' + ((body && body.error) || ('request failed (' + response.status + ')')) + ']';
          chatHistory.pop(); // drop the unanswered question so retry is clean
          setBusy(false);
        }).catch(function () {
          answerEl.classList.remove('chat-cursor');
          answerEl.textContent = '[error: request failed (' + response.status + ')]';
          chatHistory.pop();
          setBusy(false);
        });
      }
      return readSSEStream(response, function (type, eventData) {
        if (type === 'tool') {
          // Tool breadcrumb: surface it in the log, but it is NOT assistant
          // content — do not touch answerText or chatHistory.
          appendToolBreadcrumb(toolBreadcrumbLabel(eventData), answerLi);
        } else if (type === 'token' || type === 'message') {
          var text = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
          answerText += text;
          answerEl.textContent = answerText;
          transcript.scrollTop = transcript.scrollHeight;
        } else if (type === 'done') {
          answerEl.classList.remove('chat-cursor');
          if (answerText) {
            chatHistory.push({ role: 'assistant', content: answerText });
            if (chatHistory.length > 40) chatHistory.splice(0, chatHistory.length - 40);
          } else {
            answerEl.textContent = '[no response]';
          }
          setBusy(false);
          questionInput.focus();
        } else if (type === 'error') {
          answerEl.classList.remove('chat-cursor');
          answerEl.textContent = answerText + '\n[error: ' + ((eventData && eventData.message) || 'failed') + ']';
          chatHistory.pop();
          setBusy(false);
        }
      });
    }).catch(function () {
      answerEl.classList.remove('chat-cursor');
      answerEl.textContent = '[error: network failure]';
      chatHistory.pop();
      setBusy(false);
    });
  }

  sendBtn.addEventListener('click', send);

  if (saveBtn) saveBtn.addEventListener('click', saveCurrentChat);

  // Delegated open/delete on the saved-chat list.
  if (savedList) {
    savedList.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.task-chat-saved-item') : null;
      if (!item) return;
      var id = item.getAttribute('data-saved-id');
      if (e.target.classList.contains('task-chat-saved-open')) openSavedChat(id);
      else if (e.target.classList.contains('task-chat-saved-delete')) deleteSavedChat(id);
    });
  }

  questionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  idInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); questionInput.focus(); }
  });

  if (resetBtn) resetBtn.addEventListener('click', resetConversation);

  // Load the user's saved chats up front (no-op when unavailable).
  loadSavedList();

  // Prefill focus: jump straight to the question when a task is already set.
  if ((idInput.value || '').trim()) questionInput.focus();
  else idInput.focus();
})();
