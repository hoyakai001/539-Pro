import express, { Router, Response, Request, NextFunction } from 'express';
import {
  getLatestDraw,
  getPreviousDraw,
  getDrawByNo,
  getDraws,
  getLatestBacktests,
  getLatestPrediction,
  getLockedPrediction,
  savePrediction,
  saveBacktest,
  getNextPredictionVersion,
  getRecentSyncLogs,
  getStrategyObservationLogs,
  getStrategyObservationStatus,
  setAppConfigValue,
  saveStrategyObservationLog,
  getAppConfigValue,
  getStrategyWeights,
  getDB,
  insertSyncLog,
  finishSyncLog,
} from '../db/database';
import { checkDataFreshness, getTodayDrawStatus, MIN_DATA } from '../guards/dataGuards';
import { fullHistorySync } from '../data/syncDraws';
import { runManagedSync } from '../data/syncRecoveryManager';
import { cloudSyncNow, writeCloudSyncLog } from '../data/cloudSync';
import { runBacktest } from '../backtest/walkForwardBacktest';
import { buildStatisticalPrediction, HISTORICAL_MODEL_VERSION, PREDICTION_CACHE_SCHEMA } from '../engine/statisticalPrediction';
import { resolvePredictionTarget } from '../engine/PredictionTargetService';
import { getNumberAnalysis, runAdvancedBacktest, runThreeStarMainBacktest, toNumberAnalysisSummary, type AdvancedBacktestResult, type PreviousPredictionContext } from '../engine/AdvancedStatsModel';
import { getConfig, invalidateConfigCache, updateConfig } from '../config/configService';
import { getPathSummary } from '../config/pathResolver';
import type { DrawEntry } from '../engine/features';
import { getOfficialHtmlUrl } from '../data/fetchOfficialLatest539';
import { todayIso, toDisplayDate, normalizeDrawDate } from '../data/dateUtils';
import { comboKey, sortNumbers } from '../utils/numbers';
import { computeHistoryStats, computeTwoStarStats, getTwoStarStat, rowsToStatEntries } from '../stats/historicalStats';
import { buildComboSupportSummary, isComboSupportSummaryComplete, type ComboSupportPredictionInput } from '../stats/comboSupport';
import { runHistoryAudit, getLatestHistoryAudit } from '../data/historyAudit';
import { fetchPilio539 } from '../data/fetchPilio539';
import { computeStrategyPerformance } from '../engine/strategyPerformance';
import { getDatabaseAdapter, isCloudMode, type AdapterDraw, type AdapterObservation } from '../db/adapters';
import { getFirestoreDb } from '../db/adapters/firestoreClient';
import { isCloudReadonly, CLOUD_READONLY_BLOCKED, isCloudReadonlyError } from '../db/adapters/readonlyGuard';
import { bootstrapCloudHistory } from '../data/cloudBootstrapHistory';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function readonlyMutationGuard(operation: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (isCloudReadonly()) {
      console.warn(`[CLOUD_READONLY] blocked route: ${operation}`);
      res.status(403).json({
        success: false,
        code: CLOUD_READONLY_BLOCKED,
        error: CLOUD_READONLY_BLOCKED,
        message: `CLOUD_READONLY_MODE: write operation blocked (${operation})`,
        operation,
      });
      return;
    }
    next();
  };
}

export function setupRoutes(app: ReturnType<typeof express>): void {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      node: process.version,
      cloud_readonly: isCloudReadonly(),
      ...getPathSummary(),
    });
  });

  router.get('/docs/strategy', (_req, res) => sendMarkdownDoc(res, 'STRATEGY_FULL.md'));
  router.get('/docs/cloud-deploy', (_req, res) => sendMarkdownDoc(res, 'CLOUD_DEPLOY_FIREBASE_VERCEL.md'));

  router.get('/latest-draw', async (_req, res) => {
    if (isCloudMode()) return cloudLatestDraw(res);
    return respond(res, () => {
    const draw = getLatestDraw();
    return draw ? { success: true, data: serializeDraw(draw) } : { success: false, data: null, error: 'no draw data' };
    });
  });

  router.get('/previous-draw', async (_req, res) => {
    if (isCloudMode()) return cloudPreviousDraw(res);
    return respond(res, () => {
    const draw = getPreviousDraw();
    return draw ? { success: true, data: serializeDraw(draw) } : { success: false, data: null, error: 'no previous draw data' };
    });
  });

  router.get('/data/status', async (_req, res) => {
    if (isCloudMode()) return cloudDataStatus(res);
    return respond(res, () => {
    const report = checkDataFreshness();
    const audit = getLatestHistoryAudit();
    return {
      success: true,
      data: {
        ...report,
        dataStatus: report,
        todayDraw: getTodayDrawStatus(),
        official_source_url: getOfficialHtmlUrl(),
        history_audit_status: audit?.status ?? 'WARN',
        history_audit_checked_at: audit?.checked_at ?? null,
      },
    };
    });
  });

  router.get('/prediction/today', async (_req, res) => {
    if (isCloudMode()) return cloudPredictionToday(res, false);
    return respond(res, () => predictionToday(false));
  });
  router.post('/prediction/regenerate', readonlyMutationGuard('prediction.regenerate'), (_req, res) => respond(res, () => predictionToday(true)));

  router.get('/backtest/summary', (_req, res) => respond(res, () => ({ success: true, data: getLatestBacktests().filter(b => [30, 60, 100].includes(b.window_size)) })));
  router.post('/backtest/advanced', readonlyMutationGuard('backtest.advanced'), (_req, res) => respond(res, runAdvancedBacktestHandler));
  router.post('/backtest/three-star-main', readonlyMutationGuard('backtest.three-star-main'), (_req, res) => respond(res, runThreeStarMainBacktestHandler));
  router.get('/strategy-weights', (_req, res) => respond(res, () => ({ success: true, data: getStrategyWeights() })));
  router.get('/strategy/observation', (req, res) => respond(res, () => {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '30'), 10), 100);
    const status = getStrategyObservationStatus(HISTORICAL_MODEL_VERSION, 30);
    return {
      success: true,
      data: {
        ...status,
        logs: getStrategyObservationLogs(limit, HISTORICAL_MODEL_VERSION).map(serializeObservationLog),
      },
    };
  }));
  router.get('/strategy/performance', async (req, res) => {
    try {
      const window = Math.min(Math.max(parseInt(String(req.query['window'] ?? '30'), 10), 1), 100);
      if (isCloudMode()) return cloudPerformance(window, res);
      const adapter = getDatabaseAdapter();
      const stats = await adapter.getStats(Math.max(window, 60));
      res.json({ success: true, data: computeStrategyPerformance(stats.observations, window) });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // ─── Observation endpoints (Production Integration Final Phase) ─────────────
  // Read-only; works in both local SQLite and cloud Firestore.
  // The underlying observation_logs are upserted by cloudSync.evaluatePredictionForDraw()
  // ONLY after a new draw arrives + a cached prediction exists for that draw. So:
  //   - Firestore writes are bounded (≤ 1 per day, single upsert by target_draw_no_model_version)
  //   - cloud-readonly remains safe (saveObservation calls assertWritable)
  router.get('/observations/status', async (req, res) => {
    try {
      const window = Math.min(Math.max(parseInt(String(req.query['window'] ?? '30'), 10), 1), 100);
      const adapter = getDatabaseAdapter();
      const observations = await adapter.getObservations(window);
      res.json({ success: true, data: summarizeObservations(observations, window) });
    } catch (e) {
      sendApiError(res, e);
    }
  });
  router.get('/observations/recent', async (req, res) => {
    try {
      const rawWindow = parseInt(String(req.query['window'] ?? '20'), 10);
      const window = Math.min(Math.max(Number.isFinite(rawWindow) ? rawWindow : 20, 1), 100);
      const adapter = getDatabaseAdapter();
      const observations = await adapter.getObservations(window);
      res.json({ success: true, data: { window, count: observations.length, observations } });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  router.post('/sync-now', readonlyMutationGuard('sync-now'), async (req, res) => {
    const adminToken = adminTokenFromRequest(req);
    if (!isAdmin(adminToken)) {
      return res.status(401).json({
        success: false,
        code: 'ADMIN_AUTH_REQUIRED',
        error: 'ADMIN_AUTH_REQUIRED',
        message: '管理員登入已失效，請重新登入後再同步',
      });
    }
    try {
      if (isCloudMode()) return cloudAdminSync(adminToken, res);
      res.json({ success: true, data: await runManagedSync('sync-now') });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  router.post('/sync-history', readonlyMutationGuard('sync-history'), async (_req, res) => {
    try {
      res.json({ success: true, data: await fullHistorySync() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  router.post('/run-backtest', readonlyMutationGuard('run-backtest'), (_req, res) => respond(res, runBacktestHandler));
  router.all('/cron/sync', readonlyMutationGuard('cron-sync'), async (req, res) => {
    const auth = cronAuthStatus(req);
    if (!auth.authorized) {
      await writeCronSyncFailureLog('unauthorized', auth.reason, 'unauthorized_cron');
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED_CRON', error: 'unauthorized_cron', reason: auth.reason });
    }
    try {
      const data = isCloudMode() ? await cloudSyncNow({ type: 'cron-sync' }) : await runManagedSync('cron-sync');
      res.json({ success: true, data });
    } catch (e) {
      await writeCronSyncFailureLog('failed', (e as Error).message, 'cron_sync_failed');
      sendApiError(res, e);
    }
  });

  router.post('/train', (_req, res) => {
    res.json({ success: false, error: 'Auto tuning is disabled. This system uses fixed historical statistics and walk-forward backtests only.' });
  });

  router.get('/sync-logs', (req, res) => {
    if (!isAdmin(adminTokenFromRequest(req))) return res.status(401).json({ success: false, error: 'admin token required' });
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10), isCloudMode() ? 50 : 100);
    if (isCloudMode()) return cloudSyncLogs(limit, res);
    return res.json({ success: true, data: getRecentSyncLogs(limit) });
  });
  router.get('/admin/status', (req, res) => {
    void adminStatusHandler(adminTokenFromRequest(req))
      .then(data => res.json(data))
      .catch(e => res.status(500).json({ success: false, error: (e as Error).message }));
  });

  router.post('/admin/setup', readonlyMutationGuard('admin.setup'), (req, res) => {
    void adminSetupHandler(req.body as Record<string, unknown>)
      .then(data => res.status(data.status).json(data.body))
      .catch(e => res.status(500).json({ success: false, error: (e as Error).message }));
  });

  router.post('/admin/login', (req, res) => {
    void adminLoginHandler(req.body as Record<string, unknown>)
      .then(data => res.status(data.status).json(data.body))
      .catch(e => res.status(500).json({ success: false, error: (e as Error).message }));
  });

  router.post('/admin/reset', readonlyMutationGuard('admin.reset'), (req, res) => {
    void adminResetHandler(req.body as Record<string, unknown>)
      .then(data => res.status(data.status).json(data.body))
      .catch(e => res.status(500).json({ success: false, error: (e as Error).message }));
  });

  router.post('/admin/bootstrap-history', readonlyMutationGuard('admin.bootstrap-history'), (req, res) => {
    void adminBootstrapHistoryHandler(adminTokenFromRequest(req), req.body as Record<string, unknown>, req.query as Record<string, string>)
      .then(data => res.status(data.status).json(data.body))
      .catch(e => res.status(500).json({ success: false, error: (e as Error).message }));
  });

  router.post('/admin/logout', (req, res) => {
    const token = adminTokenFromRequest(req);
    if (token) adminTokens.delete(token);
    return res.json({ success: true });
  });

  router.get('/config', (_req, res) => respond(res, () => ({ success: true, data: { ...getConfig(), dataSourceHealth: checkDataFreshness() } })));

  router.post('/config', readonlyMutationGuard('config.update'), (req, res) => respond(res, () => {
    const body = req.body as Record<string, unknown>;
    const allowed = [
      'officialApiUrl', 'officialApiCandidates', 'officialHtmlUrl',
      'optionalSecondarySourceUrl', 'syncIntervalMinutes', 'recoveryRetryMinutes',
      'tw_lottery_api_latest', 'tw_lottery_history_url',
      'verify_source_enabled', 'verify_source_url',
      'auto_sync_interval_minutes', 'sync_cron', 'pilio',
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) setAppConfigValue(key, typeof body[key] === 'object' ? JSON.stringify(body[key]) : String(body[key]));
    }
    updateConfig(body as Partial<ReturnType<typeof getConfig>>);
    invalidateConfigCache();
    return { success: true, message: 'config saved' };
  }));

  router.get('/draws', (req, res) => respond(res, () => {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10), 200);
    return { success: true, data: getDraws(limit).map(serializeDraw) };
  }));

  router.get('/history/draws', async (req, res) => {
    if (isCloudMode()) return cloudHistoryDraws(req.query as Record<string, string>, res);
    return respond(res, () => queryHistoryDraws(req.query as Record<string, string>));
  });
  router.get('/history/stats', (_req, res) => respond(res, () => ({ success: true, data: computeHistoryStats(rowsToStatEntries(getDraws()).slice(0, 100)) })));
  router.get('/stats/number-analysis', async (req, res) => {
    if (isCloudMode()) return cloudNumberAnalysis(req.query as Record<string, string>, res);
    return respond(res, () => numberAnalysis(req.query as Record<string, string>));
  });
  router.get('/stats/two-star', (req, res) => respond(res, () => twoStarStats(req.query as Record<string, string>)));
  router.post('/history/audit', readonlyMutationGuard('history.audit'), async (_req, res) => {
    try {
      res.json({ success: true, data: await runHistoryAudit() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });
  router.get('/history/audit/latest', (_req, res) => respond(res, () => ({ success: true, data: getLatestHistoryAudit() })));
  router.post('/pilio/verify', async (_req, res) => {
    try {
      res.json({ success: true, data: await verifyPilioAgainstDb() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  app.use('/api', router);
}

const adminTokens = new Map<string, number>();
const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;

async function adminStatusHandler(headerValue: unknown) {
  return {
    success: true,
    setup_required: !(await getStoredAdminHashAsync()),
    authenticated: isAdmin(headerValue),
    expires_in_minutes: getAdminRemainingMinutes(headerValue),
  };
}

async function adminSetupHandler(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  if (await getStoredAdminHashAsync()) return { status: 409, body: { success: false, error: 'admin password already configured' } };
  const password = String(body['password'] ?? '');
  if (password.length < 8) return { status: 400, body: { success: false, error: 'password must be at least 8 characters' } };
  await setStoredAdminHashAsync(hashAdminPassword(password));
  return { status: 200, body: { success: true, message: 'admin password configured' } };
}

async function adminLoginHandler(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const password = String(body['password'] ?? '');
  if (!(await checkAdminPassword(password))) return { status: 401, body: { success: false, error: '管理員密碼錯誤' } };
  const token = createAdminSessionToken();
  adminTokens.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return { status: 200, body: { success: true, token, expires_in_minutes: 30 } };
}

async function adminResetHandler(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const expected = process.env['ADMIN_RESET_TOKEN'] ?? '';
  if (!expected) return { status: 503, body: { success: false, error: 'ADMIN_RESET_TOKEN is not configured' } };
  if (String(body['reset_token'] ?? '') !== expected) return { status: 401, body: { success: false, error: 'reset token 錯誤' } };
  const password = String(body['new_password'] ?? '');
  if (password.length < 8) return { status: 400, body: { success: false, error: 'new_password must be at least 8 characters' } };
  await setStoredAdminHashAsync(hashAdminPassword(password));
  adminTokens.clear();
  return { status: 200, body: { success: true, message: '管理員密碼已重設' } };
}

async function adminBootstrapHistoryHandler(
  headerValue: unknown,
  body: Record<string, unknown>,
  query: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const expected = process.env['ADMIN_RESET_TOKEN'] ?? '';
  const provided = String(body['reset_token'] ?? query['reset_token'] ?? '').trim();
  if (!isAdmin(headerValue) && (!expected || provided !== expected)) {
    return { status: 401, body: { success: false, error: 'admin token or reset token required' } };
  }
  const minDraws = Math.min(500, Math.max(100, parseInt(String(body['min_draws'] ?? query['min_draws'] ?? '100'), 10) || 100));
  const data = await bootstrapCloudHistory(minDraws);
  return { status: 200, body: { success: true, data } };
}

async function checkAdminPassword(password: string): Promise<boolean> {
  const configuredHash = await getStoredAdminHashAsync();
  if (!configuredHash) return false;
  const [scheme, salt, expected] = configuredHash.split('$');
  if (scheme === 'sha256' && salt && expected) {
    const actual = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
    return timingSafeEqual(actual, expected);
  }
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return timingSafeEqual(legacyHash, configuredHash);
}

function isAdmin(headerValue: unknown): boolean {
  const token = tokenFromHeader(headerValue);
  const expires = adminTokens.get(token);
  if (expires && expires >= Date.now()) return true;
  if (expires && expires < Date.now()) {
    if (token) adminTokens.delete(token);
  }
  return verifySignedAdminSessionToken(token);
}

async function getStoredAdminHashAsync(): Promise<string> {
  if (isCloudMode()) {
    const adapter = getDatabaseAdapter();
    if ('getAdminPasswordHash' in adapter) {
      return (await (adapter as { getAdminPasswordHash(): Promise<string | null> }).getAdminPasswordHash()) || process.env['ADMIN_PASSWORD_HASH'] || '';
    }
  }
  return getAppConfigValue('admin_password_hash') || process.env['ADMIN_PASSWORD_HASH'] || '';
}

async function setStoredAdminHashAsync(hash: string): Promise<void> {
  if (isCloudMode()) {
    const adapter = getDatabaseAdapter();
    if ('setAdminPasswordHash' in adapter) {
      await (adapter as { setAdminPasswordHash(hash: string): Promise<void> }).setAdminPasswordHash(hash);
      return;
    }
  }
  setAppConfigValue('admin_password_hash', hash);
}

function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `sha256$${salt}$${hash}`;
}

function adminTokenFromRequest(req: Request): string {
  return tokenFromHeader(req.headers['x-admin-token']) || bearerToken(req.headers['authorization']);
}

function tokenFromHeader(headerValue: unknown): string {
  const value = Array.isArray(headerValue) ? String(headerValue[0] ?? '') : String(headerValue ?? '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value.trim();
}

function bearerToken(headerValue: unknown): string {
  const value = Array.isArray(headerValue) ? String(headerValue[0] ?? '') : String(headerValue ?? '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function cronAuthStatus(req: Request): { authorized: boolean; reason: string } {
  const expected = process.env['CRON_SECRET'] ?? '';
  const provided = String(req.headers['x-cron-secret'] ?? '').trim()
    || String(req.query['secret'] ?? '').trim()
    || String((req.body as Record<string, unknown> | undefined)?.['secret'] ?? '').trim()
    || bearerToken(req.headers['authorization']);
  if (provided && expected && provided === expected) return { authorized: true, reason: 'secret_matched' };
  if (!provided && isVercelCronRequest(req)) return { authorized: true, reason: 'vercel_cron' };
  if (!expected) return { authorized: false, reason: 'missing_cron_secret' };
  return { authorized: false, reason: 'invalid_cron_secret' };
}

function isVercelCronRequest(req: Request): boolean {
  const userAgent = String(req.headers['user-agent'] ?? '').toLowerCase();
  return userAgent.includes('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
}

async function writeCronSyncFailureLog(
  status: 'unauthorized' | 'failed',
  errorMessage: string,
  reason: 'unauthorized_cron' | 'cron_sync_failed',
): Promise<void> {
  const now = new Date().toISOString();
  if (isCloudMode()) {
    await writeCloudSyncLog({
      type: 'cron-sync',
      status,
      source: 'cron',
      source_url: null,
      selected_source: 'none',
      selected_url: null,
      fallback_used: false,
      attempted_sources: [],
      inserted: 0,
      retry: 0,
      error_message: errorMessage,
      reason,
      started_at: now,
      finished_at: now,
    });
    return;
  }

  const latest = getLatestDraw();
  const logId = insertSyncLog({
    started_at: now,
    latest_draw_no_before: latest?.draw_no ?? null,
    type: 'cron-sync',
  });
  finishSyncLog(logId, {
    finished_at: now,
    status: 'failed',
    active_source: 'cron',
    source_url: null,
    latest_draw_no_after: latest?.draw_no ?? null,
    new_draws_inserted: 0,
    message: `${reason}: ${errorMessage}`,
    diagnostic: null,
    error_stack: errorMessage,
  });
}

function getAdminRemainingMinutes(headerValue: unknown): number | null {
  const token = tokenFromHeader(headerValue);
  const expires = adminTokens.get(token) ?? signedAdminSessionExpiry(token);
  if (!expires || expires < Date.now()) return null;
  return Math.ceil((expires - Date.now()) / 60000);
}

function createAdminSessionToken(): string {
  const secret = adminSessionSecret();
  if (!secret) return crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp: expires }), 'utf8').toString('base64url');
  const signature = signAdminPayload(payload, secret);
  return `v1.${payload}.${signature}`;
}

function verifySignedAdminSessionToken(token: string): boolean {
  const expires = signedAdminSessionExpiry(token);
  return Boolean(expires && expires >= Date.now());
}

function signedAdminSessionExpiry(token: string): number | null {
  const secret = adminSessionSecret();
  if (!secret || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload, signature] = parts;
  const expected = signAdminPayload(payload, secret);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : null;
  } catch {
    return null;
  }
}

function signAdminPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function adminSessionSecret(): string {
  return process.env['ADMIN_SESSION_SECRET'] || process.env['ADMIN_RESET_TOKEN'] || process.env['ADMIN_PASSWORD_HASH'] || '';
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function predictionToday(regenerate: boolean) {
  const freshness = checkDataFreshness();
  if (!freshness.can_predict) {
    return { success: false, data: null, dataStatus: freshness.status, reason: freshness.cannot_predict_reason ?? freshness.reason };
  }
  const audit = getLatestHistoryAudit();
  if (audit?.status === 'FAIL') return { success: false, data: null, dataStatus: 'CONFLICT', reason: 'history audit failed' };

  const target = resolvePredictionTarget();
  const cached = getLockedPrediction({
    target_date: target.target_date,
    target_draw_no: target.target_draw_no,
    latest_used_draw_no: target.latest_used_draw_no,
    model_version: HISTORICAL_MODEL_VERSION,
  });
  if (cached && !regenerate) {
    const parsed = parsePredictionRow(cached);
    if (isPredictionPayloadCurrent(parsed as Record<string, unknown>, target.latest_used_draw_no, target.target_draw_no)) {
      recordStrategyObservation(parsed, cached.id);
      const data = serializePrediction(withComboSupport(parsed, getDraws(30).map(toDrawEntry)));
      return {
        success: true,
        cached: true,
        locked: cached.locked === 1,
        data: {
          ...data,
          observation_status: getStrategyObservationStatus(HISTORICAL_MODEL_VERSION, 30),
        },
      };
    }
  }

  const rows = getDraws().filter(d =>
    d.draw_date < target.latest_used_draw_date ||
    (d.draw_date === target.latest_used_draw_date && d.draw_no <= target.latest_used_draw_no)
  );
  if (rows.some(d => target.target_draw_no && d.draw_no === target.target_draw_no)) {
    return { success: false, data: null, dataStatus: 'INVALID', reason: 'prediction training data includes target draw' };
  }
  if (rows.length < MIN_DATA.PREDICT) return { success: false, data: null, dataStatus: 'INVALID', reason: `at least ${MIN_DATA.PREDICT} verified draws are required` };
  const trainingEntries = rows.map(toDrawEntry);
  const previousPrediction = getPreviousPredictionContext();
  const prediction = {
    ...buildStatisticalPrediction(trainingEntries, target.target_date, getLatestBacktests(), getCachedAdvancedDecision(trainingEntries), previousPrediction),
    target_draw_no: target.target_draw_no,
  };
  const version = getNextPredictionVersion(target.target_date);
  const id = savePrediction({
    target_date: prediction.target_date,
    target_draw_no: prediction.target_draw_no ?? null,
    latest_used_draw_no: prediction.latest_used_draw_no,
    latest_used_draw_date: prediction.latest_used_draw_date,
    single_number: prediction.single_number,
    numbers_json: JSON.stringify(prediction.numbers),
    two_star_json: JSON.stringify(prediction.two_star),
    three_star_json: JSON.stringify(prediction.three_star),
    four_star_json: JSON.stringify(prediction.four_star),
    five_star_json: JSON.stringify(prediction.five_star),
    number_scores_json: JSON.stringify(prediction.number_scores),
    strategy_scores_json: JSON.stringify({ ...prediction.strategy_scores, balance_summary: prediction.balance_summary }),
    bet_advice_json: JSON.stringify(prediction.bet_advice),
    scores_json: JSON.stringify({
      number_scores: prediction.number_scores,
      balance_summary: prediction.balance_summary,
      hot_control_summary: prediction.hot_control_summary,
      combination_repeat_summary: prediction.combination_repeat_summary,
      miss_penalty_summary: prediction.miss_penalty_summary,
      draw_profile: prediction.draw_profile,
      three_star_summary: prediction.three_star_summary,
      tracking_summary: prediction.tracking_summary,
      anti_hot_selection_penalty_summary: prediction.anti_hot_selection_penalty_summary,
    }),
    strategy: prediction.strategy,
    model_version: prediction.model_version,
    version,
    locked: 1,
    confidence_label: prediction.confidence_label,
    recommendation: prediction.recommendation,
    data_status: 'VALID',
  });
  recordStrategyObservation(prediction, id);
  return {
    success: true,
    cached: false,
    locked: true,
    data: serializePrediction(withComboSupport({
      ...prediction,
      id,
      prediction_id: id,
      locked: true,
      cached: false,
      version,
      observation_status: getStrategyObservationStatus(HISTORICAL_MODEL_VERSION, 30),
    }, trainingEntries)),
  };
}

function recordStrategyObservation(prediction: {
  id?: number;
  prediction_id?: number;
  model_version?: string | null;
  target_draw_no?: string | null;
  target_date: string;
  single_number?: number | null;
  two_star?: number[] | null;
  three_star?: number[] | null;
  four_star?: number[] | null;
  five_star?: number[] | null;
  bet_advice?: { level?: string; label?: string; confidence?: string } | null;
  confidence_label?: string | null;
  draw_profile?: { label?: string } | null;
}, predictionId: number): void {
  if (!prediction.model_version || !prediction.two_star || !prediction.three_star || !prediction.four_star || !prediction.five_star) return;
  saveStrategyObservationLog({
    prediction_id: predictionId,
    model_version: prediction.model_version,
    target_draw_no: prediction.target_draw_no ?? null,
    target_date: prediction.target_date,
    selected_single: prediction.single_number ?? 0,
    selected_two_star: prediction.two_star,
    selected_three_star: prediction.three_star,
    selected_four_star: prediction.four_star,
    selected_five_star: prediction.five_star,
    advice_level: prediction.bet_advice?.level ?? null,
    advice_label: prediction.bet_advice?.label ?? '',
    confidence: prediction.bet_advice?.confidence ?? prediction.confidence_label ?? '',
    draw_profile: prediction.draw_profile?.label ?? '',
  });
}

async function cloudLatestDraw(res: Response): Promise<void> {
  try {
    const cached = await getCloudCache<{ data?: unknown }>('latest_draw');
    if (cached?.data) {
      res.json({ success: true, data: cached.data, read_estimate: { draws_read: 0, cache_hit: true, cache_read: 1 } });
      return;
    }
    const latest = await getDatabaseAdapter().getLatestDraw();
    if (latest) await setCloudCache('latest_draw', { latest_draw_no: latest.draw_no, latest_draw_date: latest.draw_date, data: serializeAdapterDraw(latest) });
    res.json(latest ? { success: true, data: serializeAdapterDraw(latest), read_estimate: { draws_read: 1, cache_hit: false, cache_read: 1 } } : { success: false, data: null, error: 'no draw data' });
  } catch (e) {
    sendApiError(res, e);
  }
}

async function cloudPreviousDraw(res: Response): Promise<void> {
  try {
    const rows = await getDatabaseAdapter().getDraws(2);
    const previous = rows[1] ?? null;
    res.json(previous ? { success: true, data: serializeAdapterDraw(previous) } : { success: false, data: null, error: 'no previous draw data' });
  } catch (e) {
    sendApiError(res, e);
  }
}

async function cloudDataStatus(res: Response): Promise<void> {
  try {
    const latestCache = await getCloudCache<{ latest_draw_no?: string }>('latest_draw');
    const cached = await getCloudCache<{ latest_draw_no?: string; data?: unknown }>('data_status');
    if (cached?.data && (!latestCache?.latest_draw_no || cached.latest_draw_no === latestCache.latest_draw_no)) {
      res.json({ success: true, data: cached.data, read_estimate: { draws_read: 0, cache_hit: true, cache_read: 2 } });
      return;
    }
    const rows = await getDatabaseAdapter().getDraws(100);
    const latest = rows[0] ?? null;
    const previous = rows[1] ?? null;
    const canPredict = rows.length >= 100;
    const today = todayIso();
    const payload = {
      success: true,
      data: {
        dataStatus: {
          mode: isCloudReadonly() ? 'cloud_readonly' : 'cloud',
          cloud_readonly: isCloudReadonly(),
          database_path: 'firestore',
          config_path: 'environment',
          status: canPredict ? 'VALID' : 'INVALID',
          reason: canPredict ? '資料完整有效' : 'Firestore verified draws are fewer than 100',
          can_predict: canPredict,
          cannot_predict_reason: canPredict ? null : 'at least 100 verified draws are required',
          latest_draw_no: latest?.draw_no ?? null,
          latest_draw_date: latest ? toDisplayDate(latest.draw_date) : null,
          latest_numbers: latest?.numbers ?? null,
          previous_draw_no: previous?.draw_no ?? null,
          previous_draw_date: previous ? toDisplayDate(previous.draw_date) : null,
          previous_numbers: previous?.numbers ?? null,
          today_date: toDisplayDate(today),
          today_draw_status: latest?.draw_date === today ? 'DRAWN' : 'NOT_DRAWN',
          today_numbers: latest?.draw_date === today ? latest.numbers : null,
          latest_used_draw_no: latest?.draw_no ?? null,
          latest_used_draw_date: latest ? toDisplayDate(latest.draw_date) : null,
          draw_count: rows.length,
          totalDraws: rows.length,
          minimum_data_met: canPredict,
          min_data_mode: canPredict ? 'OBSERVATION' : 'INSUFFICIENT',
          data_continuous: true,
          history_incomplete: rows.length < 100,
          missing_periods_count: 0,
          missingPeriods: [],
          last_sync_time: null,
          last_sync_status: null,
          next_sync_time: null,
          retry_active: false,
          retry_count: 0,
          retry_stage: null,
          recovery_mode: false,
          active_source: 'firestore',
          active_source_url: null,
          last_error_message: null,
          last_diagnostic: null,
          official_api_configured: true,
          official_html_url: getOfficialHtmlUrl(),
          active_api_url: getConfig().officialApiUrl,
          pending_official: false,
          latestDrawNo: latest?.draw_no ?? null,
          latestDrawDate: latest ? toDisplayDate(latest.draw_date) : null,
          canPredict,
          read_estimate: { draws_read: rows.length, cache_hit: false, cache_read: 2 },
        },
        todayDraw: {
          todayDate: toDisplayDate(today),
          isDrawn: latest?.draw_date === today,
          todayDrawNo: latest?.draw_date === today ? latest.draw_no : null,
          todayNumbers: latest?.draw_date === today ? latest.numbers : null,
          previousDrawNo: previous?.draw_no ?? null,
          previousDrawDate: previous ? toDisplayDate(previous.draw_date) : null,
          previousNumbers: previous?.numbers ?? null,
        },
        official_source_url: getOfficialHtmlUrl(),
        history_audit_status: 'WARN',
        history_audit_checked_at: null,
      },
    };
    if (latest) {
      await setCloudCache('latest_draw', { latest_draw_no: latest.draw_no, latest_draw_date: latest.draw_date, data: serializeAdapterDraw(latest) });
      await setCloudCache('data_status', { latest_draw_no: latest.draw_no, data: payload.data });
    }
    res.json({ ...payload, read_estimate: { draws_read: rows.length, cache_hit: false, cache_read: 2 } });
  } catch (e) {
    sendApiError(res, e);
  }
}

async function cloudPredictionToday(res: Response, regenerate: boolean): Promise<void> {
  try {
    const adapter = getDatabaseAdapter();
    const latestCache = await getCloudCache<{ latest_draw_no?: string }>('latest_draw');
    const predictionCache = await getCloudCache<{ latest_draw_no?: string; target_draw_no?: string | null; updated_at?: string; data?: unknown }>('prediction_today');
    if (!regenerate && isPredictionTodayCacheValid(predictionCache, latestCache?.latest_draw_no)) {
      const validPredictionCache = predictionCache as { latest_draw_no?: string; target_draw_no?: string | null; updated_at?: string; data: unknown };
      let data = withPredictionCacheMeta(validPredictionCache.data as Record<string, unknown>, true, validPredictionCache.updated_at, latestCache?.latest_draw_no ?? null);
      let drawsRead = 0;
      if (!isComboSupportSummaryComplete(data['combo_support_summary'])) {
        const supportRows = await adapter.getDraws(30);
        drawsRead = supportRows.length;
        data = withComboSupport(data as ComboSupportPredictionInput & Record<string, unknown>, supportRows.map(adapterDrawToEntry));
        await setCloudCache('prediction_today', { latest_draw_no: latestCache?.latest_draw_no, target_draw_no: data['target_draw_no'] ?? null, data });
      }
      res.json({ success: true, cached: true, locked: true, data, read_estimate: { draws_read: drawsRead, cache_hit: true, cache_read: 2 } });
      return;
    }
    const rows = await adapter.getDraws(120);
    if (rows.length < 100) {
      res.json({ success: false, data: null, dataStatus: 'INVALID', reason: 'at least 100 verified draws are required' });
      return;
    }
    await setCloudCache('latest_draw', { latest_draw_no: rows[0].draw_no, latest_draw_date: rows[0].draw_date, data: serializeAdapterDraw(rows[0]) });
    const target = resolveCloudPredictionTarget(rows[0]);
    const cached = !regenerate && target.target_draw_no ? await adapter.getPredictionByDrawNo(target.target_draw_no) : null;
    if (cached && isPredictionPayloadCurrent(cached as Record<string, unknown>, rows[0].draw_no, target.target_draw_no)) {
      const entries = rows.map(adapterDrawToEntry);
      const data = serializePrediction({
        ...withComboSupport(cached as ComboSupportPredictionInput & Record<string, unknown>, entries),
        prediction_id: cached.id,
        single_number: Number(cached.single_number ?? cached.single ?? 0),
        number_scores: cached['number_scores'] ?? cached['number_scores_json'] ?? [],
        strategy_scores: cached['strategy_scores'] ?? {},
        confidence_label: String(cached.bet_advice?.confidence ?? cached.confidence ?? ''),
        recommendation: String(cached.bet_advice?.label ?? ''),
        data_status: 'VALID',
      } as any);
      const cachedData = withPredictionCacheMeta(data as Record<string, unknown>, true, new Date().toISOString(), rows[0].draw_no);
      await setCloudCache('prediction_today', { latest_draw_no: rows[0].draw_no, target_draw_no: target.target_draw_no, data: cachedData });
      res.json({ success: true, cached: true, locked: true, data: cachedData, read_estimate: { draws_read: rows.length, cache_hit: false, cache_read: 2 } });
      return;
    }
    const entries = rows.map(adapterDrawToEntry);
    const recentObservations = await adapter.getObservations(12);
    const previousPrediction = buildCloudPreviousPredictionContext(recentObservations);
    const prediction = {
      ...buildStatisticalPrediction(entries, target.target_date, [], undefined, previousPrediction),
      target_draw_no: target.target_draw_no,
    };
    let id: string | number | null = null;
    if (isCloudReadonly()) {
      console.warn('[CLOUD_READONLY] skip predictions write (cache-miss recompute)');
    } else {
      try {
        id = await adapter.savePrediction({
          ...prediction,
          single_number: prediction.single_number,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        if (!isCloudReadonlyError(e)) throw e;
        console.warn('[CLOUD_READONLY] predictions write rejected by adapter (cache-miss recompute)');
      }
    }
    const data = withPredictionCacheMeta(
      serializePrediction(withComboSupport({ ...prediction, id, prediction_id: id, locked: true, cached: false } as any, entries)) as Record<string, unknown>,
      false,
      new Date().toISOString(),
      rows[0].draw_no,
    );
    await setCloudCache('prediction_today', { latest_draw_no: rows[0].draw_no, target_draw_no: target.target_draw_no, data });
    res.json({ success: true, cached: false, locked: true, data, read_estimate: { draws_read: rows.length, observations_read: recentObservations.length, cache_hit: false, cache_read: 2 } });
  } catch (e) {
    sendApiError(res, e);
  }
}

function isPredictionTodayCacheValid(
  cache: { latest_draw_no?: string; target_draw_no?: string | null; data?: unknown } | null,
  latestDrawNo?: string | null,
): boolean {
  if (!cache?.data || !latestDrawNo || cache.latest_draw_no !== latestDrawNo) return false;
  return isPredictionPayloadCurrent(cache.data as Record<string, unknown>, latestDrawNo, cache.target_draw_no ?? null);
}

function isPredictionPayloadCurrent(payload: Record<string, unknown>, latestDrawNo?: string | null, targetDrawNo?: string | null): boolean {
  if (latestDrawNo && String(payload['latest_used_draw_no'] ?? '') !== String(latestDrawNo)) return false;
  if (targetDrawNo && String(payload['target_draw_no'] ?? '') !== String(targetDrawNo)) return false;
  if (String(payload['model_version'] ?? '') !== HISTORICAL_MODEL_VERSION) return false;
  if (payload['anti_hot_selection_schema'] !== PREDICTION_CACHE_SCHEMA && !payload['anti_hot_selection_penalty_summary']) return false;
  const scores = payload['strategy_scores'] as Record<string, unknown> | undefined;
  return scores?.['anti_hot_selection_schema'] === PREDICTION_CACHE_SCHEMA;
}

function withPredictionCacheMeta<T extends Record<string, unknown>>(
  data: T,
  cached: boolean,
  updatedAt?: string | null,
  latestDrawNo?: string | null,
): T {
  return {
    ...data,
    cached,
    cache_latest_draw_no: latestDrawNo ?? data['latest_used_draw_no'] ?? null,
    prediction_updated_at: updatedAt ?? new Date().toISOString(),
  };
}

async function cloudPerformance(window: number, res: Response): Promise<void> {
  try {
    const safeWindow = Math.min(Math.max(window, 1), 60);
    const key = safeWindow === 30 ? 'performance_30' : `performance_${safeWindow}`;
    const latestCache = await getCloudCache<{ latest_draw_no?: string }>('latest_draw');
    const periodAnchor = taipeiDateKey();
    const cached = await getCloudCache<{ latest_draw_no?: string; period_anchor?: string; data?: unknown }>(key);
    if (cached?.data && isStrictPerformancePayload(cached.data) && cached.period_anchor === periodAnchor && (!latestCache?.latest_draw_no || cached.latest_draw_no === latestCache.latest_draw_no)) {
      res.json({ success: true, data: cached.data, read_estimate: { draws_read: 0, cache_hit: true, cache_read: 2 } });
      return;
    }
    const adapter = getDatabaseAdapter();
    const stats = await adapter.getStats(Math.max(safeWindow, 60));
    const data = computeStrategyPerformance(stats.observations, safeWindow);
    await setCloudCache(key, { latest_draw_no: latestCache?.latest_draw_no ?? null, period_anchor: periodAnchor, data });
    res.json({ success: true, data, read_estimate: { draws_read: 0, cache_hit: false, cache_read: 2, observations_read: Math.max(safeWindow, 60) } });
  } catch (e) {
    sendApiError(res, e);
  }
}

function isStrictPerformancePayload(value: unknown): boolean {
  const data = value as Record<string, unknown> | null;
  if (!data) return false;
  const periods = data['periods'] as Record<string, unknown> | undefined;
  return ['hitRateSingle', 'hitRateTwo', 'hitRateThree', 'hitRateFour', 'hitRateFive', 'single_hit_count', 'two_star_hit_count'].every(key => data[key] !== undefined) &&
    Boolean(
      hasPeriodRecords(periods?.['week']) &&
      hasPeriodRecords(periods?.['previous_week']) &&
      hasPeriodRecords(periods?.['month']) &&
      hasPeriodRecords(periods?.['previous_month']),
    );
}

function hasPeriodRecords(value: unknown): boolean {
  return Array.isArray((value as { recent_records?: unknown } | null)?.recent_records);
}

async function cloudSyncLogs(limit: number, res: Response): Promise<void> {
  try {
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 20), 1), 50);
    const snap = await getFirestoreDb()
      .collection('sync_logs')
      .orderBy('started_at', 'desc')
      .limit(safeLimit)
      .get();
    res.json({
      success: true,
      data: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      read_estimate: { sync_logs_read: snap.size, cache_hit: false, cache_read: 0 },
    });
  } catch (e) {
    sendApiError(res, e);
  }
}

async function cloudAdminSync(headerValue: unknown, res: Response): Promise<void> {
  if (!isAdmin(headerValue)) {
    res.status(401).json({ success: false, error: 'admin token required' });
    return;
  }
  const last = await getCloudCache<{ synced_at?: string; data?: unknown }>('admin_sync_last');
  const lastTs = last?.synced_at ? Date.parse(last.synced_at) : 0;
  if (lastTs && Date.now() - lastTs < 5 * 60 * 1000) {
    res.json({ success: true, data: { status: 'RATE_LIMITED', message: '5 分鐘內不可重複同步', cached: last?.data ?? null }, read_estimate: { draws_read: 0, cache_hit: true, cache_read: 1 } });
    return;
  }
  const data = await cloudSyncNow({ type: 'manual-sync' });
  await setCloudCache('admin_sync_last', { synced_at: new Date().toISOString(), data });
  res.json({ success: true, data, read_estimate: { draws_read: data.status === 'NO_NEW_DATA' ? 0 : 1, cache_hit: false, cache_read: 1 } });
}

function runBacktestHandler() {
  const audit = getLatestHistoryAudit();
  if (audit?.status === 'FAIL') return { success: false, error: 'history audit failed; official backtest is blocked', audit };
  const draws = getDraws().map(toDrawEntry);
  if (draws.length < 30) return { success: false, error: 'at least 30 verified draws are required' };
  const metrics = runBacktest(draws, audit?.status ?? 'WARN');
  const today = todayIso();
  for (const m of metrics) {
    saveBacktest({
      run_date: today,
      window_size: m.windowSize,
      strategy_name: m.strategyName,
      hit_rate_single: null,
      hit_rate_two: m.hitRateTwo,
      hit_rate_three: m.hitRateThree,
      hit_rate_four: m.hitRateFour,
      hit_rate_five: m.hitRateFive,
      avg_hits_two: m.avgTwoHits,
      avg_hits_three: m.avgThreeHits,
      avg_hits_four: m.avgFourHits,
      avg_hits_five: m.avgFiveHits,
      avg_hits: m.avgHits,
      max_losing_streak_two: m.maxLoseStreakTwo,
      max_losing_streak_three: m.maxLoseStreakThree,
      max_losing_streak_four: m.maxLoseStreakFour,
      max_losing_streak_five: m.maxLoseStreakFive,
      max_losing_streak: m.maxLoseStreak,
      sample_size: m.sample_size,
      tested_draws: m.tested_draws,
      audit_status: m.audit_status,
      details_json: JSON.stringify(m.records),
      score: m.score,
    });
  }
  return { success: true, data: metrics };
}

function runAdvancedBacktestHandler() {
  const rows = getDraws().map(toDrawEntry);
  const result = runAdvancedBacktest(rows);
  persistAdvancedDecision(result);
  return { success: true, data: result };
}

function runThreeStarMainBacktestHandler() {
  const rows = getDraws().map(toDrawEntry);
  const result = runThreeStarMainBacktest(rows);
  persistAdvancedDecision(result);
  return { success: true, data: result };
}

function queryHistoryDraws(query: Record<string, string>) {
  let rows = getDraws();
  const drawNo = query['drawNo'];
  const date = normalizeDrawDate(query['date'] ?? '');
  const startDate = normalizeDrawDate(query['startDate'] ?? '');
  const endDate = normalizeDrawDate(query['endDate'] ?? '');
  const containsNumbers = parseNumberList(query['containsNumbers']);
  const pair = parseNumberList(query['twoStar']);
  if (drawNo) rows = rows.filter(r => r.draw_no === drawNo);
  if (date) rows = rows.filter(r => r.draw_date === date);
  if (startDate) rows = rows.filter(r => r.draw_date >= startDate);
  if (endDate) rows = rows.filter(r => r.draw_date <= endDate);
  if (containsNumbers.length) rows = rows.filter(r => containsNumbers.every(n => (JSON.parse(r.numbers_json) as number[]).includes(n)));
  if (pair.length === 2) rows = rows.filter(r => pair.every(n => (JSON.parse(r.numbers_json) as number[]).includes(n)));
  if (query['sort'] === 'oldest') rows = [...rows].reverse();
  const recent = parseInt(String(query['recent'] ?? ''), 10);
  if (Number.isFinite(recent) && recent > 0) rows = rows.slice(0, recent);
  const page = Math.max(1, parseInt(String(query['page'] ?? '1'), 10));
  const defaultLimit = Number.isFinite(recent) && recent > 0 ? recent : 50;
  const limit = Math.min(200, Math.max(1, parseInt(String(query['limit'] ?? String(defaultLimit)), 10)));
  const total = rows.length;
  return { success: true, total, page, limit, draws: rows.slice((page - 1) * limit, page * limit).map(serializeDraw) };
}

async function cloudHistoryDraws(query: Record<string, string>, res: Response): Promise<void> {
  try {
    const requestedRecent = parseInt(String(query['recent'] ?? query['limit'] ?? '30'), 10);
    const readLimit = Math.min(100, Math.max(1, Number.isFinite(requestedRecent) ? requestedRecent : 30));
    let rows = await getDatabaseAdapter().getDraws(readLimit);
    const drawNo = query['drawNo'];
    const date = normalizeDrawDate(query['date'] ?? '');
    const startDate = normalizeDrawDate(query['startDate'] ?? '');
    const endDate = normalizeDrawDate(query['endDate'] ?? '');
    const containsNumbers = parseNumberList(query['containsNumbers']);
    const pair = parseNumberList(query['twoStar']);
    if (drawNo) rows = rows.filter(r => r.draw_no === drawNo);
    if (date) rows = rows.filter(r => r.draw_date === date);
    if (startDate) rows = rows.filter(r => r.draw_date >= startDate);
    if (endDate) rows = rows.filter(r => r.draw_date <= endDate);
    if (containsNumbers.length) rows = rows.filter(r => containsNumbers.every(n => r.numbers.includes(n)));
    if (pair.length === 2) rows = rows.filter(r => pair.every(n => r.numbers.includes(n)));
    if (query['sort'] === 'oldest') rows = [...rows].reverse();
    const recent = parseInt(String(query['recent'] ?? ''), 10);
    if (Number.isFinite(recent) && recent > 0) rows = rows.slice(0, recent);
    const page = Math.max(1, parseInt(String(query['page'] ?? '1'), 10));
    const defaultLimit = Number.isFinite(recent) && recent > 0 ? recent : 50;
    const limit = Math.min(200, Math.max(1, parseInt(String(query['limit'] ?? String(defaultLimit)), 10)));
    const total = rows.length;
    res.json({ success: true, total, page, limit, draws: rows.slice((page - 1) * limit, page * limit).map(serializeAdapterDraw), read_estimate: { draws_read: readLimit, cache_hit: false, cache_read: 0 } });
  } catch (e) {
    sendApiError(res, e);
  }
}

async function cloudNumberAnalysis(query: Record<string, string>, res: Response): Promise<void> {
  try {
    const window = Math.min(100, Math.max(1, parseInt(String(query['window'] ?? '100'), 10)));
    if (window !== 100) {
      res.json({ success: false, error: 'number analysis currently supports window=100 only' });
      return;
    }
    const latestCache = await getCloudCache<{ latest_draw_no?: string }>('latest_draw');
    const cached = await getCloudCache<{ latest_draw_no?: string; data?: unknown }>('number_analysis_100');
    if (latestCache?.latest_draw_no && cached?.latest_draw_no === latestCache.latest_draw_no && cached.data) {
      res.json({ ...(cached.data as Record<string, unknown>), read_estimate: { draws_read: 0, cache_hit: true, cache_read: 2 } });
      return;
    }
    const rows = await getDatabaseAdapter().getDraws(100);
    if (rows.length < 100) {
      res.json({ success: false, error: 'at least 100 verified draws are required' });
      return;
    }
    const entries = rows.map(adapterDrawToEntry);
    const data = getNumberAnalysis(entries, false);
    const view = String(query['view'] ?? 'full');
    const payload = {
      success: true,
      window: 100,
      advanced_stats_enabled: false,
      three_star_main_enabled: false,
      decision: 'cloud-summary',
      reason: 'cloud number analysis reads Firestore draws and avoids live backtest work',
      view,
      data: view === 'summary' ? toNumberAnalysisSummary(data) : data,
    };
    await setCloudCache('latest_draw', { latest_draw_no: rows[0].draw_no, latest_draw_date: rows[0].draw_date, data: serializeAdapterDraw(rows[0]) });
    await setCloudCache('number_analysis_100', { latest_draw_no: rows[0].draw_no, data: payload });
    res.json({ ...payload, read_estimate: { draws_read: rows.length, cache_hit: false, cache_read: 2 } });
  } catch (e) {
    sendApiError(res, e);
  }
}

function numberAnalysis(query: Record<string, string>) {
  const window = Math.min(100, Math.max(1, parseInt(String(query['window'] ?? '100'), 10)));
  if (window !== 100) return { success: false, error: 'number analysis currently supports window=100 only' };
  const rows = getDraws().map(toDrawEntry);
  const decision = getCachedAdvancedDecision(rows);
  const data = getNumberAnalysis(rows, decision.advanced_stats_enabled);
  const view = String(query['view'] ?? 'full');
  return {
    success: true,
    window: 100,
    advanced_stats_enabled: decision.advanced_stats_enabled,
    three_star_main_enabled: decision.three_star_main_enabled,
    decision: decision.decision,
    reason: decision.reason,
    view,
    data: view === 'summary' ? toNumberAnalysisSummary(data) : data,
  };
}

function getCachedAdvancedDecision(rows: DrawEntry[]): AdvancedBacktestResult {
  const latestDrawNo = rows[0]?.draw_no ?? null;
  const cached = getAppConfigValue('advanced_stats_last_result');
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as AdvancedBacktestResult;
      if (parsed.latest_included_draw_no === latestDrawNo && parsed.sample_size === 100 && typeof parsed.three_star_main_enabled === 'boolean') return parsed;
    } catch {
      // Ignore malformed cached decision and recompute from DB.
    }
  }
  const result = runAdvancedBacktest(rows);
  persistAdvancedDecision(result);
  return result;
}

function persistAdvancedDecision(result: AdvancedBacktestResult): void {
  setAppConfigValue('advanced_stats_enabled', String(result.advanced_stats_enabled));
  setAppConfigValue('advanced_stats_last_decision', result.decision);
  setAppConfigValue('advanced_stats_last_result', JSON.stringify(result));
}

function getPreviousPredictionContext(): PreviousPredictionContext | null {
  const previous = getLatestPrediction();
  const recent_observations = getStrategyObservationLogs(12, HISTORICAL_MODEL_VERSION).map(row => ({
    target_draw_no: row.target_draw_no,
    target_date: row.target_date,
    selected_single: row.selected_single ?? null,
    selected_two_star: safeJsonNumbers(row.selected_two_star),
    selected_three_star: safeJsonNumbers(row.selected_three_star),
    selected_four_star: safeJsonNumbers(row.selected_four_star),
    selected_five_star: safeJsonNumbers(row.selected_five_star),
  }));
  if (!previous) {
    return recent_observations.length
      ? {
        prediction_id: 0,
        target_date: recent_observations[0]?.target_date ?? '',
        target_draw_no: recent_observations[0]?.target_draw_no ?? null,
        two_star: [],
        three_star: [],
        four_star: [],
        five_star: [],
        actual_numbers: null,
        recent_observations,
      }
      : null;
  }
  const actual = getActualDrawForPrediction(previous);
  return {
    prediction_id: previous.id,
    target_date: previous.target_date,
    target_draw_no: previous.target_draw_no,
    two_star: previous.two_star_json ? sortNumbers(JSON.parse(previous.two_star_json)) : [],
    three_star: previous.three_star_json ? sortNumbers(JSON.parse(previous.three_star_json)) : [],
    four_star: previous.four_star_json ? sortNumbers(JSON.parse(previous.four_star_json)) : [],
    five_star: previous.five_star_json ? sortNumbers(JSON.parse(previous.five_star_json)) : [],
    actual_numbers: actual ? sortNumbers(JSON.parse(actual.numbers_json)) : null,
    recent_observations,
  };
}

function buildCloudPreviousPredictionContext(observations: AdapterObservation[]): PreviousPredictionContext | null {
  const recent_observations = observations.map(obs => ({
    target_draw_no: obs.target_draw_no ?? null,
    target_date: String(obs.target_date ?? ''),
    selected_single: typeof obs.selected_single === 'number' ? obs.selected_single : null,
    selected_two_star: normalizeObservationNumbers(obs.selected_two_star),
    selected_three_star: normalizeObservationNumbers(obs.selected_three_star ?? obs.three_star),
    selected_four_star: normalizeObservationNumbers(obs.selected_four_star),
    selected_five_star: normalizeObservationNumbers(obs.selected_five_star),
  }));
  if (!recent_observations.length) return null;
  const first = observations[0];
  return {
    prediction_id: typeof first?.prediction_id === 'number' ? first.prediction_id : 0,
    target_date: String(first?.target_date ?? ''),
    target_draw_no: first?.target_draw_no ?? null,
    two_star: normalizeObservationNumbers(first?.selected_two_star),
    three_star: normalizeObservationNumbers(first?.selected_three_star ?? first?.three_star),
    four_star: normalizeObservationNumbers(first?.selected_four_star),
    five_star: normalizeObservationNumbers(first?.selected_five_star),
    actual_numbers: normalizeNullableObservationNumbers(first?.actual_numbers),
    recent_observations,
  };
}

function normalizeObservationNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return sortNumbers(value.map(Number).filter(Number.isFinite));
  if (typeof value === 'string') return safeJsonNumbers(value);
  return [];
}

function normalizeNullableObservationNumbers(value: unknown): number[] | null {
  const nums = normalizeObservationNumbers(value);
  return nums.length ? nums : null;
}

function getActualDrawForPrediction(prediction: import('../db/database').PredictionRow) {
  if (prediction.target_draw_no) {
    const byNo = getDrawByNo(prediction.target_draw_no);
    if (byNo) return byNo;
  }
  return getDB()
    .prepare('SELECT * FROM draws WHERE draw_date=? ORDER BY draw_no DESC LIMIT 1')
    .get(prediction.target_date) as import('../db/database').DrawRow | undefined;
}

function twoStarStats(query: Record<string, string>) {
  const entries = rowsToStatEntries(getDraws()).slice(0, 100);
  const numbers = parseNumberList(query['numbers']);
  const top = Math.min(741, Math.max(1, parseInt(String(query['top'] ?? '50'), 10)));
  const data = numbers.length === 2 ? getTwoStarStat(entries, numbers) : computeTwoStarStats(entries, top);
  return { success: true, data };
}

async function verifyPilioAgainstDb() {
  const pilio = await fetchPilio539();
  const dbRows = getDraws();
  const dbByNo = new Map(dbRows.map(row => [row.draw_no, serializeDraw(row)]));
  const dbByDate = new Map(dbRows.map(row => [row.draw_date, serializeDraw(row)]));
  let matched = 0;
  let conflicts = 0;
  let missingInDb = 0;
  let checked = 0;
  const conflictRows = [];
  for (const draw of pilio.draws.slice(0, 100)) {
    checked++;
    const dbDraw = dbByNo.get(draw.draw_no) ?? dbByDate.get(draw.draw_date);
    if (!dbDraw) {
      missingInDb++;
      continue;
    }
    const dbNums = comboKey(dbDraw.numbers);
    const pilioNums = comboKey(draw.numbers);
    if (dbDraw.draw_date === toDisplayDate(draw.draw_date) && dbNums === pilioNums) {
      matched++;
      getDB().prepare("UPDATE draws SET verified_by_pilio=1, audit_status='PASS' WHERE draw_no=?").run(draw.draw_no);
    } else {
      conflicts++;
      conflictRows.push({ draw_no: draw.draw_no, db: dbDraw, pilio: { ...draw, draw_date: toDisplayDate(draw.draw_date), numbers: sortNumbers(draw.numbers) } });
    }
  }
  const dbRecent = getDraws(100);
  const pilioDates = new Set(pilio.draws.map(d => d.draw_date));
  const missingInPilio = dbRecent.filter(d => !pilioDates.has(d.draw_date)).length;
  const status = conflicts ? 'CONFLICT' : pilio.total_draws ? 'PASS' : 'WARN';
  const saved = getDB().prepare(`
    INSERT INTO pilio_verifications
      (checked_at, mode, pages_fetched, total_draws, matched_count, conflict_count,
       missing_in_db, missing_in_pilio, checked_count, newest_draw_no, newest_draw_date, status, diagnostic_json)
    VALUES
      (@checked_at, @mode, @pages_fetched, @total_draws, @matched_count, @conflict_count,
       @missing_in_db, @missing_in_pilio, @checked_count, @newest_draw_no, @newest_draw_date, @status, @diagnostic_json)
  `).run({
    checked_at: new Date().toISOString(),
    mode: getConfig().pilio.mode,
    pages_fetched: pilio.pages_fetched,
    total_draws: pilio.total_draws,
    matched_count: matched,
    conflict_count: conflicts,
    missing_in_db: missingInDb,
    missing_in_pilio: missingInPilio,
    checked_count: checked,
    newest_draw_no: pilio.newest_draw_no,
    newest_draw_date: pilio.newest_draw_date,
    status,
    diagnostic_json: JSON.stringify({ conflicts: conflictRows }),
  });
  return { id: Number(saved.lastInsertRowid), ...pilio, matched_count: matched, conflict_count: conflicts, missing_in_db: missingInDb, missing_in_pilio: missingInPilio, checked_count: checked, status, conflicts: conflictRows };
}

function respond(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (e) {
    sendApiError(res, e);
  }
}

function sendMarkdownDoc(res: Response, fileName: 'STRATEGY_FULL.md' | 'CLOUD_DEPLOY_FIREBASE_VERCEL.md'): void {
  try {
    const docPath = resolveProjectDoc(fileName);
    if (!docPath) {
      res.status(404).json({ success: false, error: `document not found: ${fileName}` });
      return;
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(fs.readFileSync(docPath, 'utf8'));
  } catch (e) {
    res.status(500).json({
      success: false,
      error: `failed to read document: ${fileName}`,
      diagnostic: (e as Error).message,
    });
  }
}

function resolveProjectDoc(fileName: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'docs', fileName),
    path.resolve(process.cwd(), '..', 'docs', fileName),
    path.resolve(__dirname, '..', '..', '..', 'docs', fileName),
    path.resolve(__dirname, '..', '..', 'docs', fileName),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

async function getCloudCache<T>(key: string): Promise<T | null> {
  const adapter = getDatabaseAdapter();
  if ('getCache' in adapter) return (adapter as { getCache<T>(key: string): Promise<T | null> }).getCache<T>(key);
  return null;
}

async function setCloudCache(key: string, value: Record<string, unknown>): Promise<void> {
  if (isCloudReadonly()) {
    console.warn(`[CLOUD_READONLY] skip cache write: stats_cache/${key}`);
    return;
  }
  const adapter = getDatabaseAdapter();
  if ('setCache' in adapter) {
    try {
      await (adapter as { setCache(key: string, value: Record<string, unknown>): Promise<void> }).setCache(key, value);
    } catch (e) {
      if (isCloudReadonlyError(e)) {
        console.warn(`[CLOUD_READONLY] cache write rejected by adapter: stats_cache/${key}`);
        return;
      }
      throw e;
    }
  }
}

function sendApiError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isQuotaError(message)) {
    res.status(200).json({
      success: false,
      status: 'FIREBASE_QUOTA_EXCEEDED',
      message: '今日額度已用完',
      error: message,
    });
    return;
  }
  res.status(500).json({ success: false, error: message });
}

function isQuotaError(message: string): boolean {
  return /RESOURCE_EXHAUSTED|quota/i.test(message);
}

function serializeDraw(row: import('../db/database').DrawRow) {
  return {
    ...row,
    draw_date: toDisplayDate(row.draw_date),
    numbers: sortNumbers(JSON.parse(row.numbers_json)),
    formatted_numbers: sortNumbers(JSON.parse(row.numbers_json)).map(n => String(n).padStart(2, '0')),
  };
}

function serializeAdapterDraw(row: AdapterDraw) {
  return {
    draw_no: row.draw_no,
    draw_date: toDisplayDate(row.draw_date) ?? row.draw_date,
    numbers: sortNumbers(row.numbers),
    formatted_numbers: sortNumbers(row.numbers).map(n => String(n).padStart(2, '0')),
    source: row.source ?? 'official',
    source_url: row.source_url ?? null,
    verified: row.verified === false ? 0 : 1,
  };
}

function serializeObservationLog(row: import('../db/database').StrategyObservationRow) {
  return {
    ...row,
    target_date: toDisplayDate(row.target_date) ?? row.target_date,
    selected_two_star: safeJsonNumbers(row.selected_two_star),
    selected_three_star: safeJsonNumbers(row.selected_three_star),
    selected_four_star: safeJsonNumbers(row.selected_four_star),
    selected_five_star: safeJsonNumbers(row.selected_five_star),
    actual_numbers: safeJsonNumbers(row.actual_numbers),
  };
}

function toDrawEntry(row: import('../db/database').DrawRow): DrawEntry {
  return { draw_no: row.draw_no, draw_date: row.draw_date, numbers: sortNumbers(JSON.parse(row.numbers_json)) };
}

function adapterDrawToEntry(row: AdapterDraw): DrawEntry {
  return { draw_no: row.draw_no, draw_date: row.draw_date, numbers: sortNumbers(row.numbers) };
}

function withComboSupport<T extends ComboSupportPredictionInput & Record<string, unknown>>(row: T, draws: DrawEntry[]): T & { combo_support_summary: ReturnType<typeof buildComboSupportSummary> } {
  if (isComboSupportSummaryComplete(row['combo_support_summary'])) return row as T & { combo_support_summary: ReturnType<typeof buildComboSupportSummary> };
  return {
    ...row,
    combo_support_summary: buildComboSupportSummary(draws, row),
  };
}

function resolveCloudPredictionTarget(latest: AdapterDraw) {
  const today = todayIso();
  const targetDate = latest.draw_date < today ? today : nextDrawDateAfter(latest.draw_date);
  return {
    target_date: targetDate,
    target_draw_no: /^\d+$/.test(latest.draw_no) ? String(Number(latest.draw_no) + 1).padStart(latest.draw_no.length, '0') : null,
    latest_used_draw_no: latest.draw_no,
    latest_used_draw_date: latest.draw_date,
  };
}

function nextDrawDateAfter(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function taipeiDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parsePredictionRow(row: import('../db/database').PredictionRow) {
  const scores = row.scores_json ? JSON.parse(row.scores_json) : {};
  return {
    ...row,
    prediction_id: row.id,
    locked: row.locked === 1,
    cached: true,
    single: row.single_number,
    numbers: row.numbers_json ? JSON.parse(row.numbers_json) : (row.five_star_json ? JSON.parse(row.five_star_json) : null),
    two_star: row.two_star_json ? JSON.parse(row.two_star_json) : null,
    three_star: row.three_star_json ? JSON.parse(row.three_star_json) : null,
    four_star: row.four_star_json ? JSON.parse(row.four_star_json) : null,
    five_star: row.five_star_json ? JSON.parse(row.five_star_json) : null,
    number_scores: row.number_scores_json ? JSON.parse(row.number_scores_json) : null,
    strategy_scores: row.strategy_scores_json ? JSON.parse(row.strategy_scores_json) : null,
    bet_advice: row.bet_advice_json ? JSON.parse(row.bet_advice_json) : null,
    balance_summary: scores.balance_summary ?? null,
    hot_control_summary: scores.hot_control_summary ?? null,
    combination_repeat_summary: scores.combination_repeat_summary ?? null,
    miss_penalty_summary: scores.miss_penalty_summary ?? null,
    draw_profile: scores.draw_profile ?? null,
    three_star_summary: scores.three_star_summary ?? null,
    tracking_summary: scores.tracking_summary ?? null,
    anti_hot_selection_penalty_summary: scores.anti_hot_selection_penalty_summary ?? null,
  };
}

function serializePrediction<T extends { target_date: string; latest_used_draw_date: string }>(row: T): T {
  const out = {
    ...row,
    target_date: toDisplayDate(row.target_date) ?? row.target_date,
    latest_used_draw_date: toDisplayDate(row.latest_used_draw_date) ?? row.latest_used_draw_date,
  } as Record<string, unknown>;
  for (const key of ['numbers', 'two_star', 'three_star', 'four_star', 'five_star']) {
    if (Array.isArray(out[key])) out[key] = sortNumbers(out[key] as number[]);
  }
  return out as T;
}

function parseNumberList(value: unknown): number[] {
  if (!value) return [];
  return String(value).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 1 && n <= 39);
}

// Production Integration Final Phase: rolling summary over recent observation_logs.
// Used by GET /api/observations/status. All metrics are computed in-process from the
// last `window` observation_logs; we never scan the full Firestore collection.
const SUMMARY_CORE_GROUP = new Set<number>([8, 16, 21, 22, 27]);
function summarizeObservations(observations: AdapterObservation[], window: number): Record<string, unknown> {
  const N = observations.length;
  if (N === 0) {
    return { window, sample_size: 0, ready: false, reason: 'no observation_logs yet' };
  }
  const singles: number[] = [];
  const fiveSets: number[][] = [];
  const threeSets: number[][] = [];
  const numberHits: Record<number, number> = {};
  for (let n = 1; n <= 39; n++) numberHits[n] = 0;
  const pairCounts = new Map<string, number>();
  let coreGroupCount = 0;
  let totalSlots = 0;
  let singleHits = 0;
  let twoStarHits = 0;
  let threeStarFullHits = 0;
  let pairConsecutiveRepeat = 0;
  let singleConsecutiveRepeat = 0;
  let prevPairs: Set<string> | null = null;
  let prevSingle: number | null = null;
  const ensembleVersions = new Set<string>();
  let trendOnlySum = 0, trendOnlyCnt = 0;
  // observations come newest-first from getObservations (orderBy target_draw_no desc),
  // but for consecutive-repeat metrics we need chronological order → reverse.
  const chronological = [...observations].reverse();
  for (const o of chronological) {
    const s = Number(o.selected_single ?? 0);
    if (s) singles.push(s);
    const five = Array.isArray(o.selected_five_star) ? o.selected_five_star.map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
    const three = Array.isArray(o.selected_three_star ?? o.three_star) ? (o.selected_three_star ?? o.three_star)!.map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
    fiveSets.push(five);
    threeSets.push(three);
    for (const n of five) {
      if (n >= 1 && n <= 39) numberHits[n]++;
      if (SUMMARY_CORE_GROUP.has(n)) coreGroupCount++;
    }
    totalSlots += five.length;
    if (o.single_hit === true || o.single_hit === 1) singleHits++;
    if (o.two_star_hit === true || o.two_star_hit === 1) twoStarHits++;
    if (typeof o.three_star_hits === 'number' && o.three_star_hits === 3) threeStarFullHits++;
    const pairs = new Set<string>();
    for (let i = 0; i < five.length; i++) for (let j = i + 1; j < five.length; j++) pairs.add(`${five[i]},${five[j]}`);
    for (const p of pairs) pairCounts.set(p, (pairCounts.get(p) ?? 0) + 1);
    if (prevPairs) for (const p of pairs) if (prevPairs.has(p)) pairConsecutiveRepeat++;
    if (prevSingle !== null && prevSingle === s) singleConsecutiveRepeat++;
    prevPairs = pairs;
    prevSingle = s;
    const v = (o as Record<string, unknown>)['ensemble_voting_version'];
    if (typeof v === 'string') ensembleVersions.add(v);
    const tor = (o as Record<string, unknown>)['trend_only_ratio'];
    if (typeof tor === 'number' && Number.isFinite(tor)) { trendOnlySum += tor; trendOnlyCnt++; }
  }
  const top10 = Object.entries(numberHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const hotTop10Sum = top10.reduce((s, [, c]) => s + c, 0);
  const uniqueSingles = new Set(singles).size;
  const uniqueFiveCombos = new Set(fiveSets.map(s => s.join(','))).size;
  const uniqueThreeCombos = new Set(threeSets.map(s => s.join(','))).size;
  const coverage = Object.values(numberHits).filter(c => c > 0).length;
  const maxPairCount = pairCounts.size ? Math.max(...pairCounts.values()) : 0;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    window,
    sample_size: N,
    ready: N >= 5,
    schema: (observations[0] as Record<string, unknown>)['schema'] ?? null,
    ensemble_versions: [...ensembleVersions],
    rolling_metrics: {
      unique_singles: uniqueSingles,
      unique_five_combos: uniqueFiveCombos,
      unique_three_combos: uniqueThreeCombos,
      coverage_01_39: coverage,
      hot_top10_ratio: totalSlots > 0 ? round(hotTop10Sum / totalSlots) : 0,
      max_pair_count: maxPairCount,
      pair_consecutive_repeat: pairConsecutiveRepeat,
      single_consecutive_repeat: singleConsecutiveRepeat,
      core_group_count: coreGroupCount,
      core_group_ratio: totalSlots > 0 ? round(coreGroupCount / totalSlots) : 0,
      trend_only_ratio_avg: trendOnlyCnt > 0 ? round(trendOnlySum / trendOnlyCnt) : null,
    },
    hit_rate: N > 0 ? {
      single: round(singleHits / N),
      two: round(twoStarHits / N),
      three_full: round(threeStarFullHits / N),
    } : null,
    top10_numbers: top10.map(([n, c]) => ({ n: Number(n), c })),
    health_flags: {
      hot_top10_high: totalSlots > 0 && hotTop10Sum / totalSlots > 0.65,
      core_group_dominant: totalSlots > 0 && coreGroupCount / totalSlots > 0.25,
      pair_lock_failed: pairConsecutiveRepeat > 0,
      single_rotation_failed: singleConsecutiveRepeat > 0,
      excessive_uniformity: N >= 14 && coverage >= 38 && hotTop10Sum / totalSlots < 0.30,
    },
  };
}

function safeJsonNumbers(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? sortNumbers(parsed.map(Number).filter(Number.isFinite)) : [];
  } catch {
    return [];
  }
}
