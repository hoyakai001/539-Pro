import { getDB, getDraws, getLatestDraw, getPreviousDraw } from '../db/database';
import { normalizeDrawDate } from './dateUtils';
import { fetchLatestFromApi } from './fetchOfficialLatest539';
import { sortNumbers, validate539Numbers } from '../utils/numbers';

export type AuditStatus = 'PASS' | 'WARN' | 'FAIL';

export interface HistoryAuditResult {
  id?: number;
  status: AuditStatus;
  checked_at: string;
  checked_count: number;
  latest_draw_no: string | null;
  latest_draw_date: string | null;
  previous_draw_no: string | null;
  previous_draw_date: string | null;
  official_api_reachable: boolean;
  can_run_official_backtest: boolean;
  can_predict: boolean;
  warnings: string[];
  errors: string[];
}

export async function runHistoryAudit(): Promise<HistoryAuditResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows = getDraws();

  const drawNos = new Set<string>();
  for (const row of rows) {
    if (drawNos.has(row.draw_no)) errors.push(`duplicate draw_no ${row.draw_no}`);
    drawNos.add(row.draw_no);
    if (normalizeDrawDate(row.draw_date) !== row.draw_date) errors.push(`draw_date is not normalized for ${row.draw_no}`);
    const numbers = sortNumbers(JSON.parse(row.numbers_json));
    if (!validate539Numbers(numbers)) errors.push(`invalid numbers for ${row.draw_no}`);
  }

  const latest = getLatestDraw();
  const previous = getPreviousDraw();
  if (latest && rows[0] && latest.draw_no !== rows[0].draw_no) errors.push('latest draw is not ordered by draw_date desc, draw_no desc');
  if (latest && previous && previous.draw_date > latest.draw_date) errors.push('previous draw date is after latest draw date');

  let officialReachable = false;
  if (latest) {
    try {
      const officialLatest = await fetchLatestFromApi();
      officialReachable = true;
      if (officialLatest.draw_no !== latest.draw_no) warnings.push(`official latest ${officialLatest.draw_no} differs from DB latest ${latest.draw_no}`);
      if (officialLatest.draw_date !== latest.draw_date) warnings.push(`official latest date ${officialLatest.draw_date} differs from DB latest ${latest.draw_date}`);
      const dbNums = sortNumbers(JSON.parse(latest.numbers_json));
      const officialNums = sortNumbers(officialLatest.numbers);
      if (JSON.stringify(dbNums) !== JSON.stringify(officialNums)) errors.push(`official latest numbers conflict with DB latest ${latest.draw_no}`);
    } catch (e) {
      warnings.push(`official API unreachable during audit: ${(e as Error).message}`);
    }
  }

  const status: AuditStatus = errors.length ? 'FAIL' : warnings.length || !officialReachable ? 'WARN' : 'PASS';
  const result: HistoryAuditResult = {
    status,
    checked_at: new Date().toISOString(),
    checked_count: rows.length,
    latest_draw_no: latest?.draw_no ?? null,
    latest_draw_date: latest?.draw_date ?? null,
    previous_draw_no: previous?.draw_no ?? null,
    previous_draw_date: previous?.draw_date ?? null,
    official_api_reachable: officialReachable,
    can_run_official_backtest: status !== 'FAIL',
    can_predict: status !== 'FAIL',
    warnings,
    errors,
  };
  result.id = saveHistoryAudit(result);
  return result;
}

export function getLatestHistoryAudit(): HistoryAuditResult | null {
  const row = getDB().prepare('SELECT * FROM history_audits ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row['id']),
    status: row['status'] as AuditStatus,
    checked_at: String(row['checked_at']),
    checked_count: Number(row['checked_count']),
    latest_draw_no: row['latest_draw_no'] ? String(row['latest_draw_no']) : null,
    latest_draw_date: row['latest_draw_date'] ? String(row['latest_draw_date']) : null,
    previous_draw_no: row['previous_draw_no'] ? String(row['previous_draw_no']) : null,
    previous_draw_date: row['previous_draw_date'] ? String(row['previous_draw_date']) : null,
    official_api_reachable: Number(row['official_api_reachable']) === 1,
    can_run_official_backtest: Number(row['can_run_official_backtest']) === 1,
    can_predict: Number(row['can_predict']) === 1,
    warnings: JSON.parse(String(row['warnings_json'] ?? '[]')),
    errors: JSON.parse(String(row['errors_json'] ?? '[]')),
  };
}

function saveHistoryAudit(result: HistoryAuditResult): number {
  const saved = getDB().prepare(`
    INSERT INTO history_audits
      (checked_at, status, checked_count, latest_draw_no, latest_draw_date,
       previous_draw_no, previous_draw_date, official_api_reachable,
       can_run_official_backtest, can_predict, warnings_json, errors_json)
    VALUES
      (@checked_at, @status, @checked_count, @latest_draw_no, @latest_draw_date,
       @previous_draw_no, @previous_draw_date, @official_api_reachable,
       @can_run_official_backtest, @can_predict, @warnings_json, @errors_json)
  `).run({
    ...result,
    official_api_reachable: result.official_api_reachable ? 1 : 0,
    can_run_official_backtest: result.can_run_official_backtest ? 1 : 0,
    can_predict: result.can_predict ? 1 : 0,
    warnings_json: JSON.stringify(result.warnings),
    errors_json: JSON.stringify(result.errors),
  });
  return Number(saved.lastInsertRowid);
}
