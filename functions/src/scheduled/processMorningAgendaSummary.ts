import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { requireAuth, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { getYcloudClientForCompany } from '../integrations/ycloud/ycloud.client';
import { getYcloudConfigForCompany } from '../modules/companies/channelCredentials.repository';
import { advisorWhatsappBridgeClient } from '../integrations/advisorWhatsapp/advisorWhatsappBridge.client';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
import { formatLongDate, formatTime } from '../modules/appointments/appointmentMessages';
import { normalizePhone } from '../utils/phone';

interface AgendaItem {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  project: string;
  action: string;
  timeMs: number;
  kind: 'cita' | 'seguimiento';
  isOverdue: boolean;
}

function cleanString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getBogotaDayBounds(now = new Date()): { startOfTodayMs: number; endOfTodayMs: number } {
  // Obtener año, mes, día en America/Bogota (-05:00)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';

  const startOfTodayMs = Date.parse(`${year}-${month}-${day}T00:00:00-05:00`);
  const endOfTodayMs = Date.parse(`${year}-${month}-${day}T23:59:59.999-05:00`);
  return { startOfTodayMs, endOfTodayMs };
}

function buildMorningEmailHtml(params: {
  advisorName: string;
  dateLabel: string;
  todayItems: AgendaItem[];
  overdueItems: AgendaItem[];
  calendarUrl: string;
}): string {
  const { advisorName, dateLabel, todayItems, overdueItems, calendarUrl } = params;

  const renderRows = (items: AgendaItem[], isOverdueSection: boolean) =>
    items
      .map((item) => {
        const timeStr = formatTime(new Date(item.timeMs));
        const dateStr = isOverdueSection ? `${formatLongDate(new Date(item.timeMs))} · ${timeStr}` : timeStr;
        const badgeColor = isOverdueSection ? '#ef4444' : item.kind === 'cita' ? '#8b5cf6' : '#f59e0b';
        const leadLink = `${env.appBaseUrl()}/dashboard/inbox?lead=${item.leadId}`;
        return `
          <tr>
            <td style="padding:12px 14px;border-bottom:1px solid #27272a;color:${badgeColor};font-weight:700;font-size:13px;white-space:nowrap;">
              ${escapeHtml(dateStr)}
            </td>
            <td style="padding:12px 14px;border-bottom:1px solid #27272a;color:#ffffff;font-size:13px;">
              <strong>${escapeHtml(item.leadName)}</strong><br/>
              <span style="color:#10b981;font-size:12px;">${escapeHtml(item.leadPhone)}</span>
              ${item.project ? `<span style="color:#a1a1aa;font-size:11px;"> · ${escapeHtml(item.project)}</span>` : ''}
            </td>
            <td style="padding:12px 14px;border-bottom:1px solid #27272a;color:#d4d4d8;font-size:13px;">
              ${escapeHtml(item.action)}
            </td>
            <td style="padding:12px 14px;border-bottom:1px solid #27272a;text-align:right;">
              <a href="${escapeHtml(leadLink)}" target="_blank" style="display:inline-block;padding:6px 12px;background:#27272a;color:#e4e4e7;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
                Abrir
              </a>
            </td>
          </tr>
        `;
      })
      .join('');

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Resumen Matutino de Agenda - Meraki CRM</title>
  </head>
  <body style="margin:0;background:#0b0b0f;font-family:Arial,Helvetica,sans-serif;color:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#18181b;border:1px solid #2f2f35;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:22px 28px;background:#131316;border-bottom:1px solid #2f2f35;">
                <span style="background:#f59e0b;color:#09090b;border-radius:8px;padding:5px 10px;font-weight:800;font-size:13px;">
                  ☀️ AGENDA MATUTINA MERAKI
                </span>
                <span style="margin-left:10px;color:#a1a1aa;font-size:13px;">
                  ${escapeHtml(dateLabel)}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 8px;color:#ffffff;font-size:20px;">
                  ¡Buenos días, ${escapeHtml(advisorName)}!
                </h1>
                <p style="margin:0 0 22px;color:#d4d4d8;font-size:14px;line-height:1.5;">
                  Hoy tienes <strong>${todayItems.length} compromiso(s) programado(s)</strong>${
                    overdueItems.length > 0
                      ? ` y <strong style="color:#f87171;">${overdueItems.length} pendiente(s) en mora</strong> que requieren Ficha Técnica`
                      : ''
                  }.
                </p>

                ${
                  todayItems.length > 0
                    ? `
                  <h3 style="margin:0 0 10px;color:#fbbf24;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">
                    ⚡ Compromisos para Hoy (${todayItems.length})
                  </h3>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #3f3f46;border-radius:10px;background:#111113;">
                    ${renderRows(todayItems, false)}
                  </table>
                `
                    : ''
                }

                ${
                  overdueItems.length > 0
                    ? `
                  <h3 style="margin:0 0 10px;color:#f87171;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">
                    🚨 Pendientes Vencidos / Sin Ficha (${overdueItems.length})
                  </h3>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #7f1d1d;border-radius:10px;background:#111113;">
                    ${renderRows(overdueItems, true)}
                  </table>
                `
                    : ''
                }

                <div style="margin-top:24px;text-align:center;">
                  <a href="${escapeHtml(calendarUrl)}" target="_blank" style="display:inline-block;padding:14px 26px;background:#f59e0b;color:#09090b;text-decoration:none;font-weight:800;font-size:14px;border-radius:10px;">
                    👉 Abrir Mi Bandeja de Pendientes de Hoy
                  </a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function dispatchCompanyMorningSummary(
  companyId: string,
  targetAdvisorId?: string
): Promise<{ advisorsNotified: number; totalItems: number }> {
  const companyRef = db.collection('companies').doc(companyId);
  const { startOfTodayMs, endOfTodayMs } = getBogotaDayBounds(new Date());
  const lookbackOverdueMs = startOfTodayMs - 14 * 86400000; // Últimos 14 días de vencidos

  // 1. Cargar asesores activos
  const usersSnap = await companyRef.collection('users').get();
  const advisors = new Map<
    string,
    { displayName: string; phone: string | null; email: string | null }
  >();

  for (const uDoc of usersSnap.docs) {
    if (targetAdvisorId && uDoc.id !== targetAdvisorId) continue;
    const d = uDoc.data();
    if (d.active === false) continue;
    const displayName = cleanString(d.displayName) || cleanString(d.name) || cleanString(d.email) || 'Asesor';
    const phone = cleanString(d.phone);
    const emailRaw = cleanString(d.email);
    const email = emailRaw && emailRaw.includes('@') ? emailRaw : null;
    advisors.set(uDoc.id, { displayName, phone, email });
  }

  if (advisors.size === 0) return { advisorsNotified: 0, totalItems: 0 };

  // Completar teléfonos desde advisorWhatsappConnections si algún asesor no lo tiene en users
  const connSnap = await companyRef.collection('advisorWhatsappConnections').get();
  for (const cDoc of connSnap.docs) {
    const adv = advisors.get(cDoc.id);
    if (adv && !adv.phone) {
      adv.phone = cleanString(cDoc.data()?.phone);
    }
  }

  const itemsByAdvisor = new Map<string, AgendaItem[]>();
  const seenLeadToday = new Set<string>();

  // 2. Consultar citas agendadas (hoy o vencidas sin ficha)
  const apptsSnap = await companyRef
    .collection('appointments')
    .where('status', '==', 'scheduled')
    .get();

  for (const aDoc of apptsSnap.docs) {
    const a = aDoc.data();
    if (!a.advisorId || !advisors.has(a.advisorId)) continue;
    if (a.attended !== undefined || a.postCitaStatus === 'reported') continue;

    const startMs = a.startTime?.toMillis?.() ?? 0;
    if (startMs < lookbackOverdueMs || startMs > endOfTodayMs) continue;

    const isOverdue = startMs < startOfTodayMs;
    const list = itemsByAdvisor.get(a.advisorId) ?? [];
    list.push({
      id: aDoc.id,
      leadId: a.leadId || '',
      leadName: a.leadName || a.leadPhone || 'Cliente',
      leadPhone: a.leadPhone || '',
      project: a.project || '',
      action: a.title || 'Cita Comercial',
      timeMs: startMs,
      kind: 'cita',
      isOverdue,
    });
    itemsByAdvisor.set(a.advisorId, list);
    if (a.leadId) seenLeadToday.add(`${a.advisorId}_${a.leadId}`);
  }

  // 3. Consultar seguimientos programados en leads (nextFollowUpDate)
  const leadsSnap = await companyRef
    .collection('leads')
    .where('nextFollowUpDate', '!=', null)
    .get();

  for (const lDoc of leadsSnap.docs) {
    const l = lDoc.data();
    const advId = l.assignedTo;
    if (!advId || !advisors.has(advId)) continue;
    if (seenLeadToday.has(`${advId}_${lDoc.id}`)) continue;

    const dateStr = l.nextFollowUpDate;
    if (!dateStr || typeof dateStr !== 'string') continue;

    const cleanDateStr =
      dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
        ? dateStr
        : (dateStr.trim().includes('T') ? dateStr.trim() : dateStr.trim().replace(' ', 'T')) + '-05:00';
    const parsedMs = Date.parse(cleanDateStr);
    if (Number.isNaN(parsedMs)) continue;
    if (parsedMs < lookbackOverdueMs || parsedMs > endOfTodayMs) continue;

    const isOverdue = parsedMs < startOfTodayMs;
    const list = itemsByAdvisor.get(advId) ?? [];
    list.push({
      id: `rem_${lDoc.id}`,
      leadId: lDoc.id,
      leadName: l.name || l.phone || 'Prospecto',
      leadPhone: l.phone || '',
      project: (l.projectInterest && l.projectInterest[0]) || l.metadata?.project || '',
      action: l.nextFollowUpAction || 'Seguimiento programado',
      timeMs: parsedMs,
      kind: 'seguimiento',
      isOverdue,
    });
    itemsByAdvisor.set(advId, list);
  }

  let advisorsNotified = 0;
  let totalItems = 0;
  const dateLabel = formatLongDate(new Date());
  const calendarUrl = `${env.appBaseUrl()}/dashboard/calendar`;

  // 4. Enviar resumen a cada asesor con tareas pendientes
  for (const [advisorId, rawItems] of itemsByAdvisor.entries()) {
    if (rawItems.length === 0) continue;
    const profile = advisors.get(advisorId)!;

    const todayItems = rawItems.filter((i) => !i.isOverdue).sort((a, b) => a.timeMs - b.timeMs);
    const overdueItems = rawItems.filter((i) => i.isOverdue).sort((a, b) => a.timeMs - b.timeMs);
    const allSorted = [...todayItems, ...overdueItems];
    const firstItem = allSorted[0];
    const firstTimeStr = formatTime(new Date(firstItem.timeMs));

    totalItems += allSorted.length;

    // A) Notificación Push (Móvil + Web)
    try {
      await sendAdvisorPush(companyId, advisorId, {
        title: `☀️ Buenos días ${profile.displayName.split(' ')[0]} · Tu agenda de hoy`,
        body: `Tienes ${todayItems.length} compromiso(s) para hoy${
          overdueItems.length > 0 ? ` y ${overdueItems.length} vencido(s)` : ''
        }. Primero: ${firstTimeStr} con ${firstItem.leadName}.`,
        url: '/dashboard/calendar',
        type: 'morning_agenda',
        leadId: firstItem.leadId,
      });
    } catch (err) {
      logger.warn('[MorningAgenda] Error enviando Push', { advisorId, error: String(err) });
    }

    // B) WhatsApp al celular del asesor
    if (profile.phone) {
      const cleanPhone = normalizePhone(profile.phone);
      const bulletLines = allSorted.slice(0, 8).map((item) => {
        const t = formatTime(new Date(item.timeMs));
        const tag = item.isOverdue ? '🚨 VENCIDO' : `⏰ ${t}`;
        return `• *${tag}* — ${item.leadName} (${item.leadPhone || 's/n'}) · _${item.action}_`;
      });
      if (allSorted.length > 8) {
        bulletLines.push(`_...y ${allSorted.length - 8} más en tu bandeja._`);
      }

      const whatsappText =
        `☀️ *BUENOS DÍAS, ${profile.displayName.toUpperCase()}*\n` +
        `📅 *Resumen de tu Agenda Comercial (${dateLabel})*\n\n` +
        `⚡ *Para Hoy:* ${todayItems.length} compromiso(s)\n` +
        (overdueItems.length > 0 ? `🚨 *Vencidos por evacuar:* ${overdueItems.length}\n` : '') +
        `\n*Tus próximos toques en orden:*\n` +
        bulletLines.join('\n') +
        `\n\n👉 *Evacúa tu bandeja aquí:* ${calendarUrl}`;

      let sentViaBridge = false;
      if (advisorWhatsappBridgeClient.configured()) {
        try {
          await advisorWhatsappBridgeClient.sendMessage({
            companyId,
            advisorId,
            to: cleanPhone,
            content: whatsappText,
          });
          sentViaBridge = true;
        } catch {
          // Caer a plantilla YCloud
        }
      }

      if (!sentViaBridge) {
        try {
          const cfg = await getYcloudConfigForCompany(companyId);
          if (cfg.apiKey) {
            const client = await getYcloudClientForCompany(companyId);
            const templateName = env.advisorReminderTemplate();
            const compactList = allSorted
              .slice(0, 3)
              .map((i) => `${formatTime(new Date(i.timeMs))} ${i.leadName.slice(0, 14)}`)
              .join(' | ');

            const components = [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: profile.displayName.slice(0, 50) },
                  { type: 'text', text: `Resumen del Día (${allSorted.length} pendientes) · 1° ${firstItem.leadName}`.slice(0, 50) },
                  { type: 'text', text: (firstItem.leadPhone || 'Ver bandeja CRM').slice(0, 30) },
                  {
                    type: 'text',
                    text: `${todayItems.length} para hoy${overdueItems.length > 0 ? ` + ${overdueItems.length} en mora` : ''}`.slice(0, 60),
                  },
                  { type: 'text', text: `${dateLabel} · Inicia ${firstTimeStr}`.slice(0, 50) },
                  { type: 'text', text: (firstItem.project || 'Proyectos Meraki').slice(0, 50) },
                  { type: 'text', text: (compactList || 'Revisa tu bandeja en el CRM').slice(0, 100) },
                ],
              },
            ];

            await client.sendTemplate(cleanPhone, templateName, 'es', components);
          }
        } catch (yErr) {
          logger.warn('[MorningAgenda] Error enviando plantilla YCloud matutina', {
            advisorId,
            error: yErr instanceof Error ? yErr.message : String(yErr),
          });
        }
      }
    }

    // C) Correo Electrónico con tabla completa del día
    if (profile.email && env.mailConfigured()) {
      try {
        const transporter = nodemailer.createTransport({
          host: env.smtpHost(),
          port: env.smtpPort(),
          secure: env.smtpSecure(),
          auth: {
            user: env.smtpUser(),
            pass: env.smtpPass(),
          },
        });

        const html = buildMorningEmailHtml({
          advisorName: profile.displayName,
          dateLabel,
          todayItems,
          overdueItems,
          calendarUrl,
        });

        await transporter.sendMail({
          from: env.mailFrom(),
          to: profile.email,
          subject: `☀️ Tu Agenda Comercial de Hoy (${todayItems.length} de hoy${
            overdueItems.length > 0 ? `, ${overdueItems.length} vencidos` : ''
          })`,
          html,
        });
      } catch (mErr) {
        logger.warn('[MorningAgenda] Error enviando correo matutino', {
          advisorId,
          error: mErr instanceof Error ? mErr.message : String(mErr),
        });
      }
    }

    advisorsNotified++;
  }

  logger.info('[MorningAgenda] Resumen matutino despachado', {
    companyId,
    advisorsNotified,
    totalItems,
  });

  return { advisorsNotified, totalItems };
}

/**
 * Cron diario a las 8:00 AM (hora Colombia) de lunes a domingo:
 * Envía a cada asesor su resumen consolidado de citas y seguimientos programados para el día.
 */
export const processMorningAgendaSummary = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'America/Bogota',
    region: 'us-central1',
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async () => {
    const companiesSnap = await db.collection('companies').get();
    for (const compDoc of companiesSnap.docs) {
      try {
        await dispatchCompanyMorningSummary(compDoc.id);
      } catch (err) {
        logger.error('[MorningAgenda] Error procesando compañía', {
          companyId: compDoc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
);

/**
 * Callable manual para que un Administrador (o el propio asesor) dispare su resumen de agenda del día en 1 clic.
 */
export const sendMorningAgendaSummaryNow = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, advisorId } = z
      .object({
        companyId: z.string().min(1),
        advisorId: z.string().optional(),
      })
      .parse(request.data);
    assertCompany(ctx, companyId);

    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);
    const targetId = isAdmin ? (advisorId && advisorId !== 'all' ? advisorId : undefined) : ctx.uid;

    const res = await dispatchCompanyMorningSummary(companyId, targetId);
    return {
      ok: true,
      advisorsNotified: res.advisorsNotified,
      totalItems: res.totalItems,
    };
  }
);
