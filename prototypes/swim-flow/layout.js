/* swim-flow prototype — layout engine + renderers.
 * No build step; loaded as a plain script after data.js (window.SAMPLE). */
(function () {
  'use strict';

  var DOT = { started: '◐', todo: '○', backlog: '○', done: '✓' };
  var PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];
  var NS = 'http://www.w3.org/2000/svg';

  // ── Model ────────────────────────────────────────────────────────────────
  function buildModel() {
    var nodes = window.SAMPLE.slice();
    var byId = {};
    nodes.forEach(function (n, i) { n._i = i; byId[n.id] = n; });

    var blocks = [];
    var parents = [];      // [parentId, childId]
    var childrenOf = {};
    var depth = {};
    nodes.forEach(function (n) { childrenOf[n.id] = []; });
    nodes.forEach(function (n) {
      (n.blocks || []).forEach(function (t) { if (byId[t]) blocks.push([n.id, t]); });
      if (n.parent && byId[n.parent]) { parents.push([n.parent, n.id]); childrenOf[n.parent].push(n.id); }
    });
    function depthOf(id) {
      if (depth[id] != null) return depth[id];
      var n = byId[id];
      return (depth[id] = (n.parent && byId[n.parent]) ? depthOf(n.parent) + 1 : 0);
    }
    nodes.forEach(function (n) { depthOf(n.id); });

    // Connected components over all edges (for separation in spine view)
    var uf = {};
    nodes.forEach(function (n) { uf[n.id] = n.id; });
    function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
    function union(a, b) { uf[find(a)] = find(b); }
    blocks.concat(parents).forEach(function (e) { union(e[0], e[1]); });

    // Longest-path rank over directed edges (blocks + parent)
    var indeg = {}, adj = {};
    nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; });
    blocks.concat(parents).forEach(function (e) { adj[e[0]].push(e[1]); indeg[e[1]]++; });
    var rank = {}, q = [];
    nodes.forEach(function (n) { if (indeg[n.id] === 0) { rank[n.id] = 0; q.push(n.id); } });
    while (q.length) {
      var u = q.shift();
      adj[u].forEach(function (v) { rank[v] = Math.max(rank[v] || 0, rank[u] + 1); if (--indeg[v] === 0) q.push(v); });
    }

    var compOrder = {}, o = 0;
    nodes.forEach(function (n) { var r = find(n.id); if (compOrder[r] == null) compOrder[r] = o++; });
    var comps = {};
    nodes.forEach(function (n) { var r = find(n.id); (comps[r] = comps[r] || []).push(n); });
    var components = Object.keys(comps).sort(function (a, b) { return compOrder[a] - compOrder[b]; }).map(function (r) { return comps[r]; });

    return { nodes: nodes, byId: byId, blocks: blocks, parents: parents, childrenOf: childrenOf, depth: depth, rank: rank, components: components };
  }

  // ── Card builders ───────────────────────────────────────────────────────────
  function cardEl(n, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'card' + (opts.chip ? ' chip' : '') + (opts.header ? ' header' : '');
    el.setAttribute('data-id', n.id);
    el.setAttribute('data-state', n.state);
    el.setAttribute('data-type', n.type || 'task');
    var caret = opts.header ? '<span class="caret">▾</span>' : '';
    el.innerHTML =
      '<div class="row">' + caret +
        '<span class="dot">' + DOT[n.state] + '</span>' +
        '<span class="id">' + n.id + '</span>' +
        '<span class="title">' + n.title + '</span>' +
        '<span class="type">' + (n.type || 'task') + '</span>' +
      '</div>';
    el.addEventListener('click', function () { el.classList.toggle('expanded'); });
    return el;
  }

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function svgNode(tag) { return document.createElementNS(NS, tag); }
  function svgEl() { var s = svgNode('svg'); s.setAttribute('class', 'edges'); return s; }
  function pathEl(d, cls) { var p = svgNode('path'); p.setAttribute('d', d); if (cls) p.setAttribute('class', cls); return p; }

  function rectOf(stage, id) {
    var el = stage.querySelector('[data-id="' + id + '"]');
    if (!el) return null;
    var s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height,
             cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2,
             right: r.right - s.left, bottom: r.bottom - s.top };
  }
  function sizeSvg(stage, svg) {
    var r = stage.getBoundingClientRect();
    svg.setAttribute('width', r.width); svg.setAttribute('height', stage.scrollHeight);
    svg.setAttribute('viewBox', '0 0 ' + r.width + ' ' + stage.scrollHeight);
  }

  // ── Renderer: Side-rail (nested boxes + gutter bars) ─────────────────────────
  function renderRail(stage, model) {
    stage.innerHTML = '';
    var svg = svgEl(); stage.appendChild(svg);
    var stack = mk('div', 'stack has-rail'); stage.appendChild(stack);

    function sortIds(ids) {
      return ids.slice().sort(function (a, b) {
        return (model.rank[a] - model.rank[b]) || (model.byId[a]._i - model.byId[b]._i);
      });
    }
    function renderNode(id, depth, container) {
      var n = model.byId[id];
      var kids = sortIds(model.childrenOf[id]);
      if (kids.length) {
        var box = mk('div', 'group-box');
        box.setAttribute('data-depth', Math.min(depth, 4));
        box.appendChild(cardEl(n, { header: true }));
        var kc = mk('div', 'group-kids');
        kids.forEach(function (c) { renderNode(c, depth + 1, kc); });
        box.appendChild(kc);
        container.appendChild(box);
      } else {
        container.appendChild(cardEl(n, {}));
      }
    }

    var roots = model.nodes.filter(function (n) { return !n.parent || !model.byId[n.parent]; })
      .sort(function (a, b) { return (model.rank[a.id] - model.rank[b.id]) || (a._i - b._i); });
    roots.forEach(function (r, i) {
      if (i > 0) stack.appendChild(mk('div', 'root-sep'));
      renderNode(r.id, 0, stack);
    });

    drawGutterBars(stage, svg, model);
  }

  // Each blocker projects one vertical bar; everything it blocks hangs off it.
  function drawGutterBars(stage, svg, model) {
    sizeSvg(stage, svg);

    // group blocks edges by source
    var bySource = {};
    model.blocks.forEach(function (e) {
      var a = rectOf(stage, e[0]), b = rectOf(stage, e[1]);
      if (!a || !b) return;
      (bySource[e[0]] = bySource[e[0]] || { src: e[0], srcRect: a, targets: [] }).targets.push({ id: e[1], rect: b });
    });
    var groups = Object.keys(bySource).map(function (s) {
      var g = bySource[s];
      var ys = [g.srcRect.cy].concat(g.targets.map(function (t) { return t.rect.cy; }));
      g.top = Math.min.apply(null, ys); g.bot = Math.max.apply(null, ys);
      return g;
    }).sort(function (a, b) { return a.top - b.top; });

    // uniform tick origin to the right of all cards
    var maxRight = 0;
    model.nodes.forEach(function (n) { var r = rectOf(stage, n.id); if (r) maxRight = Math.max(maxRight, r.right); });
    var tickStart = maxRight + 8;
    var mobile = stage.getAttribute('data-w') === 'mobile';
    var STEP = mobile ? 10 : 13, stageW = stage.getBoundingClientRect().width;

    // interval colouring → channel
    var active = [];
    groups.forEach(function (g, i) {
      active = active.filter(function (a) { return a.bot > g.top; });
      var used = {}; active.forEach(function (a) { used[a.chan] = true; });
      var c = 0; while (used[c]) c++;
      g.chan = c; g.color = PALETTE[i % PALETTE.length];
      active.push({ bot: g.bot, chan: c });
    });

    groups.forEach(function (g) {
      var cx = Math.min(tickStart + 12 + g.chan * STEP, stageW - 6);
      var col = g.color;
      // vertical bar
      var bar = pathEl('M' + cx + ',' + g.top + ' L' + cx + ',' + g.bot, 'gbar');
      bar.setAttribute('stroke', col); svg.appendChild(bar);
      // source connector + dot
      var sc = pathEl('M' + g.srcRect.right + ',' + g.srcRect.cy + ' L' + cx + ',' + g.srcRect.cy, 'gtick');
      sc.setAttribute('stroke', col); svg.appendChild(sc);
      var dot = svgNode('circle'); dot.setAttribute('cx', g.srcRect.right); dot.setAttribute('cy', g.srcRect.cy);
      dot.setAttribute('r', 2.5); dot.setAttribute('fill', col); svg.appendChild(dot);
      // target connectors + arrowheads
      g.targets.forEach(function (t) {
        var tc = pathEl('M' + cx + ',' + t.rect.cy + ' L' + (t.rect.right + 1) + ',' + t.rect.cy, 'gtick');
        tc.setAttribute('stroke', col); svg.appendChild(tc);
        var ah = svgNode('polygon');
        var ax = t.rect.right + 1;
        ah.setAttribute('points', (ax + 7) + ',' + (t.rect.cy - 4) + ' ' + (ax + 7) + ',' + (t.rect.cy + 4) + ' ' + ax + ',' + t.rect.cy);
        ah.setAttribute('fill', col); svg.appendChild(ah);
      });
    });
  }

  // ── Renderer: Spine / Hybrid (kept for comparison) ──────────────────────────
  function renderSpine(stage, model, opts) {
    opts = opts || {};
    var chip = opts.chip !== false;
    stage.innerHTML = '';
    var svg = svgEl(); stage.appendChild(svg);
    model.components.forEach(function (comp, ci) {
      if (ci > 0) stage.appendChild(mk('div', 'component-sep'));
      var spine = mk('div', 'spine'); stage.appendChild(spine);
      var layers = {};
      comp.forEach(function (n) { (layers[model.rank[n.id]] = layers[model.rank[n.id]] || []).push(n); });
      Object.keys(layers).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
        var items = layers[r], bloom = items.length > 1;
        var layer = mk('div', 'layer ' + (bloom ? 'bloom' : 'solo'));
        items.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
        items.forEach(function (n) { layer.appendChild(cardEl(n, { chip: bloom && chip })); });
        spine.appendChild(layer);
      });
    });
    sizeSvg(stage, svg);
    model.parents.forEach(function (e) { drawDiag(stage, svg, e[0], e[1], 'edge parent', false); });
    model.blocks.forEach(function (e) {
      if (model.rank[e[1]] - model.rank[e[0]] > 2) return;
      drawDiag(stage, svg, e[0], e[1], 'edge', true);
    });
  }
  function drawDiag(stage, svg, fromId, toId, cls, head) {
    var a = rectOf(stage, fromId), b = rectOf(stage, toId);
    if (!a || !b) return;
    var x1 = a.cx, y1 = a.bottom, x2 = b.cx, y2 = b.y;
    if (y2 < y1) { y1 = a.y; y2 = b.bottom; }
    var dy = Math.max(12, (y2 - y1) * 0.4);
    svg.appendChild(pathEl('M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2, cls));
    if (head) { var ah = svgNode('polygon'); ah.setAttribute('points', (x2 - 4) + ',' + (y2 - 6) + ' ' + (x2 + 4) + ',' + (y2 - 6) + ' ' + x2 + ',' + y2); ah.setAttribute('class', 'edge-head'); svg.appendChild(ah); }
  }

  // ── Bootstrap / switcher ─────────────────────────────────────────────────────
  function render() {
    var stage = document.getElementById('stage');
    var model = buildModel();
    var v = stage.getAttribute('data-v') || 'rail';
    if (v === 'spine') renderSpine(stage, model, { chip: true });
    else if (v === 'hybrid') renderSpine(stage, model, { chip: false });
    else renderRail(stage, model);
  }
  window.SwimFlow = { render: render };

  function applyFromUrl() {
    var p = new URLSearchParams(location.search);
    var stage = document.getElementById('stage');
    stage.setAttribute('data-v', p.get('v') || 'rail');
    stage.setAttribute('data-w', p.get('w') || 'desktop');
    document.querySelectorAll('[data-set-v]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set-v') === (p.get('v') || 'rail')); });
    document.querySelectorAll('[data-set-w]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set-w') === (p.get('w') || 'desktop')); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-set-v]').forEach(function (b) {
      b.addEventListener('click', function () { var p = new URLSearchParams(location.search); p.set('v', b.getAttribute('data-set-v')); location.search = p.toString(); });
    });
    document.querySelectorAll('[data-set-w]').forEach(function (b) {
      b.addEventListener('click', function () { var p = new URLSearchParams(location.search); p.set('w', b.getAttribute('data-set-w')); location.search = p.toString(); });
    });
    applyFromUrl();
    render();
    var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(render, 100); });
  });
})();
