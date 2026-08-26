/**
 * Shared text normalisation used by problem clustering and root-cause grouping.
 *
 * The goal is to reduce an incident's wording to the terms that identify *what
 * broke*, so that two reports of the same underlying problem collapse to the
 * same signature despite different phrasing, ticket numbers and user names.
 */

/** Words that carry no signal about which problem a ticket describes. */
const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'new', 'now', 'old',
  'see', 'two', 'way', 'who', 'boy', 'did', 'she', 'use', 'their', 'will', 'with',
  'this', 'that', 'from', 'they', 'been', 'have', 'more', 'when', 'some', 'them',
  'than', 'then', 'were', 'what', 'your', 'about', 'there', 'would', 'could', 'should',
  'please', 'thanks', 'thank', 'hello', 'team', 'hi', 'dear', 'regards', 'kindly',
  'need', 'needs', 'needed', 'want', 'wants', 'help', 'assist', 'assistance', 'support',
  'issue', 'issues', 'problem', 'problems', 'incident', 'ticket', 'request', 'case',
  'user', 'users', 'customer', 'employee', 'staff', 'client', 'end',
  'unable', 'cannot', 'cant', 'doesnt', 'does', 'not', 'working', 'work', 'works',
  'reported', 'reports', 'report', 'reporting', 'says', 'said', 'getting', 'gets',
  'received', 'receive', 'receiving', 'seeing', 'sees', 'having', 'having',
  'via', 'due', 'after', 'before', 'during', 'while', 'because', 'since',
  // Spanish
  'que', 'con', 'por', 'para', 'los', 'las', 'del', 'una', 'uno', 'como', 'esta',
  'este', 'esto', 'esa', 'ese', 'son', 'sus', 'pero', 'mas', 'muy', 'todo', 'toda',
  'usuario', 'usuarios', 'favor', 'gracias', 'hola', 'equipo', 'ayuda', 'apoyo',
  'problema', 'problemas', 'incidente', 'solicitud', 'puede', 'puedo', 'tiene',
  'presenta', 'reporta', 'reporte', 'indica', 'menciona',
]);

/** Looks like a ticket id, asset tag, hostname or other per-instance identifier. */
function isIdentifier(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  // Mixed letters and digits, e.g. inc0012345, ws-4471a, srv12
  return /[a-z]/.test(token) && /\d/.test(token);
}

/**
 * Reduce text to its significant lowercase terms.
 *
 * Drops punctuation, stopwords, per-instance identifiers and very short words so
 * that "INC0012345 - User john.doe cannot connect to VPN" and "VPN connection
 * failing for remote users" share the terms that matter.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/\[url\]/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t) && !isIdentifier(t));
}

/** Distinct tokens of `text`, order-independent. */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Overlap of two token sets: |A ∩ B| / |A ∪ B|. Returns 0 for empty input. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * A stable key for near-identical sentences, used to count how often the same
 * root cause is written down across incidents.
 */
export function normalizedKey(text: string): string {
  return [...new Set(tokenize(text))].sort().join(' ');
}

/** Collapse whitespace and trim to `max` characters on a word boundary. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}
