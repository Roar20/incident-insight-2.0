# FAM-01 — Incident Families (experimental)

Flag-gated research view, preview only. It does not replace `clusterId`, does
not modify M0, and is not used by any other page.

## Enabling

`VITE_EXPERIMENTAL_FAMILIES=on` at build time. Default OFF. When OFF there is
no sidebar entry, no route through normal navigation, no computation and no
worker request.

## What it computes

M1 from the C-REAL-04 research:

- word TF-IDF (1–2 grams) over open-time text (short description + description);
- a cosine-threshold graph;
- connected components.

It runs once over the full loaded dataset, in the existing scoring worker
(`kind: 'families'`), only while the page is open. Variants R0, R1(τ) and
R2(τ) are offered, with τ ∈ {0.02, 0.05, 0.10} and thresholds
{0.5, 0.6, 0.7, 0.8}. These are the registered C-REAL-04 grid
(`src/config/familiesResearch.ts`). The default threshold 0.7 is a UI
convenience, not a selected threshold.

Family = connected component with full-dataset size ≥ 2. Singleton = size 1.
Filters change only the displayed population, never family membership.

## Parity with C-REAL-04

The TypeScript implementation reproduces the frozen C-REAL-04 harness bit for
bit, including scikit-learn's feature storage order and SciPy's summation
order. `src/lib/families/familyParity.test.ts` checks every registered M1 word
configuration against canonical partition hashes that the frozen harness
produced on fictional fixtures (`src/test/fixtures/families/`). It is a
blocking test.

**R2 as executed.** In the frozen harness, R2 runs on R1's output, which is
already reduced to word tokens joined by spaces. Only the HEX, ID and NUM
shapes can therefore match; the registered EMAIL, URL, GUID, IP, PATH, HOST,
DATE and TIME shapes cannot. This view reproduces the executed behaviour
(required for parity) and does not correct it.

## Compute guard

`FAMILIES_DISPLAY.maxRows = 6000`. Measured on the fictional 2,819-row fixture:

- 0.28–0.40 s per variant (Node/V8) and 0.33–0.35 s in Chromium;
- process peak memory +19–37 MB.

At 5,638 rows a variant takes 0.8–1.5 s, because pairwise cost grows roughly
quadratically. Above the guard the view shows "This file is too large for the
experimental view" and computes nothing.

## FAM-01.2 — presentation changes (no analytical changes)

- **Exploratory UI default changed: R0 → R1 at τ 0.05** ("Remove repeated
  templates"), an already-registered configuration. Only the page's initial
  setting changed. R1, M1, the registered grids, group membership and parity
  are unchanged. The settings panel labels it "Exploratory default — not a
  selected configuration."
- R2 is labelled "Additional text normalization (experimental)", because as
  executed it replaces only HEX/ID/NUM tokens.
- **Week coverage.**
  - A week is compared with typical only when the file's Data-through date
    (calendar date of the latest Opened in the full file, UTC) is on or after
    the week's ISO Sunday.
  - The Data-through week stays selected by default. When the data ends inside
    it, the page shows counts "through <date>" and a coverage note, with no
    delta, no percentage and no "New this period".
  - Filters never change coverage.
- **Main story.**
  - "Largest repeating groups", ordered by incidents in the active filtered
    population (optional sort by the selected week).
  - A concentration line: share of the active filtered population in the five
    largest groups.
- **Display-only cleanup of example names** (underscores, repeated
  punctuation). The tooltip keeps the original. Source text and grouping input
  are untouched.
- **Known consistency item for a future WEEKLY-02 review (not changed here):**
  Weekly Review compares the Data-through week with its typical baseline even
  when the data ends before that week's Sunday.

## FAM-01.3 — UX cleanup from FAM-DIAG-01 (no analytical changes)

FAM-DIAG-01 found no analytical defect; the strictness change was real but
easy to miss, and "Show all" mounted every group at once.

- **Grouping controls above the group list**: strictness and text cleaning in
  one row. The explanatory notes, template frequency level and the similarity
  explorer sit in a collapsed "For analysts" section.
- **Live result line** from the current result and filters:
  "Balanced: 65 groups · 95% one-off". After a change it adds the previous
  setting of this session, recomputed for the current filters, e.g.
  "(Balanced: 65 · 95%)"; after a text-cleaning change it reads "(Before: …)".
- **Busy feedback**: a strictness click updates the selector at once and the
  groups follow in a deferred render ("Updating groups…"). A text-cleaning
  change keeps the last result on screen (dimmed) until the new one arrives.
  Answers to superseded requests are ignored (tested).
- **Group numbers** are secondary text with the tooltip "Group number within
  the current grouping setting".
- **Distribution bar** "Where repeating demand sits": top 5 groups · next 20 ·
  remaining groups · one-off, over the displayed population. Counts reconcile
  exactly; percentages use the largest-remainder method and sum to 100. Empty
  segments are left out. A non-empty segment can show 0% when it is under one
  point (tooltips give the counts).
- **KPI percentages** use the same largest-remainder method (no more 101%).
- **Cards**: 6 at first, "Show 6 more groups" adds 6 (never all at once).
  Order: example name → up to 3 common words → week line → "Last seen" →
  sparkline → handled by / main service → totals. A week the data does not
  fully cover adds "Last fully covered week (<range>): n · typical t · ±Δ".
- **One-off incidents**: one collapsed line; when opened, 20 at a time. A
  group's incident list pages the same way.
- **Quality filter** (sidebar) now narrows this page's displayed population,
  like Month / Service / Offering. It never reaches grouping.
- **Typography**: sans-serif throughout the page, sentence-case section
  titles, no duplicated "Week of" line. The shared filter bar and sidebar are
  unchanged (other pages use them).
- Display performance: the term vectors used for names and common words are
  computed once per text cleaning instead of once per strictness change.
