/** Handle pengguna hanya boleh diubah sekali dalam periode ini. */
export const HANDLE_CHANGE_COOLDOWN_DAYS = 7;
export const HANDLE_CHANGE_COOLDOWN_MS = HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function getHandleChangeAvailableAt(
  changedAt: Date | string | null | undefined
): Date | null {
  if (!changedAt) return null;
  const date = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + HANDLE_CHANGE_COOLDOWN_MS);
}
