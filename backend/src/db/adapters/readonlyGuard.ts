/**
 * readonlyGuard — Cloud Readonly Mode 中央防護
 *
 * 啟用方式：環境變數 CLOUD_READONLY=true 或 =1
 *
 * 設計原則：
 *   1. 所有 Firestore 寫入點（FirestoreAdapter 內 set/update/insert）
 *      呼叫 assertWritable() 在 readonly 時拋 CloudReadonlyError。
 *   2. Route 層用 readonlyMutationGuard middleware 直接擋 mutation route。
 *   3. 對於可優雅降級的寫（cache/optional persistence），呼叫端用
 *      isCloudReadonly() 檢查，跳過寫入但仍回傳計算結果。
 *
 * 不影響 GET / 讀取行為。
 */

export const CLOUD_READONLY_BLOCKED = 'CLOUD_READONLY_BLOCKED';

export class CloudReadonlyError extends Error {
  readonly code = CLOUD_READONLY_BLOCKED;
  readonly operation: string;
  constructor(operation: string) {
    super(`CLOUD_READONLY_MODE: write operation blocked (${operation})`);
    this.operation = operation;
    this.name = 'CloudReadonlyError';
  }
}

export function isCloudReadonly(): boolean {
  const v = (process.env['CLOUD_READONLY'] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * 在 readonly 模式下拋錯，呼叫端必須處理。
 * 用於必須完整禁止寫入的場合（FirestoreAdapter 內所有 write 方法）。
 */
export function assertWritable(operation: string): void {
  if (isCloudReadonly()) {
    console.warn(`[CLOUD_READONLY] blocked write: ${operation}`);
    throw new CloudReadonlyError(operation);
  }
}

/**
 * 用於可優雅降級的寫入：cache、選擇性 persistence。
 * readonly 時印 log 並回傳 null，不執行 fn；非 readonly 時正常 await fn()。
 */
export async function tryWrite<T>(operation: string, fn: () => Promise<T>): Promise<T | null> {
  if (isCloudReadonly()) {
    console.warn(`[CLOUD_READONLY] skip optional write: ${operation}`);
    return null;
  }
  return fn();
}

export function isCloudReadonlyError(e: unknown): e is CloudReadonlyError {
  return e instanceof CloudReadonlyError
    || (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === CLOUD_READONLY_BLOCKED);
}
