/**
 * Experimental Incident Families (FAM-01): research parameters, display
 * defaults and copy.
 *
 * FAMILIES_RESEARCH (config/familiesResearch.ts) is the registered C-REAL-04
 * grid, not a product choice: the view only offers those values. The default
 * threshold is a UI convenience — the middle value of the registered grid as
 * C-REAL-04 defined it — not a selected threshold.
 */
import { FAMILIES_RESEARCH } from './familiesResearch';
import { FAMILIES_DISPLAY } from './familiesDisplay';

export { FAMILIES_RESEARCH, FAMILIES_DISPLAY };

type TextVariant = (typeof FAMILIES_RESEARCH.variants)[number];

export const FAMILIES_CONFIG_VERSION = '0.1.0-experimental';

/** The view and its computation exist only in builds with VITE_EXPERIMENTAL_FAMILIES=on. Read at render time. */
export function familiesEnabled(): boolean {
  return import.meta.env.VITE_EXPERIMENTAL_FAMILIES === 'on';
}

export const FAMILIES_COPY = {
  title: 'Incident Families (experimental)',
  subtitle: 'Explore stable groups of similar incidents across thresholds.',
  banner: 'Experimental research view. Families are research candidates; boundaries depend on the selected threshold. Not used by other pages.',
  defaultLabel: 'Exploratory default — not a selected threshold.',
  tooLarge: 'This file is too large for the experimental view',
  numbersNotUnique: 'Incident numbers are not unique in this file; family IDs are stable only within this file.',
  newThisPeriod: 'New this period',
  recurring: 'Recurring pattern',
  variantLabels: {
    R0: 'R0 — raw open-time text',
    R1: 'R1 — repeated boilerplate removed',
    R2: 'R2 — boilerplate removed, identifiers replaced',
  } as Record<TextVariant, string>,
} as const;
