import { z } from 'zod';

/**
 * Validasi body konsol template Super Admin.
 *
 * `base_handle` kosong/null berarti template menjadi katalog bersama. Bila
 * diisi, service memastikan base benar-benar ada sebelum menyimpan.
 */
const baseHandle = z
  .string()
  .trim()
  .max(80, 'Handle base terlalu panjang')
  .nullish()
  .transform((value) => (value ? value : null));

const statusDraftActive = z.enum(['draft', 'active'], {
  errorMap: () => ({ message: 'Status harus draft atau active' }),
});

const statusAny = z.enum(['draft', 'active', 'archived'], {
  errorMap: () => ({ message: 'Status harus draft, active, atau archived' }),
});

export const CreateTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, 'Key minimal 2 karakter')
    .max(64, 'Key maksimal 64 karakter'),
  svg: z.string().min(1, 'Isi SVG wajib dikirim'),
  label: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullish(),
  category: z.string().trim().max(40).optional(),
  status: statusDraftActive.default('draft'),
  sort_order: z.number().int().min(0).max(99999).optional(),
  base_handle: baseHandle,
});

export const UpdateTemplateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(240).nullish(),
    category: z.string().trim().min(1).max(40).optional(),
    status: statusAny.optional(),
    sort_order: z.number().int().min(0).max(99999).optional(),
    base_handle: baseHandle.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Kirim minimal satu field yang ingin diubah',
  });

export const ReplaceTemplateSvgSchema = z.object({
  svg: z.string().min(1, 'Isi SVG wajib dikirim'),
});
