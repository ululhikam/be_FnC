import { describe, expect, it } from 'vitest';
import { AddCommentSchema, EditCommentSchema } from '../src/validators/comment.validator.js';

describe('CommentTextSchema', () => {
  it('memangkas spasi di awal/akhir komentar', () => {
    expect(AddCommentSchema.parse({ text: '  halo dunia  ' }).text).toBe('halo dunia');
  });

  it('menolak komentar yang hanya berisi spasi', () => {
    for (const text of ['   ', '\n\t', '']) {
      const result = AddCommentSchema.safeParse({ text });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Komentar tidak boleh kosong');
      }
    }
  });

  it('mengukur batas 500 karakter setelah trim', () => {
    expect(AddCommentSchema.safeParse({ text: `  ${'a'.repeat(500)}  ` }).success).toBe(true);
    expect(AddCommentSchema.safeParse({ text: 'a'.repeat(501) }).success).toBe(false);
  });

  it('edit memakai aturan yang sama', () => {
    expect(EditCommentSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(EditCommentSchema.parse({ text: '  baru  ' }).text).toBe('baru');
  });

  it('menerima parent_id opsional dan memangkas spasinya', () => {
    expect(AddCommentSchema.parse({ text: 'halo' }).parent_id).toBeUndefined();
    expect(AddCommentSchema.parse({ text: 'halo', parent_id: null }).parent_id).toBeNull();
    expect(AddCommentSchema.parse({ text: 'halo', parent_id: ' c_parent ' }).parent_id).toBe(
      'c_parent'
    );
    expect(AddCommentSchema.safeParse({ text: 'halo', parent_id: '   ' }).success).toBe(false);
  });
});
