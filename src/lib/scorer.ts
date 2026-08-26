import type { EnrichedIncident } from './parser';
import { ROOT_CAUSE_RE } from './rootCause';

export interface DimScores {
  description_quality: number;
  root_cause: number;
  steps_documented: number;
  spelling_grammar: number;
  professionalism: number;
}

export interface IncidentScore {
  number: string;
  totalScore: number;
  label: 'Excellent' | 'Good' | 'Poor' | 'Critical';
  color: string;
  dimScores: DimScores;
  feedback: string[];
  noiseRatio: number;
  noteCount: number;
  noteChars: number;
}

const WEIGHTS = {
  description_quality: 0.25,
  root_cause: 0.25,
  steps_documented: 0.20,
  spelling_grammar: 0.15,
  professionalism: 0.15,
};

const STEPS_KW = [
  "step", "performed", "applied", "executed", "restarted", "reconfigured",
  "updated", "corrected", "fixed", "implemented", "restored", "created",
  "modified", "enabled", "disabled", "solution", "resolved", "workaround",
  "tested", "verified", "confirmed", "action taken", "resolution", "the fix",
  "se realizó", "se aplicó", "se ejecutó", "se reinició", "se actualizó",
  "se corrigió", "se arregló", "se implementó", "solución", "resuelto",
  "se verificó", "se confirmó", "acción tomada",
];

// Pre-compiled regexes for keyword matching (optimization: compiled once at module level)
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const STEPS_RE = new RegExp(STEPS_KW.map(escapeRegex).join('|'), 'i');

const NOISE_PATTERNS = [
  /^hi team[,.]?\s*(please\s+)?(assist|check|help|look into|provide assistance)/i,
  /^please (check|assist|help|look into|take a look)/i,
  /^(hardware\/dispatch|software\/application)\s*\n?\s*\w*\s*$/i,
  /^(na|n\/a)\s*$/i,
  /^predicted ag:/i,
  /^attachment added\s*$/i,
  /^(hi|hello|dear)\s+team/i,
  /this incident will be closed due (yo|to) has been completed/i,
];

const SLANG_PATTERNS: [RegExp, string][] = [
  [/\bwip\b/i, "Filler: WIP"],
  [/\btbd\b/i, "Vague: TBD"],
  [/\bgonna\b/i, "Informal: gonna"],
  [/\bwanna\b/i, "Informal: wanna"],
  [/\bpls\b|\bplz\b/i, "Informal: pls/plz"],
  [/due (yo)\b/i, "Typo: due yo"],
  [/^hi[,.]?\s*team/im, "Generic opener: Hi team"],
  [/please (check|assist|help)\s+the?\s*user/i, "Vague handoff"],
];

function scoreDescription(incident: EnrichedIncident): { score: number; feedback: string[] } {
  const feedback: string[] = [];
  const sd = incident.shortDescClean;
  const desc = incident.descClean;

  let shortScore: number;
  if (sd.length <= 9) { shortScore = 0; feedback.push("Short description is missing or too short."); }
  else if (sd.length <= 24) { shortScore = 40; feedback.push("Short description is too vague."); }
  else if (/^\[.+?\]\[.+?\]/.test(sd)) { shortScore = 60; }
  else { shortScore = 100; }

  let bodyScore: number;
  if (incident.isAutoDesc) { bodyScore = 70; feedback.push("Description is auto-generated from monitoring alert."); }
  else if (desc.length <= 49) { bodyScore = 0; feedback.push("Description is empty or too short."); }
  else if (desc.length <= 149) { bodyScore = 50; feedback.push("Description is brief — add more context."); }
  else { bodyScore = 100; }

  return { score: shortScore * 0.4 + bodyScore * 0.6, feedback };
}

function scoreRootCause(combined: string): { score: number; feedback: string[] } {
  if (ROOT_CAUSE_RE.test(combined)) return { score: 100, feedback: [] };
  return { score: 0, feedback: ["No root cause documented."] };
}

function scoreSteps(combined: string, state: string): { score: number; feedback: string[] } {
  if (STEPS_RE.test(combined)) return { score: 100, feedback: [] };
  const closed = ['closed', 'resolved'].includes(state.toLowerCase());
  if (closed) return { score: 0, feedback: ["Closed without documenting resolution steps."] };
  return { score: 30, feedback: ["No resolution steps documented yet."] };
}

function scoreSpelling(combined: string): { score: number; feedback: string[] } {
  const words = combined.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return { score: 95, feedback: [] };
  let suspicious = 0;
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!lower) continue;
    if (/(.)\1{2,}/.test(lower)) { suspicious++; continue; }
    if (/[bcdfghjklmnpqrstvwxyz]{5,}$/.test(lower)) { suspicious++; continue; }
    if (lower.length <= 5 && !/[aeiou]/.test(lower) && lower.length > 2) { suspicious++; }
  }
  const ratio = suspicious / words.length;
  if (ratio < 0.03) return { score: 95, feedback: [] };
  if (ratio < 0.08) return { score: 75, feedback: [] };
  if (ratio < 0.15) return { score: 55, feedback: ["Some spelling issues detected."] };
  return { score: 30, feedback: ["Significant spelling issues detected."] };
}

function scoreProfessionalism(incident: EnrichedIncident): { score: number; feedback: string[]; noiseRatio: number } {
  const feedback: string[] = [];
  const humanNotes = incident.humanNotes;
  let issueCount = 0;
  const combined = [incident.descClean, ...humanNotes.map(n => n.text)].join('\n');

  for (const [pat, msg] of SLANG_PATTERNS) {
    if (pat.test(combined)) { issueCount++; feedback.push(msg); }
  }

  let noiseEntries = 0;
  for (const n of humanNotes) {
    if (NOISE_PATTERNS.some(p => p.test(n.text)) || n.text.length < 12) noiseEntries++;
  }
  const noiseRatio = humanNotes.length > 0 ? noiseEntries / humanNotes.length : 0;
  const score = Math.max(0, 100 - issueCount * 15 - noiseRatio * 60);
  if (humanNotes.length === 0) feedback.push("No human work notes found.");
  return { score, feedback, noiseRatio };
}

function getLabel(score: number): { label: IncidentScore['label']; color: string } {
  if (score >= 80) return { label: 'Excellent', color: 'hsl(152, 69%, 42%)' };
  if (score >= 55) return { label: 'Good', color: 'hsl(43, 96%, 56%)' };
  if (score >= 30) return { label: 'Poor', color: 'hsl(16, 85%, 57%)' };
  return { label: 'Critical', color: 'hsl(0, 72%, 55%)' };
}

export function scoreIncident(incident: EnrichedIncident): IncidentScore {
  const combined = [incident.descClean, ...incident.humanNotes.map(n => n.text)].join('\n');
  const noteChars = incident.humanNotes.reduce((s, n) => s + n.text.length, 0);

  const desc = scoreDescription(incident);
  const rc = scoreRootCause(combined);
  const steps = scoreSteps(combined, incident.State);
  const spell = scoreSpelling(combined);
  const prof = scoreProfessionalism(incident);

  const dimScores: DimScores = {
    description_quality: Math.round(desc.score),
    root_cause: rc.score,
    steps_documented: steps.score,
    spelling_grammar: spell.score,
    professionalism: Math.round(prof.score),
  };

  const totalScore = Math.round(
    dimScores.description_quality * WEIGHTS.description_quality +
    dimScores.root_cause * WEIGHTS.root_cause +
    dimScores.steps_documented * WEIGHTS.steps_documented +
    dimScores.spelling_grammar * WEIGHTS.spelling_grammar +
    dimScores.professionalism * WEIGHTS.professionalism
  );

  const { label, color } = getLabel(totalScore);
  const feedback = [...desc.feedback, ...rc.feedback, ...steps.feedback, ...spell.feedback, ...prof.feedback];

  return {
    number: incident.Number,
    totalScore,
    label,
    color,
    dimScores,
    feedback,
    noiseRatio: prof.noiseRatio,
    noteCount: incident.humanNotes.length,
    noteChars,
  };
}

export function scoreAll(incidents: EnrichedIncident[]): IncidentScore[] {
  return incidents.map(scoreIncident);
}
