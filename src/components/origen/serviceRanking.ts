import { fraction, topWithOthers, type DimensionTable } from '@/lib/serviceDimension';
import { toggleSelectionMissing, toggleSelectionValue, type DimensionSelection } from '@/lib/problemView';

/** A ranked Service, the display-only "Others" bucket, or the missing-value state. */
export type RankingBarKind = 'service' | 'others' | 'missing';

export interface RankingBar {
  /** Unique within the chart; Services use their own name. */
  key: string;
  kind: RankingBarKind;
  /** The Service name, or null for Others and No Service. */
  service: string | null;
  incidents: number;
  /** incidents / visible incidents — the same share the By Service table shows. */
  shareOfVisible: number | null;
  /** For Others: how many Services it groups. */
  entries?: number;
}

export interface ServiceRanking {
  /** Ranked Services first (the table's order), then Others, then No Service. */
  bars: RankingBar[];
  visible: number;
}

export const OTHERS_KEY = '__others__';
export const MISSING_KEY = '__missing__';

/**
 * The bars of "Where is the noise?", read straight from the By Service table.
 *
 * The table's rows are already ranked (incidents descending, equal counts in
 * name order), so the chart keeps that order and only cuts it at `limit`. The
 * rest is one display-only "Others" bar; incidents with no Service stay a
 * separate bar and never take part in the ranking.
 */
export function serviceRanking(table: DimensionTable, limit: number): ServiceRanking {
  const { shown, others } = topWithOthers(table.rows, limit);
  const bars: RankingBar[] = shown.map(row => ({
    key: row.value as string,
    kind: 'service',
    service: row.value,
    incidents: row.incidents,
    shareOfVisible: row.shareOfVisible,
  }));
  if (others) {
    bars.push({ key: OTHERS_KEY, kind: 'others', service: null, incidents: others.incidents, shareOfVisible: fraction(others.incidents, table.visible), entries: others.entries });
  }
  if (table.missing) {
    bars.push({ key: MISSING_KEY, kind: 'missing', service: null, incidents: table.missing.incidents, shareOfVisible: table.missing.shareOfVisible });
  }
  return { bars, visible: table.visible };
}

/**
 * The Service filter after a click on a bar, using the global filter's own
 * multi-select toggle, or null when the bar cannot be selected (Others).
 */
export function selectionAfterBarClick(bar: RankingBar, selection: DimensionSelection): DimensionSelection | null {
  if (bar.kind === 'service') return toggleSelectionValue(selection, bar.service as string);
  if (bar.kind === 'missing') return toggleSelectionMissing(selection);
  return null;
}
