import * as XLSX from 'xlsx';
import { describe, it, expect } from 'vitest';
import { DIMENSION_FIELDS, OPTIONAL_DIMENSION_ALIASES, SCHEMA_CONFIG_VERSION } from '../config/schema';
import { canonicalSourceHeader, dimensionAvailability, dimensionSourceHeader, getDimension } from './dimensions';
import { enrichRow, isMappedColumn, readIncidentTable } from './parser';

function xlsxBuffer(rows: Record<string, unknown>[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Page 1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('schema configuration', () => {
  it('configures only the verified dimension headers', () => {
    expect(SCHEMA_CONFIG_VERSION).toBe('1.1.0');
    expect(OPTIONAL_DIMENSION_ALIASES).toEqual({
      service: ['Service', 'business_service'],
      serviceOffering: ['Service offering', 'service_offering'],
      resolutionCode: ['Resolution code'],
    });
  });

  it('never claims a canonical header, so dimension columns stay in extraFields', () => {
    for (const field of DIMENSION_FIELDS) {
      for (const alias of OPTIONAL_DIMENSION_ALIASES[field]) expect(isMappedColumn(alias), alias).toBe(false);
    }
  });
});

describe('getDimension', () => {
  it('reads each dimension from its source column, trimmed', () => {
    const inc = enrichRow({ Number: 'INC1', Service: '  Service-01 ', 'Service offering': 'Offering-A', 'Resolution code': 'Code-9' });
    expect(getDimension(inc, 'service')).toBe('Service-01');
    expect(getDimension(inc, 'serviceOffering')).toBe('Offering-A');
    expect(getDimension(inc, 'resolutionCode')).toBe('Code-9');
  });

  it('returns null — never a bucket — for blank cells and missing columns', () => {
    expect(getDimension(enrichRow({ Number: 'INC1', Service: '   ' }), 'service')).toBeNull();
    expect(getDimension(enrichRow({ Number: 'INC1', Service: '' }), 'service')).toBeNull();
    expect(getDimension(enrichRow({ Number: 'INC1' }), 'service')).toBeNull();
    expect(getDimension(enrichRow({ Number: 'INC1', Other: 'x' }), 'serviceOffering')).toBeNull();
  });

  it('does not read unconfigured spellings', () => {
    const inc = enrichRow({ Number: 'INC1', service: 'Service-01', 'Service Offering': 'Offering-1', close_code: 'Code-1', u_close_code: 'Code-2' });
    expect(getDimension(inc, 'service')).toBeNull();
    expect(getDimension(inc, 'serviceOffering')).toBeNull();
    expect(getDimension(inc, 'resolutionCode')).toBeNull();
  });

  it('reads the ServiceNow field names business_service and service_offering', () => {
    const inc = enrichRow({ number: 'INC1', business_service: 'Service-02', service_offering: 'Offering-2' });
    expect(getDimension(inc, 'service')).toBe('Service-02');
    expect(getDimension(inc, 'serviceOffering')).toBe('Offering-2');
  });

  it('prefers the display label when a file has both spellings', () => {
    const inc = enrichRow({ Number: 'INC1', Service: 'Service-01', business_service: 'Service-02' });
    expect(getDimension(inc, 'service')).toBe('Service-01');
  });

  it('keeps a non-text value as written', () => {
    expect(getDimension(enrichRow({ Number: 'INC1', 'Resolution code': 42 }), 'resolutionCode')).toBe('42');
  });

  it('leaves the incident and its extraFields untouched', () => {
    const inc = enrichRow({ Number: 'INC1', Service: ' Service-01 ', 'Service offering': '' });
    const before = structuredClone(inc);
    getDimension(inc, 'service');
    getDimension(inc, 'serviceOffering');
    expect(inc).toEqual(before);
    expect(inc.extraFields).toEqual({ Service: ' Service-01 ', 'Service offering': '' });
  });
});

describe('dimensionSourceHeader', () => {
  it('names the header a file uses, or null when the dimension is not available', () => {
    const { columns } = readIncidentTable(xlsxBuffer([{ Number: 'INC1', Service: 'Service-01', State: 'Closed' }]));
    expect(dimensionSourceHeader('service', columns)).toBe('Service');
    expect(dimensionSourceHeader('serviceOffering', columns)).toBeNull();
    expect(dimensionSourceHeader('resolutionCode', [])).toBeNull();
  });
});

describe('dimension availability', () => {
  it('reports which dimensions a file has, telling an absent column from blank cells', () => {
    const { columns } = readIncidentTable(xlsxBuffer([{ Number: 'INC1', Service: '', assignment_group: 'AG-1' }]));
    expect(dimensionAvailability(columns)).toEqual({ service: true, serviceOffering: false, assignmentGroup: true });
    expect(canonicalSourceHeader('Assignment group', columns)).toBe('assignment_group');
    expect(dimensionAvailability([])).toEqual({ service: false, serviceOffering: false, assignmentGroup: false });
  });
});
