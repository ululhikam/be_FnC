import { describe, expect, it } from 'vitest';
import { parseMidtransDate } from '../src/utils/midtrans-date.util.js';

describe('parseMidtransDate', () => {
  it('treats naive Midtrans timestamps as WIB (UTC+7)', () => {
    expect(parseMidtransDate('2026-10-24 13:06:27')?.toISOString()).toBe(
      '2026-10-24T06:06:27.000Z'
    );
    expect(parseMidtransDate('2026-10-24T13:06:27.123')?.toISOString()).toBe(
      '2026-10-24T06:06:27.123Z'
    );
  });

  it('preserves timestamps that already include a timezone', () => {
    expect(parseMidtransDate('2026-10-24T13:06:27+07:00')?.toISOString()).toBe(
      '2026-10-24T06:06:27.000Z'
    );
    expect(parseMidtransDate('2026-10-24T06:06:27.000Z')?.toISOString()).toBe(
      '2026-10-24T06:06:27.000Z'
    );
  });

  it('returns undefined for missing or invalid values', () => {
    expect(parseMidtransDate(undefined)).toBeUndefined();
    expect(parseMidtransDate(null)).toBeUndefined();
    expect(parseMidtransDate('')).toBeUndefined();
    expect(parseMidtransDate('not-a-date')).toBeUndefined();
    expect(parseMidtransDate(123)).toBeUndefined();
  });
});
