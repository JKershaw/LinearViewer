/**
 * "The Ship's Biscuit" client (experimental, LIN-818, V1).
 *
 * Drives the newspaper page: pick a window → "run the presses" → POST to the
 * generate endpoint → render the returned edition into #ship-biscuit-edition. The
 * render shape MUST match the server-side first paint in lib/render-ship-biscuit.js
 * (renderEditionHtml) exactly: a lead story (inert headline + optional standfirst/dek
 * + lede), weighted section blocks in descending-weight order with a prominence hook,
 * then compact lower-prominence stubs (LIN-1198, Theme B). The pure builder
 * buildEditionHtml duplicates the server's partition + weight→prominence logic
 * verbatim, and a server↔client parity unit test pins the two together.
 *
 * Headlines in the index are clickable but INERT in V1: clicking one surfaces a
 * "coming in a later edition" note rather than loading an article body. The lead-story
 * headline is NOT a link (plain <h2>), so it never triggers the seam. The on-demand
 * article-body pass is the deferred V2 work; this client leaves the click seam in
 * place (a delegated handler on the index) so V2 can swap the note for a fetch.
 */
(function () {
  'use strict';

  function esc(s) {
    // Mirrors lib/utils/html.js escapeHtml EXACTLY (incl. ' → &#039;) so the client
    // render is byte-identical to the server render.
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function formatDateline(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toUTCString().replace(/ GMT$/, ' UTC');
  }

  // --- Newspaper hierarchy (LIN-1198) — duplicate-verbatim of the pure helpers in
  // lib/render-ship-biscuit.js. Keep the two in lockstep; the parity test enforces it.
  var STUB_WEIGHT_MAX = 2;

  function prominenceForWeight(weight) {
    var w = Number(weight) || 0;
    if (w >= 5) return 'high';
    if (w >= 4) return 'medium';
    return 'standard';
  }

  function partitionIndex(index) {
    var items = Array.isArray(index) ? index : [];
    var weighted = items.filter(function (s) { return (Number(s && s.weight) || 0) > STUB_WEIGHT_MAX; });
    var stubs = items.filter(function (s) { return (Number(s && s.weight) || 0) <= STUB_WEIGHT_MAX; });
    return { weighted: weighted, stubs: stubs };
  }

  // Shared inner markup for an index item (weighted block OR stub): section label, the
  // INERT clickable headline link, and an optional dek. Matches renderArticleInner.
  function articleInner(stub) {
    var section = esc(stub.section || '');
    var headline = esc(stub.headline || '');
    var id = esc(stub.id || '');
    var dek = stub.dek ? '<p class="ship-biscuit-dek">' + esc(stub.dek) + '</p>' : '';
    return '<span class="ship-biscuit-section">' + section + '</span>'
      + '<a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="' + id + '">' + headline + '</a>'
      + dek;
  }

  function weightedArticle(stub) {
    var id = esc(stub.id || '');
    var section = esc(stub.section || '');
    var weight = Number(stub.weight) || 0;
    var prominence = prominenceForWeight(weight);
    return '<article class="ship-biscuit-article ship-biscuit-weighted" data-testid="ship-biscuit-weighted-section" data-article-id="' + id + '" data-section="' + section + '" data-weight="' + weight + '" data-prominence="' + prominence + '">'
      + articleInner(stub)
      + '</article>';
  }

  function stubArticle(stub) {
    var id = esc(stub.id || '');
    var section = esc(stub.section || '');
    var weight = Number(stub.weight) || 0;
    return '<li class="ship-biscuit-article ship-biscuit-stub" data-testid="ship-biscuit-stub" data-article-id="' + id + '" data-section="' + section + '" data-weight="' + weight + '">'
      + articleInner(stub)
      + '</li>';
  }

  // Pure edition→HTML builder. MUST stay byte-identical (after whitespace collapse) to
  // lib/render-ship-biscuit.js renderEditionHtml for a non-null edition.
  function buildEditionHtml(edition) {
    var dateline = formatDateline(edition.generatedAt);
    var windowLabel = edition.window ? ('the last ' + esc(edition.window)) : '';
    var fp = edition.frontPage || {};
    var headline = esc(fp.headline || '');
    var standfirst = esc(fp.standfirst || '');
    var lede = esc(fp.lede || '');

    // Lead story: inert <h2> headline (distinct from the <h1> masthead, no link) over
    // the optional standfirst/dek (omitted entirely when absent — no empty node), then
    // the lede.
    var leadStory = '<header class="ship-biscuit-hero ship-biscuit-lead-story" data-testid="ship-biscuit-lead-story">'
      + '<p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">' + esc(dateline) + (windowLabel ? ' · ' + windowLabel : '') + '</p>'
      + (headline ? '<h2 class="ship-biscuit-lead-headline" data-testid="ship-biscuit-lead-headline">' + headline + '</h2>' : '')
      + (standfirst ? '<p class="ship-biscuit-standfirst" data-testid="ship-biscuit-standfirst">' + standfirst + '</p>' : '')
      + '<p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">' + lede + '</p>'
      + '</header>';

    var indexHtml;
    var index = Array.isArray(edition.index) ? edition.index : [];
    if (edition.isQuiet || index.length === 0) {
      indexHtml = '<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>';
    } else {
      var parts = partitionIndex(index);
      var weightedHtml = parts.weighted.map(weightedArticle).join('');
      var stubsHtml = parts.stubs.map(stubArticle).join('');
      indexHtml = '<div class="ship-biscuit-sections" data-testid="ship-biscuit-sections">' + weightedHtml + '</div>'
        + '<ul class="ship-biscuit-stubs" data-testid="ship-biscuit-stubs">' + stubsHtml + '</ul>';
    }

    return leadStory + '<div class="ship-biscuit-articles">' + indexHtml + '</div>';
  }

  // Expose the pure builder so the server↔client render-parity unit test can invoke it
  // (harmless global in the browser; the render path below uses it directly).
  if (typeof window !== 'undefined') window.__shipBiscuitBuildEditionHtml = buildEditionHtml;

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

  function renderEdition(edition) {
    if (!edition) {
      editionEl.innerHTML = '<p class="ship-biscuit-empty" id="ship-biscuit-empty">○ no edition yet</p>';
      return;
    }
    editionEl.innerHTML = buildEditionHtml(edition);
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
