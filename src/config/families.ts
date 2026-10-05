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
  title: 'Repeating Incident Groups (experimental)',
  subtitle: 'Groups of incidents that describe the same kind of issue.',
  banner: 'Experimental. Groups are built automatically from incident text and may change with the grouping setting. Not used by other pages.',
  tooLarge: 'This file is too large for the experimental view',
  computing: 'Building groups…',
  numbersNotUnique: 'Incident numbers are not unique in this file; group IDs are stable only within this file.',
  newThisPeriod: 'New this period',
  cardsTitle: 'Largest repeating groups',
  sortLabel: 'Sort by:',
  sortLabels: { largest: 'Largest overall', selectedWeek: 'Most incidents in selected week' },
  exploratoryDefault: 'Exploratory default — not a selected configuration.',
  coverageMessage: (through: string) => `This file has data through ${through}. Comparison with typical is shown only for weeks fully covered by the data.`,
  noGroupsThisWeek: 'No repeating groups with the current filters.',
  noIncidentsThisWeek: 'No incidents in this week with the current filters.',
  seeIncidents: 'See incidents →',
  showMore: (n: number) => `Show ${n} more ${n === 1 ? 'group' : 'groups'}`,
  showing: (shown: number, total: number) => `showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`,
  showMoreIncidents: (n: number) => `Show ${n} more`,
  oneOffTitle: 'One-off incidents',
  viewIncidents: 'View incidents',
  hideIncidents: 'Hide incidents',
  distributionTitle: 'Where repeating demand sits',
  groupIdTooltip: 'Group number within the current grouping setting',
  updating: 'Updating groups…',
  grouping: 'Grouping',
  commonWords: 'Common words:',
  noService: 'No service recorded',
  noHandlingGroup: 'No handling group recorded',
  mixed: 'mixed',
  analystDetails: 'For analysts',
  strictnessQuestion: 'How strict is the grouping?',
  strictnessLabels: { broader: 'Broader', balanced: 'Balanced', stricter: 'Stricter' },
  strictnessNote: 'Balanced is a starting point, not a recommended setting.',
  textCleaning: 'Text cleaning',
  textCleaningLabels: {
    R0: 'Original text',
    R1: 'Remove repeated templates',
    R2: 'Additional text normalization (experimental)',
  } as Record<TextVariant, string>,
  advanced: 'Advanced',
} as const;
