# Phase 0.5 — Ingestion & parsing bug fixes

Source of the bugs: `docs/APP_DISCOVERY.md` §17. Branch: `fix/ingestion-parsing-phase-0.5`
(from `ccr-4a779a2a-juiamt`; not merged into `main`).

Scope rules followed:
- Ingestion and parsing only. **No rule, weight or threshold in `scorer.ts` was changed** (`git diff da66a89 -- src/lib/scorer.ts` is empty).
- Each bug: failing test first → minimal fix → test passes → one commit.
- The "auto-closure text counts as a root cause" bug (F-06) is **not fixed**. It is documented below as a scorer v2 proposal with its estimated impact.

## 1. Commits

| Commit | Bug | Content |
|---|---|---|
| `43b5df9` | — | Snapshot generator `scripts/baseline.ts` + `docs/baseline_before.json` (generated **before** any fix) |
| `78c87b2` | F-01 encoding | Explicit decoding of text exports (UTF-8, falling back to Windows-1252) |
| `71be339` | F-02 BOM/Number | **No code change.** Correction to the discovery report: the BOM trigger was a false positive (see §3.2) |
| `d4c5a9f` | F-03 Made SLA | `Made SLA` missing → `null` (unknown), and SLA % only over incidents that record it |
| `6aa67ce` | F-04 dd/mm dates | Parsing of day/month text dates + raw reading of CSV |
| `6fc8651` | F-05 work notes | Journal splitting by header on its own line, for any journal type |


## 2. Method

- **Dataset**: `scripts/baseline.ts` generates 120 synthetic incidents (fixed seed `20250301`; EN/ES text; 12 problem templates; system notes, boilerplate, documented causes, the auto-closure text; states Closed/Resolved/In Progress/New/Canceled; Jan–Mar 2025). It renders them into **8 export variants**:

  | Variant | Format | Triggers |
  |---|---|---|
  | `control_xlsx` | XLSX, display headers, ISO dates, Made SLA, Work notes only | **none** (must not change) |
  | `csv_utf8` | UTF-8 CSV without BOM | F-01 |
  | `csv_utf8_bom` | UTF-8 CSV with BOM | F-02 (BOM) |
  | `xlsx_no_made_sla` | XLSX without the `Made SLA` column | F-03 |
  | `xlsx_ddmm_text` | XLSX with dd/mm/yyyy text dates (Opened, Closed, note headers) | F-04, F-05 |
  | `csv_ddmm` | UTF-8 CSV with dd/mm/yyyy dates | F-01, F-04, F-05 |
  | `xlsx_mixed_journal` | XLSX with `(Additional comments)` entries interleaved | F-05 |
  | `csv_combined_snake` | CSV with BOM, snake_case, dd/mm, no Made SLA, mixed journal | worst case |

- **Pipeline**: the same one the worker runs (`readIncidentRows` → `inferDateOrder` if it exists → `enrichRow` → `scoreIncident` → `annotateIncidents` → aggregations). The script is identical before and after.
- **Snapshot**: per-incident score (and the score All Incidents would show through its `Number` join), % without root cause, RCA coverage, counts per category, SLA (overall, by category and by month), months/weeks with a date, note counts, and mojibake.
- **Attribution**: besides `before`/`after`, an intermediate snapshot was taken after each commit (not versioned) to attribute every difference to one fix.
- **Real browser**: since the tests run under jsdom, the encoding and date cases were verified in **real Chromium** (same SheetJS build, `File.arrayBuffer()` → `XLSX.read` path). The fixed app was also tested end to end in Chromium (§5).
- **Real file**: none was provided, so every number here is synthetic. To include one: `npx vite-node scripts/baseline.ts docs/baseline_after.json "label" path/to/export.xlsx` adds it under `realFiles`.

Regenerate:
```sh
npx vite-node scripts/baseline.ts docs/baseline_after.json "after Phase 0.5 ingestion fixes"
```

## 3. Bugs

### 3.1 F-01 — UTF-8 CSV read as Latin-1 (mojibake) — **FIXED**
- **Cause**: SheetJS interprets BOM-less text as Latin-1. `Contraseña` → `ContraseÃ±a`, so every keyword with an accent (`causa raíz`, `se identificó`, `solución`, `contraseña`…) stopped matching. Reproduced in Chromium.
- **Fix** (`parser.ts › readWorkbook`): if the file is not zip (xlsx), OLE2 (xls) or UTF-16 with BOM, it is decoded with `TextDecoder('utf-8', {fatal:true})`, falling back to `windows-1252` (the encoding Excel uses for "CSV (comma delimited)"), and passed to SheetJS as a string. `api/process.ts` now uses the same function.
- **Tests**: `CSV text encoding` (UTF-8 without BOM → failed before; with BOM and Windows-1252 → regression guards).

### 3.2 F-02 — "CSV with BOM loses the `Number` column" — **FALSE POSITIVE, no fix**
- In real Chromium a UTF-8 BOM CSV reads correctly (`Number` intact, accents intact). The Phase 0 result only occurs under **jsdom**: there a `TextEncoder` buffer belongs to another realm, fails `instanceof ArrayBuffer`, and SheetJS takes a path that ignores the BOM. `File.arrayBuffer()` in the browser does not have this problem.
- There was no real failing test to write. The BOM case is left as a **guard test** (it passes before and after), and the new tests use same-realm buffers so they don't inherit the artifact.
- `APP_DISCOVERY.md` was corrected (commit `71be339`).
- **Still open, outside ingestion**: if `Number` is missing, empty or duplicated, scores collide in the `Number`-keyed join (`AllIncidentsPage`, `analytics`, `AppContext.filteredScores`). Fixing it means changing the join in several layers. **Pending your decision.**

### 3.3 F-03 — missing `Made SLA` ⇒ 100% breach — **FIXED**
- **Cause**: `toBool('')` → `false`, so every closed incident counted as a breach.
- **Fix**: `Made SLA: boolean | null`. A missing column or blank cell → `null`. Breach % = breached / closed **with a known value**; if there are none → `null`, which the UI already rendered as "—". Touches `parser.ts`, `problems.ts` (clusters and categories), `trends.ts` (and therefore the weekly view) and `OverviewPage.tsx`.
- **Tests**: parser (`null` for missing/blank, `false`/`true` preserved) + clusters, categories and periods (`null` with no data; mixed data counts only the known values).
- **Semantic note**: a blank cell is now "unknown". In an export that *does* include the column, only empty cells are excluded from the denominator.

### 3.4 F-04 — dd/mm dates — **FIXED (Opened/Closed)**
- **Cause**: (a) text such as `13/03/2025` was not parsed, so the incident had no month, week or resolution time and silently dropped out of filters, trends and the weekly view. (b) In CSV, SheetJS converted `04/03/2025` to **April 3** (US) before the parser saw it. Both reproduced in Chromium.
- **Fix**:
  - Text exports are read with `raw: true` (SheetJS no longer interprets dates).
  - `normalizeDate` understands `D/M/Y` with `/ - .` separators, optional time, optional seconds and AM/PM, normalised to `YYYY-MM-DD HH:MM:SS`. Impossible dates (`31/02/2025`) and unknown formats are left as they are. ISO and Excel serials are not touched.
  - `inferDateOrder(rows)` decides day/month order **per file**: a first number > 12 ⇒ dmy; a second > 12 ⇒ mdy; majority wins; **no evidence ⇒ dmy**. The worker and `api/process.ts` decide it once per file (the API with a first pass over the chunks).
- **ASSUMPTION**: the default for a file whose dates are *all* ambiguous (day ≤ 12) is **dd/mm**, based on your report. If your exports could be mm/dd, it only takes one date with a day > 13 for detection to switch to mdy.
- **Side effect (positive)**: before, CSV ISO dates went through a floating-point serial and **lost one second** on 16/120 incidents (`07:48:00` → `07:47:59`). Reading raw removes that.
- **Not covered**: dates with month names (`4-Mar-2025`) and 2-digit years remain unparsed.
- **Tests**: `day/month text dates` (dd/mm, ambiguity with an explicit order, 12-hour clock, file-level inference, CSV end to end, plus a guard for ISO/unrecognised/impossible dates).

### 3.5 F-05 — work-note splitting — **FIXED**
- **Cause**: the regex only recognised `<ISO> - <author> (Work notes)` and let the author span lines. Effects:
  1. `(Additional comments)` entries were swallowed into the next author's name, or lost;
  2. **journals with dd/mm timestamps were not split at all**: the whole field became one note by "Unknown", and **system notes were no longer filtered out**;
  3. a timestamp quoted inside a body **truncated** that note's text.
- **Fix** (`parser.ts › parseNotes`): a header is `<timestamp> - <author> (<any journal>)` **on its own line**. The timestamp may be ISO or D/M/Y with an optional 12-hour clock; the author is a single line (parentheses in the name are allowed). Each body runs up to the next header. System detection is unchanged.
- **Semantic decision**: `Additional comments` entries are kept as notes (human unless they are from System or match system phrases). Before, their text was lost inside the author name.
- **Tests**: `work-note journal splitting` (mixed journals, single-line authors, dd/mm and AM/PM timestamps, a quoted timestamp in the body, plus a guard for authors with parentheses).

## 4. Before / after (synthetic dataset, 120 incidents per variant)

`docs/baseline_before.json` vs `docs/baseline_after.json`. "Δ score" = incidents whose `totalScore` changed.

| Variant | Changed by | Δ score | Before → After (metrics that moved) |
|---|---|---|---|
| `control_xlsx` | — | 0/120 | **Identical** after every commit (regression check) |
| `csv_utf8` | F-01 (+F-04 seconds) | 33/120 | mojibake 47→0 rows · avg 70.9→78.8 · no RC 37.5%→25.8% · RCA 62.5%→74.2% · Account & Access 10→20 (10 had fallen into Other because of `ContraseÃ±a`) · labels Poor 24→9 · = control |
| `csv_utf8_bom` | F-04 (seconds only) | 0/120 | Unchanged except 16 `Opened` values recover their lost second. Confirms F-02 was not a bug |
| `xlsx_no_made_sla` | F-03 | 0/120 | SLA breach **100% (81/81) → null ("—")**. Scores unchanged |
| `xlsx_ddmm_text` | F-04, F-05 | 78/120 | with month/week 0→120 · resolution time 0→81 · months `[]`→Jan/Feb/Mar (= control) · notes human/system/unknown 120/0/120 → 217/120/0 · avg **82.3→78.8** (= control) |
| `csv_ddmm` | F-01, F-04, F-05 | 87/120 | with month 46→120; before, 46 dates were **inverted** and spread over 12 months (Jan–Dec 2025); now Jan/Feb/Mar = control · resolution 28→81 · mojibake 47→0 · no RC 37.5%→25.8% · notes 120/0/120 → 217/120/0 · avg 79.4→78.8 (= control) |
| `xlsx_mixed_journal` | F-05 | 26/120 | authors spanning several lines 60→0 · human notes 217→277 (+60 recovered comments) · avg 78.8→79.3 · Excellent 72→73 |
| `csv_combined_snake` | F-03, F-04, F-05 | 84/120 | months 12 wrong → 3 correct · resolution 28→81 · SLA 100%→null · notes 120/0/120 → 277/120/0 · avg 82.6→79.3 (= `xlsx_mixed_journal`) |

How to read it:
- **After the fixes, every variant with the same content converges to the control** (or to `xlsx_mixed_journal` when it has extra comments). That is the expected outcome: the file format no longer changes the result.
- **The score was *inflated* in dd/mm exports** (82.3 vs 78.8). With no splitting, the journal was a single "human" note that included the system text; there was no noise ratio, and the system text added length. The fix brings it back to the real value.
- **F-05 raises the score slightly in mixed journals** because it recovers notes that were being lost. This is not a scorer change; the scorer now receives the correct notes.
- `recurringProblems` (12) and the counts per category (except F-01) do not change in any variant.

## 5. End-to-end verification in Chromium

App running (Vite dev) with the fixes. Upload of a CSV **UTF-8 without BOM + dd/mm dates + no `Made SLA` + Work notes/Additional comments/System journal**:
- Month filter: `Jan 2025 · Feb 2025 · Mar 2025` (`04/02/2025` → February, not April).
- SLA Breached: `—`. Median Time to Resolve: `1.4h` across 2 resolved incidents (correct).
- IncidentModal: `Contraseña bloqueada…` with no mojibake; 2 human notes (the Work notes entry and the Additional comments entry) with their authors and dd/mm timestamps; system note excluded; Root Cause 100 (`Se identificó que la causa raíz…`).
- No `pageerror`s.

## 6. Proposal (NOT applied) — scorer v2: auto-closure text as a root cause (F-06)

**Bug**: `"This incident will be closed due to has been completed"` contains `due to`, a marker in `ROOT_CAUSE_KW`. An incident whose only "cause" is that automatic text scores `root_cause = 100`, and `extractRootCause` returns it as the cluster's "documented cause".

**Proposed fix** (minimal, for scorer v2):
1. In `scorer.ts › scoreIncident`, remove the template from `combined` before evaluating `ROOT_CAUSE_RE`:
   `combined.replace(/this incident will be closed due (yo|to) has been completed/gi, '')`.
2. Apply the same cleanup to the text passed to `extractRootCause` in `problems.ts › annotateIncidents`, so the score and RCA coverage stay consistent.
3. (Broader option, not estimated) exclude every human note matching `NOISE_PATTERNS` from the evidence for root cause and steps.

**Estimated impact** (simulated in `baseline_*.json › variants.*.autoCloseRootCauseProposal`, without touching the scorer):

| Metric | Today | With v2 | Δ |
|---|---|---|---|
| Incidents containing the template | 20/120 (16.7%) | — | — |
| Incidents that lose their root cause | — | 18/120 | −15.0% of incidents |
| % without root cause (scorer) | 25.8% | **40.8%** | **+15.0 pp** |
| RCA coverage (`rootCauseText`) | 74.2% | 59.2% | −15.0 pp |
| Average score | 78.8 | ≈75.1 (estimated) | each affected incident −25 points (weight 0.25 × 100) → −18×25/120 ≈ −3.75 |

- 2 of the 20 incidents keep their root cause because they have another real marker in the text.
- **Caution**: the synthetic rate (template on ~35% of closed incidents with no cause) **is mine and arbitrary**, so the magnitude is not a forecast. On real data: Δ pp = 100 × (incidents whose *only* marker is the template) / N. **Real impact: UNKNOWN** until it is run on an export of yours (the generator already accepts files).
- Expected side effects of v2: more "No root cause documented" feedback, some labels drop (Good→Poor), and more clusters may trigger the "Raise a problem record" recommendation (rcaCoverage < 50).

## 7. Residual items and new findings (not fixed)

| ID | Description |
|---|---|
| F-02 (residual) | Empty, missing or duplicated `Number` → scores collide in the join. A join issue, not ingestion. **Needs a decision.** |
| F-25 (new) | XLSX cells stored as real dates (Excel serials) still go through float arithmetic in `normalizeDate`. They can lose one second, and at `00:00:00` that would shift the day, week or month. Seen in CSV before F-04 (16/120); not observed in this dataset's XLSX because it uses text dates. |
| F-04 (limit) | Dates with month names (`4-Mar-2025`) and 2-digit years remain unparsed. |
| F-06 | Scorer v2 proposal (§6), pending your decision. |
| Env | Dev server: `vite.config.ts` uses `host: "::"`, which fails in environments without IPv6 (`EAFNOSUPPORT`). It was overridden on the command line; the config was not changed. |

## 8. Final state

- Tests: **96/96** (77 before + 19 new). Typecheck (app + api): clean. ESLint: the same 14 pre-existing issues (3 errors, 11 warnings), none new.
- `scorer.ts`: unchanged.
