import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getConsentUrl, exchangeCode } from '../integrations/google/google.client';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { requireAuth, assertCompany } from '../lib/authContext';
import { db } from '../lib/admin';
import { Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

async function consumeOAuthState(state: string): Promise<{ companyId: string; advisorId: string } | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return null;
  const ref = db.collection('oauthStates').doc(state);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data()!;
    tx.delete(ref);
    if (d.provider !== 'google_calendar') return null;
    if (!(d.expiresAt instanceof Timestamp) || d.expiresAt.toMillis() < Date.now()) return null;
    if (typeof d.companyId !== 'string' || typeof d.advisorId !== 'string') return null;
    return { companyId: d.companyId, advisorId: d.advisorId };
  });
}

// ─── startGoogleAuth ───────────────────────────────────────────────────────────
// Devuelve la URL de consentimiento de Google para el asesor autenticado.

export const startGoogleAuth = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    if (!env.googleConfigured()) {
      throw new HttpsError('failed-precondition', 'Google OAuth no está configurado en el servidor.');
    }

    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    const advisorId = ctx.uid;

    // Seguridad (R08): el state es un valor aleatorio de un solo uso guardado en
    // el servidor (antes era companyId+advisorId en base64, falsificable: alguien
    // podía conectar SU Google al calendario de otro asesor).
    const state = crypto.randomBytes(32).toString('base64url');
    await db.collection('oauthStates').doc(state).set({
      companyId,
      advisorId,
      provider:  'google_calendar',
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + OAUTH_STATE_TTL_MS),
    });
    const url = getConsentUrl(state);

    return { url };
  }
);

// ─── googleOAuthCallback ─────────────────────────────────────────────────────────
// Endpoint HTTP público al que Google redirige tras el consentimiento.

export const googleOAuthCallback = onRequest(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (req, res) => {
    const code  = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const back  = (q: string) => res.redirect(`${env.appBaseUrl()}/dashboard/config${q}`);

    if (!code || !state) {
      logger.warn('[GoogleOAuth] Callback sin code/state');
      return back('?google=error');
    }

    try {
      // Consumir el state una sola vez (transacción): inexistente, vencido o
      // reutilizado → rechazo.
      const ctx = await consumeOAuthState(state);
      if (!ctx) {
        logger.warn('[GoogleOAuth][SECURITY] state inválido, vencido o reutilizado');
        return back('?google=error');
      }
      const { companyId, advisorId } = ctx;

      const { refreshToken, email, scope } = await exchangeCode(code);

      await googleConnectionRepository.save({
        companyId, advisorId, email, refreshToken, scope, status: 'connected',
      });

      logger.info('[GoogleOAuth] Conexión guardada', { companyId, advisorId, email });
      return back('?google=connected');
    } catch (err) {
      logger.error('[GoogleOAuth] Error en callback', {
        error: err instanceof Error ? err.message : String(err),
      });
      return back('?google=error');
    }
  }
);

// ─── getGoogleConnection ─────────────────────────────────────────────────────────

export const getGoogleConnection = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const conn = await googleConnectionRepository.get(companyId, ctx.uid);
    if (!conn || conn.status !== 'connected') {
      return { connected: false, email: null };
    }
    return { connected: true, email: conn.email };
  }
);

// ─── disconnectGoogle ─────────────────────────────────────────────────────────────

export const disconnectGoogle = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    await googleConnectionRepository.disconnect(companyId, ctx.uid);
    return { ok: true };
  }
);
