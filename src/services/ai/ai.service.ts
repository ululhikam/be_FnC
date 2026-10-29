/**
 * Layanan AI untuk judul cover Instagram.
 *
 * Alur satu permintaan:
 *   cache (AiGeneration) → plafon internal (RateLimitService) → provider utama
 *   → provider cadangan (sekali, bila 429/5xx/timeout) → `fallbackTitle()`
 *
 * Tidak pernah melempar: kegagalan apa pun harus berujung judul fallback agar
 * publish tetap jalan. Semua keputusan dicatat di `AiGeneration` (ledger) dan
 * `SystemLog` (`source: AI_TITLE`).
 */
import crypto from 'crypto';
import { ENV } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { RateLimitService } from '../rate-limit.service.js';
import { fallbackTitle } from '../../utils/thumbnail.util.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';
import { AiProviderError, type AiCompletionResult, type AiProvider } from './provider.js';
import {
  TEMPLATE_MAX_OUTPUT_TOKENS,
  TEMPLATE_PROMPT_VERSION,
  TEMPLATE_SYSTEM_PROMPT,
  TEMPLATE_CATEGORIES,
  TITLE_MAX_OUTPUT_TOKENS,
  TITLE_PROMPT_VERSION,
  TITLE_SYSTEM_PROMPT,
  buildTemplateUserPrompt,
  buildTitleUserPrompt,
} from './prompts.js';
import {
  parseJsonObject,
  sanitizeTemplateMetadata,
  sanitizeTitle,
} from './sanitize.js';

export const AI_TITLE_KIND = 'fess_title';
export const AI_TEMPLATE_KIND = 'template_metadata';

export interface TitleRequest {
  baseId: string;
  baseHandle: string;
  baseName?: string | null;
  content: string;
  topic?: string | null;
  tag?: string | null;
  bannedWords?: string[] | null;
  /** Id fess untuk kolom ledger (`targetType: 'Fess'`). */
  targetId?: string | null;
}

export interface TitleResult {
  title: string;
  source: 'ai' | 'cache' | 'fallback';
  promptVersion: string;
  provider?: string;
  model?: string;
  latencyMs: number;
}

/** Provider bisa di-inject supaya test tidak menyentuh jaringan. */
export interface GenerateTitleDeps {
  primary?: AiProvider | null;
  fallback?: AiProvider | null;
}

/** Permintaan metadata template (tanpa menulis DB apa pun). */
export interface TemplateMetadataRequest {
  key: string;
  filename?: string | null;
  width: number;
  height: number;
  palette?: { bg?: string | null; ink?: string | null; accent?: string | null } | null;
  slotsSummary?: Record<string, unknown> | null;
  texts: string[];
}

export interface TemplateMetadataResult {
  label: string;
  description: string;
  category: string;
  confidence: number;
  rationale: string | null;
  provider: string;
  model: string;
  cached: boolean;
  promptVersion: string;
  latencyMs: number;
}

interface ResolvedProviders {
  primary: AiProvider | null;
  fallback: AiProvider | null;
}

export class AiService {
  /** Kill switch gabungan: `AI_ENABLED` (sudah wajib ber-API key) + fitur judul. */
  static isTitleEnabled(): boolean {
    return Boolean(ENV.AI_ENABLED && ENV.AI_TITLE_ENABLED);
  }

  /**
   * Buat judul cover. Selalu mengembalikan string yang layak dipakai; sumbernya
   * ditandai agar bisa diukur (rasio fallback).
   */
  static async generateTitle(
    request: TitleRequest,
    deps: GenerateTitleDeps = {}
  ): Promise<TitleResult> {
    const promptVersion = TITLE_PROMPT_VERSION;
    const content = String(request.content || '').trim();
    const fallback = (): TitleResult => ({
      title: fallbackTitle(content),
      source: 'fallback',
      promptVersion,
      latencyMs: 0,
    });

    if (!content) return fallback();
    if (!AiService.isTitleEnabled() && !deps.primary) return fallback();

    const handle = normalizeHandle(request.baseHandle);
    const inputHash = hashTitleInput({ promptVersion, handle, content });

    const cached = await readCachedTitle(inputHash);
    if (cached) {
      return {
        title: cached.title,
        source: 'cache',
        promptVersion,
        provider: cached.provider,
        model: cached.model,
        latencyMs: 0,
      };
    }

    const providers = resolveProviders(deps);
    if (!providers.primary) return fallback();

    if (!(await consumeTitleQuota(request.baseId))) {
      await logAi('muted', `Kuota judul AI habis untuk base ${handle}; memakai fallback.`);
      return fallback();
    }

    const startedAt = Date.now();
    const outcome = await completeWithFailover(
      providers,
      {
        system: TITLE_SYSTEM_PROMPT,
        user: buildTitleUserPrompt({
          baseName: request.baseName,
          baseHandle: handle,
          content,
          topic: request.topic,
          tag: request.tag,
        }),
        maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
      },
      (text) => toTitle(text, request),
      startedAt
    );

    if (!outcome) {
      await logAi('error', `Judul AI untuk base ${handle} memakai fallback deterministik.`);
      return fallback();
    }

    const providerName = outcome.completion.provider || outcome.provider.name;
    const modelName = outcome.completion.model || outcome.provider.model;
    const latencyMs = outcome.completion.latencyMs || Date.now() - startedAt;

    await recordGeneration({
      kind: AI_TITLE_KIND,
      provider: providerName,
      model: modelName,
      promptVersion,
      inputHash,
      targetId: request.targetId,
      output: { title: outcome.value },
      inputTokens: outcome.completion.inputTokens,
      outputTokens: outcome.completion.outputTokens,
      latencyMs,
      status: 'ok',
    });

    return {
      title: outcome.value,
      source: 'ai',
      promptVersion,
      provider: providerName,
      model: modelName,
      latencyMs,
    };
  }

  /** Kill switch metadata template: `AI_ENABLED` + `AI_TEMPLATE_METADATA_ENABLED`. */
  static isTemplateMetadataEnabled(): boolean {
    return Boolean(ENV.AI_ENABLED && ENV.AI_TEMPLATE_METADATA_ENABLED);
  }

  /**
   * Usulkan metadata katalog untuk satu SVG template.
   *
   * Berbeda dari judul cover, tidak ada fallback karangan: bila AI mati atau
   * keluarannya tidak valid hasilnya `null`, lalu controller mengembalikan
   * error. Metadata salah lebih berbahaya daripada tidak ada usulan.
   */
  static async suggestTemplateMetadata(
    request: TemplateMetadataRequest,
    deps: GenerateTitleDeps = {}
  ): Promise<TemplateMetadataResult | null> {
    const promptVersion = TEMPLATE_PROMPT_VERSION;
    const texts = (Array.isArray(request.texts) ? request.texts : []).filter(Boolean);

    if (!AiService.isTemplateMetadataEnabled() && !deps.primary) return null;
    if (!texts.length) {
      await logAi(
        'muted',
        'Metadata template dilewati: tidak ada teks contoh yang bisa dibaca.',
        'AI_TEMPLATE'
      );
      return null;
    }

    const inputHash = hashTemplateInput({ promptVersion, key: request.key, texts });

    const cached = await readCachedGeneration(AI_TEMPLATE_KIND, inputHash);
    if (cached) {
      const value = sanitizeTemplateMetadata(cached.output, { categories: TEMPLATE_CATEGORIES });
      if (value) {
        return {
          ...value,
          provider: cached.provider,
          model: cached.model,
          cached: true,
          promptVersion,
          latencyMs: 0,
        };
      }
    }

    const providers = resolveProviders(deps);
    if (!providers.primary) return null;

    if (!(await consumeTemplateQuota())) {
      await logAi('muted', 'Kuota metadata template AI habis; usulan tidak dibuat.', 'AI_TEMPLATE');
      return null;
    }

    const startedAt = Date.now();
    const outcome = await completeWithFailover(
      providers,
      {
        system: TEMPLATE_SYSTEM_PROMPT,
        user: buildTemplateUserPrompt({
          key: request.key,
          filename: request.filename,
          width: request.width,
          height: request.height,
          palette: request.palette ?? null,
          slotsSummary: request.slotsSummary ?? null,
          texts,
        }),
        maxOutputTokens: TEMPLATE_MAX_OUTPUT_TOKENS,
      },
      (text) => {
        const parsed = parseJsonObject(text);
        return parsed ? sanitizeTemplateMetadata(parsed, { categories: TEMPLATE_CATEGORIES }) : null;
      },
      startedAt,
      'AI_TEMPLATE'
    );

    if (!outcome) {
      await logAi('error', `Metadata template ${request.key} gagal dibuat AI.`, 'AI_TEMPLATE');
      return null;
    }

    const providerName = outcome.completion.provider || outcome.provider.name;
    const modelName = outcome.completion.model || outcome.provider.model;
    const latencyMs = outcome.completion.latencyMs || Date.now() - startedAt;

    await recordGeneration({
      kind: AI_TEMPLATE_KIND,
      provider: providerName,
      model: modelName,
      promptVersion,
      inputHash,
      targetId: request.key,
      targetType: 'Template',
      output: outcome.value,
      inputTokens: outcome.completion.inputTokens,
      outputTokens: outcome.completion.outputTokens,
      latencyMs,
      status: 'ok',
    });

    await logAi(
      'ok',
      `Metadata template ${request.key} diusulkan lewat ${providerName} (keyakinan ${outcome.value.confidence}).`,
      'AI_TEMPLATE'
    );

    return {
      ...outcome.value,
      provider: providerName,
      model: modelName,
      cached: false,
      promptVersion,
      latencyMs,
    };
  }
}

// ── Jalur provider bersama ─────────────────────────────────────────────────

interface FailoverPayload {
  system: string;
  user: string;
  maxOutputTokens: number;
}

interface FailoverOutcome<T> {
  value: T;
  completion: AiCompletionResult;
  provider: AiProvider;
}

/**
 * Coba provider utama lalu cadangan (sekali) dengan satu validator keluaran.
 *
 * Validator mengembalikan `null` bila jawaban tidak lolos aturan bisnis; itu
 * diperlakukan seperti 429 (retryable) supaya provider cadangan masih dicoba.
 * Error 4xx dari provider dianggap final: tidak ada gunanya mengulang dengan
 * kredensial yang sama di provider yang sama.
 */
async function completeWithFailover<T>(
  providers: ResolvedProviders,
  payload: FailoverPayload,
  parse: (text: string) => T | null,
  startedAt = Date.now(),
  source: AiLogSource = 'AI_TITLE'
): Promise<FailoverOutcome<T> | null> {
  const deadline = startedAt + overallDeadlineMs();
  const attempts = [providers.primary, providers.fallback].filter(Boolean) as AiProvider[];

  for (const provider of attempts) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;

    try {
      const completion = await provider.complete({
        system: payload.system,
        user: payload.user,
        maxOutputTokens: payload.maxOutputTokens,
        timeoutMs: Math.min(ENV.AI_TIMEOUT_MS, remaining),
      });

      const value = parse(completion.text);
      if (value === null || value === undefined) {
        throw new AiProviderError(`Keluaran ${provider.name} tidak lolos validasi.`, {
          retryable: true,
        });
      }

      return { value, completion, provider };
    } catch (err: any) {
      const message = String(err?.message || 'Gagal memanggil provider AI.');
      const retryable = err instanceof AiProviderError ? err.retryable : true;
      await logAi('error', `AI (${provider.name}) gagal: ${clip(message, 400)}`, source);
      if (!retryable) break;
    }
  }

  return null;
}

// ── Provider ───────────────────────────────────────────────────────────────

/** Susun provider dari env. `null` bila tidak dikonfigurasi. */
export function resolveProviders(deps: GenerateTitleDeps = {}): ResolvedProviders {
  const primary =
    deps.primary !== undefined ? deps.primary : buildProvider('primary');
  const fallback =
    deps.fallback !== undefined ? deps.fallback : buildProvider('fallback');
  return { primary: primary || null, fallback: fallback || null };
}

function buildProvider(role: 'primary' | 'fallback'): AiProvider | null {
  const isFallback = role === 'fallback';
  const baseUrl = isFallback ? ENV.AI_FALLBACK_BASE_URL : ENV.AI_BASE_URL;
  const apiKey = isFallback ? ENV.AI_FALLBACK_API_KEY : ENV.AI_API_KEY;
  const model = isFallback ? ENV.AI_FALLBACK_MODEL : ENV.AI_MODEL;
  if (!baseUrl || !apiKey || !model) return null;

  const name = providerNameFromUrl(baseUrl, isFallback ? 'fallback' : 'ai');
  return new OpenAiCompatibleProvider({
    name,
    baseUrl,
    apiKey,
    model,
    // OpenRouter memberi atribusi lewat header ini (opsional, bukan auth).
    ...(name === 'openrouter'
      ? { headers: { 'HTTP-Referer': ENV.FRONTEND_URL, 'X-Title': 'Fess n Curious' } }
      : {}),
  });
}

/** Nama pendek provider untuk ledger/log (tidak pernah mengembalikan API key). */
export function providerNameFromUrl(baseUrl: string, fallbackName = 'ai'): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('generativelanguage') || host.includes('googleapis')) return 'gemini';
    if (host.includes('openrouter')) return 'openrouter';
    if (host.includes('deepseek')) return 'deepseek';
    if (host.includes('openai')) return 'openai';
    return fallbackName || 'custom';
  } catch {
    return fallbackName || 'custom';
  }
}

// ── Cache & ledger ─────────────────────────────────────────────────────────

/** `sha256(kind + promptVersion + handle + content)` — sama dengan spec. */
export function hashTitleInput(input: {
  promptVersion: string;
  handle: string;
  content: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${AI_TITLE_KIND}|${input.promptVersion}|${input.handle}|${input.content}`)
    .digest('hex');
}

/** `sha256(kind + promptVersion + key + teks)` untuk cache metadata template. */
export function hashTemplateInput(input: {
  promptVersion: string;
  key: string;
  texts: string[];
}): string {
  return crypto
    .createHash('sha256')
    .update(
      `${AI_TEMPLATE_KIND}|${input.promptVersion}|${input.key}|${input.texts.join('\u0000')}`
    )
    .digest('hex');
}

async function readCachedGeneration(
  kind: string,
  inputHash: string
): Promise<{ output: unknown; provider: string; model: string } | null> {
  try {
    const row = await prisma.aiGeneration.findUnique({
      where: { kind_inputHash: { kind, inputHash } },
      select: { output: true, provider: true, model: true },
    });
    if (!row || row.output === null || typeof row.output !== 'object') return null;
    return { output: row.output, provider: row.provider, model: row.model };
  } catch {
    // Cache bersifat penghemat kuota, bukan syarat fitur.
    return null;
  }
}

async function readCachedTitle(
  inputHash: string
): Promise<{ title: string; provider?: string; model?: string } | null> {
  const cached = await readCachedGeneration(AI_TITLE_KIND, inputHash);
  if (!cached) return null;
  const title = String((cached.output as any)?.title || '').trim();
  if (!title) return null;
  return { title, provider: cached.provider, model: cached.model };
}

interface RecordGenerationInput {
  kind: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  targetId?: string | null;
  /** `Fess` untuk judul, `Template` untuk metadata template. */
  targetType?: 'Fess' | 'Template' | null;
  output: object;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'ok' | 'fallback' | 'error';
  error?: string;
}

async function recordGeneration(input: RecordGenerationInput): Promise<void> {
  try {
    await prisma.aiGeneration.create({
      data: {
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        targetType: input.targetType ?? (input.targetId ? 'Fess' : null),
        targetId: input.targetId || null,
        output: input.output as any,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        status: input.status,
        error: input.error || null,
      },
    });
  } catch {
    // Balapan antar-instance: baris dengan inputHash sama sudah ada. Aman.
  }
}

// ── Kuota ──────────────────────────────────────────────────────────────────

/** Plafon internal judul: per base/hari, global/hari, lalu laju per menit. */
async function consumeTitleQuota(baseId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const perBase = await RateLimitService.consume(
      `ai:title:${baseId}:${day}`,
      ENV.AI_DAILY_TITLE_LIMIT_PER_BASE,
      86400
    );
    if (!perBase.allowed) return false;

    const global = await RateLimitService.consume(
      `ai:title:global:${day}`,
      ENV.AI_DAILY_TITLE_LIMIT,
      86400
    );
    if (!global.allowed) return false;

    const rpm = await RateLimitService.consume('ai:rpm', ENV.AI_RPM_LIMIT, 60);
    return rpm.allowed;
  } catch (err: any) {
    // Postgres bermasalah bukan alasan menahan judul AI; catat lalu izinkan.
    await logAi('muted', `Cek kuota judul AI gagal: ${clip(String(err?.message || err), 300)}`);
    return true;
  }
}

/** Plafon metadata template: harian global + laju per menit (tanpa per base). */
async function consumeTemplateQuota(): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const daily = await RateLimitService.consume(
      `ai:template:${day}`,
      ENV.AI_DAILY_TEMPLATE_LIMIT,
      86400
    );
    if (!daily.allowed) return false;

    const rpm = await RateLimitService.consume('ai:rpm', ENV.AI_RPM_LIMIT, 60);
    return rpm.allowed;
  } catch (err: any) {
    // Konsol admin tetap boleh bekerja walau pengecekan kuota bermasalah.
    await logAi('muted', `Cek kuota metadata template gagal: ${clip(String(err?.message || err), 300)}`);
    return true;
  }
}

// ── Helper kecil ───────────────────────────────────────────────────────────

/** Batas total tunggu satu permintaan: `AI_TIMEOUT_MS + 1s`, maksimum 8s. */
function overallDeadlineMs(): number {
  return Math.min(Math.max(ENV.AI_TIMEOUT_MS + 1000, 1500), 8000);
}

function toTitle(raw: string, request: TitleRequest): string | null {
  const parsed = parseJsonObject(raw);
  const candidate =
    parsed && typeof parsed.title === 'string' ? parsed.title : parsed ? '' : raw;
  return sanitizeTitle(candidate, {
    bannedWords: request.bannedWords,
    maxChars: 60,
  });
}

function normalizeHandle(handle: string): string {
  const raw = String(handle || '').trim();
  return raw.startsWith('@') ? raw : raw ? `@${raw}` : '@fess';
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

type AiLogSource = 'AI_TITLE' | 'AI_TEMPLATE';

async function logAi(
  tone: 'ok' | 'info' | 'muted' | 'error',
  message: string,
  source: AiLogSource = 'AI_TITLE'
): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: { source, tone, message: clip(message, 500) },
    });
  } catch {
    /* logging tidak boleh menggagalkan publish */
  }
}