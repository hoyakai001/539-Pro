import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function isCloudMode(): boolean {
  return process.env['APP_MODE'] === 'cloud';
}

export function isFirestoreConfigured(): boolean {
  return Boolean(
    process.env['FIREBASE_PROJECT_ID'] &&
    process.env['FIREBASE_CLIENT_EMAIL'] &&
    process.env['FIREBASE_PRIVATE_KEY'],
  );
}

export function getFirestoreDb(): Firestore {
  if (!isFirestoreConfigured()) {
    throw new Error('Firebase Firestore is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env['FIREBASE_PROJECT_ID'],
        clientEmail: process.env['FIREBASE_CLIENT_EMAIL'],
        privateKey: normalizePrivateKey(process.env['FIREBASE_PRIVATE_KEY'] ?? ''),
      }),
    });
  }
  return getFirestore();
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}
