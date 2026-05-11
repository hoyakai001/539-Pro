export function normalizeDrawDate(input: string): string {
  const text = String(input ?? '').trim();
  const match = text.match(/(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!match) return '';

  let year = parseInt(match[1], 10);
  if (year < 1911) year += 1911;

  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return '';

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toDisplayDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const iso = normalizeDrawDate(input);
  return iso ? iso.replace(/-/g, '/') : null;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isoToDate(input: string): Date | null {
  const iso = normalizeDrawDate(input);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}
