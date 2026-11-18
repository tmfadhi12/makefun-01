# Token Radar v6: where v5 stands and what is left

Status: analysis only. No code yet. 2026-11-18.

## 1. Where v5 stands

- Provisional rate 95.06% (interval 93.61% to 96.51%), rank 68 of 11,289 scored entries. Unchanged since 2026-11-17: the interval is 29k ppm wide, the width of an entry that has played all 20 dev games (12 games give about 64k), so the two extra scrutiny rounds have already run. The dev rate will not move again.
- The field rose: the 10th place went from 95.72% to 95.97% and the top from 96.21% to 96.52%. The gap to the 10th is 0.91 points.

## 2. How the payout is actually decided (RULES.txt, Heats)

- The dev rate is shown, never weighed. After the deadline, every final entry is screened: it goes on only if its interval high reaches the 40th-best interval low. That line is 93.90% today; v5's high is 96.51%, so **v5 already passes the screen**. About 2,000 entries pass it too.
- The shortlist is then judged afresh: 3 Swiss rounds against entries of similar rate, racing for entries near a prize boundary (48 to 96 games), then a playoff of the top 12.
- The final entry is the last one submitted before 2026-12-14 10:00 UTC. A weaker later entry replaces a stronger one, so any v6 that scores below v5 must be followed by resubmitting v5 (commit `c868ffd`).

## 3. What the current top entries show (cover screenshots of ranks 1, 4 and 7; their source is sealed)

| Feature | Seen in | v5 |
|---|---|---|
| An ablation table: each model term added in turn, with its leave-one-out miss, share within ×3, rank correlation and walk-forward miss, and which terms were kept | ranks 1 and 4 | three backtest rows on the Method tab |
| Band honesty: stated coverage against landed coverage for both P25–P75 (stated 50%) and P10–P90 (stated 80%), blind and on newer tokens | rank 1 | one band, coverage in a sentence |
| Launch tenure: the share of protocols that record a token, by age bucket, as context for the launch chance a plan needs | ranks 1 and 7 | one figure (51%) in a note |
| An accounting bar: 758 split into ranked, record a token, and each set-aside reason, as a stacked bar | rank 1 | a text stamp |
| Few farm plans pass (12, 29 and few) | ranks 1, 4, 7 | 44 robust, 85 farm |
| Live sliders for the stated assumptions (drop share, trend horizon, tenure floor) | rank 7 | dropdowns for ticket and share |

Correction to the v4 post-mortem: the leaders pass few plans too, so v4's drop is more likely its plain styling than its stricter verdicts.

## 4. Proposed v6 (ordered by expected value for the byte cost)

1. **Ablation table on the first screen**, computed by `compareModels()` from the existing `blindTest()` and `timeSplitTest()`: flat, size, + category, + growth tilt, + time tilt; columns LOO miss, within ×3, Spearman rank correlation, newer-token miss; a "kept" mark on the terms used. About 1.2 KB.
2. **Band calibration**: add the P10–P90 band and a small "stated vs landed" table for both bands, blind and on newer tokens. About 0.7 KB.
3. **Launch tenure panel**: the snapshot's share of protocols that record a token, by listed-at age (under 180 days, under 1 year, 1–2, 2–3, 3–4, 4+ years), labelled as a description, not a forecast. Each row's "launch chance needed" is shown against its age bucket's share. About 0.8 KB.
4. **Accounting bar**: a stacked bar of the 758 with each set-aside reason. About 0.4 KB.

## 5. The hard constraint: source size

The dashboard source is 64,880 bytes; the dossier shows it whole only below about 65,190. v6 needs about 3 KB of room. Candidate cuts, in order: the Method tab text (its content moves into the ablation table), the separate Traded tokens and Set aside tables (merged into one table with a reason column), and shorter farm-step templates. Code is never moved to a file the judge cannot read.

## 6. Risks

- The gain is uncertain. v3 → v5 gained 0.17 points; v4 lost 1.1. The judge varies between calls.
- A v6 that scores lower must be undone by resubmitting v5 before the deadline (3 entries a day).
- More panels on the first screen can crowd it; the first screenshot is checked at 1440 wide before it is kept.
