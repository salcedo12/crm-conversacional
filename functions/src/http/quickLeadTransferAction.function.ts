import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { transferRequestsCol, executeResolveLeadTransferRequest } from '../modules/leads/leadTransfer.service';
import { sendTransferResolutionConfirmationWhatsapp } from '../modules/leads/leadTransferAlert.service';

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return 'Fecha no disponible';
  try {
    return new Date(ts.toMillis()).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Fecha no disponible';
  }
}

function baseHtmlPage(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${escapeHtml(title)} - Meraki CRM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0b0d11;
      color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 16px;
      padding-top: max(20px, env(safe-area-inset-top));
      padding-bottom: max(24px, env(safe-area-inset-bottom));
    }
    .container {
      width: 100%;
      max-width: 480px;
      background: #14171f;
      border: 1px solid #272a34;
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid #232733;
    }
    .header-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #eab30820;
      color: #eab308;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
    }
    .header-sub {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 2px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 8px;
      margin-left: auto;
    }
    .badge-pending {
      background: #f59e0b25;
      color: #fbbf24;
      border: 1px solid #f59e0b40;
    }
    .badge-approved {
      background: #10b98125;
      color: #34d399;
      border: 1px solid #10b98140;
    }
    .badge-rejected {
      background: #ef444425;
      color: #f87171;
      border: 1px solid #ef444440;
    }
    .card {
      background: #191d27;
      border: 1px solid #262a38;
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .card-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .lead-name {
      font-size: 17px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .lead-info-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .lead-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #cbd5e1;
      text-decoration: none;
      background: #232838;
      padding: 3px 8px;
      border-radius: 8px;
    }
    .lead-pill:hover { background: #2f354a; }
    .advisor-box {
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .current-advisor-box {
      background: #181412;
      border: 1px solid #78350f50;
    }
    .current-advisor-label {
      color: #f59e0b;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .new-advisor-box {
      background: #0f1c24;
      border: 1px solid #0284c750;
    }
    .new-advisor-label {
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .advisor-name {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
    }
    .advisor-sub {
      font-size: 12px;
      margin-top: 4px;
      line-height: 1.3;
    }
    .reason-box {
      background: #0d121c;
      border: 1px solid #1e2638;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      color: #e2e8f0;
      font-style: italic;
      margin-top: 6px;
    }
    .form-group {
      margin-top: 16px;
      margin-bottom: 16px;
    }
    .form-input {
      width: 100%;
      background: #0d0f14;
      border: 1px solid #272a36;
      border-radius: 10px;
      color: #ffffff;
      padding: 10px 12px;
      font-size: 13px;
      outline: none;
    }
    .form-input:focus {
      border-color: #3b82f6;
    }
    .actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 14px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 13px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: opacity 0.15s, transform 0.1s;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:active {
      transform: scale(0.97);
    }
    .btn-approve {
      background: #059669;
      color: #ffffff;
    }
    .btn-approve:hover { background: #10b981; }
    .btn-reject {
      background: #88133750;
      border: 1px solid #f43f5e50;
      color: #fda4af;
    }
    .btn-reject:hover { background: #88133780; }
    .btn-crm {
      background: #1f2937;
      border: 1px solid #374151;
      color: #e5e7eb;
      width: 100%;
      margin-top: 12px;
    }
    .result-icon {
      font-size: 48px;
      text-align: center;
      margin: 10px 0 16px;
    }
    .result-title {
      font-size: 18px;
      font-weight: 700;
      text-align: center;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .result-text {
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.4;
      margin-bottom: 18px;
    }
    .loading-overlay {
      display: none;
      text-align: center;
      padding: 20px;
      color: #38bdf8;
      font-size: 14px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    ${bodyContent}
  </div>
</body>
</html>`;
}

/**
 * Endpoint web público y seguro para que la Dirección Comercial (Eduardo Salcedo)
 * apruebe o rechace traslados directamente desde su iPhone con 1 toque.
 */
export const quickLeadTransferAction = onRequest(
  {
    region: 'us-central1',
    cors: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    invoker: 'public',
  },
  async (req, res) => {
    // 1. Obtener parámetros (soportando GET o POST)
    const companyId = String(req.query.companyId || req.body?.companyId || '').trim();
    const requestId = String(req.query.id || req.body?.id || '').trim();
    const token = String(req.query.token || req.body?.token || '').trim();

    if (!companyId || !requestId || !token) {
      res.status(400).send(
        baseHtmlPage(
          'Error',
          `<div class="result-icon">⚠️</div>
           <div class="result-title">Enlace incompleto</div>
           <p class="result-text">El enlace de traslado no contiene los identificadores de seguridad requeridos.</p>
           <a href="https://crm.grupoconstructormeraki.com.co" class="btn btn-crm">Ir al CRM</a>`
        )
      );
      return;
    }

    try {
      const reqRef = transferRequestsCol(companyId).doc(requestId);
      const reqSnap = await reqRef.get();
      if (!reqSnap.exists) {
        res.status(404).send(
          baseHtmlPage(
            'No encontrado',
            `<div class="result-icon">🔍</div>
             <div class="result-title">Solicitud no encontrada</div>
             <p class="result-text">Esta solicitud de traslado ya no existe en el sistema.</p>
             <a href="https://crm.grupoconstructormeraki.com.co" class="btn btn-crm">Ir al CRM</a>`
          )
        );
        return;
      }

      const reqData = reqSnap.data() ?? {};

      // Validar token de seguridad contra el actionToken generado
      if (!reqData.actionToken || reqData.actionToken !== token) {
        res.status(403).send(
          baseHtmlPage(
            'No autorizado',
            `<div class="result-icon">🔒</div>
             <div class="result-title">Enlace no autorizado</div>
             <p class="result-text">El token de autorización es inválido o ha caducado.</p>
             <a href="https://crm.grupoconstructormeraki.com.co" class="btn btn-crm">Ir al CRM</a>`
          )
        );
        return;
      }

      // ── MANEJO DE POST (APROBACIÓN O RECHAZO EN 1 TOQUE) ───────────────────
      if (req.method === 'POST') {
        const action = (req.body?.action || req.query.action || 'approve') as 'approve' | 'reject';
        const adminNote = String(req.body?.adminNote || req.query.adminNote || '').trim() || null;

        if (action !== 'approve' && action !== 'reject') {
          res.status(400).send('Acción inválida');
          return;
        }

        const resolveResult = await executeResolveLeadTransferRequest({
          companyId,
          requestId,
          action,
          adminNote,
          resolvedById: 'quick_whatsapp_action',
          resolvedByName: 'Eduardo Salcedo (WhatsApp)',
        });

        // Enviar confirmación por WhatsApp a Eduardo
        sendTransferResolutionConfirmationWhatsapp({
          companyId,
          requestId,
          action,
          leadName: reqData.leadName || 'Prospecto',
          leadPhone: reqData.leadPhone,
          newAdvisorName: resolveResult.newAdvisorName || reqData.requesterName,
          resolvedByName: 'Eduardo Salcedo',
        }).catch(() => {});

        if (action === 'approve') {
          res.send(
            baseHtmlPage(
              '¡Traslado Aprobado!',
              `<div class="result-icon">🎉</div>
               <div class="result-title">¡Traslado Aprobado Exitosamente!</div>
               <p class="result-text">
                 El prospecto <strong>${escapeHtml(reqData.leadName)}</strong> (${escapeHtml(reqData.leadPhone)})
                 ha sido reasignado a <strong>${escapeHtml(resolveResult.newAdvisorName || reqData.requesterName)}</strong>.
                 Se actualizaron las bitácoras y se notificó a los asesores.
               </p>
               <a href="https://crm.grupoconstructormeraki.com.co/dashboard/commercial" class="btn btn-crm">Abrir CRM Meraki</a>`
            )
          );
        } else {
          res.send(
            baseHtmlPage(
              'Traslado Rechazado',
              `<div class="result-icon">❌</div>
               <div class="result-title">Solicitud de Traslado Rechazada</div>
               <p class="result-text">
                 La solicitud para el prospecto <strong>${escapeHtml(reqData.leadName)}</strong> fue rechazada.
                 El cliente permanece bajo la atención de <strong>${escapeHtml(reqData.currentAdvisorName)}</strong>.
               </p>
               <a href="https://crm.grupoconstructormeraki.com.co/dashboard/commercial" class="btn btn-crm">Abrir CRM Meraki</a>`
            )
          );
        }
        return;
      }

      // ── MANEJO DE GET (MOSTRAR PANTALLA DE REVISIÓN Y DECISIÓN) ───────────

      // Si ya fue resuelta anteriormente:
      if (reqData.status !== 'pending') {
        const isApp = reqData.status === 'approved';
        res.send(
          baseHtmlPage(
            'Solicitud Ya Resuelta',
            `<div class="header">
               <div class="header-icon">🔄</div>
               <div>
                 <div class="header-title">Solicitud de Traslado</div>
                 <div class="header-sub">Meraki CRM</div>
               </div>
               <div class="badge ${isApp ? 'badge-approved' : 'badge-rejected'}">
                 ${isApp ? '✅ Aprobada' : '❌ Rechazada'}
               </div>
             </div>

             <div class="card">
               <div class="card-title">PROSPECTO</div>
               <div class="lead-name">${escapeHtml(reqData.leadName)}</div>
               <div class="lead-info-row">
                 <span class="lead-pill">📞 ${escapeHtml(reqData.leadPhone)}</span>
                 ${reqData.project ? `<span class="lead-pill">🏡 ${escapeHtml(reqData.project)}</span>` : ''}
               </div>
             </div>

             <div class="card">
               <div class="card-title">ESTADO DE LA RESOLUCIÓN</div>
               <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-top: 4px;">
                 Esta solicitud ya fue procesada anteriormente:<br>
                 • <strong>Decisión:</strong> ${isApp ? 'Aprobada' : 'Rechazada'}<br>
                 • <strong>Resuelta por:</strong> ${escapeHtml(reqData.resolvedByName || 'Administrador')}<br>
                 • <strong>Fecha:</strong> ${formatDate(reqData.resolvedAt)}<br>
                 ${isApp && reqData.finalAssignedName ? `• <strong>Asesor Asignado:</strong> ${escapeHtml(reqData.finalAssignedName)}<br>` : ''}
                 ${reqData.adminNote ? `• <strong>Nota Admin:</strong> <em>"${escapeHtml(reqData.adminNote)}"</em><br>` : ''}
               </div>
             </div>

             <a href="https://crm.grupoconstructormeraki.com.co/dashboard/commercial" class="btn btn-crm">Abrir CRM Meraki</a>`
          )
        );
        return;
      }

      // Auditoría de seguimiento
      let followUpHtml = '<span style="color: #fbbf24; font-weight: bold;">Nunca ha registrado seguimiento ni bitácora</span>';
      if (reqData.daysSinceFollowUp !== null && reqData.daysSinceFollowUp !== undefined) {
        if (reqData.daysSinceFollowUp === 0) {
          followUpHtml = '<span style="color: #34d399; font-weight: bold;">Hoy (Al día)</span>';
        } else {
          followUpHtml = `<span style="color: #f87171; font-weight: bold;">Hace ${reqData.daysSinceFollowUp} días</span>${
            reqData.lastFollowUpSummary ? ` (${escapeHtml(reqData.lastFollowUpSummary)})` : ''
          }`;
        }
      } else if (reqData.lastFollowUpSummary) {
        followUpHtml = escapeHtml(reqData.lastFollowUpSummary);
      }

      // Pantalla activa para decidir
      res.send(
        baseHtmlPage(
          'Aprobar Traslado',
          `<div class="header">
             <div class="header-icon">🔄</div>
             <div>
               <div class="header-title">Solicitud de Traslado</div>
               <div class="header-sub">Dirección Comercial · Meraki</div>
             </div>
             <div class="badge badge-pending">⏳ Pendiente</div>
           </div>

           <!-- Tarjeta del Prospecto -->
           <div class="card">
             <div class="card-title">PROSPECTO A TRASLADAR</div>
             <div class="lead-name">${escapeHtml(reqData.leadName)}</div>
             <div class="lead-info-row">
               <a href="tel:${escapeHtml(reqData.leadPhone)}" class="lead-pill">📞 ${escapeHtml(reqData.leadPhone)}</a>
               <a href="https://wa.me/${escapeHtml(reqData.leadPhone?.replace(/\\D/g, ''))}" target="_blank" class="lead-pill">💬 WhatsApp</a>
               ${reqData.project ? `<span class="lead-pill">🏡 ${escapeHtml(reqData.project)}</span>` : ''}
             </div>
           </div>

           <!-- Asesor actual -->
           <div class="advisor-box current-advisor-box">
             <div class="current-advisor-label">
               <span>ASESOR ACTUAL ASIGNADO</span>
               <span style="font-size: 10px; background: #78350f60; padding: 2px 6px; border-radius: 4px;">Auditoría</span>
             </div>
             <div class="advisor-name">${escapeHtml(reqData.currentAdvisorName || 'Sin Asignar')}</div>
             <div class="advisor-sub">
               Último seguimiento: ${followUpHtml}
             </div>
           </div>

           <!-- Asesor solicitante -->
           <div class="advisor-box new-advisor-box">
             <div class="new-advisor-label">
               <span>ASESOR QUE SOLICITA EL TRASLADO</span>
               <span style="font-size: 10px; background: #0369a160; padding: 2px 6px; border-radius: 4px;">Solicitante</span>
             </div>
             <div class="advisor-name">${escapeHtml(reqData.requesterName || 'Asesor')}</div>
             ${reqData.targetAdvisorName ? `<div style="font-size: 12px; color: #bae6fd; margin-top: 3px;">Para asignar a: <strong>${escapeHtml(reqData.targetAdvisorName)}</strong></div>` : ''}
             <div class="reason-box">
               "${escapeHtml(reqData.reason || 'Sin motivo reportado')}"
             </div>
           </div>

           <!-- Formulario de decisión rápida -->
           <form id="actionForm" method="POST" action="https://us-central1-crm-conversacional.cloudfunctions.net/quickLeadTransferAction">
             <input type="hidden" name="companyId" value="${escapeHtml(companyId)}">
             <input type="hidden" name="id" value="${escapeHtml(requestId)}">
             <input type="hidden" name="token" value="${escapeHtml(token)}">

             <div class="form-group">
               <input
                 type="text"
                 name="adminNote"
                 id="adminNote"
                 class="form-input"
                 placeholder="Nota opcional del Administrador (queda en bitácora)..."
                 autocomplete="off"
               >
             </div>

             <div class="actions-grid" id="buttonsGrid">
               <button type="submit" name="action" value="reject" class="btn btn-reject" onclick="this.form.actionVal='reject'">
                 ❌ Rechazar
               </button>
               <button type="submit" name="action" value="approve" class="btn btn-approve" onclick="this.form.actionVal='approve'">
                 ✅ Aprobar Traslado
               </button>
             </div>

             <div class="loading-overlay" id="loadingOverlay">
               ⏳ Procesando decisión comercial...
             </div>
           </form>

           <script>
             const form = document.getElementById('actionForm');
             const btns = document.getElementById('buttonsGrid');
             const loading = document.getElementById('loadingOverlay');

             form.addEventListener('submit', function(e) {
               // Crear input oculto con la acción seleccionada
               if (form.actionVal) {
                 const hidden = document.createElement('input');
                 hidden.type = 'hidden';
                 hidden.name = 'action';
                 hidden.value = form.actionVal;
                 form.appendChild(hidden);
               }
               btns.style.display = 'none';
               loading.style.display = 'block';
             });
           </script>`
        )
      );
    } catch (err) {
      logger.error('[quickLeadTransferAction] Error procesando solicitud', {
        companyId,
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(
        baseHtmlPage(
          'Error',
          `<div class="result-icon">⚠️</div>
           <div class="result-title">Error del Sistema</div>
           <p class="result-text">${escapeHtml(err instanceof Error ? err.message : 'No se pudo procesar la solicitud.')}</p>
           <a href="https://crm.grupoconstructormeraki.com.co" class="btn btn-crm">Ir al CRM</a>`
        )
      );
    }
  }
);
