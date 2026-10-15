import { describe, it, expect } from 'vitest';
import { ModerationService } from '../src/services/moderation.service.js';

describe('ModerationService (filter NLP auto post)', () => {
  it('should not flag normal confession text', () => {
    const verdict = ModerationService.classify(
      'Aku suka banget sama dia, tapi gak berani bilang. Ada saran?'
    );
    expect(verdict.flagged).toBe(false);
    expect(verdict.reasons).toEqual([]);
  });

  it('should flag hate speech (kata kasar)', () => {
    const verdict = ModerationService.classify('Dasar anjing, berani-beraninya kamu!');
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('ujaran kebencian');
  });

  it('should flag threats', () => {
    const verdict = ModerationService.classify('Awas ya, aku bakal bunuh kamu.');
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('ancaman');
  });

  it('should flag obfuscated leetspeak (4nj1ng)', () => {
    const verdict = ModerationService.classify('d4s4r 4nj1ng lu');
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('ujaran kebencian');
  });

  it('should flag repeated-letter obfuscation (anjiiing)', () => {
    const verdict = ModerationService.classify('anjiiiiing sabar ya kamu');
    expect(verdict.flagged).toBe(true);
  });

  it('should flag gambling spam', () => {
    const verdict = ModerationService.classify('Join slot gacor maxwin dijamin wd!');
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('judi/spam online');
  });

  it('should flag self-harm encouragement', () => {
    const verdict = ModerationService.classify('mending bunuh diri aja hidup gini');
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('ajakan menyakiti diri');
  });

  it('should flag massive spam links', () => {
    const verdict = ModerationService.classify(
      'mampir ya https://a.com https://b.com https://c.com'
    );
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('spam link');
  });

  it('should use word boundaries (not substring) — "membunuh waktu" is safe', () => {
    const verdict = ModerationService.classify('Aku sedang membunuh waktu di kampus.');
    expect(verdict.flagged).toBe(false);
  });

  it('should normalize zero-width characters', () => {
    const verdict = ModerationService.classify('anj\u200bing');
    expect(verdict.flagged).toBe(true);
  });

  it('should flag custom banned words from the base blacklist', () => {
    const verdict = ModerationService.classify('Promo tiket konser ada di bio!', ['konser']);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('kata terlarang');
    expect(verdict.matches).toContain('konser');
  });

  it('should match banned words case-insensitively and with leetspeak', () => {
    const verdict = ModerationService.classify('IKLANNYA 4dag4n murah', ['iklan', 'adag4n']);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain('kata terlarang');
  });

  it('should match banned phrases (multi-word)', () => {
    const verdict = ModerationService.classify('Jangan lupa beli tiket cepat ya', [
      'beli tiket cepat',
    ]);
    expect(verdict.flagged).toBe(true);
  });

  it('should keep word boundaries for banned words (substring is safe)', () => {
    const verdict = ModerationService.classify('Promosi produk lokal keren banget', ['promo']);
    expect(verdict.flagged).toBe(false);
  });

  it('should ignore empty banned word entries', () => {
    const verdict = ModerationService.classify('Hari ini cerah sekali', ['', '   ']);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reasons).toEqual([]);
  });

  it('should not flag when bannedWord list is not provided', () => {
    const verdict = ModerationService.classify('Obat herbal promo besar-besaran');
    expect(verdict.flagged).toBe(false);
  });
});
