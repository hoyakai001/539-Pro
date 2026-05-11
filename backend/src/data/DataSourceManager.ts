import { getConfig, updateConfig } from '../config/configService';
import {
  fetchLatestFromApi,
  fetchOfficialLatest539Html,
  getOfficialHtmlUrl,
} from './fetchOfficialLatest539';
import type { RawDraw } from './verifyDraw';

export type DataSourceSelectedSource = 'official_api' | 'candidate_api' | 'html_fallback' | 'none';
export type DataSourceAttemptStatus = 'success' | 'failed';

export interface DataSourceAttempt {
  source: DataSourceSelectedSource;
  url: string | null;
  status: DataSourceAttemptStatus;
  error?: string;
}

export interface DataSourceHealth {
  activeApiUrl: string;
  apiAvailable: boolean;
  htmlFallbackAvailable: boolean;
  lastSuccessfulSource: 'api' | 'html' | null;
  activeSource: 'api' | 'candidate' | 'html' | 'none';
  activeSourceUrl: string | null;
  selectedSource: DataSourceSelectedSource;
  selectedUrl: string | null;
  fallbackUsed: boolean;
  attemptedSources: DataSourceAttempt[];
  lastError: string | null;
  pendingOfficial: boolean;
  switchedApiUrl?: string;
}

export interface DataSourceFetchResult {
  success: boolean;
  dataStatus: 'VALID' | 'PENDING_OFFICIAL';
  message?: string;
  data?: RawDraw & { source: string; source_url: string };
  error?: string;
  diagnostic?: string;
  health: DataSourceHealth;
}

let lastHealth: DataSourceHealth = {
  activeApiUrl: getConfig().officialApiUrl,
  apiAvailable: false,
  htmlFallbackAvailable: false,
  lastSuccessfulSource: null,
  activeSource: 'none',
  activeSourceUrl: null,
  selectedSource: 'none',
  selectedUrl: null,
  fallbackUsed: false,
  attemptedSources: [],
  lastError: null,
  pendingOfficial: false,
};

export function getDataSourceHealth(): DataSourceHealth {
  return { ...lastHealth, activeApiUrl: getConfig().officialApiUrl };
}

export class DataSourceManager {
  async fetchLatest(): Promise<DataSourceFetchResult> {
    const cfg = getConfig();
    const diagnostics: string[] = [];
    const attemptedSources: DataSourceAttempt[] = [];
    const candidates = [...new Set([cfg.officialApiUrl, ...cfg.officialApiCandidates].filter(Boolean))];

    for (const url of candidates) {
      const selectedSource: DataSourceSelectedSource = url !== cfg.officialApiUrl ? 'candidate_api' : 'official_api';
      try {
        const draw = await fetchLatestFromApi(url);
        const switchedApiUrl = url !== cfg.officialApiUrl ? url : undefined;
        const activeSource = switchedApiUrl ? 'candidate' : 'api';
        attemptedSources.push({ source: selectedSource, url, status: 'success' });
        if (switchedApiUrl) {
          updateConfig({ officialApiUrl: switchedApiUrl });
          diagnostics.push(`Switched active officialApiUrl to ${switchedApiUrl}`);
        }

        lastHealth = {
          activeApiUrl: url,
          apiAvailable: true,
          htmlFallbackAvailable: false,
          lastSuccessfulSource: 'api',
          activeSource,
          activeSourceUrl: url,
          selectedSource,
          selectedUrl: url,
          fallbackUsed: activeSource !== 'api',
          attemptedSources: [...attemptedSources],
          lastError: null,
          pendingOfficial: false,
          switchedApiUrl,
        };

        return {
          success: true,
          dataStatus: 'VALID',
          data: { ...draw, source: 'official_api', source_url: url },
          diagnostic: diagnostics.join('\n') || undefined,
          health: lastHealth,
        };
      } catch (e) {
        const error = formatError(e);
        attemptedSources.push({ source: selectedSource, url, status: 'failed', error });
        diagnostics.push(`API ${url}: ${error}`);
      }
    }

    const htmlUrl = getOfficialHtmlUrl();
    try {
      const htmlResult = await fetchOfficialLatest539Html(htmlUrl);
      attemptedSources.push({ source: 'html_fallback', url: htmlUrl, status: 'success' });
      lastHealth = {
        activeApiUrl: getConfig().officialApiUrl,
        apiAvailable: false,
        htmlFallbackAvailable: true,
        lastSuccessfulSource: 'html',
        activeSource: 'html',
        activeSourceUrl: htmlUrl,
        selectedSource: 'html_fallback',
        selectedUrl: htmlUrl,
        fallbackUsed: true,
        attemptedSources: [...attemptedSources],
        lastError: diagnostics.join('\n') || null,
        pendingOfficial: false,
      };

      return {
        ...htmlResult,
        diagnostic: diagnostics.join('\n') || htmlResult.diagnostic,
        health: lastHealth,
      };
    } catch (e) {
      const error = formatError(e);
      attemptedSources.push({ source: 'html_fallback', url: htmlUrl, status: 'failed', error });
      diagnostics.push(`HTML ${htmlUrl}: ${error}`);
    }

    lastHealth = {
      activeApiUrl: getConfig().officialApiUrl,
      apiAvailable: false,
      htmlFallbackAvailable: false,
      lastSuccessfulSource: null,
      activeSource: 'none',
      activeSourceUrl: null,
      selectedSource: 'none',
      selectedUrl: null,
      fallbackUsed: true,
      attemptedSources: [...attemptedSources],
      lastError: diagnostics.join('\n'),
      pendingOfficial: true,
    };

    return {
      success: false,
      dataStatus: 'PENDING_OFFICIAL',
      message: '官方資料暫時無法確認',
      error: '官方資料暫時無法確認',
      diagnostic: diagnostics.join('\n'),
      health: lastHealth,
    };
  }
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
