/**
 * M1: cosine-threshold graph + connected components, for every registered
 * threshold at once.
 *
 * For a pair (i, k) the cosine is accumulated over row i's features in stored
 * order, exactly as SciPy's sparse product does, then clipped to [−1, 1]. An
 * edge exists when cos ≥ s (inclusive). Because the two accumulation orders
 * can differ in the last bit, (i, k) and (k, i) are both evaluated and either
 * one adds the undirected edge, as `connected_components(directed=False)`
 * does on the full matrix.
 */
import type { TfidfMatrix } from './tfidf';

class UnionFind {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Canonical labels: components of size 1 are −1 (singletons); the rest are
 * numbered 0, 1, … by the first row in which each appears.
 */
export function canonicalLabels(component: ArrayLike<number>): Int32Array {
  const n = component.length;
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(component[i], (size.get(component[i]) ?? 0) + 1);
  const relabel = new Map<number, number>();
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = component[i];
    if ((size.get(c) ?? 0) < 2) {
      out[i] = -1;
      continue;
    }
    let l = relabel.get(c);
    if (l === undefined) {
      l = relabel.size;
      relabel.set(c, l);
    }
    out[i] = l;
  }
  return out;
}

/** Canonical M1 labels for each threshold, in the order given. */
export function m1Partitions(matrix: TfidfMatrix, thresholds: readonly number[]): Int32Array[] {
  const n = matrix.rowIds.length;
  const finders = thresholds.map(() => new UnionFind(n));
  const minThreshold = Math.min(...thresholds);
  const acc = new Float64Array(n);
  const touched = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let touchedCount = 0;
    const ids = matrix.rowIds[i];
    const vals = matrix.rowVals[i];
    for (let p = 0; p < ids.length; p++) {
      const x = vals[p];
      const rows = matrix.postingRows[ids[p]];
      const ys = matrix.postingVals[ids[p]];
      for (let q = 0; q < rows.length; q++) {
        const k = rows[q];
        if (!seen[k]) {
          seen[k] = 1;
          touched[touchedCount++] = k;
        }
        acc[k] += x * ys[q];
      }
    }
    for (let t = 0; t < touchedCount; t++) {
      const k = touched[t];
      const cos = Math.min(Math.max(acc[k], -1), 1);
      if (k !== i && cos >= minThreshold) {
        for (let s = 0; s < thresholds.length; s++) if (cos >= thresholds[s]) finders[s].union(i, k);
      }
      acc[k] = 0;
      seen[k] = 0;
    }
  }
  return finders.map(f => {
    const comp = new Int32Array(n);
    for (let i = 0; i < n; i++) comp[i] = f.find(i);
    return canonicalLabels(comp);
  });
}
