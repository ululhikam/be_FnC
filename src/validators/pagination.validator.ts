import { z } from 'zod';

/**
 * Batas atas nomor halaman.
 *
 * `page` tanpa batas atas berarti klien bisa mengirim `page=100000000` sehingga
 * `skip` menjadi raksasa. Postgres tetap harus memindai dan membuang baris
 * sebanyak itu sebelum mengambil satu halaman, jadi satu request murah bisa
 * membebani database. Angka ini jauh di atas kebutuhan UI (10.000 x 100 baris).
 */
export const MAX_PAGE = 10_000;

/** Nomor halaman query string: minimal 1, maksimal `MAX_PAGE`, default 1. */
export const PageQuerySchema = z.coerce.number().int().min(1).max(MAX_PAGE).default(1);
