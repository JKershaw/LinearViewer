/**
 * Roadmap Page Client-Side Logic
 *
 * Reads window.__ROADMAP_DATA__ and handles:
 * - The five-layer narrative pipeline (technical → product → trajectory ∥
 *   north-star reading → gap), each streamed into its own server-rendered
 *   placeholder section
 * - North star textarea: loads on page render, saves on blur
 * - AI chat Q&A with conversation history (SSE streaming)
 *
 * The page heading, ship log, milestone cards, north star textarea, and
 * the five layer placeholders are server-rendered. This script wires up
 * interaction when AI is available.
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
  // Pipeline (AI) — five layers streamed into server-rendered placeholders
  // =========================================================================

  var LAYER_IDS = ['technical', 'product', 'trajectory', 'north-star-reading', 'gap'];

  function layerSection(layerId) {
    return document.querySelector('[data-layer="' + layerId + '"]');
  }

  function setLayerState(layerId, state, statusText) {
    var section = layerSection(layerId);
    if (!section) return;
    section.setAttribute('data-state', state);
    var status = section.querySelector('.roadmap-layer-status');
    if (status) status.textContent = statusText || '';
  }

  function resetLayer(layerId) {
    var section = layerSection(layerId);
    if (!section) return;
    section.setAttribute('data-state', 'idle');
    var status = section.querySelector('.roadmap-layer-status');
    var content = section.querySelector('.roadmap-layer-content');
    if (status) status.textContent = '';
    if (content) content.textContent = '';
    var retry = section.querySelector('.roadmap-layer-retry');
    if (retry) retry.remove();
  }

  function addRetryButton(layerId, onRetry) {
    var section = layerSection(layerId);
    if (!section) return;
    var existing = section.querySelector('.roadmap-layer-retry');
    if (existing) existing.remove();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'roadmap-layer-retry';
    btn.textContent = 'Retry';
    btn.addEventListener('click', function() {
      btn.remove();
      onRetry();
    });
    section.appendChild(btn);
  }

  /**
   * Stream one pipeline layer into its placeholder section.
   * Resolves with the accumulated text; rejects on HTTP/SSE error.
   */
  function runLayer(layerId, endpoint, body) {
    return new Promise(function(resolve, reject) {
      var section = layerSection(layerId);
      if (!section) {
        reject(new Error('No section for layer ' + layerId));
        return;
      }
      var status = section.querySelector('.roadmap-layer-status');
      var content = section.querySelector('.roadmap-layer-content');

      section.setAttribute('data-state', 'streaming');
      if (status) {
        status.textContent = 'Generating…';
        status.classList.add('roadmap-layer-status--loading');
      }
      if (content) content.textContent = '';
      var retry = section.querySelector('.roadmap-layer-retry');
      if (retry) retry.remove();

      var acc = '';
      var firstToken = true;

      function fail(message) {
        section.setAttribute('data-state', 'failed');
        if (status) {
          status.textContent = message || 'Failed';
          status.classList.remove('roadmap-layer-status--loading');
        }
        addRetryButton(layerId, function() {
          runLayer(layerId, endpoint, body).then(resolve, reject);
        });
        reject(new Error(message || 'layer failed'));
      }

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/narrative/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body)
      }).then(function(response) {
        if (response.status === 401) {
          window.location.href = '/logout';
          return;
        }
        if (!response.ok) {
          fail('HTTP ' + response.status);
          return;
        }
        return readSSEStream(response, function(type, eventData) {
          if (type === 'token' || type === 'message') {
            var text = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
            if (firstToken && text) {
              if (status) {
                status.textContent = '';
                status.classList.remove('roadmap-layer-status--loading');
              }
              firstToken = false;
            }
            acc += text;
            if (content) content.textContent = acc;
          } else if (type === 'done') {
            section.setAttribute('data-state', 'done');
            if (status) {
              status.textContent = '';
              status.classList.remove('roadmap-layer-status--loading');
            }
            if (eventData && eventData.finishReason === 'length') {
              acc += '\n\n[output truncated — hit token limit]';
              if (content) content.textContent = acc;
            }
            resolve(acc);
          } else if (type === 'error') {
            var msg = typeof eventData === 'object' ? (eventData.message || 'Error') : eventData;
            fail(msg);
          }
        });
      }).catch(function(err) {
        fail(err && err.message ? err.message : 'request failed');
      });
    });
  }

  /**
   * Orchestrate the five-layer pipeline.
   *
   *   technical → product → (trajectory ∥ north-star-reading) → gap
   *
   * When the north star is empty, layers 3b and 4 are skipped — those
   * sections render a CTA instead. Failures in individual layers leave
   * the rest of the pipeline running where possible per the design doc's
   * §"Failure modes".
   */
  function runPipeline(northStar, generateBtn) {
    var roadmapModel = getRoadmapModelPayload();
    var hasNorthStar = !!(northStar && northStar.trim());

    LAYER_IDS.forEach(resetLayer);
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating…';
    }

    // Mark fork-right and gap as "not available" up front when no north star.
    if (!hasNorthStar) {
      setLayerState('north-star-reading', 'not-available', 'Set a north star above to generate this reading.');
      setLayerState('gap', 'not-available', 'A north star is required for the gap analysis.');
    }

    return runLayer('technical', 'technical', { roadmapModel })
      .then(function(tech) {
        return runLayer('product', 'product', { roadmapModel, tech }).then(function(product) {
          return { tech, product };
        });
      })
      .then(function(prior) {
        var trajectoryPromise = runLayer('trajectory', 'trajectory', {
          roadmapModel,
          tech: prior.tech,
          product: prior.product
        });
        var nsPromise = hasNorthStar
          ? runLayer('north-star-reading', 'north-star', { roadmapModel, northStar })
          : Promise.resolve(null);

        return Promise.allSettled([trajectoryPromise, nsPromise]).then(function(results) {
          var trajectory = results[0].status === 'fulfilled' ? results[0].value : null;
          var nsReading = results[1].status === 'fulfilled' ? results[1].value : null;
          if (!hasNorthStar) return;
          if (trajectory && nsReading) {
            return runLayer('gap', 'gap', { northStar, trajectory, nsReading }).catch(function() {});
          }
          // One fork leg failed; downgrade gap to a clearer message.
          setLayerState('gap', 'not-available', 'Gap analysis needs both trajectory and north star reading to succeed.');
        });
      })
      .catch(function() {
        // Errors are surfaced per-layer; nothing extra to do here.
      })
      .then(function() {
        if (generateBtn) {
          generateBtn.disabled = false;
          generateBtn.textContent = 'Regenerate reading';
        }
      });
  }

  function renderPipeline() {
    var section = document.querySelector('.roadmap-pipeline');
    if (!section || !hasAI) return;

    var textarea = section.querySelector('.roadmap-north-star-input');
    var btn = section.querySelector('.roadmap-generate-reading-btn');
    if (!textarea || !btn) return;

    // Load any saved north star value into the textarea
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/north-star')
      .then(function(r) { return r.ok ? r.json() : { northStar: '' }; })
      .then(function(body) { textarea.value = (body && body.northStar) || ''; })
      .catch(function() { /* keep empty */ });

    // Save on blur. No debounce: blur is a deliberate user action.
    textarea.addEventListener('blur', function() {
      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/north-star', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ northStar: textarea.value })
      }).catch(function() { /* swallow — next save will retry */ });
    });

    btn.addEventListener('click', function() {
      runPipeline(textarea.value, btn);
    });
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

  renderPipeline();
  renderChat();
})();
