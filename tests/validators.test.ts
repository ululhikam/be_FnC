import { describe, it, expect } from 'vitest';
import {
  LoginSchema,
  RegisterUserSchema,
  RegisterBaseSchema,
  GoogleAuthSchema,
  ForgotPasswordSchema,
  VerifyResetOtpSchema,
  ResetPasswordSchema,
} from '../src/validators/auth.validator.js';
import {
  CreateFessSchema,
  GetFessesQuerySchema,
  VoteSchema,
  ReportSchema,
} from '../src/validators/fess.validator.js';
import { AddCommentSchema } from '../src/validators/comment.validator.js';
import { UpdateBaseSettingsSchema } from '../src/validators/base.validator.js';
import { TEMPLATES } from '../src/constants/templates.js';

describe('Auth Validators', () => {
  it('should validate valid Login payload', () => {
    const valid = { identifier: 'alex@gmail.com', password: 'password123', role: 'User' };
    const res = LoginSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('should reject login with short password', () => {
    const invalid = { identifier: 'alex@gmail.com', password: '123' };
    const res = LoginSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('should validate RegisterUser payload', () => {
    const valid = {
      email: 'user@gmail.com',
      password: 'password123',
      username: 'Alex Pratama',
      handle: '@alex_reader',
    };
    const res = RegisterUserSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('should accept handles containing dots', () => {
    const valid = {
      email: 'user@gmail.com',
      password: 'password123',
      username: 'Alex Pratama',
      handle: '@alex.reader',
    };
    const res = RegisterUserSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('should reject invalid handle pattern in RegisterUser', () => {
    const invalid = {
      email: 'user@gmail.com',
      password: 'password123',
      username: 'Alex',
      handle: 'a!bad@handle',
    };
    const res = RegisterUserSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('should accept local SVG data-URI avatars', () => {
    const valid = {
      email: 'user@gmail.com',
      password: 'password123',
      username: 'Alex Pratama',
      handle: '@alex_reader',
      avatar:
        'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E',
    };
    const res = RegisterUserSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('should reject non-image data-URI avatars', () => {
    const invalid = {
      email: 'user@gmail.com',
      password: 'password123',
      username: 'Alex',
      handle: '@alex_reader',
      avatar: 'data:text/html;base64,PHNjcmlwdD4=',
    };
    const res = RegisterUserSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('should validate RegisterBase payload', () => {
    const valid = {
      email: 'admin@codememfess.id',
      password: 'password123',
      name: 'Code & Memes Base',
      handle: '@codememfess',
      category: 'Hobi',
      color: '#0055FF',
    };
    const res = RegisterBaseSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('should validate GoogleAuth payload', () => {
    const valid = { id_token: 'valid.google.id.token' };
    const res = GoogleAuthSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });
});

describe('Password Reset Validators (OTP email)', () => {
  it('should validate forgot-password email', () => {
    expect(ForgotPasswordSchema.safeParse({ email: 'user@gmail.com' }).success).toBe(true);
    expect(ForgotPasswordSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('should only accept 6-digit OTP codes', () => {
    expect(
      VerifyResetOtpSchema.safeParse({ email: 'user@gmail.com', otp: '123456' }).success
    ).toBe(true);
    expect(
      VerifyResetOtpSchema.safeParse({ email: 'user@gmail.com', otp: '12345' }).success
    ).toBe(false);
    expect(
      VerifyResetOtpSchema.safeParse({ email: 'user@gmail.com', otp: 'abcdef' }).success
    ).toBe(false);
  });

  it('should validate reset-password payload', () => {
    const valid = {
      email: 'user@gmail.com',
      reset_token: 'a'.repeat(64),
      password: 'newpassword123',
    };
    expect(ResetPasswordSchema.safeParse(valid).success).toBe(true);
    expect(ResetPasswordSchema.safeParse({ ...valid, reset_token: 'short' }).success).toBe(false);
    expect(ResetPasswordSchema.safeParse({ ...valid, password: '123' }).success).toBe(false);
  });
});

describe('Fess Validators', () => {
  it('should validate valid CreateFess payload', () => {
    const valid = {
      base_handle: '@codememfess',
      content: 'Ini adalah curhat programming anonim pertama saya!',
      template: 'midnight',
    };
    const res = CreateFessSchema.safeParse(valid);
    expect(res.success).toBe(true);
    expect(CreateFessSchema.safeParse({ ...valid, template: 'cyberpunk' }).success).toBe(true);
    expect(CreateFessSchema.safeParse({ ...valid, template: 'neobrutalism' }).success).toBe(true);
    expect(CreateFessSchema.safeParse({ ...valid, template: 'rock' }).success).toBe(true);
    expect(CreateFessSchema.safeParse({ ...valid, template: 'terminal' }).success).toBe(true);

    // Semua template (termasuk 20 template baru) harus lolos validator.
    for (const t of TEMPLATES) {
      expect(
        CreateFessSchema.safeParse({ ...valid, template: t.key }).success,
        `template ${t.key} seharusnya valid`
      ).toBe(true);
    }
    expect(CreateFessSchema.safeParse({ ...valid, template: 'tidak-ada' }).success).toBe(false);
  });

  it('should reject empty fess content', () => {
    const invalid = { base_handle: '@codememfess', content: '' };
    const res = CreateFessSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });

  it('should validate Vote payload', () => {
    expect(VoteSchema.safeParse({ type: 'up' }).success).toBe(true);
    expect(VoteSchema.safeParse({ type: 'down' }).success).toBe(true);
    expect(VoteSchema.safeParse({ type: 'sideways' }).success).toBe(false);
  });

  it('should validate Report payload', () => {
    const valid = { fess_id: 'fess_101', reason: 'spam', note: 'Iklan judi online' };
    expect(ReportSchema.safeParse(valid).success).toBe(true);
  });

  it("should accept status 'approved' (alias 'published') on the global fess list", () => {
    // Panel analitik base admin mengirim status=approved — dulu 422 karena
    // enum tidak punya alias ini (menyebabkan seluruh panel gagal via Promise.all).
    expect(
      GetFessesQuerySchema.safeParse({ base: '@concern_fess', status: 'approved', sort: 'popular', limit: 5 })
        .success
    ).toBe(true);
    expect(GetFessesQuerySchema.safeParse({ status: 'published' }).success).toBe(true);
    expect(GetFessesQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });
});

describe('Comment & Base Settings Validators', () => {
  it('should validate comment text', () => {
    expect(AddCommentSchema.safeParse({ text: 'Komentar bagus' }).success).toBe(true);
    expect(AddCommentSchema.safeParse({ text: '' }).success).toBe(false);
  });

  it('should validate base settings update', () => {
    const valid = {
      name: 'New Base Name',
      bio: 'New description',
      color: '#FF0055',
    };
    expect(UpdateBaseSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it('should validate banned words (2-40 chars, max 50 entries)', () => {
    expect(UpdateBaseSettingsSchema.safeParse({ bannedWords: ['judi', 'promo pinjol'] }).success).toBe(
      true
    );
    expect(UpdateBaseSettingsSchema.safeParse({ bannedWords: ['a'] }).success).toBe(false);
    expect(
      UpdateBaseSettingsSchema.safeParse({ bannedWords: ['x'.repeat(41)] }).success
    ).toBe(false);
    expect(
      UpdateBaseSettingsSchema.safeParse({
        bannedWords: Array.from({ length: 50 }, (_, i) => `kata${i}`),
      }).success
    ).toBe(true);
    expect(
      UpdateBaseSettingsSchema.safeParse({
        bannedWords: Array.from({ length: 51 }, (_, i) => `kata${i}`),
      }).success
    ).toBe(false);
  });
});
