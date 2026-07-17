import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { GoogleConnection } from './googleConnection.types';

// companies/{companyId}/googleConnections/{advisorId}
const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('googleConnections');

export const googleConnectionRepository = {

  async get(companyId: string, advisorId: string): Promise<GoogleConnection | null> {
    const snap = await col(companyId).doc(advisorId).get();
    if (!snap.exists) return null;
    return snap.data() as GoogleConnection;
  },

  async save(conn: Omit<GoogleConnection, 'connectedAt' | 'updatedAt'> & {
    connectedAt?: Timestamp;
  }): Promise<void> {
    const now = Timestamp.now();
    const ref = col(conn.companyId).doc(conn.advisorId);
    const existing = await ref.get();
    await ref.set({
      ...conn,
      connectedAt: existing.exists ? (existing.data()!.connectedAt as Timestamp) : now,
      updatedAt:   now,
    }, { merge: true });
  },

  async disconnect(companyId: string, advisorId: string): Promise<void> {
    await col(companyId).doc(advisorId).set(
      { status: 'disconnected', updatedAt: Timestamp.now() },
      { merge: true }
    );
  },

  /** Devuelve la conexión activa de un asesor, o null si no está conectado. */
  async getActive(companyId: string, advisorId: string): Promise<GoogleConnection | null> {
    const conn = await this.get(companyId, advisorId);
    if (!conn || conn.status !== 'connected' || !conn.refreshToken) return null;
    return conn;
  },
};
