import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../lib/admin';
import { requireAuth, ADMIN_ROLES } from '../lib/authContext';
import { logger } from '../utils/logger';
import * as XLSX from 'xlsx';

export interface ExportLeadsFilter {
  dateFrom?: string;
  dateTo?: string;
  inbox?: 'all' | 'central_317' | 'advisor_direct' | 'web_form';
  source?: string;
  status?: string;
  advisorId?: string;
  includeArchived?: boolean;
}

function formatBogota(ts: any): string {
  if (!ts) return '';
  try {
    let d: Date;
    if (ts.toDate && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts._seconds) d = new Date(ts._seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false });
  } catch {
    return '';
  }
}

export const exportLeadsReport = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '1GiB' },
  async (request) => {
    const auth = requireAuth(request);
    const companyId = auth.companyId;

    if (!auth.role || !ADMIN_ROLES.includes(auth.role)) {
      throw new HttpsError('permission-denied', 'Solo administradores o managers pueden exportar reportes de leads.');
    }

    const filter: ExportLeadsFilter = request.data?.filter || {};
    logger.info('[exportLeadsReport] Iniciando exportación', { companyId, filter, userId: auth.uid });

    // Cargar nombres de usuarios/asesores para cruzar ID -> Nombre
    const usersMap: Record<string, string> = {};
    try {
      const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
      usersSnap.forEach((uDoc) => {
        const u = uDoc.data();
        usersMap[uDoc.id] = u.displayName || u.email || 'Asesor';
      });
    } catch (err) {
      logger.warn('[exportLeadsReport] Error cargando usuarios para mapeo', { err });
    }

    let query: FirebaseFirestore.Query = db
      .collection('companies').doc(companyId)
      .collection('leads');

    if (filter.inbox && filter.inbox !== 'all') {
      query = query.where('inbox', '==', filter.inbox);
    }

    if (filter.status && filter.status !== 'all') {
      query = query.where('status', '==', filter.status);
    }

    if (filter.advisorId && filter.advisorId !== 'all') {
      query = query.where('assignedTo', '==', filter.advisorId);
    }

    if (filter.includeArchived === false) {
      query = query.where('isArchived', '==', false);
    }

    const snapshot = await query.get();
    logger.info(`[exportLeadsReport] Obtenidos ${snapshot.size} registros base para filtrar en memoria.`);

    const rows: Record<string, any>[] = [];

    const dateFromMs = filter.dateFrom ? new Date(filter.dateFrom).getTime() : null;
    const dateToMs = filter.dateTo ? new Date(filter.dateTo).getTime() : null;

    snapshot.forEach((doc) => {
      const d = doc.data();

      // Filtrado por fecha de creación
      let createdMs: number | null = null;
      if (d.createdAt) {
        if (d.createdAt.toDate) createdMs = d.createdAt.toDate().getTime();
        else if (d.createdAt._seconds) createdMs = d.createdAt._seconds * 1000;
      }

      if (dateFromMs && (!createdMs || createdMs < dateFromMs)) return;
      if (dateToMs && (!createdMs || createdMs > dateToMs)) return;

      if (filter.source && filter.source !== 'all' && d.source !== filter.source) return;

      const meta = d.metadata || {};
      const firstTouch = d.firstTouch || {};
      const lastTouch = d.lastTouch || {};

      const advisorName = d.assignedTo ? (usersMap[d.assignedTo] || d.assignedTo) : 'Sin asignar';

      let inboxLabel = 'Línea Central 317';
      if (d.inbox === 'advisor_direct') inboxLabel = 'WhatsApp Directo Asesor';
      else if (d.inbox === 'web_form') inboxLabel = 'Formulario Web';

      const project = (d.projectInterest && d.projectInterest[0]) || firstTouch.project || meta.webArea || '';

      rows.push({
        'ID Lead': doc.id,
        'Nombre': d.name || 'Sin nombre',
        'Teléfono': d.phone || d.normalizedPhone || '',
        'Línea / Inbox': inboxLabel,
        'Estado': d.status || 'new',
        'Asesor Asignado': advisorName,
        'Proyecto Interés': project,
        'Fuente Original': firstTouch.source || d.source || '',
        'Campaña Original': firstTouch.campaign || meta.metaCampaignName || meta.webUtmCampaign || '',
        'Anuncio / Ad': firstTouch.adName || meta.metaAdName || '',
        'Fuente Reciente': lastTouch.source || d.source || '',
        'Campaña Reciente': lastTouch.campaign || '',
        'GCLID (Google)': firstTouch.gclid || lastTouch.gclid || meta.gclid || meta.webGclid || '',
        'FBCLID (Meta)': firstTouch.fbclid || lastTouch.fbclid || meta.fbclid || meta.webFbclid || '',
        'Fecha Registro (Bogotá)': formatBogota(d.createdAt),
        'Última Interacción (Bogotá)': formatBogota(d.lastMessageAt || d.lastInboundAt || d.updatedAt),
        'Último Mensaje': (d.lastMessageText || '').slice(0, 300),
        'Archivado': d.isArchived ? 'SÍ' : 'NO'
      });
    });

    logger.info(`[exportLeadsReport] Procesadas ${rows.length} filas finales. Generando Excel...`);

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads_Meraki');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const timestamp = Date.now();
    const fileName = `export_leads_${timestamp}.xlsx`;
    const storagePath = `companies/${companyId}/exports/${fileName}`;
    const file = storage.bucket().file(storagePath);

    await file.save(buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      metadata: {
        exportedBy: auth.uid,
        exportedAt: new Date().toISOString(),
        rowsCount: String(rows.length)
      }
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 60 * 1000 // 30 minutos de validez
    });

    logger.info('[exportLeadsReport] Archivo guardado y firmado exitosamente', { storagePath, rowsCount: rows.length });

    return {
      downloadUrl: signedUrl,
      fileName,
      totalRows: rows.length,
      exportedAt: new Date().toISOString()
    };
  }
);
