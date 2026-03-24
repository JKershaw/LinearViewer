/**
 * Roadmap Page Client-Side Logic
 *
 * Reads window.__ROADMAP_DATA__ and renders:
 * - Velocity panel with trend indicators
 * - Milestone cards with progress bars, stats, critical paths, risks
 * - AI narrative generation (SSE streaming)
 * - AI chat Q&A (SSE streaming)
 *
 * Loaded only on the /roadmap page.
 */

(function() {
  'use strict';

  var data = window.__ROADMAP_DATA__;
  if (!data) return;

  var urlKey = data.urlKey;
  var velocity = data.velocity;
  var milestones = data.milestones || [];
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

  // =========================================================================
  // Velocity Panel
  // =========================================================================

  function renderVelocityPanel() {
    var panel = document.querySelector('.roadmap-velocity-panel');
    if (!panel || !velocity) return;

    var trendClass = 'roadmap-trend roadmap-trend--stable';
    var trendLabel = 'stable';
    if (velocity.trend === 'increasing') {
      trendClass = 'roadmap-trend roadmap-trend--increasing';
      trendLabel = '↑ increasing';
    } else if (velocity.trend === 'decreasing') {
      trendClass = 'roadmap-trend roadmap-trend--decreasing';
      trendLabel = '↓ decreasing';
    }

    var html = '';
    if (velocity.completedPerWeek != null) {
      html += '<span class="roadmap-velocity-stat">'
        + escapeHtml(String(velocity.completedPerWeek)) + ' issues/week'
        + '</span>';
    }
    if (velocity.pointsPerWeek != null) {
      html += '<span class="roadmap-velocity-stat">'
        + escapeHtml(String(velocity.pointsPerWeek)) + ' pts/week'
        + '</span>';
    }
    html += '<span class="roadmap-velocity-stat">'
      + 'trend: <span class="' + trendClass + '">' + escapeHtml(trendLabel) + '</span>'
      + '</span>';

    panel.innerHTML = html;
  }

  // =========================================================================
  // Milestones
  // =========================================================================

  function buildProgressBar(percent, width) {
    width = width || 30;
    var filled = Math.round((percent / 100) * width);
    var empty = width - filled;
    var bar = '';
    for (var i = 0; i < filled; i++) bar += '\u2501'; // ━
    for (var j = 0; j < empty; j++) bar += '\u2500';  // ─
    return '[' + bar + '] ' + percent + '%';
  }

  function renderMilestones() {
    var container = document.querySelector('.roadmap-milestones');
    if (!container) return;

    if (milestones.length === 0) {
      container.innerHTML = '<div style="color:var(--fg-dim)">No milestones found.</div>';
      return;
    }

    var html = '';

    for (var i = 0; i < milestones.length; i++) {
      var m = milestones[i];
      html += '<div class="roadmap-milestone-card">';

      // Header
      html += '<div class="roadmap-milestone-header">';
      html += '<strong>' + escapeHtml(m.name) + '</strong>';
      if (m.targetDate) {
        html += '<span class="roadmap-milestone-date">' + escapeHtml(m.targetDate) + '</span>';
      }
      html += '</div>';

      // Progress bar
      var pct = m.progressPercent != null ? m.progressPercent : 0;
      html += '<div class="roadmap-progress-bar">' + buildProgressBar(pct) + '</div>';

      // Stats
      var statParts = [];
      if (m.remaining != null) statParts.push(m.remaining + ' remaining');
      if (m.points != null) statParts.push(m.points + ' points');
      if (m.weeksEstimate) {
        var est = '~' + m.weeksEstimate + ' weeks';
        if (m.weeksRange) est += ' (' + m.weeksRange + ')';
        statParts.push(est);
      }
      if (statParts.length > 0) {
        html += '<div class="roadmap-milestone-stats">'
          + escapeHtml(statParts.join(' \u00b7 '))
          + '</div>';
      }

      // Critical path
      if (m.criticalPath && m.criticalPath.length > 0) {
        var pathStr = '\u251c\u2500 ' + m.criticalPath.map(function(id) {
          return escapeHtml(id);
        }).join(' \u2192 ');
        html += '<div class="roadmap-critical-path">' + pathStr + '</div>';
      }

      // Risks
      if (m.risks && m.risks.length > 0) {
        for (var r = 0; r < m.risks.length; r++) {
          var risk = m.risks[r];
          var severity = risk.severity || 'low';
          html += '<div class="roadmap-risk roadmap-risk--' + escapeHtml(severity) + '">'
            + escapeHtml(risk.label || risk.description || '')
            + '</div>';
        }
      }

      html += '</div>';
    }

    container.innerHTML = html;
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

    var btn = document.createElement('button');
    btn.className = 'roadmap-generate-btn';
    btn.textContent = 'Generate Narrative';
    section.insertBefore(btn, content);

    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = 'generating...';
      content.textContent = '';

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/roadmap/narrative', {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' }
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
        body: JSON.stringify({ question: question })
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

  renderVelocityPanel();
  renderMilestones();
  renderNarrative();
  renderChat();
})();
