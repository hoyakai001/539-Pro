/**
 * pathResolver — 依執行模式解析資料庫與設定檔位置
 *
 * 開發模式：
 *   DB:     backend/data/539.sqlite
 *   Config: backend/.env  (由 dotenv 處理)
 *
 * 打包模式 (Electron / pkg / standalone Node):
 *   Windows: %APPDATA%\539-system\
 *   macOS:   ~/Library/Application Support/539-system/
 *   Linux:   ~/.config/539-system/
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { isPackaged } from './runtimeMode';

const APP_NAME = '539-system';

export function getUserDataDir(): string {
  // Electron 模式：使用 app.getPath('userData')
  if (typeof process.versions?.electron === 'string') {
    try {
      // dynamic require so non-Electron envs don't crash
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      const app = electron.app || (electron.remote && electron.remote.app);
      if (app) return app.getPath('userData');
    } catch { /* fallthrough */ }
  }

  // 非 Electron 打包 / 一般 Node
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'win32') {
    return path.join(process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming'), APP_NAME);
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  } else {
    return path.join(process.env['XDG_CONFIG_HOME'] || path.join(home, '.config'), APP_NAME);
  }
}

export function resolveDbPath(): string {
  if (isPackaged()) {
    const dir = getUserDataDir();
    ensureDir(dir);
    return path.join(dir, '539.sqlite');
  }

  // 開發模式：優先使用 .env 中的 DB_PATH
  const envPath = process.env['DB_PATH'];
  if (envPath) {
    const abs = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
    ensureDir(path.dirname(abs));
    return abs;
  }

  // 預設開發路徑
  const devPath = path.resolve(process.cwd(), 'data', '539.sqlite');
  ensureDir(path.dirname(devPath));
  return devPath;
}

export function resolveConfigPath(): string {
  if (isPackaged()) {
    const dir = getUserDataDir();
    ensureDir(dir);
    return path.join(dir, 'config.json');
  }
  // 開發模式設定由 .env 處理，config.json 仍可存在供覆蓋
  return path.resolve(process.cwd(), 'config.json');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 取得目前模式的完整路徑摘要，供 /api/data/status 顯示 */
export function getPathSummary(): { dbPath: string; configPath: string; userDataDir: string; mode: string } {
  const { getRuntimeMode } = require('./runtimeMode') as typeof import('./runtimeMode');
  return {
    dbPath: resolveDbPath(),
    configPath: resolveConfigPath(),
    userDataDir: getUserDataDir(),
    mode: getRuntimeMode(),
  };
}
