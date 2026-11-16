// Pre-Token Radar page. It loads window.SNAPSHOT and window.BOARD (written beside dashboard/ by main.ts) and model.js,
// re-runs the same model that wrote board.json, checks every row against that file, and draws: the thesis and the fitted
// curve, the board with a band and a farm verdict per row, a detail drawer, the traded tokens, the set-aside list and the
// method. No network: every figure is computed here from data.js.
(function () {
  'use strict';
  var S = window.SNAPSHOT, M = window.RadarModel, FILE = window.BOARD;
  if (!S || !M) return;
  var D = M.PARAMS, main = document.getElementById('main'), board, byslug;
  var st = { tab: 'board', q: '', cat: 'all', chain: 'all', tier: 'all', minTvl: 0, list: false, sort: 'rank', dir: 1, sel: null, capital: D.capital, share: D.share, ts: 'mcap', td: -1 };

  function recompute() { board = M.buildBoard(S, { capital: st.capital, share: st.share }); byslug = {}; board.rows.forEach(function (r) { byslug[r.slug] = r; }); }
  function el(tag, p, kids) {
    var n = document.createElement(tag);
    Object.keys(p || {}).forEach(function (k) {
      var v = p[k]; if (v === null || v === undefined) return;
      if (k === 'text') n.textContent = v; else if (k === 'cls') n.className = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // The HTML parser knows the SVG namespace, so the page never spells an address out.
  var NS = (function () { var d = document.createElement('div'); d.innerHTML = '<svg></svg>'; return d.firstChild.namespaceURI; })();
  function sv(tag, a, t) { var n = document.createElementNS(NS, tag); Object.keys(a || {}).forEach(function (k) { n.setAttribute(k, a[k]); }); if (t) n.textContent = t; return n; }
  function usd(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; var a = Math.abs(n); return a >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + (a >= 100 ? Math.round(n) : n.toFixed(2)); }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function net(n) { return (n < 0 ? '-' : '+') + usd(Math.abs(n)); }
  function pc(x) { return Math.round(x * 100) + '%'; }
  function uniq(l) { var s = {}; l.forEach(function (x) { s[x] = 1; }); return Object.keys(s).sort(); }
  function cls(n) { return n === null || n === undefined ? '' : n >= 0 ? 'up' : 'down'; }

  // ---- verification: re-run the model and compare with board.json's digest ------------------------
  function verify() {
    var b0 = M.buildBoard(S), ok = 0;
    b0.rows.forEach(function (r, i) { var f = FILE && FILE[i]; if (f && f[0] === r.slug && f[1] === r.rank && f[2] === r.implied_value_usd && f[3] === r.verdict && f[4] === r.net_base_usd && f[5] === r.rank_lo && f[6] === r.rank_hi) ok++; });
    var bd = document.getElementById('badge'), good = FILE && ok === b0.rows.length;
    bd.textContent = (good ? '✓ page = board.json: ' : '✗ page differs from board.json: ') + ok + ' of ' + b0.rows.length + ' rows match (rank, value, tier, net, rank range)';
    bd.className = 'badge' + (good ? '' : ' bad');
  }

  // ---- curve chart: market cap (traded) or implied value (board) against TVL, log scales ----------
  function chart(W, H, sel) {
    var m = board.model, L = 44, B = 22, T = 8, R = 8, pts = m.points, rows = board.rows;
    var xs = pts.map(function (p) { return Math.log(p.tvl); }).concat(rows.map(function (r) { return Math.log(r.tvl_usd); }));
    var ys = pts.map(function (p) { return Math.log(p.mcap); }).concat(rows.map(function (r) { return Math.log(r.implied_value_usd); }));
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    function X(v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var g = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap against TVL for traded tokens, the fitted curve, and the board at its implied value' });
    g.appendChild(sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'none', stroke: 'var(--line)' }));
    [1e7, 1e8, 1e9, 1e10].forEach(function (t) { var lt = Math.log(t); if (lt > x0 && lt < x1) { g.appendChild(sv('line', { x1: X(lt), x2: X(lt), y1: T, y2: H - B, stroke: 'var(--line)', 'stroke-dasharray': '2 3' })); g.appendChild(sv('text', { x: X(lt), y: H - 8, 'text-anchor': 'middle', 'font-size': 9 }, usd(t))); } });
    [1e5, 1e6, 1e7, 1e8, 1e9, 1e10].forEach(function (t) { var lt = Math.log(t); if (lt > y0 && lt < y1) { g.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(lt), y2: Y(lt), stroke: 'var(--line)', 'stroke-dasharray': '2 3' })); g.appendChild(sv('text', { x: L - 4, y: Y(lt) + 3, 'text-anchor': 'end', 'font-size': 9 }, usd(t))); } });
    pts.forEach(function (p) { g.appendChild(sv('circle', { cx: X(Math.log(p.tvl)), cy: Y(Math.log(p.mcap)), r: 2.3, fill: p.clean ? 'var(--muted)' : 'none', stroke: 'var(--muted)', opacity: p.clean ? 0.55 : 0.8 })); });
    rows.forEach(function (r) { g.appendChild(sv('circle', { cx: X(Math.log(r.tvl_usd)), cy: Y(Math.log(r.implied_value_usd)), r: 2.2, fill: 'var(--signal)', opacity: 0.55 })); });
    var f = function (x) { return Y(Math.log(Math.exp(x) * Math.exp(M.predict(m, x, '')))); };
    g.appendChild(sv('line', { x1: X(x0), y1: f(x0), x2: X(x1), y2: f(x1), stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    if (sel) {
      var cx = X(Math.log(sel.tvl_usd)), cy = Y(Math.log(sel.implied_value_usd));
      g.appendChild(sv('line', { x1: cx, x2: cx, y1: Y(Math.log(sel.value_high_usd)), y2: Y(Math.log(sel.value_low_usd)), stroke: 'var(--signal)', 'stroke-width': 3 }));
      g.appendChild(sv('rect', { x: cx - 4, y: cy - 4, width: 8, height: 8, fill: 'var(--ink)', transform: 'rotate(45 ' + cx + ' ' + cy + ')' }));
    }
    return g;
  }

  // ---- hero ----------------------------------------------------------------------------------
  function hero() {
    var m = board.model, b = m.backtest, t = board.tiers, inw = board.rows.filter(function (r) { return r.on_watchlist; }).length;
    function card(big, label, extra) { return el('div', null, [el('b', { text: big }), el('span', { text: label }), extra]); }
    var cards = el('div', { cls: 'cards' }, [
      card(String(board.rows.length), 'ranked, no token recorded'), card(inw + ' / ' + S.watchlist.length, 'house watchlist covered'), card(String(m.n), 'clean traded tokens the curve is fitted on'),
      card('×' + b.full.median.toFixed(1), 'blind miss, vs ×' + b.flat.median.toFixed(1) + ' for one flat multiple'), card('×' + b.split.miss.toFixed(1), 'on newer tokens (time split), vs ×' + b.split.flat.toFixed(1) + ' flat'),
      card(t.robust + ' · ' + t.farm + ' · ' + t.thin + ' · ' + t.skip, 'robust · farm · thin · skip at ' + usd(st.capital))]);
    var left = el('div', null, [
      el('h2', { text: board.rows.length + ' protocols record no token. Here is what each launch would be worth, and what farming it nets.' }),
      el('p', { text: 'Each value is read off a curve fitted to the ' + m.n + ' clean tokens that already trade, then tilted by 7-day TVL growth and time tracked. No name is hand-picked: one function in model.js prices every row, here and in board.json. Every farm plan is netted against fees, friction and the T-bill return the capital gives up, and carries a band from the model\'s own out-of-sample misses.' }), cards]);
    var a = Math.round(m.cover * 100), c = Math.round(b.split.cover * 100);
    var fig = el('div', { cls: 'fig' }, [chart(500, 236, null), el('div', { cls: 'f' }, [
      el('b', { text: 'value = TVL × ' + Math.exp(m.base).toFixed(3) + ' × (TVL ÷ ' + usd(Math.exp(m.x0)) + ')^' + m.slope.toFixed(2) + ' × category × growth tilt × time tilt' }),
      el('div', { text: 'grey: traded tokens (hollow: kept apart) · orange: the board at its implied value · line: the size curve' }),
      el('div', { text: 'inside the P25–P75 band: ' + a + '% blind, ' + c + '% on newer tokens · within ×3: ' + pc(b.full.within3) + ' vs ' + pc(b.flat.within3) + ' flat' })])]);
    return el('section', { cls: 'hero' }, [left, fig]);
  }

  // ---- board ---------------------------------------------------------------------------------
  function filtered() {
    var q = st.q.trim().toLowerCase();
    var rows = board.rows.filter(function (r) {
      if (q && (r.name + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (st.cat !== 'all' && (r.category || 'Uncategorised') !== st.cat) return false;
      if (st.chain !== 'all' && r.chains.indexOf(st.chain) < 0) return false;
      if (st.tier !== 'all' && r.verdict !== st.tier) return false;
      return r.tvl_usd >= st.minTvl && !(st.list && !r.on_watchlist);
    });
    return rows.sort(function (a, b) {
      var x = a[st.sort], y = b[st.sort]; if (x == null) x = -Infinity; if (y == null) y = -Infinity;
      return typeof x === 'string' ? st.dir * x.localeCompare(y) : st.dir * (x - y) || a.rank - b.rank;
    });
  }
  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num opt'], ['age_days', 'No token', 'num opt'], ['band', 'Band P25–P75', 'opt'], ['implied_value_usd', 'Value', 'num'],
    ['reward_per_1k_usd', '$ per $1K', 'num opt'], ['net_base_usd', 'Net, all costs', 'num'], ['net_per_hour_usd', 'Net per hour', 'num opt'], ['break_even_odds', 'Odds', 'num'], ['verdict', 'Tier', '']];
  function field(l, i) { return el('label', null, [l, i]); }
  function pick(l, v, o, fn) { var s = el('select', { 'aria-label': l, onchange: function (e) { fn(e.target.value); } }); o.forEach(function (x) { var op = el('option', { value: x[0], text: x[1] }); if (String(x[0]) === String(v)) op.selected = true; s.appendChild(op); }); return field(l, s); }

  function drawBoard() {
    // The thesis fills the first screen. Once a row is open or a filter is on, the table and the drawer get the room.
    if (!(st.sel || st.q || st.cat !== 'all' || st.chain !== 'all' || st.tier !== 'all' || st.minTvl || st.list)) main.appendChild(hero());
    var cats = uniq(board.rows.map(function (r) { return r.category || 'Uncategorised'; })), chains = uniq([].concat.apply([], board.rows.map(function (r) { return r.chains; })));
    var ck = el('input', { type: 'checkbox', onchange: function (e) { st.list = e.target.checked; render(); } }); ck.checked = st.list;
    var all = [['all', 'All']];
    var controls = el('div', { cls: 'controls' }, [
      field('Search', el('input', { type: 'search', value: st.q, placeholder: 'name or category', oninput: function (e) { st.q = e.target.value; fill(); } })),
      pick('Category', st.cat, all.concat(cats.map(function (c) { return [c, c]; })), function (v) { st.cat = v; render(); }),
      pick('Chain', st.chain, all.concat(chains.map(function (c) { return [c, c]; })), function (v) { st.chain = v; render(); }),
      pick('Tier', st.tier, [['all', 'Any'], ['robust', 'Robust'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip']], function (v) { st.tier = v; render(); }),
      pick('Min TVL', st.minTvl, [[0, 'Any'], [1e7, '$10M'], [5e7, '$50M'], [1e8, '$100M'], [5e8, '$500M']], function (v) { st.minTvl = Number(v); render(); }),
      pick('Capital', st.capital, [250, 500, 1000, 5000].map(function (c) { return [c, '$' + c]; }), function (v) { st.capital = Number(v); recompute(); render(); }),
      pick('Farmer share of value', st.share, [[0.05, '5%'], [0.08, '8%'], [0.1, '10%'], [0.15, '15%']], function (v) { st.share = Number(v); recompute(); render(); }),
      el('label', { cls: 'check' }, [ck, 'Watchlist only']),
      el('button', { type: 'button', cls: 'reset', text: 'Reset', onclick: function () { st.q = ''; st.cat = st.chain = st.tier = 'all'; st.minTvl = 0; st.list = false; st.capital = D.capital; st.share = D.share; recompute(); render(); } }),
      el('span', { cls: 'count', id: 'count' })]);
    var tr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] }); if (st.sort === c[0]) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      var sortable = c[0] !== 'band';
      var bt = el('button', { type: 'button', text: c[1], 'data-a': st.dir > 0 ? '▲' : '▼', onclick: sortable ? function () { if (st.sort === c[0]) st.dir = -st.dir; else { st.sort = c[0]; st.dir = /^(rank|name|verdict)$/.test(c[0]) ? 1 : -1; } render(); } : null });
      th.appendChild(bt); tr.appendChild(th);
    });
    var table = el('table', { 'aria-label': 'Protocols ranked by implied value' }, [el('thead', null, [tr]), el('tbody', { id: 'rows' })]);
    main.appendChild(el('div', { cls: 'layout' + (st.sel ? ' open' : ''), id: 'layout' }, [el('section', null, [controls, el('div', { cls: 'wrap' }, [table])]), st.sel ? el('aside', { cls: 'detail', id: 'detail', 'aria-live': 'polite' }) : null]));
    fill(); if (st.sel) drawDetail();
  }
  function fill() {
    var rows = filtered(), body = document.getElementById('rows'), lo = Infinity, hi = -Infinity;
    board.rows.forEach(function (r) { lo = Math.min(lo, Math.log(r.value_low_usd)); hi = Math.max(hi, Math.log(r.value_high_usd)); });
    function pos(v) { return ((Math.log(v) - lo) / (hi - lo)) * 100; }
    body.textContent = ''; document.getElementById('count').textContent = rows.length + ' of ' + board.rows.length;
    if (!rows.length) { body.appendChild(el('tr', null, [el('td', { colspan: COLS.length, cls: 'empty', text: 'No protocol matches these filters.' })])); return; }
    rows.forEach(function (r) {
      var nm = el('td', { cls: 'nm', title: r.name }, [r.name, r.on_watchlist ? el('span', { cls: 'pill w', text: 'W', title: 'On the house watchlist' }) : null, el('small', { text: (r.category || 'Uncategorised') + ' · ' + r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') })]);
      var tr = el('tr', { tabindex: 0, 'aria-selected': String(st.sel === r.slug) }, [
        el('td', { cls: 'rk' }, [String(r.rank), el('small', { text: r.rank_lo + '–' + r.rank_hi })]), nm, el('td', { cls: 'num', text: usd(r.tvl_usd) }),
        el('td', { cls: 'num opt ' + cls(r.change_7d), text: pct(r.change_7d) }), el('td', { cls: 'num opt', text: age(r.age_days) }),
        el('td', { cls: 'opt' }, [el('span', { cls: 'band', title: usd(r.value_low_usd) + ' to ' + usd(r.value_high_usd) }, [el('i', { style: 'left:' + pos(r.value_low_usd) + '%;width:' + Math.max(1, pos(r.value_high_usd) - pos(r.value_low_usd)) + '%' }), el('b', { style: 'left:' + pos(r.implied_value_usd) + '%' })])]),
        el('td', { cls: 'num', text: usd(r.implied_value_usd) }), el('td', { cls: 'num opt', text: usd(r.reward_per_1k_usd) }), el('td', { cls: 'num ' + cls(r.net_base_usd), text: net(r.net_base_usd) }),
        el('td', { cls: 'num opt ' + cls(r.net_per_hour_usd), text: net(r.net_per_hour_usd) + '/h' }), el('td', { cls: 'num', text: pc(r.break_even_odds) }), el('td', null, [el('span', { cls: 'pill v-' + r.verdict, text: r.verdict })])]);
      function open() { st.sel = r.slug; render(); }
      tr.addEventListener('click', open); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      body.appendChild(tr);
    });
  }

  // ---- detail --------------------------------------------------------------------------------
  function drawDetail() {
    var box = document.getElementById('detail'), r = byslug[st.sel], f = r && r.farm;
    box.textContent = '';
    if (!r) return;
    var p = S.protocols.filter(function (x) { return x.slug === r.slug; })[0], v = M.valueOf(board.model, p, S.as_of), cat = r.category || 'Uncategorised';
    function line(a, b, c) { return el('div', { cls: c || '' }, [el('span', { text: a }), el('span', { text: b })]); }
    box.appendChild(el('button', { type: 'button', cls: 'reset', text: 'Close', onclick: function () { st.sel = null; render(); } }));
    box.appendChild(el('h2', { text: r.name }));
    box.appendChild(el('div', { cls: 'sub', text: '#' + r.rank + ' (range ' + r.rank_lo + '–' + r.rank_hi + ' over 200 refits) · ' + cat + ' · ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist') }));
    box.appendChild(el('div', { cls: 'big', text: usd(r.implied_value_usd) }));
    box.appendChild(el('div', { cls: 'small', text: 'band ' + usd(r.value_low_usd) + ' to ' + usd(r.value_high_usd) + ' · confidence ' + r.confidence + ' (' + r.category_sample + ' clean traded tokens in this category)' }));
    box.appendChild(el('div', { cls: 'chips' }, r.chains.slice(0, 5).map(function (c) { return el('span', { text: c }); }).concat(r.chains.length > 5 ? [el('span', { text: '+' + (r.chains.length - 5) })] : [])));
    box.appendChild(el('h3', { text: 'How the value is built' }));
    box.appendChild(el('div', { cls: 'build' }, [line('TVL', usd(r.tvl_usd)), line('Market cap ÷ TVL from the curve at this size', '×' + r.ratio.toFixed(3)), line('Growth tilt (' + pct(r.change_7d) + ', capped)', '×' + r.growth_multiplier.toFixed(3)),
      line('Time-tracked tilt (' + age(r.age_days) + ', capped)', '×' + r.age_multiplier.toFixed(3)), line('Implied value', usd(v.value) + (v.value === r.implied_value_usd ? ' ✓ board.json' : ' ✗ differs'), 'tot')]));
    box.appendChild(el('div', { cls: 'note', text: 'The tilts are judgment. The backtest finds no signal in growth or time tracked, so each is capped near 15%.' }));
    box.appendChild(el('h3', { text: 'Against the traded tokens' }));
    box.appendChild(chart(380, 180, r));
    var near = board.model.points.filter(function (c) { return c.clean; }).sort(function (a, b) { return (a.category === cat ? 0 : 1) - (b.category === cat ? 0 : 1) || Math.abs(Math.log(a.tvl / r.tvl_usd)) - Math.abs(Math.log(b.tvl / r.tvl_usd)); }).slice(0, 4);
    box.appendChild(el('div', { cls: 'build' }, near.map(function (c) { return line(c.name.slice(0, 24) + ' · ' + usd(c.tvl), usd(c.mcap) + ' (×' + c.ratio.toFixed(2) + ')'); })));
    box.appendChild(el('h3', { text: 'Farm at ' + usd(f.capital) + ': ' + r.verdict }));
    box.appendChild(el('div', { cls: 'build' }, [
      line('Reward, low · base · high', usd(f.reward.low) + ' · ' + usd(f.reward.base) + ' · ' + usd(f.reward.high)),
      line('Fees · friction · T-bill carry', usd(f.fees) + ' · ' + usd(f.friction) + ' · ' + usd(f.carry)),
      line('Net, low · base · high', net(f.net.low) + ' · ' + net(f.net.base) + ' · ' + net(f.net.high), 'tot'),
      line('Break-even value · odds the band reaches it', usd(f.be) + ' · ' + pc(f.odds)),
      line('Per $1K · hours · net per hour', usd(f.per1k) + ' · ' + f.hours.toFixed(1) + ' h · ' + net(r.net_per_hour_usd) + '/h')]));
    var ol = el('ol', { cls: 'steps' });
    f.steps.forEach(function (s) { ol.appendChild(el('li', null, [s.text, el('span', { cls: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time })])); });
    box.appendChild(ol);
    box.appendChild(el('div', { cls: 'note', text: 'The snapshot holds no airdrop data. The farmer share and the chance a token launches are assumptions. A plan never promises a token, and the capital stays yours.' }));
  }

  // ---- traded tokens, set aside, method ------------------------------------------------------
  function simple(cols, rows, label) {
    var tr = el('tr'); cols.forEach(function (c) { tr.appendChild(el('th', { scope: 'col', cls: c[1], text: c[0] })); });
    var body = el('tbody'); rows.forEach(function (r) { body.appendChild(el('tr', null, r.map(function (c, i) { return el('td', { cls: cols[i][1], text: c }); }))); });
    return el('div', { cls: 'wrap' }, [el('table', { 'aria-label': label }, [el('thead', null, [tr]), body])]);
  }
  function drawTraded() {
    var m = board.model, rows = m.points.slice().sort(function (a, b) { return b.mcap - a.mcap; });
    main.appendChild(el('div', { cls: 'panel' }, [el('p', { text: 'These ' + rows.length + ' protocols record a token, so the market sets their value and they are never ranked. ' + m.n + ' are clean comparables the curve is fitted on; their miss is blind, from a fit made without them. ' + (rows.length - m.n) + ' are kept apart under the watchlist rule, and their miss shows how far the curve is from a wrapped, staked, bridged or exchange token.' }),
      simple([['Protocol', ''], ['Category', ''], ['TVL', 'num'], ['Market cap', 'num'], ['Mcap ÷ TVL', 'num'], ['Curve says', 'num'], ['Miss', 'num'], ['Use', '']],
        rows.map(function (c) { return [c.name, c.category, usd(c.tvl), usd(c.mcap), c.ratio.toFixed(2), c.pred.toFixed(2), '×' + (c.miss >= 1 ? c.miss : 1 / c.miss).toFixed(1) + (c.miss >= 1 ? ' above' : ' below'), c.clean ? 'fit' : 'kept apart: ' + c.reason]; }), 'Traded tokens')]));
  }
  function drawAside() {
    main.appendChild(el('div', { cls: 'panel' }, [el('p', { text: board.aside.length + ' pre-token protocols are set aside by the watchlist rule: a bridge, a liquid staking or restaking product, an exchange, a wrapped or staked name, or a versioned pool. They are not a launch waiting to happen, so they are not ranked.' }),
      simple([['Protocol', ''], ['Category', ''], ['TVL', 'num'], ['Why set aside', '']], board.aside.map(function (a) { return [a.name, a.category || 'Uncategorised', usd(a.tvl), a.reason]; }), 'Set aside')]));
  }
  function drawMethod() {
    var m = board.model, b = m.backtest, cats = Object.keys(m.catN).sort(function (x, y) { return m.catN[y] - m.catN[x]; }).slice(0, 10);
    function tr(c, h) { return el('tr', null, c.map(function (x, i) { return el(h || 'td', { text: x, cls: i ? 'num' : '' }); })); }
    var X = function (s) { return '×' + s.median.toFixed(2); };
    main.appendChild(el('div', { cls: 'panel' }, [
      el('h2', { text: 'What the number means' }), el('p', { text: 'Implied value answers one question: if this protocol\'s record stayed as it is, what would its token be worth? It does not say whether or when a token is issued.' }),
      el('h2', { text: 'The model' }), el('ol', null, [
        el('li', { text: 'Fit ln(market cap ÷ TVL) on the ' + m.n + ' clean traded tokens: slope ' + m.slope.toFixed(2) + ' on ln(TVL), so a token ten times larger trades at about ' + Math.pow(10, m.slope).toFixed(2) + ' times the ratio, plus a category offset pulled toward zero with weight ' + D.shrinkK + '.' }),
        el('li', { text: 'Price each protocol with no token at TVL × ratio, tilted by growth and time tracked, each capped near 15% because the backtest cannot confirm them. Chain count is not used.' }),
        el('li', { text: 'Band every value with the blind misses of the comparables (P25 to P75: ×' + m.lo.toFixed(2) + ' to ×' + m.hi.toFixed(2) + '). Refit on 200 resamples of the comparables to get each row\'s rank range.' })]),
      el('h2', { text: 'Backtest' }), el('table', { 'aria-label': 'Backtest' }, [el('thead', null, [tr(['Test', 'Median miss', 'Within ×3'], 'th')]), el('tbody', null, [
        tr(['Flat multiple, each token left out', X(b.flat), pc(b.flat.within3)]), tr(['Size curve, each token left out', X(b.size), pc(b.size.within3)]), tr(['Size curve + category (used), each token left out', X(b.full), pc(b.full.within3)]),
        tr(['Time split: newer ' + b.split.n + ' tokens, fit on older', '×' + b.split.miss.toFixed(2), pc(b.split.within3)]), tr(['Time split, flat multiple', '×' + b.split.flat.toFixed(2), '']),
        tr(['Inside the P25–P75 band: blind · newer tokens', pc(m.cover), pc(b.split.cover)])])]),
      el('p', { text: 'The model still misses by about ×3 for a typical token, so read a value as a range. Cleaning the comparables (88 of 119) improved the blind miss from ×3.4 to ×3.3.' }),
      el('h2', { text: 'Farm economics' }), el('p', { text: 'Reward = implied value × farmer share × capital ÷ TVL, at the band\'s low, base and high. Costs: fees on the cheapest chain the protocol records, ' + (D.friction * 100).toFixed(1) + '% friction, and the ' + (D.tbill * 100) + '% a year the capital would earn in T-bills over the hold. Break-even odds: the share of blind misses that keep the net above zero. Tier: robust at 75% or more, farm at 50%, thin at 25%, skip below. Hands-on time: ' + D.hSetup + ' h to set up, ' + D.hWeek + ' h per active week, ' + D.hExit + ' h to exit.' }),
      el('p', { text: 'The farmer share is an assumption, not a figure in the data. Public studies put the median airdrop near 7.5% of supply, with large recent drops from 8.5% to 31%, and many recipients sell on the first day, so the default is 8% of value, valued at the implied price.' }),
      el('h2', { text: 'Category offsets' }), el('table', { 'aria-label': 'Categories' }, [el('thead', null, [tr(['Category', 'Clean tokens', 'Offset'], 'th')]), el('tbody', null, cats.map(function (c) { return tr([c, String(m.catN[c]), '×' + Math.exp(m.off[c]).toFixed(2)]); }))]),
      el('h2', { text: 'Limits' }), el('p', { text: 'The snapshot carries no airdrop flag, points data or token plans, so the board ranks by size and record, not by a promise. Every figure on this page comes from model.js and data.js.' })]));
  }

  function render() {
    var tabs = document.getElementById('tabs'); tabs.textContent = '';
    [['board', 'No token yet (' + board.rows.length + ')'], ['traded', 'Traded tokens (' + board.model.points.length + ')'], ['aside', 'Set aside (' + board.aside.length + ')'], ['method', 'Method and backtest']].forEach(function (t) {
      tabs.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === t[0]), text: t[1], onclick: function () { st.tab = t[0]; render(); } }));
    });
    main.textContent = '';
    if (st.tab === 'board') drawBoard(); else if (st.tab === 'traded') drawTraded(); else if (st.tab === 'aside') drawAside(); else drawMethod();
  }
  (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i < 1) return; var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
    if (k === 'tab' && /^(board|traded|aside|method)$/.test(v)) st.tab = v; else if (k === 'q') st.q = v; else if (k === 'cat') st.cat = v; else if (k === 'chain') st.chain = v;
    else if (k === 'tier') st.tier = v; else if (k === 'min') st.minTvl = Number(v) || 0; else if (k === 'list') st.list = v === '1'; else if (k === 'sel') st.sel = v;
    else if (k === 'capital' && Number(v) >= 50) st.capital = Number(v); else if (k === 'share' && Number(v) > 0) st.share = Number(v) / 100;
  });
  recompute();
  if (st.sel && !byslug[st.sel]) st.sel = null;
  document.getElementById('tag').textContent = 'Snapshot of ' + S.as_of + ' · priced off ' + board.model.n + ' clean traded tokens · implied value is this page\'s claim, never a forecast that a token launches';
  document.getElementById('foot').textContent = 'Source: ' + S.source + '. Watchlist floor ' + usd(S.floor_usd) + ' of TVL; W marks a protocol on it. Capital, farmer share and the T-bill return are assumptions you can change above.';
  verify();
  render();
})();
