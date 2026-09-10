import { describe, expect, it } from 'vitest';
import { buildTrackingUrl } from './tracking-url';

describe('buildTrackingUrl', () => {
  const fedex = 'https://www.fedex.com/fedextrack/?trknbr={tracking}';

  it('puts the number where the template says', () => {
    expect(buildTrackingUrl(fedex, '876350374113')).toBe('https://www.fedex.com/fedextrack/?trknbr=876350374113');
  });

  /** Cyprus Post numbers carry letters and could carry anything else somebody typed. */
  it('encodes the number, so a typed value cannot alter the query', () => {
    expect(buildTrackingUrl('https://track.example/?id={tracking}', 'CP001 142/795CY'))
      .toBe('https://track.example/?id=CP001%20142%2F795CY');
  });

  it('trims a template and a number pasted with whitespace', () => {
    expect(buildTrackingUrl(`  ${fedex}  `, '  876350374113 ')).toBe('https://www.fedex.com/fedextrack/?trknbr=876350374113');
  });

  /**
   * Null rather than a broken link. Every shipping service starts with no template, and most
   * shipments on the untracked ones have a number — offering a link to nowhere would be worse than
   * showing plain text.
   */
  it('is null when there is nothing to build a link from', () => {
    expect(buildTrackingUrl(null, '876350374113')).toBeNull();
    expect(buildTrackingUrl('', '876350374113')).toBeNull();
    expect(buildTrackingUrl(fedex, null)).toBeNull();
    expect(buildTrackingUrl(fedex, '   ')).toBeNull();
  });

  /** A template with nowhere to put the number would send everybody to the same page. */
  it('refuses a template with no placeholder', () => {
    expect(buildTrackingUrl('https://www.fedex.com/fedextrack/', '876350374113')).toBeNull();
  });
});
