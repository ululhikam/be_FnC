import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma.js', () => {
  const client: any = {
    aiGeneration: { findUnique: vi.fn(), create: vi.fn() },
    systemLog: { create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    template: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    base: { findUnique: vi.fn() },
  };
  client.$transaction = vi.fn((arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg)
  );
  return { prisma: client };
});

vi.mock('../src/services/rate-limit.service.js', () => ({
  RateLimitService: { consume: vi.fn() },
}));

vi.mock('../src/utils/template-admin.util.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/template-admin.util.js')>();
  return { ...actual, analyzeTemplateSvg: vi.fn() };
});

vi.mock('../src/services/canvas.service.js', () => ({
  CanvasService: { renderTemplateThumbnail: vi.fn(() => Buffer.from('<svg/>')) },
}));

vi.mock('../src/services/storage.service.js', () => ({
  StorageService: { uploadBuffer: vi.fn() },
}));

vi.mock('../src/services/admin-security.service.js', () => ({
  AdminSecurityService: { writeAudit: vi.fn() },
}));

import { prisma } from '../src/config/prisma.js';
import { RateLimitService } from '../src/services/rate-limit.service.js';
import { AiService } from '../src/services/ai/ai.service.js';
import { AiProviderError, type AiProvider } from '../src/services/ai/provider.js';
import { sanitizeTemplateMetadata } from '../src/services/ai/sanitize.js';
import { decodeXmlEntities, extractTemplateTexts } from '../src/utils/template-extract.util.js';
import { TemplateAdminService } from '../src/services/template-admin.service.js';
import { analyzeTemplateSvg, TemplateAdminError } from '../src/utils/template-admin.util.js';
import { AdminSecurityService } from '../src/services/admin-security.service.js';

const TEMPLATE_SVG = readFileSync(
  new URL('../assets/templates/01-helpdesk-ticket.svg', import.meta.url),
  'utf8'
);

const SLOTS = {
  anchor: { x: 252, y: 616 },
  message: { maxWidth: 784, maxLines: 4, bottom: 1022 },
  user: { x: 220, y: 434 },
  time: { x: 592, y: 434 },
  footer: { x: 478, y: 1124 },
  flagged: [],
};

const PALETTE = { bg: '#FFF9EC', ink: '#14245D', accent: '#DCEAD7' };

const ANALYSIS = {
  normalized: TEMPLATE_SVG,
  bytes: TEMPLATE_SVG.length,
  checksum: 'checksum-helpdesk',
  width: 1080,
  height: 1350,
  slots: SLOTS as any,
  palette: PALETTE,
  warnings: [] as string[],
};

const TEMPLATE_REQUEST = {
  key: '01-helpdesk-ticket',
  filename: '01-helpdesk-ticket.svg',
  width: 1080,
  height: 1350,
  palette: PALETTE,
  slotsSummary: {
    max_lines: 4,
    has_quote: false,
    has_user: true,
    has_time: true,
    has_footer: true,
    warnings: [],
  },
  texts: ['CAMPUS HELP DESK', 'FROM', '@ustfess', 'TIME', 'Tulis isi menfess kamu'],
};

const AI_JSON = JSON.stringify({
  label: 'Campus Help Desk',
  description: 'Kartu pengumuman resmi bernuansa kampus dengan tata letak tegas dan rapi.',
  category: 'campus',
  confidence: 0.82,
  rationale: 'Metadata FROM/TIME menandakan format pengumuman.',
});

const SUGGESTION = {
  label: 'Campus Help Desk',
  description: 'Kartu pengumuman resmi bernuansa kampus dengan tata letak tegas dan rapi.',
  category: 'campus',
  confidence: 0.82,
  rationale: 'Metadata FROM/TIME menandakan format pengumuman.',
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  cached: false,
  promptVersion: 'v1',
  latencyMs: 2100,
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
        inputTokens: 180,
        outputTokens: 60,
        latencyMs: 42,
      };
    }),
  };
}

function quota(allowed = true) {
  vi.mocked(RateLimitService.consume).mockResolvedValue({
    allowed,
    count: allowed ? 1 : 201,
    limit: 200,
    remaining: allowed ? 199 : 0,
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
  vi.mocked(analyzeTemplateSvg).mockResolvedValue(ANALYSIS as any);
  quota(true);
});

// ── Ekstraksi teks SVG ─────────────────────────────────────────────────────

describe('extractTemplateTexts', () => {
  it('mengambil teks nyata dari template tanpa duplikat', () => {
    const texts = extractTemplateTexts(TEMPLATE_SVG);

    expect(texts).toContain('CAMPUS HELP DESK');
    expect(texts).toContain('@ustfess');
    expect(texts).toContain('dikirim lewat myfess.id');
    expect(texts.filter((line) => line === 'OPEN')).toHaveLength(1);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.length).toBeLessThanOrEqual(20);
    expect(texts.some((line) => line.includes('<') || line.includes('&amp;'))).toBe(false);
  });

  it('menggabungkan isi tspan dan mendekode entitas XML', () => {
    const svg = [
      '<svg><text><tspan>A &amp; B</tspan><tspan>C</tspan></text>',
      '<text>duplikat</text><text>DUPLIKAT</text></svg>',
    ].join('');

    expect(extractTemplateTexts(svg)).toEqual(['A & B C', 'duplikat']);
  });

  it('membatasi jumlah baris dan panjang tiap baris', () => {
    const many = Array.from({ length: 25 }, (_, index) => `<text>Baris ${index + 1}</text>`);
    expect(extractTemplateTexts(many.join(''))).toHaveLength(20);

    const [line] = extractTemplateTexts(`<text>${'kata '.repeat(60)}</text>`, { maxChars: 40 });
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.endsWith(' ')).toBe(false);
  });

  it('mengabaikan komentar dan teks kosong', () => {
    const svg = '<svg><!-- <text>komentar</text> --><text>   </text><text>halo</text></svg>';
    expect(extractTemplateTexts(svg)).toEqual(['halo']);
  });

  it('mendekode entitas bernama dan numerik, membiarkan yang tidak dikenal', () => {
    expect(decodeXmlEntities('a &amp; b &#65; &#x42; &unknown;')).toBe('a & b A B &unknown;');
    expect(decodeXmlEntities('&lt;tag&gt; &quot;kutip&quot; &apos;x&apos;')).toBe(
      '<tag> "kutip" \'x\''
    );
  });
});

// ── Sanitasi metadata ──────────────────────────────────────────────────────

describe('sanitizeTemplateMetadata', () => {
  it('merapikan label, kategori, keyakinan, dan alasan', () => {
    const value = sanitizeTemplateMetadata({
      label: '  "papan pengumuman kampus"  ',
      description:
        'Papan pengumuman dengan nuansa kampus yang rapi dan mudah dibaca untuk info terbaru.',
      category: 'CAMPUS',
      confidence: '0.834',
      rationale: 'Warna mint dan tipografi tegas',
    });

    expect(value).toMatchObject({
      label: 'Papan Pengumuman Kampus',
      category: 'campus',
      confidence: 0.83,
      rationale: 'Warna mint dan tipografi tegas',
    });
    expect(value?.description.length).toBeGreaterThanOrEqual(40);
    expect(value?.description.length).toBeLessThanOrEqual(160);
  });

  it('mempertahankan akronim pendek dan kata sambung tetap huruf kecil', () => {
    const value = sanitizeTemplateMetadata({
      label: 'BEM dan papan kampus',
      description:
        'Papan pengumuman organisasi mahasiswa dengan warna tegas dan ruang tulis yang lega.',
      category: 'campus',
      confidence: 0.6,
    });

    expect(value?.label).toBe('BEM dan Papan Kampus');
  });

  it('memaksa kategori di luar allowlist menjadi classic', () => {
    const value = sanitizeTemplateMetadata({
      label: 'Kartu Kampus',
      description:
        'Kartu pengumuman kampus dengan warna cerah dan tata letak sederhana untuk dibaca.',
      category: 'retro',
      confidence: 5,
    });

    expect(value?.category).toBe('classic');
    expect(value?.confidence).toBe(1);
  });

  it('menolak label terlalu pendek, deskripsi terlalu pendek, dan bentuk bukan objek', () => {
    const description =
      'Deskripsi yang cukup panjang untuk lolos batas minimal empat puluh karakter.';

    expect(sanitizeTemplateMetadata({ label: 'Ai', description })).toBeNull();
    expect(sanitizeTemplateMetadata({ label: 'Kartu Kampus', description: 'Terlalu pendek.' })).toBeNull();
    expect(sanitizeTemplateMetadata(null)).toBeNull();
    expect(sanitizeTemplateMetadata('teks bebas')).toBeNull();
    expect(sanitizeTemplateMetadata({ description })).toBeNull();
  });

  it('membuang emoji dan markup dari label', () => {
    const value = sanitizeTemplateMetadata({
      label: '🎉 <b>Kartu Seru</b> 🎉',
      description:
        'Kartu bernuansa ceria dengan warna hangat dan tipografi besar untuk pengumuman seru.',
      category: 'playful',
      confidence: 0.4,
    });

    expect(value?.label).toBe('Kartu Seru');
    expect(value?.category).toBe('playful');
  });

  it('mengambil satu kalimat dan memotong deskripsi di 160 karakter', () => {
    const value = sanitizeTemplateMetadata({
      label: 'Kartu Panjang',
      description:
        'Satu kalimat yang cukup panjang untuk lolos batas minimal empat puluh karakter. Kalimat kedua yang seharusnya dibuang.',
      category: 'editorial',
      confidence: 0.5,
    });

    expect(value?.description).toBe(
      'Satu kalimat yang cukup panjang untuk lolos batas minimal empat puluh karakter.'
    );
    expect(value?.description).not.toContain('Kalimat kedua');
  });
});

// ── AiService.suggestTemplateMetadata ──────────────────────────────────────

describe('AiService.suggestTemplateMetadata', () => {
  it('mengembalikan metadata provider utama dan mencatat ledger status ok', async () => {
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback: null,
    });

    expect(result).toMatchObject({
      label: 'Campus Help Desk',
      category: 'campus',
      provider: 'gemini',
      cached: false,
      promptVersion: 'v1',
    });
    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(RateLimitService.consume).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:template:\d{4}-\d{2}-\d{2}$/),
      200,
      86400
    );
    expect(prisma.aiGeneration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'template_metadata',
          status: 'ok',
          targetType: 'Template',
          targetId: '01-helpdesk-ticket',
          output: expect.objectContaining({ label: 'Campus Help Desk' }),
        }),
      })
    );
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'AI_TEMPLATE', tone: 'ok' }),
      })
    );
  });

  it('memakai cache tanpa memanggil provider maupun kuota', async () => {
    vi.mocked(prisma.aiGeneration.findUnique).mockResolvedValue({
      output: {
        label: 'Dari Cache',
        description:
          'Metadata yang sudah tersimpan sebelumnya dan dipakai ulang tanpa memanggil provider.',
        category: 'editorial',
        confidence: 0.7,
        rationale: null,
      },
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
    } as any);
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback: null,
    });

    expect(result).toMatchObject({ label: 'Dari Cache', cached: true, category: 'editorial' });
    expect(primary.complete).not.toHaveBeenCalled();
    expect(RateLimitService.consume).not.toHaveBeenCalled();
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
  });

  it('mencoba provider cadangan saat provider utama kena 429', async () => {
    const primary = fakeProvider('gemini', {
      error: new AiProviderError('rate limited', { status: 429, retryable: true }),
    });
    const fallback = fakeProvider('openrouter', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback,
    });

    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(fallback.complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ label: 'Campus Help Desk', provider: 'openrouter' });
  });

  it('mengembalikan null bila kedua provider memberi keluaran tidak valid', async () => {
    const primary = fakeProvider('gemini', { text: 'bukan json' });
    const fallback = fakeProvider('openrouter', { text: '{"label":"x"}' });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback,
    });

    expect(result).toBeNull();
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'AI_TEMPLATE', tone: 'error' }),
      })
    );
  });

  it('tidak mencoba cadangan saat provider menolak validasi (4xx)', async () => {
    const primary = fakeProvider('gemini', {
      error: new AiProviderError('bad key', { status: 401, retryable: false }),
    });
    const fallback = fakeProvider('openrouter', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback,
    });

    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('tidak menyentuh provider saat fitur dimatikan dan tidak ada provider', async () => {
    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary: null,
      fallback: null,
    });

    expect(result).toBeNull();
    expect(prisma.aiGeneration.findUnique).not.toHaveBeenCalled();
    expect(RateLimitService.consume).not.toHaveBeenCalled();
  });

  it('melewati AI bila tidak ada teks contoh yang bisa dibaca', async () => {
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(
      { ...TEMPLATE_REQUEST, texts: [] },
      { primary, fallback: null }
    );

    expect(result).toBeNull();
    expect(primary.complete).not.toHaveBeenCalled();
    expect(prisma.systemLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'AI_TEMPLATE', tone: 'muted' }),
      })
    );
  });

  it('mengembalikan null saat kuota harian habis', async () => {
    quota(false);
    const primary = fakeProvider('gemini', { text: AI_JSON });

    const result = await AiService.suggestTemplateMetadata(TEMPLATE_REQUEST, {
      primary,
      fallback: null,
    });

    expect(result).toBeNull();
    expect(primary.complete).not.toHaveBeenCalled();
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
  });
});

// ── TemplateAdminService.suggestMetadata ──────────────────────────────────

describe('TemplateAdminService.suggestMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mengusulkan metadata dari SVG tanpa menyimpan apa pun', async () => {
    const suggest = vi
      .spyOn(AiService, 'suggestTemplateMetadata')
      .mockResolvedValue(SUGGESTION as any);

    const result = await TemplateAdminService.suggestMetadata(
      'usr_admin',
      { svg: TEMPLATE_SVG, key: '01-helpdesk-ticket', filename: '01-helpdesk-ticket.svg' },
      { ipAddress: '10.0.0.1', userAgent: 'vitest' }
    );

    expect(result.data).toMatchObject({
      key: '01-helpdesk-ticket',
      label: 'Campus Help Desk',
      category: 'campus',
      provider: 'gemini',
    });
    expect(result.data.texts_used).toBeGreaterThan(0);

    const sent = vi.mocked(suggest).mock.calls[0][0];
    expect(sent.texts).toContain('CAMPUS HELP DESK');
    expect(sent).toMatchObject({ key: '01-helpdesk-ticket', width: 1080, height: 1350 });

    expect(AdminSecurityService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'usr_admin',
        action: 'TEMPLATE_AI_SUGGESTED',
        targetType: 'Template',
        targetId: '01-helpdesk-ticket',
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
      })
    );
    // Usulan tidak boleh menulis tabel Template.
    expect(prisma.template.create).not.toHaveBeenCalled();
    expect(prisma.template.update).not.toHaveBeenCalled();
  });

  it('memakai key placeholder saat key belum valid', async () => {
    const suggest = vi
      .spyOn(AiService, 'suggestTemplateMetadata')
      .mockResolvedValue(SUGGESTION as any);

    const result = await TemplateAdminService.suggestMetadata('usr_admin', {
      svg: TEMPLATE_SVG,
      key: 'Bukan Key!',
    });

    expect(analyzeTemplateSvg).toHaveBeenCalledWith(TEMPLATE_SVG, 'draft-template');
    expect(vi.mocked(suggest).mock.calls[0][0].key).toBe('draft-template');
    expect(result.data.key).toBe('Bukan Key!');
  });

  it('mengembalikan 409 TEMPLATE_AI_DISABLED saat fitur dimatikan', async () => {
    vi.spyOn(AiService, 'suggestTemplateMetadata').mockResolvedValue(null);
    vi.spyOn(AiService, 'isTemplateMetadataEnabled').mockReturnValue(false);

    await expect(
      TemplateAdminService.suggestMetadata('usr_admin', { svg: TEMPLATE_SVG, key: '01-helpdesk-ticket' })
    ).rejects.toMatchObject({ code: 'TEMPLATE_AI_DISABLED', status: 409 });

    expect(AdminSecurityService.writeAudit).not.toHaveBeenCalled();
  });

  it('mengembalikan 502 TEMPLATE_AI_FAILED saat AI aktif tetapi gagal', async () => {
    vi.spyOn(AiService, 'suggestTemplateMetadata').mockResolvedValue(null);
    vi.spyOn(AiService, 'isTemplateMetadataEnabled').mockReturnValue(true);

    const error = await TemplateAdminService.suggestMetadata('usr_admin', {
      svg: TEMPLATE_SVG,
      key: '01-helpdesk-ticket',
    }).catch((err) => err);

    expect(error).toBeInstanceOf(TemplateAdminError);
    expect(error).toMatchObject({ code: 'TEMPLATE_AI_FAILED', status: 502 });
    expect(AdminSecurityService.writeAudit).not.toHaveBeenCalled();
  });
});