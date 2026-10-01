import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SCORER_SOURCE_SHA256, SCORER_VERSION } from './scorerVersion';

describe('SCORER_VERSION', () => {
  it('matches the current scorer.ts — bump the version and hash when scoring changes', () => {
    const source = readFileSync(resolve(__dirname, 'scorer.ts'), 'utf8').replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(source).digest('hex');
    expect(
      hash,
      `scorer.ts changed: bump SCORER_VERSION (now ${SCORER_VERSION}) and set SCORER_SOURCE_SHA256 to ${hash}`,
    ).toBe(SCORER_SOURCE_SHA256);
  });
});
