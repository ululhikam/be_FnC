import { describe, it, expect } from 'vitest';
import { generateToken, verifyToken } from '../src/utils/jwt.util.js';
import { hashPassword, comparePassword } from '../src/utils/password.util.js';
import { normalizeHandle, formatMembers, getInitials } from '../src/utils/format.util.js';

describe('JWT Utilities', () => {
  it('should generate and verify JWT token correctly', () => {
    const payload = { sub: 'usr_test_123', role: 'User', handle: '@tester' };
    const token = generateToken(payload);
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('usr_test_123');
    expect(decoded.role).toBe('User');
    expect(decoded.handle).toBe('@tester');
  });

  it('should throw error on invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });
});

describe('Password Utilities', () => {
  it('should hash and compare passwords accurately', async () => {
    const raw = 'SecretPassword123!';
    const hash = await hashPassword(raw);
    expect(hash).not.toBe(raw);

    const isMatch = await comparePassword(raw, hash);
    expect(isMatch).toBe(true);

    const isWrong = await comparePassword('WrongPassword', hash);
    expect(isWrong).toBe(false);
  });
});

describe('Format Utilities', () => {
  it('should normalize handles with @ prefix', () => {
    expect(normalizeHandle('codememfess')).toBe('@codememfess');
    expect(normalizeHandle('@codememfess')).toBe('@codememfess');
    expect(normalizeHandle('  @spaces  ')).toBe('@spaces');
  });

  it('should format member counts in readable format', () => {
    expect(formatMembers(500)).toBe('500');
    expect(formatMembers(1500)).toBe('1.5k');
    expect(formatMembers(18420)).toBe('18.4k');
    expect(formatMembers(2000000)).toBe('2M');
  });

  it('should extract correct initials from names', () => {
    expect(getInitials('Code Memes')).toBe('CM');
    expect(getInitials('Unair')).toBe('UN');
    expect(getInitials('Fess Hub Official')).toBe('FH');
    expect(getInitials('')).toBe('AN');
  });
});
