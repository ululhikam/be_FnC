import { describe, it, expect } from 'vitest';
import { GetFessesQuerySchema } from '../src/validators/fess.validator.js';
import { GetCommentsQuerySchema } from '../src/validators/comment.validator.js';
import { MAX_PAGE, PageQuerySchema } from '../src/validators/pagination.validator.js';

describe('Batas pagination (SEC-26)', () => {
  it('menerima nomor halaman wajar', () => {
    expect(PageQuerySchema.parse('3')).toBe(3);
    expect(PageQuerySchema.parse(undefined)).toBe(1);
  });

  it('menolak nomor halaman di atas batas', () => {
    expect(PageQuerySchema.safeParse(MAX_PAGE + 1).success).toBe(false);
    expect(PageQuerySchema.safeParse('999999999').success).toBe(false);
  });

  it('menolak halaman nol atau negatif', () => {
    expect(PageQuerySchema.safeParse(0).success).toBe(false);
    expect(PageQuerySchema.safeParse(-5).success).toBe(false);
  });

  it('membatasi panjang kata kunci pencarian', () => {
    expect(GetFessesQuerySchema.safeParse({ query: 'a'.repeat(100) }).success).toBe(true);
    expect(GetFessesQuerySchema.safeParse({ query: 'a'.repeat(101) }).success).toBe(false);
  });

  it('dipakai juga oleh daftar komentar', () => {
    expect(GetCommentsQuerySchema.safeParse({ page: '999999999' }).success).toBe(false);
    expect(GetCommentsQuerySchema.parse({}).page).toBe(1);
  });
});
