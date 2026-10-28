/**
 * Penentu mode environment sebelum file `.env*` dimuat.
 *
 * Kenapa terpisah: `backend/.env` berisi `NODE_ENV=production`. Kalau mode
 * ditentukan setelah file itu dimuat, `npm run dev` di mesin lokal akan
 * dianggap production dan `.env.development` tidak pernah dipakai — server
 * lokal bisa menyambung ke database production. Keputusan karena itu hanya
 * boleh memakai environment yang sudah ada di proses (shell / Vercel).
 */
export type EnvMode = 'dev-file' | 'prod-file' | 'prod-fallback' | 'missing-dev';

export interface EnvModeInput {
  /** `process.env.NODE_ENV` SEBELUM dotenv memuat file apa pun. */
  initialNodeEnv?: string;
  /** Vercel menetapkan `VERCEL=1`; jangan pernah pakai `.env.development` di sana. */
  runningOnVercel: boolean;
  devEnvExists: boolean;
  allowProdDbForLocal: boolean;
}

export function resolveEnvMode(input: EnvModeInput): EnvMode {
  const wantsLocalDev =
    input.initialNodeEnv === 'development' ||
    (!input.initialNodeEnv && !input.runningOnVercel);

  if (!wantsLocalDev) return 'prod-file';
  if (input.devEnvExists) return 'dev-file';
  return input.allowProdDbForLocal ? 'prod-fallback' : 'missing-dev';
}
