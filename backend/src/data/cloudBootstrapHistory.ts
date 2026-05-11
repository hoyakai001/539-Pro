import { fetchOfficialHistoryByMonths } from './fetchOfficialHistory539';
import { verifyDraw, type RawDraw } from './verifyDraw';
import { todayIso } from './dateUtils';
import { getDatabaseAdapter, isCloudMode, type AdapterDraw } from '../db/adapters';
import { buildStatisticalPrediction } from '../engine/statisticalPrediction';
import type { DrawEntry } from '../engine/features';
import { sortNumbers } from '../utils/numbers';

export interface CloudBootstrapHistoryReport {
  success: boolean;
  minDraws: number;
  monthsFetched: number;
  officialDrawsFetched: number;
  inserted: number;
  existing: number;
  evaluated: number;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  predictionCreated: boolean;
  predictionTargetDrawNo: string | null;
  predictionTargetDate: string | null;
  errors: string[];
}

export async function bootstrapCloudHistory(minDraws = 100): Promise<CloudBootstrapHistoryReport> {
  if (!isCloudMode()) throw new Error('bootstrap-history is only available when APP_MODE=cloud');
  const adapter = getDatabaseAdapter();
  const report: CloudBootstrapHistoryReport = {
    success: false,
    minDraws,
    monthsFetched: 0,
    officialDrawsFetched: 0,
    inserted: 0,
    existing: 0,
    evaluated: 0,
    latestDrawNo: null,
    latestDrawDate: null,
    predictionCreated: false,
    predictionTargetDrawNo: null,
    predictionTargetDate: null,
    errors: [],
  };

  const fetched = await fetchRecentOfficialDraws(minDraws);
  report.monthsFetched = fetched.monthsFetched;
  report.officialDrawsFetched = fetched.draws.length;
  report.errors.push(...fetched.errors);
  if (fetched.draws.length < minDraws) {
    throw new Error(`official history returned ${fetched.draws.length} draws; at least ${minDraws} are required`);
  }

  for (const draw of fetched.draws) {
    verifyDraw(draw);
    const outcome = await adapter.insertDraw({
      draw_no: draw.draw_no,
      draw_date: draw.draw_date,
      numbers: draw.numbers,
      source: 'official_history_api',
      source_url: null,
      verified: true,
    });
    if (outcome === 'inserted') report.inserted++;
    else report.existing++;
  }

  const rows = await adapter.getDraws(Math.max(300, minDraws));
  const latest = rows[0] ?? null;
  report.latestDrawNo = latest?.draw_no ?? null;
  report.latestDrawDate = latest?.draw_date ?? null;
  if (rows.length < minDraws) {
    throw new Error(`Firestore has ${rows.length} draws after bootstrap; at least ${minDraws} are required`);
  }

  for (const draw of rows.slice(0, Math.max(minDraws, 100))) {
    const prediction = await adapter.getPredictionByDrawNo(draw.draw_no);
    if (!prediction) continue;
    const actual = sortNumbers(draw.numbers);
    await adapter.saveObservation({
      prediction_id: prediction.id ?? null,
      model_version: String(prediction.model_version ?? 'v6.1-three-star-stable'),
      target_draw_no: draw.draw_no,
      target_date: String(prediction.target_date ?? draw.draw_date),
      selected_single: Number(prediction.single_number ?? prediction.single ?? 0),
      selected_two_star: numbers(prediction.two_star),
      selected_three_star: numbers(prediction.three_star),
      selected_four_star: numbers(prediction.four_star),
      selected_five_star: numbers(prediction.five_star),
      three_star: numbers(prediction.three_star),
      actual_numbers: actual,
      single_hit: actual.includes(Number(prediction.single_number ?? prediction.single ?? 0)),
      two_star_hit: numbers(prediction.two_star).length === 2 && numbers(prediction.two_star).every(n => actual.includes(n)),
      three_star_hits: hitCount(numbers(prediction.three_star), actual),
      four_star_hits: hitCount(numbers(prediction.four_star), actual),
      five_star_hits: hitCount(numbers(prediction.five_star), actual),
      advice_level: advice(prediction).level,
      advice_label: advice(prediction).label,
      advice: advice(prediction).label,
      confidence: advice(prediction).confidence,
      evaluated_at: new Date().toISOString(),
    });
    report.evaluated++;
  }

  const target = resolveCloudTarget(latest);
  report.predictionTargetDrawNo = target.target_draw_no;
  report.predictionTargetDate = target.target_date;
  const cached = target.target_draw_no ? await adapter.getPredictionByDrawNo(target.target_draw_no) : null;
  if (!cached) {
    const prediction = {
      ...buildStatisticalPrediction(rows.map(adapterDrawToEntry), target.target_date, [], undefined, null),
      target_draw_no: target.target_draw_no,
    };
    const id = await adapter.savePrediction({
      ...prediction,
      single_number: prediction.single_number,
      number_scores_json: prediction.number_scores,
      created_at: new Date().toISOString(),
    });
    await adapter.saveObservation({
      prediction_id: id,
      model_version: prediction.model_version,
      target_draw_no: prediction.target_draw_no ?? null,
      target_date: prediction.target_date,
      selected_single: prediction.single_number,
      selected_two_star: prediction.two_star,
      selected_three_star: prediction.three_star,
      selected_four_star: prediction.four_star,
      selected_five_star: prediction.five_star,
      advice_level: prediction.bet_advice.level,
      advice_label: prediction.bet_advice.label,
      advice: prediction.bet_advice.label,
      confidence: prediction.bet_advice.confidence,
      created_at: new Date().toISOString(),
      evaluated_at: null,
    });
    report.predictionCreated = true;
  }

  report.success = true;
  return report;
}

async function fetchRecentOfficialDraws(minDraws: number): Promise<{ draws: RawDraw[]; monthsFetched: number; errors: string[] }> {
  const attempts = [6, 12, 24];
  let best: RawDraw[] = [];
  const errors: string[] = [];
  let monthsFetched = 0;
  for (const monthsBack of attempts) {
    const endMonth = currentMonth();
    const startMonth = monthOffset(endMonth, -(monthsBack - 1));
    const result = await fetchOfficialHistoryByMonths(startMonth, endMonth);
    monthsFetched = monthsBack;
    if (result.draws && result.draws.length > best.length) best = result.draws;
    if (result.error) errors.push(result.error);
    if (best.length >= minDraws) break;
  }
  best.sort((a, b) => b.draw_date.localeCompare(a.draw_date) || b.draw_no.localeCompare(a.draw_no));
  return { draws: best, monthsFetched, errors };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthOffset(month: string, offset: number): string {
  const [year, rawMonth] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, rawMonth - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function adapterDrawToEntry(row: AdapterDraw): DrawEntry {
  return { draw_no: row.draw_no, draw_date: row.draw_date, numbers: sortNumbers(row.numbers) };
}

function resolveCloudTarget(latest: AdapterDraw | null) {
  if (!latest) throw new Error('latest draw is required to build prediction target');
  const today = todayIso();
  const targetDate = latest.draw_date < today ? today : nextDrawDateAfter(latest.draw_date);
  return {
    target_date: targetDate,
    target_draw_no: /^\d+$/.test(latest.draw_no) ? String(Number(latest.draw_no) + 1).padStart(latest.draw_no.length, '0') : null,
  };
}

function nextDrawDateAfter(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? sortNumbers(value.map(Number).filter(Number.isFinite)) : [];
}

function hitCount(pick: number[], actual: number[]): number {
  return pick.filter(n => actual.includes(n)).length;
}

function advice(prediction: Record<string, unknown>): { level: string; label: string; confidence: string } {
  const raw = prediction['bet_advice'] as { level?: string; label?: string; confidence?: string } | undefined;
  return {
    level: String(raw?.level ?? prediction['advice_level'] ?? ''),
    label: String(raw?.label ?? prediction['advice_label'] ?? ''),
    confidence: String(raw?.confidence ?? prediction['confidence'] ?? ''),
  };
}
