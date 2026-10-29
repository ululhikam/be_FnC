/**
 * Adapter OpenAI-compatible berbasis `fetch` (tanpa SDK).
 *
 * Dipakai untuk semua provider: Gemini free tier (default), OpenRouter
 * (cadangan), DeepSeek langsung, atau OpenAI — semuanya mengekspos
 * `POST <base_url>/chat/completions` dengan skema `messages` yang sama.
 */
import { AiProviderError, type AiCompletionInput, type AiCompletionResult, type AiProvider } from './provider.js';

export interface OpenAiCompatibleConfig {
  /** Nama pendek untuk ledger/log (`gemini`, `openrouter`, …). */
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Header tambahan, mis. `HTTP-Referer`/`X-Title` untuk OpenRouter. */
  headers?: Record<string, string>;
  /** Batas respons mentah agar tidak menahan memori saat provider nakal. */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  private readonly config: OpenAiCompatibleConfig;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config;
    this.name = config.name;
    this.model = config.model;
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const startedAt = Date.now();
    const url = `${String(this.config.baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.headers || {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          max_tokens: Math.max(16, input.maxOutputTokens),
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await readBoundedText(response, 2000);
        throw new AiProviderError(
          `Provider ${this.name} menolak permintaan (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
          { status: response.status, retryable: response.status === 429 || response.status >= 500 }
        );
      }

      const raw = await readBoundedText(response, this.config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiProviderError(`Respons ${this.name} bukan JSON.`, { retryable: false });
      }

      const text = extractChoiceText(payload);
      if (!text) {
        throw new AiProviderError(`Respons ${this.name} tidak berisi teks.`, { retryable: false });
      }

      return {
        text,
        provider: this.name,
        model: this.model,
        inputTokens: toInt(payload?.usage?.prompt_tokens),
        outputTokens: toInt(payload?.usage?.completion_tokens),
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      if (err?.name === 'AbortError') {
        throw new AiProviderError(`Provider ${this.name} melewati batas waktu.`, { retryable: true });
      }
      throw new AiProviderError(`Gagal menghubungi provider ${this.name}: ${err?.message || err}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Konten jawaban bisa `string` atau array part (beberapa provider). */
function extractChoiceText(payload: any): string {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : String(part?.text || '')))
      .join('')
      .trim();
  }
  // Sebagian provider "reasoning" menaruh jawaban di `text`.
  const text = payload?.choices?.[0]?.text;
  return typeof text === 'string' ? text.trim() : '';
}

/** Baca body dengan batas byte supaya respons besar tidak menahan memori. */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}