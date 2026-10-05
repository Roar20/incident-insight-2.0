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
