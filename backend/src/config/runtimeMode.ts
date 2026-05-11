/**
 * runtimeMode — 判斷目前執行環境
 *
 * dev:       一般 ts-node-dev / npm run dev
 * electron:  Electron 打包後 (process.versions.electron 存在)
 * pkg:       pkg 打包成單一執行檔 (process.pkg 存在)
 * node:      standalone Node.js (生產環境 node dist/server.js)
 */

export type RuntimeMode = 'dev' | 'electron' | 'pkg' | 'node';

declare const process: NodeJS.Process & {
  pkg?: unknown;
};

let _mode: RuntimeMode | null = null;

export function getRuntimeMode(): RuntimeMode {
  if (_mode) return _mode;

  if (typeof process.versions?.electron === 'string') {
    _mode = 'electron';
  } else if (typeof (process as { pkg?: unknown }).pkg !== 'undefined') {
    _mode = 'pkg';
  } else if (process.env['NODE_ENV'] === 'development' || process.env['TS_NODE_DEV']) {
    _mode = 'dev';
  } else {
    _mode = 'node';
  }

  return _mode;
}

export function isPackaged(): boolean {
  const m = getRuntimeMode();
  return m === 'electron' || m === 'pkg';
}

export function isDev(): boolean {
  return getRuntimeMode() === 'dev';
}
