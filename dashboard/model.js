// Radar model, shared by main.ts (writes board.json) and the page (draws it). One function prices every row:
// fitCompsCurve() on the clean traded tokens, blindTest() and timeSplitTest() for its error, impliedValue() with
// capped growthTilt() and timeTilt(), rankRanges() by resampling, farmPlan() and minTicket() for the money,
// planFarms() for a basket under a budget and hours a week.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var P = {
    shrinkK: 8, slopeMin: -0.7, slopeMax: 0, bandLo: 0.25, bandHi: 0.75,
    growthPerPct: 0.0015, growthLo: 0.925, growthHi: 1.15, ageLo: 0.95, ageSpan: 0.15, ageCap: 1460,
    capital: 500, share: 0.08, tbill: 0.04, friction: 0.004, earlyRows: 160, boots: 200, seed: 20261114,
    highFee: 0.05, hSetup: 0.5, hWeek: 0.25, hExit: 0.25, hShared: 0.25,
    oddsBar: 0.25, minPlanTicket: 250, maxPlanTicket: 2000, basketOdds: 0.2, tokenRate: 0.51
  };
  var NOT = ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, q) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
  }
  function ageDays(asOf, d) {
    if (!d) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(d + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY)) : null;
  }

  // The watchlist's rule, without its TVL floor: why a protocol is set aside, or null.
  function setAsideReason(p) {
    if (NOT.indexOf(p.category) >= 0) return 'category ' + p.category;
    if (VERSION.test(p.name)) return 'version marker in name';
    if (WRAPPED.test(p.name)) return 'wrapped or staked name';
    return EXCHANGE.test(p.name) ? 'exchange name' : null;
  }
  function isTraded(p) { return p.mcap_usd > 0 && !!p.gecko_id && p.tvl_usd > 0 && p.category !== 'CEX'; }
  function recordsToken(p) { return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null; }
  function canLaunch(p) { return !recordsToken(p) && !setAsideReason(p); }

  // ---- the curve and its tests ----------------------------------------------------------------
  function fitCompsCurve(set) {
    var n = set.length, mx = 0, my = 0;
    set.forEach(function (f) { mx += f.x; my += f.y; });
    mx /= n; my /= n;
    var cov = 0, v = 0;
    set.forEach(function (f) { cov += (f.x - mx) * (f.y - my); v += (f.x - mx) * (f.x - mx); });
    var slope = clamp(v > 0 ? cov / v : 0, P.slopeMin, P.slopeMax);
    var res = set.map(function (f) { return f.y - slope * (f.x - mx); });
    var base = median(res), groups = {}, off = {};
    set.forEach(function (f, i) { (groups[f.cat] = groups[f.cat] || []).push(res[i]); });
    Object.keys(groups).forEach(function (c) {
      off[c] = (groups[c].length / (groups[c].length + P.shrinkK)) * (median(groups[c]) - base);
    });
    return { slope: slope, base: base, x0: mx, off: off };
  }
  function curveLog(m, x, cat) { return m.base + m.slope * (x - m.x0) + (m.off[cat] || 0); }

  // Misses of a fit made without each comparable: 'flat' (one multiple), 'size' (no categories) or 'full'.
  function blindTest(set, kind) {
    return set.map(function (f, i) {
      var rest = set.filter(function (_, j) { return j !== i; });
      if (kind === 'flat') return f.y - median(rest.map(function (r) { return r.y; }));
      if (kind === 'size') rest = rest.map(function (r) { return { x: r.x, y: r.y, cat: '-' }; });
      return f.y - curveLog(fitCompsCurve(rest), f.x, kind === 'size' ? '-' : f.cat);
    });
  }
  function score(errs) {
    var a = errs.map(Math.abs);
    return { median: Math.exp(median(a)), within3: a.filter(function (x) { return x <= Math.log(3); }).length / a.length };
  }
  function timeSplitTest(set) {
    var s = set.filter(function (f) { return f.t; }).sort(function (a, b) { return a.t < b.t ? -1 : 1; });
    var cut = Math.floor(s.length * 0.7), train = s.slice(0, cut), test = s.slice(cut);
    var m = fitCompsCurve(train), e = blindTest(train, 'full'), lo = quantile(e, P.bandLo), hi = quantile(e, P.bandHi);
    var flat = median(train.map(function (f) { return f.y; }));
    var err = test.map(function (f) { return f.y - curveLog(m, f.x, f.cat); });
    return {
      n: test.length, miss: Math.exp(median(err.map(Math.abs))),
      flat: Math.exp(median(test.map(function (f) { return Math.abs(f.y - flat); }))),
      within3: err.filter(function (x) { return Math.abs(x) <= Math.log(3); }).length / err.length,
      cover: err.filter(function (x) { return x >= lo && x <= hi; }).length / err.length
    };
  }

  var fitCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var rankCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function fit(snap) {
    if (fitCache && fitCache.get(snap)) return fitCache.get(snap);
    var toPoint = function (p) { return { p: p, x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd / p.tvl_usd), cat: p.category || 'Uncategorised', t: p.listed_at }; };
    var all = snap.protocols.filter(isTraded).map(toPoint);
    var set = all.filter(function (f) { return !setAsideReason(f.p); });
    var m = fitCompsCurve(set), errs = blindTest(set, 'full');
    m.n = set.length; m.set = set; m.errs = errs;
    m.lo = Math.exp(quantile(errs, P.bandLo)); m.hi = Math.exp(quantile(errs, P.bandHi));
    m.cover = errs.filter(function (x) { return x >= Math.log(m.lo) && x <= Math.log(m.hi); }).length / errs.length;
    m.catN = {};
    set.forEach(function (f) { m.catN[f.cat] = (m.catN[f.cat] || 0) + 1; });
    m.backtest = { flat: score(blindTest(set, 'flat')), size: score(blindTest(set, 'size')), full: score(errs), split: timeSplitTest(set) };
    var k = 0;
    m.points = all.map(function (f) {
      var clean = !setAsideReason(f.p), pred = clean ? Math.exp(f.y - errs[k++]) : Math.exp(curveLog(m, f.x, f.cat));
      return { slug: f.p.slug, name: f.p.name, category: f.cat, tvl: f.p.tvl_usd, mcap: f.p.mcap_usd, ratio: Math.exp(f.y), pred: pred, miss: Math.exp(f.y) / pred, clean: clean, reason: setAsideReason(f.p) };
    });
    if (fitCache) fitCache.set(snap, m);
    return m;
  }

  // ---- value -----------------------------------------------------------------------------------
  function growthTilt(p) { return clamp(1 + P.growthPerPct * clamp(p.change_7d == null ? 0 : p.change_7d, -50, 100), P.growthLo, P.growthHi); }
  function timeTilt(age) { return age === null ? 1 : P.ageLo + (P.ageSpan * Math.min(age, P.ageCap)) / P.ageCap; }
  function impliedValue(m, p, asOf) {
    var cat = p.category || 'Uncategorised', ratio = Math.exp(curveLog(m, Math.log(p.tvl_usd), cat));
    var age = ageDays(asOf, p.listed_at), g = growthTilt(p), t = timeTilt(age);
    var value = Math.max(1, Math.round(p.tvl_usd * ratio * g * t)), n = m.catN[cat] || 0;
    var conf = n >= 8 ? 'high' : n >= 3 ? 'medium' : 'low';
    if ((age === null || p.change_7d == null) && conf !== 'low') conf = conf === 'high' ? 'medium' : 'low';
    return {
      value: value, low: Math.max(1, Math.round(value * m.lo)), high: Math.max(1, Math.round(value * m.hi)),
      ratio: ratio, growth: g, age: age, ageMult: t, catN: n, confidence: conf
    };
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rankRanges(m, list, asOf) {
    var rand = rng(P.seed), ranks = list.map(function () { return []; });
    var tilt = list.map(function (p) { return growthTilt(p) * timeTilt(ageDays(asOf, p.listed_at)); });
    for (var b = 0; b < P.boots; b++) {
      var s = [];
      for (var i = 0; i < m.set.length; i++) s.push(m.set[Math.floor(rand() * m.set.length)]);
      var mb = fitCompsCurve(s);
      var vals = list.map(function (p, j) { return p.tvl_usd * Math.exp(curveLog(mb, Math.log(p.tvl_usd), p.category || 'Uncategorised')) * tilt[j]; });
      vals.map(function (v, j) { return j; }).sort(function (x, y) { return vals[y] - vals[x] || x - y; })
        .forEach(function (j, r) { ranks[j].push(r + 1); });
    }
    return ranks.map(function (r) { return [quantile(r, 0.1), quantile(r, 0.9)]; });
  }

  // ---- farm economics --------------------------------------------------------------------------
  var CHEAP = ['solana', 'sui', 'aptos', 'ton', 'near', 'sei', 'injective', 'cosmos', 'osmosis', 'hyperliquid l1', 'hyperliquid', 'sonic'];
  var LOW = ['bsc', 'binance', 'polygon', 'arbitrum', 'optimism', 'base', 'linea', 'scroll', 'zksync era', 'blast', 'mantle', 'mode', 'avalanche', 'gnosis', 'fantom', 'berachain', 'unichain', 'ink', 'plasma', 'monad', 'megaeth'];
  function feePerTx(c) {
    c = c.toLowerCase();
    if (c === 'ethereum') return 8;
    if (CHEAP.indexOf(c) >= 0) return 0.02;
    if (LOW.indexOf(c) >= 0) return 0.15;
    return c === 'tron' ? 1 : c === 'bitcoin' ? 3 : 0.5;
  }
  function cheapestChain(ch) { return ch.length ? ch.reduce(function (b, c) { return feePerTx(c) < feePerTx(b) ? c : b; }, ch[0]) : 'its main chain'; }
  function kindOf(cat) {
    var c = (cat || '').toLowerCase();
    if (/lend|borrow/.test(c) || c === 'cdp') return 'lending';
    if (/dex|liquidity|amm|launchpad/.test(c)) return 'dex';
    if (/perp|derivative|option/.test(c)) return 'perps';
    if (/yield|curator|allocator|vault|basis|index/.test(c)) return 'vault';
    if (/rwa|treasury|credit/.test(c)) return 'rwa';
    if (/stable|algo/.test(c)) return 'stable';
    if (/predict|gambl/.test(c)) return 'prediction';
    if (/stak/.test(c)) return 'staking';
    return /bridge/.test(c) ? 'bridge' : 'other';
  }
  function money(n) {
    var a = Math.abs(n);
    return '$' + (a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 100 ? Math.round(n).toLocaleString('en-US') : a >= 10 ? n.toFixed(0) : n.toFixed(2));
  }
  function signed(n) { return (n < 0 ? '-' : '+') + money(Math.abs(n)); }
  function pct(x) { return Math.round(x * 100) + '%'; }

  // Fees are fixed; reward, friction and carry grow with the ticket.
  function economics(tvl, values, fees, days, ticket, share) {
    var prop = P.friction + (P.tbill * days) / 365, costs = fees + ticket * prop, reward = {}, net = {};
    ['low', 'base', 'high'].forEach(function (k) { reward[k] = (values[k] * share * ticket) / tvl; net[k] = reward[k] - costs; });
    return { costs: costs, friction: ticket * P.friction, carry: (ticket * P.tbill * days) / 365, reward: reward, net: net, prop: prop };
  }
  // The smallest ticket that pays if a launch happens, or Infinity.
  function minTicket(tvl, value, fees, days, share) {
    var perDollar = (value * share) / tvl, prop = P.friction + (P.tbill * days) / 365;
    return perDollar <= prop ? Infinity : fees / (perDollar - prop);
  }
  // Tier = the launch chance needed to break even: farm up to 25%, close to 50%, thin to 100%, skip above.
  function tierOf(needBase) {
    return needBase <= P.oddsBar ? 'farm' : needBase <= 2 * P.oddsBar ? 'close' : needBase <= 1 ? 'thin' : 'skip';
  }

  function farmPlan(p, v, o) {
    var C = o.capital, share = o.share, chain = cheapestChain(p.chains), fee = feePerTx(chain);
    var weeks = v.age === null ? 6 : v.age < 180 ? 8 : v.age < 365 ? 6 : 4, costly = fee >= 1;
    var active = costly ? Math.ceil(weeks / 2) : weeks, days = weeks * 7, fees = (3 + active * 2 + 2) * fee;
    var hours = P.hSetup + active * P.hWeek + P.hExit, values = { low: v.low, base: v.value, high: v.high };
    var e = economics(p.tvl_usd, values, fees, days, C, share);
    var needBase = e.reward.base > 0 ? e.costs / e.reward.base : Infinity, needLow = e.reward.low > 0 ? e.costs / e.reward.low : Infinity;
    var minBase = minTicket(p.tvl_usd, v.value, fees, days, share), minLow = minTicket(p.tvl_usd, v.low, fees, days, share);
    var paysFrom = (e.costs * p.tvl_usd) / (v.low * C), tier = tierOf(needBase);
    var name = p.name, cap = money(C), tenth = money(C * 0.1), when = costly ? 'Every second week ' : 'Each week ';
    var core = {
      lending: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ' as collateral, and keep the loan-to-value under 40% if you borrow.',
      dex: 'Add ' + cap + ' of liquidity to the deepest pool ' + name + ' lists on ' + chain + ', in a wide range so the position stays active.',
      perps: 'Deposit ' + cap + ' of USDC as margin on ' + name + ' on ' + chain + ', and keep every position at 2x or less.',
      vault: 'Deposit ' + cap + ' of a stable asset into one ' + name + ' vault on ' + chain + ' that holds no token of its own, and keep the share receipt.',
      rwa: 'Check whether ' + name + ' asks for an identity check on ' + chain + ', then buy ' + cap + ' of its yield asset.',
      stable: 'Mint or buy ' + cap + ' of the stable asset ' + name + ' issues on ' + chain + ' and move it into its savings product.',
      prediction: 'Fund ' + cap + ' on ' + name + ' on ' + chain + ' and spread it over several small markets.',
      staking: 'Stake ' + cap + ' of the native asset through ' + name + ' on ' + chain + ' and keep the receipt token.',
      bridge: 'Bridge ' + cap + ' of USDC to ' + chain + ' through ' + name + ' and use it in an app there.',
      other: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ' and use its main feature once.'
    }[kindOf(p.category)];
    var weekly = {
      lending: 'borrow about ' + money(C * 0.2) + ', hold it a day and repay it, so supply and borrow are both recorded.',
      dex: 'make two swaps through ' + name + ' and move the range when the price leaves it.',
      perps: 'open and close one position of about ' + tenth + ', so the wallet shows trading.',
      vault: 'add about ' + tenth + ' and read the reported yield, so the position is not idle.',
      rwa: 'check the redemption window and make one small transfer.',
      stable: 'move a small amount between the stable asset and its savings product.',
      prediction: 'trade two or three markets with small stakes.',
      staking: 'move a small amount in or out.',
      bridge: 'send a small amount across in both directions.',
      other: 'use one core feature of ' + name + ' in a small amount.'
    }[kindOf(p.category)];
    var steps = [
      { text: 'Open a fresh wallet that holds only the farm funds, keep its seed phrase offline, and connect it to ' + name + ' on ' + chain + ', the cheapest of its ' + p.chains.length + ' chains.', cost: 'about ' + money(fee) + ' for the first approval', time: '10 minutes' },
      { text: core, cost: cap + ' you get back, plus about ' + money(fee * 2) + ' in fees', time: '20 minutes' },
      { text: when + weekly, cost: 'about ' + money(fee * 2) + ' in fees each time', time: '15 minutes ' + (costly ? 'every second week' : 'a week') },
      { text: 'Keep the position open for ' + weeks + ' weeks. ' + (v.age === null ? 'DefiLlama gives no start date, so assume a long window.' : 'It has gone ' + v.age + ' days with no token' + (v.age < 180 ? ', so a program, if one comes, may count early users.' : ', so a program, if any, may weigh how long a wallet stayed.')), cost: 'the ' + cap + ' gives up about ' + money(e.carry) + ' of T-bill return at ' + P.tbill * 100 + '% a year', time: weeks + ' weeks' }
    ];
    if (p.chains.length > 1) steps.push({ text: 'Make one small action on a second chain with the same wallet, since ' + name + ' records TVL on ' + p.chains.length + ' chains.', cost: 'about ' + money(Math.max(fee, feePerTx(p.chains[1])) * 2) + ' in fees', time: '20 minutes' });
    steps.push({
      text: 'If a launch happens, ' + cap + ' at a farmer share of ' + Math.round(share * 100) + '% earns ' + money(e.reward.base) + ' (band ' + money(e.reward.low) + ' to ' + money(e.reward.high) + ') against ' + money(e.costs) + ' of fees, friction and T-bill carry: ' + signed(e.net.base) + '. It needs a launch chance of ' + (isFinite(needBase) ? pct(Math.min(needBase, 9.99)) : 'more than 100%') + ' to break even. ' + (isFinite(minBase) ? 'The smallest ticket that pays is ' + money(minBase) + '.' : 'No ticket pays: each dollar\'s slice is below the T-bill return.') + ' Tier: ' + tier + '.' + (fees / C > P.highFee ? ' Fees alone are ' + Math.round((fees / C) * 100) + '% of the ticket.' : ''),
      cost: money(e.costs) + ' in all', time: 'decide before you deposit'
    });
    steps.push({ text: 'Before you withdraw, open the protocol\'s own rewards page and claim only from the link it publishes. Never sign a message that approves your whole balance. Log the dates and transaction hashes.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' });
    return {
      chain: chain, fee: fee, weeks: weeks, active: active, costly: costly, days: days, fees: fees, hours: hours,
      capital: C, share: share, costs: e.costs, friction: e.friction, carry: e.carry, reward: e.reward, net: e.net,
      needBase: needBase, needLow: needLow, minBase: minBase, minLow: minLow, paysFrom: paysFrom, tier: tier, steps: steps
    };
  }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; return t.length > 600 ? t.slice(0, 596) + '...' : t; }
  function finite(x) { return isFinite(x) ? x : null; }

  // ---- the board -------------------------------------------------------------------------------
  function buildBoard(snap, opts) {
    opts = { capital: (opts && opts.capital) || P.capital, share: (opts && opts.share) || P.share };
    var m = fit(snap), onList = {}, chosen = {}, bySlug = {};
    snap.watchlist.forEach(function (s) { onList[s] = 1; });
    snap.protocols.forEach(function (p) { bySlug[p.slug] = p; });
    snap.watchlist.forEach(function (s) { if (bySlug[s]) chosen[s] = bySlug[s]; });
    snap.protocols.filter(function (p) { return !chosen[p.slug] && canLaunch(p); })
      .map(function (p) { return { p: p, v: impliedValue(m, p, snap.as_of) }; })
      .sort(function (a, b) { return b.v.value - a.v.value || (a.p.slug < b.p.slug ? -1 : 1); })
      .slice(0, P.earlyRows).forEach(function (e) { chosen[e.p.slug] = e.p; });
    var list = Object.keys(chosen).map(function (s) { return chosen[s]; });
    var cached = rankCache && rankCache.get(snap), ranges = cached && cached.n === list.length ? cached.r : rankRanges(m, list, snap.as_of);
    if (rankCache) rankCache.set(snap, { n: list.length, r: ranges });
    var rows = list.map(function (p, i) {
      var v = impliedValue(m, p, snap.as_of), f = farmPlan(p, v, opts);
      return {
        slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
        age_days: v.age, on_watchlist: !!onList[p.slug], implied_value_usd: v.value, value_low_usd: v.low, value_high_usd: v.high,
        confidence: v.confidence, ratio: r4(v.ratio), growth_multiplier: r4(v.growth), age_multiplier: r4(v.ageMult), category_sample: v.catN,
        verdict: f.tier, net_base_usd: r2(f.net.base), launch_odds_needed: finite(r4(f.needBase)),
        min_ticket_usd: isFinite(f.minBase) ? Math.ceil(f.minBase) : null, pays_from_share: r4(f.paysFrom),
        net_per_hour_usd: r2(f.net.base / f.hours), rank_lo: ranges[i][0], rank_hi: ranges[i][1],
        farm_chain: f.chain, farm: f, farm_steps: f.steps.map(stepText)
      };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var aside = snap.protocols.filter(function (p) { return !recordsToken(p) && setAsideReason(p); })
      .sort(function (a, b) { return b.tvl_usd - a.tvl_usd; })
      .map(function (p) { return { name: p.name, category: p.category, tvl: p.tvl_usd, reason: setAsideReason(p) }; });
    var tiers = { farm: 0, close: 0, thin: 0, skip: 0 };
    rows.forEach(function (r) { tiers[r.verdict]++; });
    return { model: m, rows: rows, opts: opts, aside: aside, tiers: tiers, withToken: snap.protocols.filter(recordsToken).length };
  }

  // ---- the planner -----------------------------------------------------------------------------
  // Best low-band net per hour first, at the smallest paying ticket; one setup per chain; leftover money to the best return per dollar.
  function planFarms(board, budget, hours) {
    var share = board.opts.share;
    var cand = board.rows.filter(function (r) { return isFinite(r.farm.minLow); }).map(function (r) {
      var f = r.farm, ticket = Math.min(P.maxPlanTicket, Math.max(P.minPlanTicket, Math.ceil(f.minLow / 50) * 50));
      var values = { low: r.value_low_usd, base: r.implied_value_usd, high: r.value_high_usd };
      var e = economics(r.tvl_usd, values, f.fees, f.days, ticket, share);
      return { row: r, ticket: ticket, hours: f.hours, chain: f.chain, e: e, edge: (r.value_low_usd * share) / r.tvl_usd - e.prop };
    }).filter(function (c) { return c.e.net.low > 0; })
      .sort(function (a, b) { return b.e.net.low / b.hours - a.e.net.low / a.hours; });
    var picks = [], chains = {}, used = 0, spent = 0;
    cand.forEach(function (c) {
      var h = c.hours - (chains[c.chain] ? P.hShared : 0);
      if (spent + c.ticket <= budget && used + h <= hours) { c.hoursUsed = h; picks.push(c); spent += c.ticket; used += h; chains[c.chain] = 1; }
    });
    picks.slice().sort(function (a, b) { return b.edge - a.edge; }).forEach(function (c) {
      var add = Math.min(budget - spent, P.maxPlanTicket - c.ticket);
      if (add > 0) { c.ticket += Math.floor(add / 50) * 50; spent += Math.floor(add / 50) * 50; }
    });
    var sum = { low: 0, base: 0, high: 0 }, costs = 0, reward = 0;
    picks.forEach(function (c) {
      var r = c.row, values = { low: r.value_low_usd, base: r.implied_value_usd, high: r.value_high_usd };
      c.e = economics(r.tvl_usd, values, r.farm.fees, r.farm.days, c.ticket, share);
      ['low', 'base', 'high'].forEach(function (k) { sum[k] += c.e.net[k]; });
      costs += c.e.costs; reward += c.e.reward.base;
    });
    return {
      picks: picks, candidates: cand.length, spent: spent, hours: used, chains: Object.keys(chains).length, net: sum, costs: costs,
      oddsNeeded: reward ? costs / reward : null, atLeastOne: 1 - Math.pow(1 - P.basketOdds, picks.length)
    };
  }

  return { PARAMS: P, fit: fit, impliedValue: impliedValue, farmPlan: farmPlan, buildBoard: buildBoard, planFarms: planFarms, curveLog: curveLog };
});
