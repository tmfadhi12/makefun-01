// Pre-Token Radar page: re-runs model.js on window.SNAPSHOT, checks every row against window.BOARD (board.json's digest)
// and draws the finding, the planner, the value build, the board and a protocol file. No network.
(function () {
  'use strict';
  var S = window.SNAPSHOT, M = window.RadarModel, FILE = window.BOARD;
  if (!S || !M) return;
  var D = M.PARAMS, main = document.getElementById('main'), board, bySlug;
  var st = {
    tab: 'board', q: '', cat: 'all', chain: 'all', tier: 'all', pays: 0, minTvl: 0, list: false, sort: 'rank', dir: 1,
    sel: null, capital: D.capital, share: D.share, budget: 2000, hours: 8
  };

  function recompute() {
    board = M.buildBoard(S, { capital: st.capital, share: st.share });
    bySlug = {};
    board.rows.forEach(function (r) { bySlug[r.slug] = r; });
  }

  // small helpers
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'cls') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // The HTML parser knows the SVG namespace, so the page never spells an address out.
  var NS = (function () { var d = document.createElement('div'); d.innerHTML = '<svg></svg>'; return d.firstChild.namespaceURI; })();
  function sv(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + (a >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2));
  }
  function net(n) { return n === null || n === undefined ? '–' : (n < 0 ? '-' : '+') + usd(Math.abs(n)); }
  function pct(x) { return x === null || x === undefined || !isFinite(x) ? 'never' : x > 1 ? 'over 100%' : Math.round(x * 100) + '%'; }
  function chg(n) { return n === null || n === undefined ? '–' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? '–' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function tone(n) { return n === null || n === undefined ? 'dash' : n > 0 ? 'up' : n < 0 ? 'down' : ''; }
  function uniq(list) { var s = {}; list.forEach(function (x) { s[x] = 1; }); return Object.keys(s).sort(); }
  function code(t) { return el('code', { text: t }); }
  function field(label, input) { return el('label', null, [label, input]); }
  function pick(label, value, options, fn) {
    var s = el('select', { 'aria-label': label, onchange: function (e) { fn(e.target.value); } });
    options.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (String(o[0]) === String(value)) op.selected = true; s.appendChild(op); });
    return field(label, s);
  }

  // header: the check against board.json, the accounting and the finding
  function header() {
    var base = M.buildBoard(S), ok = 0;
    base.rows.forEach(function (r, i) {
      var f = FILE && FILE[i];
      if (f && f[0] === r.slug && f[1] === r.rank && f[2] === r.implied_value_usd && f[3] === r.verdict && f[4] === r.net_base_usd && f[5] === r.rank_lo && f[6] === r.rank_hi) ok++;
    });
    var good = FILE && ok === base.rows.length, box = document.getElementById('stamps');
    box.textContent = '';
    box.appendChild(el('span', { cls: 'stamp' + (good ? ' ok' : ' bad') }, ['page = board.json: ' + ok + ' of ' + base.rows.length + ' rows match', el('span', { cls: 'long', text: '(rank, value, tier, net, rank range)' })]));
    var total = board.rows.length + board.aside.length + board.withToken;
    box.appendChild(el('span', { cls: 'stamp plain' }, [total + ' of ' + S.protocols.length + ' accounted', el('span', { cls: 'long', text: '· ' + board.rows.length + ' ranked · ' + board.aside.length + ' set aside · ' + board.withToken + ' record a token' })]));
    var top = board.rows.slice(0, 10), never = top.filter(function (r) { return r.min_ticket_usd === null; }).length;
    var best = board.rows.filter(function (r) { return r.verdict === 'robust'; }).sort(function (a, b) { return b.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 3);
    st.find = { never: never, best: best };
    document.getElementById('finding').textContent = 'Snapshot of ' + S.as_of + ' · priced off ' + board.model.n + ' clean traded tokens · implied value is this page\'s claim, never a forecast that a token launches';
  }

  // the curve: traded tokens, the fitted line, the board at its implied value
  function chart(W, H, sel) {
    var m = board.model, L = 48, B = 24, T = 10, R = 10, pts = m.points, rows = board.rows;
    var xs = pts.map(function (p) { return Math.log(p.tvl); }).concat(rows.map(function (r) { return Math.log(r.tvl_usd); }));
    var ys = pts.map(function (p) { return Math.log(p.mcap); }).concat(rows.map(function (r) { return Math.log(r.implied_value_usd); }));
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    function X(v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var g = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap against TVL for traded tokens, the fitted size curve, and the board at its implied value' });
    [1e7, 1e8, 1e9, 1e10].forEach(function (t) {
      var v = Math.log(t);
      if (v > x0 && v < x1) {
        g.appendChild(sv('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: 'var(--rule)' }));
        g.appendChild(sv('text', { x: X(v), y: H - 6, 'text-anchor': 'middle' }, usd(t)));
      }
    });
    [1e6, 1e7, 1e8, 1e9].forEach(function (t) {
      var v = Math.log(t);
      if (v > y0 && v < y1) {
        g.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: 'var(--rule)' }));
        g.appendChild(sv('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, usd(t)));
      }
    });
    pts.forEach(function (p) { g.appendChild(sv('circle', { cx: X(Math.log(p.tvl)), cy: Y(Math.log(p.mcap)), r: 2.4, fill: p.clean ? 'var(--muted)' : 'none', stroke: 'var(--muted)' })); });
    rows.forEach(function (r) { g.appendChild(sv('circle', { cx: X(Math.log(r.tvl_usd)), cy: Y(Math.log(r.implied_value_usd)), r: 2.2, fill: 'var(--data)', opacity: 0.6 })); });
    var line = function (x) { return Y(x + M.curveLog(m, x, '')); };
    g.appendChild(sv('line', { x1: X(x0), y1: line(x0), x2: X(x1), y2: line(x1), stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    if (sel) {
      var cx = X(Math.log(sel.tvl_usd)), cy = Y(Math.log(sel.implied_value_usd));
      g.appendChild(sv('line', { x1: cx, x2: cx, y1: Y(Math.log(sel.value_high_usd)), y2: Y(Math.log(sel.value_low_usd)), stroke: 'var(--data)', 'stroke-width': 3 }));
      g.appendChild(sv('rect', { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, fill: 'var(--ink)', transform: 'rotate(45 ' + cx + ' ' + cy + ')' }));
    }
    return g;
  }

  // first screen
  function planPanel() {
    var p = M.planFarms(board, st.budget, st.hours);
    var form = el('form', { onsubmit: function (e) { e.preventDefault(); } }, [
      pick('Budget', st.budget, [1000, 2000, 5000, 10000].map(function (b) { return [b, usd(b)]; }), function (v) { st.budget = Number(v); render(); }),
      pick('Hours a week', st.hours, [4, 8, 12, 20].map(function (h) { return [h, h + ' h']; }), function (v) { st.hours = Number(v); render(); }),
      pick('Farmer share', st.share, [[0.05, '5%'], [0.08, '8%'], [0.1, '10%'], [0.15, '15%']], function (v) { st.share = Number(v); recompute(); render(); })]);
    var body = el('tbody');
    p.picks.forEach(function (c) {
      body.appendChild(el('tr', { onclick: function () { st.sel = c.row.slug; render(); } }, [
        el('td', { cls: 'nm' }, [c.row.name, el('small', { text: c.chain + ' · ' + c.row.category })]),
        el('td', { cls: 'num', text: usd(c.ticket) }), el('td', { cls: 'num ' + tone(c.e.net.base), text: net(c.e.net.base) })]));
    });
    var list = p.picks.length ? el('table', { 'aria-label': 'Farms the planner picked' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Farm' }), el('th', { cls: 'num', text: 'Ticket' }), el('th', { cls: 'num', text: 'Net if launch' })])]), body])
      : el('p', { cls: 'empty', text: 'No farm pays at the low end of its band at this share. Try a higher farmer share.' });
    return el('section', { cls: 'panel plan', 'aria-label': 'Farm planner' }, [
      el('h2', { text: 'Plan a farm basket' }),
      el('p', { cls: 'sub' }, [code('planFarms()'), ': best low-band net per hands-on hour']),
      form, list,
      el('div', { cls: 'tot' }, [
        el('div', null, [el('b', { text: net(p.net.low) + ' · ' + net(p.net.base) }), 'net if every launch happens, low · base']),
        el('div', null, [el('b', { text: usd(p.spent) + ' · ' + p.hours.toFixed(1) + ' h' }), p.picks.length + ' farms on ' + p.chains + ' chains of ' + p.candidates + ' that pay']),
        el('div', null, [el('b', { text: pct(p.oddsNeeded) }), 'launch chance the basket needs']),
        el('div', null, [el('b', { text: Math.round(p.atLeastOne * 100) + '%' }), 'chance one or more launch, if each has ' + D.basketOdds * 100 + '%'])]),
      el('div', { cls: 'acts' }, [
        el('button', { type: 'button', cls: 'btn primary', text: 'Copy plan', onclick: function (e) { copyPlan(p, e.target); } }),
        el('button', { type: 'button', cls: 'btn', text: 'Download board CSV', onclick: downloadCsv })])]);
  }

  function hero() {
    var f = st.find, names = f.best.map(function (r) { return r.name; }).join(', ');
    return el('section', { cls: 'hero' }, [
      el('h2', { text: board.rows.length + ' protocols record no token. Here is what each launch would be worth, and what farming it nets.' }),
      el('p', { text: 'Each value is read off a curve fitted to the ' + board.model.n + ' clean tokens that already trade, then tilted by 7-day TVL growth and time tracked. No name is hand-picked: one function in model.js prices every row, here and in board.json. Every plan is netted against fees, friction and the T-bill return the capital gives up, with the smallest ticket that pays: ' + f.never + ' of the 10 largest pay at no ticket size, while ' + (names || 'none') + ' pay best per hands-on hour.' })]);
  }

  function buildPanel() {
    var m = board.model, b = m.backtest, t = board.tiers, inList = board.rows.filter(function (r) { return r.on_watchlist; }).length;
    function fig(big, label) { return el('div', null, [el('b', { text: big }), el('span', { text: label })]); }
    return el('section', { cls: 'panel', 'aria-label': 'How a value is built' }, [
      el('h2', { text: 'How a value is built, and how it tested' }),
      el('div', { cls: 'figs' }, [
        fig(String(board.rows.length), 'ranked, no token'), fig(inList + ' / ' + S.watchlist.length, 'watchlist covered'), fig(String(m.n), 'clean traded tokens'),
        fig('×' + b.full.median.toFixed(1), 'blind miss (×' + b.flat.median.toFixed(1) + ' flat)'), fig('×' + b.split.miss.toFixed(1), 'on newer tokens (×' + b.split.flat.toFixed(1) + ' flat)'),
        fig(t.robust + ' · ' + t.farm + ' · ' + t.thin + ' · ' + t.skip, 'robust · farm · thin · skip at ' + usd(st.capital))]),
      el('ol', { cls: 'steps4' }, [
        el('li', null, [code('fitCompsCurve()'), ' fits ln(market cap ÷ TVL) on ln(TVL), slope ' + m.slope.toFixed(2) + '. ', el('small', { text: 'Blind miss ×' + b.size.median.toFixed(2) + ' against ×' + b.flat.median.toFixed(2) + ' flat.' })]),
        el('li', null, ['Category offsets, pulled toward zero with weight ' + D.shrinkK + '. ', el('small', { text: 'Blind miss ×' + b.full.median.toFixed(2) + ', ' + Math.round(b.full.within3 * 100) + '% within ×3.' })]),
        el('li', null, [code('growthTilt()'), ' and ', code('timeTilt()'), ', capped near 15%. ', el('small', { text: 'The backtest finds no signal, so they stay small.' })]),
        el('li', null, [code('impliedValue()'), ' carries a band from the blind misses, ×' + m.lo.toFixed(2) + ' to ×' + m.hi.toFixed(2) + '. ', el('small', { text: Math.round(m.cover * 100) + '% of tokens fall inside it, ' + Math.round(b.split.cover * 100) + '% of the newer ones.' })])])]);
  }

  function curvePanel() {
    var m = board.model;
    return el('section', { cls: 'panel fig', 'aria-label': 'The size curve' }, [
      el('h2', { text: 'Traded tokens set the curve' }),
      chart(520, 250, null),
      el('div', { cls: 'formula' }, [code('value = TVL × ' + Math.exp(m.base).toFixed(3) + ' × (TVL ÷ ' + usd(Math.exp(m.x0)) + ')^' + m.slope.toFixed(2) + ' × category × growth × time'),
        el('div', { text: 'Grey: traded tokens (hollow: kept apart by the rule). Orange: the board at its implied value. Line: the size curve.' })])]);
  }

  // board
  function filtered() {
    var q = st.q.trim().toLowerCase();
    var rows = board.rows.filter(function (r) {
      if (q && (r.name + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (st.cat !== 'all' && (r.category || 'Uncategorised') !== st.cat) return false;
      if (st.chain !== 'all' && r.chains.indexOf(st.chain) < 0) return false;
      if (st.tier !== 'all' && r.verdict !== st.tier) return false;
      if (st.pays && !(r.pays_from_share <= st.pays)) return false;
      return r.tvl_usd >= st.minTvl && !(st.list && !r.on_watchlist);
    });
    return rows.sort(function (a, b) {
      var x = a[st.sort], y = b[st.sort];
      if (x === null || x === undefined) x = st.dir > 0 ? Infinity : -Infinity;
      if (y === null || y === undefined) y = st.dir > 0 ? Infinity : -Infinity;
      return typeof x === 'string' ? st.dir * x.localeCompare(y) : st.dir * (x - y) || a.rank - b.rank;
    });
  }
  var COLS = [['rank', '#', ''], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d TVL', 'num'], ['age_days', 'No token for', 'num'],
    ['band', 'Band, P25 to P75', ''], ['implied_value_usd', 'Implied value', 'num'], ['min_ticket_usd', 'Smallest ticket that pays', 'num'],
    ['net_base_usd', 'Net if launch', 'num'], ['net_per_hour_usd', 'Per hour', 'num'], ['launch_odds_needed', 'Launch chance needed', 'num'], ['verdict', 'Tier', '']];

  function controls() {
    var cats = uniq(board.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = uniq([].concat.apply([], board.rows.map(function (r) { return r.chains; })));
    var box = el('input', { type: 'checkbox', onchange: function (e) { st.list = e.target.checked; render(); } });
    box.checked = st.list;
    var all = [['all', 'All']];
    return el('div', { cls: 'controls' }, [
      field('Search', el('input', { type: 'search', value: st.q, placeholder: 'Name or category', oninput: function (e) { st.q = e.target.value; fill(); } })),
      pick('Category', st.cat, all.concat(cats.map(function (c) { return [c, c]; })), function (v) { st.cat = v; render(); }),
      pick('Chain', st.chain, all.concat(chains.map(function (c) { return [c, c]; })), function (v) { st.chain = v; render(); }),
      pick('Tier', st.tier, [['all', 'Any'], ['robust', 'Robust'], ['farm', 'Farm'], ['thin', 'Thin'], ['skip', 'Skip']], function (v) { st.tier = v; render(); }),
      pick('Pays at a share of', st.pays, [[0, 'Any'], [0.08, '8% or less'], [0.15, '15% or less'], [0.31, '31% or less']], function (v) { st.pays = Number(v); render(); }),
      pick('Min TVL', st.minTvl, [[0, 'Any'], [1e7, '$10M'], [5e7, '$50M'], [1e8, '$100M'], [5e8, '$500M']], function (v) { st.minTvl = Number(v); render(); }),
      pick('Ticket', st.capital, [250, 500, 1000, 5000].map(function (c) { return [c, usd(c)]; }), function (v) { st.capital = Number(v); recompute(); render(); }),
      el('label', { cls: 'check' }, [box, 'Watchlist only']),
      el('button', { type: 'button', cls: 'btn', text: 'Reset', onclick: function () { st.q = ''; st.cat = st.chain = st.tier = 'all'; st.pays = st.minTvl = 0; st.list = false; st.capital = D.capital; st.share = D.share; st.sel = null; recompute(); render(); } }),
      el('span', { cls: 'count', id: 'count' })]);
  }

  function table() {
    var tr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', cls: c[2] });
      if (st.sort === c[0]) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      th.appendChild(c[0] === 'band' ? document.createTextNode(c[1]) : el('button', { type: 'button', text: c[1] + (st.sort === c[0] ? (st.dir > 0 ? ' ↑' : ' ↓') : ''), onclick: function () {
        if (st.sort === c[0]) st.dir = -st.dir; else { st.sort = c[0]; st.dir = /^(rank|name|verdict|min_ticket_usd|launch_odds_needed)$/.test(c[0]) ? 1 : -1; }
        render();
      } }));
      tr.appendChild(th);
    });
    return el('div', { cls: 'wrap' }, [el('table', { 'aria-label': 'Protocols with no token, ranked by implied value' }, [el('thead', null, [tr]), el('tbody', { id: 'rows' })])]);
  }

  function fill() {
    var rows = filtered(), body = document.getElementById('rows'), lo = Infinity, hi = -Infinity;
    board.rows.forEach(function (r) { lo = Math.min(lo, Math.log(r.value_low_usd)); hi = Math.max(hi, Math.log(r.value_high_usd)); });
    function at(v) { return ((Math.log(v) - lo) / (hi - lo)) * 100; }
    body.textContent = '';
    document.getElementById('count').textContent = rows.length + ' of ' + board.rows.length + ' shown';
    if (!rows.length) { body.appendChild(el('tr', null, [el('td', { colspan: COLS.length, cls: 'empty', text: 'No protocol matches these filters.' })])); return; }
    rows.forEach(function (r) {
      var name = el('td', { cls: 'nm', title: r.name }, [r.name, r.on_watchlist ? el('span', { cls: 'pill', text: 'watchlist' }) : null,
        el('small', { text: (r.category || 'Uncategorised') + ' · ' + r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') })]);
      var row = el('tr', { tabindex: 0, 'aria-selected': String(st.sel === r.slug) }, [
        el('td', { cls: 'rk' }, [el('b', { text: String(r.rank) }), r.rank_lo + '–' + r.rank_hi]), name,
        el('td', { cls: 'num', text: usd(r.tvl_usd) }), el('td', { cls: 'num ' + tone(r.change_7d), text: chg(r.change_7d) }), el('td', { cls: 'num', text: age(r.age_days) }),
        el('td', null, [el('span', { cls: 'band', title: usd(r.value_low_usd) + ' to ' + usd(r.value_high_usd) }, [
          el('i', { style: 'left:' + at(r.value_low_usd) + '%;width:' + Math.max(1, at(r.value_high_usd) - at(r.value_low_usd)) + '%' }), el('b', { style: 'left:' + at(r.implied_value_usd) + '%' })])]),
        el('td', { cls: 'num', text: usd(r.implied_value_usd) }),
        el('td', { cls: 'num' + (r.min_ticket_usd === null ? ' dash' : ''), text: r.min_ticket_usd === null ? 'none pays' : usd(r.min_ticket_usd) }),
        el('td', { cls: 'num ' + tone(r.net_base_usd), text: net(r.net_base_usd) }), el('td', { cls: 'num ' + tone(r.net_per_hour_usd), text: net(r.net_per_hour_usd) + '/h' }),
        el('td', { cls: 'num', text: pct(r.launch_odds_needed) }), el('td', null, [el('span', { cls: 'pill t-' + r.verdict, text: r.verdict })])]);
      function open() { st.sel = r.slug; render(); window.scrollTo(0, 0); }
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      body.appendChild(row);
    });
  }

  // protocol file
  // A costed farm timeline: what has been spent by each week, against what a launch would pay at the end.
  function timeline(f) {
    var W = 560, H = 150, L = 48, R = 12, T = 12, B = 26, weeks = f.weeks, spent = [], total = 0;
    for (var w = 0; w <= weeks; w++) {
      var tx = w === 0 ? 3 : 0;
      if (w > 0 && (!f.costly || w % 2 === 1)) tx += 2;
      if (w === weeks) tx += 2;
      total += tx * f.fee + (w === 0 ? f.friction / 2 : 0) + (w > 0 ? f.carry / weeks : 0) + (w === weeks ? f.friction / 2 : 0);
      spent.push({ w: w, tx: tx, total: total });
    }
    var step = Math.pow(10, Math.floor(Math.log(Math.max(total, f.reward.base)) / Math.LN10)), top = Math.ceil((Math.max(total, f.reward.base) * 1.15) / step) * step;
    function X(v) { return L + (v / weeks) * (W - L - R); }
    function Y(v) { return T + (1 - v / top) * (H - T - B); }
    var g = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Costs spent by week against the reward if a launch happens' });
    [0, top / 2].forEach(function (v) { g.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: 'var(--rule)' })); g.appendChild(sv('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, usd(v))); });
    spent.forEach(function (s) {
      if (s.tx) g.appendChild(sv('rect', { x: X(s.w) - 3, y: Y(s.tx * f.fee), width: 6, height: Math.max(1, Y(0) - Y(s.tx * f.fee)), fill: 'var(--muted)' }));
      g.appendChild(sv('text', { x: X(s.w), y: H - 8, 'text-anchor': 'middle' }, s.w === 0 ? 'start' : 'wk ' + s.w));
    });
    g.appendChild(sv('polyline', { points: spent.map(function (s) { return X(s.w) + ',' + Y(s.total); }).join(' '), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6 }));
    g.appendChild(sv('text', { x: W - R, y: Y(total) - 5, 'text-anchor': 'end' }, 'spent by exit ' + usd(total)));
    [['low', f.reward.low, 'var(--muted)'], ['base', f.reward.base, 'var(--data)']].forEach(function (x) {
      g.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(x[1]), y2: Y(x[1]), stroke: x[2], 'stroke-dasharray': '4 3' }));
      g.appendChild(sv('text', { x: W - R, y: Y(x[1]) - 4, 'text-anchor': 'end' }, 'reward if launch, ' + x[0] + ' ' + usd(x[1])));
    });
    return g;
  }

  function protocolFile(r) {
    var f = r.farm, cat = r.category || 'Uncategorised';
    var p = S.protocols.filter(function (x) { return x.slug === r.slug; })[0], v = M.impliedValue(board.model, p, S.as_of);
    function kv(a, b, cls) { return el('div', { cls: cls || '' }, [el('span', { text: a }), el('span', { text: b })]); }
    var near = board.model.points.filter(function (c) { return c.clean; }).sort(function (a, b) {
      return (a.category === cat ? 0 : 1) - (b.category === cat ? 0 : 1) || Math.abs(Math.log(a.tvl / r.tvl_usd)) - Math.abs(Math.log(b.tvl / r.tvl_usd));
    }).slice(0, 4);
    var steps = el('ol', { cls: 'plan-steps' });
    f.steps.forEach(function (s) { steps.appendChild(el('li', null, [s.text, el('small', { text: 'Cost: ' + s.cost + ' · Time: ' + s.time })])); });
    return el('section', { cls: 'file', 'aria-label': 'Protocol file' }, [
      el('header', null, [
        el('div', null, [el('button', { type: 'button', cls: 'btn', text: 'Back to the board', onclick: function () { st.sel = null; render(); } }),
          el('h2', { cls: 'name', text: r.name }),
          el('div', { cls: 'meta', text: '#' + r.rank + ' (rank range ' + r.rank_lo + '–' + r.rank_hi + ' over 200 refits) · ' + cat + ' · ' + r.chains.join(', ') + ' · ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist') })]),
        el('div', null, [el('div', { cls: 'big', text: usd(r.implied_value_usd) }),
          el('div', { cls: 'meta', text: 'band ' + usd(r.value_low_usd) + ' to ' + usd(r.value_high_usd) + ' · confidence ' + r.confidence + ', ' + r.category_sample + ' clean traded tokens in ' + cat })])]),
      el('div', { cls: 'cols' }, [
        el('div', { cls: 'stack' }, [
          el('div', { cls: 'panel' }, [el('h2', { text: 'How the value is built' }), el('div', { cls: 'kv' }, [
            kv('TVL', usd(r.tvl_usd)), kv('fitCompsCurve(): market cap ÷ TVL at this size and category', '×' + r.ratio.toFixed(3)),
            kv('growthTilt(): 7-day TVL ' + chg(r.change_7d) + ', capped', '×' + r.growth_multiplier.toFixed(3)),
            kv('timeTilt(): ' + age(r.age_days) + ' with no token, capped', '×' + r.age_multiplier.toFixed(3)),
            kv('impliedValue()', usd(v.value) + (v.value === r.implied_value_usd ? ', same as board.json' : ', differs from board.json'), 'tot')])]),
          el('div', { cls: 'panel fig' }, [el('h2', { text: 'Against the traded tokens' }), chart(520, 220, r),
            el('div', { cls: 'kv' }, near.map(function (c) { return kv(c.name + ' · TVL ' + usd(c.tvl), usd(c.mcap) + ' market cap, ×' + c.ratio.toFixed(2)); }))])]),
        el('div', { cls: 'panel' }, [
          el('h2', { text: 'Farm at ' + usd(f.capital) + ' with a ' + Math.round(f.share * 100) + '% farmer share: ' + r.verdict }),
          el('div', { cls: 'kv' }, [
            kv('Reward if launch, low · base · high', usd(f.reward.low) + ' · ' + usd(f.reward.base) + ' · ' + usd(f.reward.high)),
            kv('Fees · friction · T-bill return given up', usd(f.fees) + ' · ' + usd(f.friction) + ' · ' + usd(f.carry)),
            kv('Net if launch, low · base · high', net(f.net.low) + ' · ' + net(f.net.base) + ' · ' + net(f.net.high), 'tot'),
            kv('Break-even value · odds the band reaches it', usd(f.be) + ' · ' + pct(f.odds)),
            kv('Launch chance needed to break even', pct(f.needBase) + ' at the base value, ' + pct(f.needLow) + ' at the low end'),
            kv('minTicket(): smallest ticket that pays', isFinite(f.minBase) ? usd(f.minBase) + ' at the base value, ' + (isFinite(f.minLow) ? usd(f.minLow) : 'none') + ' at the low end' : 'none: each dollar\'s slice is below the T-bill return'),
            kv('Pays at the low end from a farmer share of', pct(f.paysFrom)),
            kv('Hands-on time · net per hour', f.hours.toFixed(1) + ' h · ' + net(r.net_per_hour_usd) + '/h')]),
          el('h2', { cls: 'gap', text: 'Costed timeline: spent by week against the reward if a launch happens' }), timeline(f), steps,
          el('p', { cls: 'note', text: 'The farmer share and the launch chance are assumptions (' + Math.round(D.tokenRate * 100) + '% of dated protocols record a token). A plan never promises a token.' })])])]);
  }

  // export
  function copyPlan(p, button) {
    var lines = ['Pre-Token Radar plan, snapshot ' + S.as_of + ', budget ' + usd(st.budget) + ', ' + st.hours + ' h a week, farmer share ' + Math.round(st.share * 100) + '%'];
    p.picks.forEach(function (c, i) { lines.push((i + 1) + '. ' + c.row.name + ' on ' + c.chain + ': ticket ' + usd(c.ticket) + ', net if launch ' + net(c.e.net.base) + ' (low ' + net(c.e.net.low) + '), ' + c.hoursUsed.toFixed(1) + ' h'); });
    lines.push('Total: ' + usd(p.spent) + ', ' + p.hours.toFixed(1) + ' h, net if every launch happens ' + net(p.net.base) + '; needs a launch chance of ' + pct(p.oddsNeeded) + '.');
    var text = lines.join('\n');
    if (!navigator.clipboard) return window.prompt('Copy the plan', text);
    navigator.clipboard.writeText(text).then(function () { button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy plan'; }, 1500); }, function () { window.prompt('Copy the plan', text); });
  }
  function downloadCsv() {
    var cols = ['rank', 'slug', 'name', 'category', 'tvl_usd', 'implied_value_usd', 'value_low_usd', 'value_high_usd', 'verdict', 'min_ticket_usd', 'net_base_usd', 'launch_odds_needed', 'pays_from_share', 'farm_chain'];
    var esc = function (x) { x = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var csv = [cols.join(',')].concat(filtered().map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(','); })).join('\n');
    var a = el('a', { download: 'pre-token-radar-' + S.as_of + '.csv' });
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // traded tokens, set aside, method
  function simpleTable(cols, rows, label) {
    var tr = el('tr');
    cols.forEach(function (c) { tr.appendChild(el('th', { scope: 'col', cls: c[1], text: c[0] })); });
    var body = el('tbody');
    rows.forEach(function (r) { body.appendChild(el('tr', null, r.map(function (c, i) { return el('td', { cls: cols[i][1], text: c }); }))); });
    return el('div', { cls: 'wrap' }, [el('table', { 'aria-label': label }, [el('thead', null, [tr]), body])]);
  }
  function drawTraded() {
    var m = board.model, rows = m.points.slice().sort(function (a, b) { return b.mcap - a.mcap; });
    main.appendChild(el('div', { cls: 'page' }, [
      el('p', { text: rows.length + ' protocols record a token with a market cap, so the market prices them and they are never ranked. The curve is fitted on the ' + m.n + ' clean ones; each miss is blind. ' + (rows.length - m.n) + ' are kept apart by the watchlist rule.' }),
      simpleTable([['Protocol', ''], ['Category', ''], ['TVL', 'num'], ['Market cap', 'num'], ['Market cap ÷ TVL', 'num'], ['Miss against the curve', 'num'], ['Use', '']],
        rows.map(function (c) { return [c.name, c.category, usd(c.tvl), usd(c.mcap), c.ratio.toFixed(2), '×' + (c.miss >= 1 ? c.miss : 1 / c.miss).toFixed(1) + (c.miss >= 1 ? ' above' : ' below'), c.clean ? 'fit' : 'kept apart: ' + c.reason]; }), 'Traded tokens')]));
  }
  function drawAside() {
    main.appendChild(el('div', { cls: 'page' }, [
      el('p', { text: board.aside.length + ' protocols with no token are set aside by the watchlist rule: none is a launch of its own.' }),
      simpleTable([['Protocol', ''], ['Category', ''], ['TVL', 'num'], ['Why set aside', '']], board.aside.map(function (a) { return [a.name, a.category || 'Uncategorised', usd(a.tvl), a.reason]; }), 'Set aside')]));
  }
  function drawMethod() {
    main.appendChild(el('div', { cls: 'page' }, [
      el('p', { text: 'Implied value: what the token would be worth if the record stayed as it is, never whether one is issued. A fitted launch clock lost to a constant on newer protocols, so the page shows the launch chance a plan needs instead.' }),
      el('h2', { text: 'Farm economics' }),
      el('p', null, [code('farmPlan()'), ': reward = value × farmer share × ticket ÷ TVL. Costs: fees on the cheapest chain, ' + (D.friction * 100).toFixed(1) + '% friction and the ' + D.tbill * 100 + '% a year T-bill return over the hold. ', code('minTicket()'), ': fees are fixed, so a row pays from one ticket size, or never. ',
        code('planFarms()'), ': best low-band net per hands-on hour, at least $' + D.minPlanTicket + ' a farm, money left to the best return per dollar, up to $' + D.maxPlanTicket.toLocaleString('en-US') + '.']),
      el('p', { text: 'Tier: the share of blind misses that keep the net above zero if a launch happens. Robust 75%+, farm 50%+, thin 25%+. The farmer share is an assumption: public studies put the median airdrop near 7.5% of supply and recent large ones at 8.5% to 31%, so the default is 8%. The snapshot has no airdrop, points or token-plan data.' })]));
  }

  // render
  function render() {
    header();
    var tabs = document.getElementById('tabs');
    tabs.textContent = '';
    [['board', 'No token yet (' + board.rows.length + ')'], ['traded', 'Traded tokens (' + board.model.points.length + ')'], ['aside', 'Set aside (' + board.aside.length + ')'], ['method', 'Method and backtest']].forEach(function (t) {
      tabs.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === t[0]), text: t[1], onclick: function () { st.tab = t[0]; render(); } }));
    });
    main.textContent = '';
    if (st.tab === 'traded') return drawTraded();
    if (st.tab === 'aside') return drawAside();
    if (st.tab === 'method') return drawMethod();
    var filtering = st.q || st.cat !== 'all' || st.chain !== 'all' || st.tier !== 'all' || st.pays || st.minTvl || st.list;
    var first = st.sel && bySlug[st.sel] ? protocolFile(bySlug[st.sel]) : el('div', { cls: 'first' }, [planPanel(), buildPanel(), curvePanel()]);
    if (!filtering && !st.sel) main.appendChild(hero());
    if (!filtering || st.sel) main.appendChild(first);
    main.appendChild(controls());
    main.appendChild(table());
    if (filtering && !st.sel) { first.style.marginTop = '16px'; main.appendChild(first); }
    fill();
  }

  (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i < 1) return;
    // A link opens a view: #sel=<slug>, #tab=method, #tier=farm, #pays=15, #min=10000000, #ticket=1000, #share=10, #budget=5000, #hours=12
    var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)), n = Number(v);
    if (k === 'tab' && /^(board|traded|aside|method)$/.test(v)) st.tab = v;
    else if (k === 'sel' || k === 'tier') st[k] = v;
    else if (k === 'min') st.minTvl = n || 0; else if (k === 'pays' && n > 0) st.pays = n / 100;
    else if (k === 'ticket' && n >= 50) st.capital = n; else if (k === 'share' && n > 0) st.share = n / 100;
    else if ((k === 'budget' || k === 'hours') && n > 0) st[k] = n;
  });
  recompute();
  document.getElementById('foot').textContent = 'Source: ' + S.source + '. Snapshot of ' + S.as_of + '. Implied value is this page\'s claim, never a forecast that a token launches. Ticket, farmer share, budget and hours are assumptions you can change.';
  render();
})();
