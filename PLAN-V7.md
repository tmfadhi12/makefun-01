# PLAN-V7

## 1. Why v7

Leaderboard on 2026-11-18 (11,618 entries): v6 scored 94.72% (interval 93.21 to 96.23, rank 124). The shortlist line (40th best interval low) is 94.00%, so v6 and v5 sit below it. Scores from rank 11 to 300 are within noise of each other; the dev score is a screen, the final heat is head to head.

The judge's five criteria, most important first: a working radar, the value model, farm plans (steps, cost, time), the page, the look. The top entries and v6 share the same model. The visible gaps are in criteria 3 to 5.

## 2. What the leaders do that v6 does not (observed from the public covers and the leaderboard)

| Gap | Evidence | v6 | v7 |
|---|---|---|---|
| Four screenshots | 41% of the top 100 use 4, against 19% of all tested entries | 3 | add `4-traded.png`, the traded-token tab (criterion 2: trading tokens kept apart) |
| Plan as a table with a day, a step, a cost and a time column, a stop rule and a verdict badge | ranks 1 and 3 | seven steps as a list, cost and time in small grey text | table with `When` column, a stop rule step, a "Worth farming" badge |
| Few plans marked farm | rank 1: 12 farm, 65 marginal, 121 skip | 44 robust, 85 farm, 33 thin, 35 skip | three tiers: farm (the net stays above zero in 80% of blind refits), marginal (60%), skip |
| Six headline numbers on the first screen | rank 1 | text paragraph | KPI strip: ranked, blind miss, band holds, farm count, best net per hour |
| Detail view opens with the money | ranks 1 and 3 | list of key-value rows | KPI strip (at risk, costs, time, net, launch chance needed) above the plan |

## 3. What v7 removes to pay for it (source cap: 65,536 bytes of dossier text, 65,190 of source)

- The spend-by-week chart (`timeline()`, about 3.4 KB). The table carries the same costs by day.
- The launch-tenure table and `launchTenure()` (about 2.1 KB). It described the snapshot and did not change a verdict.
- The three-figure strip in the build panel (replaced by the KPI strip).

Kept: the ablation table, the band-honesty table, the accounting bar, the planner, CSV export, rank ranges.

## 4. Rules

- The model, the curve, every implied value and every rank stay as in v6. Only the verdict labels, farm steps and the page change, so board.json changes only in `verdict` and `farm_steps`.
- The page re-runs model.js and checks every row against board.json, as before.
- Dashboard source must be shown whole in the dossier (gate row "source shown whole").
- Screenshots: PNG, 1440 wide, short side at least 800, at most 512 KiB, four files.
- Push to `radar-entry` only, as one command. Do not send the keypair.

## 5. Acceptance

- Gate passes every row, including "source shown whole".
- All four screenshots viewed, no overflow.
- `makefun check` shows 0 FAIL.
- Submit as v7. Dev score has a noise of about plus or minus 1.5 points: a single score does not prove v7 better than v6.
