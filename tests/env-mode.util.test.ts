import { describe, expect, it } from 'vitest';
import { resolveEnvMode } from '../src/config/env-mode.util.js';

const BASE = {
  initialNodeEnv: undefined as string | undefined,
  runningOnVercel: false,
  devEnvExists: true,
  allowProdDbForLocal: false,
};

describe('resolveEnvMode', () => {
  it('memakai .env.development saat NODE_ENV kosong di mesin lokal', () => {
    expect(resolveEnvMode(BASE)).toBe('dev-file');
  });

  it('memakai .env.development saat NODE_ENV=development eksplisit', () => {
    expect(resolveEnvMode({ ...BASE, initialNodeEnv: 'development' })).toBe('dev-file');
  });

  it('tetap production saat NODE_ENV=production meskipun .env.development ada', () => {
    expect(resolveEnvMode({ ...BASE, initialNodeEnv: 'production' })).toBe('prod-file');
  });

  it('tidak pernah memakai .env.development di Vercel', () => {
    expect(resolveEnvMode({ ...BASE, runningOnVercel: true })).toBe('prod-file');
  });

  it('menolak development tanpa .env.development', () => {
    expect(resolveEnvMode({ ...BASE, devEnvExists: false })).toBe('missing-dev');
  });

  it('mengizinkan fallback production hanya dengan ALLOW_PROD_DB_FOR_LOCAL', () => {
    expect(
      resolveEnvMode({
        ...BASE,
        devEnvExists: false,
        allowProdDbForLocal: true,
      })
    ).toBe('prod-fallback');
  });

  it('NODE_ENV=test membaca .env biasa tanpa menyentuh .env.development', () => {
    expect(resolveEnvMode({ ...BASE, initialNodeEnv: 'test' })).toBe('prod-file');
  });
});
