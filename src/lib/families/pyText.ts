/**
 * Python `re` / `str` semantics the C-REAL-04 harness relied on, ported so the
 * experimental families reproduce its partitions exactly.
 *
 * JavaScript's `\w`, `\d`, `\s` and `trim()` are ASCII-only or use a different
 * whitespace set; Python's are Unicode-aware. Each helper below states the
 * Python construct it reproduces.
 */

/** Python `\w` on `str`: `str.isalnum()` or underscore. */
export const PY_WORD_CHAR = '[\\p{L}\\p{N}_]';

/** Python `\w+`. */
export const PY_WORD_RUN = new RegExp(`${PY_WORD_CHAR}+`, 'gu');

/** Python `\d+` (Unicode decimal digits). */
const PY_DIGIT_RUN = /\p{Nd}+/gu;

/** The characters for which Python's `str.isspace()` is true. */
const PY_SPACE_CLASS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const PY_SPACE_RUN = new RegExp(`${PY_SPACE_CLASS}+`, 'gu');
const PY_LEADING_SPACE = new RegExp(`^${PY_SPACE_CLASS}+`, 'u');
const PY_TRAILING_SPACE = new RegExp(`${PY_SPACE_CLASS}+$`, 'u');

/** Python `str.strip()` with no arguments. */
export function pyStrip(text: string): string {
  return text.replace(PY_LEADING_SPACE, '').replace(PY_TRAILING_SPACE, '');
}

/** Python `re.sub(r'\s+', ' ', text)`. */
export function pyCollapseSpace(text: string): string {
  return text.replace(PY_SPACE_RUN, ' ');
}

/** Python `re.sub(r'\d+', '0', text)`. */
export function pyDigitsToZero(text: string): string {
  return text.replace(PY_DIGIT_RUN, '0');
}

/** Python `re.findall(r'\w+', text)`. */
export function pyWords(text: string): string[] {
  return text.match(PY_WORD_RUN) ?? [];
}

/** Python `str.lower()`. Both follow the Unicode default case mapping. */
export function pyLower(text: string): string {
  return text.toLowerCase();
}

/** Number of code points, as Python's `len(str)`. */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Python's ordering of `str` values: by code point, not UTF-16 unit. */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}
