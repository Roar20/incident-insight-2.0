/**
 * Text variants R0 / R1(τ) / R2(τ) for the experimental Incident Families view,
 * reproducing the frozen C-REAL-04 harness as executed (see
 * `familyParity.test.ts` and the C-REAL-04 implementation notes).
 *
 * R1 and R2 are fitted on the texts they transform — the full loaded dataset.
 *
 * As executed, R2 runs on R1's output, which is already reduced to `\w+`
 * tokens joined by single spaces. The registered EMAIL, URL, GUID, IP, PATH,
 * HOST, DATE and TIME shapes all need punctuation and so can never match
 * there; only HEX, ID and NUM can. This is reproduced as is, not corrected.
 */
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import {
  PY_WORD_CHAR, codePointLength, pyCollapseSpace, pyDigitsToZero, pyLower, pyStrip, pyWords,
} from './pyText';

export type TextVariant = (typeof FAMILIES_RESEARCH.variants)[number];

/** The text a family is built from: what was written when the incident was opened. */
export function openTimeText(shortDescClean: string, descClean: string): string {
  return (shortDescClean || '') + '\n' + (descClean || '');
}

function normalize(text: string): string {
  return pyStrip(pyCollapseSpace(pyLower(text)));
}

function lineKey(line: string): string {
  return pyDigitsToZero(normalize(line));
}

function normToken(token: string): string {
  return pyDigitsToZero(pyLower(token));
}

/** Joins an n-gram into one key; U+0001 never occurs inside a `\w` token. */
const GRAM_SEP = '\u0001';

export interface Templates {
  lines: Set<string>;
  grams: Set<string>;
}

/** Template lines and word n-grams whose document frequency is at least τ. */
export function fitTemplates(texts: string[], tau: number): Templates {
  const n = texts.length;
  const { lineMinTokens, ngramN } = FAMILIES_RESEARCH;
  const lineDf = new Map<string, number>();
  for (const t of texts) {
    const keys = new Set<string>();
    for (const l of t.split('\n')) {
      const k = lineKey(l);
      if (pyWords(k).length >= lineMinTokens) keys.add(k);
    }
    for (const k of keys) lineDf.set(k, (lineDf.get(k) ?? 0) + 1);
  }
  const lines = new Set<string>();
  for (const [k, c] of lineDf) if (c / n >= tau) lines.add(k);

  const gramDf = new Map<string, number>();
  for (const t of texts) {
    const kept = t.split('\n').filter(l => !lines.has(lineKey(l))).join('\n');
    const toks = pyWords(kept).map(normToken);
    const grams = new Set<string>();
    for (let i = 0; i + ngramN <= toks.length; i++) grams.add(toks.slice(i, i + ngramN).join(GRAM_SEP));
    for (const g of grams) gramDf.set(g, (gramDf.get(g) ?? 0) + 1);
  }
  const grams = new Set<string>();
  for (const [g, c] of gramDf) if (c / n >= tau) grams.add(g);
  return { lines, grams };
}

/** R1 before lowercasing: surviving `\w+` tokens, original case, joined by spaces. */
export function applyTemplates(text: string, templates: Templates): string {
  const { ngramN } = FAMILIES_RESEARCH;
  const kept = text.split('\n').filter(l => !templates.lines.has(lineKey(l))).join('\n');
  const words = pyWords(kept);
  const drop = new Uint8Array(words.length);
  if (templates.grams.size > 0) {
    const toks = words.map(normToken);
    for (let i = 0; i + ngramN <= toks.length; i++) {
      if (templates.grams.has(toks.slice(i, i + ngramN).join(GRAM_SEP))) drop.fill(1, i, i + ngramN);
    }
  }
  return words.filter((_, i) => !drop[i]).join(' ');
}

const ASCII_HEX_TOKEN = /^[0-9a-fA-F]{8,}$/;
const HAS_DIGIT = /\p{Nd}/u;
const HAS_ASCII_HEX_LETTER = /[a-fA-F]/;
const ALL_DIGITS = /^\p{Nd}+$/u;
/** Python `[^\W\d_]`: a word character that is not a decimal digit or underscore. */
const WORD_NON_DIGIT = new RegExp(`(?=${PY_WORD_CHAR})[^\\p{Nd}_]`, 'u');

/**
 * The type token a single R1 token becomes under R2, or null when it is kept.
 * R1 tokens are whole `\w` runs, so the harness's `\b…\b` patterns can only
 * ever match a whole token, and are evaluated in its order: HEX, then ID,
 * then NUM.
 */
export function identifierType(token: string): 'hex' | 'id' | 'num' | null {
  if (ASCII_HEX_TOKEN.test(token) && /[0-9]/.test(token) && HAS_ASCII_HEX_LETTER.test(token)) return 'hex';
  if (codePointLength(token) >= 4 && HAS_DIGIT.test(token) && WORD_NON_DIGIT.test(token)) return 'id';
  if (ALL_DIGITS.test(token)) return 'num';
  return null;
}

function neutralizeIdentifiers(r1Raw: string): string {
  if (!r1Raw) return '';
  const out = r1Raw.split(' ').map(tok => {
    const type = identifierType(tok);
    return type ? `tok${type.toUpperCase()}` : tok;
  });
  return normalize(out.join(' '));
}

export interface VariantOptions {
  variant: TextVariant;
  /** Required for R1 and R2. */
  tau?: number;
}

/** The variant texts for a whole population, with templates fitted on that population. */
export function buildVariant(texts: string[], { variant, tau }: VariantOptions): string[] {
  if (variant === 'R0') return texts.map(normalize);
  if (tau === undefined) throw new Error(`${variant} needs a tau`);
  const templates = fitTemplates(texts, tau);
  const r1Raw = texts.map(t => applyTemplates(t, templates));
  if (variant === 'R1') return r1Raw.map(normalize);
  return r1Raw.map(neutralizeIdentifiers);
}
