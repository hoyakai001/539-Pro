import type { DatabaseAdapter } from './DatabaseAdapter';
import { FirestoreAdapter } from './FirestoreAdapter';
import { isCloudMode } from './firestoreClient';

let adapter: DatabaseAdapter | null = null;

export function getDatabaseAdapter(): DatabaseAdapter {
  if (!adapter) {
    if (isCloudMode()) {
      adapter = new FirestoreAdapter();
    } else {
      const { SQLiteAdapter } = require('./SQLiteAdapter') as typeof import('./SQLiteAdapter');
      adapter = new SQLiteAdapter();
    }
  }
  return adapter;
}

export { isCloudMode, isFirestoreConfigured } from './firestoreClient';
export type { AdapterDraw, AdapterObservation, AdapterPrediction, DatabaseAdapter } from './DatabaseAdapter';
