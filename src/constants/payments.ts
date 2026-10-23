/**
 * Payment product constants. Runtime-configurable values (kill switches,
 * revenue amount, hold days, payout minimum) are also seeded in SystemSetting;
 * these constants are safe defaults for code paths that cannot read the DB.
 */
export const CTF_PER_PAID_FESS = 1;
export const BASE_TRIAL_DAYS = 7;
export const BASE_REVENUE_PER_FESS_IDR = 80;
export const BASE_REVENUE_HOLD_DAYS = 7;
export const BASE_PAYOUT_MIN_IDR = 50_000;

export type PaymentPackage = {
  code: string;
  name: string;
  amountIdr: number;
  ctfAmount: number;
  description: string;
};

export const PAYMENT_PACKAGES: PaymentPackage[] = [
  {
    code: 'coba_dulu',
    name: 'Coba Dulu',
    amountIdr: 5_000,
    ctfAmount: 25,
    description: 'Paket kecil untuk mencoba top-up dan publish.',
  },
  {
    code: 'hemat',
    name: 'Hemat',
    amountIdr: 10_000,
    ctfAmount: 55,
    description: 'Bonus 5 CTF dibanding paket Coba Dulu.',
  },
  {
    code: 'mahasiswa',
    name: 'Mahasiswa',
    amountIdr: 25_000,
    ctfAmount: 145,
    description: 'Paling pas untuk pemakaian harian.',
  },
  {
    code: 'kampus',
    name: 'Kampus',
    amountIdr: 50_000,
    ctfAmount: 300,
    description: 'Untuk base dan komunitas yang aktif.',
  },
  {
    code: 'bundling',
    name: 'Bundling',
    amountIdr: 100_000,
    ctfAmount: 625,
    description: 'Paket terbesar dengan CTF per rupiah paling efisien.',
  },
];

export function findPaymentPackage(code: string): PaymentPackage | undefined {
  return PAYMENT_PACKAGES.find((pkg) => pkg.code === code);
}
