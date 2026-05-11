import type { AdapterDraw, AdapterObservation, AdapterPrediction, DatabaseAdapter } from './DatabaseAdapter';
import {
  getDB,
  getDraws,
  getLatestDraw,
  saveStrategyObservationLog,
  getStrategyObservationLogs,
  upsertDraw,
} from '../database';
import { sortNumbers } from '../../utils/numbers';

export class SQLiteAdapter implements DatabaseAdapter {
  async getDraws(limit?: number): Promise<AdapterDraw[]> {
    return getDraws(limit).map(row => ({
      draw_no: row.draw_no,
      draw_date: row.draw_date,
      date: row.draw_date,
      numbers: sortNumbers(JSON.parse(row.numbers_json)),
      source: row.source,
      source_url: row.source_url,
      verified: row.verified === 1,
    }));
  }

  async insertDraw(draw: AdapterDraw): Promise<'inserted' | 'existing'> {
    return upsertDraw({
      draw_no: draw.draw_no,
      draw_date: draw.draw_date || draw.date || '',
      numbers: draw.numbers,
      source: draw.source ?? 'official',
      source_url: draw.source_url ?? undefined,
      verified: draw.verified ?? true,
    });
  }

  async getLatestDraw(): Promise<AdapterDraw | null> {
    const row = getLatestDraw();
    if (!row) return null;
    return {
      draw_no: row.draw_no,
      draw_date: row.draw_date,
      date: row.draw_date,
      numbers: sortNumbers(JSON.parse(row.numbers_json)),
      source: row.source,
      source_url: row.source_url,
      verified: row.verified === 1,
    };
  }

  async savePrediction(prediction: AdapterPrediction): Promise<string | number> {
    return prediction.id ?? prediction.target_draw_no ?? prediction.target_date ?? '';
  }

  async getPredictionByDrawNo(draw_no: string): Promise<AdapterPrediction | null> {
    const row = getDB().prepare(`
      SELECT * FROM predictions
      WHERE target_draw_no=? AND data_status='VALID'
      ORDER BY id DESC
      LIMIT 1
    `).get(draw_no) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      id: Number(row['id']),
      target_draw_no: String(row['target_draw_no'] ?? ''),
      two_star: parseNumbers(row['two_star_json']),
      three_star: parseNumbers(row['three_star_json']),
      four_star: parseNumbers(row['four_star_json']),
      five_star: parseNumbers(row['five_star_json']),
      bet_advice: parseObject(row['bet_advice_json']),
      model_version: typeof row['model_version'] === 'string' ? row['model_version'] : undefined,
    };
  }

  async saveObservation(log: AdapterObservation): Promise<void> {
    saveStrategyObservationLog({
      prediction_id: Number(log.prediction_id ?? 0),
      model_version: String(log.model_version ?? 'v6.1-three-star-stable'),
      target_draw_no: log.target_draw_no ?? null,
      target_date: String(log.target_date ?? ''),
      selected_single: Number(log.selected_single ?? 0),
      selected_two_star: log.selected_two_star ?? [],
      selected_three_star: log.selected_three_star ?? log.three_star ?? [],
      selected_four_star: log.selected_four_star ?? [],
      selected_five_star: log.selected_five_star ?? [],
      advice_level: log.advice_level ?? null,
      advice_label: log.advice_label ?? log.advice ?? '',
      confidence: log.confidence ?? '',
      draw_profile: String(log['draw_profile'] ?? ''),
    });
  }

  async getObservations(limit = 30): Promise<AdapterObservation[]> {
    return getStrategyObservationLogs(limit).map(row => ({
      id: row.id,
      prediction_id: row.prediction_id,
      target_draw_no: row.target_draw_no,
      target_date: row.target_date,
      selected_single: row.selected_single,
      selected_two_star: parseNumbers(row.selected_two_star),
      selected_three_star: parseNumbers(row.selected_three_star),
      selected_four_star: parseNumbers(row.selected_four_star),
      selected_five_star: parseNumbers(row.selected_five_star),
      actual_numbers: parseNumbers(row.actual_numbers),
      single_hit: row.single_hit,
      two_star_hit: row.two_star_hit,
      three_star_hits: row.three_star_hits,
      four_star_hits: row.four_star_hits,
      five_star_hits: row.five_star_hits,
      advice_level: row.advice_level,
      advice_label: row.advice_label,
      confidence: row.confidence,
      model_version: row.model_version,
      created_at: row.created_at,
      evaluated_at: row.evaluated_at,
    }));
  }

  async getStats(window: number): Promise<{ observations: AdapterObservation[] }> {
    return { observations: await this.getObservations(window) };
  }
}

function parseNumbers(value: unknown): number[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? sortNumbers(parsed.map(Number).filter(Number.isFinite)) : [];
  } catch {
    return [];
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
