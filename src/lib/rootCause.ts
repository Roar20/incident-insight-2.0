/**
 * Root-cause detection and extraction.
 *
 * The scorer only asks *whether* a root cause was written down. For problem
 * analysis we also want the cause itself, so the marker phrases live here and
 * both consumers share them.
 */
import { truncate } from './text';

export const ROOT_CAUSE_KW = [
  "root cause", "root-cause", "because", "caused by", "the reason", "identified that",
  "found that", "the issue was", "the problem was", "diagnosis", "traced to",
  "due to", "investigation", "it was determined", "underlying",
  "causa raiz", "causa raíz", "porque", "la razón", "se identificó",
  "se encontró", "causado por", "el problema era", "diagnóstico", "se debe a",
];

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export const ROOT_CAUSE_RE = new RegExp(ROOT_CAUSE_KW.map(escapeRegex).join('|'), 'i');

/** True when the text documents a root cause anywhere. */
export function hasRootCause(text: string): boolean {
  return ROOT_CAUSE_RE.test(text);
}

/** Split prose into sentences, treating newlines and bullets as boundaries too. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+|(?:^|\s)[-•*]\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Return the sentence that states the root cause, or '' if none is documented.
 *
 * The whole sentence is kept rather than the clause after the marker. Splitting
 * "The spooler crashed because of a corrupt driver" at its marker yields "of a
 * corrupt driver", which loses what actually failed — and these strings are read
 * directly off the dashboard, so they have to stand on their own.
 */
export function extractRootCause(text: string): string {
  if (!text) return '';

  for (const sentence of sentences(text)) {
    if (!ROOT_CAUSE_RE.test(sentence)) continue;
    const cleaned = sentence.replace(/^[,:;\-\s]+/, '').trim();
    if (cleaned.length >= 8) return truncate(cleaned, 180);
  }

  return '';
}
