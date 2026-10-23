import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    base: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'base_001',
          name: 'Code & Memes Base',
          handle: '@codememfess',
          membersCount: 18420,
          category: 'Hobi',
          verified: true,
          color: '#0055FF',
          keyword: '[code]',
          createdAt: new Date(),
        },
      ]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'base_001',
        name: 'Code & Memes Base',
        handle: '@codememfess',
        membersCount: 18420,
        category: 'Hobi',
        verified: true,
        rules: ['Rule 1'],
        createdAt: new Date(),
      }),
    },
    fess: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'fess_101',
          baseHandle: '@codememfess',
          content: 'Confession test via Supertest',
          upvotes: 5,
          downvotes: 0,
          status: 'published',
          createdAt: new Date(),
          comments: [],
        },
      ]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'fess_101',
        baseHandle: '@codememfess',
        content: 'Confession test via Supertest',
        upvotes: 5,
        downvotes: 0,
        status: 'published',
        createdAt: new Date(),
        comments: [],
      }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    vote: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    follow: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('API Integration Tests (Express & OpenAPI Contract Endpoints)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Check', () => {
    it('GET /api/health should return status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('allows configured CORS origins', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('rejects unknown CORS origins', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.example');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CORS_FORBIDDEN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects unknown CORS preflight origins', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Topics Endpoint', () => {
    it('GET /api/topics should return list of 56 topics', async () => {
      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(68);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('label');
      expect(res.body.data[0]).toHaveProperty('category');
    });
  });

  describe('Songs Endpoint', () => {
    it('GET /api/songs should return songs and support search query', async () => {
      const res = await request(app).get('/api/songs?query=isyan');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].artist).toContain('Isyana');
    });
  });

  describe('Bases Endpoints', () => {
    it('GET /api/bases should return paginated list format', async () => {
      const res = await request(app).get('/api/bases');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('total_pages');
      expect(res.body.data[0].handle).toBe('@codememfess');
    });

    it('GET /api/bases/:handle should return base detail', async () => {
      const res = await request(app).get('/api/bases/@codememfess');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Code & Memes Base');
    });
  });

  describe('Fesses Endpoints', () => {
    it('GET /api/fesses should return paginated confessions matching contract', async () => {
      const res = await request(app).get('/api/fesses');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body.data[0].id).toBe('fess_101');
    });

    it('GET /api/fesses/:id should return single confession', async () => {
      const res = await request(app).get('/api/fesses/fess_101');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('fess_101');
      expect(res.body.content).toContain('Supertest');
    });

    it('GET /api/fesses/:id/instagram-status mengembalikan status tanpa detail error untuk publik', async () => {
      vi.mocked(prisma.fess.findUnique).mockResolvedValueOnce({
        id: 'fess_ig',
        baseHandle: '@codememfess',
        postedToIg: true,
        igStatus: 'failed',
        igError: 'detail internal Meta',
        igAttempts: 2,
        igUpdatedAt: new Date(),
        base: { creatorId: 'usr_owner' },
      } as any);

      const res = await request(app).get('/api/fesses/fess_ig/instagram-status');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'fess_ig',
        posted_to_ig: true,
        ig_status: 'failed',
        ig_attempts: 2,
      });
      expect(res.body.ig_error).toBeUndefined();
    });

    it('POST /api/fesses/:id/instagram-post tanpa login ditolak (bukan endpoint publik)', async () => {
      const res = await request(app).post('/api/fesses/fess_101/instagram-post').send({
        template: 'default',
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Auth Validation & Error Handling', () => {
    it('POST /api/auth/login with invalid data should return 422 VALIDATION_ERROR matching contract', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: '', password: '123' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toBeDefined();
    });

    it('404 Not Found should return formatted error response', async () => {
      const res = await request(app).get('/api/non-existent-route-xyz');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
