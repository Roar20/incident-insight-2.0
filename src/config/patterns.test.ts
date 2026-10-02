import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { PATTERN_REGISTRY_VERSION, PATTERN_SETS } from './patterns';

/**
 * Each set's values at its current version. A change to the values fails here
 * until the set's version (and PATTERN_REGISTRY_VERSION) is bumped and the hash
 * updated in the same change — the same rule as SCORER_VERSION.
 */
const PINNED: Record<string, { version: string; sha256: string }> = {
  'instance.systemNoteAuthors': { version: '1.0.0', sha256: '35a44328e7a8f252ee54f7d37d31bb7f34302e01c55df5718459b19f82cd4459' },
  'instance.systemNotePhrases': { version: '1.0.0', sha256: '487f616dbf9f3306d3290b3993ea1d97ae4ba47f5eea7f2f44f5b23061f06bd1' },
  'monitoring.autoDescriptionKeywords': { version: '1.0.0', sha256: 'aa03498b0ad85e1a6533ab01224943944dfb3ea152ff3c6ee23a2b94746ebfb7' },
};

describe('pattern registry', () => {
  it('pins every set to its version — bump the version and hash when values change', () => {
    expect(PATTERN_REGISTRY_VERSION).toBe('1.0.0');
    expect(PATTERN_SETS.map(s => s.id).sort()).toEqual(Object.keys(PINNED).sort());
    for (const set of PATTERN_SETS) {
      const hash = createHash('sha256').update(JSON.stringify(set.values)).digest('hex');
      expect({ version: set.version, sha256: hash }, `${set.id} changed: bump its version and set sha256 to ${hash}`)
        .toEqual(PINNED[set.id]);
    }
  });

  it('declares purpose, source context, consumers and fallback for every set', () => {
    for (const set of PATTERN_SETS) {
      expect(set.purpose, set.id).not.toBe('');
      expect(['servicenow-instance', 'monitoring-tool']).toContain(set.sourceContext);
      expect(set.consumers.length, set.id).toBeGreaterThan(0);
      expect(set.fallback, set.id).not.toBe('');
    }
  });

  it('stores values lowercase and unique, since they are matched against lowercased text', () => {
    for (const set of PATTERN_SETS) {
      for (const value of set.values) expect(value, set.id).toBe(value.toLowerCase());
      expect(new Set(set.values).size, set.id).toBe(set.values.length);
    }
  });
});
