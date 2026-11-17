// Token radar entry for token-radar-01 (Node 22.18 or later, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json, prices every pre-token protocol with the model in
// dashboard/model.js (the same script the page runs), and writes /output/board.json, /output/data.js,
// /output/dashboard/, /output/screenshots/ and /output/dossier.json.
//
// Outside the grader, point it at local folders:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const Radar = createRequire(import.meta.url)('./dashboard/model.js');

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value after --name, or after --name=, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy the plain files of one folder into another, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|folder>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot: { protocols: unknown[]; watchlist: string[] };
try {
  snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
} catch {
  fail('snapshot.json is not JSON', 2);
}
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) fail('snapshot.json has no protocols or watchlist', 2);

interface Row { slug: string; rank: number; implied_value_usd: number; farm_steps: string[] }

/** Why a board would fail the gate, or null: the scorer's own rows, checked before anything is written. */
function boardIssue(rows: Row[], snap: { protocols: { slug: string }[]; watchlist: string[] }): string | null {
  if (rows.length < 100 || rows.length > 4000) return `the board has ${rows.length} rows, the gate takes 100 to 4000`;
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slug)) return `slug twice: ${r.slug}`;
    if (!known.has(r.slug)) return `unknown slug ${r.slug}`;
    seen.add(r.slug);
  }
  if (snap.watchlist.some((s) => !seen.has(s))) return 'the board misses a watchlist slug';
  if (rows.length - snap.watchlist.length < 60) return 'fewer than 60 rows outside the watchlist';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `rank ${i + 1} is ${r.rank}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has a bad implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd ? 'every row has the same implied value' : null;
}

const { model, rows } = Radar.buildBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

// board.json carries the ranked rows without the page's structured plan, which is rebuilt in the page.
const boardRows = rows.map(({ farm: _farm, ...row }: Record<string, unknown>) => row);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
// data.js hands the page the sealed snapshot and a digest of board.json, so the page can re-run the model
// and show how many of its rows match the file it sits beside.
const digest = rows.map((r: Record<string, unknown>) => [r.slug, r.rank, r.implied_value_usd, r.verdict, r.net_base_usd, r.rank_lo, r.rank_hi]);
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT=${JSON.stringify(snapshot)};\nwindow.BOARD=${JSON.stringify(digest)};\n`);
const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 (the board, a detail view, a filtered view)`, 1);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: use letters, digits and . _ -`, 1);

// The dossier goes last: the scorer rebuilds it from this folder and compares the bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const early = rows.filter((r: { on_watchlist: boolean }) => !r.on_watchlist).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows ranked (${early} early), priced off ${model.n} trading protocols\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
