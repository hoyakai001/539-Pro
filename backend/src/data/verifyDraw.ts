import { normalizeDrawDate } from './dateUtils';

export interface RawDraw {
  draw_no: string;
  draw_date: string;
  numbers: number[];
}

export class DrawValidationError extends Error {
  constructor(message: string, public readonly draw_no?: string) {
    super(message);
    this.name = 'DrawValidationError';
  }
}

export function verifyDraw(raw: RawDraw): void {
  const { draw_no, draw_date, numbers } = raw;

  if (!draw_no || !/^\d{8,12}$/.test(draw_no.trim())) {
    throw new DrawValidationError(`invalid draw_no: ${draw_no}`, draw_no);
  }

  const normalizedDate = normalizeDrawDate(draw_date);
  if (!normalizedDate || normalizedDate !== draw_date) {
    throw new DrawValidationError(`draw_date must be normalized ISO YYYY-MM-DD: ${draw_date}`, draw_no);
  }

  if (!Array.isArray(numbers) || numbers.length !== 5) {
    throw new DrawValidationError(`draw ${draw_no} must have exactly 5 numbers`, draw_no);
  }

  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > 39) {
      throw new DrawValidationError(`draw ${draw_no} has out-of-range number ${n}`, draw_no);
    }
  }

  if (new Set(numbers).size !== 5) {
    throw new DrawValidationError(`draw ${draw_no} has duplicate numbers [${numbers.join(',')}]`, draw_no);
  }
}

export function checkContinuity(drawNos: string[]): string[] {
  if (drawNos.length < 2) return [];

  const sorted = [...drawNos].sort();
  const missing: string[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = parseInt(sorted[i - 1], 10);
    const curr = parseInt(sorted[i], 10);
    const gap = curr - prev;
    if (gap > 1 && gap <= 200) {
      for (let j = prev + 1; j < curr; j++) {
        missing.push(String(j).padStart(sorted[0].length, '0'));
      }
    }
  }

  return missing;
}
