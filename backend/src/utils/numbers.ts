export function normalizeNumbers(numbers: unknown): number[] {
  if (!Array.isArray(numbers)) return [];
  return numbers
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 39);
}

export function sortNumbers(numbers: number[]): number[] {
  return [...numbers].map(Number).sort((a, b) => a - b);
}

export function formatNumber(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatNumbers(numbers: number[]): string[] {
  return sortNumbers(numbers).map(formatNumber);
}

export function comboKey(numbers: number[]): string {
  return formatNumbers(numbers).join(',');
}

export function combinations(numbers: number[], size: number): number[][] {
  const sorted = sortNumbers(numbers);
  const out: number[][] = [];
  const walk = (start: number, picked: number[]) => {
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i <= sorted.length - (size - picked.length); i++) {
      picked.push(sorted[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

export function validate539Numbers(numbers: number[]): boolean {
  const normalized = normalizeNumbers(numbers);
  return normalized.length === 5 && new Set(normalized).size === 5;
}
