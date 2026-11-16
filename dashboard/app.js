// Pre-Token Radar dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and draws a
// sortable, filterable board, a detail view with the value arithmetic and the farm plan, a view of the
// protocols that already trade, and the method. No network: every figure comes from data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var main = document.getElementById('main');
  var state = { tab: 'board', q: '', cat: 'all', chain: 'all', conf: 'all', minTvl: 0, listOnly: false, sort: 'implied_value_usd', dir: -1, sel: null, liveSort: 'mcap_usd', liveDir: -1 };
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'cls') n.className = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
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
  function mult(n) { return '×' + n.toFixed(2); }
  function uniq(list) { var s = {}; list.forEach(function (x) { s[x] = 1; }); return Object.keys(s).sort(); }

  // ---- header -------------------------------------------------------------------------------
  document.getElementById('tag').textContent = 'Snapshot of ' + D.as_of + ' · model ' + D.model_version + ' · implied value is this page\'s claim, not a forecast that any token launches';
  var stats = document.getElementById('stats');
  [['Ranked', D.board_size], ['Watchlist', D.watchlist_size], ['Early', D.early_size], ['Trading', D.live_size]].forEach(function (s) {
    stats.appendChild(el('div', null, [el('dt', { text: s[0] }), el('dd', { text: String(s[1]) })]));
  });
  document.getElementById('foot').textContent = 'Source: ' + D.source + '. Watchlist floor ' + usd(D.floor_usd) + ' of TVL. The watchlist is a floor: rows without the W mark sit below it or outside its rule.';

  var tabsEl = document.getElementById('tabs');
  var TABS = [['board', 'Board'], ['live', 'Already trading'], ['method', 'Method']];
  function drawTabs() {
    tabsEl.textContent = '';
    TABS.forEach(function (t) {
      var b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === t[0]), text: t[1], onclick: function () { state.tab = t[0]; render(); } });
      tabsEl.appendChild(b);
    });
  }

  // ---- model arithmetic, repeated so the page and board.json visibly agree -------------------
  function recompute(r) {
    return Math.max(1, Math.round(r.tvl_usd * r.parts.ratio * r.parts.growth_multiplier * r.parts.age_multiplier * r.parts.breadth_multiplier));
  }

  // ---- board --------------------------------------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.conf !== 'all' && r.confidence !== state.conf) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.listOnly && !r.on_watchlist) return false;
      return true;
    });
    var k = state.sort;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === 'string') return state.dir * x.localeCompare(y);
      return state.dir * (x - y) || a.rank - b.rank;
    });
    return rows;
  }

  var COLS = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''], ['tvl_usd', 'TVL', 'num'],
    ['change_7d', '7d', 'num'], ['age_days', 'Age', 'num'], ['implied_value_usd', 'Implied value', 'num'],
    ['confidence', 'Conf.', ''], ['farm_capital_usd', 'Farm cost', 'num']
  ];

  function selectBox(label, value, options, onchange) {
    var s = el('select', { 'aria-label': label, onchange: function (e) { onchange(e.target.value); } });
    options.forEach(function (o) {
      var op = el('option', { value: o[0], text: o[1] });
      if (String(o[0]) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    return el('label', null, [label, s]);
  }

  function drawBoard() {
    var rows = filtered();
    var cats = uniq(D.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = uniq([].concat.apply([], D.rows.map(function (r) { return r.chains; })));
    var controls = el('div', { cls: 'controls' }, [
      el('label', null, ['Search', el('input', { type: 'search', value: state.q, placeholder: 'name, slug or category', oninput: function (e) { state.q = e.target.value; refreshTable(); } })]),
      selectBox('Category', state.cat, [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), function (v) { state.cat = v; render(); }),
      selectBox('Chain', state.chain, [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), function (v) { state.chain = v; render(); }),
      selectBox('Confidence', state.conf, [['all', 'Any'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], function (v) { state.conf = v; render(); }),
      selectBox('Min TVL', state.minTvl, [[0, 'Any'], [1e7, '$10M'], [5e7, '$50M'], [1e8, '$100M'], [5e8, '$500M']], function (v) { state.minTvl = Number(v); render(); }),
      el('label', { cls: 'check' }, [el('input', { type: 'checkbox', checked: state.listOnly ? 'checked' : null, onchange: function (e) { state.listOnly = e.target.checked; render(); } }), 'Watchlist only']),
      el('button', { type: 'button', cls: 'reset', text: 'Reset', onclick: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.conf = 'all'; state.minTvl = 0; state.listOnly = false; render(); } }),
      el('span', { cls: 'count', id: 'count' })
    ]);
    if (!state.listOnly) controls.querySelector('input[type=checkbox]').removeAttribute('checked');

    var table = el('table', { 'aria-label': 'Protocols ranked by implied value' });
    var tr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] });
      if (state.sort === c[0]) th.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending');
      var btn = el('button', { type: 'button', text: c[1], onclick: function () {
        if (state.sort === c[0]) state.dir = -state.dir; else { state.sort = c[0]; state.dir = c[0] === 'name' || c[0] === 'category' || c[0] === 'rank' ? 1 : -1; }
        render();
      } });
      btn.setAttribute('data-arrow', state.dir > 0 ? '▲' : '▼');
      th.appendChild(btn);
      tr.appendChild(th);
    });
    table.appendChild(el('thead', null, [tr]));
    var tbody = el('tbody', { id: 'rows' });
    table.appendChild(tbody);
    var wrap = el('div', { cls: 'wrap' }, [table]);
    var detail = el('aside', { cls: 'detail', id: 'detail', 'aria-live': 'polite' });
    main.appendChild(el('div', { cls: 'layout' }, [el('section', null, [controls, wrap]), detail]));
    fillRows(rows);
    drawDetail();
  }

  function fillRows(rows) {
    var tbody = document.getElementById('rows');
    tbody.textContent = '';
    document.getElementById('count').textContent = rows.length + ' of ' + D.rows.length + ' rows';
    if (!rows.length) { tbody.appendChild(el('tr', null, [el('td', { colspan: String(COLS.length), cls: 'empty', text: 'No protocol matches these filters.' })])); return; }
    rows.forEach(function (r) {
      var nameCell = el('td', { cls: 'name', title: r.name }, [r.name]);
      if (r.on_watchlist) nameCell.appendChild(el('span', { cls: 'pill w', text: 'W', title: 'On the house watchlist' }));
      var tr = el('tr', { tabindex: '0', 'aria-selected': String(state.sel === r.slug) }, [
        el('td', { cls: 'rank', text: String(r.rank) }),
        nameCell,
        el('td', { text: r.category || 'Uncategorised' }),
        el('td', { cls: 'num', text: usd(r.tvl_usd) }),
        el('td', { cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        el('td', { cls: 'num', text: age(r.age_days) }),
        el('td', { cls: 'num' }, [el('div', { cls: 'val' }, [el('span', { text: usd(r.implied_value_usd) }), el('span', { cls: 'bar' }, [el('i', { style: 'width:' + Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / maxImplied))) + '%' })])])]),
        el('td', { cls: 'conf ' + r.confidence, text: r.confidence }),
        el('td', { cls: 'num', text: usd(r.farm_capital_usd) })
      ]);
      function pick() { state.sel = r.slug; Array.prototype.forEach.call(tbody.children, function (x) { x.setAttribute('aria-selected', 'false'); }); tr.setAttribute('aria-selected', 'true'); drawDetail(); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      tbody.appendChild(tr);
    });
  }
  function refreshTable() { fillRows(filtered()); }

  function drawDetail() {
    var box = document.getElementById('detail');
    box.textContent = '';
    var r = D.rows.filter(function (x) { return x.slug === state.sel; })[0];
    if (!r) { box.appendChild(el('p', { cls: 'hint', text: 'Select a protocol to see how its implied value is built and how to farm it.' })); return; }
    var p = r.parts;
    var check = recompute(r) === r.implied_value_usd;
    box.appendChild(el('h2', { text: r.name }));
    box.appendChild(el('div', { cls: 'sub', text: '#' + r.rank + ' · ' + (r.category || 'Uncategorised') + ' · ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist') }));
    box.appendChild(el('div', { cls: 'big', text: usd(r.implied_value_usd) }));
    box.appendChild(el('div', { cls: 'small', text: 'implied token value · confidence ' + r.confidence + ' (' + p.category_sample + ' trading ' + (r.category || 'uncategorised') + ' protocols in the sample)' }));
    box.appendChild(el('div', { cls: 'chips' }, r.chains.slice(0, 8).map(function (c) { return el('span', { text: c }); }).concat(r.chains.length > 8 ? [el('span', { text: '+' + (r.chains.length - 8) })] : [])));

    box.appendChild(el('h3', { text: 'How the value is built' }));
    function line(a, b) { return el('div', null, [el('span', { text: a }), el('span', { text: b })]); }
    box.appendChild(el('div', { cls: 'build' }, [
      line('TVL', usd(r.tvl_usd)),
      line('Market cap ÷ TVL for this category and size', '×' + p.ratio.toFixed(4)),
      line('7-day growth (' + pct(r.change_7d) + ')', mult(p.growth_multiplier)),
      line('Time with no token (' + age(r.age_days) + ')', mult(p.age_multiplier)),
      line('Chains (' + r.chains.length + ')', mult(p.breadth_multiplier)),
      el('div', { cls: 'total' }, [el('span', { text: 'Implied value' }), el('span', { text: usd(recompute(r)) + (check ? ' ✓ matches board.json' : ' ✗ differs') })])
    ]));

    box.appendChild(el('h3', { text: 'Farm plan · about ' + usd(r.farm_capital_usd) + ' of capital, ' + usd(r.farm_gas_usd) + ' of fees, ' + r.farm_days + ' days' }));
    var ol = el('ol', { cls: 'steps' });
    r.plan.forEach(function (s) {
      ol.appendChild(el('li', null, [s.text, el('span', { cls: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time })]));
    });
    box.appendChild(ol);
    box.appendChild(el('div', { cls: 'note', text: 'The snapshot holds no airdrop data. A plan is a guess at what activity a rewards program might count. It never promises a token, and the capital stays yours.' }));
  }

  // ---- protocols that already trade ---------------------------------------------------------
  function drawLive() {
    var rows = D.live.slice().sort(function (a, b) {
      var x = a[state.liveSort], y = b[state.liveSort];
      if (typeof x === 'string') return state.liveDir * x.localeCompare(y);
      return state.liveDir * ((x === null ? -Infinity : x) - (y === null ? -Infinity : y));
    });
    var cols = [['name', 'Protocol', ''], ['category', 'Category', ''], ['tvl_usd', 'TVL', 'num'], ['mcap_usd', 'Market cap', 'num'], ['ratio', 'Market cap ÷ TVL', 'num'], ['change_7d', '7d', 'num']];
    var tr = el('tr');
    cols.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] });
      if (state.liveSort === c[0]) th.setAttribute('aria-sort', state.liveDir > 0 ? 'ascending' : 'descending');
      var b = el('button', { type: 'button', text: c[1], onclick: function () { if (state.liveSort === c[0]) state.liveDir = -state.liveDir; else { state.liveSort = c[0]; state.liveDir = -1; } render(); } });
      b.setAttribute('data-arrow', state.liveDir > 0 ? '▲' : '▼');
      th.appendChild(b); tr.appendChild(th);
    });
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null, [
        el('td', { cls: 'name', text: r.name }), el('td', { text: r.category || 'Uncategorised' }),
        el('td', { cls: 'num', text: usd(r.tvl_usd) }), el('td', { cls: 'num', text: usd(r.mcap_usd) }),
        el('td', { cls: 'num', text: r.ratio.toFixed(2) }), el('td', { cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) })
      ]));
    });
    main.appendChild(el('div', { cls: 'panel' }, [
      el('p', { text: 'These protocols record a token, so the market sets their value. They are kept off the ranked board. The model learns from them: the ratio of market cap to TVL, by category and size, is what prices the protocols without a token. Showing the ' + D.live_size + ' largest of ' + D.calibration.sample_size + ' used.' }),
      el('div', { cls: 'wrap' }, [el('table', { 'aria-label': 'Protocols that already trade' }, [el('thead', null, [tr]), tbody])])
    ]));
  }

  // ---- method -------------------------------------------------------------------------------
  function drawMethod() {
    var W = D.weights, C = D.calibration;
    var rows = C.categories.slice(0, 14).map(function (c) {
      return el('tr', null, [el('td', { text: c.category }), el('td', { cls: 'num', text: String(c.trading_count) }), el('td', { cls: 'num', text: c.median_ratio.toFixed(2) }), el('td', { cls: 'num', text: c.calibrated_ratio.toFixed(2) })]);
    });
    main.appendChild(el('div', { cls: 'panel' }, [
      el('h2', { text: 'What the number means' }),
      el('p', { text: 'Implied value answers one question: if this protocol\'s record stayed as it is, what would a token be worth? It does not say whether or when a token is issued. The value is this entry\'s own estimate.' }),
      el('h2', { text: 'The model' }),
      el('ol', null, [
        el('li', { text: 'Learn from the ' + C.sample_size + ' protocols that already trade (exchanges left out). For each, compute market cap ÷ TVL.' }),
        el('li', { text: 'Fit a size slope on ln(TVL): ' + C.slope.toFixed(2) + '. Bigger protocols trade at lower ratios, so the ratio shrinks as TVL grows.' }),
        el('li', { text: 'Give each category an offset from its median residual, pulled toward the overall ratio of ' + C.overall_ratio.toFixed(2) + ' when the category has few trading protocols (shrink weight ' + W.shrink_k + ').' }),
        el('li', { text: 'Multiply TVL by the ratio, then by three bounded multipliers: growth, time with no token, and chain breadth.' })
      ]),
      el('table', { 'aria-label': 'Multipliers' }, [
        el('thead', null, [el('tr', null, [el('th', { text: 'Multiplier' }), el('th', { text: 'Rule' })])]),
        el('tbody', null, [
          el('tr', null, [el('td', { text: 'Growth' }), el('td', { text: '1 + 0.35 × the 7-day TVL change, the change held between ' + W.growth_floor + '% and +' + W.growth_cap + '%. Range ×0.83 to ×1.35.' })]),
          el('tr', null, [el('td', { text: 'Time with no token' }), el('td', { text: 'From ×' + W.age_floor + ' (new) to ×' + (W.age_floor + W.age_range).toFixed(1) + ' at ' + W.age_days_cap + ' days. Unknown age is ×1.' })]),
          el('tr', null, [el('td', { text: 'Chain breadth' }), el('td', { text: '+3% per extra chain, up to ' + W.breadth_max_extra_chains + ' extra chains.' })])
        ])
      ]),
      el('h2', { text: 'Calibration by category' }),
      el('table', { 'aria-label': 'Calibration' }, [
        el('thead', null, [el('tr', null, [el('th', { text: 'Category' }), el('th', { cls: 'num', text: 'Trading' }), el('th', { cls: 'num', text: 'Median ratio' }), el('th', { cls: 'num', text: 'Used ratio' })])]),
        el('tbody', null, rows)
      ]),
      el('h2', { text: 'Confidence' }),
      el('p', { text: 'High means eight or more trading protocols in the category. Medium means three to seven. Low means fewer, and a low row leans on the overall ratio. A missing age or growth figure lowers a row one step.' }),
      el('h2', { text: 'Limits' }),
      el('p', { text: 'No protocol name is special-cased: one function prices every row. The snapshot carries no airdrop flag, no points data and no token plans, so the board ranks by size and record, not by a promise. Farm plans are generic by category and chain.' })
    ]));
  }

  function render() {
    drawTabs();
    main.textContent = '';
    if (state.tab === 'board') drawBoard();
    else if (state.tab === 'live') drawLive();
    else drawMethod();
  }
  // A link can open a view: #tab=board&cat=Lending&conf=high&sel=<slug>&q=<text>&list=1
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 1) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'tab' && (v === 'board' || v === 'live' || v === 'method')) state.tab = v;
      else if (k === 'q') state.q = v;
      else if (k === 'cat') state.cat = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'conf') state.conf = v;
      else if (k === 'min') state.minTvl = Number(v) || 0;
      else if (k === 'list') state.listOnly = v === '1';
      else if (k === 'sel') state.sel = v;
    });
  }
  readHash();
  if (D.rows.length && !state.sel) state.sel = D.rows[0].slug;
  render();
})();
