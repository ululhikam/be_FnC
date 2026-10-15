import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth.service.js';
import { prisma } from '../src/config/prisma.js';
import * as passwordUtil from '../src/utils/password.util.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('AuthService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should throw error when user is not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

      await expect(AuthService.login('notfound@mail.com', 'password123', 'User')).rejects.toThrow(
        'Email atau username tidak ditemukan'
      );
    });

    it('should throw error if user is banned', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_banned',
        email: 'banned@mail.com',
        isBanned: true,
        banReason: 'Spamming',
      } as any);

      await expect(AuthService.login('banned@mail.com', 'password123', 'User')).rejects.toThrow(
        'Akun telah dibekukan'
      );
    });

    it('should throw error on incorrect password', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        email: 'user@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(false);

      await expect(AuthService.login('user@mail.com', 'wrongpassword', 'User')).rejects.toThrow(
        'Password yang dimasukkan salah'
      );
    });

    it('should return user and token on successful login', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        username: 'Alex Pratama',
        handle: '@alex_reader',
        email: 'alex@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
        level: 14,
        badges: ['MEMBER'],
        managedBases: [],
        createdAt: new Date(),
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(true);

      const result = await AuthService.login('alex@mail.com', 'password123', 'User');
      expect(result.user).toBeDefined();
      expect(result.user.handle).toBe('@alex_reader');
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    });

    it('should prevent regular user from accessing Base Admin role', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_1',
        email: 'user@mail.com',
        password: 'hashed_password',
        isBanned: false,
        role: 'User',
      } as any);

      vi.spyOn(passwordUtil, 'comparePassword').mockResolvedValueOnce(true);

      await expect(AuthService.login('user@mail.com', 'password123', 'Base Admin')).rejects.toThrow(
        'User tidak memiliki akses sebagai Base Admin'
      );
    });
  });

  describe('registerUser', () => {
    it('should throw error if email or handle already exists', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'existing_usr' } as any);

      await expect(
        AuthService.registerUser({
          email: 'dup@mail.com',
          password: 'password123',
          username: 'Duplicate',
          handle: '@duplicate',
        })
      ).rejects.toThrow();
    });

    it('should successfully register new user', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: 'usr_new',
        username: 'New User',
        handle: '@newuser',
        email: 'new@mail.com',
        role: 'User',
        badges: ['NEW MEMBER'],
        managedBases: [],
        createdAt: new Date(),
      } as any);

      const result = await AuthService.registerUser({
        email: 'new@mail.com',
        password: 'password123',
        username: 'New User',
        handle: '@newuser',
      });

      expect(result.user.id).toBe('usr_new');
      expect(result.token).toBeDefined();
    });
  });

  describe('getMe', () => {
    it('should return serialized user data', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'usr_me',
        username: 'Me',
        handle: '@me',
        email: 'me@mail.com',
        role: 'User',
        badges: ['ANON SENDER'],
        managedBases: [],
        createdAt: new Date(),
      } as any);

      const user = await AuthService.getMe('usr_me');
      expect(user.id).toBe('usr_me');
      expect(user.handle).toBe('@me');
    });

    it('should throw 404 if user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(AuthService.getMe('nonexistent')).rejects.toThrow('Pengguna tidak ditemukan');
    });
  });
});
