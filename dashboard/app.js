// Pre-Token Radar page. It loads window.SNAPSHOT (the sealed data main.ts copies beside dashboard/) and
// model.js, runs the same model that wrote board.json, and draws the board, a detail view with the value
// arithmetic, a comparables chart and the netted farm plan, the protocols that already trade, and the method.
// No network: every figure is computed here from data.js.
(function () {
  'use strict';

  var S = window.SNAPSHOT, M = window.RadarModel;
  if (!S || !M) return;
  var main = document.getElementById('main');
  var D = M.PARAMS;
  var state = { tab: 'board', q: '', cat: 'all', chain: 'all', conf: 'all', verdict: 'all', minTvl: 0, listOnly: false,
    sort: 'implied_value_usd', dir: -1, sel: null, capital: D.capital, share: D.share, liveSort: 'mcap', liveDir: -1 };
  var board = null, rowsBySlug = {};

  function recompute() {
    board = M.buildBoard(S, { capital: state.capital, share: state.share });
    rowsBySlug = {};
    board.rows.forEach(function (r) { rowsBySlug[r.slug] = r; });
  }

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (props[k] === null || props[k] === undefined) return;
      if (k === 'text') n.textContent = props[k];
      else if (k === 'cls') n.className = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // The HTML parser knows the SVG namespace, so the page never has to spell an address out.
  var SVG_NS = (function () { var d = document.createElement('div'); d.innerHTML = '<svg></svg>'; return d.firstChild.namespaceURI; })();
  function sv(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + (a >= 100 ? Math.round(n) : n.toFixed(2));
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function uniq(list) { var s = {}; list.forEach(function (x) { s[x] = 1; }); return Object.keys(s).sort(); }
  function net(n) { return (n < 0 ? '-' : '+') + usd(Math.abs(n)); }

  // ---- header and strip ----------------------------------------------------------------------
  function drawHead() {
    var m = board.model, b = m.backtest;
    document.getElementById('tag').textContent = 'Snapshot of ' + S.as_of + ' · priced off ' + m.n + ' tokens that already trade · implied value is this page\'s claim, never a forecast that a token launches';
    var st = document.getElementById('stats');
    st.textContent = '';
    var early = board.rows.filter(function (r) { return !r.on_watchlist; }).length;
    [['Ranked', board.rows.length], ['Watchlist', S.watchlist.length], ['Early', early], ['Trading', m.n]].forEach(function (x) {
      st.appendChild(el('div', null, [el('dt', { text: x[0] }), el('dd', { text: String(x[1]) })]));
    });
    var strip = document.getElementById('strip');
    strip.textContent = '';
    strip.appendChild(el('span', { cls: 'sb' }, ['Backtest, each trading protocol priced without itself: ']));
    [['flat ratio', b.flat], ['size curve', b.size], ['size + category (used)', b.full]].forEach(function (x, i) {
      strip.appendChild(el('span', { cls: 'sb' + (i === 2 ? ' on' : '') }, [x[0] + ' ', el('b', { text: '×' + x[1].median.toFixed(1) }), ' median miss, ' + Math.round(x[1].within3 * 100) + '% within ×3']));
    });
    strip.appendChild(el('span', { cls: 'sb' }, ['band on every value: ×' + m.lo.toFixed(2) + ' to ×' + m.hi.toFixed(2)]));
  }

  var tabsEl = document.getElementById('tabs');
  function drawTabs() {
    tabsEl.textContent = '';
    [['board', 'Board'], ['live', 'Already trading'], ['method', 'Method']].forEach(function (t) {
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === t[0]), text: t[1], onclick: function () { state.tab = t[0]; render(); } }));
    });
  }

  // ---- board ---------------------------------------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = board.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.conf !== 'all' && r.confidence !== state.conf) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (r.tvl_usd < state.minTvl) return false;
      return !(state.listOnly && !r.on_watchlist);
    });
    var k = state.sort;
    return rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === 'string') return state.dir * x.localeCompare(y);
      return state.dir * (x - y) || a.rank - b.rank;
    });
  }
  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'],
    ['age_days', 'Age', 'num'], ['implied_value_usd', 'Implied value', 'num'], ['confidence', 'Conf.', ''], ['net_base_usd', 'Net', 'num'], ['verdict', 'Verdict', '']];

  function field(label, input) { return el('label', null, [label, input]); }
  function select(label, value, options, fn) {
    var s = el('select', { 'aria-label': label, onchange: function (e) { fn(e.target.value); } });
    options.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (String(o[0]) === String(value)) op.selected = true; s.appendChild(op); });
    return field(label, s);
  }
  function number(label, value, min, max, step, fn) {
    return field(label, el('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step), 'aria-label': label,
      onchange: function (e) { var v = parseFloat(e.target.value); if (isFinite(v) && v >= min && v <= max) fn(v); else e.target.value = String(value); } }));
  }

  function drawBoard() {
    var cats = uniq(board.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = uniq([].concat.apply([], board.rows.map(function (r) { return r.chains; })));
    var check = el('input', { type: 'checkbox', onchange: function (e) { state.listOnly = e.target.checked; render(); } });
    check.checked = state.listOnly;
    var controls = el('div', { cls: 'controls' }, [
      field('Search', el('input', { type: 'search', value: state.q, placeholder: 'name or category', oninput: function (e) { state.q = e.target.value; fill(); } })),
      select('Category', state.cat, [['all', 'All']].concat(cats.map(function (c) { return [c, c]; })), function (v) { state.cat = v; render(); }),
      select('Chain', state.chain, [['all', 'All']].concat(chains.map(function (c) { return [c, c]; })), function (v) { state.chain = v; render(); }),
      select('Verdict', state.verdict, [['all', 'Any'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip']], function (v) { state.verdict = v; render(); }),
      select('Confidence', state.conf, [['all', 'Any'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], function (v) { state.conf = v; render(); }),
      select('Min TVL', state.minTvl, [[0, 'Any'], [1e7, '$10M'], [5e7, '$50M'], [1e8, '$100M'], [5e8, '$500M']], function (v) { state.minTvl = Number(v); render(); }),
      el('label', { cls: 'check' }, [check, 'Watchlist only']),
      number('Capital ($)', state.capital, 50, 100000, 50, function (v) { state.capital = v; recompute(); render(); }),
      number('Farmer share (%)', Math.round(state.share * 1000) / 10, 0.5, 50, 0.5, function (v) { state.share = v / 100; recompute(); render(); }),
      el('button', { type: 'button', cls: 'reset', text: 'Reset', onclick: function () { state.q = ''; state.cat = state.chain = state.conf = state.verdict = 'all'; state.minTvl = 0; state.listOnly = false; state.capital = D.capital; state.share = D.share; recompute(); render(); } }),
      el('span', { cls: 'count', id: 'count' })
    ]);
    var tr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] });
      if (state.sort === c[0]) th.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending');
      var btn = el('button', { type: 'button', text: c[1], onclick: function () {
        if (state.sort === c[0]) state.dir = -state.dir; else { state.sort = c[0]; state.dir = /^(name|category|rank|verdict)$/.test(c[0]) ? 1 : -1; }
        render();
      } });
      btn.setAttribute('data-arrow', state.dir > 0 ? '▲' : '▼');
      th.appendChild(btn); tr.appendChild(th);
    });
    var table = el('table', { 'aria-label': 'Protocols ranked by implied value' }, [el('thead', null, [tr]), el('tbody', { id: 'rows' })]);
    main.appendChild(el('div', { cls: 'layout' }, [el('section', null, [controls, el('div', { cls: 'wrap' }, [table])]), el('aside', { cls: 'detail', id: 'detail', 'aria-live': 'polite' })]));
    fill();
    drawDetail();
  }

  function fill() {
    var rows = filtered(), body = document.getElementById('rows'), top = board.rows[0].implied_value_usd;
    body.textContent = '';
    document.getElementById('count').textContent = rows.length + ' of ' + board.rows.length;
    if (!rows.length) { body.appendChild(el('tr', null, [el('td', { colspan: String(COLS.length), cls: 'empty', text: 'No protocol matches these filters.' })])); return; }
    rows.forEach(function (r) {
      var nameCell = el('td', { cls: 'name', title: r.name }, [r.name]);
      if (r.on_watchlist) nameCell.appendChild(el('span', { cls: 'pill w', text: 'W', title: 'On the house watchlist' }));
      var tr = el('tr', { tabindex: '0', 'aria-selected': String(state.sel === r.slug) }, [
        el('td', { cls: 'rank', text: String(r.rank) }), nameCell, el('td', { text: r.category || 'Uncategorised' }),
        el('td', { cls: 'num', text: usd(r.tvl_usd) }),
        el('td', { cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        el('td', { cls: 'num', text: age(r.age_days) }),
        el('td', { cls: 'num' }, [el('div', { cls: 'val' }, [el('span', { text: usd(r.implied_value_usd) }), el('span', { cls: 'bar' }, [el('i', { style: 'width:' + Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / top))) + '%' })])])]),
        el('td', { cls: 'conf ' + r.confidence, text: r.confidence }),
        el('td', { cls: 'num ' + (r.net_base_usd >= 0 ? 'up' : 'down'), text: net(r.net_base_usd) }),
        el('td', null, [el('span', { cls: 'pill v-' + r.verdict, text: r.verdict })])
      ]);
      function pick() { state.sel = r.slug; Array.prototype.forEach.call(body.children, function (x) { x.setAttribute('aria-selected', 'false'); }); tr.setAttribute('aria-selected', 'true'); drawDetail(); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      body.appendChild(tr);
    });
  }

  // ---- detail --------------------------------------------------------------------------------
  function chart(r) {
    var m = board.model, W = 372, H = 196, L = 40, B = 24, T = 8, R = 8, pts = m.points;
    var xs = pts.map(function (p) { return Math.log(p.tvl); }).concat([Math.log(r.tvl_usd)]);
    var ys = pts.map(function (p) { return Math.log(p.ratio); }).concat([Math.log(r.value_low_usd / r.tvl_usd), Math.log(r.value_high_usd / r.tvl_usd)]);
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    function X(v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap to TVL against TVL for protocols that trade, the fitted curve and this protocol' });
    svg.appendChild(sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'none', stroke: 'var(--line)' }));
    [1e7, 1e8, 1e9].forEach(function (t) { if (Math.log(t) > x0 && Math.log(t) < x1) { svg.appendChild(sv('line', { x1: X(Math.log(t)), x2: X(Math.log(t)), y1: T, y2: H - B, stroke: 'var(--line)', 'stroke-dasharray': '2 3' })); svg.appendChild(sv('text', { x: X(Math.log(t)), y: H - 10, 'text-anchor': 'middle', 'font-size': '9' }, usd(t))); } });
    [0.1, 1].forEach(function (t) { if (Math.log(t) > y0 && Math.log(t) < y1) { svg.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(Math.log(t)), y2: Y(Math.log(t)), stroke: 'var(--line)', 'stroke-dasharray': '2 3' })); svg.appendChild(sv('text', { x: L - 4, y: Y(Math.log(t)) + 3, 'text-anchor': 'end', 'font-size': '9' }, '×' + t)); } });
    pts.forEach(function (p) { svg.appendChild(sv('circle', { cx: X(Math.log(p.tvl)), cy: Y(Math.log(p.ratio)), r: 2.4, fill: 'var(--muted)', opacity: '0.55' })); });
    var cat = r.category || 'Uncategorised';
    svg.appendChild(sv('line', { x1: X(x0), y1: Y(M.predict(m, x0, cat)), x2: X(x1), y2: Y(M.predict(m, x1, cat)), stroke: 'var(--ink)', 'stroke-width': '1.5' }));
    var cx = X(Math.log(r.tvl_usd));
    svg.appendChild(sv('line', { x1: cx, x2: cx, y1: Y(Math.log(r.value_high_usd / r.tvl_usd)), y2: Y(Math.log(r.value_low_usd / r.tvl_usd)), stroke: 'var(--signal)', 'stroke-width': '3' }));
    svg.appendChild(sv('rect', { x: cx - 4, y: Y(Math.log(r.ratio)) - 4, width: 8, height: 8, fill: 'var(--signal)', transform: 'rotate(45 ' + cx + ' ' + Y(Math.log(r.ratio)) + ')' }));
    svg.appendChild(sv('text', { x: L + 4, y: T + 10, 'font-size': '9' }, 'market cap ÷ TVL, log scales'));
    return svg;
  }

  function drawDetail() {
    var box = document.getElementById('detail');
    box.textContent = '';
    var r = rowsBySlug[state.sel];
    if (!r) { box.appendChild(el('p', { cls: 'hint', text: 'Select a protocol to see how its value is built, who it compares with, and what farming it nets.' })); return; }
    var p = S.protocols.filter(function (x) { return x.slug === r.slug; })[0], v = M.valueOf(board.model, p, S.as_of);
    var f = r.farm;
    box.appendChild(el('h2', { text: r.name }));
    box.appendChild(el('div', { cls: 'sub', text: '#' + r.rank + ' · ' + (r.category || 'Uncategorised') + ' · ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist') }));
    box.appendChild(el('div', { cls: 'big', text: usd(r.implied_value_usd) }));
    box.appendChild(el('div', { cls: 'small', text: 'band ' + usd(r.value_low_usd) + ' to ' + usd(r.value_high_usd) + ' · confidence ' + r.confidence + ' (' + r.category_sample + ' trading in this category)' }));
    box.appendChild(el('div', { cls: 'chips' }, r.chains.slice(0, 6).map(function (c) { return el('span', { text: c }); }).concat(r.chains.length > 6 ? [el('span', { text: '+' + (r.chains.length - 6) })] : [])));

    box.appendChild(el('h3', { text: 'How the value is built' }));
    function line(a, b) { return el('div', null, [el('span', { text: a }), el('span', { text: b })]); }
    box.appendChild(el('div', { cls: 'build' }, [
      line('TVL', usd(r.tvl_usd)),
      line('Market cap ÷ TVL from the curve at this size', '×' + r.ratio.toFixed(3)),
      line('Growth tilt (' + pct(r.change_7d) + ', capped)', '×' + r.growth_multiplier.toFixed(3)),
      line('Time-tracked tilt (' + age(r.age_days) + ', capped)', '×' + r.age_multiplier.toFixed(3)),
      el('div', { cls: 'total' }, [el('span', { text: 'Implied value' }), el('span', { text: usd(v.value) + (v.value === r.implied_value_usd ? ' ✓ matches board.json' : ' ✗ differs') })])
    ]));
    box.appendChild(el('div', { cls: 'note', text: 'The tilts are judgment. The backtest finds no signal in growth or time tracked, so each is capped at about 15%.' }));

    box.appendChild(el('h3', { text: 'Against the protocols that trade' }));
    box.appendChild(chart(r));
    var near = board.model.points.slice().sort(function (a, b) {
      return (a.category === (r.category || 'Uncategorised') ? 0 : 1) - (b.category === (r.category || 'Uncategorised') ? 0 : 1) || Math.abs(Math.log(a.tvl / r.tvl_usd)) - Math.abs(Math.log(b.tvl / r.tvl_usd));
    }).slice(0, 4);
    box.appendChild(el('div', { cls: 'build' }, near.map(function (c) { return line(c.name + ' · ' + usd(c.tvl) + ' TVL', usd(c.mcap) + ' (×' + c.ratio.toFixed(2) + ')'); })));

    box.appendChild(el('h3', { text: 'Farm plan at ' + usd(f.capital) + ': ' + r.verdict }));
    box.appendChild(el('div', { cls: 'build' }, [
      line('Reward, low · base · high', usd(f.reward.low) + ' · ' + usd(f.reward.base) + ' · ' + usd(f.reward.high)),
      line('Fees, friction and carry', '-' + usd(f.costs)),
      el('div', { cls: 'total' }, [el('span', { text: 'Net, low · base · high' }), el('span', { text: net(f.net.low) + ' · ' + net(f.net.base) + ' · ' + net(f.net.high) })])
    ]));
    var ol = el('ol', { cls: 'steps' });
    f.steps.forEach(function (s) { ol.appendChild(el('li', null, [s.text, el('span', { cls: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time })])); });
    box.appendChild(ol);
    box.appendChild(el('div', { cls: 'note', text: 'The snapshot holds no airdrop data. The farmer share and the chance a token launches are assumptions you can change above. A plan never promises a token, and the capital stays yours.' }));
  }

  // ---- already trading -----------------------------------------------------------------------
  function drawLive() {
    var pts = board.model.points.slice().sort(function (a, b) { var x = a[state.liveSort], y = b[state.liveSort]; return typeof x === 'string' ? state.liveDir * x.localeCompare(y) : state.liveDir * (x - y); });
    var cols = [['name', 'Protocol', ''], ['category', 'Category', ''], ['tvl', 'TVL', 'num'], ['mcap', 'Market cap', 'num'], ['ratio', 'Market cap ÷ TVL', 'num']];
    var tr = el('tr');
    cols.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] });
      if (state.liveSort === c[0]) th.setAttribute('aria-sort', state.liveDir > 0 ? 'ascending' : 'descending');
      var b = el('button', { type: 'button', text: c[1], onclick: function () { if (state.liveSort === c[0]) state.liveDir = -state.liveDir; else { state.liveSort = c[0]; state.liveDir = -1; } render(); } });
      b.setAttribute('data-arrow', state.liveDir > 0 ? '▲' : '▼');
      th.appendChild(b); tr.appendChild(th);
    });
    var body = el('tbody');
    pts.forEach(function (c) { body.appendChild(el('tr', null, [el('td', { cls: 'name', text: c.name }), el('td', { text: c.category }), el('td', { cls: 'num', text: usd(c.tvl) }), el('td', { cls: 'num', text: usd(c.mcap) }), el('td', { cls: 'num', text: c.ratio.toFixed(2) })])); });
    main.appendChild(el('div', { cls: 'panel' }, [
      el('p', { text: 'These ' + pts.length + ' protocols record a token, so the market sets their value. They stay off the ranked board and are the comparables the model learns from: market cap ÷ TVL, fitted against size and category.' }),
      el('div', { cls: 'wrap' }, [el('table', { 'aria-label': 'Protocols that already trade' }, [el('thead', null, [tr]), body])])
    ]));
  }

  // ---- method --------------------------------------------------------------------------------
  function drawMethod() {
    var m = board.model, b = m.backtest;
    function tr(cells, cls) { return el('tr', null, cells.map(function (c, i) { return el(cls || 'td', { text: c, cls: i ? 'num' : '' }); })); }
    var cats = Object.keys(m.catN).sort(function (x, y) { return m.catN[y] - m.catN[x]; }).slice(0, 12);
    main.appendChild(el('div', { cls: 'panel' }, [
      el('h2', { text: 'What the number means' }),
      el('p', { text: 'Implied value answers one question: if this protocol\'s record stayed as it is, what would its token be worth? It does not say whether or when a token is issued.' }),
      el('h2', { text: 'The model' }),
      el('ol', null, [
        el('li', { text: 'Take the ' + m.n + ' protocols that record a token (exchanges left out). For each, market cap ÷ TVL.' }),
        el('li', { text: 'Fit ln(ratio) on ln(TVL): slope ' + m.slope.toFixed(2) + '. A protocol ten times larger trades at about ' + Math.pow(10, m.slope).toFixed(2) + ' times the ratio. Add a category offset, pulled toward zero with weight ' + D.shrinkK + ' because most categories hold few protocols.' }),
        el('li', { text: 'Price each protocol with no token at TVL × ratio, then tilt by growth and time tracked, each capped near 15% because the backtest cannot confirm them.' }),
        el('li', { text: 'Put a band around every value from the backtest\'s own errors (' + Math.round(D.bandLo * 100) + 'th to ' + Math.round(D.bandHi * 100) + 'th percentile): ×' + m.lo.toFixed(2) + ' to ×' + m.hi.toFixed(2) + '.' })
      ]),
      el('h2', { text: 'Backtest: each trading protocol priced by a fit made without it' }),
      el('table', { 'aria-label': 'Backtest' }, [el('thead', null, [tr(['Model', 'Median miss', 'Within ×2', 'Within ×3'], 'th')]), el('tbody', null, [
        tr(['Flat median ratio', '×' + b.flat.median.toFixed(2), Math.round(b.flat.within2 * 100) + '%', Math.round(b.flat.within3 * 100) + '%']),
        tr(['Size curve', '×' + b.size.median.toFixed(2), Math.round(b.size.within2 * 100) + '%', Math.round(b.size.within3 * 100) + '%']),
        tr(['Size curve + category (used)', '×' + b.full.median.toFixed(2), Math.round(b.full.within2 * 100) + '%', Math.round(b.full.within3 * 100) + '%'])])]),
      el('p', { text: 'Size earns its place. Growth and time tracked did not improve the out-of-sample miss, and chain count is not used. The model still misses by about ×3 for a typical protocol, so read a value as a range.' }),
      el('h2', { text: 'Farm economics' }),
      el('p', { text: 'Reward = implied value × farmer share × capital ÷ TVL, at the low, base and high of the band. Costs: transaction fees on the cheapest chain the protocol records, ' + (D.friction * 100).toFixed(1) + '% friction on the capital, and ' + (D.carry * 100) + '% a year of carry over the hold. Verdict: farm when the low band nets above zero, thin when only the base does, skip otherwise. The farmer share is an assumption (default ' + D.share * 100 + '%), not a figure in the data.' }),
      el('h2', { text: 'Calibration by category' }),
      el('table', { 'aria-label': 'Categories' }, [el('thead', null, [tr(['Category', 'Trading', 'Offset'], 'th')]), el('tbody', null, cats.map(function (c) { return tr([c, String(m.catN[c]), (m.off[c] === undefined ? 0 : Math.exp(m.off[c])).toFixed(2) + '×']); }))]),
      el('h2', { text: 'Limits' }),
      el('p', { text: 'No protocol name is special-cased: one function prices every row. The snapshot carries no airdrop flag, points data or token plans, so the board ranks by size and record, not by a promise.' })
    ]));
  }

  function render() {
    drawHead(); drawTabs();
    main.textContent = '';
    if (state.tab === 'board') drawBoard(); else if (state.tab === 'live') drawLive(); else drawMethod();
  }
  function readHash() {
    (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 1) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'tab' && /^(board|live|method)$/.test(v)) state.tab = v;
      else if (k === 'q') state.q = v; else if (k === 'cat') state.cat = v; else if (k === 'chain') state.chain = v;
      else if (k === 'conf') state.conf = v; else if (k === 'verdict') state.verdict = v; else if (k === 'min') state.minTvl = Number(v) || 0;
      else if (k === 'list') state.listOnly = v === '1'; else if (k === 'sel') state.sel = v;
      else if (k === 'capital' && Number(v) >= 50) state.capital = Number(v); else if (k === 'share' && Number(v) > 0) state.share = Number(v) / 100;
    });
  }
  readHash();
  recompute();
  if (!state.sel || !rowsBySlug[state.sel]) state.sel = board.rows[0].slug;
  document.getElementById('foot').textContent = 'Source: ' + S.source + '. Watchlist floor ' + usd(S.floor_usd) + ' of TVL; the W mark shows a protocol on it. The watchlist is a floor: rows without it sit below the floor or outside its rule.';
  render();
})();
