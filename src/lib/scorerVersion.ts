/**
 * Version of the scoring rules in `scorer.ts`, recorded in exports so a score
 * can be traced back to the rules that produced it.
 *
 * `scorerVersion.test.ts` hashes `scorer.ts` and fails when it no longer
 * matches `SCORER_SOURCE_SHA256`. When that happens, bump `SCORER_VERSION` and
 * update the hash in the same change.
 */
export const SCORER_VERSION = '1.0.0';

/** SHA-256 of `scorer.ts` (LF line endings) at `SCORER_VERSION`. */
export const SCORER_SOURCE_SHA256 = '9f54939b214ea9d09b7537dc1c8f663362aa33cc4f10279501ed4d08e5543b10';
