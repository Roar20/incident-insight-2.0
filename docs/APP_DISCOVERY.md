# APP DISCOVERY — Incident Insight 2.0

> **Phase 0 — Discovery / reverse engineering.** This document describes what the
> application does **today**, derived only from the code, the tests and the git
> history. It does not propose features or fixes.
>
> - Snapshot: commit `78937ea` (branch `ccr-4a779a2a-juiamt`), 4 commits in total.
> - Method: full read of `src/lib`, `src/workers`, `src/context`, `src/pages`,
>   `src/components` (excluding generic shadcn primitives) and `api/`. The test
>   suite was run (77/77 green), along with *probes* (throwaway scripts) on a copy
>   of the repo outside the working tree to confirm behaviour. No repository file
>   other than this one was modified.
>
> **Labels:** `FACT` (confirmed in code/data/execution) · `DERIVED` (conclusion
> drawn from several pieces of evidence) · `ASSUMPTION` (needs validation) ·
> `UNKNOWN` (cannot be determined).
> Evidence is cited as `file:line` or `file › function`.

---

## 1. Executive Summary

1. **FACT** — 100% client-side SPA (Vite + React 18 + TS). The file is parsed, scored and clustered in a **Web Worker** (`src/workers/scoringWorker.ts`); there is no backend, database, LLM or persistence. Reloading the page loses the dataset.
2. **FACT** — The whole domain lives in `src/lib` as pure functions (parser → scorer → annotate/cluster → aggregations). The UI consumes it through a single React Context (`src/context/AppContext.tsx`), which is the only global state.
3. **FACT** — The canonical model (`EnrichedIncident`) has **13 source columns**, each with exactly 2 hard-coded aliases (display name / snake_case). There is no column validation, no detection of unknown columns, and no Close notes, Resolved, CI, Business Application, Service, Service Offering or Opened by fields.
4. **FACT** — **Assignment Group** is a *grouping dimension* (aggregations, charts) and a *local filter* in All Incidents. It is not an entity, hierarchy, key or global filter, it is not normalised (no trim or case folding), and it does not affect the score.
5. **FACT** — "**Noise**" in the app means *boilerplate in human work notes* (`noiseRatio` in `scorer.ts`), not alert noise. Monitoring alerts are detected by two other independent mechanisms (`isAutoDesc` and the "Monitoring Alerts" category) that are never cross-referenced.
6. **FACT** — The scorer is deterministic and rule-based: 5 dimensions with weights 25/25/20/15/15 and labels at ≥80/≥55/≥30. **No Python** scorer exists in the repo or its history, so a TS-vs-Python comparison is **UNKNOWN**.
7. **FACT** — The only global time filter is **month by `Opened`**. **Trends** and **Weekly Review** ignore it (by design), and the sidebar's global quality filter only applies to *All Incidents* and *By Agent*.
8. **FACT** — **No exports exist** (CSV, Excel, JSON or other). `api/` returns JSON but the frontend never calls it.
9. **FACT** — There are **no datasets** in the repo or its history. Test data is synthetic and defined inline in the tests. No real ServiceNow extracts are versioned.
10. **FACT** — The probes confirm significant ingestion bugs: **UTF-8 CSV → mojibake**, **CSV with BOM → `Number` column lost (all scores collide)**, **missing `Made SLA` → 100% SLA breach**, **dd/mm dates either discarded or read as mm/dd**, and **work notes with other journal types are mis-split**. See §17.

---

## 2. Architecture Map

### 2.1 Stack — FACT (`package.json`)
| Layer | Technology |
|---|---|
| Build / dev | Vite 5 (`vite.config.ts`, port 8080, alias `@`→`src`) |
| UI | React 18, Tailwind + shadcn/ui (50 primitives in `src/components/ui`), framer-motion, lucide-react |
| Charts | Recharts 2.15 |
| Tables | Hand-written HTML; `@tanstack/react-virtual` only in All Incidents |
| Excel/CSV parsing | SheetJS `xlsx` 0.18.5 |
| State | React Context (`AppContext`), no Redux/Zustand |
| Routing | react-router v6 with a single route `/` (internal navigation via `currentPage` in the Context) |
| Tests | Vitest 3 + jsdom (`vitest.config.ts`) |
| Optional server | Vercel Functions (`api/upload.ts`, `api/process.ts`) + `@vercel/blob` |

### 2.2 Layers and responsibilities

```
┌────────────────────────────────────────────────────────────────────────┐
│ PRESENTATION   src/pages/*  src/components/{Upload,Dashboard,Sidebar,  │
│                MonthFilter,IncidentModal,ProblemModal}                 │
│                components/ui/dashboard-primitives (KPI, badges, bars)  │
├────────────────────────────────────────────────────────────────────────┤
│ STATE / ORCH.  src/context/AppContext.tsx                              │
│                - starts the Worker, stores the result                  │
│                - month filter → filtered* (useMemo)                    │
│                - weekly/monthly trends over the whole dataset          │
├────────────────────────────────────────────────────────────────────────┤
│ OFF-THREAD     src/workers/scoringWorker.ts                            │
│                read → enrich → score → (trim) → annotate → aggregate   │
├────────────────────────────────────────────────────────────────────────┤
│ DOMAIN (pure)  src/lib/                                                │
│  parser.ts     reading, aliases, text cleanup, work-note splitting     │
│  scorer.ts     5 dimensions, weights, labels, noiseRatio               │
│  rootCause.ts  cause markers (shared by scorer + problems)             │
│  text.ts       tokenisation, stopwords, Jaccard, normalisedKey         │
│  taxonomy.ts   keyword → category regex                                │
│  problems.ts   annotateIncidents (clustering), clusters, categories,   │
│                recommendActions                                        │
│  periods.ts    timestamp parsing, ISO weeks, resolutionHours           │
│  trends.ts     per-week/month aggregation                              │
│  weekly.ts     weekly digest (baseline, movements, new/recurring)      │
│  analytics.ts  overview, dimensions, feedback, agent, group, buckets,  │
│                parseMonthKey                                           │
├────────────────────────────────────────────────────────────────────────┤
│ OPTIONAL SERVER api/upload.ts (Blob token), api/process.ts (parse+     │
│                score on the server) — NOT called by the frontend       │
└────────────────────────────────────────────────────────────────────────┘
```

- **Entry points** — FACT: `index.html` → `src/main.tsx` → `App.tsx` (providers: QueryClient, Tooltip, **AppProvider**, Toasters, Router) → `pages/Index.tsx`, which shows `UploadScreen` until `loaded`, and then `Dashboard`. `Dashboard.tsx` is a `switch(currentPage)` over 8 pages.
- **Types / models** — FACT: `RawIncident`, `NoteEntry`, `EnrichedIncident` (`parser.ts:3-32`); `AnnotatedIncident`, `ProblemCluster`, `CategoryStat`, `ProblemAction` (`problems.ts:17-87`); `IncidentScore`, `DimScores` (`scorer.ts:4-22`); `OverviewStats`, `DimStats`, `FeedbackItem`, `AgentStat`, `GroupStat` (`analytics.ts`); `PeriodTrend` (`trends.ts`); `WeeklyDigest`, `CategoryMovement` (`weekly.ts`).
- **Tests** — FACT: 6 files, 77 tests. `parser`, `scorer`, `analytics`, `problems` (which also covers text, rootCause, taxonomy and periods), `weekly` (trends + digest) and `bench/scale.test.ts` (20k incidents, clustering in about 240 ms in this run).
- **Example datasets** — FACT: none (see §13).

---

## 3. Data Flow

### 3.1 Main path (browser) — FACT

```
[User] drop/select .xlsx/.xls/.csv
   │  UploadScreen.tsx › handleFile → loadFile(file, name)
   ▼
AppContext.tsx › loadFile                                   (main thread)
   │  file.arrayBuffer() → new Worker(scoringWorker.ts) → postMessage({buffer,name},[buffer])
   ▼
scoringWorker.ts › onmessage                                 (worker)
   ├─ 1. parser.ts › readIncidentRows(buffer)
   │       XLSX.read(type:'array', dense) → FIRST SHEET ONLY
   │       sheet_to_json({defval:''}) → IncidentRow[] (keys = literal headers)
   ├─ 2. for each row (in chunks of 500, progress messages):
   │     a. parser.ts › enrichRow(row) → EnrichedIncident
   │          col() aliases · cleanText · parseNotes(work notes) → allNotes/humanNotes
   │          normalizeDate(Opened/Closed) · toBool(Made SLA) · isAutoDescription
   │     b. scorer.ts › scoreIncident(incident) → IncidentScore
   │     c. if >10,000 rows: clears 'Work notes', Description, allNotes
   ├─ 3. problems.ts › annotateIncidents(incidents)  (MUTATES in place)
   │       + category (taxonomy) + rootCauseText (rootCause) + resolutionHours
   │       + week (ISO, Opened) + isClosed + clusterId (greedy Jaccard clustering)
   ├─ 4. analytics.ts › computeOverview / computeDimStats / computeFeedback /
   │       computeAgentStats / computeGroupStats  (over the whole dataset)
   └─ 5. postMessage({type:'result', payload: WorkerResult})
   ▼
AppContext.tsx › worker.onmessage('result')
   │  availableMonths ← parseMonthKey(inc.Opened)
   │  availableWeeks  ← weekly.ts › availableWeeks (inc.week)
   │  selectedWeek    ← last week present; currentPage='overview'
   ▼
AppContext derived state (useMemo)
   ├─ filteredIncidents  = incidents whose parseMonthKey(Opened) ∈ selectedMonths
   ├─ filteredScores     = scores whose number ∈ Numbers(filteredIncidents)
   ├─ filteredOverview/DimStats/Feedback/AgentStats/GroupStats (recomputed only if month filter is active)
   ├─ filteredProblems   = problems.ts › computeProblemClusters(filtered…)   (minCount 2)
   ├─ filteredCategories = computeCategoryStats(filtered…)
   ├─ filteredActions    = recommendActions(filteredProblems, n)
   └─ weeklyTrends / monthlyTrends = trends.ts › computePeriodTrends(ALL incidents)
   ▼
Pages (src/pages/*) → Recharts / tables / KPIs / modals
   └─ WeeklyPage computes weekly.ts › computeWeeklyDigest(ALL incidents, scores, selectedWeek) locally
   ▼
EXPORT: does not exist (§12)
```

### 3.2 Step by step

| # | File › function | Input | Output | Transformation | Dependency for the next step |
|---|---|---|---|---|---|
| 1 | `UploadScreen.tsx › handleFile` | `File` | call to `loadFile` | none (the size check is commented out, lines 10-13) | — |
| 2 | `AppContext.tsx › loadFile` | `File` | `ArrayBuffer` transferred to the Worker | terminates any previous worker | worker receives the buffer |
| 3 | `parser.ts › readIncidentRows` | `ArrayBuffer` | `IncidentRow[]` | SheetJS, **first sheet**, empty cells → `''` | keys = literal header text |
| 4 | `parser.ts › enrichRow` | `IncidentRow` | `EnrichedIncident` | aliases, `String()`, cleanup, note splitting, dates → `"YYYY-MM-DD HH:MM:SS"` string (if numeric), bool SLA | the scorer needs `*Clean`, `humanNotes`, `State`, `isAutoDesc` |
| 5 | `scorer.ts › scoreIncident` | `EnrichedIncident` | `IncidentScore` (`number` = `incident.Number`) | 5 dimensions → weighted total → label | joined back to the incident **by `Number`** |
| 6 | `scoringWorker.ts` (trim) | incident | incident | >10k rows: clears raw fields | the modal uses `descClean`/`humanNotes` (preserved) |
| 7 | `problems.ts › annotateIncidents` | `EnrichedIncident[]` | `AnnotatedIncident[]` (same array) | category, root cause, resolution time, ISO week, isClosed, clusterId | `clusterId` is fixed for the whole session |
| 8 | `analytics.ts › compute*` | incidents + scores | aggregated stats | means, counts, buckets | "unfiltered" state in the Context |
| 9 | `AppContext` useMemos | state + `selectedMonths` | `filtered*` | month filter by `Opened`, re-aggregation | pages read `filtered*` |
| 10 | `pages/*` | Context | DOM | some local aggregations (Overview ops, Problems totals) and local filters | — |

### 3.3 Server path (optional, not wired up) — FACT
`api/upload.ts` issues a Vercel Blob client token (≤150 MB, xlsx/xls/csv). `api/process.ts` downloads the blob (only `*.public.blob.vercel-storage.com`), reads it in chunks of 5,000 rows with an explicit header, runs `enrichRow` + `scoreIncident` + the `analytics` aggregations, deletes the blob and returns JSON. It **does not call `annotateIncidents`**, so incidents come back without `category`, `clusterId`, `week` and the other annotations. **No file in `src/` calls `/api/*`** (grep `api/` in `src` = 0), and the README confirms this.

---

## 4. Canonical Incident Model

Source: `parser.ts › RawIncident/EnrichedIncident/enrichRow`, `problems.ts › AnnotatedIncident/annotateIncidents`, `scorer.ts › IncidentScore`.
"Required" here means *required for the feature to make sense*. **No column is technically required**: a missing column becomes `''`/`false` and the import never fails (FACT, `parser.ts › col` returns `''`).

### 4.1 Source fields

| Field (model) | Req/Opt | Source column (aliases) | Derived? | Used by |
|---|---|---|---|---|
| `Number` | Opt (de facto **join key**) | `Number`, `number` | No (`String()`) | score↔incident join everywhere (`scoreMap` in analytics, problems, trends, AllIncidents, AppContext.filteredScores); display; search; `sampleNumbers` |
| `Task type` | Opt | `Task type`, `sys_class_name` | Default `'Incident'` | **nobody** (only the model and tests) — DERIVED |
| `Priority` | Opt | `Priority`, `priority` | Partial mojibake repair (`parser.ts:146-150`) | `IncidentModal` (header); `analytics › computePriorityDist` (**not used by any page**) |
| `State` | Opt | `State`, `state` | No | scorer (steps: exact match `closed`/`resolved`); `annotateIncidents.isClosed` (substring `closed`/`resolved`); Overview "Incidents by State"; AllIncidents filter/column; IncidentModal |
| `Short description` | Opt (key for clustering) | `Short description`, `short_description` | → `shortDescClean` | scorer (description), taxonomy (priority 1), clustering signature, cluster title, search, tables |
| `Description` | Opt | `Description`, `description` | → `descClean`, `isAutoDesc` | scorer (body, RC, steps, spelling, professionalism), taxonomy (priority 2), rootCause, signature fallback, IncidentModal |
| `Work notes` | Opt | `Work notes`, `work_notes` | → `allNotes`, `humanNotes` | scorer (RC, steps, spelling, noise, counts), rootCause, IncidentModal |
| `Assignment group` | Opt | `Assignment group`, `assignment_group` | No | see §6 |
| `Assigned to` | Opt | `Assigned to`, `assigned_to` | No | AgentStats/By Agent, `topAgents` in clusters, search, IncidentModal |
| `Opened` | Opt (**governs all time logic**) | `Opened`, `opened_at` | `normalizeDate` (serial/Date → string; text → as-is) | month filter, ISO week, trends, digest, resolutionHours, firstSeen/lastSeen |
| `Closed` | Opt | `Closed`, `closed_at` | `normalizeDate` | `resolutionHours` only |
| `Channel` | Opt | `Channel`, `contact_type` | No | **nobody** — DERIVED (only listed in UploadScreen "Expected Columns") |
| `Made SLA` | Opt | `Made SLA`, `made_sla` | `toBool` (missing → `false`) | SLA breach % (problems, categories, trends, Overview, Weekly) |

### 4.2 Fields requested by the brief that **are not** in the model — FACT

| Requested field | Status |
|---|---|
| Close / Resolution Notes | **Does not exist.** Resolution is inferred only from keywords in Description and Work notes (`scorer.ts › STEPS_KW`). |
| Resolved (date) | **Does not exist.** Only `Closed` is used. "resolved" only appears as a `State` value. |
| Business Application | **Does not exist.** |
| Configuration Item | **Does not exist.** |
| Root Cause (column) | **Does not exist as a column.** It is derived: `rootCauseText` (`rootCause.ts › extractRootCause`) and `dimScores.root_cause` (`ROOT_CAUSE_RE`). |
| **Service** | **DOES NOT EXIST.** (Note: `category` is a "service category" derived from text by `taxonomy.ts`; it is not the ServiceNow Service field.) |
| **Service Offering** | **DOES NOT EXIST.** |
| **Opened By** | **DOES NOT EXIST.** |

### 4.3 Derived fields — FACT

| Field | Calculation (evidence) | Used by |
|---|---|---|
| `shortDescClean`, `descClean` | `parser.ts › cleanText` (`_x000D_`→\n, strips `[code]`, HTML, URL→`[URL]`, `nav_to.do`, ISO timestamps, collapses spaces) | scorer, taxonomy, clustering, modal |
| `allNotes` / `humanNotes` | `parser.ts › parseNotes` + `isSystem` | scorer, rootCause, modal |
| `isAutoDesc` | `parser.ts › isAutoDescription` (AUTO_DESC_KW over the **raw** Description) | scorer (body=70), Overview `autoGenerated` (computed but **not shown**), "auto" tag in AllIncidents |
| `category` | `taxonomy.ts › categorize(shortDescClean, descClean)` | clustering (constraint), CategoryStats, Problems, Weekly movements |
| `clusterId` | `problems.ts › annotateIncidents` (`p-N` or `solo-i`) | computeProblemClusters, CategoryStats.distinctProblems, Weekly new/recurring |
| `rootCauseText` | `rootCause.ts › extractRootCause(desc + humanNotes)` | clusters.rootCauses, rcaCoverage (problems, categories, trends) |
| `resolutionHours` | `periods.ts › resolutionHours(Opened, Closed)`; null if <0 or >1 year | medians (Overview, clusters, categories, trends) |
| `week` | `periods.ts › weekKey(Opened)` ISO `YYYY-Www` | trends(week), weekly, clusters.weeksActive |
| `isClosed` | `State.toLowerCase()` contains `closed` or `resolved` | SLA breach denominator, openCount |
| **score** (`IncidentScore`) | `scorer.ts › scoreIncident` → `totalScore`, `label`, `color`, `dimScores`, `feedback[]`, `noiseRatio`, `noteCount`, `noteChars` | almost every view (§8) |

---

## 5. Column Detection & Ingestion

### 5.1 How it works — FACT
- **Reading**: `readIncidentRows` uses `XLSX.read` → **first sheet only** (`wb.SheetNames[0]`), `sheet_to_json({defval:''})`. The header row is the sheet's first row. There is no header-row detection and no skipping of title rows.
- **Aliases**: `parser.ts › col(row, ...keys)` returns the first key with a value `!== undefined`. Exactly **2 hard-coded aliases** per field (display name and snake_case). Matching is **exact**: case-sensitive, no trim, no accent handling, and no detection of other languages (for example a Spanish ServiceNow export with "Número" or "Grupo de asignación").
- **Normalisation of names**: none. Only literal lookup.
- **Required vs optional**: none is required. A missing column → `''` (or `false` for `Made SLA`, `'Incident'` for `Task type`). Tested in `parser.test.ts` ("fills missing cells", "accepts snake_case").
- **Validation**: none. There is no check that the file is an incident export, no warning about missing columns, and no row count check. A sheet with arbitrary columns "loads successfully" with blank fields — DERIVED.
- **Unknown columns**: ignored silently (they never leave `IncidentRow`).
- **Types**: everything goes through `String()`. Dates: serial number → UTC string; `Date` → ISO; text → as-is (`normalizeDate`). SLA: `toBool` accepts `true/yes/y/1/si/sí`.
- **Formats**: `.xlsx`, `.xls`, `.csv` (input `accept`, `UploadScreen.tsx:69`). CSV goes through the same SheetJS reader with no explicit codepage.
- **Export schemas**: only the "display names" and "field names (snake_case)" variants are supported. `dv_*` exports, other languages and custom labels are not.

### 5.2 Behaviour confirmed by probes — FACT (run against the repo's own code)
| Input | Result |
|---|---|
| UTF-8 CSV without BOM containing `Contraseña ... solución` | `ContraseÃ±a ... soluciÃ³n` (mojibake). The Priority repair does not cover this pattern (`3 â\u0080\u0093 Moderate`). |
| UTF-8 CSV **with BOM** | Header becomes `ï»¿Number` → `Number` = `''` on **every** row |
| CSV with `04/03/2025 10:00` | SheetJS converts it to a serial → `2025-04-03` (read as **mm/dd**) |
| Text cell `13/03/2025 09:30` or `03-04-2025 …` or `4-Mar-2025` | `Opened` stays as text → `parseMonthKey` = `''`, `weekKey` = `''`, `resolutionHours` = null |
| Missing `Made SLA` column | `false` → every closed incident counts as an SLA breach (cluster with `slaBreachPct` = 100) |

### 5.3 Answer
**"Is adding an optional dimension something the architecture already supports naturally, or would it touch several layers?"**
→ **It touches several layers** — DERIVED. Ingesting it is trivial, but there is no generic dimension mechanism. Each field is hard-coded in: the `RawIncident` type and `enrichRow` (`parser.ts`), the TS object literals of the test factories (`incident()` in 4 test files build a full `EnrichedIncident`), the specific aggregators (`analytics.ts` has one function per dimension: `computeAgentStats`, `computeGroupStats`), the derived state in `AppContext` (one `filtered*` per aggregate), each page that renders or filters, and the parallel path in `api/process.ts`.

---

## 6. Assignment Group Behavior

| Aspect | Behaviour | Label / evidence |
|---|---|---|
| Ingestion | `String(col(row,'Assignment group','assignment_group'))` | FACT `parser.ts:155` |
| Normalisation | **None** (no trim, case folding, alias or hierarchy). `"Service Desk"` and `"Service Desk "` are different groups. | FACT |
| Empty value | `'Unassigned'` in aggregations (`analytics › computeGroupStats`, `problems › topGroups`). In the All Incidents dropdown, empty values are **removed** (`filter(Boolean)`), so blank-AG incidents cannot be selected as a group. | FACT `analytics.ts:185`, `problems.ts:336`, `AllIncidentsPage.tsx:35` |
| Global filter | **No.** | FACT (`AppContext` has no AG state) |
| Local filter | Yes, `<select>` in All Incidents (exact equality) + text search (`includes`) | FACT `AllIncidentsPage.tsx:49-53` |
| Grouping | `computeGroupStats` → `{count, avgScore, excellent, critical, avgNoise, avgRootCause, avgNoteLength}` sorted by avgScore desc. It respects the month filter. | FACT `analytics.ts:181-203` |
| Problem clusters | `topGroups` (top 3 by count) inside each `ProblemCluster` | FACT `problems.ts:336` |
| Visualisation | Overview "Average Score by Group" (**top 15 by best score**); By Group (full table); Text Quality "Root Cause Documentation by Group" (groups with ≥3 incidents, top 15 by avgRootCause); ProblemModal "Handled By Group"; IncidentModal header; All Incidents column | FACT |
| Affects scoring | **No.** `scorer.ts` never reads it. | FACT |
| Affects clustering | **No.** Clustering only uses text and category. | FACT `problems.ts › annotateIncidents` |
| Exports | Not applicable (there are no exports). In `api/process.ts` it travels inside the JSON. | FACT |
| `GroupStat.avgNoteLength` | Computed but **not rendered** anywhere | DERIVED (grep) |

**Classification** — DERIVED: AG is a **flat grouping dimension**, plus a **local filter** in a single view and a **secondary attribute** of problem clusters. It is **not** a central entity, a hierarchy, a key, or a global filter.

---

## 7. Current Definition of Noise

### 7.1 Explicit logic (implemented rules) — FACT

| # | Concept | Rule | Evidence |
|---|---|---|---|
| E1 | **System note** | Note whose author is exactly `system` (case-insensitive), or whose text contains any of: `sent communication to`, `could not contact`, `task is created by system`, `escalation is in progress`, `escalate in`, `faq on alerts`, `predicted ag:`, `attachment added`, `why was this incident created`, `how is the priority`, `confidence:` → `isSystem=true`, excluded from `humanNotes` | `parser.ts:36-41, 62-65, 80` |
| E2 | **Auto-generated description** (monitoring alert) | Raw Description contains any of: `we have identified unusually`, `alert triggered at`, `usage overview`, `cluster name`, `namespace :`, `container name:`, `pod name:`, `document count:`, `conditions met:`, `links for investigation` → `isAutoDesc` | `parser.ts:43-47, 67-70` |
| E3 | **Noise note** (boilerplate) | Human note matching a `NOISE_PATTERNS` entry (`^hi team… assist/check/help`, `^please check/assist…`, `^(hardware/dispatch\|software/application)$`, `^na$`/`^n/a$`, `^predicted ag:`, `^attachment added$`, `^(hi\|hello\|dear) team`, `this incident will be closed due (yo\|to) has been completed`) **or** with fewer than 12 characters | `scorer.ts:46-55, 129-131` |
| E4 | **noiseRatio** | noise notes / human notes (0 when there are no human notes) | `scorer.ts:132` |
| E5 | **Informal language / filler** | `SLANG_PATTERNS` (WIP, TBD, gonna, wanna, pls/plz, "due yo", "Hi team" opener, "please check the user") → −15 per pattern on professionalism | `scorer.ts:57-66, 124-126` |
| E6 | **Text noise** | `cleanText` removes HTML, URLs, `nav_to.do`, ISO timestamps, `_x000D_` | `parser.ts:49-60` |
| E7 | **Lexical noise for clustering** | ES/EN STOPWORDS + `isIdentifier` (numbers, alphanumeric tokens) + length ≤2 + emails + `[url]` | `text.ts` |
| E8 | **"Monitoring Alerts" category** | Regex `alert triggered\|monitoring\|threshold\|cluster name\|namespace\|pod name\|…\|grafana\|datadog\|splunk`, evaluated **after** 11 other categories | `taxonomy.ts:26` |

### 7.2 Derived logic (combinations of signals) — FACT unless marked otherwise

| # | Signal | Definition | Evidence |
|---|---|---|---|
| D1 | `highNoise` | `noiseRatio > 0.5` | `analytics › computeOverview`, `trends › highNoisePct` |
| D2 | Noise buckets | Clean <0.2 · Some 0.2–0.5 · High 0.5–0.8 · All Noise ≥0.8 (note: 0.5 falls in "High", but `highNoise` requires >0.5) | `analytics › computeNoiseBuckets` |
| D3 | `avgNoise` per AG | mean of noiseRatio ×100 | `analytics › computeGroupStats` |
| D4 | `emptyNotes` / "no human intervention" | `noteCount === 0` (no human notes). This is the closest thing to "no human intervention"; there is no explicit rule by that name. | `analytics.ts:115`; scorer feedback "No human work notes found." |
| D5 | Recurrence | cluster with ≥2 incidents (`minCount`) | `problems › computeProblemClusters` |
| D6 | Chronic | `weeksActive ≥ 3 && count ≥ 3` | `problems.ts:329` |
| D7 | Automation candidate | count ≥ floor (max(3, 1% of total)) **and** rcaCoverage ≥50 **and** median resolution ≤2h (rules evaluated in order, first match wins) | `problems › recommendActions` |
| D8 | Root cause / resolution | RC = any `ROOT_CAUSE_KW` (includes `because`, `due to`, `porque`, `investigation`…); steps = any `STEPS_KW` | `rootCause.ts`, `scorer.ts` |
| D9 | Auto-generated alert ↔ category | `isAutoDesc` (E2) and the "Monitoring Alerts" category (E8) are **independent** and never combined | DERIVED |

**Does not exist** — FACT: duplicate detection (beyond clustering), reassignment (no reassignment-count column), alert/event correlation, resolution notes (§4.2), and no explicit flag for "autogenerated incident" or "no human intervention".

### 7.3 UI terminology — FACT
- Overview: KPI **"High Noise"**; insight *"X% of incidents contain excessive noise"* (when >15%); KPI **"Recurring Volume"** ("problems seen 2+ times").
- Text Quality: section **"Noise & Boilerplate Analysis"**, chart **"Noise Level Distribution"** (Clean / Some / High / All Noise); **"Empty Notes"**.
- All Incidents: **"Noise"** column (%), sort **"Noise ↓"**, **"auto"** tag next to the number when `isAutoDesc`.
- By Group: **"Avg Noise"**.
- Trends: **"Noise Δ"**, **"High Noise %"**.
- Feedback: *"Description is auto-generated from monitoring alert."*, *"No human work notes found."*
- Problems: **"Repeat Incidents"**, **"Chronic"**, **"Automate"**, "Automation or self-service candidate".

### 7.4 Business interpretation — ASSUMPTION
- "Noise" in this app appears to mean **low-value text in work notes** (greetings, handoffs, placeholders, notes that are too short). It is a measure of **documentation quality**, not **operational noise** (unnecessary tickets or alerts).
- The system notes (E1) and `isAutoDesc` (E2) suggest the source environment contains automation (Predicted AG, confidence, alerts from Elasticsearch/Kubernetes), but the app only uses them to **exclude or adjust** the quality score, not to quantify them as noise.
- The "automation candidate" recommendation (D7) is the closest notion to *eliminable toil*.

---

## 8. Scoring Engine

### 8.1 Contract — FACT (`scorer.ts`)
- **Input**: `EnrichedIncident`. Fields read: `shortDescClean`, `descClean`, `isAutoDesc`, `humanNotes[].text`, `State`, `Number`.
- **Not read**: `Short description` (raw), Priority, AG, Assigned to, dates, SLA, Channel, `allNotes` (system notes).
- **Output**: `IncidentScore { number, totalScore (0-100 int), label, color, dimScores{5}, feedback[], noiseRatio, noteCount, noteChars }`.
- **"combined"** text = `descClean + humanNotes` (does **not** include the short description). `scorer.ts:146`.

### 8.2 Dimensions, rules, thresholds, weights — FACT

| Dimension | Weight | Rule |
|---|---|---|
| `description_quality` | 0.25 | `0.4·short + 0.6·body`. **short**: len ≤9 → 0; ≤24 → 40; matches `^[..][..]` → 60; else 100. **body**: `isAutoDesc` → 70; len ≤49 → 0; ≤149 → 50; else 100. |
| `root_cause` | 0.25 | binary: `ROOT_CAUSE_RE` in combined → 100, else 0. 25 EN/ES markers (`rootCause.ts:10-16`). |
| `steps_documented` | 0.20 | `STEPS_RE` (38 EN/ES markers) → 100; otherwise State **exactly** `closed`/`resolved` → 0; else 30. |
| `spelling_grammar` | 0.15 | Per word (>1 char, `[^a-z]` stripped): "suspicious" if 3+ repeated letters, ≥5 trailing consonants, or 3–5 letters with no vowels. Ratio <3% → 95; <8% → 75; <15% → 55; else 30. Empty text → 95. |
| `professionalism` | 0.15 | `max(0, 100 − 15·#slang − 60·noiseRatio)`. No human notes → noiseRatio 0 → 100 (with feedback). |

- **Total**: `round(Σ dim·weight)`. `description_quality` and `professionalism` are rounded before weighting.
- **Labels**: ≥80 Excellent · ≥55 Good · ≥30 Poor · <30 Critical (`getLabel`).
- **Feedback**: fixed strings, aggregated in `analytics › computeFeedback` ("Top Documentation Issues").
- **Determinism** — DERIVED: pure function with no randomness or clock, independent of row order.
- **Probes** — FACT: an empty *closed* incident = 29 (Critical); empty *open* (or without State) = **35 (Poor)**; text consisting only of acronyms `DNS SSL SMTP…` → spelling 30.

### 8.3 Consumers of the result — FACT
`AppContext` (filteredScores), `analytics` (overview, dimStats, feedback, agent, group, buckets), `problems` (avgScore of cluster/category), `trends` (avg and percentages per period), `weekly` (via trends/clusters). Pages: Overview (KPIs, distribution, dimensions, chart by group), Text Quality, All Incidents (badge, bar, noise, notes, sorting), By Agent, By Group, Trends, Weekly (Avg Quality, badges), Problems (Quality), IncidentModal (detail and feedback).

### 8.4 Coupling of the scorer — DERIVED: **MEDIUM**
- It depends on fields that `parser.ts` derives (`*Clean`, `humanNotes`, `isAutoDesc`), so changes to the parser alter the score.
- It shares `ROOT_CAUSE_RE` with `problems › extractRootCause` (consistent by construction).
- The weights are **duplicated** as integers in `analytics.ts › DIM_META` (25/25/20/15/15) and in the README. The label thresholds are duplicated in `getScoreColor`, `getScoreBarColor`, `ByGroupPage`, `WeeklyPage`, `IncidentModal` (bars), `TrendsPage` (ReferenceLines 55/80) and the test fixtures.
- `IncidentScore.color` is not consumed by any page, and its HSL values differ from the UI palette — DERIVED.
- Join by `Number`: the score is attached to the incident via `Number`, never by index.

### 8.5 TS vs Python comparison
- **FACT**: there are no `.py` files in the working tree or in the git history (`git log --all --name-only`). `wn_analyzer_v3.py` and `llm_scorer.py` do not exist and nothing references them (grep).
- **UNKNOWN**: whether `scorer.ts` replicates the rules, weights and thresholds of any Python scorer. It cannot be compared.
- **ASSUMPTION**: the "WN Quality" / "Work Notes Quality" naming (sidebar, UploadScreen) and the commit "Add Incident Insight Pro V2 baseline" suggest a lineage from an earlier work-notes analyser. This needs validation against that external code.

---

## 9. Global Filters

| Filter | Type | Field / logic | Scope | Evidence |
|---|---|---|---|---|
| **Month** | Global (Context), multi-select | `parseMonthKey(inc.Opened)` (regex `(\d{4})[/-](\d{2})` without anchor) ∈ `selectedMonths`. Empty = all. A selection with no matches = empty dashboard. | Overview, Text Quality, All Incidents, By Agent, By Group, Problems | `AppContext.tsx:216-262`, `analytics.ts:273-277` |
| **Quality (label)** | Global (Context), single | `filterLabel` (`all`/Excellent/Good/Poor/Critical) from the sidebar | **Only** All Incidents (replaces the local select) and By Agent (shows agents with ≥1 incident of that label, with stats from all their incidents) | `AppSidebar.tsx`, `AllIncidentsPage.tsx:38`, `ByAgentPage.tsx:9-17` |
| **Week** | Semi-global (Context) | `selectedWeek` ∈ weeks present (`inc.week`) | Weekly Review only | `AppContext.tsx:36-37,145-154`, `WeeklyPage.tsx` |
| Search / label / group / state / sort | Local | `includes` over Number, Assigned to, Short description, AG; exact equality | All Incidents | `AllIncidentsPage.tsx` |
| Search / category / "Undocumented only" (rcaCoverage <50) | Local | over `ProblemCluster` | Problems | `ProblemsPage.tsx:38-46` |
| Dates (range), AG, category, score range | **Do not exist as global filters** | — | — | FACT |

**Which date field governs the month filter?** → **`Opened`** (`AppContext.tsx:221`, `parseMonthKey(inc.Opened)`). FACT.

**Do all views use the same time logic?** → **No.** FACT. Exceptions:
1. **Trends**: ignores the month filter (`monthlyTrends` over `state.incidents`, `AppContext.tsx:264-272`) and does not render `MonthFilter`. It buckets by `parseMonthKey(Opened)`.
2. **Weekly Review**: ignores the month filter (`computeWeeklyDigest(incidents…)` with the **unfiltered** `incidents`, `WeeklyPage.tsx:35-38`). It uses an ISO week (Monday, UTC) from `Opened` via a **different parser** (`periods › parseTimestamp`, anchored `^YYYY[-/]MM[-/]DD`). The weekly chart uses `weeklyTrends` (whole dataset).
3. **Weekly baseline**: these are the 4 previous weeks **present in the data**, not calendar weeks. Weeks with no incidents are skipped (`weekly.ts:487-494`, `availableWeeks`).
4. **Recurring in Weekly**: `weeksActive`/`isChronic` are taken from the **whole** dataset, including weeks after the selected one (`weekly.ts:543-557`).
5. **Resolution time**: always `Closed − Opened`, attributed to the `Opened` period.
6. **Two date parsers**: `parseMonthKey` accepts `YYYY-MM` without a day and unanchored; `parseTimestamp` requires `YYYY-MM-DD` at the start. Text such as `2025-03` would have a month but no week — DERIVED.
7. **Quality filter**: ignored by Overview, Text Quality, By Group, Trends, Weekly and Problems.

---

## 10. Current Analytics

| Analysis | Page | Input fields | Metric | Grouping | Filters respected |
|---|---|---|---|---|---|
| Volume | Overview, Problems, Weekly, Trends | Number (count) | total; per week/month | — / period | Month (Overview/Problems); none (Trends/Weekly) |
| Quality distribution | Overview, Trends | score.label | count and % per label | label / month | Month (Overview); none (Trends) |
| Dimension scores | Overview, Text Quality, Trends | dimScores | mean, % =0, % =100, 4 buckets | dimension / month | Month; none (Trends) |
| Top documentation issues | Overview | score.feedback | count, % | feedback text | Month |
| Executive insights | Overview | overview, dimStats | thresholds RC>30%, Poor+Crit>20%, noise>15%, avg<60/≥75 | — | Month |
| Median resolution time (aging of closed) | Overview, Problems (cat./cluster), Weekly | Opened, Closed | median hours | global / category / cluster / week | Month (except Weekly) |
| SLA breach | Overview, Problems, Weekly, ProblemModal | Made SLA, State | % of closed with `!Made SLA` | global / category / cluster / week | Month (except Weekly) |
| Still open | Overview, Weekly | State | count of `!isClosed` | global / week | Month (except Weekly) |
| Aging of open incidents | — | — | **Does not exist** | — | — |
| Incidents by State | Overview | State | count | State (literal) | Month |
| Priority distribution | — | Priority | `computePriorityDist` exists but **no page uses it** | — | — |
| Recurrence / problems | Problems, Overview, Weekly | short/desc text, category | count, share, weeksActive, chronic, top-10 concentration | clusterId | Month (Problems/Overview); week (Weekly) |
| Root cause (coverage and texts) | Problems, ProblemModal, Weekly, Trends, Text Quality | desc + humanNotes | rcaCoverage %, top 5 causes by normalised key | cluster / category / period / AG | Month (except Trends/Weekly) |
| Categories | Problems, Weekly | category | count, share, distinct problems, RCA, median, SLA, avgScore; movements vs baseline (±25%, ≥3) | category | Month (Problems); week (Weekly) |
| By AG | Overview, By Group, Text Quality | AG + score | count, avgScore, excellent, critical, avgNoise, avgRootCause | AG | Month |
| By agent | By Agent, ProblemModal | Assigned to + score | count, avgScore, label counts (agents with ≥2 only) | Assigned to | Month + quality |
| Alerts | All Incidents ("auto" tag), category "Monitoring Alerts", feedback | isAutoDesc / taxonomy | tag; count per category. `overview.autoGenerated` is computed but **not rendered** | — | Month |
| Automation | Problems, Weekly | cluster | "Automate" recommendation (D7) | cluster | Month / week |
| Closure (closed without steps) | Feedback (Overview), IncidentModal | State + STEPS_KW | steps=0 + feedback | — | Month |
| Notes / text | Text Quality | humanNotes, shortDescClean | avg/median length, empties, note count, length buckets, short description buckets, noise buckets, average length per label | bucket / label | Month |
| Recommendations | Problems ("Where to Act First"), Weekly | clusters | 4 types: problem-management, chronic, automation, knowledge-gap | cluster | Month / week |
| Weekly digest | Weekly Review | all | vs baseline, vs previous week, movements, new/recurring, actions, 12-week charts | ISO week | Week only (ignores month and quality) |

---

## 11. UX / Information Architecture

Navigation — FACT (`AppSidebar.tsx`, `Dashboard.tsx`): sidebar with 8 views + "Filter by Quality". There are no URLs per view (internal state `currentPage`) and no way to return to the upload screen without reloading.

```
UploadScreen  ("Work Notes Quality" — drop/select a file, progress bar, "Expected Columns")
└─ Dashboard
   ├─ Sidebar: "WN Quality" + fileName · Views (8) · Filter by Quality (5)
   ├─ Overview          [MonthFilter]
   │   ├─ Executive Summary (insights banner)
   │   ├─ Key Metrics: Total, Avg Score, Excellent, Good, Poor, Critical, No Root Cause, High Noise
   │   ├─ Service Performance: Median Time to Resolve, SLA Breached, Still Open, Recurring Volume
   │   ├─ Top Documentation Issues (top 8 feedback)
   │   ├─ Quality Distribution (stacked bar)
   │   ├─ Dimension Scores (5 cards + bucket bars)
   │   └─ Average Score by Group (top 15) · Incidents by State (bars)
   ├─ Weekly Review     [week picker + prev/next]
   │   ├─ KPIs: Incidents, vs Baseline, Avg Quality, Median TTR, SLA Breached, Root Cause Logged
   │   ├─ What Moved This Week (category movements)
   │   ├─ Incidents per Week (12w) · Quality & Root Cause Coverage (12w)
   │   ├─ New This Week · Recurring This Week
   │   └─ Recommended Actions
   ├─ Problems & RCA    [MonthFilter]
   │   ├─ KPIs: Distinct Problems, Repeat Incidents, Chronic, Root Cause Coverage, Top 10 Concentration
   │   ├─ Where to Act First (up to 6 recommendations → ProblemModal)
   │   ├─ Volume by Category (table)
   │   └─ Recurring Problems (table + search/category/undocumented → ProblemModal)
   ├─ Trends            (no MonthFilter; requires ≥2 months)
   │   ├─ KPIs: Latest Avg Score, Total Months, Root Cause Δ, Noise Δ
   │   ├─ Average Score Over Time · Dimension Scores Over Time
   │   ├─ Quality Distribution Over Time · No Root Cause % · High Noise %
   │   └─ Monthly Detail (table)
   ├─ Text Quality      [MonthFilter]
   │   ├─ KPIs: Avg/Median Characters, Empty Notes, Avg Note Count
   │   ├─ Note Length Distribution · Short Description Quality
   │   ├─ Noise Level Distribution · Avg Note Length by Quality
   │   ├─ Dimension Deep-Dive
   │   └─ Root Cause Documentation by Group (top 15, ≥3 incidents)
   ├─ All Incidents     [MonthFilter] search/label/group/state/sort, virtualised table → IncidentModal
   ├─ By Agent          [MonthFilter] agent cards (≥2 incidents)
   └─ By Group          [MonthFilter] AG table
Modals: IncidentModal (score, dimensions, feedback, short description, human notes, description)
        ProblemModal (stats, documented causes, top AG/agents, date range, sample numbers)
```

| Page | Business question it tries to answer (README "Views" + content) |
|---|---|
| Overview | How healthy is the documentation, and how is the service performing? |
| Weekly Review | What changed this week compared with the recent baseline, and what should be raised in the review? |
| Problems & RCA | What keeps recurring, why (documented causes), and where should we act first? |
| Trends | Is quality/risk improving or getting worse month by month? |
| Text Quality | Where exactly does the writing fall short (length, noise, short descriptions, RC by group)? |
| All Incidents | Which specific incidents are badly documented, and why (drill-down)? |
| By Agent / By Group | Who or which team needs coaching? |

---

## 12. Exports

- **FACT**: **No export capability exists** in the UI. There is no CSV, Excel, JSON or PDF download (grep for `download`, `createObjectURL`, `writeFile`, `json_to_sheet` in `src` outside the tests = 0 matches). SheetJS is only used for **reading**.
- **FACT**: `api/process.ts` returns JSON with detail (`incidents`, `scores`) and aggregates (`overview`, `dimStats`, `feedbackItems`, `agentStats`, `groupStats`, `availableMonthKeys`). It is a processing endpoint **not used** by the frontend, not an export feature, and it omits the annotations (category, cluster, root cause, week).
- Detail vs aggregate: **not applicable**.

---

## 13. Available Data

| Artifact | Classification | Columns / content |
|---|---|---|
| `.xlsx` / `.xls` / `.csv` / `.json` data files in the working tree | **None** — FACT | — |
| The same in git history (`git log --all --name-only`) | **None** — FACT (only config `.json` files: package, tsconfig, components, vercel) | — |
| Python (`.py`) | **None** (tree or history) — FACT | — |
| `src/lib/*.test.ts` — `incident()` / `score()` factories | **Fixture** (synthetic, inline) | All `EnrichedIncident` fields (Number, Task type, Priority, State, Short description, Description, Work notes, Assignment group, Assigned to, Opened, Closed, Channel, Made SLA, *Clean, notes, isAutoDesc) + `IncidentScore` |
| `parser.test.ts › workbookBuffer` | **Fixture** (generated in memory) | Number, Short description, State, Assigned to |
| `src/bench/scale.test.ts › buildRows` | **Synthetic fixture** (20k rows, 8 fixed problems) | Number, Priority, State, Short description, Description, Work notes, Assignment group ("Group N"), Assigned to ("Agent N"), Opened, Closed, Channel, Made SLA |
| `public/*` | Static assets (icons, og-image, robots) | — |

**Real ServiceNow extracts with names, emails or incident text in git** → **No.** FACT. Fixtures use placeholders ("A. Tech", "Service Desk", "Group 0…5", "INC0001"). The scale test generates data procedurally.

---

## 14. Coupling & Dependencies

| Component | Depends on | Level | Justification |
|---|---|---|---|
| `parser.ts › EnrichedIncident` (schema) | consumed by scorer, problems, analytics, trends, weekly, worker, api, 5 pages, 2 modals, 5 test files | **HIGH** | Fixed literal type keyed by display names (`'Assignment group'`) and read directly across the UI. There is no access layer. |
| `Number` as join key | `scoreMap` in analytics (×2), problems (×2), trends, AllIncidents, AppContext.filteredScores | **HIGH** | Scores and incidents are parallel arrays joined by `Number`. Duplicate or empty values corrupt the join (§17 F-02). |
| `scorer.ts` | parser (derived fields), rootCause | **MEDIUM** | Isolated pure function, but weights and thresholds are duplicated in analytics/UI (see §8.4). |
| Label thresholds / colours | scorer, dashboard-primitives, ByGroup, Weekly, IncidentModal, Trends, Overview, TextQuality, Sidebar | **HIGH (duplication)** | ≥8 copies of 80/55/30 and of the palette. |
| `ROOT_CAUSE_RE` | scorer + problems | **LOW** (shared correctly) | Single source in `rootCause.ts`. |
| `AppContext` (global state) | all pages | **HIGH** | A single context exposes ~30 values. Each new aggregate needs a new `useMemo` and type entry. All consumers re-render on any change. |
| Month filter | AppContext + `MonthFilter` (rendered per page) | **MEDIUM** | Centralised, but each page decides whether to render `MonthFilter`, and Trends/Weekly opt out. |
| Aggregations (`median`, `pct`, `mean`, `round1`) | analytics, problems, trends, OverviewPage | **MEDIUM (duplication)** | Re-implemented in 3–4 files with slight differences (`pct` to one decimal vs `wholePct` integer; `median` returning 0 vs null). |
| Clustering (`clusterId`) | worker → problems → weekly | **MEDIUM** | Computed once and depends on file row order (greedy). Filters only regroup. |
| Worker ↔ API | both import `src/lib` | **LOW / divergent** | They share the lib but the API skips `annotateIncidents`, so its output has a different shape. |
| Exports | — | n/a | Do not exist. |

---

## 15. Application Invariants

Derived from tests (T) or from code and comments (C).

1. **(T)** Both column names (display name and snake_case) are accepted for every field — `parser.test.ts › accepts snake_case`.
2. **(T)** A missing column or cell **does not break** the import → `''` — `fills missing cells`. A sheet with only a header → `[]`.
3. **(T)** Work notes split on `YYYY-MM-DD HH:MM:SS - Author (Work notes)`. Unstructured text → 1 note with `author:'Unknown'`. System notes are excluded from `humanNotes`.
4. **(T)** Numeric/Date dates → `"YYYY-MM-DD HH:MM:SS"` string (UTC). All time logic assumes this format (`periods.ts` header comment).
5. **(T)** `Task type` defaults to `'Incident'`. Mojibake is repaired in Priority.
6. **(T/C)** Score is an integer in 0–100. Labels ≥80/≥55/≥30. Weights 25/25/20/15/15. Deterministic (pure function).
7. **(T)** A closed incident with no steps → 0. An open one → 30. Spanish RC/steps wording is recognised. noiseRatio=0 when there are no human notes. Auto-generated description gets partial credit (70).
8. **(T)** Empty aggregations never produce NaN (`analytics.test.ts › empty inputs never produce NaN`).
9. **(T)** By Agent excludes agents with <2 incidents. Blank AG/agent → `'Unassigned'`.
10. **(T)** Clustering only merges within the **same category**, with Jaccard **> 0.5**. The seed token set is fixed (no drift). Incidents with no tokens → their own cluster. Recurring problems require `minCount` 2. 20k incidents cluster in <5 s.
11. **(C)** Clustering runs **once** in the worker. Filters only regroup by `clusterId` (`AppContext.tsx:250-251`, README).
12. **(C)** Month filter: no selection = everything (precomputed stats). A selection with no matches = empty dashboard, never the all-time numbers (`AppContext.tsx:212-215`).
13. **(C)** Trends deliberately span the whole dataset (`AppContext.tsx:264-265`).
14. **(T)** Weekly digest: `null` for a week with no incidents. The first week has no baseline. New problems require ≥2 incidents in the week.
15. **(C)** `src/lib` is the **single source** for parsing and scoring, shared by the worker and the API (README, comment at `parser.ts:130-135`).
16. **(C)** With >10k rows the worker discards raw fields but **keeps `descClean` and `humanNotes`** for the modal (`scoringWorker.ts:41-45`).
17. **(C)** On the main path the file never leaves the browser (README). `api/` is optional and enforces the Blob URL suffix check and the scoped token (`api/process.ts:20-38`, `api/upload.ts`).
18. **(C)** The score is joined to the incident by `Number` (all aggregators).
19. **(T)** Root cause is extracted as the **whole sentence** containing the marker (≤180 characters).

---

## 16. Unknowns

- **U-01** Whether a Python scorer exists (`wn_analyzer_v3.py`, `llm_scorer.py`) and how it compares with `scorer.ts`: rules, weights, thresholds. It is not in the repo.
- **U-02** The real format of the ServiceNow exports the team uses: CSV vs XLSX, encoding, BOM, date format (dd/mm vs ISO), header language, and whether `Made SLA` is included.
- **U-03** Whether the "System" author and the `SYSTEM_PHRASES` / `AUTO_DESC_KW` lists reflect the current production environment (they look specific to an instance with "Predicted AG" and Elasticsearch/K8s alerts).
- **U-04** The business meaning intended for "noise" (documentation quality vs operational noise). The code only implements the former.
- **U-05** Whether ServiceNow `State` values in the source data include variants (`Closed Complete`, `Canceled`, localised values) and how they should be treated.
- **U-06** Whether `api/` is used in any deployment (Vercel). The frontend does not call it. Whether `config.api.responseLimit` has any effect on Vercel Node functions (it is a Next.js-style option) — ASSUMPTION that it is ignored.
- **U-07** The real volume of the files (the code supports >10k rows, but there is no reference for the actual size).
- **U-08** Whether the time zone of `Opened`/`Closed` in the exports matches the UTC interpretation the app applies.
- **U-09** Whether the weekly baseline rule ("weeks present") and the use of the whole dataset for `weeksActive` are intentional.
- **U-10** Whether the user-facing name of the product is "Incident Insight" or "WN Quality" (both appear).

---

## 17. Findings

> Recorded only. **None were fixed.** Severity: H (high), M (medium), L (low). "Probe" = reproduced by running the repo's code on a copy outside the working tree.

| ID | Sev | Type | Finding | Label / evidence |
|---|---|---|---|---|
| F-01 | H | Bug (ingestion) | **UTF-8 CSV is decoded incorrectly** (mojibake: `Contraseña`→`ContraseÃ±a`). Spanish keywords with accents (RC `causa raíz`, `diagnóstico`; steps `solución`; taxonomy `contraseña`, `buzón`) stop matching for CSV. The Priority repair does not cover this pattern. | FACT probe; `parser.ts › readIncidentRows` (no `codepage`) |
| F-02 | H | Bug (ingestion / join) | **CSV with BOM** → header `ï»¿Number` → `Number=''` on every row → `scoreMap` collapses to a single entry. All Incidents shows the same score for every row; agent/group stats use a single score; with the month filter on, `filteredScores` includes every score. The same applies to any file without a `Number` column or with duplicate Numbers. | FACT probe; `AllIncidentsPage.tsx:29,36`, `analytics.ts:159,182`, `AppContext.tsx:224-228` |
| F-03 | H | Bug (semantics) | **Missing `Made SLA` column ⇒ 100% SLA breach** (`toBool('')=false`), even though the README says missing columns "degrade gracefully" and `slaBreachPct` is documented as "null if unknown". | FACT probe; `parser.ts:107-114,160`, `problems.ts:302-305` |
| F-04 | H | Bug (dates) | Text dates not in ISO format (`13/03/2025`, `03-04-2025`, `4-Mar-2025`) → no month, week or resolution time; the incidents silently drop out of month filters, trends and the weekly review. In CSV, `dd/mm` is interpreted as **mm/dd** (`04/03/2025`→April 3). | FACT probe; `parser.ts › normalizeDate` (text passes through), `analytics › parseMonthKey`, `periods › parseTimestamp` |
| F-05 | M | Bug (parsing) | `NOTE_RE` uses `.+?` with the `s` flag: if the field contains other journal types (e.g. `(Additional comments)`), the "author" of the next note absorbs lines of text and entries are lost. | FACT probe; `parser.ts:34` |
| F-06 | M | Bug (RC) | The automatic closure boilerplate `"This incident will be closed due to has been completed"` counts as a **documented root cause** (`due to` ∈ ROOT_CAUSE_KW) and is extracted as the cluster's "cause". It is also counted as noise in professionalism. Generic markers (`because`, `porque`, `investigation`) inflate RC in general. | FACT probe; `rootCause.ts:10-16`, `scorer.ts:54` |
| F-07 | M | Bug (taxonomy) | English stems with a trailing `\b` never match inflected words: `authenticat` (→ "authentication" falls into Other), `freez`, `vulnerab`, `licen[cs]e` (literal only). Spanish stems happen to work because `\b` treats accented letters as non-word characters. | FACT probe; `taxonomy.ts:15-28` |
| F-08 | M | Inconsistency | "Closed" means different things: the scorer uses exact `closed`/`resolved`; `isClosed` uses a substring. `Closed Complete` → steps 30 (as if open) but `isClosed=true`. `Canceled` counts as **open** in Still Open/openCount. | FACT probe; `scorer.ts:95`, `problems.ts:171` |
| F-09 | M | Scoring design | An **empty** open incident (or one without State) scores **35 = Poor**. Empty text gets spelling 95 and professionalism 100 (absence is rewarded). | FACT probe; `scorer.ts:102,132-134` |
| F-10 | M | Scoring design | Spelling penalises technical acronyms (DNS, SSL, SMTP, TCP, NTP → "no vowels"). Text made only of acronyms → 30. It also strips accents and analyses alerts and pod names. | FACT probe; `scorer.ts:100-116` |
| F-11 | M | Clustering design | The tokenizer drops every alphanumeric token as an "identifier": `O365`, `Win10`, `IPv6`, `S3`, `KB…` disappear from the signature, which can merge or separate problems incorrectly. | FACT probe; `text.ts › isIdentifier` |
| F-12 | M | UX bug | Upload errors **are not visible**. On error `loading=false`, and `UploadScreen` only renders `loadingMessage` inside the `loading` branch. The dropzone reappears with no message. | FACT `AppContext.tsx:160-168`, `UploadScreen.tsx:43-60` |
| F-13 | M | Weekly inconsistency | (a) The baseline is the "4 previous weeks **with data**", not calendar weeks. (b) `weeksActive`/`isChronic` of recurring problems include **weeks after** the selected one. (c) The "most recent complete week" comment does not match the code, which picks the last week present, possibly partial. (d) Categories that disappear (0 this week) are never reported as a "down" movement. | FACT `weekly.ts:487-494,521-557`, `AppContext.tsx:153-154` |
| F-14 | L | UX inconsistency | The global quality filter only affects 2 views. In All Incidents it silently overrides the local select, whose displayed value stays unchanged. In By Agent it filters agents but shows stats from all their incidents. | FACT `AllIncidentsPage.tsx:38`, `ByAgentPage.tsx` |
| F-15 | L | Inconsistency | `highNoise` uses `>0.5`, while the "High" bucket starts at `≥0.5`. | FACT `analytics.ts:113,236` |
| F-16 | L | Duplication | Label thresholds and colours in ≥8 places. Weights duplicated in `DIM_META`. `median`/`pct`/`mean` re-implemented in analytics, problems, trends and OverviewPage with different semantics (0 vs null; one decimal vs integer). | FACT (see §14) |
| F-17 | L | Dead code | `IncidentScore.color` (unused, palette differs), `computePriorityDist`, `GroupStat.avgNoteLength`, `overview.autoGenerated` (not rendered), `Channel` and `Task type` (not used), `scoreAll` (tests only), `App.css`, `NavLink.tsx`, `use-mobile.tsx`, `QueryClientProvider` with no queries, ~46 of 50 shadcn primitives not imported outside `ui/`, and the whole `api/` folder (not called). Duplicate STOPWORDS (`not`, `having`). | DERIVED (grep) |
| F-18 | L | Divergence | `api/process.ts` does not run `annotateIncidents`, so its output lacks category, cluster, root cause and week, unlike the worker's. `config.api.responseLimit` is Next.js syntax (ASSUMPTION: no effect). `tsconfig.api.json` has `strict:false`. | FACT `api/process.ts` |
| F-19 | L | UX | Overview "Average Score by Group" shows the **15 best** groups (desc sort + `slice(0,15)`), hiding the worst. The same happens in "Root Cause Documentation by Group". | FACT `OverviewPage.tsx:86`, `TextQualityPage.tsx:31-38` |
| F-20 | L | AG | AG is not normalised (spaces and case split groups). Blank AG is shown as "Unassigned" in stats but cannot be selected in the All Incidents dropdown. | FACT `parser.ts:155`, `AllIncidentsPage.tsx:35` |
| F-21 | L | Ingestion | No column validation: any spreadsheet "loads successfully". Only the first sheet is read. The size limit is commented out in the UI. | FACT `parser.ts:178`, `UploadScreen.tsx:10-13` |
| F-22 | L | Clustering design | Greedy clustering depends on **row order** (the first incident seeds the cluster and its tokens are fixed). The same data in a different order can produce different clusters. | DERIVED `problems.ts:187-246` |
| F-23 | L | Branding | Three names coexist: "Incident Insight" (README), "WN Quality" (sidebar, "v1") and "Work Notes Quality" (UploadScreen). | FACT |
| F-24 | M | Security (dependencies) | `xlsx@0.18.5` (npm) has advisories with **no fix available on npm**: Prototype Pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9). It processes files supplied by the user. `npm audit` also reports react-router (open redirect) and others. | FACT (`npm audit --omit=dev` on a copy) |

---

## 18. Evidence Map

| Topic | Primary evidence |
|---|---|
| Stack and scripts | `package.json`, `vite.config.ts`, `vitest.config.ts`, `vercel.json`, `tsconfig.api.json` |
| Entry / navigation | `src/main.tsx`, `src/App.tsx`, `src/pages/Index.tsx`, `src/components/Dashboard.tsx`, `src/components/AppSidebar.tsx` |
| Upload | `src/components/UploadScreen.tsx`, `src/context/AppContext.tsx › loadFile` |
| Worker pipeline | `src/workers/scoringWorker.ts › onmessage` |
| Reading, aliases, cleanup, notes, dates, SLA | `src/lib/parser.ts › readIncidentRows, enrichRow, col, cleanText, parseNotes, normalizeDate, toBool, isAutoDescription` |
| Scoring | `src/lib/scorer.ts › scoreIncident, scoreDescription, scoreRootCause, scoreSteps, scoreSpelling, scoreProfessionalism, getLabel, WEIGHTS` |
| Root cause | `src/lib/rootCause.ts › ROOT_CAUSE_KW, ROOT_CAUSE_RE, extractRootCause` |
| Text / similarity | `src/lib/text.ts › tokenize, isIdentifier, jaccard, normalizedKey` |
| Categories | `src/lib/taxonomy.ts › CATEGORIES, categorize` |
| Clustering / problems / recommendations | `src/lib/problems.ts › annotateIncidents, computeProblemClusters, computeCategoryStats, recommendActions` |
| Time | `src/lib/periods.ts › parseTimestamp, isoWeek, weekKey, resolutionHours`; `src/lib/analytics.ts › parseMonthKey` |
| Trends / weekly | `src/lib/trends.ts › computePeriodTrends`; `src/lib/weekly.ts › computeWeeklyDigest, availableWeeks` |
| Aggregations | `src/lib/analytics.ts › computeOverview, computeDimStats, computeFeedback, computeAgentStats, computeGroupStats, compute*Buckets` |
| Global state and filters | `src/context/AppContext.tsx` (lines 212-272), `src/components/MonthFilter.tsx` |
| Views | `src/pages/{Overview,Weekly,Problems,Trends,TextQuality,AllIncidents,ByAgent,ByGroup}Page.tsx`, `src/components/{IncidentModal,ProblemModal}.tsx`, `src/components/ui/dashboard-primitives.tsx` |
| Server (optional) | `api/upload.ts`, `api/process.ts` |
| Tests / invariants | `src/lib/{parser,scorer,analytics,problems,weekly}.test.ts`, `src/bench/scale.test.ts` (77/77 green) |
| Absence of data/Python/exports | `git log --all --name-only` (only config `.json` files); grep for `download\|createObjectURL\|writeFile\|json_to_sheet` and `wn_analyzer\|llm_scorer` with no matches in source |
| Behavioural probes | Throwaway scripts run with Vitest on a copy of the repo outside the working tree (results quoted in §5.2, §8.2 and §17) |
