/**
 * Recurring-problem detection and root-cause analysis.
 *
 * Incidents are grouped into *problems*: sets of tickets that describe the same
 * underlying failure. For each problem we surface how often it recurs, how many
 * distinct weeks it spans, what causes were actually written down, and how much
 * of it is documented at all — which is what turns a ticket list into a problem
 * management backlog.
 */
import type { EnrichedIncident } from './parser';
import type { IncidentScore } from './scorer';
import { categorize } from './taxonomy';
import { extractRootCause } from './rootCause';
import { jaccard, normalizedKey, tokenize, truncate } from './text';
import { resolutionHours, weekKey } from './periods';

export interface AnnotatedIncident extends EnrichedIncident {
  /** Service category from the keyword taxonomy. */
  category: string;
  /** Identifier of the problem cluster this incident belongs to. */
  clusterId: string;
  /** The documented root cause, or '' when none was written down. */
  rootCauseText: string;
  /** Hours from Opened to Closed, or null when still open / undated. */
  resolutionHours: number | null;
  /** ISO week the incident was opened, or ''. */
  week: string;
  isClosed: boolean;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface RootCauseEntry {
  text: string;
  count: number;
  pct: number;
}

export interface ProblemCluster {
  id: string;
  /** The most common short description in the cluster. */
  title: string;
  category: string;
  count: number;
  /** Share of the incident set this problem accounts for. */
  share: number;
  weeksActive: number;
  firstSeen: string;
  lastSeen: string;
  /** Recurs across enough distinct weeks to be a standing problem, not a blip. */
  isChronic: boolean;
  rootCauses: RootCauseEntry[];
  documentedCount: number;
  /** Percentage of the cluster's incidents with a documented root cause. */
  rcaCoverage: number;
  medianResolutionHours: number | null;
  /** Percentage of resolved incidents that missed SLA, or null if none records Made SLA. */
  slaBreachPct: number | null;
  avgScore: number;
  topGroups: NamedCount[];
  topAgents: NamedCount[];
  /** A sample of incident numbers, for drilling in. */
  sampleNumbers: string[];
}

export interface CategoryStat {
  name: string;
  count: number;
  share: number;
  distinctProblems: number;
  rcaCoverage: number;
  medianResolutionHours: number | null;
  slaBreachPct: number | null;
  avgScore: number;
}

export type ActionKind = 'problem-management' | 'automation' | 'knowledge-gap' | 'chronic';

export interface ProblemAction {
  kind: ActionKind;
  title: string;
  cluster: ProblemCluster;
  reason: string;
}

/** Minimum Jaccard overlap for two incidents to be the same problem. */
const SIMILARITY_THRESHOLD = 0.5;

/** Tokens present in more than this share of incidents are too generic to index on. */
const MAX_INDEX_DOC_FREQUENCY = 0.2;

/**
 * Every cluster is indexed under at least this many of its rarest terms,
 * whatever their document frequency. Without this floor a corpus where one
 * phrasing dominates would index nothing at all.
 */
const MIN_INDEXED_TOKENS = 2;

/** Candidate clusters compared per incident, highest shared-token count first. */
const MAX_CANDIDATES = 40;

/** Distinct weeks a problem must span before it counts as chronic. */
const CHRONIC_WEEKS = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function topCounts(values: string[], limit: number): NamedCount[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * The text used to identify a problem.
 *
 * The short description is what a human wrote to summarise the failure; the body
 * is only used when it is missing, and truncated so a long auto-generated alert
 * does not swamp the signature with boilerplate.
 */
function signatureText(incident: EnrichedIncident): string {
  const short = incident.shortDescClean.trim();
  if (short.length >= 8) return short;
  return incident.descClean.slice(0, 200);
}

/**
 * Attach category, root cause, resolution time and problem cluster to each
 * incident.
 *
 * Clustering is corpus-level, so this runs once over the whole dataset (in the
 * worker) rather than per filter change. Incidents are mutated in place and the
 * same array is returned, to avoid duplicating a large dataset in memory.
 */
export function annotateIncidents(incidents: EnrichedIncident[]): AnnotatedIncident[] {
  const annotated = incidents as AnnotatedIncident[];
  const tokenSets: Set<string>[] = new Array(incidents.length);
  const docFrequency = new Map<string, number>();

  for (let i = 0; i < annotated.length; i++) {
    const inc = annotated[i];
    const state = inc.State.toLowerCase();

    inc.category = categorize(inc.shortDescClean, inc.descClean);
    inc.rootCauseText = extractRootCause(
      [inc.descClean, ...inc.humanNotes.map(n => n.text)].join('\n'),
    );
    inc.resolutionHours = resolutionHours(inc.Opened, inc.Closed);
    inc.week = weekKey(inc.Opened);
    inc.isClosed = state.includes('closed') || state.includes('resolved');
    inc.clusterId = '';

    const tokens = new Set(tokenize(signatureText(inc)));
    tokenSets[i] = tokens;
    for (const t of tokens) docFrequency.set(t, (docFrequency.get(t) ?? 0) + 1);
  }

  const indexCeiling = Math.max(2, Math.floor(annotated.length * MAX_INDEX_DOC_FREQUENCY));

  interface Bucket { id: string; tokens: Set<string>; category: string }
  const buckets: Bucket[] = [];
  // token -> indices into `buckets`, used to find candidates without an O(n²) scan
  const index = new Map<string, number[]>();
  const shared = new Map<number, number>();

  for (let i = 0; i < annotated.length; i++) {
    const inc = annotated[i];
    const tokens = tokenSets[i];

    if (tokens.size === 0) {
      // Nothing distinctive to match on — a singleton, not a recurring problem.
      inc.clusterId = `solo-${i}`;
      continue;
    }

    shared.clear();
    for (const token of tokens) {
      const postings = index.get(token);
      if (!postings) continue;
      for (const b of postings) shared.set(b, (shared.get(b) ?? 0) + 1);
    }

    let best = -1;
    let bestScore = SIMILARITY_THRESHOLD;
    const candidates = [...shared.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANDIDATES);

    for (const [bucketIdx] of candidates) {
      const bucket = buckets[bucketIdx];
      if (bucket.category !== inc.category) continue;
      const score = jaccard(tokens, bucket.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = bucketIdx;
      }
    }

    if (best >= 0) {
      inc.clusterId = buckets[best].id;
      continue;
    }

    // Seed a new cluster. Its token set stays fixed so clusters cannot drift and
    // gradually absorb unrelated tickets as they grow.
    const bucketIdx = buckets.length;
    const id = `p-${bucketIdx}`;
    buckets.push({ id, tokens, category: inc.category });
    inc.clusterId = id;

    // Index the cluster under its rarest terms first. Very common terms are
    // skipped to keep posting lists short, but a cluster whose terms are *all*
    // common still gets indexed under its two rarest — otherwise it would be
    // unreachable and every later incident would start a duplicate cluster.
    const byRarity = [...tokens].sort(
      (a, b) => (docFrequency.get(a) ?? 0) - (docFrequency.get(b) ?? 0),
    );
    for (let rank = 0; rank < byRarity.length; rank++) {
      const token = byRarity[rank];
      if (rank >= MIN_INDEXED_TOKENS && (docFrequency.get(token) ?? 0) > indexCeiling) continue;
      const postings = index.get(token);
      if (postings) postings.push(bucketIdx);
      else index.set(token, [bucketIdx]);
    }
  }

  return annotated;
}

/**
 * Aggregate annotated incidents into ranked problems.
 *
 * Works over any subset, so month and week filters re-aggregate cheaply without
 * re-clustering. `minCount` drops one-off tickets from the recurring view.
 */
export function computeProblemClusters(
  incidents: AnnotatedIncident[],
  scores: IncidentScore[],
  minCount = 2,
): ProblemCluster[] {
  if (incidents.length === 0) return [];

  const scoreMap = new Map(scores.map(s => [s.number, s]));
  const groups = new Map<string, AnnotatedIncident[]>();
  for (const inc of incidents) {
    const list = groups.get(inc.clusterId);
    if (list) list.push(inc);
    else groups.set(inc.clusterId, [inc]);
  }

  const total = incidents.length;
  const clusters: ProblemCluster[] = [];

  for (const [id, members] of groups) {
    if (members.length < minCount) continue;

    const weeks = new Set<string>();
    const opened: string[] = [];
    const causeByKey = new Map<string, { text: string; count: number }>();
    const durations: number[] = [];
    let documented = 0;
    let slaTracked = 0;
    let slaBreached = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const inc of members) {
      if (inc.week) weeks.add(inc.week);
      if (inc.Opened) opened.push(inc.Opened);

      if (inc.rootCauseText) {
        documented++;
        const key = normalizedKey(inc.rootCauseText) || inc.rootCauseText.toLowerCase();
        const entry = causeByKey.get(key);
        if (entry) entry.count++;
        else causeByKey.set(key, { text: inc.rootCauseText, count: 1 });
      }

      if (inc.resolutionHours !== null) durations.push(inc.resolutionHours);

      if (inc.isClosed && inc['Made SLA'] !== null) {
        slaTracked++;
        if (inc['Made SLA'] === false) slaBreached++;
      }

      const score = scoreMap.get(inc.Number);
      if (score) {
        scoreSum += score.totalScore;
        scoreCount++;
      }
    }

    opened.sort();
    const rootCauses = [...causeByKey.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(c => ({ text: c.text, count: c.count, pct: pct(c.count, members.length) }));

    clusters.push({
      id,
      title: truncate(topCounts(members.map(m => m.shortDescClean), 1)[0]?.name || members[0].shortDescClean || '(no short description)', 110),
      category: members[0].category,
      count: members.length,
      share: pct(members.length, total),
      weeksActive: weeks.size,
      firstSeen: opened[0] ?? '',
      lastSeen: opened[opened.length - 1] ?? '',
      isChronic: weeks.size >= CHRONIC_WEEKS && members.length >= CHRONIC_WEEKS,
      rootCauses,
      documentedCount: documented,
      rcaCoverage: pct(documented, members.length),
      medianResolutionHours: median(durations),
      slaBreachPct: slaTracked > 0 ? pct(slaBreached, slaTracked) : null,
      avgScore: scoreCount > 0 ? round1(scoreSum / scoreCount) : 0,
      topGroups: topCounts(members.map(m => m['Assignment group'] || 'Unassigned'), 3),
      topAgents: topCounts(members.map(m => m['Assigned to'] || 'Unassigned'), 3),
      sampleNumbers: members.slice(0, 25).map(m => m.Number),
    });
  }

  return clusters.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** Roll incidents up by service category. */
export function computeCategoryStats(
  incidents: AnnotatedIncident[],
  scores: IncidentScore[],
): CategoryStat[] {
  if (incidents.length === 0) return [];

  const scoreMap = new Map(scores.map(s => [s.number, s]));
  const groups = new Map<string, AnnotatedIncident[]>();
  for (const inc of incidents) {
    const list = groups.get(inc.category);
    if (list) list.push(inc);
    else groups.set(inc.category, [inc]);
  }

  const total = incidents.length;
  return [...groups.entries()]
    .map(([name, members]) => {
      const durations = members.filter(m => m.resolutionHours !== null).map(m => m.resolutionHours!);
      const closed = members.filter(m => m.isClosed);
      const slaTracked = closed.filter(m => m['Made SLA'] !== null);
      const breached = slaTracked.filter(m => m['Made SLA'] === false).length;
      const scored = members.map(m => scoreMap.get(m.Number)).filter(Boolean) as IncidentScore[];

      return {
        name,
        count: members.length,
        share: pct(members.length, total),
        distinctProblems: new Set(members.map(m => m.clusterId)).size,
        rcaCoverage: pct(members.filter(m => m.rootCauseText).length, members.length),
        medianResolutionHours: median(durations),
        slaBreachPct: slaTracked.length > 0 ? pct(breached, slaTracked.length) : null,
        avgScore: scored.length ? round1(scored.reduce((a, s) => a + s.totalScore, 0) / scored.length) : 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Turn the problem list into a prioritised set of recommendations.
 *
 * Each rule answers a different operational question: what should become a
 * problem record, what should be automated away, and where the team disagrees
 * about why something breaks.
 */
export function recommendActions(clusters: ProblemCluster[], totalIncidents: number): ProblemAction[] {
  // Scale the "worth acting on" bar with the dataset so a small export still
  // produces recommendations and a large one is not swamped by them.
  const volumeFloor = Math.max(3, Math.round(totalIncidents * 0.01));
  const actions: ProblemAction[] = [];

  for (const cluster of clusters) {
    if (cluster.count < volumeFloor) continue;

    if (cluster.rcaCoverage < 50) {
      actions.push({
        kind: 'problem-management',
        title: 'Raise a problem record',
        cluster,
        reason: `${cluster.count} incidents but only ${cluster.rcaCoverage}% document a cause — the team is re-fixing this without learning why.`,
      });
      continue;
    }

    if (cluster.medianResolutionHours !== null && cluster.medianResolutionHours <= 2 && cluster.count >= volumeFloor) {
      actions.push({
        kind: 'automation',
        title: 'Automation or self-service candidate',
        cluster,
        reason: `${cluster.count} incidents, typically resolved in under two hours and well understood — high volume of low-value toil.`,
      });
      continue;
    }

    const dominant = cluster.rootCauses[0];
    if (cluster.rootCauses.length >= 3 && dominant && dominant.pct < 40) {
      actions.push({
        kind: 'knowledge-gap',
        title: 'Inconsistent diagnosis',
        cluster,
        reason: `${cluster.rootCauses.length}+ different causes recorded for the same symptom, none covering more than ${dominant.pct}% — likely a knowledge gap.`,
      });
      continue;
    }

    if (cluster.isChronic) {
      actions.push({
        kind: 'chronic',
        title: 'Chronic recurring problem',
        cluster,
        reason: `Present in ${cluster.weeksActive} separate weeks — recurring rather than a one-off spike.`,
      });
    }
  }

  const priority: Record<ActionKind, number> = {
    'problem-management': 0,
    chronic: 1,
    automation: 2,
    'knowledge-gap': 3,
  };

  return actions.sort((a, b) =>
    priority[a.kind] - priority[b.kind] || b.cluster.count - a.cluster.count);
}
