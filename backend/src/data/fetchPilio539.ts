import axios from 'axios';
import * as cheerio from 'cheerio';
import { getConfig } from '../config/configService';
import { normalizeDrawDate } from './dateUtils';
import { verifyDraw, type RawDraw } from './verifyDraw';
import { sortNumbers } from '../utils/numbers';

export interface PilioFetchResult {
  source: 'pilio';
  pages_fetched: number;
  total_draws: number;
  newest_draw_no: string | null;
  newest_draw_date: string | null;
  oldest_draw_no: string | null;
  oldest_draw_date: string | null;
  draws: RawDraw[];
}

export async function fetchPilio539(): Promise<PilioFetchResult> {
  const cfg = getConfig().pilio;
  const draws = new Map<string, RawDraw>();
  let pagesFetched = 0;

  if (!cfg.enabled) {
    return emptyResult(0);
  }

  for (let page = 1; page <= cfg.pages; page++) {
    const url = buildPilioUrl(cfg.baseUrl, page);
    const html = await fetchPilioPage(url, cfg.timeoutMs);
    pagesFetched++;
    for (const draw of parsePilioPage(html)) {
      draws.set(draw.draw_no, draw);
    }
    if (page < cfg.pages) await delay(cfg.requestDelayMs);
  }

  const sorted = [...draws.values()].sort((a, b) => b.draw_date.localeCompare(a.draw_date) || b.draw_no.localeCompare(a.draw_no));
  return {
    source: 'pilio',
    pages_fetched: pagesFetched,
    total_draws: sorted.length,
    newest_draw_no: sorted[0]?.draw_no ?? null,
    newest_draw_date: sorted[0]?.draw_date ?? null,
    oldest_draw_no: sorted[sorted.length - 1]?.draw_no ?? null,
    oldest_draw_date: sorted[sorted.length - 1]?.draw_date ?? null,
    draws: sorted,
  };
}

export function parsePilioPage(html: string): RawDraw[] {
  const $ = cheerio.load(html);
  const draws: RawDraw[] = [];
  $('tr').each((_, el) => {
    const cells = $(el).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    const draw = parsePilioCells(cells) ?? parsePilioText($(el).text().replace(/\s+/g, ' ').trim());
    if (draw) draws.push(draw);
  });
  if (draws.length) return unique(draws);

  return unique($('body').text().split(/(?=\b\d{8,9}\b)/).map(parsePilioText).filter((d): d is RawDraw => !!d));
}

export function parsePilioText(text: string): RawDraw | null {
  const drawNoRaw = text.match(/\b(\d{3,9})\b/)?.[1];
  const drawNo = drawNoRaw ? drawNoRaw.padStart(8, '0') : null;
  const dateRaw = text.match(/(\d{3,4}[/-]\d{1,2}[/-]\d{1,2})/)?.[1];
  const date = dateRaw ? normalizeDrawDate(dateRaw) : null;
  const tail = text.slice(text.search(/539|今彩/));
  const numbers = [...tail.matchAll(/\b(0?[1-9]|[1-2]\d|3[0-9])\b/g)]
    .map(m => Number(m[1]))
    .filter(n => n >= 1 && n <= 39)
    .slice(0, 5);
  if (!drawNo || !date || numbers.length !== 5) return null;
  const draw = { draw_no: drawNo, draw_date: date, numbers: sortNumbers(numbers) };
  verifyDraw(draw);
  return draw;
}

function parsePilioCells(cells: string[]): RawDraw | null {
  if (cells.length < 3) return null;
  const drawNoRaw = cells[0].match(/\b(\d{3,9})\b/)?.[1];
  const drawNo = drawNoRaw ? drawNoRaw.padStart(8, '0') : null;
  const date = normalizeDrawDate(cells[1]);
  const numbers = [...cells[2].matchAll(/\b(0?[1-9]|[1-2]\d|3[0-9])\b/g)]
    .map(m => Number(m[1]))
    .filter(n => n >= 1 && n <= 39)
    .slice(0, 5);
  if (!drawNo || !date || numbers.length !== 5) return null;
  const draw = { draw_no: drawNo, draw_date: date, numbers: sortNumbers(numbers) };
  verifyDraw(draw);
  return draw;
}

function buildPilioUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set('indexpage', String(page));
  url.searchParams.set('orderby', 'new');
  return url.toString();
}

async function fetchPilioPage(url: string, timeoutMs: number): Promise<string> {
  const iconv = await import('iconv-lite');
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const bytes = Buffer.from(resp.data as ArrayBuffer);
  return iconv.decode(bytes, 'big5');
}

function unique(draws: RawDraw[]): RawDraw[] {
  const map = new Map<string, RawDraw>();
  for (const draw of draws) map.set(draw.draw_no, draw);
  return [...map.values()];
}

function emptyResult(pagesFetched: number): PilioFetchResult {
  return {
    source: 'pilio',
    pages_fetched: pagesFetched,
    total_draws: 0,
    newest_draw_no: null,
    newest_draw_date: null,
    oldest_draw_no: null,
    oldest_draw_date: null,
    draws: [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
