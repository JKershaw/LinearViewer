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
    var who = document.createElement('span');
    who.className = 'task-chat-msg-who';
    who.textContent = role === 'user' ? 'you' : (activeTask || 'task');
    var body = document.createElement('span');
    body.className = 'task-chat-msg-body';
    body.textContent = text;
    li.appendChild(who);
    li.appendChild(body);
    transcript.appendChild(li);
    setEmptyVisible(false);
    transcript.scrollTop = transcript.scrollHeight;
    return body;
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
        if (type === 'token' || type === 'message') {
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
