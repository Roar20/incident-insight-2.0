# Incident Insight

A browser-based quality dashboard for ServiceNow incident exports. Drop in an
`.xlsx`, `.xls` or `.csv` export and it parses the work notes, scores each
incident's documentation quality across five dimensions, and aggregates the
results by agent, assignment group and month.

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

## Architecture

```
src/lib/parser.ts       Workbook reading, text cleanup, work-note splitting
src/lib/scorer.ts       Per-incident scoring across the five dimensions
src/lib/analytics.ts    Aggregation: overview, dimensions, agents, groups, trends
src/workers/            Web Worker that runs the above off the main thread
src/context/AppContext  Loaded dataset, month filtering, derived stats
src/pages/              Dashboard views
api/                    Optional serverless path for server-side processing
```

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
fallbacks, and the aggregation helpers — including their behaviour on empty
inputs, which previously surfaced as `NaN` in the UI.
