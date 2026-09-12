import { describe, expect, it } from 'vitest';
import { looksLikeJobId } from './job-id';

describe('looksLikeJobId', () => {
  it('accepts a real run id', () => {
    expect(looksLikeJobId('3e7e350a-f598-4312-9f43-ffd3a28bf88a')).toBe(true);
    expect(looksLikeJobId('B5361F7F-7E8F-4B9A-AF3C-C7606DE20A60')).toBe(true);
  });

  /** The one that caused this: a placeholder pasted straight out of an instruction. */
  it('rejects a placeholder left unreplaced', () => {
    expect(looksLikeJobId('PASTE_JOB_ID')).toBe(false);
    expect(looksLikeJobId('<job-id>')).toBe(false);
  });

  it('rejects nothing at all', () => {
    for (const v of [null, undefined, '', '   ']) expect(looksLikeJobId(v)).toBe(false);
  });

  it('rejects a near-miss rather than guessing', () => {
    expect(looksLikeJobId('3e7e350a-f598-4312-9f43')).toBe(false);
    expect(looksLikeJobId('3e7e350af59843129f43ffd3a28bf88a')).toBe(false);
    expect(looksLikeJobId('zzzzzzzz-f598-4312-9f43-ffd3a28bf88a')).toBe(false);
  });

  it('tolerates surrounding space, which a paste often carries', () => {
    expect(looksLikeJobId('  3e7e350a-f598-4312-9f43-ffd3a28bf88a  ')).toBe(true);
  });
});
