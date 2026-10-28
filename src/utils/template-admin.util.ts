import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEMPLATES } from '../constants/templates.js';
import type { TemplateSlots } from '../services/template.service.js';

/** Batas aman SVG yang diunggah lewat konsol Super Admin. */
export const MAX_TEMPLATE_SVG_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_SVG_TAGS = 20_000;
const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const LEGACY_TEMPLATE_KEYS = new Set(TEMPLATES.map((template) => template.key));

export class TemplateAdminError extends Error {
  status: number;
  code: string;
  errors?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    status = 400,
    errors?: Record<string, string>
  ) {
    super(message);
    this.name = 'TemplateAdminError';
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

export interface TemplateSvgAnalysis {
  normalized: string;
  bytes: number;
  checksum: string;
  width: number;
  height: number;
  slots: TemplateSlots;
  palette: { bg: string; ink: string; accent: string } | null;
  warnings: string[];
}

interface MeasuredTemplate {
  key: string;
  file: string;
  error?: string;
  canvas: { width: number; height: number };
  anchor: TemplateSlots['anchor'];
  message: TemplateSlots['message'];
  quote: TemplateSlots['quote'];
  user: TemplateSlots['user'];
  time: TemplateSlots['time'];
  meta: TemplateSlots['meta'];
  footer: TemplateSlots['footer'];
  obstacles: unknown[];
  flags: string[];
}

interface TemplateScripts {
  normalizeSvg: (svg: string) => string;
  measureTemplate: (file: string) => MeasuredTemplate;
  derivePalette: (svg: string) => { bg: string; ink: string; accent: string };
}

let scriptsPromise: Promise<TemplateScripts> | null = null;

/**
 * Script pengukur masih berupa `.mjs` karena dipakai juga oleh CLI/import lokal.
 * Di Vercel file ini di-include lewat `vercel.json`; di dev/test dibaca dari
 * folder `backend/scripts`.
 */
function resolveScriptPath(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', fileName),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts', fileName),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new TemplateAdminError(
      'TEMPLATE_MEASURE_UNAVAILABLE',
      `Script pengukur template tidak ditemukan (${fileName}).`,
      500
    );
  }
  return found;
}

async function loadTemplateScripts(): Promise<TemplateScripts> {
  if (!scriptsPromise) {
    scriptsPromise = (async () => {
      const [measurePath, metaPath] = [
        resolveScriptPath('measure-templates.mjs'),
        resolveScriptPath('template-meta.mjs'),
      ];
      const [measure, meta] = await Promise.all([
        import(pathToFileURL(measurePath).href),
        import(pathToFileURL(metaPath).href),
      ]);
      return {
        normalizeSvg: measure.normalizeSvg as TemplateScripts['normalizeSvg'],
        measureTemplate: measure.measureTemplate as TemplateScripts['measureTemplate'],
        derivePalette: meta.derivePalette as TemplateScripts['derivePalette'],
      };
    })().catch((error) => {
      scriptsPromise = null;
      throw error;
    });
  }
  return scriptsPromise;
}

/** Key stabil yang dipakai sebagai nama file/URL thumbnail. */
export function assertTemplateKey(key: string): string {
  const normalized = String(key || '').trim();
  if (!TEMPLATE_KEY_RE.test(normalized) || normalized.endsWith('-')) {
    throw new TemplateAdminError(
      'TEMPLATE_KEY_INVALID',
      'Key template harus 2-64 karakter, huruf kecil/angka/tanda hubung, dan tidak diakhiri tanda hubung.',
      422,
      { key: 'Contoh: 13-papan-kampus' }
    );
  }
  if (LEGACY_TEMPLATE_KEYS.has(normalized)) {
    throw new TemplateAdminError(
      'TEMPLATE_KEY_RESERVED',
      `Key "${normalized}" sudah dipakai template lama. Pilih key baru, mis. "13-${normalized}".`,
      409,
      { key: 'Key ini reserved untuk template lama.' }
    );
  }
  return normalized;
}

/** Label default dari key, mis. `13-papan-kampus` -> `Papan Kampus`. */
export function templateLabelFromKey(key: string): string {
  return key
    .replace(/^\d+-/, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function numberAttr(attrs: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(
    attrs
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Dokumen harus benar-benar SVG: hanya BOM, deklarasi XML, komentar, dan
 * DOCTYPE yang boleh mendahului elemen `<svg>`. Ini menolak HTML yang
 * membungkus SVG (mis. `<html><body><svg ...>`).
 */
function assertSvgDocument(svg: string): void {
  const head = svg
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trimStart();

  if (!/^<svg(?:\s|>)/i.test(head)) {
    throw new TemplateAdminError(
      'TEMPLATE_INVALID',
      'Dokumen harus berupa SVG murni dengan elemen <svg> sebagai root.',
      422,
      { svg: 'SVG yang dibungkus HTML tidak diizinkan.' }
    );
  }
}

function parseCanvasSize(svg: string): { width: number; height: number } {
  assertSvgDocument(svg);

  const root = /<svg\b([^>]*)>/i.exec(svg);
  if (!root) {
    throw new TemplateAdminError(
      'TEMPLATE_INVALID',
      'File harus berupa SVG dengan elemen <svg> di root.',
      422
    );
  }

  const attrs = root[1];
  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(
    attrs
  );
  const width = numberAttr(attrs, 'width') ?? (viewBox ? Number(viewBox[1]) : null);
  const height = numberAttr(attrs, 'height') ?? (viewBox ? Number(viewBox[2]) : null);

  if (!width || !height) {
    throw new TemplateAdminError(
      'TEMPLATE_INVALID',
      'SVG harus punya ukuran width/height atau viewBox yang jelas.',
      422
    );
  }
  return { width, height };
}

function assertCanvasSize(width: number, height: number): void {
  if (width < 600 || height < 750 || width > 2160 || height > 2700) {
    throw new TemplateAdminError(
      'TEMPLATE_SIZE_INVALID',
      `Ukuran SVG ${width}×${height}px di luar batas. Gunakan 1080×1350px (4:5).`,
      422
    );
  }
  if (Math.abs(width / height - 4 / 5) > 0.01) {
    throw new TemplateAdminError(
      'TEMPLATE_ASPECT_INVALID',
      `Rasio SVG ${width}×${height} bukan 4:5. Gunakan 1080×1350px.`,
      422
    );
  }
}

function assertSafeSvg(svg: string): void {
  const forbidden: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /<!DOCTYPE\b|<!ENTITY\b/i, message: 'DOCTYPE/ENTITY tidak diizinkan.' },
    { pattern: /<script\b/i, message: 'Tag <script> tidak diizinkan.' },
    {
      pattern: /<foreignObject\b|<iframe\b|<object\b|<embed\b/i,
      message: 'Elemen interaktif/embed tidak diizinkan.',
    },
    { pattern: /\son[a-z]+\s*=/i, message: 'Event handler (on*) tidak diizinkan.' },
    { pattern: /javascript\s*:/i, message: 'URL javascript: tidak diizinkan.' },
    { pattern: /@import\b/i, message: 'CSS @import tidak diizinkan.' },
    {
      pattern: /(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i,
      message: 'Referensi gambar/aset eksternal tidak diizinkan.',
    },
    {
      pattern: /url\(\s*["']?\s*(?:https?:)?\/\//i,
      message: 'CSS url() eksternal tidak diizinkan.',
    },
    {
      pattern: /data:text\/html|data:image\/svg\+xml/i,
      message: 'Data URI HTML/SVG bersarang tidak diizinkan.',
    },
  ];

  for (const rule of forbidden) {
    if (rule.pattern.test(svg)) {
      throw new TemplateAdminError(
        'TEMPLATE_UNSAFE',
        `SVG ditolak: ${rule.message}`,
        422,
        { svg: rule.message }
      );
    }
  }

  const tagCount = (svg.match(/</g) ?? []).length;
  if (tagCount > MAX_TEMPLATE_SVG_TAGS) {
    throw new TemplateAdminError(
      'TEMPLATE_TOO_COMPLEX',
      `SVG terlalu kompleks (${tagCount} tag). Maksimal ${MAX_TEMPLATE_SVG_TAGS} tag.`,
      422
    );
  }
}

function assertRequiredSlots(slots: TemplateSlots): void {
  const missing: string[] = [];
  if (!slots.anchor || !Number.isFinite(slots.anchor.x) || !Number.isFinite(slots.anchor.y)) {
    missing.push('#editable-message (posisi anchor)');
  }
  if (
    !slots.message ||
    !(slots.message.maxWidth > 0) ||
    !(slots.message.maxLines >= 1) ||
    !(slots.message.bottom > 0)
  ) {
    missing.push('#editable-message (lebar/batas bawah teks)');
  }
  if (!slots.user && !slots.meta?.handle) missing.push('#editable-user (atau #editable-meta)');
  if (!slots.time && !slots.meta?.time) missing.push('#editable-time (atau #editable-meta)');
  if (!slots.footer) missing.push('#editable-footer');

  if (missing.length) {
    throw new TemplateAdminError(
      'TEMPLATE_SLOTS_MISSING',
      `SVG belum memenuhi konvensi slot: ${missing.join(', ')}.`,
      422,
      { svg: `Wajib ada: ${missing.join(', ')}.` }
    );
  }
}

/**
 * Validasi keamanan + ukur geometri + turunkan palette/checksum dari SVG.
 * Tidak menyentuh database dan tidak merender gambar.
 */
export async function analyzeTemplateSvg(
  svg: string,
  key: string
): Promise<TemplateSvgAnalysis> {
  const normalizedKey = assertTemplateKey(key);

  if (typeof svg !== 'string' || !svg.trim()) {
    throw new TemplateAdminError('TEMPLATE_INVALID', 'Isi SVG wajib dikirim.', 422, {
      svg: 'File SVG kosong.',
    });
  }

  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > MAX_TEMPLATE_SVG_BYTES) {
    throw new TemplateAdminError(
      'TEMPLATE_TOO_LARGE',
      `Ukuran SVG ${(bytes / 1024 / 1024).toFixed(2)}MB melebihi batas 2MB.`,
      422,
      { svg: 'Maksimal 2MB.' }
    );
  }

  const declared = parseCanvasSize(svg);
  const { normalizeSvg, measureTemplate, derivePalette } = await loadTemplateScripts();
  // Normalisasi lebih dulu: template resmi memakai @import Google Fonts yang
  // memang harus dibuang untuk resvg. Setelah dibuang, sisa SVG tetap harus
  // lolos semua aturan keamanan.
  const normalized = normalizeSvg(svg);
  assertSafeSvg(normalized);

  const tmpFile = path.join(os.tmpdir(), `fnc-template-${crypto.randomUUID()}.svg`);
  let measured: MeasuredTemplate;
  try {
    fs.writeFileSync(tmpFile, svg, 'utf8');
    measured = measureTemplate(tmpFile);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  if (measured.error) {
    const detail = String(measured.error).replace(path.basename(tmpFile), `${normalizedKey}.svg`);
    throw new TemplateAdminError(
      'TEMPLATE_INVALID',
      `SVG tidak bisa diukur: ${detail}`,
      422,
      { svg: detail }
    );
  }

  measured.key = normalizedKey;
  measured.file = `${normalizedKey}.svg`;

  const width = Number(measured.canvas?.width) || declared.width;
  const height = Number(measured.canvas?.height) || declared.height;
  assertCanvasSize(width, height);

  const slots = {
    anchor: measured.anchor,
    message: measured.message,
    quote: measured.quote,
    user: measured.user,
    time: measured.time,
    meta: measured.meta,
    footer: measured.footer,
    obstacles: measured.obstacles ?? [],
    flagged: measured.flags ?? [],
  } as unknown as TemplateSlots;

  assertRequiredSlots(slots);

  let palette: TemplateSvgAnalysis['palette'] = null;
  try {
    palette = derivePalette(normalized);
  } catch {
    palette = null;
  }

  return {
    normalized,
    bytes,
    checksum: crypto.createHash('sha256').update(normalized).digest('hex'),
    width,
    height,
    slots,
    palette,
    warnings: measured.flags ?? [],
  };
}
