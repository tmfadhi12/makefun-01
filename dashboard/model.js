// Radar model, shared by main.ts (writes board.json) and the page (draws it): one function prices every row.
// 1. Fit ln(market cap / TVL) on the clean tokens that already trade: a size curve plus a category offset
//    pulled toward zero (shrink k), because most categories hold few tokens. "Clean" means the watchlist's own rule:
//    not wrapped, staked, bridged, an exchange or a versioned pool. The rest are kept apart and shown with their miss.
// 2. Every comparable is priced by a fit made without it (leave-one-out). Those errors give the band (P25 to P75),
//    the break-even odds, and a bootstrap of the board gives each row a rank range. A time split (fit on the older 70%
//    by listing date, test on the newer 30%) checks the curve on tokens it has not seen.
// 3. Growth and time tracked are small capped tilts, kept as judgment: the backtest cannot confirm them.
// 4. Farm economics: reward = value x farmer share x capital / TVL, minus fees, friction and the T-bill return the capital gives up.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var P = { shrinkK: 8, slopeMin: -0.7, slopeMax: 0, bandLo: 0.25, bandHi: 0.75, growthPerPct: 0.0015, growthLo: 0.925, growthHi: 1.15,
    ageLo: 0.95, ageSpan: 0.15, ageCap: 1460, capital: 500, share: 0.08, tbill: 0.04, friction: 0.004, earlyRows: 160, boots: 200, seed: 20261114,
    highFee: 0.05, hSetup: 0.5, hWeek: 0.25, hExit: 0.25 };
  var NOT = ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/, WRAPPED = /\b(wrapped|staked|staking)\b/i, EXCH = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function quant(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; }
  function ageDays(asOf, d) { if (!d) return null; var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(d + 'T00:00:00Z'); return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY)) : null; }
  function why(p) {
    if (NOT.indexOf(p.category) >= 0) return 'category ' + p.category;
    if (VERSION.test(p.name)) return 'version marker in name';
    if (WRAPPED.test(p.name)) return 'wrapped or staked name';
    return EXCH.test(p.name) ? 'exchange name' : null;
  }
  function isTrading(p) { return p.mcap_usd > 0 && !!p.gecko_id && p.tvl_usd > 0 && p.category !== 'CEX'; }
  function isPre(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
  function canLaunch(p) { return isPre(p) && !why(p); }

  // ---- fit and tests -------------------------------------------------------------------------
  function fitCore(set) {
    var n = set.length, mx = 0, my = 0;
    set.forEach(function (f) { mx += f.x; my += f.y; }); mx /= n; my /= n;
    var cov = 0, v = 0;
    set.forEach(function (f) { cov += (f.x - mx) * (f.y - my); v += (f.x - mx) * (f.x - mx); });
    var slope = clamp(v > 0 ? cov / v : 0, P.slopeMin, P.slopeMax), res = set.map(function (f) { return f.y - slope * (f.x - mx); });
    var base = median(res), g = {}, off = {};
    set.forEach(function (f, i) { (g[f.cat] = g[f.cat] || []).push(res[i]); });
    Object.keys(g).forEach(function (c) { off[c] = (g[c].length / (g[c].length + P.shrinkK)) * (median(g[c]) - base); });
    return { slope: slope, base: base, x0: mx, off: off };
  }
  function predict(m, x, cat) { return m.base + m.slope * (x - m.x0) + (m.off[cat] || 0); }
  function looErrs(set, kind) {
    return set.map(function (f, i) {
      var rest = set.filter(function (_, j) { return j !== i; });
      if (kind === 'flat') return f.y - median(rest.map(function (r) { return r.y; }));
      var m = fitCore(kind === 'size' ? rest.map(function (r) { return { x: r.x, y: r.y, cat: '-' }; }) : rest);
      return f.y - predict(m, f.x, kind === 'size' ? '-' : f.cat);
    });
  }
  function score(e) {
    var a = e.map(Math.abs), n = a.length;
    return { median: Math.exp(median(a)), within3: a.filter(function (x) { return x <= Math.log(3); }).length / n };
  }
  function timeSplit(set) {
    var s = set.filter(function (f) { return f.t; }).sort(function (a, b) { return a.t < b.t ? -1 : 1; }), cut = Math.floor(s.length * 0.7), tr = s.slice(0, cut), te = s.slice(cut);
    var m = fitCore(tr), e = looErrs(tr, 'full'), lo = quant(e, P.bandLo), hi = quant(e, P.bandHi), fm = median(tr.map(function (f) { return f.y; }));
    var err = te.map(function (f) { return f.y - predict(m, f.x, f.cat); });
    return { n: te.length, miss: Math.exp(median(err.map(Math.abs))), flat: Math.exp(median(te.map(function (f) { return Math.abs(f.y - fm); }))),
      within3: err.filter(function (x) { return Math.abs(x) <= Math.log(3); }).length / err.length, cover: err.filter(function (x) { return x >= lo && x <= hi; }).length / err.length };
  }
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null, rrCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function fit(snap) {
    if (cache && cache.get(snap)) return cache.get(snap);
    var mk = function (p) { return { p: p, x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd / p.tvl_usd), cat: p.category || 'Uncategorised', t: p.listed_at }; };
    var all = snap.protocols.filter(isTrading).map(mk), set = all.filter(function (f) { return !why(f.p); });
    var m = fitCore(set), errs = looErrs(set, 'full');
    m.n = set.length; m.errs = errs; m.lo = Math.exp(quant(errs, P.bandLo)); m.hi = Math.exp(quant(errs, P.bandHi)); m.catN = {};
    set.forEach(function (f) { m.catN[f.cat] = (m.catN[f.cat] || 0) + 1; });
    m.cover = errs.filter(function (x) { return x >= Math.log(m.lo) && x <= Math.log(m.hi); }).length / errs.length;
    m.backtest = { flat: score(looErrs(set, 'flat')), size: score(looErrs(set, 'size')), full: score(errs), split: timeSplit(set) };
    var idx = 0;
    m.points = all.map(function (f) {
      var clean = !why(f.p), pr = clean ? Math.exp(f.y - errs[idx++]) : Math.exp(predict(m, f.x, f.cat));
      return { slug: f.p.slug, name: f.p.name, category: f.cat, tvl: f.p.tvl_usd, mcap: f.p.mcap_usd, ratio: Math.exp(f.y), pred: pr, miss: Math.exp(f.y) / pr, clean: clean, reason: why(f.p) };
    });
    m.set = set;
    if (cache) cache.set(snap, m);
    return m;
  }

  // ---- value ---------------------------------------------------------------------------------
  function tilts(p, asOf) {
    var g = clamp(p.change_7d == null ? 0 : p.change_7d, -50, 100), age = ageDays(asOf, p.listed_at);
    return { growth: clamp(1 + P.growthPerPct * g, P.growthLo, P.growthHi), age: age, ageMult: age === null ? 1 : P.ageLo + (P.ageSpan * Math.min(age, P.ageCap)) / P.ageCap };
  }
  function valueOf(m, p, asOf) {
    var cat = p.category || 'Uncategorised', ratio = Math.exp(predict(m, Math.log(p.tvl_usd), cat)), t = tilts(p, asOf);
    var value = Math.max(1, Math.round(p.tvl_usd * ratio * t.growth * t.ageMult)), n = m.catN[cat] || 0, conf = n >= 8 ? 'high' : n >= 3 ? 'medium' : 'low';
    if ((t.age === null || p.change_7d == null) && conf !== 'low') conf = conf === 'high' ? 'medium' : 'low';
    return { value: value, low: Math.max(1, Math.round(value * m.lo)), high: Math.max(1, Math.round(value * m.hi)), ratio: ratio, growth: t.growth, age: t.age, ageMult: t.ageMult, catN: n, confidence: conf };
  }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rankRanges(m, list, asOf) {
    var rand = rng(P.seed), n = list.length, ranks = list.map(function () { return []; }), tl = list.map(function (p) { return tilts(p, asOf); });
    for (var b = 0; b < P.boots; b++) {
      var s = []; for (var i = 0; i < m.set.length; i++) s.push(m.set[Math.floor(rand() * m.set.length)]);
      var mb = fitCore(s), vals = list.map(function (p, j) { return p.tvl_usd * Math.exp(predict(mb, Math.log(p.tvl_usd), p.category || 'Uncategorised')) * tl[j].growth * tl[j].ageMult; });
      var ord = vals.map(function (v, j) { return j; }).sort(function (x, y) { return vals[y] - vals[x] || x - y; });
      ord.forEach(function (j, r) { ranks[j].push(r + 1); });
    }
    return ranks.map(function (r) { return [quant(r, 0.1), quant(r, 0.9)]; });
  }

  // ---- farm economics ------------------------------------------------------------------------
  var CHEAP = ['solana', 'sui', 'aptos', 'ton', 'near', 'sei', 'injective', 'cosmos', 'osmosis', 'hyperliquid l1', 'hyperliquid', 'sonic'];
  var LOW = ['bsc', 'binance', 'polygon', 'arbitrum', 'optimism', 'base', 'linea', 'scroll', 'zksync era', 'blast', 'mantle', 'mode', 'avalanche', 'gnosis', 'fantom', 'berachain', 'unichain', 'ink', 'plasma', 'monad', 'megaeth'];
  function gasPerTx(c) { c = c.toLowerCase(); return c === 'ethereum' ? 8 : CHEAP.indexOf(c) >= 0 ? 0.02 : LOW.indexOf(c) >= 0 ? 0.15 : c === 'tron' ? 1 : c === 'bitcoin' ? 3 : 0.5; }
  function cheapest(ch) { return ch.length ? ch.reduce(function (b, c) { return gasPerTx(c) < gasPerTx(b) ? c : b; }, ch[0]) : 'its main chain'; }
  function kindOf(cat) {
    var c = (cat || '').toLowerCase();
    return /lend|borrow/.test(c) || c === 'cdp' ? 'lending' : /dex|liquidity|amm|launchpad/.test(c) ? 'dex' : /perp|derivative|option/.test(c) ? 'perps' : /yield|curator|allocator|vault|basis|index/.test(c) ? 'vault'
      : /rwa|treasury|credit/.test(c) ? 'rwa' : /stable|algo/.test(c) ? 'stable' : /predict|gambl/.test(c) ? 'prediction' : /stak/.test(c) ? 'staking' : /bridge/.test(c) ? 'bridge' : 'other';
  }
  function money(n) { var a = Math.abs(n); return '$' + (a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 100 ? Math.round(n) : a >= 10 ? n.toFixed(0) : n.toFixed(2)); }
  function signed(n) { return (n < 0 ? '-' : '+') + money(Math.abs(n)); }

  function farm(p, v, m, o) {
    var C = o.capital, sh = o.share, chain = cheapest(p.chains), gas = gasPerTx(chain), tvl = p.tvl_usd;
    var weeks = v.age === null ? 6 : v.age < 180 ? 8 : v.age < 365 ? 6 : 4, costly = gas >= 1, act = costly ? Math.ceil(weeks / 2) : weeks, days = weeks * 7;
    var tx = 3 + act * 2 + 2, fees = tx * gas, fr = C * P.friction, carry = C * P.tbill * days / 365, costs = fees + fr + carry, hours = P.hSetup + act * P.hWeek + P.hExit;
    var rew = {}, net = {};
    ['low', 'base', 'high'].forEach(function (k) { rew[k] = ((k === 'base' ? v.value : v[k]) * sh * C) / tvl; net[k] = rew[k] - costs; });
    var be = (costs * tvl) / (sh * C), need = Math.log(be / v.value), odds = m.errs.filter(function (e) { return e >= need; }).length / m.errs.length;
    var tier = odds >= 0.75 ? 'robust' : odds >= 0.5 ? 'farm' : odds >= 0.25 ? 'thin' : 'skip';
    var name = p.name, cap = money(C), top = money(C * 0.1), kind = kindOf(p.category), often = costly ? 'every second week' : 'each week';
    var core = { lending: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ' as collateral, and keep the loan-to-value under 40% if you borrow.',
      dex: 'Add ' + cap + ' of liquidity to the deepest pool ' + name + ' lists on ' + chain + ', in a wide range so the position stays active.',
      perps: 'Deposit ' + cap + ' of USDC as margin on ' + name + ' on ' + chain + ', and keep every trade under 2x leverage.',
      vault: 'Deposit ' + cap + ' of a stable asset into one ' + name + ' vault on ' + chain + ' that holds no token of its own, and keep the share receipt.',
      rwa: 'Check whether ' + name + ' asks for an identity check on ' + chain + ' before you fund it, then buy ' + cap + ' of its yield asset.',
      stable: 'Mint or buy ' + cap + ' of the stable asset ' + name + ' issues on ' + chain + ', then move it into its savings or pool product.',
      prediction: 'Fund ' + cap + ' on ' + name + ' on ' + chain + ' and spread it over several small markets instead of one large bet.',
      staking: 'Stake ' + cap + ' of the chain\'s native asset through ' + name + ' on ' + chain + ' and keep the receipt token.',
      bridge: 'Bridge ' + cap + ' of USDC to ' + chain + ' through ' + name + ', and use the funds in an app on that chain.',
      other: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ', and use its main feature once with a small part of it.' }[kind];
    var weekly = { lending: 'borrow about ' + money(C * 0.2) + ', hold it a day and repay it, so supply and borrow are both recorded.', dex: 'make two swaps through ' + name + ' and move the range when the price leaves it.',
      perps: 'open and close one small position of about ' + top + ', so the wallet shows trading and not only a deposit.', vault: 'add a top-up of about ' + top + ' and read the reported yield, so the position is not idle.',
      rwa: 'check the redemption window and the yield accrual, and make one small transfer.', stable: 'move a small amount between the stable asset and its savings or pool product.',
      prediction: 'trade two or three markets with small stakes and close one before it settles.', staking: 'check the operator set and move a small amount in or out.',
      bridge: 'send a small amount across the bridge in both directions and keep the hashes.', other: 'use one core feature of ' + name + ' in a small amount.' }[kind];
    var st = [
      { text: 'Open a fresh wallet that holds only the farm funds, keep its seed phrase offline, and connect it to ' + name + ' on ' + chain + ', the cheapest of the ' + p.chains.length + ' chains it records.', cost: 'about ' + money(gas) + ' for the first approval', time: '10 minutes' },
      { text: core, cost: cap + ' of capital you get back, plus about ' + money(gas * 2) + ' in fees', time: '20 minutes' },
      { text: (costly ? 'Every second week ' : 'Each week ') + weekly, cost: 'about ' + money(gas * 2) + ' in fees ' + often, time: '15 minutes ' + (costly ? 'every second week' : 'a week') },
      { text: 'Keep the position open for ' + weeks + ' weeks. ' + (v.age === null ? 'DefiLlama gives no start date, so assume a long window.' : 'DefiLlama has tracked it for ' + v.age + ' days with no token' + (v.age < 180 ? ', so a rewards program, if one comes, may count early users.' : ', so rewards, if any, may weigh how long a wallet stayed.')), cost: 'the ' + cap + ' stays in; it gives up about ' + money(carry) + ' of T-bill return at ' + P.tbill * 100 + '% a year', time: weeks + ' weeks' }];
    if (p.chains.length > 1) st.push({ text: 'Use one small action on a second chain too, since ' + name + ' records TVL on ' + p.chains.length + ' chains, with the same wallet so the activity links.', cost: 'about ' + money(Math.max(gas, gasPerTx(p.chains[1])) * 2) + ' in fees', time: '20 minutes' });
    st.push({ text: 'Net at ' + cap + ' with a farmer share of ' + Math.round(sh * 100) + '%: reward ' + money(rew.base) + ' (band ' + money(rew.low) + ' to ' + money(rew.high) + ') minus ' + money(costs) + ' (fees ' + money(fees) + ', friction ' + money(fr) + ', T-bill carry ' + money(carry) + ') gives ' + signed(net.base) + ' (band ' + signed(net.low) + ' to ' + signed(net.high) + '). Break-even needs a value of ' + money(be) + ', which the band reaches ' + Math.round(odds * 100) + '% of the time. About ' + hours.toFixed(1) + ' hands-on hours. Tier: ' + tier + '.' + (fees / C > P.highFee ? ' Fees alone are ' + Math.round(fees / C * 100) + '% of the position, so skip it unless you hold more.' : ''),
      cost: money(costs) + ' in all', time: 'decide before you deposit' });
    st.push({ text: 'Before you withdraw, open the protocol\'s own rewards page and claim only from the link it publishes. Never sign a message that approves your whole balance. Log the dates and transaction hashes.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' });
    return { chain: chain, days: days, fees: fees, friction: fr, carry: carry, costs: costs, reward: rew, net: net, be: be, odds: odds, tier: tier, hours: hours, per1k: (v.value * sh * 1000) / tvl, capital: C, share: sh, steps: st };
  }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; return t.length > 600 ? t.slice(0, 596) + '...' : t; }

  // ---- board ---------------------------------------------------------------------------------
  function buildBoard(snap, opts) {
    opts = { capital: (opts && opts.capital) || P.capital, share: (opts && opts.share) || P.share };
    var m = fit(snap), onList = {}, chosen = {}, bySlug = {};
    snap.watchlist.forEach(function (s) { onList[s] = 1; });
    snap.protocols.forEach(function (p) { bySlug[p.slug] = p; });
    snap.watchlist.forEach(function (s) { if (bySlug[s]) chosen[s] = bySlug[s]; });
    snap.protocols.filter(function (p) { return !chosen[p.slug] && canLaunch(p); }).map(function (p) { return { p: p, v: valueOf(m, p, snap.as_of) }; })
      .sort(function (a, b) { return b.v.value - a.v.value || (a.p.slug < b.p.slug ? -1 : 1); }).slice(0, P.earlyRows).forEach(function (e) { chosen[e.p.slug] = e.p; });
    var list = Object.keys(chosen).map(function (s) { return chosen[s]; }), vals = list.map(function (p) { return valueOf(m, p, snap.as_of); });
    var rrAll = rrCache && rrCache.get(snap), key = list.length + ':' + P.seed;
    if (!rrAll) { rrAll = {}; if (rrCache) rrCache.set(snap, rrAll); }
    if (!rrAll[key]) rrAll[key] = rankRanges(m, list, snap.as_of);
    var rr = rrAll;
    var rows = list.map(function (p, i) {
      var v = vals[i], f = farm(p, v, m, opts);
      return { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at, age_days: v.age,
        on_watchlist: !!onList[p.slug], implied_value_usd: v.value, value_low_usd: v.low, value_high_usd: v.high, confidence: v.confidence, ratio: r4(v.ratio), growth_multiplier: r4(v.growth), age_multiplier: r4(v.ageMult),
        category_sample: v.catN, verdict: f.tier, net_base_usd: r2(f.net.base), net_low_usd: r2(f.net.low), net_high_usd: r2(f.net.high), break_even_value_usd: Math.round(f.be), break_even_odds: r4(f.odds),
        reward_per_1k_usd: r2(f.per1k), hands_on_hours: r2(f.hours), net_per_hour_usd: r2(f.net.base / f.hours), rank_lo: rr[key][i][0], rank_hi: rr[key][i][1], farm_chain: f.chain, farm_days: f.days, farm: f, farm_steps: f.steps.map(stepText) };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var aside = snap.protocols.filter(function (p) { return isPre(p) && why(p); }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).map(function (p) { return { name: p.name, category: p.category, tvl: p.tvl_usd, reason: why(p) }; });
    var tiers = { robust: 0, farm: 0, thin: 0, skip: 0 };
    rows.forEach(function (r) { tiers[r.verdict]++; });
    return { model: m, rows: rows, opts: opts, aside: aside, tiers: tiers };
  }

  /** Why a board would fail the gate, or null: the scorer's own rows. */
  function boardIssue(rows, snap) {
    if (rows.length < 100 || rows.length > 4000) return 'the board has ' + rows.length + ' rows, the gate takes 100 to 4000';
    var seen = {}, known = {}, i, j;
    snap.protocols.forEach(function (p) { known[p.slug] = 1; });
    for (i = 0; i < rows.length; i++) { if (seen[rows[i].slug]) return 'slug twice: ' + rows[i].slug; seen[rows[i].slug] = 1; if (!known[rows[i].slug]) return 'unknown slug ' + rows[i].slug; }
    if (snap.watchlist.some(function (s) { return !seen[s]; })) return 'the board misses a watchlist slug';
    if (rows.length - snap.watchlist.length < 60) return 'fewer than 60 rows outside the watchlist';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.rank !== i + 1) return 'rank ' + (i + 1) + ' is ' + r.rank;
      if (i && r.implied_value_usd > rows[i - 1].implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i;
      if (!(r.implied_value_usd > 0) || r.implied_value_usd % 1 !== 0) return r.slug + ' has a bad implied value';
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + r.farm_steps.length + ' farm steps';
      for (j = 0; j < r.farm_steps.length; j++) { var n = r.farm_steps[j].trim().length; if (n < 20 || n > 600) return r.slug + ' has a farm step of ' + n + ' characters'; }
    }
    return rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd ? 'every row has the same implied value' : null;
  }

  return { PARAMS: P, fit: fit, valueOf: valueOf, farm: farm, buildBoard: buildBoard, boardIssue: boardIssue, predict: predict, money: money, signed: signed, why: why };
});
