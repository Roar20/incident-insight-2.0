import * as XLSX from "xlsx";

// --- Inline parser ---
const NOTE_RE =
  /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*-\s*(.+?)\s*\(Work notes\)\n(.*?)(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*-|$)/gs;

const SYSTEM_PHRASES = [
  "sent communication to", "could not contact", "task is created by system",
  "escalation is in progress", "escalate in", "faq on alerts",
  "predicted ag:", "attachment added", "why was this incident created",
  "how is the priority", "confidence:",
];

const AUTO_DESC_KW = [
  "we have identified unusually", "alert triggered at", "usage overview",
  "cluster name", "namespace :", "container name:", "pod name:",
  "document count:", "conditions met:", "links for investigation",
];

function cleanText(text) {
  if (!text) return "";
  let t = text;
  t = t.replace(/_x000D_/g, "\n");
  t = t.replace(/\[\/?(code)\]/g, "");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/https?:\/\/\S+/g, "[URL]");
  t = t.replace(/nav_to\.do\S+/g, "[URL]");
  t = t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, "");
  t = t.replace(/\s{3,}/g, "  ");
  return t.trim();
}

function isSystemText(text) {
  const t = text.toLowerCase();
  return SYSTEM_PHRASES.some((p) => t.includes(p));
}

function isAutoDescription(text) {
  const t = (text || "").toLowerCase();
  return AUTO_DESC_KW.some((k) => t.includes(k));
}

function parseNotes(raw) {
  if (!raw || typeof raw !== "string") return [];
  const entries = [];
  let match;
  NOTE_RE.lastIndex = 0;
  while ((match = NOTE_RE.exec(raw)) !== null) {
    const [, ts, author, body] = match;
    const text = cleanText(body);
    const isSystem = author.trim().toLowerCase() === "system" || isSystemText(text);
    entries.push({ timestamp: ts.trim(), author: author.trim(), text, isSystem });
  }
  if (entries.length === 0 && raw.trim()) {
    entries.push({ timestamp: "", author: "Unknown", text: cleanText(raw), isSystem: false });
  }
  return entries;
}

function col(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  return "";
}

function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + value * 86400000;
    const d = new Date(ms);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(value);
}

function enrichRow(row) {
  const shortDesc = String(col(row, "Short description", "short_description"));
  const desc = String(col(row, "Description", "description"));
  const workNotes = String(col(row, "Work notes", "work_notes"));
  const allNotes = parseNotes(workNotes);
  const humanNotes = allNotes.filter((n) => !n.isSystem);

  return {
    Number: String(col(row, "Number", "number")),
    "Task type": String(col(row, "Task type", "sys_class_name") || "Incident"),
    Priority: String(col(row, "Priority", "priority")),
    State: String(col(row, "State", "state")),
    "Short description": shortDesc,
    Description: desc,
    "Work notes": workNotes,
    "Assignment group": String(col(row, "Assignment group", "assignment_group")),
    "Assigned to": String(col(row, "Assigned to", "assigned_to")),
    Opened: normalizeDate(col(row, "Opened", "opened_at")),
    Closed: normalizeDate(col(row, "Closed", "closed_at")),
    Channel: String(col(row, "Channel", "contact_type")),
    "Made SLA": Boolean(col(row, "Made SLA", "made_sla")),
    shortDescClean: cleanText(shortDesc),
    descClean: cleanText(desc),
    allNotes,
    humanNotes,
    isAutoDesc: isAutoDescription(desc),
  };
}

// --- Inline scorer ---
const WEIGHTS = {
  description_quality: 0.25, root_cause: 0.25, steps_documented: 0.2,
  spelling_grammar: 0.15, professionalism: 0.15,
};

const ROOT_CAUSE_KW = [
  "root cause", "root-cause", "because", "caused by", "the reason",
  "identified that", "found that", "the issue was", "the problem was",
  "diagnosis", "traced to", "due to", "investigation", "it was determined",
  "underlying", "causa raiz", "causa raíz", "porque", "la razón",
  "se identificó", "se encontró", "causado por", "el problema era",
  "diagnóstico", "se debe a",
];
const STEPS_KW = [
  "step", "performed", "applied", "executed", "restarted", "reconfigured",
  "updated", "corrected", "fixed", "implemented", "restored", "created",
  "modified", "enabled", "disabled", "solution", "resolved", "workaround",
  "tested", "verified", "confirmed", "action taken", "resolution", "the fix",
  "se realizó", "se aplicó", "se ejecutó", "se reinició", "se actualizó",
  "se corrigió", "se arregló", "se implementó", "solución", "resuelto",
  "se verificó", "se confirmó", "acción tomada",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ROOT_CAUSE_RE = new RegExp(ROOT_CAUSE_KW.map(escapeRegex).join("|"), "i");
const STEPS_RE = new RegExp(STEPS_KW.map(escapeRegex).join("|"), "i");

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

const SLANG_PATTERNS = [
  [/\bwip\b/i, "Filler: WIP"],
  [/\btbd\b/i, "Vague: TBD"],
  [/\bgonna\b/i, "Informal: gonna"],
  [/\bwanna\b/i, "Informal: wanna"],
  [/\bpls\b|\bplz\b/i, "Informal: pls/plz"],
  [/due (yo)\b/i, "Typo: due yo"],
  [/^hi[,.]?\s*team/im, "Generic opener: Hi team"],
  [/please (check|assist|help)\s+the?\s*user/i, "Vague handoff"],
];

function scoreDescription(incident) {
  const feedback = [];
  const sd = incident.shortDescClean;
  const desc = incident.descClean;
  let shortScore;
  if (sd.length <= 9) { shortScore = 0; feedback.push("Short description is missing or too short."); }
  else if (sd.length <= 24) { shortScore = 40; feedback.push("Short description is too vague."); }
  else if (/^\[.+?\]\[.+?\]/.test(sd)) { shortScore = 60; }
  else { shortScore = 100; }
  let bodyScore;
  if (incident.isAutoDesc) { bodyScore = 70; feedback.push("Description is auto-generated from monitoring alert."); }
  else if (desc.length <= 49) { bodyScore = 0; feedback.push("Description is empty or too short."); }
  else if (desc.length <= 149) { bodyScore = 50; feedback.push("Description is brief — add more context."); }
  else { bodyScore = 100; }
  return { score: shortScore * 0.4 + bodyScore * 0.6, feedback };
}

function scoreRootCause(combined) {
  if (ROOT_CAUSE_RE.test(combined)) return { score: 100, feedback: [] };
  return { score: 0, feedback: ["No root cause documented."] };
}

function scoreSteps(combined, state) {
  if (STEPS_RE.test(combined)) return { score: 100, feedback: [] };
  const closed = ["closed", "resolved"].includes(state.toLowerCase());
  if (closed) return { score: 0, feedback: ["Closed without documenting resolution steps."] };
  return { score: 30, feedback: ["No resolution steps documented yet."] };
}

function scoreSpelling(combined) {
  const words = combined.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return { score: 95, feedback: [] };
  let suspicious = 0;
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!lower) continue;
    if (/(.)\1{2,}/.test(lower)) { suspicious++; continue; }
    if (/[bcdfghjklmnpqrstvwxyz]{5,}$/.test(lower)) { suspicious++; continue; }
    if (lower.length <= 5 && !/[aeiou]/.test(lower) && lower.length > 2) suspicious++;
  }
  const ratio = suspicious / words.length;
  if (ratio < 0.03) return { score: 95, feedback: [] };
  if (ratio < 0.08) return { score: 75, feedback: [] };
  if (ratio < 0.15) return { score: 55, feedback: ["Some spelling issues detected."] };
  return { score: 30, feedback: ["Significant spelling issues detected."] };
}

function scoreProfessionalism(incident) {
  const feedback = [];
  const humanNotes = incident.humanNotes;
  let issueCount = 0;
  const combined = [incident.descClean, ...humanNotes.map((n) => n.text)].join("\n");
  for (const [pat, msg] of SLANG_PATTERNS) {
    if (pat.test(combined)) { issueCount++; feedback.push(msg); }
  }
  let noiseEntries = 0;
  for (const n of humanNotes) {
    if (NOISE_PATTERNS.some((p) => p.test(n.text)) || n.text.length < 12) noiseEntries++;
  }
  const noiseRatio = humanNotes.length > 0 ? noiseEntries / humanNotes.length : 0;
  const score = Math.max(0, 100 - issueCount * 15 - noiseRatio * 60);
  if (humanNotes.length === 0) feedback.push("No human work notes found.");
  return { score, feedback, noiseRatio };
}

function getLabel(score) {
  if (score >= 80) return { label: "Excellent", color: "hsl(152, 69%, 42%)" };
  if (score >= 55) return { label: "Good", color: "hsl(43, 96%, 56%)" };
  if (score >= 30) return { label: "Poor", color: "hsl(16, 85%, 57%)" };
  return { label: "Critical", color: "hsl(0, 72%, 55%)" };
}

function scoreIncident(incident) {
  const combined = [incident.descClean, ...incident.humanNotes.map((n) => n.text)].join("\n");
  const noteChars = incident.humanNotes.reduce((s, n) => s + n.text.length, 0);
  const desc = scoreDescription(incident);
  const rc = scoreRootCause(combined);
  const steps = scoreSteps(combined, incident.State);
  const spell = scoreSpelling(combined);
  const prof = scoreProfessionalism(incident);
  const dimScores = {
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
    dimScores.professionalism * WEIGHTS.professionalism,
  );
  const { label, color } = getLabel(totalScore);
  const feedback = [...desc.feedback, ...rc.feedback, ...steps.feedback, ...spell.feedback, ...prof.feedback];
  return {
    number: incident.Number,
    totalScore, label, color, dimScores, feedback,
    noiseRatio: prof.noiseRatio,
    noteCount: incident.humanNotes.length,
    noteChars,
  };
}

// --- Inline analytics ---
const DIM_META = [
  { key: "description_quality", label: "Description Quality", weight: 25 },
  { key: "root_cause", label: "Root Cause", weight: 25 },
  { key: "steps_documented", label: "Steps Documented", weight: 20 },
  { key: "spelling_grammar", label: "Spelling & Grammar", weight: 15 },
  { key: "professionalism", label: "Professionalism", weight: 15 },
];

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeOverview(incidents, scores) {
  const total = scores.length;
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const noteLengths = scores.map((s) => s.noteChars);
  const noteCounts = scores.map((s) => s.noteCount);
  return {
    total, avgScore: Math.round(avg(scores.map((s) => s.totalScore)) * 10) / 10,
    excellent: scores.filter((s) => s.label === "Excellent").length,
    good: scores.filter((s) => s.label === "Good").length,
    poor: scores.filter((s) => s.label === "Poor").length,
    critical: scores.filter((s) => s.label === "Critical").length,
    noRootCause: scores.filter((s) => s.dimScores.root_cause === 0).length,
    highNoise: scores.filter((s) => s.noiseRatio > 0.5).length,
    autoGenerated: incidents.filter((i) => i.isAutoDesc).length,
    emptyNotes: scores.filter((s) => s.noteCount === 0).length,
    avgNoteLength: Math.round(avg(noteLengths)),
    medianNoteLength: Math.round(median(noteLengths)),
    avgNoteCount: Math.round(avg(noteCounts) * 10) / 10,
    hasHumanNotesPct: Math.round((scores.filter((s) => s.noteCount > 0).length / total) * 1000) / 10,
  };
}

function computeDimStats(scores) {
  return DIM_META.map(({ key, label, weight }) => {
    const vals = scores.map((s) => s.dimScores[key]);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const buckets = [0, 0, 0, 0];
    for (const v of vals) {
      if (v < 25) buckets[0]++; else if (v < 50) buckets[1]++; else if (v < 75) buckets[2]++; else buckets[3]++;
    }
    return {
      name: key, label, weight, avg: Math.round(avg * 10) / 10,
      scored0Pct: Math.round((vals.filter((v) => v === 0).length / vals.length) * 1000) / 10,
      scored100Pct: Math.round((vals.filter((v) => v === 100).length / vals.length) * 1000) / 10,
      buckets,
    };
  });
}

function computeFeedback(scores) {
  const counts = {};
  for (const s of scores) { for (const f of s.feedback) { counts[f] = (counts[f] || 0) + 1; } }
  return Object.entries(counts)
    .map(([text, count]) => ({ text, count, pct: Math.round((count / scores.length) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function computeAgentStats(incidents, scores) {
  const scoreMap = new Map(scores.map((s) => [s.number, s]));
  const agents = {};
  for (const inc of incidents) {
    const agent = inc["Assigned to"] || "Unassigned";
    if (!agents[agent]) agents[agent] = [];
    const s = scoreMap.get(inc.Number);
    if (s) agents[agent].push(s);
  }
  return Object.entries(agents)
    .filter(([, arr]) => arr.length >= 2)
    .map(([name, arr]) => ({
      name, count: arr.length,
      avgScore: Math.round((arr.reduce((a, s) => a + s.totalScore, 0) / arr.length) * 10) / 10,
      excellent: arr.filter((s) => s.label === "Excellent").length,
      good: arr.filter((s) => s.label === "Good").length,
      poor: arr.filter((s) => s.label === "Poor").length,
      critical: arr.filter((s) => s.label === "Critical").length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

function computeGroupStats(incidents, scores) {
  const scoreMap = new Map(scores.map((s) => [s.number, s]));
  const groups = {};
  for (const inc of incidents) {
    const g = inc["Assignment group"] || "Unassigned";
    if (!groups[g]) groups[g] = { scores: [], incidents: [] };
    const s = scoreMap.get(inc.Number);
    if (s) groups[g].scores.push(s);
    groups[g].incidents.push(inc);
  }
  return Object.entries(groups)
    .map(([name, { scores: arr }]) => {
      const noteChars = arr.map((s) => s.noteChars);
      return {
        name, count: arr.length,
        avgScore: Math.round((arr.reduce((a, s) => a + s.totalScore, 0) / arr.length) * 10) / 10,
        excellent: arr.filter((s) => s.label === "Excellent").length,
        critical: arr.filter((s) => s.label === "Critical").length,
        avgNoise: Math.round((arr.reduce((a, s) => a + s.noiseRatio, 0) / arr.length) * 100),
        avgRootCause: Math.round((arr.reduce((a, s) => a + s.dimScores.root_cause, 0) / arr.length) * 10) / 10,
        avgNoteLength: Math.round(noteChars.reduce((a, b) => a + b, 0) / noteChars.length),
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore);
}

// --- Worker message handler with async chunking ---
const CHUNK = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

self.onmessage = async function (e) {
  const { buffer, name } = e.data;
  try {
    self.postMessage({ type: "progress", percent: 5, processed: 0, total: "?" });

    // Parse file once — use dense mode to reduce memory for large files
    const wb = XLSX.read(buffer, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      dense: true,
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const totalRows = rows.length;

    // Free the workbook to release memory
    wb.Sheets = null;
    wb.SheetNames = null;

    self.postMessage({ type: "progress", percent: 15, processed: 0, total: totalRows });

    // For very large files, strip raw Work notes from stored incidents to save memory
    // (scoring extracts what it needs, we don't need the raw text afterward)
    const stripWorkNotes = totalRows > 10000;

    const allIncidents = [];
    const allScores = [];

    for (let i = 0; i < totalRows; i++) {
      const incident = enrichRow(rows[i]);
      const score = scoreIncident(incident);

      // Strip heavy fields to reduce memory & postMessage payload
      if (stripWorkNotes) {
        incident["Work notes"] = "";
        incident.Description = "";
        incident.allNotes = [];
        // Keep humanNotes count but clear text
        incident.humanNotes = incident.humanNotes.map(n => ({
          timestamp: n.timestamp,
          author: n.author,
          text: "",
          isSystem: n.isSystem,
        }));
      }

      allIncidents.push(incident);
      allScores.push(score);

      // Free the parsed row to reduce memory pressure
      rows[i] = null;

      if ((i + 1) % CHUNK === 0) {
        self.postMessage({
          type: "progress",
          percent: Math.round(15 + ((i + 1) / totalRows) * 75),
          processed: i + 1,
          total: totalRows,
        });
        // Yield to avoid blocking and allow GC
        await sleep(0);
      }
    }

    self.postMessage({ type: "progress", percent: 92, processed: totalRows, total: totalRows });

    const overview = computeOverview(allIncidents, allScores);
    const dimStats = computeDimStats(allScores);
    const feedbackItems = computeFeedback(allScores);
    const agentStats = computeAgentStats(allIncidents, allScores);
    const groupStats = computeGroupStats(allIncidents, allScores);

    self.postMessage({ type: "progress", percent: 97, processed: totalRows, total: totalRows });

    self.postMessage({
      type: "result",
      payload: {
        incidents: allIncidents,
        scores: allScores,
        overview, dimStats, feedbackItems, agentStats, groupStats,
        fileName: name,
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", payload: err.message });
  }
};
