# Incident Insight

A browser-based operations dashboard for ServiceNow incident exports. Drop in an
`.xlsx`, `.xls` or `.csv` export and it will:

- **Score documentation quality** for every incident across five dimensions.
- **Find recurring problems** by clustering incidents that describe the same
  underlying failure, and extract the root causes actually written down for each.
- **Run a weekly review** comparing the week against its recent baseline, with
  new vs. recurring problems and what moved.
- **Recommend where to act** — which problems need a problem record, which are
  automation candidates, and where the team disagrees about the cause.

Everything runs client-side — the spreadsheet never leaves the browser.

## Getting started

```sh
npm install
npm run dev          # http://localhost:8080
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | Run vitest in watch mode |
| `npm run lint` | ESLint over the repo |
| `npm run typecheck` | Type-check the app and the API functions |

## Expected columns

The parser reads either the ServiceNow display names or their snake_case
equivalents, so both export styles work:

| Display name | Field name |
| --- | --- |
| Number | `number` |
| Task type | `sys_class_name` |
| Priority | `priority` |
| State | `state` |
| Short description | `short_description` |
| Description | `description` |
| Work notes | `work_notes` |
| Assignment group | `assignment_group` |
| Assigned to | `assigned_to` |
| Opened | `opened_at` |
| Closed | `closed_at` |
| Channel | `contact_type` |
| Made SLA | `made_sla` |

Missing columns degrade gracefully — they score as empty rather than failing
the import.

## How scoring works

Each incident gets a 0–100 score, a weighted blend of five dimensions:

| Dimension | Weight | What it looks for |
| --- | --- | --- |
| Description quality | 25% | Length and specificity of the short description and body; auto-generated monitoring alerts get partial credit |
| Root cause | 25% | Root-cause phrasing anywhere in the description or human work notes (English and Spanish) |
| Steps documented | 20% | Resolution-action phrasing; a closed incident with none scores 0, an open one scores 30 |
| Spelling & grammar | 15% | Ratio of implausible words (repeated letters, vowel-less runs, long consonant tails) |
| Professionalism | 15% | Informal or filler language, and the share of work notes that are boilerplate |

The total maps to a label: **Excellent** ≥ 80, **Good** ≥ 55, **Poor** ≥ 30,
**Critical** below that.

Work notes are split into individual entries and classified as system- or
human-generated; only human notes count toward the noise ratio and note counts.

## Views

| View | What it answers |
| --- | --- |
| Overview | How healthy is the documentation, and how is the service performing? |
| Weekly Review | What changed this week, and what should I raise in the review? |
| Problems & RCA | What keeps recurring, why, and where should we act first? |
| Trends | How are quality and risk moving month over month? |
| Text Quality | Where specifically is the writing falling short? |
| All Incidents / By Agent / By Group | Drill-down and coaching |

## How problem detection works

Incidents are grouped into *problems* — sets of tickets describing the same
underlying failure — in three steps:

1. **Normalise.** Each short description is reduced to its significant terms:
   stopwords, punctuation, and per-instance identifiers (ticket numbers,
   hostnames, asset tags) are stripped, so `INC0012345 - user john.doe cannot
   reach VPN` and `VPN unreachable for remote users` share the terms that matter.
2. **Categorise.** A transparent keyword taxonomy (`src/lib/taxonomy.ts`) assigns
   a service category. It is a plain keyword map on purpose — you can read why a
   ticket landed in a bucket, and add a term when your environment words things
   differently.
3. **Cluster.** Incidents in the same category whose term sets overlap by at
   least 50% (Jaccard) join the same problem. An inverted index keeps this near
   linear; 20,000 incidents cluster in roughly 200ms.

Root causes are extracted by finding the sentence in the description or human
work notes containing a cause marker (`root cause`, `caused by`, `traced to`,
`se identificó`, …). Causes are then grouped across a problem's incidents, so
you see both *what* the recorded causes are and *how often* each one recurs.

**Root-cause coverage** — the share of a problem's incidents that document any
cause — is the number to watch. A problem with high volume and low coverage is
one the team keeps re-fixing without ever learning why.

### What the recommendations mean

| Recommendation | Trigger |
| --- | --- |
| Raise a problem record | High volume, under 50% root-cause coverage |
| Automation candidate | High volume, typically resolved in under two hours, well understood |
| Inconsistent diagnosis | Same symptom, 3+ competing causes, none dominant |
| Chronic recurring problem | Present in 3 or more separate weeks |

The volume bar scales with the dataset (1% of incidents, minimum 3), so a small
export still produces recommendations and a large one is not swamped by them.

## Exporting problems

**Exportar** on the Problems & RCA view downloads every problem the table is
showing; the same button in a problem's detail modal downloads just that
problem. Both export exactly the on-screen universe: the global month filter
plus the view's search, category and "Undocumented only" filters. The workbook
is built in the browser with SheetJS — nothing is uploaded.

| Sheet | Contents |
| --- | --- |
| `Problemas` | One row per problem, using the same values the dashboard shows. `Patrón` is `chronic` when the app flags the problem as chronic (3+ ISO weeks and 3+ incidents) and blank otherwise. |
| `Detalle` | One row per incident of those problems: problem id and title, every canonical field, category, week, resolution hours, score and dimensions, documented root cause, then every **unmapped source column** in its original order and with its original value. |
| `Metadatos` | Source file, export time, scope, filters and month range, problem and incident counts, scorer version (`src/lib/scorerVersion.ts`), truncated cells and unmapped columns. |

Dates (Opened, Closed, first/last seen, and unmapped date columns) are written
as real Excel dates shown `yyyy-mm-dd hh:mm:ss`, so Excel sorts, filters and
calculates with them. Each unmapped column is typed once from all its rows: a
column is a date when every value is an Excel date or ISO date text, and a
number when every value is an Excel number or plain decimal text. Text digits
under an identifier-like header (ID, number, code, key, ref) stay text, as do
values with leading zeros and mixed columns.

Cells longer than Excel's 32,767-character limit are truncated in the file only,
with a `[TRUNCADO …]` marker, and counted in `Metadatos`. For files over 10,000
rows the worker discards raw Description and Work notes to save memory; the
export then writes an explicit "No disponible" marker in those cells and says so
in `Metadatos`, rather than leaving them blank.

## Architecture

```
src/lib/parser.ts       Workbook reading, text cleanup, work-note splitting
src/lib/scorer.ts       Per-incident scoring across the five dimensions
src/lib/text.ts         Tokenisation and similarity used by clustering
src/lib/taxonomy.ts     Keyword map from incident wording to service category
src/lib/rootCause.ts    Cause markers, detection and sentence extraction
src/lib/problems.ts     Clustering, problem aggregation, recommendations
src/lib/periods.ts      ISO weeks, resolution times, duration formatting
src/lib/trends.ts       Weekly and monthly period aggregation
src/lib/weekly.ts       The weekly digest: baselines, movements, new vs recurring
src/lib/analytics.ts    Overview, dimensions, agent and group aggregation
src/lib/problemView.ts  Month and Problems-view filters shared by the UI and the export
src/lib/exportProblems.ts  XLSX export of problems (loaded on demand)
src/workers/            Web Worker that runs the above off the main thread
src/context/AppContext  Loaded dataset, month filtering, derived stats
src/pages/              Dashboard views
api/                    Optional serverless path for server-side processing
```

Clustering is corpus-level, so it runs **once** in the worker on upload and each
incident carries its cluster id. Filtering by month then only regroups by that
id, which keeps filter changes instant.

`src/lib` is the single source of truth for parsing and scoring. The worker and
the API functions both import from it — tune a keyword list or a threshold in
one place and every consumer picks it up.

### The `api/` directory

The dashboard does **not** call these endpoints; the browser worker handles
uploads of any size the tab can hold. They exist for an optional server-side
path and require `BLOB_READ_WRITE_TOKEN` to be set. If you are not using that
path, leave the variable unset — `/api/upload` returns a 500 rather than
issuing tokens.

`/api/upload` mints a short-lived client token scoped to a single upload; it
never returns the store credential itself. `/api/process` only accepts blob URLs
on `*.public.blob.vercel-storage.com`.

## Testing

```sh
npm test
```

The suite covers the scoring dimensions, work-note parsing and column
fallbacks, the aggregation helpers (including their behaviour on empty inputs),
problem clustering, root-cause extraction, ISO week bucketing and the weekly
digest. `src/bench/scale.test.ts` pins clustering cost at 20,000 incidents.

## Deploying to Vercel

The project is a standard Vite build; Vercel's Vite preset needs no extra
configuration. `vercel.json` only sets function limits for `api/`.

Environment variables:

| Variable | Needed when |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Only if you use the optional `api/` server-side path. Leave unset otherwise — `/api/upload` returns 500 rather than issuing tokens. |

Note that `api/process.ts` requests `maxDuration: 300`, which needs a Vercel
plan that permits it. Since the dashboard does not call these endpoints, you can
delete `api/` and its `vercel.json` entries if you never intend to use them.
