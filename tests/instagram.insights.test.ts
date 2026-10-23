import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InstagramService } from '../src/services/instagram.service.js';

vi.mock('../src/config/prisma.js', () => ({
  prisma: {
    platformConnection: { findUnique: vi.fn(), findFirst: vi.fn() },
    base: { findUnique: vi.fn(), findMany: vi.fn() },
    systemLog: { create: vi.fn() },
  },
}));

/** Titik data harian Meta: [{ value, end_time }]. */
function series(values: number[], startDay = 1) {
  return values.map((value, index) => ({
    value,
    end_time: `2026-10-${String(startDay + index).padStart(2, '0')}T07:00:00+0000`,
  }));
}

function insight(name: string, values: any[]) {
  return {
    name,
    period: 'day',
    title: name,
    values,
  };
}

describe('InstagramService insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('menormalisasi metrik akun, audiens, dan menghitung delta 7 hari', async () => {
    const calls: Array<{
      metric: string;
      period?: string;
      breakdown?: string;
      metricType?: string;
      timeframe?: string;
    }> = [];

    vi.spyOn(axios, 'get').mockImplementation((async (url: string, config: any) => {
      const metric = String(config?.params?.metric || '');
      calls.push({
        metric,
        period: config?.params?.period,
        breakdown: config?.params?.breakdown,
        metricType: config?.params?.metric_type,
        timeframe: config?.params?.timeframe,
      });

      if (url.endsWith('/me')) {
        return { data: { followers_count: 1090, media_count: 4 } };
      }

      if (url.endsWith('/insights') && metric.includes('follower_count')) {
        return {
          data: {
            data: [
              // Meta mengirim perubahan bersih harian, bukan total pengikut.
              insight('follower_count', series([0, 1, 0, 2, 0, 3, 0, 4, 0, 5])),
              insight('reach', series([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])),
              insight('profile_views', series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])),
              insight('website_clicks', series([0, 0, 0, 0, 0, 0, 0, 0, 0, 2])),
            ],
          },
        };
      }

      if (url.endsWith('/insights') && metric === 'views') {
        if (config?.params?.metric_type === 'total_value') {
          return { data: { data: [{ name: 'views', period: 'day', total_value: { value: 2450 } }] } };
        }
        return { data: { data: [insight('views', series([200, 210, 220, 230, 240, 250, 260, 270, 280, 290]))] } };
      }

      if (
        url.endsWith('/insights') &&
        metric === 'profile_views' &&
        config?.params?.metric_type === 'total_value'
      ) {
        return { data: { data: [{ name: 'profile_views', period: 'day', total_value: { value: 678 } }] } };
      }

      if (
        url.endsWith('/insights') &&
        metric === 'website_clicks' &&
        config?.params?.metric_type === 'total_value'
      ) {
        return { data: { data: [{ name: 'website_clicks', period: 'day', total_value: { value: 90 } }] } };
      }

      if (url.endsWith('/insights') && metric === 'follows_and_unfollows') {
        const span = Number(config?.params?.until) - Number(config?.params?.since);
        const isMonth = span > 10 * 86400;
        return {
          data: {
            data: [
              {
                name: 'follows_and_unfollows',
                total_value: {
                  breakdowns: [
                    {
                      dimension_keys: ['follow_type'],
                      results: [
                        { dimension_values: ['FOLLOWER'], value: isMonth ? 100 : 30 },
                        { dimension_values: ['NON_FOLLOWER'], value: 10 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      if (url.endsWith('/insights') && metric === 'follower_demographics') {
        const breakdown = String(config?.params?.breakdown || '');

        if (breakdown === 'age,gender') {
          return {
            data: {
              data: [
                {
                  name: 'follower_demographics',
                  period: 'lifetime',
                  total_value: {
                    breakdowns: [
                      {
                        dimension_keys: ['age', 'gender'],
                        results: [
                          { dimension_values: ['25-34', 'F'], value: 120 },
                          { dimension_values: ['25-34', 'M'], value: 80 },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          };
        }

        if (breakdown === 'city') {
          return {
            data: {
              data: [
                {
                  name: 'follower_demographics',
                  period: 'lifetime',
                  total_value: {
                    breakdowns: [
                      {
                        dimension_keys: ['city'],
                        results: [{ dimension_values: ['Jakarta'], value: 70 }],
                      },
                    ],
                  },
                },
              ],
            },
          };
        }

        if (breakdown === 'country') {
          return {
            data: {
              data: [
                {
                  name: 'follower_demographics',
                  period: 'lifetime',
                  values: [{ value: { ID: 150, SG: 20 } }],
                },
              ],
            },
          };
        }
      }

      if (url.endsWith('/insights') && metric === 'online_followers') {
        return {
          data: {
            data: [
              {
                name: 'online_followers',
                period: 'lifetime',
                values: [{ value: { '9': 40, '10': 55, '18': 30 } }],
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected axios call: ${url} ${metric}`);
    }) as any);

    const result = await InstagramService.getAccountInsights('insights_token_account');

    expect(result.metrics).toHaveLength(6);
    expect(result.range.days).toBe(30);
    expect(result.profile.followers).toBe(1090);
    expect(result.profile.mediaCount).toBe(4);

    const followers = result.metrics.find((m) => m.metric === 'follower_count');
    expect(followers?.aggregate).toBe('latest');
    expect(followers?.latest).toBe(1090);
    expect(followers?.total).toBe(1090);
    expect(followers?.first).toBe(1000);
    expect(followers?.last7).toBe(1070);
    expect(followers?.change).toBe(20);
    expect(followers?.changePct).toBeCloseTo((20 / 1070) * 100, 5);
    expect(followers?.changeAvailable).toBe(true);
    expect(followers?.points).toHaveLength(0);

    const newFollowers = result.metrics.find((m) => m.metric === 'new_followers');
    expect(newFollowers?.available).toBe(true);
    expect(newFollowers?.total).toBe(15);
    expect(newFollowers?.last7).toBe(14);
    expect(newFollowers?.points).toHaveLength(10);

    const reach = result.metrics.find((m) => m.metric === 'reach');
    expect(reach?.total).toBe(550);
    expect(reach?.last7).toBe(490);
    expect(reach?.prev7).toBe(60);

    const views = result.metrics.find((m) => m.metric === 'views');
    expect(views?.available).toBe(true);
    expect(views?.total).toBe(2450);
    expect(views?.points).toHaveLength(10);

    const profileViews = result.metrics.find((m) => m.metric === 'profile_views');
    expect(profileViews?.available).toBe(true);
    expect(profileViews?.total).toBe(678);
    expect(profileViews?.points).toHaveLength(0);

    const websiteClicks = result.metrics.find((m) => m.metric === 'website_clicks');
    expect(websiteClicks?.available).toBe(true);
    expect(websiteClicks?.total).toBe(90);
    expect(websiteClicks?.points).toHaveLength(0);

    const genderAge = result.audience.find((a) => a.metric === 'audience_gender_age');
    expect(genderAge?.available).toBe(true);
    expect(genderAge?.items[0]).toEqual({ label: 'F.25-34', value: 120 });

    const city = result.audience.find((a) => a.metric === 'audience_city');
    expect(city?.items[0]).toEqual({ label: 'Jakarta', value: 70 });

    const country = result.audience.find((a) => a.metric === 'audience_country');
    expect(country?.items[0]).toEqual({ label: 'ID', value: 150 });

    const online = result.audience.find((a) => a.metric === 'online_followers');
    expect(online?.items.map((item) => item.label)).toEqual(['9', '10', '18']);

    expect(calls.some((call) => call.period === 'lifetime')).toBe(true);
    expect(
      calls.filter((call) => call.metric === 'follower_demographics')
    ).toHaveLength(3);
    const genderAgeCall = calls.find(
      (call) => call.metric === 'follower_demographics' && call.breakdown === 'age,gender'
    );
    expect(genderAgeCall?.metricType).toBe('total_value');
    expect(genderAgeCall?.timeframe).toBe('this_month');

    expect(
      calls.some((call) => call.metric === 'views' && call.metricType === 'total_value')
    ).toBe(true);
    expect(
      calls.some((call) => call.metric === 'profile_views' && call.metricType === 'total_value')
    ).toBe(true);
    expect(
      calls.some((call) => call.metric === 'website_clicks' && call.metricType === 'total_value')
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.metric === 'follows_and_unfollows' &&
          call.metricType === 'total_value' &&
          call.breakdown === 'follow_type'
      )
    ).toBe(true);
  });

  it('menampilkan metrik total_value saat time series kosong', async () => {
    vi.spyOn(axios, 'get').mockImplementation((async (url: string, config: any) => {
      const metric = String(config?.params?.metric || '');

      if (url.endsWith('/me')) {
        return { data: { followers_count: 1257, media_count: 355 } };
      }
      if (metric === 'follower_count,reach,profile_views,website_clicks') {
        return { data: { data: [insight('reach', series([100, 200]))] } };
      }
      if (metric === 'views' && config?.params?.metric_type === 'total_value') {
        return { data: { data: [{ name: 'views', total_value: { value: 712591 } }] } };
      }
      if (metric === 'views') {
        return { data: { data: [] } };
      }
      if (metric === 'profile_views' && config?.params?.metric_type === 'total_value') {
        return { data: { data: [{ name: 'profile_views', total_value: { value: 18517 } }] } };
      }
      if (metric === 'website_clicks' && config?.params?.metric_type === 'total_value') {
        return { data: { data: [{ name: 'website_clicks', total_value: { value: 1061 } }] } };
      }

      throw new Error('tidak tersedia');
    }) as any);

    const result = await InstagramService.getAccountInsights('insights_token_total');

    expect(result.profile.followers).toBe(1257);
    expect(result.profile.mediaCount).toBe(355);

    const followers = result.metrics.find((m) => m.metric === 'follower_count');
    expect(followers?.available).toBe(true);
    expect(followers?.latest).toBe(1257);
    expect(followers?.points).toHaveLength(0);

    const views = result.metrics.find((m) => m.metric === 'views');
    expect(views?.available).toBe(true);
    expect(views?.total).toBe(712591);
    expect(views?.points).toHaveLength(0);

    const profileViews = result.metrics.find((m) => m.metric === 'profile_views');
    expect(profileViews?.available).toBe(true);
    expect(profileViews?.total).toBe(18517);

    const websiteClicks = result.metrics.find((m) => m.metric === 'website_clicks');
    expect(websiteClicks?.available).toBe(true);
    expect(websiteClicks?.total).toBe(1061);
  });

  it('fallback per metrik saat request gabungan ditolak Meta', async () => {
    let groupAttempts = 0;

    vi.spyOn(axios, 'get').mockImplementation((async (_url: string, config: any) => {
      const metric = String(config?.params?.metric || '');

      if (_url.endsWith('/me')) {
        return { data: { followers_count: 100, media_count: 2 } };
      }

      if (metric.includes(',')) {
        groupAttempts += 1;
        throw new Error('(#100) salah satu metrik tidak valid');
      }

      if (metric === 'follower_count' || metric === 'reach') {
        return { data: { data: [insight(metric, series([1, 2, 3]))] } };
      }
      if (metric === 'profile_views' || metric === 'website_clicks') {
        throw new Error('(#100) metrik tidak didukung');
      }
      if (metric === 'views') {
        return { data: { data: [insight('views', series([5, 6, 7]))] } };
      }

      throw new Error('tidak tersedia');
    }) as any);

    const result = await InstagramService.getAccountInsights('insights_token_fallback');

    expect(groupAttempts).toBeGreaterThan(0);
    expect(result.metrics.find((m) => m.metric === 'follower_count')?.available).toBe(true);
    expect(result.metrics.find((m) => m.metric === 'reach')?.available).toBe(true);
    expect(result.metrics.find((m) => m.metric === 'profile_views')?.available).toBe(false);
    expect(result.metrics.find((m) => m.metric === 'views')?.available).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('mengambil media terbaru beserta insights dan total interaksi', async () => {
    vi.spyOn(axios, 'get').mockImplementation((async (url: string, config: any) => {
      const metric = String(config?.params?.metric || '');

      if (url.endsWith('/me/media')) {
        return {
          data: {
            data: [
              {
                id: 'media_1',
                caption: 'Fess pertama',
                media_type: 'CAROUSEL_ALBUM',
                media_product_type: 'FEED',
                permalink: 'https://instagram.com/p/abc',
                timestamp: '2026-10-20T10:00:00+0000',
                like_count: 12,
                comments_count: 3,
              },
            ],
          },
        };
      }

      if (metric.includes('reach')) {
        return {
          data: {
            data: [
              { name: 'reach', values: [{ value: 1000 }] },
              { name: 'views', values: [{ value: 1500 }] },
              { name: 'likes', values: [{ value: 12 }] },
              { name: 'comments', values: [{ value: 3 }] },
              { name: 'shares', values: [{ value: 2 }] },
              { name: 'saved', values: [{ value: 5 }] },
            ],
          },
        };
      }

      throw new Error('Unexpected media insights call');
    }) as any);

    const result = await InstagramService.getRecentMediaInsights('insights_token_media', 6);

    expect(result.media).toHaveLength(1);
    expect(result.media[0].insights.reach).toBe(1000);
    expect(result.media[0].insights.views).toBe(1500);
    expect(result.media[0].insights.total_interactions).toBe(22);
    expect(result.media[0].caption).toBe('Fess pertama');
  });
});
