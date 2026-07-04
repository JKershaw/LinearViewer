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

  var idInput = document.getElementById('task-chat-id');
  var questionInput = document.getElementById('task-chat-question');
  var sendBtn = document.getElementById('task-chat-send');
  var transcript = document.getElementById('task-chat-transcript');
  var emptyState = document.getElementById('task-chat-empty');
  var activeLabel = document.getElementById('task-chat-active-label');
  var resetBtn = document.getElementById('task-chat-reset');

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

  function appendBubble(role, text) {
    var li = document.createElement('li');
    li.className = 'task-chat-msg task-chat-msg-' + role;

    // Speaker → StatusPill (LIN-861): the user's "you" is a neutral tag chip; the
    // task's turn reads as in-progress (◐). The `task-chat-msg-who` hook rides
    // along so the per-role colour rules + E2E selectors still resolve.
    var whoLabel = role === 'user' ? 'you' : (activeTask || 'task');
    var whoPill = role === 'user'
      ? window.renderStatusPill({ label: whoLabel, variant: 'tag', className: 'task-chat-msg-who' })
      : window.renderStatusPill({ label: whoLabel, state: 'in-progress', className: 'task-chat-msg-who' });

    // Body → Surface (LIN-861). The streaming cursor MUST stay on the SSE text
    // node (`.task-chat-msg-body`, the element send() writes textContent into and
    // toggles `.task-chat-streaming` on), so the Surface WRAPS that node — the
    // streaming class never moves onto the wrapper.
    var bodySurface = window.renderSurface({
      body: '<span class="task-chat-msg-body">' + window.escapeHtml(text) + '</span>',
      className: 'task-chat-msg-surface',
    });

    li.innerHTML = whoPill + bodySurface;
    transcript.appendChild(li);
    setEmptyVisible(false);
    transcript.scrollTop = transcript.scrollHeight;
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
    var li = document.createElement('li');
    li.className = 'task-chat-tool';
    li.textContent = '↳ ' + label;
    if (beforeLi && beforeLi.parentNode === transcript) {
      transcript.insertBefore(li, beforeLi);
    } else {
      transcript.appendChild(li);
    }
    setEmptyVisible(false);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function resetConversation() {
    chatHistory = [];
    activeTask = '';
    transcript.innerHTML = '';
    if (activeLabel) activeLabel.textContent = '';
    if (resetBtn) resetBtn.classList.add('hidden');
    setEmptyVisible(true);
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
    questionInput.value = '';

    var answerEl = appendBubble('assistant', '');
    answerEl.classList.add('task-chat-streaming');
    var answerLi = answerEl.closest('li'); // tool breadcrumbs insert before this
    var answerText = '';
    setBusy(true);

    var priorHistory = chatHistory.slice(0, -1); // server re-adds the question

    // Raw fetch carve-out: Server-Sent Events stream consumed via the reader
    // below; window.api() parses the body as JSON and would break the stream,
    // so the SSE reader keeps its own response handling.
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/task-chat/' + encodeURIComponent(taskId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ question: question, history: priorHistory })
    }).then(function (response) {
      if (!response.ok) {
        return response.json().then(function (body) {
          answerEl.classList.remove('task-chat-streaming');
          answerEl.textContent = '[error: ' + ((body && body.error) || ('request failed (' + response.status + ')')) + ']';
          chatHistory.pop(); // drop the unanswered question so retry is clean
          setBusy(false);
        }).catch(function () {
          answerEl.classList.remove('task-chat-streaming');
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
          answerEl.classList.remove('task-chat-streaming');
          if (answerText) {
            chatHistory.push({ role: 'assistant', content: answerText });
            if (chatHistory.length > 40) chatHistory.splice(0, chatHistory.length - 40);
          } else {
            answerEl.textContent = '[no response]';
          }
          setBusy(false);
          questionInput.focus();
        } else if (type === 'error') {
          answerEl.classList.remove('task-chat-streaming');
          answerEl.textContent = answerText + '\n[error: ' + ((eventData && eventData.message) || 'failed') + ']';
          chatHistory.pop();
          setBusy(false);
        }
      });
    }).catch(function () {
      answerEl.classList.remove('task-chat-streaming');
      answerEl.textContent = '[error: network failure]';
      chatHistory.pop();
      setBusy(false);
    });
  }

  sendBtn.addEventListener('click', send);

  questionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  idInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); questionInput.focus(); }
  });

  if (resetBtn) resetBtn.addEventListener('click', resetConversation);

  // Prefill focus: jump straight to the question when a task is already set.
  if ((idInput.value || '').trim()) questionInput.focus();
  else idInput.focus();
})();
