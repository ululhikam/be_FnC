export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function formatMembers(count: number): string {
  // Penghitung bisa sempat minus (decrement ganda saat race unfollow); angka
  // negatif di UI terlihat seperti bug dan bisa dipakai mengukur data internal.
  const safe = Number.isFinite(count) ? Math.max(0, count) : 0;
  if (safe >= 1000000) {
    return (safe / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (safe >= 1000) {
    return (safe / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return safe.toString();
}

export function getInitials(name: string): string {
  if (!name) return 'AN';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
