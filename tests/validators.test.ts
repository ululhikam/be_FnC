import { describe, it, expect } from 'vitest';
import {
  LoginSchema,
  RegisterUserSchema,
  RegisterBaseSchema,
  GoogleAuthSchema,
} from '../src/validators/auth.validator.js';
import { CreateFessSchema, VoteSchema, ReportSchema } from '../src/validators/fess.validator.js';
import { AddCommentSchema } from '../src/validators/comment.validator.js';
import { UpdateBaseSettingsSchema } from '../src/validators/base.validator.js';

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

describe('Fess Validators', () => {
  it('should validate valid CreateFess payload', () => {
    const valid = {
      base_handle: '@codememfess',
      content: 'Ini adalah curhat programming anonim pertama saya!',
      template: 'midnight',
    };
    const res = CreateFessSchema.safeParse(valid);
    expect(res.success).toBe(true);
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
});
