import { onRequest } from 'firebase-functions/v2/https';
import { logger } from '../utils/logger';
import { db } from '../lib/admin';

/**
 * Redireccionador de evidencia fotográfica.
 *
 * La bitácora de SmartHome no puede llevar archivos, solo texto; y la URL de
 * descarga de Firebase Storage es larguísima (~230 caracteres) y difícil de
 * revisar. En su lugar guardamos un código corto en `evidenceLinks/{code}` y en la
 * bitácora ponemos `.../ev/{code}`. Al abrirlo, esta función hace un 302 a la URL
 * real de Firebase.
 *
 * Es un "enlace-capacidad": quien tiene el código corto (aleatorio, no adivinable)
 * puede ver la foto, igual que antes quien tenía la URL larga (que también lleva su
 * propio token). Por eso el invoker es público (los administrativos lo abren desde
 * SmartHome, fuera de nuestro CRM, sin sesión).
 */
export const ev = onRequest(
  {
    region:         'us-central1',
    cors:           false,
    timeoutSeconds: 30,
    memory:         '256MiB',
    invoker:        'public',
  },
  async (req, res) => {
    // Acepta /ev/<code>, /<code> (según cómo mapee la ruta) y ?c=<code>.
    const fromPath = req.path.replace(/^\/+/, '').split('/').filter(Boolean).pop() ?? '';
    const code = (fromPath || String(req.query.c ?? '')).trim();

    if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) {
      res.status(400).send('Enlace de evidencia inválido.');
      return;
    }

    try {
      const snap = await db.collection('evidenceLinks').doc(code).get();
      const url = snap.data()?.downloadUrl as string | undefined;
      if (!url) {
        res.status(404).send('Evidencia no encontrada.');
        return;
      }
      res.set('Cache-Control', 'private, max-age=300');
      res.redirect(302, url);
    } catch (err) {
      logger.error('[evidenceLink] error resolviendo código', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send('No se pudo abrir la evidencia.');
    }
  }
);
