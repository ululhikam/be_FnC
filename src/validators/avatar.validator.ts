import { z } from "zod";

/**
 * Avatar boleh berupa URL http(s), path lokal, atau data-URI gambar.
 * Preset avatar frontend memakai SVG data-URI, sedangkan upload pengguna
 * dikirim sebagai data-URI yang sudah dikompres di browser.
 */
const HTTP_URL_RE = /^https?:\/\/\S+$/i;
const LOCAL_PATH_RE = /^\/(?!\/)\S+$/;
const DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)(?:;charset=[^;,]+)?(?:;base64)?,/i;

/** Batas aman agar data-URI tidak membengkakkan database/API. */
export const AVATAR_MAX_LENGTH = 600_000;

export const AvatarSchema = z
  .string()
  .trim()
  .max(AVATAR_MAX_LENGTH, "Ukuran foto profil terlalu besar")
  .refine(
    (value) =>
      !value ||
      HTTP_URL_RE.test(value) ||
      LOCAL_PATH_RE.test(value) ||
      DATA_IMAGE_RE.test(value),
    "Format foto profil tidak valid",
  )
  .optional()
  .nullable();

export function isAvatarImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (HTTP_URL_RE.test(value) ||
      LOCAL_PATH_RE.test(value) ||
      DATA_IMAGE_RE.test(value))
  );
}
