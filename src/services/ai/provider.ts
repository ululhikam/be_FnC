/**
 * Kontrak provider AI.
 *
 * Semua provider nyata memakai adapter OpenAI-compatible yang sama
 * (`openai-compatible.provider.ts`), jadi mengganti Gemini ↔ OpenRouter ↔
 * DeepSeek cukup lewat env tanpa menyentuh pemanggil.
 *
 * Aturan yang dipegang semua implementasi:
 * - Selalu `AbortController` + timeout;
 * - Tidak pernah melempar untuk 4xx validasi sebagai "retryable";
 * - Hasil mentah dikembalikan apa adanya — sanitasi/validasi ada di `ai.service`.
 */

export interface AiCompletionInput {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AiProvider {
  /** Nama pendek untuk ledger & log, mis. `gemini`. */
  readonly name: string;
  /** Model persis yang dipakai, mis. `gemini-2.5-flash-lite`. */
  readonly model: string;
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}

/**
 * Error provider dengan penanda `retryable` supaya pemanggil tahu kapan boleh
 * mencoba provider cadangan (429/5xx/timeout) dan kapan tidak (4xx validasi).
 */
export class AiProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}