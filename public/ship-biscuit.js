/**
 * "The Ship's Biscuit" client (experimental, LIN-818, V1).
 *
 * Drives the newspaper page: pick a window → "run the presses" → POST to the
 * generate endpoint → render the returned edition (front-page lede + an index of
 * article stubs) into #ship-biscuit-edition. The render shape matches the
 * server-side first paint in lib/render-ship-biscuit.js.
 *
 * Headlines are clickable but INERT in V1: clicking one surfaces a "coming in a
 * later edition" note rather than loading an article body. The on-demand
 * article-body pass is the deferred V2 work; this client leaves the click seam in
 * place (a delegated handler on the index) so V2 can swap the note for a fetch
 * without restructuring the page.
 */
(function () {
  'use strict';

  var data = window.__SHIP_BISCUIT_DATA__ || {};
  var urlKey = data.urlKey || '';

  var generateBtn = document.getElementById('ship-biscuit-generate');
  var windowSel = document.getElementById('ship-biscuit-window');
  var feedbackEl = document.getElementById('ship-biscuit-feedback');
  var editionEl = document.getElementById('ship-biscuit-edition');

  if (!generateBtn || !editionEl) return;

  function setFeedback(text, isError) {
    if (!feedbackEl) return;
    feedbackEl.textContent = text || '';
    feedbackEl.className = 'ship-biscuit-feedback' + (isError ? ' error' : '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDateline(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toUTCString().replace(/ GMT$/, ' UTC');
  }

  function renderEdition(edition) {
    if (!edition) {
      editionEl.innerHTML = '<p class="ship-biscuit-empty" id="ship-biscuit-empty">○ no edition yet</p>';
      return;
    }
    var dateline = formatDateline(edition.generatedAt);
    var windowLabel = edition.window ? ('the last ' + esc(edition.window)) : '';
    var lede = esc((edition.frontPage && edition.frontPage.lede) || '');

    var hero = '<header class="ship-biscuit-hero" data-testid="ship-biscuit-hero">'
      + '<p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">' + esc(dateline) + (windowLabel ? ' · ' + windowLabel : '') + '</p>'
      + '<p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">' + lede + '</p>'
      + '</header>';

    var indexHtml;
    var index = Array.isArray(edition.index) ? edition.index : [];
    if (edition.isQuiet || index.length === 0) {
      indexHtml = '<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>';
    } else {
      indexHtml = '<ul class="ship-biscuit-index" data-testid="ship-biscuit-index">'
        + index.map(function (stub) {
          var id = esc(stub.id || '');
          var dek = stub.dek ? '<p class="ship-biscuit-dek">' + esc(stub.dek) + '</p>' : '';
          return '<li class="ship-biscuit-article" data-article-id="' + id + '">'
            + '<span class="ship-biscuit-section">' + esc(stub.section || '') + '</span>'
            + '<a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="' + id + '">' + esc(stub.headline || '') + '</a>'
            + dek
            + '</li>';
        }).join('')
        + '</ul>';
    }

    editionEl.innerHTML = hero + '<div class="ship-biscuit-articles">' + indexHtml + '</div>';
  }

  // Inert headline click seam (V1): the article body is not generated yet, so a
  // click just explains that. V2 will replace this note with an on-demand fetch.
  editionEl.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('.ship-biscuit-headline') : null;
    if (!link) return;
    e.preventDefault();
    var article = link.closest('.ship-biscuit-article');
    if (!article || article.querySelector('.ship-biscuit-inert-note')) return;
    var note = document.createElement('p');
    note.className = 'ship-biscuit-inert-note';
    note.textContent = '— the full article arrives in a later edition (coming soon)';
    article.appendChild(note);
  });

  function generate() {
    generateBtn.disabled = true;
    setFeedback('setting type…');
    var win = windowSel ? windowSel.value : 'week';
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/ship-biscuit/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: win })
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) {
          setFeedback((r.body && r.body.error) || ('generation failed (' + r.status + ')'), true);
          return;
        }
        renderEdition(r.body.edition);
        setFeedback('');
      })
      .catch(function () {
        setFeedback('network error — please try again', true);
      })
      .finally(function () {
        generateBtn.disabled = false;
      });
  }

  generateBtn.addEventListener('click', generate);
})();
