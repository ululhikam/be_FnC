import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma.js', () => {
  const client: any = {
    aiGeneration: { findUnique: vi.fn(), create: vi.fn() },
    systemLog: { create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  };
  client.$transaction = vi.fn((arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg)
  );
  return { prisma: client };
});

vi.mock('../src/services/rate-limit.service.js', () => ({
  RateLimitService: { consume: vi.fn() },
}));

vi.mock('../src/services/admin-security.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/admin-security.service.js')>();
  return { ...actual, AdminSecurityService: { ...actual.AdminSecurityService, writeAudit: vi.fn() } };
});

import { prisma } from '../src/config/prisma.js';
import { RateLimitService } from '../src/services/rate-limit.service.js';
import { AiService } from '../src/services/ai/ai.service.js';
import { AiProviderError, type AiProvider } from '../src/services/ai/provider.js';
import { sanitizeAssistantOutput } from '../src/services/ai/sanitize.js';
import { AdminAiService } from '../src/services/admin-ai.service.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';

const FIELDS = [
  {
    name: 'title',
    label: 'Judul pengumuman',
    type: 'text' as const,
    currentValue: '',
  },
  {
    name: 'body',
    label: 'Isi pengumuman',
    type: 'textarea' as const,
    currentValue: '',
  },
];

const AI_JSON = JSON.stringify({
  reply: 'Saya sarankan pengumuman singkat soal pemeliharaan malam ini.',
  suggestions: [
    { field: 'title', value: 'Pemeliharaan malam ini', reason: 'Jelas dan singkat' },
    {
      field: 'body',
      value: 'Layanan akan berhenti sementara pukul 23.00 sampai 23.30 WIB.',
      reason: 'Menyebut jam dan durasi',
    },
  ],
});

function fakeProvider(name: string, behaviour: { text?: string; error?: Error }): AiProvider {
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn(async () => {
      if (behaviour.error) throw behaviour.error;
      return {
        text: behaviour.text ?? '',
        provider: name,
        model: `${name}-model`,
        inputTokens: 120,
        outputTokens: 80,
        latencyMs: 35,
      };
    }),
  };
}

function quota(allowed = true) {
  vi.mocked(RateLimitService.consume).mockResolvedValue({
    allowed,
    count: allowed ? 1 : 501,
    limit: 500,
    remaining: allowed ? 499 : 0,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterSeconds: 60,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiGeneration.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.aiGeneration.create).mockResolvedValue({} as any);
  vi.mocked(prisma.systemLog.create).mockResolvedValue({} as any);
  vi.mocked(AdminSecurityService.writeAudit).mockResolvedValue(undefined as any);
  quota(true);
});

// ── Sanitasi keluaran asisten ───────────────────────────────────────────────

describe('sanitizeAssistantOutput', () => {
  it('menerima usulan untuk field yang benar-benar ada', () => {
    const output = sanitizeAssistantOutput(
      {
        reply: '  Ini **saran** saya.  ',
        suggestions: [{ field: 'title', value: '"Pengumuman Kampus"', reason: 'Singkat' }],
      },
      FIELDS
    );

    expect(output?.reply).toBe('Ini saran saya.');
    expect(output?.suggestions).toEqual([
      { field: 'title', value: 'Pengumuman Kampus', reason: 'Singkat' },
    ]);
  });

  it('membuang field yang tidak ada di formulir', () => {
    const output = sanitizeAssistantOutput(
      {
        reply: '',
        suggestions: [
          { field: 'harga_rahasia', value: '1', reason: null },
          { field: 'title', value: 'Sah', reason: null },
        ],
      },
      FIELDS
    );

    expect(output?.suggestions.map((item) => item.field)).toEqual(['title']);
  });

  it('menghapus duplikat field', () => {
    const output = sanitizeAssistantOutput(
      {
        reply: '',
        suggestions: [
          { field: 'title', value: 'Pertama', reason: null },
          { field: 'title', value: 'Kedua', reason: null },
        ],
      },
      FIELDS
    );

    expect(output?.suggestions).toHaveLength(1);
    expect(output?.suggestions[0].value).toBe('Pertama');
  });

  it('menyisakan angka saja untuk field number', () => {
    const output = sanitizeAssistantOutput(
      {
        reply: '',
        suggestions: [{ field: 'amount', value: 'Rp 1.500.000', reason: null }],
      },
      [{ name: 'amount', type: 'number' }]
    );

    expect(output?.suggestions[0].value).toBe('1500000');
  });

  it('mengembalikan null bila tidak ada balasan maupun usulan berguna', () => {
    expect(sanitizeAssistantOutput({ reply: '   ', suggestions: [] }, FIELDS)).toBeNull();
    expect(sanitizeAssistantOutput(null, FIELDS)).toBeNull();
    expect(sanitizeAssistantOutput('teks', FIELDS)).toBeNull();
    expect(
      sanitizeAssistantOutput({ suggestions: [{ field: 'title', value: '   ' }] }, FIELDS)
    ).toBeNull();
  });
});

// ── AiService.assistAdmin ───────────────────────────────────────────────────

describe('AiService.assistAdmin', () => {
  it('mengembalikan balasan + usulan dari provider utama', async () => {
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.assistAdmin(
      { context: 'Sistem · Notifikasi', fields: FIELDS, message: 'Bantu isi pengumuman' },
      { primary, fallback: null }
    );

    expect(result).toMatchObject({
      provider: 'gemini',
      model: 'gemini-model',
      promptVersion: 'v1',
    });
    expect(result?.reply).toContain('pemeliharaan');
    expect(result?.suggestions).toEqual([
      expect.objectContaining({ field: 'title', label: 'Judul pengumuman' }),
      expect.objectContaining({ field: 'body', label: 'Isi pengumuman' }),
    ]);
    expect(RateLimitService.consume).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:assistant:\d{4}-\d{2}-\d{2}$/),
      500,
      86400
    );
  });

  it('memakai provider cadangan saat provider utama kena 429', async () => {
    const primary = fakeProvider('gemini', {
      error: new AiProviderError('rate limited', { status: 429, retryable: true }),
    });
    const fallback = fakeProvider('openrouter', { text: AI_JSON });

    const result = await AiService.assistAdmin({ fields: FIELDS }, { primary, fallback });

    expect(result?.provider).toBe('openrouter');
  });

  it('mengembalikan null saat kuota harian habis', async () => {
    quota(false);
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.assistAdmin({ fields: FIELDS }, { primary, fallback: null });

    expect(result).toBeNull();
    expect(primary.complete).not.toHaveBeenCalled();
  });

  it('mengembalikan null saat keluaran tidak valid', async () => {
    const primary = fakeProvider('gemini', { text: 'bukan json' });

    const result = await AiService.assistAdmin({ fields: FIELDS }, { primary, fallback: null });

    expect(result).toBeNull();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'AI_ADMIN', tone: 'error' }),
      })
    );
  });

  it('tidak memanggil provider saat tidak ada field yang dikirim', async () => {
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.assistAdmin({ fields: [] }, { primary, fallback: null });

    expect(result).toBeNull();
    expect(primary.complete).not.toHaveBeenCalled();
    expect(RateLimitService.consume).not.toHaveBeenCalled();
  });
});

// ── AdminAiService.suggest (guardrail + audit) ─────────────────────────────

describe('AdminAiService.suggest', () => {
  it('mengembalikan saran bertanda belum diterapkan dan mencatat audit', async () => {
    vi.spyOn(AiService, 'isAssistantEnabled').mockReturnValue(true);
    vi.spyOn(AiService, 'assistAdmin').mockResolvedValue({
      reply: 'Isi seperti ini.',
      suggestions: [
        { field: 'title', label: 'Judul pengumuman', value: 'Pemeliharaan', reason: null },
      ],
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      promptVersion: 'v1',
      latencyMs: 420,
    });

    const result = await AdminAiService.suggest(
      'usr_admin',
      { context: 'Sistem · Notifikasi', fields: FIELDS, message: 'Bantu isi' },
      { ipAddress: '10.0.0.1', userAgent: 'vitest' }
    );

    expect(result).toMatchObject({ applied: false, provider: 'gemini' });
    expect(result.suggestions).toHaveLength(1);

    const audit = vi.mocked(AdminSecurityService.writeAudit).mock.calls[0][0];
    expect(audit).toMatchObject({
      actorId: 'usr_admin',
      action: 'ADMIN_AI_ASSISTED',
      targetType: 'AdminConsole',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
    });
    // Audit tidak boleh memuat nilai saran maupun isi field.
    expect(JSON.stringify(audit.metadata)).not.toContain('Pemeliharaan');
  });

  it('menolak dengan 409 AI_DISABLED saat fitur dimatikan', async () => {
    vi.spyOn(AiService, 'isAssistantEnabled').mockReturnValue(false);

    await expect(AdminAiService.suggest('usr_admin', { fields: FIELDS })).rejects.toMatchObject({
      code: 'AI_DISABLED',
      status: 409,
    });
    expect(AdminSecurityService.writeAudit).not.toHaveBeenCalled();
  });

  it('menolak dengan 502 AI_UNAVAILABLE saat provider gagal', async () => {
    vi.spyOn(AiService, 'isAssistantEnabled').mockReturnValue(true);
    vi.spyOn(AiService, 'assistAdmin').mockResolvedValue(null);

    await expect(AdminAiService.suggest('usr_admin', { fields: FIELDS })).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      status: 502,
    });
    expect(AdminSecurityService.writeAudit).not.toHaveBeenCalled();
  });
});
