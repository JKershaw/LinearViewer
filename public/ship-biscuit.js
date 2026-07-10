/**
 * "The Ship's Biscuit" client (experimental, LIN-818, V1).
 *
 * Drives the newspaper page: pick a window → "run the presses" → POST to the
 * generate endpoint → render the returned edition into #ship-biscuit-edition. The
 * render shape is a newspaper hierarchy (LIN-1198) — a lead story (headline +
 * optional standfirst + lede), then weighted section columns over the DESKS, then
 * lower-prominence stubs — and MUST match the server-side first paint in
 * lib/render-ship-biscuit.js exactly (server↔client parity is load-bearing).
 *
 * Index headlines are clickable but INERT in V1: clicking one surfaces a "coming in
 * a later edition" note rather than loading an article body. The on-demand
 * article-body pass is the deferred V2 work; this client leaves the click seam in
 * place (a delegated handler on the index) so V2 can swap the note for a fetch
 * without restructuring the page. The lead headline is inert plain text, not a link.
 */
(function () {
  'use strict';

  var data = window.__SHIP_BISCUIT_DATA__ || {};
  var urlKey = data.urlKey || '';

  // Kept in lockstep with lib/render-ship-biscuit.js (COLUMN_WEIGHT_FLOOR / DESK_ORDER).
  var COLUMN_WEIGHT_FLOOR = 3;
  var DESK_ORDER = ['Front Page', 'The Wire', 'Deep Dive', 'The Column', 'Weather'];

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

  function weightOf(stub) {
    var n = Number(stub && stub.weight);
    return isFinite(n) ? n : 0;
  }

  function deskRank(section) {
    var i = DESK_ORDER.indexOf(section);
    return i === -1 ? DESK_ORDER.length : i;
  }

  // Mirror of layoutIndex() in lib/render-ship-biscuit.js — partition into weighted
  // section columns (weight ≥ floor, grouped by desk) + lower-prominence stubs.
  function layoutIndex(index) {
    var items = (Array.isArray(index) ? index : []).filter(function (s) { return s && typeof s === 'object'; });
    var bySection = {};
    var order = [];
    var stubs = [];
    items.forEach(function (s) {
      if (weightOf(s) >= COLUMN_WEIGHT_FLOOR) {
        var key = s.section || 'The Wire';
        if (!bySection[key]) { bySection[key] = []; order.push(key); }
        bySection[key].push(s);
      } else {
        stubs.push(s);
      }
    });
    var columns = order.map(function (section) {
      var colStubs = bySection[section].slice().sort(function (a, b) { return weightOf(b) - weightOf(a); });
      var weight = colStubs.reduce(function (m, s) { return Math.max(m, weightOf(s)); }, 0);
      return { section: section, weight: weight, stubs: colStubs };
    });
    columns.sort(function (a, b) {
      if (b.weight !== a.weight) return b.weight - a.weight;
      var ra = deskRank(a.section);
      var rb = deskRank(b.section);
      if (ra !== rb) return ra - rb;
      return a.section < b.section ? -1 : a.section > b.section ? 1 : 0;
    });
    return { columns: columns, stubs: stubs };
  }

  function columnArticle(stub) {
    var id = esc(stub.id || '');
    var weight = Math.max(1, Math.round(weightOf(stub) || 1));
    var dek = stub.dek ? '<p class="ship-biscuit-dek">' + esc(stub.dek) + '</p>' : '';
    return '<li class="ship-biscuit-article" data-article-id="' + id + '" data-weight="' + weight + '">'
      + '<a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="' + id + '">' + esc(stub.headline || '') + '</a>'
      + dek
      + '</li>';
  }

  function stubArticle(stub) {
    var id = esc(stub.id || '');
    var weight = Math.max(1, Math.round(weightOf(stub) || 1));
    var dek = stub.dek ? '<p class="ship-biscuit-dek">' + esc(stub.dek) + '</p>' : '';
    return '<li class="ship-biscuit-article ship-biscuit-stub" data-article-id="' + id + '" data-weight="' + weight + '">'
      + '<span class="ship-biscuit-section">' + esc(stub.section || '') + '</span>'
      + '<a href="#" class="ship-biscuit-headline" data-testid="ship-biscuit-headline" data-article-id="' + id + '">' + esc(stub.headline || '') + '</a>'
      + dek
      + '</li>';
  }

  function renderEdition(edition) {
    if (!edition) {
      editionEl.innerHTML = '<p class="ship-biscuit-empty" id="ship-biscuit-empty">○ no edition yet</p>';
      return;
    }
    var dateline = formatDateline(edition.generatedAt);
    var windowLabel = edition.window ? ('the last ' + esc(edition.window)) : '';
    var fp = edition.frontPage || {};
    var headline = esc(fp.headline || '');
    var standfirst = esc(fp.standfirst || '');
    var lede = esc(fp.lede || '');

    var lead = '<header class="ship-biscuit-lead" data-testid="ship-biscuit-lead">'
      + '<p class="ship-biscuit-dateline" data-testid="ship-biscuit-dateline">' + esc(dateline) + (windowLabel ? ' · ' + windowLabel : '') + '</p>'
      + (headline ? '<h2 class="ship-biscuit-lead-headline" data-testid="ship-biscuit-lead-headline">' + headline + '</h2>' : '')
      + (standfirst ? '<p class="ship-biscuit-standfirst" data-testid="ship-biscuit-standfirst">' + standfirst + '</p>' : '')
      + (lede ? '<p class="ship-biscuit-lede" data-testid="ship-biscuit-lede">' + lede + '</p>' : '')
      + '</header>';

    var layout = layoutIndex(edition.index);
    var columns = layout.columns;
    var stubs = layout.stubs;

    var bodyHtml;
    if (edition.isQuiet || (columns.length === 0 && stubs.length === 0)) {
      bodyHtml = '<p class="ship-biscuit-quiet" data-testid="ship-biscuit-quiet">A slow news day — no headlines to run.</p>';
    } else {
      var columnsBlock = columns.length
        ? '<div class="ship-biscuit-columns" data-testid="ship-biscuit-columns">'
          + columns.map(function (col) {
            var section = esc(col.section || '');
            var weight = Math.max(1, Math.round(col.weight || 1));
            return '<section class="ship-biscuit-column" data-section="' + section + '" style="--ship-biscuit-col-weight:' + weight + '">'
              + '<h3 class="ship-biscuit-column-title">' + section + '</h3>'
              + '<ul class="ship-biscuit-column-list">' + col.stubs.map(columnArticle).join('') + '</ul>'
              + '</section>';
          }).join('')
          + '</div>'
        : '';
      var stubsBlock = stubs.length
        ? '<ul class="ship-biscuit-stubs" data-testid="ship-biscuit-stubs">' + stubs.map(stubArticle).join('') + '</ul>'
        : '';
      bodyHtml = columnsBlock + stubsBlock;
    }

    editionEl.innerHTML = lead + '<div class="ship-biscuit-articles">' + bodyHtml + '</div>';
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
