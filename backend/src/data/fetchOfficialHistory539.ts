import axios from 'axios';
import { verifyDraw, type RawDraw } from './verifyDraw';
import { getOfficialApiUrl, parseOfficialApiResponse } from './fetchOfficialLatest539';

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Accept: 'application/json,*/*',
  Referer: 'https://www.taiwanlottery.com/',
};

export interface FetchHistoryResult {
  success: boolean;
  draws?: RawDraw[];
  failedCount?: number;
  error?: string;
  sourceUrl?: string;
}

export async function fetchOfficialHistory539(rocYear?: number): Promise<FetchHistoryResult> {
  const gregYear = (rocYear ?? new Date().getFullYear() - 1911) + 1911;
  return fetchOfficialHistoryByMonths(
    `${gregYear}-01`,
    `${gregYear}-12`,
  );
}

export async function fetchHistoryMultiYear(startRocYear: number, endRocYear: number): Promise<FetchHistoryResult> {
  const startYear = startRocYear + 1911;
  const endYear = endRocYear + 1911;
  return fetchOfficialHistoryByMonths(`${startYear}-01`, `${endYear}-12`);
}

export async function fetchOfficialHistoryByMonths(startMonth: string, endMonth: string): Promise<FetchHistoryResult> {
  const apiUrl = getOfficialApiUrl();
  const draws: RawDraw[] = [];
  const errors: string[] = [];
  let failedCount = 0;

  for (const month of enumerateMonths(startMonth, endMonth)) {
    try {
      const monthDraws = await fetchMonth(apiUrl, month);
      draws.push(...monthDraws);
      console.log(`[fetchHistory] ${month}: ${monthDraws.length} draws`);
    } catch (e) {
      failedCount++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${month}: ${message}`);
      console.warn(`[fetchHistory] ${month} skipped: ${message}`);
    }
  }

  const unique = dedupeDraws(draws);
  unique.sort((a, b) => a.draw_no.localeCompare(b.draw_no));

  return {
    success: unique.length > 0,
    draws: unique,
    failedCount,
    error: errors.length > 0 ? errors.join('\n') : undefined,
    sourceUrl: apiUrl,
  };
}

async function fetchMonth(apiUrl: string, month: string): Promise<RawDraw[]> {
  const resp = await axios.get(apiUrl, {
    timeout: 10000,
    headers: HTTP_HEADERS,
    params: { month, endMonth: month, pageNum: 1, pageSize: 200 },
    validateStatus: status => status >= 200 && status < 300,
  });

  const rows = extractRows(resp.data);
  return rows.map(row => parseRowViaLatestParser(row)).filter((row): row is RawDraw => !!row);
}

function parseRowViaLatestParser(row: Record<string, unknown>): RawDraw | null {
  try {
    const draw = parseOfficialApiResponse({ content: { daily539Res: [row] } });
    verifyDraw(draw);
    return draw;
  } catch {
    return null;
  }
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const content = (payload as Record<string, unknown>)['content'];
  if (!content || typeof content !== 'object') return [];
  const rows = (content as Record<string, unknown>)['daily539Res'];
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function dedupeDraws(draws: RawDraw[]): RawDraw[] {
  const map = new Map<string, RawDraw>();
  for (const draw of draws) map.set(draw.draw_no, draw);
  return [...map.values()];
}

function enumerateMonths(startMonth: string, endMonth: string): string[] {
  const [startY, startM] = startMonth.split('-').map(Number);
  const [endY, endM] = endMonth.split('-').map(Number);
  const months: string[] = [];
  let y = startY;
  let m = startM;

  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      y++;
      m = 1;
    }
  }

  return months;
}
