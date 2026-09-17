import { describe, expect, it } from 'vitest';
import { describeGoogleFailure } from './google-error';

const CTX = { senderAddress: 'shipments@masquare.eu', clientEmail: 'bot@masquare.iam.gserviceaccount.com' };

describe('describeGoogleFailure', () => {
  /**
   * The one that costs the most time: people re-download the key, which was never the problem, and
   * the fix is in a different console under a setting whose field wants the numeric client id.
   */
  it('sends an unauthorized_client to the delegation screen, and warns about the id', () => {
    const msg = describeGoogleFailure(401, { error: 'unauthorized_client' }, CTX);
    expect(msg).toContain('Domain-wide delegation');
    expect(msg).toContain('gmail.send');
    expect(msg).toContain('NUMERIC');
    expect(msg).toContain('The key is fine');
  });

  it('reads invalid_grant as a problem with the mailbox', () => {
    const msg = describeGoogleFailure(400, { error: 'invalid_grant' }, CTX);
    expect(msg).toContain('shipments@masquare.eu');
    expect(msg).toContain('licence');
  });

  it('mentions the clock when Google blames the assertion', () => {
    const msg = describeGoogleFailure(400, { error: 'invalid_grant', error_description: 'Invalid JWT: Token must be a short-lived token' }, CTX);
    expect(msg).toContain('clock');
  });

  it('names an unenabled Gmail API rather than guessing at permissions', () => {
    const msg = describeGoogleFailure(403, { error: { message: 'Gmail API has not been used in project 123 before or it is disabled' } }, CTX);
    expect(msg).toContain('not enabled');
  });

  it('explains a missing Gmail licence', () => {
    expect(describeGoogleFailure(400, { error: { message: 'failedPrecondition' } }, CTX)).toContain('no Gmail licence');
  });

  it('says whose fault a 500 is', () => {
    expect(describeGoogleFailure(503, null, CTX)).toContain('Their side');
  });

  it('passes through what Google said when it says something useful', () => {
    expect(describeGoogleFailure(400, { error: { message: 'Invalid to header' } }, CTX)).toBe('Invalid to header');
  });

  it('still says something when the body is empty', () => {
    expect(describeGoogleFailure(418, null, CTX)).toContain('418');
  });
});
