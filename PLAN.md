# Token Radar: PRD and plan (token-radar-01)

Status: plan only. No code written yet. Version 0.1, 2026-11-16.

## 1. Goal

Hand in a token launch radar for the `token-radar-01` bounty: a dashboard that ranks DeFi protocols with no token by an implied value, and gives each one a concrete farm plan. The entry is judged pairwise by an AI model that reads three screenshots and the dashboard source. It does not run the page.

Winning means beating other entries on the judge's criteria, in order:

1. A working radar: the board covers the whole watchlist, states an implied value, and the screenshots match the code.
2. A value model derived from the snapshot's own figures (TVL, 7-day growth, time with no token), with no hardcoded protocol names, and a clear split between pre-token and live-token protocols.
3. Farm plans with concrete steps, each with a cost and a time.
4. A dashboard that is sortable, filterable, readable, with a detail view per protocol.
5. A page that looks designed: a chosen palette, consistent spacing, readable type, no pasted framework.

## 2. Hard constraints (the gate)

Taken from the kit's `RULES.txt`. Failing any of these makes the entry invalid and unpaid.

- `main.ts` at the repository root, Node 22, standard library only. It reads `/input/snapshot.json` and writes `/output/board.json`, the dashboard data, `dashboard/`, `screenshots/` and `dossier.json`.
- `board.json`: 100 to 4,000 rows. Each row has `slug`, `name`, `rank`, `implied_value_usd` and `farm_steps` (3 to 12 strings of 20 to 600 characters). Ranks run 1 to N once each. Implied value never rises as rank rises, and values are not all equal.
- Every watchlist slug appears. At least 60 rows come from outside the watchlist.
- `dashboard/` holds `index.html`, at least one `.css` and one `.js`. It uses no `http://` or `https://` address anywhere, and its source stays under 64 KB.
- `screenshots/`: 3 to 4 images, each 300 to 350 KB, long side at most 1440, short side at least 800. They show the board, a detail view and a filtered view, taken from the real page.
- `vendor/makefun-board.ts` is copied unchanged from the kit.
- `LICENSE` is MIT (present).
- Transcripts of the sessions that built the entry are uploaded. See section 6.

## 3. Starting point and what changes

The kit's starter is already a valid entry. It scores every pre-token protocol with one formula (`tvl x 0.25 x growth multiplier x maturity multiplier`) and gives generic farm plans. Entries that only copy it will lose to better ones, so the work is in four places:

| Area | Starter | Plan |
|---|---|---|
| Value model | One multiple for every protocol | A category-aware multiple, with chain breadth, growth, age and TVL stability as inputs. Every constant is shown on the page. |
| Pre-token vs live | Live protocols set aside | A visible split with the live set used to calibrate the multiples (market cap to TVL by category). |
| Farm plans | Generic text | Plans built per category and chain, each step with a cost and a time, generated from the row's fields. |
| Page | Basic board | Sort, filter by category and chain, search, detail panel, a method panel, and a deliberate palette. |

Rule for the value model: the same function scores every row. No protocol name appears in the logic.

## 4. Value model (draft)

Inputs per protocol: `tvl_usd`, `change_7d`, `listed_at`, `category`, `chains`.

1. Calibration. From protocols that already trade (`mcap_usd` present), compute the median market cap to TVL ratio per category. Categories with too few samples fall back to the overall median.
2. Base value: `tvl_usd x category_ratio`, shrunk toward the overall median when the category sample is small.
3. Growth adjustment: clamp `change_7d`, apply a bounded multiplier.
4. Age adjustment: older with no token raises the multiplier up to a cap (long-running, no token), unknown age uses a neutral value.
5. Chain breadth: a small bounded bonus for more chains.
6. Result: `implied_value_usd` as a whole positive number, ranked descending. Ties are broken by TVL then slug so ranks are stable.

Open question: how large the calibration shrinkage should be. To be tuned against the snapshot and recorded in the dashboard's method panel.

## 5. Farm plans (draft)

Each row gets 4 to 7 steps. A step names the action, its rough cost and its time, for example capital to deposit, gas, and weeks of activity. Steps vary with category (lending, DEX, perps, yield and so on) and with chain. The plan states that it is a guess, since the snapshot carries no airdrop data. Plans never promise a token.

## 6. Transcripts and eligibility

This is the largest risk, so it is checked first.

- The kit's `bundle` supports Kiro sessions (`--kiro-dir`). It collects sessions whose working directory belongs to the repository. The build sessions must run with the repo as the working directory.
- Step 1 of the build: run `node cli/makefun.mjs bundle --dry-run` against this repo and confirm a session is found. If none is found, work out how to run the build from a session inside the repo before writing code.
- Rules that apply: at least 5 assistant turns with text, at least 2 edits to the files that matter, at least 30% of counted lines accounted for by the sessions, every usage record priced to a known model, timestamps inside the competition window.
- From 17 Nov 2026 00:00 UTC, an entry needs a run record with the person's own opening prompt.
- Entries with handed-over sessions rank but take no paid place.

## 7. Dashboard and screenshots

- Static page, no network, no framework: `dashboard/index.html`, `app.css`, `app.js`, reading the data file `main.ts` writes.
- Views: board (sortable table), detail (value breakdown and farm plan), filtered view (category and chain filters), live-token set, method panel.
- Screenshots are taken from the real page with headless Chrome at 1440 wide, saved as JPEG or PNG and checked for size (300 to 350 KB each).

## 8. Build order

1. Dry-run `bundle` to confirm transcripts are readable.
2. Copy the starter and `vendor/makefun-board.ts`, run it on the kit's snapshot, and check the gate passes before changing anything.
3. Value model and calibration, with a test that checks the gate's board rules.
4. Farm plan generator.
5. Dashboard.
6. Screenshots and size check.
7. Run `grade-local` from the kit. Fix every failed row.
8. Commit, push, read the full sha with `git rev-parse HEAD`.
9. Build the bundle, submit, then poll the status and fix any rejection.

## 9. Not in scope

- No payments, no entry fee, nothing sent from the keypair except the entry signature.
- No network calls from the dashboard or from `main.ts`.
- No claims that a protocol will issue a token.
