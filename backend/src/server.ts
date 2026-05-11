// dotenv must load BEFORE any module that reads process.env at import time
// (e.g. statisticalPrediction.ts computes PREDICTION_CACHE_SCHEMA on load).
// Explicit path so it works whether server is started from backend/ or repo root.
import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
dotenvConfig({ path: path.resolve(__dirname, '..', '.env') });
import express from 'express';
import cors from 'cors';
import { initDB } from './db/database';
import { setupRoutes } from './api/routes';
import { ensureConfigFile, getConfig } from './config/configService';
import { getPathSummary } from './config/pathResolver';
import { startAutomaticSync } from './data/syncRecoveryManager';
import { isCloudMode } from './db/adapters';
import { isCloudReadonly } from './db/adapters/readonlyGuard';

const PORT = parseInt(process.env['PORT'] || '3001', 10);

function startup(): void {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    console.error(`[STARTUP] Node.js v18+ is required. Current: ${process.version}`);
    process.exit(1);
  }
  if (!isCloudMode()) {
    ensureConfigFile();
    initDB();
  }
  if (isCloudMode() && isCloudReadonly()) {
    console.log('================================================');
    console.log('  CLOUD READONLY MODE');
    console.log('  Firestore writes disabled');
    console.log('  sync disabled');
    console.log('  admin mutations disabled');
    console.log('  prediction regenerate disabled');
    console.log('  cache writes disabled');
    console.log('  GET / read routes remain enabled');
    console.log('================================================');
  } else if (isCloudMode()) {
    console.log('[STARTUP] CLOUD WRITE-ENABLED MODE — Firestore writes are LIVE');
  }
}

startup();

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
setupRoutes(app);

if (require.main === module && process.env['VERCEL'] !== '1') {
  app.listen(PORT, () => {
  const cfg = getConfig();
  const paths = getPathSummary();
  console.log(`[STARTUP] 539 backend listening on http://localhost:${PORT}`);
  console.log(`[STARTUP] mode=${paths.mode}`);
  console.log(`[STARTUP] db=${paths.dbPath}`);
  console.log(`[STARTUP] config=${paths.configPath}`);
  console.log(`[STARTUP] sync interval=${cfg.syncIntervalMinutes} minutes, recovery retry=${cfg.recoveryRetryMinutes} minutes`);
    console.log(`[STARTUP] cloud_readonly=${isCloudReadonly()}`);
    if (!isCloudMode() && !isCloudReadonly()) startAutomaticSync();
  });
}

export default app;
