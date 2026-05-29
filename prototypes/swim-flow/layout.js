/* swim-flow prototype — layout engine + three renderers.
 * No build step; loaded as a plain script after data.js (window.SAMPLE). */
(function () {
  'use strict';

  var DOT = { started: '◐', todo: '○', backlog: '○', done: '✓' };

  // ── Model ────────────────────────────────────────────────────────────────
  function buildModel() {
    var nodes = window.SAMPLE.slice();
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    // Directed edges for ranking: blocks (blocker→blocked) and parent (parent→child)
    var blocks = [];
    var parents = [];
    nodes.forEach(function (n) {
      (n.blocks || []).forEach(function (t) { if (byId[t]) blocks.push([n.id, t]); });
      (n.children || []).forEach(function (c) { if (byId[c]) parents.push([n.id, c]); });
    });
    var directed = blocks.concat(parents);

    // Union-find for connected components (undirected over all edges)
    var parent = {};
    nodes.forEach(function (n) { parent[n.id] = n.id; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { parent[find(a)] = find(b); }
    directed.forEach(function (e) { union(e[0], e[1]); });

    // Longest-path rank (Kahn)
    var indeg = {}, adj = {};
    nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; });
    directed.forEach(function (e) { adj[e[0]].push(e[1]); indeg[e[1]]++; });
    var rank = {};
    var q = [];
    nodes.forEach(function (n) { if (indeg[n.id] === 0) { rank[n.id] = 0; q.push(n.id); } });
    while (q.length) {
      var u = q.shift();
      adj[u].forEach(function (v) {
        rank[v] = Math.max(rank[v] || 0, rank[u] + 1);
        if (--indeg[v] === 0) q.push(v);
      });
    }

    // Group nodes by component, ordered by earliest appearance
    var compOf = {}, compFirst = {}, order = 0;
    nodes.forEach(function (n) {
      var r = find(n.id);
      if (compOf[r] === undefined) { compOf[r] = order++; compFirst[r] = n.id; }
    });
    var comps = {};
    nodes.forEach(function (n) {
      var r = find(n.id);
      (comps[r] = comps[r] || []).push(n);
    });
    var components = Object.keys(comps)
      .sort(function (a, b) { return compOf[a] - compOf[b]; })
      .map(function (r) { return comps[r]; });

    return { nodes: nodes, byId: byId, blocks: blocks, parents: parents, rank: rank, components: components };
  }

  // ── Card builders ──────────────────────────────────────────────────────────
  function cardEl(n, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'card' + (opts.chip ? ' chip' : '');
    el.setAttribute('data-id', n.id);
    el.setAttribute('data-state', n.state);
    el.innerHTML =
      '<div class="row">' +
        '<span class="dot">' + DOT[n.state] + '</span>' +
        '<span class="id">' + n.id + '</span>' +
        '<span class="title">' + n.title + '</span>' +
      '</div>';
    el.addEventListener('click', function () { el.classList.toggle('expanded'); });
    return el;
  }

  function svgEl() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'edges');
    return s;
  }
  function pathEl(d, cls) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls || 'edge');
    return p;
  }
  function arrow(x, y, dir) {
    // small triangle; dir 'down' or 'left'
    var pts = dir === 'left'
      ? (x + 6) + ',' + (y - 4) + ' ' + (x + 6) + ',' + (y + 4) + ' ' + x + ',' + y
      : (x - 4) + ',' + (y - 6) + ' ' + (x + 4) + ',' + (y - 6) + ' ' + x + ',' + y;
    var pe = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    pe.setAttribute('points', pts);
    pe.setAttribute('class', 'edge-head');
    return pe;
  }

  function rectOf(stage, id) {
    var el = stage.querySelector('[data-id="' + id + '"]');
    if (!el) return null;
    var s = stage.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height,
             cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2,
             right: r.right - s.left, bottom: r.bottom - s.top };
  }

  // ── Renderer: Breathing spine (compact chips at blooms) ─────────────────────
  function renderSpine(stage, model, opts) {
    opts = opts || {};
    var chip = opts.chip !== false; // spine=true chips, hybrid=false
    stage.innerHTML = '';
    var svg = svgEl(); stage.appendChild(svg);

    model.components.forEach(function (comp, ci) {
      if (ci > 0) { var sep = document.createElement('div'); sep.className = 'component-sep'; stage.appendChild(sep); }
      var spine = document.createElement('div'); spine.className = 'spine'; stage.appendChild(spine);

      // group by rank
      var layers = {};
      comp.forEach(function (n) { (layers[model.rank[n.id]] = layers[model.rank[n.id]] || []).push(n); });
      Object.keys(layers).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
        var items = layers[r];
        var layer = document.createElement('div');
        var bloom = items.length > 1;
        layer.className = 'layer ' + (bloom ? 'bloom' : 'solo');
        // light barycenter: order bloom items by avg predecessor slot (here: id)
        items.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
        items.forEach(function (n) { layer.appendChild(cardEl(n, { chip: bloom && chip })); });
        spine.appendChild(layer);
      });
    });

    drawHierEdges(stage, svg, model, { longRange: 2 });
  }

  // diagonal/elbow edges for spine + hybrid (source above target)
  function drawHierEdges(stage, svg, model, cfg) {
    sizeSvg(stage, svg);
    model.parents.forEach(function (e) { drawDiag(stage, svg, e[0], e[1], 'edge parent', false); });
    model.blocks.forEach(function (e) {
      var gap = model.rank[e[1]] - model.rank[e[0]];
      if (gap > cfg.longRange) { addXref(stage, e[0], e[1]); return; }
      drawDiag(stage, svg, e[0], e[1], 'edge', true);
    });
  }
  function drawDiag(stage, svg, fromId, toId, cls, head) {
    var a = rectOf(stage, fromId), b = rectOf(stage, toId);
    if (!a || !b) return;
    var x1 = a.cx, y1 = a.bottom, x2 = b.cx, y2 = b.y;
    if (y2 < y1) { y1 = a.y; y2 = b.bottom; } // safety if reversed
    var dy = Math.max(12, (y2 - y1) * 0.4);
    svg.appendChild(pathEl('M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2, cls));
    if (head) svg.appendChild(arrow(x2, y2, 'down'));
  }

  // ── Renderer: Side-rail (full-width stack, lines in right gutter) ───────────
  function renderRail(stage, model) {
    stage.innerHTML = '';
    var svg = svgEl(); stage.appendChild(svg);
    var stack = document.createElement('div'); stack.className = 'stack has-rail'; stage.appendChild(stack);

    // order: component, then rank, then group, then id
    var ordered = [];
    model.components.forEach(function (comp) {
      comp.slice().sort(function (a, b) {
        return (model.rank[a.id] - model.rank[b.id]) || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) || (a.id < b.id ? -1 : 1);
      }).forEach(function (n) { ordered.push(n); });
    });

    var lastGroup = null;
    ordered.forEach(function (n) {
      if (n.group !== lastGroup) {
        var band = document.createElement('div'); band.className = 'group-band'; band.textContent = n.group;
        stack.appendChild(band); lastGroup = n.group;
      }
      stack.appendChild(cardEl(n, {}));
    });

    drawRailEdges(stage, svg, model);
  }

  function drawRailEdges(stage, svg, model) {
    sizeSvg(stage, svg);
    var stageW = stage.getBoundingClientRect().width;
    // build edge intervals
    var edges = model.blocks.map(function (e) {
      var a = rectOf(stage, e[0]), b = rectOf(stage, e[1]);
      if (!a || !b) return null;
      var y1 = a.cy, y2 = b.cy;
      return { from: e[0], to: e[1], a: a, b: b, top: Math.min(y1, y2), bot: Math.max(y1, y2) };
    }).filter(Boolean);
    // interval colouring → channel
    edges.sort(function (x, y) { return x.top - y.top; });
    var active = []; // {bot, chan}
    edges.forEach(function (ed) {
      active = active.filter(function (a) { return a.bot > ed.top; });
      var used = {}; active.forEach(function (a) { used[a.chan] = true; });
      var chan = 0; while (used[chan]) chan++;
      ed.chan = chan; active.push({ bot: ed.bot, chan: chan });
    });
    var GUT = 12, STEP = 11;
    edges.forEach(function (ed) {
      var cx = stageW - GUT - ed.chan * STEP;
      var x1 = ed.a.right, y1 = ed.a.cy, x2 = ed.b.right, y2 = ed.b.cy;
      svg.appendChild(pathEl('M' + x1 + ',' + y1 + ' L' + cx + ',' + y1 + ' L' + cx + ',' + y2 + ' L' + (x2 + 1) + ',' + y2, 'edge'));
      svg.appendChild(arrow(x2 + 1, y2, 'left'));
    });
    // parent edges as subtle left-bracket dashes
    model.parents.forEach(function (e) {
      var a = rectOf(stage, e[0]), b = rectOf(stage, e[1]);
      if (!a || !b) return;
      var x = a.x - 6;
      svg.appendChild(pathEl('M' + a.cx + ',' + a.bottom + ' L' + x + ',' + a.bottom + ' L' + x + ',' + b.cy + ' L' + b.x + ',' + b.cy, 'edge parent'));
    });
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────
  function sizeSvg(stage, svg) {
    var r = stage.getBoundingClientRect();
    svg.setAttribute('width', r.width);
    svg.setAttribute('height', stage.scrollHeight);
    svg.setAttribute('viewBox', '0 0 ' + r.width + ' ' + stage.scrollHeight);
  }
  function addXref(stage, fromId, toId) {
    function tag(hostId, text) {
      var host = stage.querySelector('[data-id="' + hostId + '"] .row');
      if (!host) return;
      var s = document.createElement('span'); s.className = 'xref'; s.textContent = text;
      host.appendChild(s);
    }
    tag(fromId, '⤵ ' + toId);   // source: blocks something far below
    tag(toId, '⤴ ' + fromId);   // target: blocked by something far above
  }

  // ── Bootstrap / switcher ─────────────────────────────────────────────────────
  function render() {
    var stage = document.getElementById('stage');
    var model = buildModel();
    var v = stage.getAttribute('data-v') || 'spine';
    if (v === 'rail') renderRail(stage, model);
    else if (v === 'hybrid') renderSpine(stage, model, { chip: false });
    else renderSpine(stage, model, { chip: true });
  }

  window.SwimFlow = { render: render };

  function applyFromUrl() {
    var p = new URLSearchParams(location.search);
    var stage = document.getElementById('stage');
    stage.setAttribute('data-v', p.get('v') || 'spine');
    stage.setAttribute('data-w', p.get('w') || 'desktop');
    document.querySelectorAll('[data-set-v]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-set-v') === (p.get('v') || 'spine'));
    });
    document.querySelectorAll('[data-set-w]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-set-w') === (p.get('w') || 'desktop'));
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-set-v]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = new URLSearchParams(location.search);
        p.set('v', b.getAttribute('data-set-v')); location.search = p.toString();
      });
    });
    document.querySelectorAll('[data-set-w]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = new URLSearchParams(location.search);
        p.set('w', b.getAttribute('data-set-w')); location.search = p.toString();
      });
    });
    applyFromUrl();
    render();
    window.addEventListener('resize', render);
  });
})();
