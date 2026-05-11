import { getLatestDraw } from '../db/database';
import { todayIso } from '../data/dateUtils';

export interface PredictionTarget {
  target_date: string;
  target_draw_no: string | null;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
}

export function resolvePredictionTarget(): PredictionTarget {
  const latest = getLatestDraw();
  if (!latest) throw new Error('no verified draw is available for prediction target');

  const today = todayIso();
  const targetDate = latest.draw_date < today
    ? today
    : nextDrawDateAfter(latest.draw_date);

  if (targetDate <= latest.draw_date) {
    throw new Error(`prediction target date must be after latest draw date (${latest.draw_date})`);
  }

  return {
    target_date: targetDate,
    target_draw_no: nextDrawNo(latest.draw_no),
    latest_used_draw_no: latest.draw_no,
    latest_used_draw_date: latest.draw_date,
  };
}

function nextDrawNo(drawNo: string): string | null {
  if (!/^\d+$/.test(drawNo)) return null;
  return String(Number(drawNo) + 1).padStart(drawNo.length, '0');
}

function nextDrawDateAfter(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  while (d.getUTCDay() === 0) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}
