import { describe, expect, it } from 'vitest';
import { fedexPhone } from './fedex-phone';

describe('a phone number as FedEx takes it', () => {
  it('is the national number when it belongs to the address’s country', () => {
    expect(fedexPhone('+357 99 123456', 'CY')).toBe('99123456');
    expect(fedexPhone('020 7946 0000', 'GB')).toBe('2079460000');
  });

  it('keeps the country code when it belongs somewhere else', () => {
    expect(fedexPhone('+44 7700 900123', 'DE')).toBe('447700900123');
  });

  it('falls back to the digits when it cannot be read, rather than dropping it', () => {
    expect(fedexPhone('(555) 01-23', null)).toBe('5550123');
  });

  it('is nothing when nothing was given', () => {
    expect(fedexPhone('  ', 'CY')).toBeNull();
    expect(fedexPhone(null, 'CY')).toBeNull();
  });
});
