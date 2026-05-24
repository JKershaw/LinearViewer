/**
 * Roadmap Page Client-Side Logic
 *
 * Reads window.__ROADMAP_DATA__ and handles:
 * - AI narrative generation (auto-runs on page load when AI is connected)
 * - AI chat Q&A with conversation history (SSE streaming)
 *
 * The page heading, ship log, and milestone cards are server-rendered.
 * This script only adds interactive AI features when available.
 *
 * Loaded only on the /roadmap page.
 */

(function() {
  'use strict';

  var data = window.__ROADMAP_DATA__;
  if (!data) return;

  var urlKey = data.urlKey;
  var hasAI = data.hasAI;

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Read an SSE stream from a fetch response, calling onEvent for each event.
   */
  function readSSEStream(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function pump() {
      return reader.read().then(function(result) {
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
            if (line.charAt(0) === ':') continue;
            if (line.indexOf('event: ') === 0) type = line.slice(7);
            else if (line.indexOf('data: ') === 0) eventData = line.slice(6);
          }

          if (eventData) {
            try {
              onEvent(type, JSON.parse(eventData));
            } catch (e) {
              onEvent(type, eventData);
            }
          }
        }

        return pump();
      });
    }

    return pump();
  }

  /**
   * Build the roadmap model payload for API requests.
   * Strips the executionQueue to keep the payload small.
   */
  function getRoadmapModelPayload() {
    return {
      velocity: data.velocity,
      milestones: data.milestones,
      criticalPaths: data.criticalPaths,
      risks: data.risks
    };
  }

  // =========================================================================
  // Narrative (AI)
  // =========================================================================

  function renderNarrative() {
    var section = document.querySelector('.roadmap-narrative');
    if (!section || !hasAI) return;

    var heading = document.createElement('h2');
    heading.className = 'roadmap-section-heading';
    heading.textContent = '│ Narrative';
    section.appendChild(heading);

    var status = document.createElement('div');
    status.className = 'roadmap-narrative-status';
    section.appendChild(status);

    var content = document.createElement('div');
    content.className = 'roadmap-narrative-content';
    section.appendChild(content);

    var btn = document.createElement('button');
    btn.className = 'roadmap-generate-btn';
    btn.textContent = 'Regenerate';
    btn.style.display = 'none';
    section.appendChild(btn);

    function generate() {
      btn.disabled = true;
      btn.style.display = 'none';
      content.textContent = '';
      status.textContent = 'Generating narrative from delivery data…';
      status.classList.add('roadmap-narrative-status--loading');

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/narrative', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({ roadmapModel: getRoadmapModelPayload() })
      }).then(function(response) {
        if (response.status === 401) {
          window.location.href = '/logout';
          return;
        }
        if (!response.ok) {
          status.textContent = '';
          status.classList.remove('roadmap-narrative-status--loading');
          content.textContent = 'Error generating narrative.';
          btn.disabled = false;
          btn.style.display = '';
          btn.textContent = 'Try again';
          return;
        }

        var firstToken = true;
        return readSSEStream(response, function(type, eventData) {
          if (type === 'token' || type === 'message') {
            var text = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
            if (firstToken && text) {
              status.textContent = '';
              status.classList.remove('roadmap-narrative-status--loading');
              firstToken = false;
            }
            content.textContent += text;
          } else if (type === 'done') {
            status.textContent = '';
            status.classList.remove('roadmap-narrative-status--loading');
            if (eventData && eventData.finishReason === 'length') {
              content.textContent += '\n\n[output truncated — hit token limit. Try Regenerate.]';
            }
            btn.disabled = false;
            btn.style.display = '';
            btn.textContent = 'Regenerate';
          } else if (type === 'error') {
            var errMsg = typeof eventData === 'object' ? (eventData.message || 'Error') : eventData;
            status.textContent = '';
            status.classList.remove('roadmap-narrative-status--loading');
            content.textContent += '\n[error: ' + errMsg + ']';
            btn.disabled = false;
            btn.style.display = '';
            btn.textContent = 'Try again';
          }
        });
      }).catch(function() {
        status.textContent = '';
        status.classList.remove('roadmap-narrative-status--loading');
        content.textContent = 'Error generating narrative.';
        btn.disabled = false;
        btn.style.display = '';
        btn.textContent = 'Try again';
      });
    }

    btn.addEventListener('click', generate);
    // Auto-generate on page load. The narrative is the most informative
    // output the page can produce, so users shouldn't have to click for it.
    generate();
  }

  // =========================================================================
  // Chat (AI) with conversation history
  // =========================================================================

  function renderChat() {
    var section = document.querySelector('.roadmap-chat');
    if (!section || !hasAI) return;

    // Conversation history for multi-turn context
    var chatHistory = [];

    var heading = document.createElement('h2');
    heading.className = 'roadmap-section-heading';
    heading.textContent = '│ Chat';
    section.appendChild(heading);

    var historyEl = document.createElement('div');
    historyEl.className = 'roadmap-chat-history';

    var inputRow = document.createElement('div');
    inputRow.className = 'roadmap-chat-input-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'roadmap-chat-input';
    input.placeholder = 'Ask about the roadmap...';

    var sendBtn = document.createElement('button');
    sendBtn.className = 'roadmap-chat-send';
    sendBtn.textContent = 'Send';

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    section.appendChild(historyEl);
    section.appendChild(inputRow);

    function sendMessage() {
      var question = input.value.trim();
      if (!question) return;

      // Show user message in UI
      var userMsg = document.createElement('div');
      userMsg.className = 'roadmap-chat-message roadmap-chat-message--user';
      userMsg.textContent = '> ' + question;
      historyEl.appendChild(userMsg);

      // Add to conversation history
      chatHistory.push({ role: 'user', content: question });

      // Create assistant message placeholder
      var assistantMsg = document.createElement('div');
      assistantMsg.className = 'roadmap-chat-message roadmap-chat-message--assistant';
      historyEl.appendChild(assistantMsg);

      var assistantText = '';
      input.value = '';
      sendBtn.disabled = true;
      input.disabled = true;

      historyEl.scrollTop = historyEl.scrollHeight;

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          question: question,
          roadmapModel: getRoadmapModelPayload(),
          history: chatHistory.slice(0, -1) // exclude current question (server adds it)
        })
      }).then(function(response) {
        if (response.status === 401) {
          window.location.href = '/logout';
          return;
        }
        if (!response.ok) {
          assistantMsg.textContent = '[error: failed to get response]';
          sendBtn.disabled = false;
          input.disabled = false;
          return;
        }

        return readSSEStream(response, function(type, eventData) {
          if (type === 'token' || type === 'message') {
            var text = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
            assistantText += text;
            assistantMsg.textContent = assistantText;
            historyEl.scrollTop = historyEl.scrollHeight;
          } else if (type === 'done') {
            if (eventData && eventData.finishReason === 'length') {
              assistantText += '\n\n[output truncated — hit token limit]';
              assistantMsg.textContent = assistantText;
            }
            // Store assistant response in history for follow-up context
            chatHistory.push({ role: 'assistant', content: assistantText });
            // Cap history to last 40 entries to prevent unbounded memory growth
            if (chatHistory.length > 40) {
              chatHistory.splice(0, chatHistory.length - 40);
            }
            sendBtn.disabled = false;
            input.disabled = false;
            input.focus();
          } else if (type === 'error') {
            var errMsg = typeof eventData === 'object' ? (eventData.message || 'Error') : eventData;
            assistantMsg.textContent += '\n[error: ' + errMsg + ']';
            sendBtn.disabled = false;
            input.disabled = false;
          }
        });
      }).catch(function() {
        assistantMsg.textContent = '[error: request failed]';
        sendBtn.disabled = false;
        input.disabled = false;
      });
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // =========================================================================
  // Init
  // =========================================================================

  renderNarrative();
  renderChat();
})();
