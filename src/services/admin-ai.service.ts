import { AiService, type AssistantField } from './ai/ai.service.js';
import { AdminSecurityError, AdminSecurityService } from './admin-security.service.js';

/**
 * Asisten AI konsol Super Admin.
 *
 * Aturannya sama dengan AI lain di platform ini: **saran saja**. Service ini
 * tidak menulis ke tabel bisnis apa pun; satu-satunya jejak adalah baris audit
 * agar penggunaan AI bisa ditelusuri. Penyimpanan tetap lewat endpoint aslinya
 * yang mewajibkan re-auth + alasan.
 */
export class AdminAiService {
  static isEnabled(): boolean {
    return AiService.isAssistantEnabled();
  }

  static async suggest(
    actorId: string,
    input: {
      context?: string | null;
      message?: string | null;
      fields: AssistantField[];
    },
    meta: { ipAddress?: string | null; userAgent?: string | null } = {}
  ) {
    if (!AdminAiService.isEnabled()) {
      throw new AdminSecurityError(
        'AI_DISABLED',
        'Asisten AI sedang dimatikan atau kunci API belum diisi.',
        409
      );
    }

    const result = await AiService.assistAdmin({
      context: input.context ?? null,
      message: input.message ?? null,
      fields: input.fields,
    });

    if (!result) {
      throw new AdminSecurityError(
        'AI_UNAVAILABLE',
        'Asisten AI belum bisa memberi saran saat ini. Coba lagi sebentar lagi.',
        502
      );
    }

    // Audit hanya menyimpan metadata permintaan: nama field dan jumlah saran.
    // Nilai field dan isi percakapan tidak disalin agar data operasional tetap
    // di tempatnya, bukan menumpuk di tabel audit.
    await AdminSecurityService.writeAudit({
      actorId,
      action: 'ADMIN_AI_ASSISTED',
      targetType: 'AdminConsole',
      targetId: String(input.context || 'console').slice(0, 120),
      metadata: {
        fields: input.fields.map((field) => field.name).slice(0, 12),
        suggestion_count: result.suggestions.length,
        provider: result.provider,
        model: result.model,
        prompt_version: result.promptVersion,
        latency_ms: result.latencyMs,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      reply: result.reply,
      suggestions: result.suggestions,
      provider: result.provider,
      model: result.model,
      prompt_version: result.promptVersion,
      latency_ms: result.latencyMs,
      // UI memakai penanda ini untuk menegaskan nilai belum tersimpan.
      applied: false,
    };
  }
}