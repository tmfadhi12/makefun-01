# Token Radar v2: analysis and design

Status: design for the second version. Written before the code. 2026-11-16.

## 1. Where v1 stands

v1 passes every gate row, but the judge compares entries in pairs against four fixed house dashboards. The public leaderboard (5,714 scored entries) shows the top ten between 95.6% and 96.2% win rate, a median of 87.0% and a lower quartile of 75.5%. Only the top ten are paid. v1 has no measured rate yet.

What the top entries advertise in their public titles: a value fitted on trading protocols ("comps") and tested out of sample, a band around the value, and farm plans netted to the dollar with a verdict (farm, thin or skip).

## 2. What the data says (analysis of the snapshot)

119 protocols record a token and are not exchanges. They are 119 different token families: no two share one, so there is no double counting of market caps.

Leave-one-out test (each protocol priced by a model fitted without it), error is the factor between model and market cap/TVL:

| Model | Median error | Within 2x | Within 3x |
|---|---|---|---|
| Flat median ratio | x4.94 | 30% | 34% |
| Size curve: ln(mcap/tvl) on ln(tvl) | x3.50 | 34% | 43% |
| Size curve + category offsets, shrink k=8 | x3.43 | 35% | 48% |
| Size + growth + age + chains (v1's inputs) | x3.5 to x3.8 | 27% to 32% | 47% |

Findings:

1. Size is the only input that earns its place out of sample. Slope about -0.53: a protocol 10x bigger trades at about 0.3x the ratio.
2. Category offsets help only when pulled hard toward the overall median.
3. Seven-day growth and time tracked show no out-of-sample signal. Their fitted slopes have the opposite sign to v1's assumption. Chain count has a coefficient of about zero.
4. The model's error is large (x3.4 median). A single number overstates what is known, so every row needs a band.
5. Farm reward is roughly `capital x airdrop share x (mcap/TVL ratio)`. TVL cancels out. Because the ratio falls with size, smaller protocols pay more per dollar of capital.

## 3. Design changes

### 3.1 One model for board and page
The model moves into `dashboard/model.js`, a plain script (UMD, no module syntax) that works in the browser from `file://` and in Node. `main.ts` loads it to write `board.json`, and the page loads it to draw everything. The judge reads it as source, and the page can show that its own recomputation equals `board.json`.

### 3.2 Value model
- Fit on trading protocols: ln(mcap/tvl) = a + b x (ln tvl - mean) + category offset (shrink k=8).
- Tilts for growth and time tracked, capped at -7.5%/+15% and -5%/+10%, shown on the page as judgment that the backtest cannot confirm. Chain count is dropped.
- Band: the 20th and 80th percentile of the leave-one-out errors, applied to every value (low, base, high).
- Backtest figures are computed by the page from the same data and shown in a strip at the top.

### 3.3 Farm economics, netted
Inputs the reader can change: capital (default $500) and the share of value paid to farmers (default 8%, an assumption).
- Reward = value x share x capital / TVL, shown at the low, base and high band.
- Costs: fees (transactions x fee per transaction on the cheapest chain), round-trip friction 0.2% of capital, and the cost of tying up capital at 4% a year for the hold.
- Net = reward - costs, at each band.
- Verdict: farm if net at the low band is above zero, thin if only base and high are, skip otherwise. Thresholds are shown on the page.
- Farm steps keep their cost and time, and add the netted figures.

### 3.4 Dashboard
- Header strip: backtest result against the flat ratio.
- Board: adds net and verdict columns, a verdict filter, and capital and share controls that recompute the page.
- Detail: value build, band, a scatter of the trading protocols with the fitted curve and this protocol marked, the nearest comparables, and the netted farm plan.
- Tabs: Board, Already trading, Method (with the backtest table and the assumptions).

### 3.5 Limits stated on the page
No airdrop data in the snapshot. The share paid to farmers and the chance a token launches are assumptions. Implied value is the entry's claim, never make.fun's.

## 4. Constraints

Dashboard source at most 64 KB in total (the dossier cuts past it). No http or https address in any dashboard file. `board.json`: 100 to 4000 rows, ranks 1 to N, implied value never rising with rank, every watchlist slug, at least 60 rows outside it, 3 to 12 farm steps of 20 to 600 characters. Three screenshots, 800 to 1440 pixels, under 512 KiB each. `vendor/makefun-board.ts` stays unchanged.

## 5. Build order

1. `dashboard/model.js` and a script that checks the gate rules on its output.
2. `main.ts` uses it. Compare against the leave-one-out figures above.
3. Dashboard page.
4. Screenshots from the real page, then the gate checks and the kit's `check`.
5. Commit and push to `radar-entry`.
