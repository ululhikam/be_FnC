import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiCompatibleProvider } from '../src/services/ai/openai-compatible.provider.js';
import { AiProviderError } from '../src/services/ai/provider.js';

const BASE_URL = 'https://ai.test/v1';

function makeProvider(overrides: Partial<{ baseUrl: string; maxResponseBytes: number }> = {}) {
  return new OpenAiCompatibleProvider({
    name: 'gemini',
    baseUrl: overrides.baseUrl ?? BASE_URL,
    apiKey: 'test-key',
    model: 'gemini-test',
    maxResponseBytes: overrides.maxResponseBytes,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const input = {
  system: 'Sistem',
  user: 'Pengguna',
  maxOutputTokens: 120,
  timeoutMs: 1000,
};

describe('OpenAiCompatibleProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('memanggil /chat/completions dan mengembalikan teks + usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: ' {"title":"Kantin tutup awal"} ' } }],
        usage: { prompt_tokens: 120, completion_tokens: 18 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeProvider().complete(input);

    expect(result.text).toBe('{"title":"Kantin tutup awal"}');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-test');
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(18);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body).messages).toHaveLength(2);
  });

  it('menerima konten berbentuk array part', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: [{ text: 'Halo ' }, { text: 'dunia' }] } }] })
        )
    );

    await expect(makeProvider().complete(input)).resolves.toMatchObject({ text: 'Halo dunia' });
  });

  it('menandai 429 dan 5xx sebagai retryable', async () => {
    for (const status of [429, 500, 503]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sibuk', { status })));
      await expect(makeProvider().complete(input)).rejects.toMatchObject({
        name: 'AiProviderError',
        status,
        retryable: true,
      });
      vi.unstubAllGlobals();
    }
  });

  it('tidak menandai 4xx validasi sebagai retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('model salah', { status: 400 })));

    await expect(makeProvider().complete(input)).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 400,
      retryable: false,
    });
  });

  it('memetakan AbortError (timeout) menjadi error retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    );

    const error = await makeProvider()
      .complete(input)
      .catch((err) => err);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('batas waktu');
  });

  it('membatalkan fetch sendiri saat melewati timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: any) =>
        new Promise<Response>((_resolve, reject) => {
          expect(init.signal.aborted).toBe(false);
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeProvider().complete({ ...input, timeoutMs: 1000 })).rejects.toMatchObject({
      name: 'AiProviderError',
      retryable: true,
    });
  });

  it('menolak respons yang bukan JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>')));

    await expect(makeProvider().complete(input)).rejects.toMatchObject({
      name: 'AiProviderError',
      retryable: false,
    });
  });

  it('menolak respons tanpa teks jawaban', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }] })));

    await expect(makeProvider().complete(input)).rejects.toMatchObject({
      name: 'AiProviderError',
      retryable: false,
    });
  });

  it('memotong body respons yang kebesaran', async () => {
    const longText = 'a'.repeat(500);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: longText } }], pad: 'x'.repeat(500) })
        )
    );

    await expect(makeProvider({ maxResponseBytes: 64 }).complete(input)).rejects.toMatchObject({
      name: 'AiProviderError',
    });
  });

  it('memetakan kegagalan jaringan menjadi retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(makeProvider().complete(input)).rejects.toMatchObject({ retryable: true });
  });
});