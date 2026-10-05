/**
 * Word TF-IDF (1–2 grams) reproducing scikit-learn's `TfidfVectorizer` as the
 * C-REAL-04 harness configured it — `token_pattern=(?u)\b\w\w+\b`,
 * `lowercase`, `sublinear_tf`, smooth idf, l2 norm, `min_df=1` — down to the
 * floating-point summation order, so cosine thresholds decide exactly as there.
 *
 * Layout matters for bit-exactness. scikit-learn stores each row's features
 * in the order their term first appeared anywhere in the corpus (not
 * alphabetically), and both the l2 norm and the sparse product accumulate in
 * that stored order. Rows here keep the same order.
 */
import { pyLower } from './pyText';

/** Python `(?u)\b\w\w+\b`: maximal runs of two or more word characters. */
const TOKEN = /[\p{L}\p{N}_]{2,}/gu;

function features(doc: string): string[] {
  const tokens = pyLower(doc).match(TOKEN) ?? [];
  const out = tokens.slice();
  for (let i = 0; i + 1 < tokens.length; i++) out.push(tokens[i] + ' ' + tokens[i + 1]);
  return out;
}

export interface TfidfMatrix {
  /** Per row: feature ids in stored order (first appearance in the corpus). */
  rowIds: Int32Array[];
  rowVals: Float64Array[];
  /** Per feature: rows containing it, ascending, and the row's weight. */
  postingRows: Int32Array[];
  postingVals: Float64Array[];
  featureCount: number;
}

export function wordTfidf(docs: string[]): TfidfMatrix {
  const n = docs.length;
  const firstSeen = new Map<string, number>();
  const rowCounts: Map<number, number>[] = [];
  for (const doc of docs) {
    const counts = new Map<number, number>();
    for (const f of features(doc)) {
      let id = firstSeen.get(f);
      if (id === undefined) {
        id = firstSeen.size;
        firstSeen.set(f, id);
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    rowCounts.push(counts);
  }
  const featureCount = firstSeen.size;
  const df = new Int32Array(featureCount);
  for (const counts of rowCounts) for (const id of counts.keys()) df[id]++;
  const idf = new Float64Array(featureCount);
  for (let j = 0; j < featureCount; j++) idf[j] = Math.log((n + 1) / (df[j] + 1)) + 1;

  const rowIds: Int32Array[] = [];
  const rowVals: Float64Array[] = [];
  for (const counts of rowCounts) {
    const ids = Int32Array.from(counts.keys()).sort();
    const vals = new Float64Array(ids.length);
    let sum = 0;
    for (let p = 0; p < ids.length; p++) {
      const x = (Math.log(counts.get(ids[p])!) + 1) * idf[ids[p]];
      vals[p] = x;
      sum += x * x;
    }
    if (sum !== 0) {
      const norm = Math.sqrt(sum);
      for (let p = 0; p < vals.length; p++) vals[p] /= norm;
    }
    rowIds.push(ids);
    rowVals.push(vals);
  }

  const postingRows = Array.from({ length: featureCount }, (_, j) => new Int32Array(df[j]));
  const postingVals = Array.from({ length: featureCount }, (_, j) => new Float64Array(df[j]));
  const fill = new Int32Array(featureCount);
  for (let i = 0; i < n; i++) {
    const ids = rowIds[i];
    const vals = rowVals[i];
    for (let p = 0; p < ids.length; p++) {
      const j = ids[p];
      postingRows[j][fill[j]] = i;
      postingVals[j][fill[j]] = vals[p];
      fill[j]++;
    }
  }
  return { rowIds, rowVals, postingRows, postingVals, featureCount };
}
