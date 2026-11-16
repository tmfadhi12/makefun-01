// Radar model. One script for both worlds: main.ts loads it in Node to write board.json, and the page
// loads it in the browser to draw the board, so the page and the file are the same arithmetic.
//
// 1. Fit on the protocols that already trade: ln(mcap / tvl) = base + slope x (ln tvl - x0) + category offset.
//    The offset is pulled toward zero by shrink k, because most categories hold few trading protocols.
// 2. A leave-one-out test (each trading protocol priced by a fit made without it) gives the model's
//    honest error, which becomes the band around every value.
// 3. Two small tilts, growth and time tracked, are kept as judgment: the backtest cannot confirm them.
// 4. Farm economics: reward = value x farmer share x capital / TVL, minus fees, friction and carry.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var P = {
    shrinkK: 8, slopeMin: -0.7, slopeMax: 0, bandLo: 0.25, bandHi: 0.75,
    growthPerPct: 0.0015, growthLo: 0.925, growthHi: 1.15, ageLo: 0.95, ageSpan: 0.15, ageCap: 1460,
    capital: 500, share: 0.08, carry: 0.04, friction: 0.004, earlyRows: 160, highFee: 0.05
  };
  var NOT_A_LAUNCH = ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]; }
  function ageDays(asOf, listed) {
    if (!listed) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listed + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY)) : null;
  }
  function isTrading(p) { return p.mcap_usd > 0 && !!p.gecko_id && p.tvl_usd > 0 && p.category !== 'CEX'; }
  function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
  function canLaunch(p) {
    return isPreToken(p) && NOT_A_LAUNCH.indexOf(p.category) < 0 && !VERSION.test(p.name) && !WRAPPED.test(p.name) && !EXCHANGE.test(p.name);
  }

  // ---- fit -----------------------------------------------------------------------------------
  function fitCore(set) {
    var n = set.length, mx = 0, my = 0;
    set.forEach(function (f) { mx += f.x; my += f.y; });
    mx /= n; my /= n;
    var cov = 0, v = 0;
    set.forEach(function (f) { cov += (f.x - mx) * (f.y - my); v += (f.x - mx) * (f.x - mx); });
    var slope = clamp(v > 0 ? cov / v : 0, P.slopeMin, P.slopeMax);
    var res = set.map(function (f) { return f.y - slope * (f.x - mx); });
    var base = median(res), groups = {}, off = {};
    set.forEach(function (f, i) { (groups[f.cat] = groups[f.cat] || []).push(res[i]); });
    Object.keys(groups).forEach(function (c) { off[c] = (groups[c].length / (groups[c].length + P.shrinkK)) * (median(groups[c]) - base); });
    return { slope: slope, base: base, x0: mx, off: off };
  }
  function predict(m, x, cat) { return m.base + m.slope * (x - m.x0) + (m.off[cat] || 0); }

  function looErrors(set, kind) {
    return set.map(function (f, i) {
      var rest = set.filter(function (_, j) { return j !== i; });
      if (kind === 'flat') return f.y - median(rest.map(function (r) { return r.y; }));
      var m = fitCore(kind === 'size' ? rest.map(function (r) { return { x: r.x, y: r.y, cat: '-' }; }) : rest);
      return f.y - predict(m, f.x, kind === 'size' ? '-' : f.cat);
    });
  }
  function score(errs) {
    var a = errs.map(Math.abs).sort(function (x, y) { return x - y; }), n = a.length;
    return {
      median: Math.exp(a[Math.floor(n / 2)]),
      within2: a.filter(function (e) { return e <= Math.log(2); }).length / n,
      within3: a.filter(function (e) { return e <= Math.log(3); }).length / n
    };
  }

  function fit(snapshot) {
    var set = snapshot.protocols.filter(isTrading).map(function (p) {
      return { p: p, x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd / p.tvl_usd), cat: p.category || 'Uncategorised' };
    });
    var m = fitCore(set), errs = looErrors(set, 'full');
    var sorted = errs.slice().sort(function (a, b) { return a - b; });
    m.lo = Math.exp(quantile(sorted, P.bandLo));
    m.hi = Math.exp(quantile(sorted, P.bandHi));
    m.n = set.length;
    m.catN = {};
    set.forEach(function (f) { m.catN[f.cat] = (m.catN[f.cat] || 0) + 1; });
    m.backtest = { flat: score(looErrors(set, 'flat')), size: score(looErrors(set, 'size')), full: score(errs) };
    m.points = set.map(function (f) {
      return { slug: f.p.slug, name: f.p.name, category: f.cat, tvl: f.p.tvl_usd, mcap: f.p.mcap_usd, ratio: f.p.mcap_usd / f.p.tvl_usd };
    });
    return m;
  }

  // ---- value ---------------------------------------------------------------------------------
  function valueOf(m, p, asOf) {
    var cat = p.category || 'Uncategorised', ratio = Math.exp(predict(m, Math.log(p.tvl_usd), cat));
    var g = clamp(p.change_7d == null ? 0 : p.change_7d, -50, 100);
    var gm = clamp(1 + P.growthPerPct * g, P.growthLo, P.growthHi);
    var age = ageDays(asOf, p.listed_at);
    var am = age === null ? 1 : P.ageLo + (P.ageSpan * Math.min(age, P.ageCap)) / P.ageCap;
    var value = Math.max(1, Math.round(p.tvl_usd * ratio * gm * am)), n = m.catN[cat] || 0;
    var conf = n >= 8 ? 'high' : n >= 3 ? 'medium' : 'low';
    if ((age === null || p.change_7d == null) && conf !== 'low') conf = conf === 'high' ? 'medium' : 'low';
    return {
      value: value, low: Math.max(1, Math.round(value * m.lo)), high: Math.max(1, Math.round(value * m.hi)),
      ratio: ratio, growth: gm, age: age, ageMult: am, catN: n, confidence: conf
    };
  }

  // ---- farm economics ------------------------------------------------------------------------
  var CHEAP = ['solana', 'sui', 'aptos', 'ton', 'near', 'sei', 'injective', 'cosmos', 'osmosis', 'hyperliquid l1', 'hyperliquid', 'sonic'];
  var LOW = ['bsc', 'binance', 'polygon', 'arbitrum', 'optimism', 'base', 'linea', 'scroll', 'zksync era', 'blast', 'mantle', 'mode', 'avalanche', 'gnosis', 'fantom', 'berachain', 'unichain', 'ink', 'plasma', 'monad', 'megaeth'];
  function gasPerTx(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 8;
    if (CHEAP.indexOf(c) >= 0) return 0.02;
    if (LOW.indexOf(c) >= 0) return 0.15;
    if (c === 'tron') return 1;
    if (c === 'bitcoin') return 3;
    return 0.5;
  }
  function cheapest(chains) {
    if (!chains.length) return 'its main chain';
    return chains.reduce(function (b, c) { return gasPerTx(c) < gasPerTx(b) ? c : b; }, chains[0]);
  }
  function archetype(cat) {
    var c = (cat || '').toLowerCase();
    if (/lend|borrow/.test(c) || c === 'cdp') return 'lending';
    if (/dex|liquidity|amm|launchpad/.test(c)) return 'dex';
    if (/perp|derivative|option/.test(c)) return 'perps';
    if (/yield|curator|allocator|vault|basis|index/.test(c)) return 'vault';
    if (/rwa|treasury|credit/.test(c)) return 'rwa';
    if (/stable|algo/.test(c)) return 'stable';
    if (/predict|gambl/.test(c)) return 'prediction';
    if (/stak/.test(c)) return 'staking';
    if (/bridge/.test(c)) return 'bridge';
    return 'other';
  }
  function money(n) { return '$' + (Math.abs(n) >= 100 ? Math.round(n) : Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(2)); }
  function signed(n) { return (n < 0 ? '-' : '+') + money(Math.abs(n)); }

  function farm(p, v, opts) {
    var capital = opts.capital, share = opts.share, chain = cheapest(p.chains), gas = gasPerTx(chain);
    var weeks = v.age === null ? 6 : v.age < 180 ? 8 : v.age < 365 ? 6 : 4;
    var costly = gas >= 1, active = costly ? Math.ceil(weeks / 2) : weeks, days = weeks * 7;
    var tx = 3 + active * 2 + 2, fees = tx * gas, friction = capital * P.friction, carry = capital * P.carry * days / 365;
    var costs = fees + friction + carry;
    var reward = {}, net = {};
    ['low', 'base', 'high'].forEach(function (k) {
      var val = k === 'base' ? v.value : v[k];
      reward[k] = (val * share * capital) / p.tvl_usd;
      net[k] = reward[k] - costs;
    });
    var verdict = net.low > 0 ? 'farm' : net.base > 0 ? 'thin' : 'skip';
    var kind = archetype(p.category), name = p.name, cap = money(capital), often = costly ? 'every second week' : 'each week';
    var core = {
      lending: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ' as collateral, and keep the loan-to-value under 40% if you borrow.',
      dex: 'Add ' + cap + ' of liquidity to the deepest pool ' + name + ' lists on ' + chain + ', in a wide range so the position stays active.',
      perps: 'Deposit ' + cap + ' of USDC as margin on ' + name + ' on ' + chain + ', and keep every trade under 2x leverage.',
      vault: 'Deposit ' + cap + ' of a stable asset into one ' + name + ' vault on ' + chain + ' that holds no token of its own, and keep the share receipt.',
      rwa: 'Check whether ' + name + ' asks for an identity check on ' + chain + ' before you fund it, then buy ' + cap + ' of its yield asset.',
      stable: 'Mint or buy ' + cap + ' of the stable asset ' + name + ' issues on ' + chain + ', then move it into its savings or pool product.',
      prediction: 'Fund ' + cap + ' on ' + name + ' on ' + chain + ' and spread it over several small markets instead of one large bet.',
      staking: 'Stake ' + cap + ' of the chain\'s native asset through ' + name + ' on ' + chain + ' and keep the receipt token.',
      bridge: 'Bridge ' + cap + ' of USDC to ' + chain + ' through ' + name + ', and use the funds in an app on that chain.',
      other: 'Deposit ' + cap + ' of a stable asset into ' + name + ' on ' + chain + ', and use its main feature once with a small part of it.'
    }[kind];
    var top = money(capital * 0.1);
    var weekly = {
      lending: 'borrow about ' + money(capital * 0.2) + ', hold it a day and repay it, so supply and borrow are both recorded.',
      dex: 'make two swaps through ' + name + ' and move the range when the price leaves it.',
      perps: 'open and close one small position of about ' + top + ', so the wallet shows trading and not only a deposit.',
      vault: 'add a top-up of about ' + top + ' and read the reported yield, so the position is not idle.',
      rwa: 'check the redemption window and the yield accrual, and make one small transfer.',
      stable: 'move a small amount between the stable asset and its savings or pool product.',
      prediction: 'trade two or three markets with small stakes and close one position before it settles.',
      staking: 'check the operator set and move a small amount in or out.',
      bridge: 'send a small amount across the bridge in both directions and keep the hashes.',
      other: 'use one core feature of ' + name + ' in a small amount.'
    }[kind];
    var steps = [
      { text: 'Open a fresh wallet that holds only the farm funds, keep its seed phrase offline, and connect it to ' + name + ' on ' + chain + ', the cheapest of the ' + p.chains.length + ' chains it records.', cost: 'about ' + money(gas) + ' for the first approval', time: '10 minutes' },
      { text: core, cost: cap + ' of capital you get back, plus about ' + money(gas * 2) + ' in fees', time: '20 minutes' },
      { text: (costly ? 'Every second week ' : 'Each week ') + weekly, cost: 'about ' + money(gas * 2) + ' in fees ' + often, time: costly ? '15 minutes every second week' : '15 minutes a week' },
      { text: 'Keep the position open for ' + weeks + ' weeks. ' + (v.age === null ? 'DefiLlama gives no start date, so assume a long window.' : 'DefiLlama has tracked it for ' + v.age + ' days with no token' + (v.age < 180 ? ', so a rewards program, if one comes, may count early users.' : ', so rewards, if any, may weigh how long a wallet stayed.')), cost: 'the ' + cap + ' stays in the position, about ' + money(carry) + ' of carry at ' + P.carry * 100 + '% a year', time: weeks + ' weeks' }
    ];
    if (p.chains.length > 1) steps.push({ text: 'Use one small action on a second chain too, since ' + name + ' records TVL on ' + p.chains.length + ' chains, with the same wallet so the activity links.', cost: 'about ' + money(Math.max(gas, gasPerTx(p.chains[1])) * 2) + ' in fees', time: '20 minutes' });
    var feeShare = fees / capital;
    steps.push({
      text: 'Net at ' + cap + ' with a farmer share of ' + Math.round(share * 100) + '%: reward ' + money(reward.base) + ' (band ' + money(reward.low) + ' to ' + money(reward.high) + ') minus ' + money(costs) + ' of fees, friction and carry gives ' + signed(net.base) + ' (band ' + signed(net.low) + ' to ' + signed(net.high) + '). Verdict: ' + verdict + '.' + (feeShare > P.highFee ? ' Fees alone are ' + Math.round(feeShare * 100) + '% of the position, so skip it unless you hold more.' : ''),
      cost: money(costs) + ' in all', time: 'decide before you deposit'
    });
    steps.push({ text: 'Before you withdraw, open the protocol\'s own rewards page and claim only from the link it publishes. Never sign a message that approves your whole balance. Log the dates and transaction hashes.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' });
    return { chain: chain, weeks: weeks, days: days, fees: fees, costs: costs, reward: reward, net: net, verdict: verdict, feeShare: feeShare, capital: capital, share: share, steps: steps };
  }
  function stepText(s) {
    var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
    return t.length > 600 ? t.slice(0, 596) + '...' : t;
  }

  // ---- board ---------------------------------------------------------------------------------
  function buildBoard(snapshot, opts) {
    opts = { capital: (opts && opts.capital) || P.capital, share: (opts && opts.share) || P.share };
    var m = fit(snapshot), onList = {}, chosen = {};
    snapshot.watchlist.forEach(function (s) { onList[s] = 1; });
    var bySlug = {};
    snapshot.protocols.forEach(function (p) { bySlug[p.slug] = p; });
    snapshot.watchlist.forEach(function (s) { if (bySlug[s]) chosen[s] = bySlug[s]; });
    var early = snapshot.protocols.filter(function (p) { return !chosen[p.slug] && canLaunch(p); })
      .map(function (p) { return { p: p, v: valueOf(m, p, snapshot.as_of) }; })
      .sort(function (a, b) { return b.v.value - a.v.value || (a.p.slug < b.p.slug ? -1 : 1); }).slice(0, P.earlyRows);
    early.forEach(function (e) { chosen[e.p.slug] = e.p; });
    var rows = Object.keys(chosen).map(function (s) {
      var p = chosen[s], v = valueOf(m, p, snapshot.as_of), f = farm(p, v, opts);
      return {
        slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
        mcap_usd: p.mcap_usd, listed_at: p.listed_at, age_days: v.age, on_watchlist: !!onList[s],
        implied_value_usd: v.value, value_low_usd: v.low, value_high_usd: v.high, confidence: v.confidence,
        ratio: round4(v.ratio), growth_multiplier: round4(v.growth), age_multiplier: round4(v.ageMult), category_sample: v.catN,
        verdict: f.verdict, net_base_usd: Math.round(f.net.base * 100) / 100, net_low_usd: Math.round(f.net.low * 100) / 100,
        net_high_usd: Math.round(f.net.high * 100) / 100, farm_chain: f.chain, farm_days: f.days, farm: f,
        farm_steps: f.steps.map(stepText)
      };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return { model: m, rows: rows, opts: opts };
  }

  /** Why a board would fail the gate, or null: the scorer's own rows. */
  function boardIssue(rows, snapshot) {
    if (rows.length < 100 || rows.length > 4000) return 'the board has ' + rows.length + ' rows, the gate takes 100 to 4000';
    var seen = {}, known = {}, i;
    snapshot.protocols.forEach(function (p) { known[p.slug] = 1; });
    for (i = 0; i < rows.length; i++) { if (seen[rows[i].slug]) return 'slug twice: ' + rows[i].slug; seen[rows[i].slug] = 1; if (!known[rows[i].slug]) return 'unknown slug ' + rows[i].slug; }
    var missing = snapshot.watchlist.filter(function (s) { return !seen[s]; });
    if (missing.length) return 'misses ' + missing.length + ' watchlist slugs';
    if (rows.length - snapshot.watchlist.length < 60) return 'fewer than 60 rows outside the watchlist';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.rank !== i + 1) return 'rank ' + (i + 1) + ' is ' + r.rank;
      if (i && r.implied_value_usd > rows[i - 1].implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i;
      if (!(r.implied_value_usd > 0) || r.implied_value_usd % 1 !== 0) return r.slug + ' has a bad implied value';
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + r.farm_steps.length + ' farm steps';
      for (var j = 0; j < r.farm_steps.length; j++) { var n = r.farm_steps[j].trim().length; if (n < 20 || n > 600) return r.slug + ' has a farm step of ' + n + ' characters'; }
    }
    if (rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) return 'every row has the same implied value';
    return null;
  }

  return { PARAMS: P, fit: fit, valueOf: valueOf, farm: farm, buildBoard: buildBoard, boardIssue: boardIssue, canLaunch: canLaunch, isTrading: isTrading, predict: predict, money: money, signed: signed };
});
