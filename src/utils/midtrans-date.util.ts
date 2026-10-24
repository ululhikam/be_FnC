const NAIVE_MIDTRANS_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * Midtrans sends transaction timestamps (transaction_time, settlement_time,
 * expiry_time) in WIB (UTC+7) without an explicit timezone. Parsing those
 * strings directly treats them as server-local time, which shifts them by
 * seven hours on UTC hosts. Normalize naive values to +07:00 and leave values
 * that already carry a timezone untouched.
 */
export function parseMidtransDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = NAIVE_MIDTRANS_DATETIME.exec(trimmed);
  const normalized = match ? `${match[1]}T${match[2]}+07:00` : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
