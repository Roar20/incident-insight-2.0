/**
 * FAM-01 blocking parity gate: for every registered M1 word configuration,
 * the TypeScript partitions must equal the frozen C-REAL-04 harness's
 * canonical partition hashes (Step A6) exactly. Synthetic fixtures only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkIncidentTable, enrichRow, inferDateOrder, readIncidentTable } from '../parser';
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import { computeFamilyPartitions } from './families';
import { canonicalPartitionHash, researchRowKey } from './hash';
import { openTimeText, type TextVariant } from './variants';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/families');
const expected: Record<string, string> = JSON.parse(readFileSync(path.join(FIXTURES, 'a6_parity_hashes.json'), 'utf8')).partitions;

/** Production ingestion, exactly as the worker runs it. */
function ingest(file: string) {
  const bytes = readFileSync(path.join(FIXTURES, file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const table = readIncidentTable(buffer);
  expect(checkIncidentTable(buffer, table).errors).toEqual([]);
  const dateOrder = inferDateOrder(table.rows);
  return table.rows.map(r => enrichRow(r, { dateOrder }));
}

const DATASETS = [
  { label: 'SYN-SAP', file: 'syn_sap.csv', rows: 2819 },
  { label: 'SYN-PBNA', file: 'syn_pbna.csv', rows: 370 },
];

function configs(): { variant: TextVariant; tau?: number }[] {
  return [{ variant: 'R0' }, ...(['R1', 'R2'] as const).flatMap(variant => FAMILIES_RESEARCH.taus.map(tau => ({ variant, tau })))];
}

describe('FAM-01 synthetic parity with the frozen C-REAL-04 harness (A6)', () => {
  for (const ds of DATASETS) {
    it(`${ds.label}: every registered M1 word configuration matches the canonical hash`, () => {
      const incidents = ingest(ds.file);
      expect(incidents).toHaveLength(ds.rows);
      const texts = incidents.map(i => openTimeText(i.shortDescClean, i.descClean));
      const keys = incidents.map(i => researchRowKey(ds.label, i.Number));
      const results: { key: string; ok: boolean }[] = [];
      for (const { variant, tau } of configs()) {
        const parts = computeFamilyPartitions({ texts, variant, tau });
        parts.thresholds.forEach((s, t) => {
          const key = `${ds.label}|word|${variant}|${tau === undefined ? '' : tau.toFixed(2)}|M1|${s.toFixed(4)}`;
          results.push({ key, ok: canonicalPartitionHash(parts.labels[t], keys) === expected[key] });
        });
      }
      expect(results).toHaveLength(28);
      expect(results.filter(r => !r.ok).map(r => r.key)).toEqual([]);
    }, 120_000);
  }
});
