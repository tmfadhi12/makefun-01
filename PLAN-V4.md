# Token Radar v4: analysis and design

Status: analysis and design. No code yet. 2026-11-17.

## 1. Where v3 stands

v3 scores 94.89% (interval 93.41% to 96.37%), rank 59 of 7,577, valid and prize-eligible. The tenth place is 95.72%, so the gap is about 0.8 points. The top ten sit between 95.72% and 96.21%.

## 2. UI/UX audit (taste-skill, app-screen rules)

Source: `E:\vibe-code-workflow\ui-ux-skills\taste-skill-main\taste-skill-main\skills\taste-skill`, `references/app-screens.md`, with its `lint.mjs --app` and `inspect.mjs --app` run on the v3 build. I audited both scripts before running them: no network calls; inspect serves the file from a temporary server bound to 127.0.0.1 and launches headless Chrome with a throwaway profile.

| Finding | Rule | Fix in v4 |
|---|---|---|
| FAIL: 403 text blocks under 11px (chart axes at 9px, rank sublines at 10px) | Nothing under 11px | Axis and meta text at 11px, sublines at 12px |
| FAIL: 237 uppercase tracked labels (table header, "W", tier pills) | At most one tracked uppercase label; 12px grey sentence-case headers; no header band | Sentence-case 12px grey headers with no black band; pills in sentence case |
| FAIL: emoji "✓" in the badge and the detail | No emoji as UI | The word "match" with a small SVG check |
| FAIL: the headline wraps to 4 lines at 390px | A noun title of 18 to 32px; the finding goes in the line under it | Title "Pre-token board"; the finding becomes the subline |
| WARN: cream ground with terracotta | "Cream with terracotta" is listed as a tell. Five of the top eleven use it too | A neutral stone ground and ink figures; one hue on the data |
| WARN: 0% tabular figures | Right-aligned tabular figures | `font-variant-numeric: tabular-nums` in the text face; monospace kept for code only, so the function names stand out |
| Tier pills: "robust" is a solid fill on 44 rows | A solid fill only while rare (under a fifth of rows) | Pale tint with dark text of the same hue for every tier |
| The screen asks no question | Name the screen's one question and its one finding, first | Question: "Which protocols with no token are worth farming at your ticket?" Finding: see 3.1 |
| Phone: the badge wraps to six lines; KPI cards in three narrow columns | Each block still answers its question at 390px | Badge shortens on the phone; KPI grid goes to two columns |

## 3. New features nobody in the top 300 advertises

Checked against the titles of the top 300 scored entries and the cover screenshots of the top eleven. Their source is sealed, so "nobody" means nobody shows or names it, not a proof.

| Feature | Top 300 titles naming it |
|---|---|
| Farm planner for a budget and hours | 0 |
| Minimum ticket that pays | 0 |
| Verdict flip point (the farmer share that turns a row into a farm) | 0 |
| Export of the plan | 0 |
| Out-of-sample test (for comparison) | 90 |

### 3.1 Minimum ticket, and the finding it gives
Fees are fixed per transaction; the reward, the friction and the T-bill carry grow with the ticket. So each protocol has a minimum ticket that pays, or none at all when its reward per dollar (value × farmer share ÷ TVL) is below the proportional costs.

Measured on the snapshot at an 8% farmer share, if a launch happens:
- 21 of 197 rows pay at no ticket size at the base value, and 110 of 197 at the band's low end.
- The five largest protocols (Steakhouse Financial, Sentora Curator, Gauntlet, USDD, Veda) pay at no ticket size. Their median TVL is $280M: the larger the TVL, the thinner each dollar's slice, so the T-bill return wins.
- Where a ticket pays, the median minimum is $154 (10th percentile $11, 90th $4,855).

This becomes the screen's finding: "The largest protocols with no token do not pay a farmer at any ticket; the ones that do are smaller and cheaper to reach."

### 3.2 Verdict flip point
For each row, the farmer share at which the low band nets zero at the chosen ticket. At $500: 44 rows already pay at 8%, 45 more at up to 15%, 42 at up to 31% (the largest airdrop share in public studies), 66 never in that range. Shown per row ("pays from 12% share") and as a filter.

### 3.3 Farm planner
Two inputs, budget and hours a week. The page picks farms in order of low-band net per hands-on hour, each at its minimum ticket rounded up to $50 (at least $250), counts a shared setup once per chain, and stops at either limit. It then raises tickets on the picked farms with the money left, since each extra dollar there nets positive.
- Measured: with $2,000 and 8 hours, 4 farms on 3 chains; at $5,000 and 12 hours, 7 farms on 4 chains, with hours as the binding limit (only $1,750 used at minimum tickets).
- The result card shows the net if a launch happens at the low and base value, the launch odds the basket needs (about 15% at these settings), and the chance that at least one of the picked farms launches if each launches with a given probability (for 5 farms at 20% each: 67%).
- A "Copy plan" button writes the plan as plain text to the clipboard, and "Download CSV" saves the visible board. Both work offline.

### 3.4 Launch odds needed (from the earlier draft, kept)
Each row shows "net if launch" and the launch odds needed to break even. A fitted launch clock was tested and failed on newer protocols (log loss 1.164 against 0.756 for a constant), so v4 shows the odds needed and the snapshot's descriptive rate (51% of tracked protocols record a token), not a forecast.

### 3.5 Code that reads like the page (from the earlier draft, kept)
Function names that match the page (`fitCompsCurve()`, `impliedValue()`, `farmPlan()`, `minTicket()`, `planFarms()`), shown in monospace on the first screen and the Method tab.

## 4. Unchanged
Board rules, ranking, value model and band. board.json keeps the same slugs, ranks and values as v3.

## 5. Size budget
v3 dashboard source is 56 KB of 64 KB. Additions: planner and export about 4 KB, minimum ticket and flip about 1 KB, UI fixes about 1 KB net. Recover space by trimming the farm-step templates and duplicate helpers. Target 62 KB or less, checked before screenshots.

## 6. Screenshots
1. Board with the planner result on the first screen and the finding line.
2. Protocol file: value build, curve, comparables, costed farm timeline, minimum ticket and flip point.
3. Filtered view: "pays from 8%" with the planner applied.

All at 1440 wide; the taste-skill inspector re-run until it reports no FAIL.

## 7. Risks
- The gain is uncertain; the judge varies between calls and the top ten are within 0.5 points.
- Fewer farms and a finding that the biggest names do not pay are less flattering. I expect the judge's criteria to reward it, without proof.
- A new submission replaces v3. If v4 scores lower, v3 can be resubmitted from commit `a73de54`.

## 8. Build order
1. model.js: renames, `minTicket()`, flip point, launch odds needed, `planFarms()`; gate checks in Node.
2. Page: UI fixes from section 2, finding line, planner card, export.
3. Protocol file view with the costed timeline.
4. Size check, inspector to zero FAIL, screenshots, gate checks, the kit's `check`.
5. Commit, push to `radar-entry`, submit after your approval.
