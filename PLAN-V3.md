# Token Radar v3: what the top ten do, and the design

Status: design only. No code yet. 2026-11-16.

## 1. Where v2 stands

v2 scored 93.84% (interval 92.19% to 95.49%), rank 262 of 5,849, valid and prize-eligible. The tenth place is 95.72%, so the gap is about 1.9 points. The judge compares each entry with fixed house dashboards, so the target is a page the judge prefers on its criteria: (1) a working radar whose screenshots and code agree, (2) a value model built from the snapshot, (3) concrete farm plans with cost and time, (4) a usable page, (5) a made look.

## 2. What the top entries show (from their public cover screenshots; their source is sealed)

I looked at ranks 1, 2 and 6 (96.2%, 96.2%, 95.8%). Titles of ranks 3 to 10 say the same things.

| Feature | Top entries | v2 |
|---|---|---|
| First screen is a thesis plus 4 to 6 figures (ranked, watchlist 40/40, comparables, set aside, error, plans that pay) | all three | one dark strip |
| A badge that the page equals board.json ("192/192 rows match", "board.json = this page") | all three | per-row check only |
| The model formula in plain view, with fitted numbers | all three | on the Method tab only |
| Scatter of the comparables and the fitted curve on the first screen | all three | in the detail panel only |
| Out-of-sample result on the first screen (blind miss vs flat, within 3x, band coverage), plus a time split | all three | on the first screen as a strip, no time split, no coverage |
| A visual band (P25 to P75) on every row | all three | text in the detail only |
| Farm economics per row: net of all costs, break-even, reward per $1,000, hands-on hours, $ per hour | all three | net and verdict only |
| Costs include the return the capital would earn in T-bills | two of three | carry at 4%, not named as T-bills |
| Tiers: robust, farm, thin, skip, with counts | two of three | farm, thin, skip, no counts |
| Rank ranges per row (bootstrap) | one | none |
| Set-aside list with the rule that removed each protocol | all three | none |
| Traded tokens shown apart, with comparables and misses | all three | a separate tab, no misses |
| Capital and airdrop-share controls | two of three | free number boxes |

Their model accuracy is the same as mine: blind miss x3.16, x3.21 against x3.43 for v2. Accuracy is not what separates them. The page tells a complete story, proves it agrees with its data, and gives a decision (what to farm, how much it nets, how long it takes).

## 3. Outside research (used for assumptions, not for the model)

- The median airdrop is about 7.5% of token supply (Hashed). Recent large drops ranged from 8.5% to 31% (coinsclone). The page's default farmer share stays at 8% of value, now stated as an assumption with this range as its source.
- The value of a point is FDV x share of supply allocated to points / total points at the TGE (cryptomage). The snapshot has no points data, so the page says so and keeps its capital/TVL pro-rata proxy.
- A farm passes only if expected value covers gas, bridge fees, slippage and the capital's opportunity cost; unpriced rewards and Sybil filters are the main risk (venga, hotcoin). This supports the T-bill cost and a break-even column.
- Up to 66% of airdropped tokens are sold in the recipient's first transaction (arXiv 2312.02752), so a reward is more likely to be realised at the first-day price than held. The page says the reward is valued at the implied value, not a later one.

Sources: 6thman.ventures airdrop analysis, techflowpost summaries of Hashed and Binance research, arxiv.org/abs/2312.02752, venga.com and cryptomage.substack.com guides.

## 4. Experiments on the snapshot (this session)

Leave-one-out miss on the fit set, and a time split (fit on the older 70% by listing date, test on the newer 30%):

| Fit set and model | LOO miss | within x3 | time split miss (flat) |
|---|---|---|---|
| All 119 trading, size only | x3.50 | 43% | x4.01 (x5.00) |
| All 119, size + category k=8 (v2) | x3.43 | 48% | x3.60 (x5.00) |
| Clean 88, size + category k=8 | x3.25 | 48% | x3.34 (x4.30) |
| Clean 88, six broad families k=4 | x3.68 | 44% | x3.54 |
| Clean 88, families + chains | x3.50 | 47% | x3.54 |

"Clean" means the trading protocols that pass the watchlist rule (not wrapped, staked, bridged, exchange or versioned), so the comparables match the protocols being priced. Findings: cleaning the comparables helps a little (x3.43 to x3.25), broad families and chain count do not beat categories, and nothing beats about x3.2. The model stays; the set it fits on changes.

## 5. Design

### 5.1 Model (dashboard/model.js)
- Fit on the 88 clean comparables. The 31 trading protocols that fail the rule are shown as "traded, kept apart" with their ratio and the fitted curve's miss. The set-aside list of 145 pre-token protocols shows the rule that removed each one (bridge, staking, exchange, wrapped or staked name, version marker).
- Keep: size curve plus category offset (k=8), P25 to P75 band, growth and time tilts capped near 15%, labelled judgment.
- Add a time-split test and band coverage (share of comparables inside the band, in sample and in the time split).
- Add a bootstrap (200 refits, seeded) for a rank range per row.

### 5.2 Economics
- Costs: fees on the cheapest chain, 0.4% friction, and T-bill carry (4% a year over the hold), each named in the plan and the table.
- Add hands-on time per plan (setup, each active week, exit) and show net per hands-on hour.
- Add break-even value (the value at which net is zero) and break-even odds (the share of the band's historical misses at which the net stays above zero).
- Add reward per $1,000.
- Tiers: robust (net above zero at the band's low end), farm (above zero at the base, odds at least 50%), thin (above zero at the base, odds under 50%), skip.

### 5.3 Page
- First screen: a headline sentence, a three-line thesis, six figure cards (ranked, watchlist covered, comparables, set aside, blind miss vs flat, plans that pay by tier), the curve chart with the board's points and the formula with the fitted numbers.
- Verification badge: main.ts writes the board's rank, value and verdict into data.js from board.json; the page recomputes every row with model.js and shows "N of N rows match board.json" (a mismatch turns it red).
- Board columns: rank and rank range, protocol and family, TVL, 7d, no token for, band chart, implied value, break-even, reward per $1,000, net of all costs, per hour, tier, farm on (action, chain).
- Tabs: No token yet, Traded tokens (the comparables with misses), Set aside (with rules), Method and backtest.
- Detail drawer: keep the value build, the chart, nearest comparables and the farm plan; add the break-even and the hours.
- Controls: capital ($250, $500, $1,000, $5,000), farmer share (5%, 8%, 10%, 15%), chain, tier, family, minimum TVL, watchlist only.

### 5.4 Size and limits
The dashboard source must stay under 64 KB or the dossier cuts it (v2 is 51 KB). To fit the additions: drop the old "Already trading" tab (replaced by Traded tokens), shorten the farm-plan templates, and keep the CSS under 9 KB. No http or https address anywhere in the dashboard files. `board.json` rules unchanged. Three screenshots at 1440 pixels wide: the board with the first screen, a detail view, a filtered view.

### 5.5 Build order
1. model.js: clean fit, time split, coverage, bootstrap, economics, tiers, hands-on time. Test in Node against the figures in section 4.
2. main.ts: write the board digest into data.js. Gate checks as before.
3. Page: first screen, badge, columns, tabs, drawer.
4. Check the size, take screenshots, run the kit's `check`.
5. Commit, push to `radar-entry`, then resubmit once (today's quota has one entry left).

## 6. Risks

- The gain is uncertain. The judge compares pairs against fixed dashboards with a model that varies between calls, so a better page can still score within the noise. The v2 interval alone spans 3.3 points.
- The page must stay honest. The first-screen figures come from the same functions as the rows, and the farmer share stays a labelled assumption.
- More on screen can lower readability. The first screenshot is checked at 1440 pixels before it is kept.
