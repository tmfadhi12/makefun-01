// Token radar model: one frozen DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// Implied value is what a protocol's token might be worth if its record stayed as it is. It is a
// claim of this entry, never a forecast that a token is issued. Every figure comes from the snapshot:
//
//   1. Calibrate on the protocols that already trade. For each one, ratio = mcap / tvl. A regression
//      of ln(ratio) on ln(tvl) gives a size slope (bigger protocols trade at lower ratios), and each
//      category gets an offset from the median residual, shrunk toward the overall offset when the
//      category has few trading protocols.
//   2. Base value of a pre-token protocol = tvl x exp(offset_category + slope x (ln tvl - mean ln tvl)).
//   3. Three bounded multipliers: growth (7-day TVL change), age (days since DefiLlama began tracking
//      it with no token) and breadth (number of chains).
//
// No protocol name is special-cased. One function scores every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the board adds, best implied value first. */
export const EARLY_ROWS = 200;

/** How many already-trading protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** Bounds and weights of the three multipliers, shown on the dashboard's method panel. */
export const WEIGHTS = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.7,
  age_range: 0.5,
  age_days_cap: 1460,
  unknown_age_multiplier: 1,
  breadth_step: 0.03,
  breadth_max_extra_chains: 8,
  ratio_min: 0.02,
  ratio_max: 4,
  shrink_k: 4,
  slope_min: -0.6,
  slope_max: 0,
};

const DAY_MS = 86_400_000;

/** Categories whose products wrap, bridge or stake a token that trades or run an exchange. */
const NOT_A_LAUNCH = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own shape rule, without the TVL floor: a protocol that can still launch a token. */
export function canLaunch(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** What the model learned from the protocols that already trade. */
export interface CategoryFit {
  category: string;
  trading_count: number;
  median_ratio: number;
  calibrated_ratio: number;
}

export interface Calibration {
  sample_size: number;
  slope: number;
  mean_log_tvl: number;
  overall_ratio: number;
  overall_offset: number;
  offsets: Record<string, number>;
  categories: CategoryFit[];
}

/** Fit the size slope and the category offsets on every trading protocol that is not an exchange. */
export function calibrate(snapshot: Snapshot): Calibration {
  const sample = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const meanLogTvl = sample.length === 0 ? Math.log(snapshot.floor_usd) : sample.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / sample.length;
  let slope = 0;
  if (sample.length >= 5) {
    const xs = sample.map((p) => Math.log(p.tvl_usd) - meanLogTvl);
    const ys = sample.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
    let cov = 0;
    let variance = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += xs[i]! * (ys[i]! - meanY);
      variance += xs[i]! * xs[i]!;
    }
    slope = variance > 0 ? clamp(cov / variance, WEIGHTS.slope_min, WEIGHTS.slope_max) : 0;
  }
  const residual = (p: SnapshotProtocol): number => Math.log(p.mcap_usd! / p.tvl_usd) - slope * (Math.log(p.tvl_usd) - meanLogTvl);
  const overallOffset = sample.length === 0 ? Math.log(0.2) : median(sample.map(residual));
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of sample) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p]);
    else list.push(p);
  }
  const offsets: Record<string, number> = {};
  const categories: CategoryFit[] = [];
  for (const [category, list] of byCategory) {
    const n = list.length;
    const offset = overallOffset + (n / (n + WEIGHTS.shrink_k)) * (median(list.map(residual)) - overallOffset);
    offsets[category] = offset;
    categories.push({
      category,
      trading_count: n,
      median_ratio: round4(median(list.map((p) => p.mcap_usd! / p.tvl_usd))),
      calibrated_ratio: round4(clamp(Math.exp(offset), WEIGHTS.ratio_min, WEIGHTS.ratio_max)),
    });
  }
  categories.sort((a, b) => b.trading_count - a.trading_count || (a.category < b.category ? -1 : 1));
  return {
    sample_size: sample.length,
    slope: round4(slope),
    mean_log_tvl: round4(meanLogTvl),
    overall_ratio: round4(clamp(Math.exp(overallOffset), WEIGHTS.ratio_min, WEIGHTS.ratio_max)),
    overall_offset: overallOffset,
    offsets,
    categories,
  };
}

/** The pieces of one implied value, so the page can show the arithmetic. */
export interface Parts {
  ratio: number;
  growth_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  category_sample: number;
}

export interface Valuation {
  implied: number;
  parts: Parts;
  age: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export function value(p: SnapshotProtocol, asOf: string, cal: Calibration): Valuation {
  const key = p.category ?? 'Uncategorised';
  const offset = cal.offsets[key] ?? cal.overall_offset;
  const sampleN = cal.categories.find((c) => c.category === key)?.trading_count ?? 0;
  const x = Math.log(Math.max(1, p.tvl_usd)) - cal.mean_log_tvl;
  const ratio = clamp(Math.exp(offset + cal.slope * x), WEIGHTS.ratio_min, WEIGHTS.ratio_max);
  const growthPct = clamp(p.change_7d ?? 0, WEIGHTS.growth_floor, WEIGHTS.growth_cap);
  const growth = 1 + (growthPct / 100) * WEIGHTS.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageMult = age === null ? WEIGHTS.unknown_age_multiplier : WEIGHTS.age_floor + (Math.min(age, WEIGHTS.age_days_cap) / WEIGHTS.age_days_cap) * WEIGHTS.age_range;
  const extraChains = clamp(p.chains.length - 1, 0, WEIGHTS.breadth_max_extra_chains);
  const breadth = 1 + extraChains * WEIGHTS.breadth_step;
  // The value is computed from the rounded multipliers the dashboard shows, in the same order, so
  // anyone can multiply the printed figures and get the board's number exactly.
  const parts: Parts = { ratio: round4(ratio), growth_multiplier: round4(growth), age_multiplier: round4(ageMult), breadth_multiplier: round4(breadth), category_sample: sampleN };
  const implied = Math.max(1, Math.round(p.tvl_usd * parts.ratio * parts.growth_multiplier * parts.age_multiplier * parts.breadth_multiplier));
  let confidence: 'high' | 'medium' | 'low' = sampleN >= 8 ? 'high' : sampleN >= 3 ? 'medium' : 'low';
  if ((age === null || p.change_7d === null) && confidence !== 'low') confidence = confidence === 'high' ? 'medium' : 'low';
  return { implied, parts, age, confidence };
}

// ---------------------------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------------------------

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface FarmPlan {
  steps: FarmStep[];
  farm_chain: string;
  capital_usd: number;
  gas_usd: number;
  days: number;
}

const CHEAP_FAST = new Set(['solana', 'sui', 'aptos', 'ton', 'near', 'sei', 'injective', 'cosmos', 'osmosis', 'hyperliquid l1', 'hyperliquid', 'sonic']);
const LOW_FEE_EVM = new Set(['bsc', 'binance', 'polygon', 'arbitrum', 'optimism', 'base', 'linea', 'scroll', 'zksync era', 'blast', 'mantle', 'mode', 'avalanche', 'gnosis', 'fantom', 'berachain', 'unichain', 'ink', 'plasma', 'monad', 'megaeth']);

/** Rough cost of one transaction on a chain, in dollars. A generic fee class, not a per-protocol figure. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (CHEAP_FAST.has(c)) return 0.02;
  if (LOW_FEE_EVM.has(c)) return 0.15;
  if (c === 'tron') return 1;
  if (c === 'bitcoin') return 3;
  return 0.5;
}

/** The cheapest chain the protocol records TVL on; ties keep the listed order. */
function cheapestChain(chains: string[]): string {
  if (chains.length === 0) return 'its main chain';
  let best = chains[0]!;
  for (const c of chains) if (gasPerTx(c) < gasPerTx(best)) best = c;
  return best;
}

type Archetype = 'lending' | 'dex' | 'perps' | 'vault' | 'rwa' | 'stable' | 'prediction' | 'staking' | 'bridge' | 'other';

function archetypeOf(category: string | null): Archetype {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c === 'cdp' || c.includes('borrow')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity') || c.includes('amm') || c.includes('launchpad')) return 'dex';
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) return 'perps';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('basis') || c.includes('index')) return 'vault';
  if (c.includes('rwa') || c.includes('treasury') || c.includes('credit')) return 'rwa';
  if (c.includes('stable') || c.includes('algo')) return 'stable';
  if (c.includes('predict') || c.includes('gambl') || c.includes('prediction')) return 'prediction';
  if (c.includes('stak') || c.includes('restak')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  return 'other';
}

function dollars(n: number): string {
  return `$${n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(2)}`;
}

function capitalFor(tvl: number, gasTotal: number): number {
  const base = tvl >= 1_000_000_000 ? 200 : tvl >= 250_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
  // Fees should stay under 5% of the position, or the farm costs more than it can return.
  const floorForGas = Math.ceil(gasTotal / 0.05 / 50) * 50;
  return Math.max(base, floorForGas);
}

function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  return 4;
}

export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = cheapestChain(p.chains);
  const gas = gasPerTx(chain);
  const weeks = weeksFor(age);
  const txCount = 3 + weeks * 2 + 2;
  const gasTotal = Math.round(txCount * gas * 100) / 100;
  const capital = capitalFor(p.tvl_usd, gasTotal);
  const kind = archetypeOf(p.category);
  const name = p.name;
  const money = dollars(capital);
  const core: Record<Archetype, string> = {
    lending: `Deposit ${money} of a stable asset into ${name} on ${chain} as collateral, and keep the loan-to-value under 40% if you borrow.`,
    dex: `Add ${money} of liquidity to the deepest pool ${name} lists on ${chain}, in a wide range so the position stays active.`,
    perps: `Deposit ${money} of USDC as margin on ${name} on ${chain}, and size every trade under 2x leverage.`,
    vault: `Deposit ${money} of a stable asset into one ${name} vault on ${chain} that holds no token of its own, and keep the share receipt.`,
    rwa: `Check whether ${name} asks for an identity check on ${chain} before you fund it, then buy ${money} of its yield asset.`,
    stable: `Mint or buy ${money} of the stable asset ${name} issues on ${chain}, then move it into the protocol's savings or pool product.`,
    prediction: `Fund ${money} on ${name} on ${chain} and spread it over several small markets rather than one large bet.`,
    staking: `Stake ${money} of the chain's native asset through ${name} on ${chain} and keep the receipt token.`,
    bridge: `Bridge ${money} of USDC to ${chain} through ${name}, and use the bridged funds in an app on that chain.`,
    other: `Deposit ${money} of a stable asset into ${name} on ${chain}, and use its main feature once with a small part of it.`,
  };
  const weekly: Record<Archetype, string> = {
    lending: `Each week borrow about ${dollars(capital * 0.2)}, hold it a day, and repay it, so both supply and borrow activity are recorded.`,
    dex: `Each week make two swaps through ${name} and check the pool's range, rebalancing when the price leaves it.`,
    perps: `Each week open and close one small position of about ${dollars(capital * 0.1)}, so the wallet shows trading volume and not only a deposit.`,
    vault: `Each week add a small top-up of about ${dollars(capital * 0.1)} and read the vault's reported yield, so the position is not idle.`,
    rwa: `Each week check the redemption window and the yield accrual, and make one small transfer so the wallet shows activity.`,
    stable: `Each week move a small amount between the stable asset and the savings or pool product, and note the rate.`,
    prediction: `Each week trade in two or three markets with small stakes and close at least one position before it settles.`,
    staking: `Each week check the validator or operator set, and move a small amount in or out to show repeated use.`,
    bridge: `Each week send a small amount across the bridge in both directions and keep the transaction hashes.`,
    other: `Each week use one core feature of ${name} in a small amount, so activity shows in more than one period.`,
  };
  const steps: FarmStep[] = [];
  steps.push({
    text: `Open a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and connect it to ${name} on ${chain}, the cheapest chain among the ${p.chains.length} it records.`,
    cost: `about ${dollars(gas)} for the first approval`,
    time: '10 minutes',
  });
  steps.push({
    text: core[kind],
    cost: `${money} of capital, which you get back when you withdraw, plus about ${dollars(gas * 2)} in fees`,
    time: '20 minutes',
  });
  steps.push({
    text: weekly[kind],
    cost: `about ${dollars(gas * 2)} in fees each week`,
    time: '15 minutes a week',
  });
  steps.push({
    text: `Keep the position open for ${weeks} weeks. ${age === null ? 'DefiLlama gives no start date for this protocol, so assume a long window.' : age < 180 ? `DefiLlama began tracking it ${age} days ago, so a rewards program, if one comes, is likely to count early users.` : `DefiLlama has tracked it for ${age} days with no token, so rewards, if any, may weigh how long a wallet stayed.`}`,
    cost: `the ${money} stays in the position`,
    time: `${weeks} weeks`,
  });
  const change = p.change_7d;
  if (change !== null && change <= -10) {
    steps.push({
      text: `Start with half the size. Its TVL fell ${Math.abs(change).toFixed(1)}% in a week, so check the protocol's channels for an incident or an exit of large depositors before you add more.`,
      cost: 'no extra cost, a smaller position',
      time: '10 minutes',
    });
  } else if (change !== null && change >= 25) {
    steps.push({
      text: `TVL grew ${change.toFixed(1)}% in a week, which often means incentives are running. Enter before you chase it, keep the size fixed, and do not add capital after the surge.`,
      cost: 'no extra cost, a fixed size',
      time: '10 minutes',
    });
  } else {
    steps.push({
      text: `Check the protocol's audit page and the size of its largest pools before you add more capital. TVL is ${dollars(p.tvl_usd)}, so a position of ${money} is a small share of it.`,
      cost: 'no fee to check',
      time: '15 minutes',
    });
  }
  if (p.chains.length > 1) {
    steps.push({
      text: `Use one small action on a second chain too, since ${name} records TVL on ${p.chains.length} chains, and keep the same wallet so the activity links.`,
      cost: `about ${dollars(Math.max(gas, gasPerTx(p.chains[1] ?? chain)) * 2)} in fees`,
      time: '20 minutes',
    });
  }
  steps.push({
    text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Never sign a message that asks for approval on your whole balance. Write the dates and transaction hashes in a log.`,
    cost: 'no fee to check, and never pay to claim',
    time: '15 minutes',
  });
  return { steps, farm_chain: chain, capital_usd: capital, gas_usd: gasTotal, days: weeks * 7 };
}

/** A step as one string, inside the gate's 20 to 600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  confidence: 'high' | 'medium' | 'low';
  parts: Parts;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_days: number;
  farm_chain: string;
  farm_steps: string[];
}

/** The dashboard's row: the board row plus the structured plan. */
export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  plan: FarmStep[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: typeof WEIGHTS;
  calibration: Omit<Calibration, 'offsets' | 'overall_offset'>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

function bySlugThenValue<T extends { slug: string }>(a: T, b: T): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** Score every protocol the board may rank and return the rows with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): { board: BoardRow[]; radar: RadarRow[] } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const onList = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && canLaunch(p))
    .map((p) => ({ p, v: value(p, snapshot.as_of, cal) }))
    .sort((a, b) => b.v.implied - a.v.implied || bySlugThenValue(a.p, b.p))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, v: value(p, snapshot.as_of, cal) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || bySlugThenValue(a.p, b.p));
  const board: BoardRow[] = [];
  const radar: RadarRow[] = [];
  scored.forEach(({ p, v }, i) => {
    const plan = farmPlan(p, v.age);
    const base = {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: v.age,
      on_watchlist: onList.has(p.slug),
      implied_value_usd: v.implied,
      confidence: v.confidence,
      parts: v.parts,
      farm_capital_usd: plan.capital_usd,
      farm_gas_usd: plan.gas_usd,
      farm_days: plan.days,
      farm_chain: plan.farm_chain,
    };
    board.push({ ...base, farm_steps: plan.steps.map(stepText) });
    radar.push({ ...base, plan: plan.steps });
  });
  return { board, radar };
}

/** Protocols that already trade, by market cap, with the ratio the model learned from. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || bySlugThenValue(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const { board, radar } = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const onList = new Set(snapshot.watchlist);
  const { offsets: _offsets, overall_offset: _overall, ...publicCal } = cal;
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_version: MODEL_VERSION,
      weights: WEIGHTS,
      calibration: publicCal,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: board.filter((r) => !onList.has(r.slug)).length,
      live_size: live.length,
      rows: radar,
      live,
    },
  };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board would fail the gate, or null. The same rules the scorer's rows apply. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, the gate takes 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `${invented.length} slugs are not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const outside = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (outside < 60) return `only ${outside} rows are outside the watchlist`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
