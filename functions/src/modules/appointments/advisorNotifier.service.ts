import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { getYcloudClientForCompany } from '../../integrations/ycloud/ycloud.client';
import { getYcloudConfigForCompany } from '../companies/channelCredentials.repository';
import { formatLongDate, formatTime } from './appointmentMessages';

/** Nombre de la plantilla aprobada que avisa al asesor de una nueva cita. */
const ADVISOR_TEMPLATE = 'cita_asesor';

/** Devuelve el string si es un teléfono no vacío; si no, null. */
function cleanPhone(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Teléfono del asesor para notificarle (híbrido):
 *  1. El campo "WhatsApp para avisos" de su perfil (companies/{id}/users/{uid}.phone),
 *     que un admin puede fijar explícitamente.
 *  2. Si está vacío, cae al WhatsApp que el asesor conectó por el puente
 *     (advisorWhatsappConnections/{advisorId}.phone).
 * Así funciona de una para quien ya conectó el puente, y el admin puede definirlo a
 * mano para el resto. Si no hay ninguno, no hay número (no se avisa).
 */
async function advisorNotifyPhone(companyId: string, advisorId: string): Promise<string | null> {
  const companyRef = db.collection('companies').doc(companyId);

  const userSnap = await companyRef.collection('users').doc(advisorId).get();
  const fromProfile = cleanPhone(userSnap.data()?.phone);
  if (fromProfile) return fromProfile;

  const connSnap = await companyRef.collection('advisorWhatsappConnections').doc(advisorId).get();
  return cleanPhone(connSnap.data()?.phone);
}

export interface AdvisorAppointmentNotice {
  companyId:  string;
  advisorId?: string;
  leadName?:  string;
  leadPhone?: string;
  startTime:  Date;
}

/**
 * Avisa al asesor asignado, por WhatsApp, que se agendó una cita. Envía la plantilla
 * `cita_asesor` por la YCloud de la EMPRESA (multi-tenant), al número que el asesor
 * conectó por el puente.
 *
 * Best-effort: NUNCA lanza (no debe tumbar el agendamiento). Se salta si el asesor no
 * tiene WhatsApp conectado (sin número) o si la empresa no tiene YCloud. Si la plantilla
 * aún no está aprobada, YCloud responde error y solo se registra la advertencia.
 */
export async function notifyAdvisorAppointmentBooked(notice: AdvisorAppointmentNotice): Promise<void> {
  const { companyId, advisorId, leadName, leadPhone, startTime } = notice;
  if (!advisorId) return;

  try {
    const phone = await advisorNotifyPhone(companyId, advisorId);
    if (!phone) {
      logger.info('[AdvisorNotify] Asesor sin WhatsApp conectado — no se envía aviso de cita', { companyId, advisorId });
      return;
    }

    const cfg = await getYcloudConfigForCompany(companyId);
    if (!cfg.apiKey) return;

    const client = await getYcloudClientForCompany(companyId);
    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: (leadName  || 'Cliente').slice(0, 60) },
          { type: 'text', text: (leadPhone || 'Sin número').slice(0, 40) },
          { type: 'text', text: formatLongDate(startTime) },
          { type: 'text', text: formatTime(startTime) },
        ],
      },
    ];

    await client.sendTemplate(phone, ADVISOR_TEMPLATE, 'es', components);
    logger.info('[AdvisorNotify] Aviso de cita enviado al asesor', { companyId, advisorId });
  } catch (err) {
    logger.warn('[AdvisorNotify] No se pudo avisar al asesor (best-effort)', {
      companyId, advisorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
