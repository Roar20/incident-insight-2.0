import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as XLSX from 'xlsx';
import { del } from '@vercel/blob';
import { enrichRow, type EnrichedIncident, type IncidentRow } from '../src/lib/parser';
import { scoreIncident, type IncidentScore } from '../src/lib/scorer';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats, parseMonthKey,
} from '../src/lib/analytics';

export const config = {
  api: {
    responseLimit: '50mb',
  },
};

/** Rows read and scored per pass over the sheet. */
const CHUNK_ROWS = 5000;

/**
 * Vercel Blob serves every store from a subdomain of this host.
 *
 * `blobUrl` arrives from the client, so it is checked against this suffix
 * before being fetched or deleted — an unchecked URL here would let a caller
 * use this function to reach internal addresses or delete arbitrary blobs.
 */
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

function isAllowedBlobUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname.endsWith(BLOB_HOST_SUFFIX);
}

function parseExcelFileChunked(
  buffer: Buffer,
  chunkSize: number,
  onChunk: (incidents: EnrichedIncident[], scores: IncidentScore[]) => void,
) {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    dense: true,
  });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return;

  const sheet = wb.Sheets[sheetName];
  if (!sheet?.['!ref']) return;
  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Read the header row once and pass it to every chunk. Handing sheet_to_json a
  // sub-range *without* an explicit header makes it treat that chunk's first row
  // as the header — which consumed a data row per chunk and left every later
  // chunk keyed by arbitrary cell values instead of column names.
  const [headerRow] = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: { s: { r: range.s.r, c: range.s.c }, e: { r: range.s.r, c: range.e.c } },
    defval: '',
  });
  if (!headerRow) return;
  const header = headerRow.map(h => String(h));

  for (let start = range.s.r + 1; start <= range.e.r; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, range.e.r);
    const rows = XLSX.utils.sheet_to_json<IncidentRow>(sheet, {
      header,
      range: { s: { r: start, c: range.s.c }, e: { r: end, c: range.e.c } },
      defval: '',
    });
    if (rows.length === 0) continue;

    const incidents = rows.map(enrichRow);
    onChunk(incidents, incidents.map(scoreIncident));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { blobUrl, fileName } = req.body ?? {};
  if (!isAllowedBlobUrl(blobUrl)) {
    return res.status(400).json({ error: 'blobUrl must be an https Vercel Blob URL' });
  }

  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return res.status(400).json({ error: `Could not fetch blob (${response.status})` });
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const allIncidents: EnrichedIncident[] = [];
    const allScores: IncidentScore[] = [];

    parseExcelFileChunked(buffer, CHUNK_ROWS, (incidents, scores) => {
      allIncidents.push(...incidents);
      allScores.push(...scores);
    });

    const monthSet = new Set<string>();
    for (const inc of allIncidents) {
      const key = parseMonthKey(inc.Opened);
      if (key) monthSet.add(key);
    }

    // Note: `allIncidents` is handed to the response by reference, so it must
    // not be emptied before serialization — doing so returned `incidents: []`.
    const result = {
      incidents: allIncidents,
      scores: allScores,
      overview: computeOverview(allIncidents, allScores),
      dimStats: computeDimStats(allScores),
      feedbackItems: computeFeedback(allScores),
      agentStats: computeAgentStats(allIncidents, allScores),
      groupStats: computeGroupStats(allIncidents, allScores),
      availableMonthKeys: [...monthSet].sort(),
      fileName: typeof fileName === 'string' && fileName ? fileName : 'upload.xlsx',
    };

    await del(blobUrl).catch(() => {});
    return res.status(200).json(result);
  } catch (e) {
    console.error('Processing error:', e);
    return res.status(500).json({ error: 'Failed to process the uploaded file' });
  }
}
