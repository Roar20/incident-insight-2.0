/**
 * Experimental Incident Families: M1 over word TF-IDF, once over the full
 * loaded dataset, for one text variant and every registered threshold.
 *
 * Family classification is a property of the full dataset and never of a
 * filtered view: a family is a connected component with full-dataset size
 * ≥ 2, a singleton one of size 1.
 */
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import { m1Partitions } from './m1';
import { wordTfidf } from './tfidf';
import { buildVariant, type TextVariant } from './variants';

export interface FamilyRequest {
  /** Open-time texts of the full loaded dataset, in dataset order. */
  texts: string[];
  variant: TextVariant;
  /** R1/R2 only; must be a registered tau. */
  tau?: number;
}

export interface FamilyPartitions {
  variant: TextVariant;
  tau: number | null;
  /** Registered thresholds, ascending. */
  thresholds: number[];
  /** Canonical labels per threshold: −1 = singleton, else family index. */
  labels: Int32Array[];
}

export function assertRegistered(variant: TextVariant, tau?: number): void {
  if (!FAMILIES_RESEARCH.variants.includes(variant)) throw new Error(`Unregistered variant ${variant}`);
  if (variant !== 'R0' && !FAMILIES_RESEARCH.taus.includes(tau as never)) throw new Error(`Unregistered tau ${tau}`);
}

export function computeFamilyPartitions({ texts, variant, tau }: FamilyRequest): FamilyPartitions {
  assertRegistered(variant, tau);
  const thresholds = [...FAMILIES_RESEARCH.thresholds];
  const docs = buildVariant(texts, { variant, tau });
  const labels = m1Partitions(wordTfidf(docs), thresholds);
  return { variant, tau: variant === 'R0' ? null : tau!, thresholds, labels };
}
