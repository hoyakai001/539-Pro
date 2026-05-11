import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { verifyDraw, type RawDraw } from './verifyDraw';
import { getConfig } from '../config/configService';
import { normalizeDrawDate } from './dateUtils';

export const DEFAULT_OFFICIAL_API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
export const DEFAULT_OFFICIAL_HTML_URL = 'https://www.taiwanlottery.com/lotto/result/4_d/';
export const OFFICIAL_HTML_URL = DEFAULT_OFFICIAL_HTML_URL;

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Referer: 'https://www.taiwanlottery.com/',
};

export interface FetchLatestResult {
  success: boolean;
  dataStatus: 'VALID' | 'PENDING_OFFICIAL';
  message?: string;
  data?: RawDraw & { source: string; source_url: string };
  error?: string;
  diagnostic?: string;
}

export function getOfficialApiUrl(): string {
  const cfg = getConfig();
  return cfg.officialApiUrl || cfg.tw_lottery_api_latest || DEFAULT_OFFICIAL_API_URL;
}

export function getOfficialHtmlUrl(): string {
  const cfg = getConfig();
  return cfg.officialHtmlUrl || DEFAULT_OFFICIAL_HTML_URL;
}

export async function fetchOfficialLatest539(): Promise<FetchLatestResult> {
  const apiUrl = getOfficialApiUrl();
  try {
    const apiDraw = await fetchLatestFromApi(apiUrl);
    return {
      success: true,
      dataStatus: 'VALID',
      data: { ...apiDraw, source: 'official_api', source_url: apiUrl },
    };
  } catch (apiError) {
    try {
      return await fetchOfficialLatest539Html(getOfficialHtmlUrl());
    } catch (htmlError) {
      return {
        success: false,
        dataStatus: 'PENDING_OFFICIAL',
        message: '官方資料暫時無法確認',
        error: '官方資料暫時無法確認',
        diagnostic: `API: ${formatError(apiError)}\nHTML: ${formatError(htmlError)}`,
      };
    }
  }
}

export async function fetchLatestFromApi(apiUrl = getOfficialApiUrl(), now = new Date()): Promise<RawDraw> {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resp = await axios.get(apiUrl, {
    timeout: 2500,
    headers: HTTP_HEADERS,
    params: { month, endMonth: month, pageNum: 1, pageSize: 50 },
    validateStatus: status => status >= 200 && status < 300,
  });

  return parseOfficialApiResponse(resp.data);
}

export function parseOfficialApiResponse(payload: unknown): RawDraw {
  const rows = findDaily539Rows(payload);
  if (rows.length === 0) throw new Error('API response has no daily539Res rows');

  const parsed = rows.map(parseApiRow).filter((row): row is RawDraw => !!row);
  if (parsed.length === 0) throw new Error('API rows could not be parsed');

  const latest = parsed.reduce((best, current) => {
    const dateCompare = current.draw_date.localeCompare(best.draw_date);
    if (dateCompare > 0) return current;
    if (dateCompare === 0 && current.draw_no.localeCompare(best.draw_no) > 0) return current;
    return best;
  });
  verifyDraw(latest);
  return latest;
}

export async function fetchOfficialLatest539Html(htmlUrl = getOfficialHtmlUrl()): Promise<FetchLatestResult> {
  let html: string;

  try {
    const iconv = await import('iconv-lite');
    const resp = await axios.get(htmlUrl, {
      timeout: 2500,
      headers: HTTP_HEADERS,
      responseType: 'arraybuffer',
      validateStatus: status => status >= 200 && status < 300,
    });
    html = iconv.decode(Buffer.from(resp.data as ArrayBuffer), 'utf-8');
  } catch (e) {
    throw new Error(`HTML fetch failed: ${formatError(e)}`);
  }

  const $ = cheerio.load(html);
  const nextData = $('script#__NEXT_DATA__').html();
  if (nextData) {
    try {
      const draw = searchJsonForDraw(JSON.parse(nextData));
      if (draw) return validHtmlResult(draw, htmlUrl);
    } catch {
      // Continue to other HTML strategies.
    }
  }

  const embedded = tryExtractEmbeddedJson($);
  if (embedded) return validHtmlResult(embedded, htmlUrl);

  const selectorDraw = buildSelectorStrategies($);
  if (selectorDraw) return validHtmlResult(selectorDraw, htmlUrl);

  throw new Error(`HTML contained no parseable Daily 539 draw. preview=${html.slice(0, 500).replace(/\s+/g, ' ')}`);
}

function validHtmlResult(draw: RawDraw, htmlUrl: string): FetchLatestResult {
  verifyDraw(draw);
  return {
    success: true,
    dataStatus: 'VALID',
    data: { ...draw, source: 'official_html', source_url: htmlUrl },
  };
}

function findDaily539Rows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const content = root['content'];

  if (content && typeof content === 'object') {
    const daily = (content as Record<string, unknown>)['daily539Res'];
    if (Array.isArray(daily)) return daily.filter(isRecord);
  }

  const direct = root['daily539Res'];
  if (Array.isArray(direct)) return direct.filter(isRecord);
  return [];
}

function parseApiRow(row: Record<string, unknown>): RawDraw | null {
  const drawNo = String(row['period'] ?? row['drawNo'] ?? row['draw_no'] ?? '').replace(/\D/g, '');
  const date = normalizeDate(String(row['lotteryDate'] ?? row['drawDate'] ?? row['draw_date'] ?? ''));
  const rawNumbers = Array.isArray(row['drawNumberAppear'])
    ? row['drawNumberAppear']
    : Array.isArray(row['drawNumberSize'])
      ? row['drawNumberSize']
      : Array.isArray(row['numbers'])
        ? row['numbers']
        : null;

  if (!drawNo || !date || !rawNumbers) return null;
  const numbers = rawNumbers.map(n => parseInt(String(n), 10));
  const draw = { draw_no: drawNo, draw_date: date, numbers };
  verifyDraw(draw);
  return draw;
}

function searchJsonForDraw(obj: unknown, depth = 0): RawDraw | null {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;

  try {
    const rows = findDaily539Rows(obj);
    if (rows.length > 0) return parseOfficialApiResponse({ content: { daily539Res: rows } });
  } catch {
    // Continue recursive search.
  }

  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = searchJsonForDraw(val, depth + 1);
    if (found) return found;
  }
  return null;
}

function tryExtractEmbeddedJson($: cheerio.CheerioAPI): RawDraw | null {
  let result: RawDraw | null = null;
  $('script').each((_, el) => {
    if (result) return;
    const content = $(el).html() || '';
    if (!content.includes('539') && !content.includes('daily539Res')) return;

    const matches = content.matchAll(/(\{[^<>]{80,}\})/g);
    for (const match of matches) {
      try {
        const draw = searchJsonForDraw(JSON.parse(match[1]));
        if (draw) {
          result = draw;
          return;
        }
      } catch {
        // Skip malformed script fragments.
      }
    }
  });
  return result;
}

function buildSelectorStrategies($: cheerio.CheerioAPI): RawDraw | null {
  const text = $('body').text().replace(/\s+/g, ' ');
  const date = normalizeDate(text);
  const drawNoMatch = text.match(/(?:期別|期號|period|draw)[^\d]*(\d{8,12})/i) || text.match(/\b(\d{8,12})\b/);
  const numbers = Array.from(text.matchAll(/\b(0?[1-9]|[1-2]\d|3[0-9])\b/g))
    .map(m => parseInt(m[1], 10))
    .filter(n => n >= 1 && n <= 39);

  if (!drawNoMatch || !date || numbers.length < 5) return null;
  const draw = { draw_no: drawNoMatch[1], draw_date: date, numbers: numbers.slice(0, 5) };
  verifyDraw(draw);
  return draw;
}

function normalizeDate(text: string): string {
  return normalizeDrawDate(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const err = e as AxiosError;
    return `${err.message}${err.code ? ` (${err.code})` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
