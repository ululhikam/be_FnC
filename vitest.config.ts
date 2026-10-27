import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Render canvas (resvg/sharp) bersifat CPU-bound dan bisa >10s saat
    // test lain berjalan paralel, jadi beri ruang lebih longgar.
    testTimeout: 30000,
  },
});
