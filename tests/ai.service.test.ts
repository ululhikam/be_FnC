import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { RateLimitService } from '../src/services/rate-limit.service.js';
import { AiService, hashTitleInput, providerNameFromUrl } from '../src/services/ai/ai.service.js';
import { AiProviderError, type AiProvider } from '../src/services/ai/provider.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    aiGeneration: { findUnique: vi.fn(), create: vi.fn() },
    systemLog: { create: vi.fn() },
  },
}));

vi.mock('../src/services/rate-limit.service.js', () => ({
  RateLimitService: { consume: vi.fn() },
}));

const request = {
  baseId: 'base_1',
  baseHandle: '@unermenfess',
  baseName: 'UNERMEN FESS',
  content: 'Kantin kampus tutup lebih awal padahal banyak yang belum makan',
  topic: 'Kampus',
  tag: 'Cerita',
  bannedWords: [],
  targetId: 'fess_1',
};

/** Provider palsu: mengembalikan `text` atau melempar error yang diberikan. */
function fakeProvider(
  name: string,
  behaviour: { text?: string; error?: Error }
): AiProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn(async () => {
      if (behaviour.error) throw behaviour.error;
      return {
        text: behaviour.text ?? '',
        provider: name,
        model: `${name}-model`,
        inputTokens: 100,
        outputTokens: 12,
        latencyMs: 42,
      };
    }),
  };
}

function quotaAllowed() {
  vi.mocked(RateLimitService.consume).mockResolvedValue({
    allowed: true,
    count: 1,
    limit: 100,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterSeconds: 60,
  });
}

describe('AiService.generateTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.aiGeneration.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.aiGeneration.create).mockResolvedValue({} as any);
    vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
    quotaAllowed();
  });

  it('memakai judul dari provider utama dan mencatat ledger status ok', async () => {
    const primary = fakeProvider('gemini', { text: '{"title":"Kantin Tutup Lebih Awal"}' });

    const result = await AiService.generateTitle(request, { primary, fallback: null });

    expect(result).toMatchObject({
      title: 'Kantin Tutup Lebih Awal',
      source: 'ai',
      provider: 'gemini',
      model: 'gemini-model',
    });
    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(prisma.aiGeneration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'fess_title',
          status: 'ok',
          targetType: 'Fess',
          targetId: 'fess_1',
          output: { title: 'Kantin Tutup Lebih Awal' },
        }),
      })
    );
  });

  it('memakai cache tanpa memanggil provider maupun kuota', async () => {
    vi.mocked(prisma.aiGeneration.findUnique).mockResolvedValue({
      output: { title: 'Judul Dari Cache' },
      provider: 'gemini',
      model: 'gemini-model',
    } as any);
    const primary = fakeProvider('gemini', { text: '{"title":"Judul Baru"}' });

    const result = await AiService.generateTitle(request, { primary, fallback: null });

    expect(result).toMatchObject({ title: 'Judul Dari Cache', source: 'cache' });
    expect(primary.complete).not.toHaveBeenCalled();
    expect(RateLimitService.consume).not.toHaveBeenCalled();
  });

  it('langsung memakai fallback saat kuota habis', async () => {
    vi.mocked(RateLimitService.consume).mockResolvedValue({
      allowed: false,
      count: 201,
      limit: 200,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
      retryAfterSeconds: 60,
    });
    const primary = fakeProvider('gemini', { text: '{"title":"Kantin Tutup Lebih Awal"}' });

    const result = await AiService.generateTitle(request, { primary, fallback: null });

    expect(result.source).toBe('fallback');
    expect(result.title.length).toBeGreaterThan(0);
    expect(primary.complete).not.toHaveBeenCalled();
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
  });

  it('mencoba provider cadangan saat provider utama 429', async () => {
    const primary = fakeProvider('gemini', {
      error: new AiProviderError('rate limited', { status: 429, retryable: true }),
    });
    const fallback = fakeProvider('openrouter', { text: '{"title":"Kantin Tutup Mendadak"}' });

    const result = await AiService.generateTitle(request, { primary, fallback });

    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(fallback.complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ title: 'Kantin Tutup Mendadak', provider: 'openrouter' });
  });

  it('tidak mencoba cadangan saat provider utama menolak validasi (4xx)', async () => {
    const primary = fakeProvider('gemini', {
      error: new AiProviderError('bad request', { status: 400, retryable: false }),
    });
    const fallback = fakeProvider('openrouter', { text: '{"title":"Kantin Tutup Mendadak"}' });

    const result = await AiService.generateTitle(request, { primary, fallback });

    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(result.source).toBe('fallback');
  });

  it('memakai fallback bila keluaran provider tidak lolos validasi', async () => {
    const primary = fakeProvider('gemini', { text: '{"title":"Viral!"}' });
    const fallback = fakeProvider('openrouter', { text: 'bukan json' });

    const result = await AiService.generateTitle(request, { primary, fallback });

    expect(result.source).toBe('fallback');
    expect(result.promptVersion).toBe('v1');
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalled();
  });

  it('menolak judul yang memuat kata terlarang base', async () => {
    const primary = fakeProvider('gemini', { text: '{"title":"Kantin Tutup Lebih Awal"}' });

    const result = await AiService.generateTitle(
      { ...request, bannedWords: ['kantin'] },
      { primary, fallback: null }
    );

    expect(result.source).toBe('fallback');
  });

  it('tidak menyentuh provider saat AI dimatikan dan tidak ada provider', async () => {
    const result = await AiService.generateTitle(request, { primary: null, fallback: null });

    expect(result.source).toBe('fallback');
    expect(result.title.length).toBeGreaterThan(0);
    expect(prisma.aiGeneration.findUnique).not.toHaveBeenCalled();
  });

  it('mengembalikan fallback untuk isi kosong', async () => {
    const result = await AiService.generateTitle(
      { ...request, content: '   ' },
      { primary: fakeProvider('gemini', { text: '{"title":"Kantin Tutup Lebih Awal"}' }) }
    );

    expect(result.source).toBe('fallback');
  });

  it('tetap memakai AI ketika pencatatan ledger gagal', async () => {
    vi.mocked(prisma.aiGeneration.create).mockRejectedValue(new Error('unique constraint'));
    const primary = fakeProvider('gemini', { text: '{"title":"Kantin Tutup Lebih Awal"}' });

    const result = await AiService.generateTitle(request, { primary, fallback: null });

    expect(result).toMatchObject({ title: 'Kantin Tutup Lebih Awal', source: 'ai' });
  });
});

describe('helper AiService', () => {
  it('hash input stabil dan dipengaruhi promptVersion/handle/isi', () => {
    const base = { promptVersion: 'v1', handle: '@base', content: 'isi' };
    expect(hashTitleInput(base)).toBe(hashTitleInput({ ...base }));
    expect(hashTitleInput(base)).not.toBe(hashTitleInput({ ...base, promptVersion: 'v2' }));
    expect(hashTitleInput(base)).not.toBe(hashTitleInput({ ...base, handle: '@lain' }));
    expect(hashTitleInput(base)).not.toBe(hashTitleInput({ ...base, content: 'isi lain' }));
    expect(hashTitleInput(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('menebak nama provider dari host tanpa membocorkan URL penuh', () => {
    expect(
      providerNameFromUrl('https://generativelanguage.googleapis.com/v1beta/openai')
    ).toBe('gemini');
    expect(providerNameFromUrl('https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(providerNameFromUrl('https://api.deepseek.com')).toBe('deepseek');
    expect(providerNameFromUrl('https://api.openai.com/v1')).toBe('openai');
    expect(providerNameFromUrl('bukan-url', 'custom')).toBe('custom');
    expect(providerNameFromUrl('bukan-url')).toBe('ai');
  });
});