/**
 * Roadmap Page Client-Side Logic
 *
 * Reads window.__ROADMAP_DATA__ and handles:
 * - AI narrative generation (SSE streaming)
 * - AI chat Q&A (SSE streaming)
 *
 * The velocity panel and milestone cards are server-rendered.
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

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Read an SSE stream from a fetch response, calling onEvent for each event.
   * Mirrors the pattern from app.js readSSEStream.
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

    var content = section.querySelector('.roadmap-narrative-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'roadmap-narrative-content';
      section.appendChild(content);
    }

    var heading = document.createElement('h2');
    heading.className = 'roadmap-section-heading';
    heading.textContent = '│ Narrative';
    section.insertBefore(heading, content);

    var btn = document.createElement('button');
    btn.className = 'roadmap-generate-btn';
    btn.textContent = 'Generate Narrative';
    section.insertBefore(btn, content);

    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = 'generating...';
      content.textContent = '';

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
          content.textContent = 'Error generating narrative.';
          btn.disabled = false;
          btn.textContent = 'Generate Narrative';
          return;
        }

        return readSSEStream(response, function(type, eventData) {
          if (type === 'token' || type === 'message') {
            var text = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
            content.textContent += text;
          } else if (type === 'done') {
            btn.disabled = false;
            btn.textContent = 'Regenerate';
          } else if (type === 'error') {
            var errMsg = typeof eventData === 'object' ? (eventData.message || 'Error') : eventData;
            content.textContent += '\n[error: ' + errMsg + ']';
            btn.disabled = false;
            btn.textContent = 'Generate Narrative';
          }
        });
      }).catch(function() {
        content.textContent = 'Error generating narrative.';
        btn.disabled = false;
        btn.textContent = 'Generate Narrative';
      });
    });
  }

  // =========================================================================
  // Chat (AI)
  // =========================================================================

  function renderChat() {
    var section = document.querySelector('.roadmap-chat');
    if (!section || !hasAI) return;

    var heading = document.createElement('h2');
    heading.className = 'roadmap-section-heading';
    heading.textContent = '│ Chat';
    section.appendChild(heading);

    var history = document.createElement('div');
    history.className = 'roadmap-chat-history';

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
    section.appendChild(history);
    section.appendChild(inputRow);

    function sendMessage() {
      var question = input.value.trim();
      if (!question) return;

      // Show user message
      var userMsg = document.createElement('div');
      userMsg.className = 'roadmap-chat-message roadmap-chat-message--user';
      userMsg.textContent = '> ' + question;
      history.appendChild(userMsg);

      // Create assistant message placeholder
      var assistantMsg = document.createElement('div');
      assistantMsg.className = 'roadmap-chat-message roadmap-chat-message--assistant';
      history.appendChild(assistantMsg);

      input.value = '';
      sendBtn.disabled = true;
      input.disabled = true;

      history.scrollTop = history.scrollHeight;

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          question: question,
          roadmapModel: getRoadmapModelPayload()
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
            assistantMsg.textContent += text;
            history.scrollTop = history.scrollHeight;
          } else if (type === 'done') {
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
