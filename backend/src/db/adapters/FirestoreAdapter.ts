import type { AdapterDraw, AdapterObservation, AdapterPrediction, DatabaseAdapter } from './DatabaseAdapter';
import { getFirestoreDb } from './firestoreClient';
import { assertWritable } from './readonlyGuard';
import { normalizeDrawDate } from '../../data/dateUtils';
import { sortNumbers } from '../../utils/numbers';

export class FirestoreAdapter implements DatabaseAdapter {
  private db = getFirestoreDb();

  async getDraws(limit = 120): Promise<AdapterDraw[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 120), 1), 120);
    const snap = await this.db.collection('draws')
      .orderBy('draw_no', 'desc')
      .limit(safeLimit)
      .get();
    return snap.docs
      .map(doc => this.toDraw(doc.data()))
      .sort((a, b) => b.draw_date.localeCompare(a.draw_date) || b.draw_no.localeCompare(a.draw_no));
  }

  async insertDraw(draw: AdapterDraw): Promise<'inserted' | 'existing'> {
    assertWritable('FirestoreAdapter.insertDraw');
    const normalized = this.normalizeDraw(draw);
    const ref = this.db.collection('draws').doc(normalized.draw_no);
    const existing = await ref.get();
    if (existing.exists) {
      await ref.set({ ...normalized, updated_at: new Date().toISOString() }, { merge: true });
      return 'existing';
    }
    await ref.set({
      ...normalized,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return 'inserted';
  }

  async getLatestDraw(): Promise<AdapterDraw | null> {
    const rows = await this.getDraws(1);
    return rows[0] ?? null;
  }

  async savePrediction(prediction: AdapterPrediction): Promise<string> {
    assertWritable('FirestoreAdapter.savePrediction');
    const id = predictionDocId(prediction, this.db.collection('predictions').doc().id);
    await this.db.collection('predictions').doc(id).set({
      ...prediction,
      created_at: prediction.created_at ?? new Date().toISOString(),
    }, { merge: true });
    return id;
  }

  async getPredictionByDrawNo(draw_no: string): Promise<AdapterPrediction | null> {
    const snap = await this.db.collection('predictions')
      .where('target_draw_no', '==', draw_no)
      .get();
    if (snap.empty) return null;
    const docs = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as AdapterPrediction))
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    return docs.find(doc => doc.model_version === 'v6.1-three-star-stable') ?? docs[0];
  }

  async saveObservation(log: AdapterObservation): Promise<void> {
    assertWritable('FirestoreAdapter.saveObservation');
    const id = observationDocId(log, this.db.collection('observation_logs').doc().id);
    await this.db.collection('observation_logs').doc(id).set({
      ...log,
      created_at: log.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });
  }

  async getObservations(limit = 30): Promise<AdapterObservation[]> {
    const snap = await this.db.collection('observation_logs')
      .orderBy('target_draw_no', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdapterObservation));
  }

  async getStats(window: number): Promise<{ observations: AdapterObservation[] }> {
    return { observations: await this.getObservations(window) };
  }

  async getAdminPasswordHash(): Promise<string | null> {
    const doc = await this.db.collection('admin').doc('credentials').get();
    const data = doc.data();
    return typeof data?.['password_hash'] === 'string' ? data['password_hash'] : null;
  }

  async setAdminPasswordHash(hash: string): Promise<void> {
    assertWritable('FirestoreAdapter.setAdminPasswordHash');
    await this.db.collection('admin').doc('credentials').set({
      password_hash: hash,
      updated_at: new Date().toISOString(),
    }, { merge: true });
  }

  async getCache<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const doc = await this.db.collection('stats_cache').doc(key).get();
    return doc.exists ? doc.data() as T : null;
  }

  async setCache(key: string, value: Record<string, unknown>): Promise<void> {
    assertWritable(`FirestoreAdapter.setCache:${key}`);
    await this.db.collection('stats_cache').doc(key).set({
      ...value,
      updated_at: new Date().toISOString(),
    }, { merge: true });
  }

  private normalizeDraw(draw: AdapterDraw): AdapterDraw & { date: string } {
    const date = normalizeDrawDate(draw.draw_date || draw.date || '');
    if (!date) throw new Error(`invalid draw_date: ${draw.draw_date || draw.date}`);
    return {
      ...draw,
      draw_date: date,
      date,
      numbers: sortNumbers(draw.numbers),
      source: draw.source ?? 'official',
      source_url: draw.source_url ?? null,
      verified: draw.verified ?? true,
    };
  }

  private toDraw(data: FirebaseFirestore.DocumentData): AdapterDraw {
    return this.normalizeDraw({
      draw_no: String(data['draw_no'] ?? ''),
      draw_date: String(data['draw_date'] ?? data['date'] ?? ''),
      numbers: Array.isArray(data['numbers']) ? data['numbers'].map(Number) : [],
      source: String(data['source'] ?? 'official'),
      source_url: typeof data['source_url'] === 'string' ? data['source_url'] : null,
      verified: data['verified'] !== false,
    });
  }
}

function predictionDocId(prediction: AdapterPrediction, fallback: string): string {
  const target = prediction.target_draw_no ?? prediction.target_date ?? fallback;
  const version = prediction.model_version ?? 'unknown';
  return safeDocId(`${target}_${version}`);
}

function observationDocId(log: AdapterObservation, fallback: string): string {
  const target = log.target_draw_no ?? log.target_date ?? log.prediction_id ?? fallback;
  const version = log.model_version ?? 'unknown';
  return safeDocId(`${target}_${version}`);
}

function safeDocId(value: string | number): string {
  return String(value).replace(/[\/\\#?]/g, '_');
}
