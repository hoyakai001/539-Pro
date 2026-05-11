import fs from 'fs';
import { resolveConfigPath } from './pathResolver';

export interface AppConfig {
  officialApiUrl: string;
  officialApiCandidates: string[];
  officialHtmlUrl: string;
  optionalSecondarySourceUrl: string;
  syncIntervalMinutes: number;
  recoveryRetryMinutes: number;
  tw_lottery_result_url: string;
  tw_lottery_api_latest: string;
  tw_lottery_api_history_base: string;
  tw_lottery_history_download_url: string;
  tw_lottery_history_result_url: string;
  tw_lottery_history_url: string;
  verify_source_enabled: boolean;
  verify_source_url: string;
  auto_sync_interval_minutes: number;
  sync_cron: string;
  pilio: {
    enabled: boolean;
    baseUrl: string;
    pages: number;
    mode: 'verifyOnly' | 'backup';
    requestDelayMs: number;
    timeoutMs: number;
  };
}

const DEFAULT_API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
const DEFAULT_HTML_URL = 'https://www.taiwanlottery.com/lotto/result/4_d/';

const DEFAULTS: AppConfig = {
  officialApiUrl: DEFAULT_API_URL,
  officialApiCandidates: [DEFAULT_API_URL],
  officialHtmlUrl: DEFAULT_HTML_URL,
  optionalSecondarySourceUrl: '',
  syncIntervalMinutes: 30,
  recoveryRetryMinutes: 5,
  tw_lottery_result_url: DEFAULT_HTML_URL,
  tw_lottery_api_latest: DEFAULT_API_URL,
  tw_lottery_api_history_base: DEFAULT_API_URL,
  tw_lottery_history_download_url: '',
  tw_lottery_history_result_url: '',
  tw_lottery_history_url: DEFAULT_API_URL,
  verify_source_enabled: false,
  verify_source_url: '',
  auto_sync_interval_minutes: 30,
  sync_cron: process.env['SYNC_CRON'] || '30 13 * * *',
  pilio: {
    enabled: true,
    baseUrl: 'https://www.pilio.idv.tw/lto539/listbbk.asp?indexpage=1&orderby=new',
    pages: 4,
    mode: 'verifyOnly',
    requestDelayMs: 300,
    timeoutMs: 10000,
  },
};

let _cachedConfig: AppConfig | null = null;
let _dbConfigLoader: (() => Partial<AppConfig>) | null = null;

export function setDbConfigLoader(loader: () => Partial<AppConfig>): void {
  _dbConfigLoader = loader;
  _cachedConfig = null;
}

export function getConfig(): AppConfig {
  if (_cachedConfig) return _cachedConfig;

  const merged = normalizeConfig({
    ...DEFAULTS,
    ...loadFromEnv(),
    ...loadFromFile(),
    ...(_dbConfigLoader ? _dbConfigLoader() : {}),
  });

  _cachedConfig = merged;
  return merged;
}

export function invalidateConfigCache(): void {
  _cachedConfig = null;
}

export function isOfficialApiConfigured(): boolean {
  const cfg = getConfig();
  return !!cfg.officialApiUrl && cfg.officialApiUrl.startsWith('http');
}

export function updateConfig(partial: Partial<AppConfig>): void {
  const configPath = resolveConfigPath();
  const updated = normalizeConfig({ ...getConfig(), ...partial });
  fs.writeFileSync(configPath, JSON.stringify(toFileConfig(updated), null, 2), 'utf-8');
  _cachedConfig = null;
}

function loadFromEnv(): Partial<AppConfig> {
  const result: Partial<AppConfig> = {};

  if (process.env['OFFICIAL_API_URL']) result.officialApiUrl = process.env['OFFICIAL_API_URL'];
  if (process.env['OFFICIAL_API_CANDIDATES']) {
    result.officialApiCandidates = process.env['OFFICIAL_API_CANDIDATES'].split(',').map(s => s.trim()).filter(Boolean);
  }
  if (process.env['OFFICIAL_HTML_URL']) result.officialHtmlUrl = process.env['OFFICIAL_HTML_URL'];
  if (process.env['TW_LOTTERY_RESULT_URL']) {
    result.tw_lottery_result_url = process.env['TW_LOTTERY_RESULT_URL'];
    if (!result.officialHtmlUrl) result.officialHtmlUrl = process.env['TW_LOTTERY_RESULT_URL'];
  }
  if (process.env['OPTIONAL_SECONDARY_SOURCE_URL']) result.optionalSecondarySourceUrl = process.env['OPTIONAL_SECONDARY_SOURCE_URL'];
  if (process.env['SYNC_INTERVAL_MINUTES']) result.syncIntervalMinutes = parseInt(process.env['SYNC_INTERVAL_MINUTES'], 10);
  if (process.env['RECOVERY_RETRY_MINUTES']) result.recoveryRetryMinutes = parseInt(process.env['RECOVERY_RETRY_MINUTES'], 10);
  if (process.env['PILIO_ENABLED'] || process.env['PILIO_BASE_URL'] || process.env['PILIO_PAGES']) {
    result.pilio = {
      ...DEFAULTS.pilio,
      enabled: process.env['PILIO_ENABLED'] ? process.env['PILIO_ENABLED'] === 'true' : DEFAULTS.pilio.enabled,
      baseUrl: process.env['PILIO_BASE_URL'] || DEFAULTS.pilio.baseUrl,
      pages: process.env['PILIO_PAGES'] ? parseInt(process.env['PILIO_PAGES'], 10) : DEFAULTS.pilio.pages,
      mode: process.env['PILIO_MODE'] === 'backup' ? 'backup' : 'verifyOnly',
      requestDelayMs: process.env['PILIO_REQUEST_DELAY_MS'] ? parseInt(process.env['PILIO_REQUEST_DELAY_MS'], 10) : DEFAULTS.pilio.requestDelayMs,
      timeoutMs: process.env['PILIO_TIMEOUT_MS'] ? parseInt(process.env['PILIO_TIMEOUT_MS'], 10) : DEFAULTS.pilio.timeoutMs,
    };
  }

  if (process.env['TW_LOTTERY_API_LATEST']) result.tw_lottery_api_latest = process.env['TW_LOTTERY_API_LATEST'];
  if (process.env['TW_LOTTERY_API_HISTORY_BASE']) {
    result.tw_lottery_api_history_base = process.env['TW_LOTTERY_API_HISTORY_BASE'];
  }
  if (process.env['TW_LOTTERY_HISTORY_DOWNLOAD_URL']) {
    result.tw_lottery_history_download_url = process.env['TW_LOTTERY_HISTORY_DOWNLOAD_URL'];
    result.tw_lottery_history_url = process.env['TW_LOTTERY_HISTORY_DOWNLOAD_URL'];
  }
  if (process.env['TW_LOTTERY_HISTORY_RESULT_URL']) {
    result.tw_lottery_history_result_url = process.env['TW_LOTTERY_HISTORY_RESULT_URL'];
  }
  if (process.env['SYNC_CRON']) result.sync_cron = process.env['SYNC_CRON'];
  if (process.env['AUTO_SYNC_INTERVAL_MINUTES']) {
    result.auto_sync_interval_minutes = parseInt(process.env['AUTO_SYNC_INTERVAL_MINUTES'], 10);
  }

  return result;
}

function loadFromFile(): Partial<AppConfig> {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<AppConfig>;
  } catch (e) {
    console.warn(`[configService] failed to read config.json: ${(e as Error).message}`);
    return {};
  }
}

export function ensureConfigFile(): void {
  const configPath = resolveConfigPath();
  if (fs.existsSync(configPath)) return;
  try {
    fs.writeFileSync(configPath, JSON.stringify(toFileConfig(DEFAULTS), null, 2), 'utf-8');
    console.log(`[configService] created config file: ${configPath}`);
  } catch (e) {
    console.warn(`[configService] failed to create config file: ${(e as Error).message}`);
  }
}

function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  const officialApiUrl = input.officialApiUrl || input.tw_lottery_api_latest || DEFAULT_API_URL;
  const officialApiCandidates = normalizeCandidates(input.officialApiCandidates, officialApiUrl);
  const officialHtmlUrl = input.officialHtmlUrl || input.tw_lottery_result_url || DEFAULT_HTML_URL;
  const syncIntervalMinutes = positiveInt(input.syncIntervalMinutes ?? input.auto_sync_interval_minutes, 30);
  const recoveryRetryMinutes = positiveInt(input.recoveryRetryMinutes, 5);
  const pilioInput = input.pilio ?? DEFAULTS.pilio;
  const pilio = {
    enabled: pilioInput.enabled !== false,
    baseUrl: pilioInput.baseUrl || DEFAULTS.pilio.baseUrl,
    pages: positiveInt(pilioInput.pages, DEFAULTS.pilio.pages),
    mode: pilioInput.mode === 'backup' ? 'backup' as const : 'verifyOnly' as const,
    requestDelayMs: positiveInt(pilioInput.requestDelayMs, DEFAULTS.pilio.requestDelayMs),
    timeoutMs: positiveInt(pilioInput.timeoutMs, DEFAULTS.pilio.timeoutMs),
  };

  return {
    ...DEFAULTS,
    ...input,
    officialApiUrl,
    officialApiCandidates,
    officialHtmlUrl,
    optionalSecondarySourceUrl: input.optionalSecondarySourceUrl || '',
    syncIntervalMinutes,
    recoveryRetryMinutes,
    tw_lottery_result_url: input.tw_lottery_result_url || officialHtmlUrl,
    tw_lottery_api_latest: input.tw_lottery_api_latest || officialApiUrl,
    tw_lottery_api_history_base: input.tw_lottery_api_history_base || officialApiUrl,
    tw_lottery_history_download_url: input.tw_lottery_history_download_url || '',
    tw_lottery_history_result_url: input.tw_lottery_history_result_url || '',
    tw_lottery_history_url: input.tw_lottery_history_url || officialApiUrl,
    auto_sync_interval_minutes: positiveInt(input.auto_sync_interval_minutes ?? syncIntervalMinutes, syncIntervalMinutes),
    pilio,
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeCandidates(value: unknown, activeUrl: string): string[] {
  const raw = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const urls = [activeUrl, ...raw].map(s => s.trim()).filter(s => s.startsWith('http'));
  return [...new Set(urls)];
}

function toFileConfig(config: AppConfig): Pick<AppConfig, 'officialApiUrl' | 'officialApiCandidates' | 'officialHtmlUrl' | 'optionalSecondarySourceUrl' | 'syncIntervalMinutes' | 'recoveryRetryMinutes' | 'pilio'> {
  return {
    officialApiUrl: config.officialApiUrl,
    officialApiCandidates: config.officialApiCandidates,
    officialHtmlUrl: config.officialHtmlUrl,
    optionalSecondarySourceUrl: config.optionalSecondarySourceUrl,
    syncIntervalMinutes: config.syncIntervalMinutes,
    recoveryRetryMinutes: config.recoveryRetryMinutes,
    pilio: config.pilio,
  };
}
