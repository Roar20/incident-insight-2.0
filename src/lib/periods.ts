/**
 * Calendar bucketing for trend views.
 *
 * Incidents carry timestamps as "YYYY-MM-DD HH:MM:SS" strings after parsing, so
 * these helpers work off that shape and degrade to '' rather than throwing when
 * a column is missing.
 */

export type Period = 'week' | 'month';

/** Parse an incident timestamp. Returns null when absent or unparseable. */
export function parseTimestamp(value: string): Date | null {
  if (!value) return null;
  // Treat the stored string as UTC so bucketing does not shift with the viewer's zone.
  const m = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ISO-8601 week number. Weeks start on Monday and week 1 is the week holding
 * the first Thursday of the year, which is what "week 14" means on a business
 * calendar.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday of this week; its year is the ISO week-numbering year.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: isoYear, week };
}

/** `YYYY-Www` key for the week an incident was opened, or '' when undated. */
export function weekKey(opened: string): string {
  const date = parseTimestamp(opened);
  if (!date) return '';
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the ISO week identified by `key`, or null if the key is malformed. */
export function weekStart(key: string): Date | null {
  const m = key.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const [, year, week] = m;
  const jan4 = new Date(Date.UTC(+year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86400000);
  return new Date(week1Monday.getTime() + (+week - 1) * 7 * 86400000);
}

/** e.g. "W14 · 31 Mar" — short enough for a chart axis, dated enough to act on. */
export function weekLabel(key: string): string {
  const start = weekStart(key);
  if (!start) return key;
  const week = key.slice(6);
  const day = start.getUTCDate();
  const month = start.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
  return `W${week} · ${day} ${month}`;
}

/** "31 Mar – 6 Apr 2025", for headings where the full range is worth spelling out. */
export function weekRangeLabel(key: string): string {
  const start = weekStart(key);
  if (!start) return key;
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date, withYear = false) => d.toLocaleString('default', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
  return `${fmt(start)} – ${fmt(end, true)}`;
}

/** Hours between opening and closing, or null when either end is missing. */
export function resolutionHours(opened: string, closed: string): number | null {
  const start = parseTimestamp(opened);
  const end = parseTimestamp(closed);
  if (!start || !end) return null;
  const hours = (end.getTime() - start.getTime()) / 3600000;
  // Guard against clock skew and obviously bad exports (>1 year open).
  if (hours < 0 || hours > 24 * 365) return null;
  return hours;
}

/** Render an hour count the way a service desk reads it. */
export function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours / 24 * 10) / 10}d`;
}
