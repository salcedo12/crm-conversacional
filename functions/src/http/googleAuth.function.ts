import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getConsentUrl, exchangeCode } from '../integrations/google/google.client';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { requireAuth, assertCompany } from '../lib/authContext';

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

    // El state lleva companyId + advisorId para reconstruir el contexto en el callback
    const state = Buffer.from(JSON.stringify({ companyId, advisorId })).toString('base64url');
    const url   = getConsentUrl(state);

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
      const { companyId, advisorId } = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8')
      ) as { companyId: string; advisorId: string };

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
