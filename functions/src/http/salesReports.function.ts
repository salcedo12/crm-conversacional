import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import {
  getSmartHomeSales,
  getSmartHomeProjects,
  getSmartHomeUsers,
  type SmartHomeSaleRecord,
} from '../integrations/smarthome/smarthome.client';
import { logger } from '../utils/logger';

export interface SalesCommissionItem {
  saleId: string;
  prospectId?: string;
  customerId?: string;
  clientName: string;
  documentNumber: string;
  phone: string;
  email: string;
  project: string;
  projectCode: string;
  module: string;
  lotNumber: string;
  sectorStage: string;
  area: number;
  offerPrice: number;
  totalValue: number;
  discount: number;
  deposit: number;
  stage: string;
  cycle: string;
  closeDate: string | null;
  closeMonth: string; // YYYY-MM
  advisorName: string;
  advisorId: string;
  source: string;

  // Comisiones calculadas
  advisorMonthlySalesCount: number;
  captacionRate: number; // e.g. 0.01 (1%)
  lineaRate: number;     // e.g. 0.005 (0.5%)
  cierreRate: number;    // e.g. 0.005 (0.5%)
  directorRate: number;  // 0.005 (0.5% FIJO)
  captacionValue: number;
  lineaValue: number;
  cierreValue: number;
  directorValue: number;
  totalCommissionValue: number;

  // Campos editables guardados en CRM
  agentCr: string;
  agentLinea: string;
  agentCierre: string;
  director: string;
  paymentTerms: string;
  referralApplies: string;
  referralName: string;

  // Estado del documento Word en el CRM
  documentGenerated: boolean;
  documentGeneratedAt: number | null;
  documentGeneratedDateStr: string | null;
  documentUrl: string | null;
  history?: SalesReportDocumentVersion[];
}

export interface SalesReportDocumentVersion {
  id: string;
  clientName: string;
  documentNumber: string;
  deposit: number;
  paymentTerms: string;
  source: string;
  agentCr: string;
  agentLinea: string;
  agentCierre: string;
  director: string;
  referralApplies: string;
  referralName: string;
  createdAt: number;
  createdDateStr: string;
  createdByUid: string;
  createdByName: string;
}

export interface SalesCommissionReportResponse {
  monthKey: string;
  totalSales: number;
  totalVolume: number;
  totalCommissions: number;
  generatedAt: number;
  items: SalesCommissionItem[];
  sales?: SalesCommissionItem[];
}

function parseModuleInfo(moduleName: string): { lotNumber: string; sectorStage: string } {
  const norm = String(moduleName || '').trim();
  // Match patterns like "MAR CANARIAS 053", "LOTE 21 SECTOR TEXAS", "MAR SANTORINI 255"
  const lotMatch = norm.match(/(?:LOTE|NO\.?|#)?\s*(\d+[A-Za-z]?)\b/i);
  const lotNumber = lotMatch ? lotMatch[1] : '';

  let sectorStage = norm;
  if (lotNumber) {
    sectorStage = norm.replace(new RegExp(`\\b${lotNumber}\\b`, 'g'), '').trim();
    sectorStage = sectorStage.replace(/-\s*$/, '').trim();
  }
  return {
    lotNumber: lotNumber || norm,
    sectorStage: sectorStage || norm,
  };
}

function parseDateToMonthKey(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  } catch {
    return '';
  }
}

function formatCurrencyCop(val: number): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return 0;
  return Math.round(val || 0);
}

const GetReportSchema = z.object({
  companyId: z.string().min(1),
  monthKey: z.string().optional().default('all'),
  refresh: z.boolean().optional().default(false),
});

export const getSalesCommissionReport = onCall({ region: 'us-central1' }, async (request) => {
  const auth = requireAuth(request);
  const input = GetReportSchema.parse(request.data);
  assertCompany(auth, input.companyId);
  requireRole(auth, ADMIN_ROLES);

  try {
    // 1. Obtener proyectos, usuarios (para mapear asesores) y ventas de SmartHome
    const [projects, users] = await Promise.all([
      getSmartHomeProjects(input.refresh),
      getSmartHomeUsers(input.refresh),
    ]);

    const userMap = new Map<string, string>();
    (users ?? []).forEach((u) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      if (u.userId && name) userMap.set(u.userId, name);
    });

    let projectCodes = (projects ?? []).map((p) => p.code).filter(Boolean);
    if (projectCodes.length === 0) {
      projectCodes = ['48c9266a', '5ad1b166', '17c89d4e'];
    }

    const salesBatches = await Promise.all(
      projectCodes.map((code) => getSmartHomeSales(code, input.refresh))
    );
    const allSales: SmartHomeSaleRecord[] = salesBatches
      .flatMap((batch) => batch ?? [])
      .filter((s) => Boolean(s.module || s.prospectId));

    // 2. Filtrar ventas cerradas reales (Tienen Fecha de Cierre O etapa de Firma de promesa/Escritura/Cierre/Vendido y valor > 0)
    const closedSales = allSales.filter((sale) => {
      const stage = String(sale.stageName || (sale as any).Etapa_del_Ciclo || '').toUpperCase();
      const hasCloseDate = Boolean(sale.closeDate || (sale as any).Fecha_de_Cierre);
      const val = Number(sale.totalValue ?? sale.offerPrice ?? 0);
      const isClosedStage =
        stage.includes('PROMESA') ||
        stage.includes('ESCRITURA') ||
        stage.includes('CIERRE') ||
        stage.includes('VENDIDO');

      return (hasCloseDate && val > 0) || (isClosedStage && val > 0);
    });

    // 3. Leer registros guardados en Firestore (companies/{companyId}/sales_reports)
    const savedSnap = await db.collection(`companies/${input.companyId}/sales_reports`).get();
    const savedMap = new Map<string, Record<string, any>>();
    savedSnap.forEach((doc) => {
      savedMap.set(doc.id, doc.data());
    });

    // 4. Pre-procesar items y agrupar por mes y asesor para el cálculo escalonado de comisiones
    interface RawItem {
      sale: SmartHomeSaleRecord;
      saleId: string;
      closeDate: string | null;
      closeMonth: string;
      advisorName: string;
      clientName: string;
      totalValue: number;
      deposit: number;
      documentNumber: string;
    }

    const rawItems: RawItem[] = [];
    const seenSaleKeys = new Set<string>();

    for (const sale of closedSales) {
      const saleId = String(
        sale.prospectId || sale.customerId || `${sale.projectCode || ''}-${sale.module || ''}`
      );
      
      // Deduplicar
      const dedupeKey = `${sale.prospectId || ''}_${sale.module || ''}_${sale.firstName || ''}_${sale.lastName || ''}`;
      if (seenSaleKeys.has(dedupeKey)) continue;
      seenSaleKeys.add(dedupeKey);

      // Fecha de cierre real
      const closeDate = (sale.closeDate || (sale as any).Fecha_de_Cierre || null) as string | null;
      if (!closeDate) {
        continue;
      }

      const closeMonth = parseDateToMonthKey(closeDate);

      // Si se especificó filtro de mes y no coincide exactamente año-mes (ej 2026-08), saltar
      if (input.monthKey !== 'all') {
        if (closeMonth !== input.monthKey) {
          continue;
        }
      } else {
        // Si es 'all', limitar al periodo del informe (Julio, Agosto, Septiembre 2026)
        if (closeMonth < '2026-07' || closeMonth > '2026-09') {
          continue;
        }
      }

      // Resolver Documento
      const savedDoc = savedMap.get(saleId);
      const documentNumber = String(
        savedDoc?.documentNumber ||
        sale.identificationNumber ||
        (sale as any).Numero_Identificacion ||
        ''
      ).trim();

      // Resolver Asesor cruzando ownerId / sellerId con userMap
      const advisorFromUserMap =
        userMap.get(String(sale.ownerId || '')) ||
        userMap.get(String(sale.sellerId || '')) ||
        userMap.get(String((sale as any).userId || ''));

      const advisorName = String(
        savedDoc?.advisorName ||
        advisorFromUserMap ||
        sale.advisorName ||
        sale.ownerName ||
        sale.sellerName ||
        'Sin asesor'
      ).trim();

      // Resolver Nombre del Cliente
      const clientName = String(
        savedDoc?.clientName ||
        `${sale.firstName || ''} ${sale.lastName || ''}`.trim() ||
        (sale as any).Nombre_del_Cliente ||
        (sale as any).customerName ||
        (sale as any).name ||
        'Cliente sin nombre'
      ).trim();

      const totalValRaw = Number(
        savedDoc?.totalValue ??
        sale.totalValue ??
        sale.offerPrice ??
        0
      );
      const totalValue = isNaN(totalValRaw) || totalValRaw <= 0 ? 0 : totalValRaw;
      const depRaw = Number(savedDoc?.deposit ?? sale.deposit ?? 6000000);
      const deposit = isNaN(depRaw) || depRaw < 0 ? 0 : depRaw;

      rawItems.push({
        sale,
        saleId,
        closeDate,
        closeMonth,
        advisorName,
        clientName,
        totalValue,
        deposit,
        documentNumber,
      });
    }

    // Contar ventas por asesor por mes para aplicar escala
    const advisorMonthlyCount = new Map<string, number>();
    for (const it of rawItems) {
      const key = `${it.closeMonth}_${it.advisorName.toLowerCase()}`;
      advisorMonthlyCount.set(key, (advisorMonthlyCount.get(key) || 0) + 1);
    }

    // 6. Construir lista final con comisiones y campos guardados
    let totalCommissionsSum = 0;
    let totalVolumeSum = 0;

    const items: SalesCommissionItem[] = rawItems.map((it) => {
      const { sale, saleId, closeDate, closeMonth, advisorName, clientName, totalValue, deposit, documentNumber } = it;
      const saved = savedMap.get(saleId) || {};
      const { lotNumber, sectorStage } = parseModuleInfo(String(sale.module || ''));

      const key = `${closeMonth}_${advisorName.toLowerCase()}`;
      const salesCount = advisorMonthlyCount.get(key) || 1;

      // Escala oficial de comisiones (porcentaje del asesor):
      // Venta de 0–1 lotes: 2.0% (Captación 1.0%, Línea 0.5%, Cierre 0.5%)
      // Venta de 2–3 unidades: 3.5% (Captación 1.75%, Línea 0.875%, Cierre 0.875%)
      // Venta de 4–6 unidades: 4.0% (Captación 2.0%, Línea 1.0%, Cierre 1.0%)
      // Venta de 7–10 unidades: 4.5% (Captación 2.25%, Línea 1.125%, Cierre 1.125%)
      // 10+ unidades: 5.0% (Captación 2.5%, Línea 1.25%, Cierre 1.25%)
      // Director: 0.5% FIJO
      let captacionRate = 0.01;
      let lineaRate = 0.005;
      let cierreRate = 0.005;

      if (salesCount >= 2 && salesCount <= 3) {
        captacionRate = 0.0175;
        lineaRate = 0.00875;
        cierreRate = 0.00875;
      } else if (salesCount >= 4 && salesCount <= 6) {
        captacionRate = 0.02;
        lineaRate = 0.01;
        cierreRate = 0.01;
      } else if (salesCount >= 7 && salesCount <= 10) {
        captacionRate = 0.0225;
        lineaRate = 0.01125;
        cierreRate = 0.01125;
      } else if (salesCount > 10) {
        captacionRate = 0.025;
        lineaRate = 0.0125;
        cierreRate = 0.0125;
      }

      const directorRate = 0.005; // 0.5% FIJO

      const captacionValue = formatCurrencyCop(totalValue * captacionRate);
      const lineaValue = formatCurrencyCop(totalValue * lineaRate);
      const cierreValue = formatCurrencyCop(totalValue * cierreRate);
      const directorValue = formatCurrencyCop(totalValue * directorRate);
      const totalCommissionValue = captacionValue + lineaValue + cierreValue + directorValue;

      totalCommissionsSum += totalCommissionValue;
      totalVolumeSum += totalValue;

      const source = String(saved.source || sale.locationSource || (sale as any).Fuente_de_Ubicacion_Cliente || 'CORFERIAS AGOSTO 2026').trim();

      // Metadatos de documento guardado en CRM
      const documentGeneratedAt = saved.documentGeneratedAt
        ? (typeof saved.documentGeneratedAt.toMillis === 'function'
            ? saved.documentGeneratedAt.toMillis()
            : saved.documentGeneratedAt)
        : null;

      const documentGeneratedDateStr = documentGeneratedAt
        ? new Date(documentGeneratedAt).toLocaleString('es-CO', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;

      return {
        saleId,
        prospectId: sale.prospectId as string | undefined,
        customerId: sale.customerId as string | undefined,
        clientName: saved.clientName || clientName,
        documentNumber,
        phone: String(sale.mobileNumber || sale.phoneNumber || '').trim(),
        email: String(sale.email || '').trim(),
        project: String(sale.project || 'Ciudad Country Laguna Mar').trim(),
        projectCode: String(sale.projectCode || '48c9266a').trim(),
        module: String(sale.module || '').trim(),
        lotNumber,
        sectorStage,
        area: Number(sale.area ?? 0),
        offerPrice: Number(sale.offerPrice ?? totalValue),
        totalValue,
        discount: Number(sale.discount ?? sale.totalDiscount ?? 0),
        deposit: Number(saved.deposit ?? deposit ?? sale.deposit ?? 0),
        stage: String(sale.stageName || 'Firma de promesa').trim(),
        cycle: String(sale.saleCycleName || 'CIERRE').trim(),
        closeDate,
        closeMonth,
        advisorName,
        advisorId: String(sale.ownerId || sale.sellerId || ''),
        source: saved.source || source,

        advisorMonthlySalesCount: salesCount,
        captacionRate,
        lineaRate,
        cierreRate,
        directorRate,
        captacionValue,
        lineaValue,
        cierreValue,
        directorValue,
        totalCommissionValue,

        // Campos editables (vacíos por defecto para agentes, director fijo)
        agentCr: saved.agentCr || '',
        agentLinea: saved.agentLinea || '',
        agentCierre: saved.agentCierre || '',
        director: saved.director || 'Claudia bolaños',
        paymentTerms: String(saved.paymentTerms || '24'),
        referralApplies: saved.referralApplies || 'N/A',
        referralName: saved.referralName || 'N/A',

        // Estado del documento
        documentGenerated: Boolean(documentGeneratedAt),
        documentGeneratedAt,
        documentGeneratedDateStr,
        documentUrl: saved.documentUrl || null,
        history: Array.isArray(saved.history) ? saved.history : [],
      };
    });

    // Ordenar por fecha de cierre descendente
    items.sort((a, b) => String(b.closeDate ?? '').localeCompare(String(a.closeDate ?? '')));

    const response: SalesCommissionReportResponse = {
      monthKey: input.monthKey,
      totalSales: items.length,
      totalVolume: totalVolumeSum,
      totalCommissions: totalCommissionsSum,
      generatedAt: Date.now(),
      items,
      sales: items,
    };

    return response;
  } catch (err) {
    logger.error('[getSalesCommissionReport] error:', { error: err instanceof Error ? err.message : String(err) });
    throw new HttpsError('internal', 'Error generando el reporte de comisiones de venta.');
  }
});

const SaveDocumentSchema = z.object({
  companyId: z.string().min(1),
  saleId: z.string().min(1),
  monthKey: z.string().optional(),
  module: z.string().optional(),
  clientName: z.string().optional(),
  documentNumber: z.string().optional(),
  deposit: z.number().optional(),
  paymentTerms: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
  agentCr: z.string().optional(),
  agentLinea: z.string().optional(),
  agentCierre: z.string().optional(),
  director: z.string().optional(),
  referralApplies: z.string().optional(),
  referralName: z.string().optional(),
  createdByName: z.string().optional(),
  documentUrl: z.string().optional().nullable(),
});

export const saveSalesReportDocument = onCall({ region: 'us-central1' }, async (request) => {
  const auth = requireAuth(request);
  const input = SaveDocumentSchema.parse(request.data);
  assertCompany(auth, input.companyId);
  requireRole(auth, ADMIN_ROLES);

  try {
    const docRef = db.doc(`companies/${input.companyId}/sales_reports/${input.saleId}`);
    const now = Timestamp.now();
    const existingSnap = await docRef.get();
    const existingDoc = existingSnap.exists ? existingSnap.data() || {} : {};
    const existingHistory: SalesReportDocumentVersion[] = Array.isArray(existingDoc.history) ? existingDoc.history : [];

    const createdByName = String(
      input.createdByName ||
      (request.auth?.token?.name as string) ||
      (request.auth?.token?.email as string) ||
      'Claudia Patricia Bolaños Vega'
    ).trim();

    const versionId = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdDateStr = new Date(now.toMillis()).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const newVersion: SalesReportDocumentVersion = {
      id: versionId,
      clientName: input.clientName ?? '',
      documentNumber: input.documentNumber ?? '',
      deposit: input.deposit ?? 0,
      paymentTerms: String(input.paymentTerms ?? '24'),
      source: input.source ?? '',
      agentCr: input.agentCr ?? '',
      agentLinea: input.agentLinea ?? '',
      agentCierre: input.agentCierre ?? '',
      director: input.director ?? 'Claudia bolaños',
      referralApplies: input.referralApplies ?? 'N/A',
      referralName: input.referralName ?? 'N/A',
      createdAt: now.toMillis(),
      createdDateStr,
      createdByUid: auth.uid,
      createdByName,
    };

    const updatedHistory = [newVersion, ...existingHistory];

    const dataToSave = {
      saleId: input.saleId,
      companyId: input.companyId,
      monthKey: input.monthKey ?? '',
      module: input.module ?? '',
      clientName: input.clientName ?? '',
      documentNumber: input.documentNumber ?? '',
      deposit: input.deposit ?? 0,
      paymentTerms: String(input.paymentTerms ?? '24'),
      source: input.source ?? '',
      agentCr: input.agentCr ?? '',
      agentLinea: input.agentLinea ?? '',
      agentCierre: input.agentCierre ?? '',
      director: input.director ?? 'Claudia bolaños',
      referralApplies: input.referralApplies ?? 'N/A',
      referralName: input.referralName ?? 'N/A',
      documentUrl: input.documentUrl ?? null,
      documentGeneratedAt: now,
      history: updatedHistory,
      updatedAt: now,
      updatedBy: auth.uid,
    };

    await docRef.set(dataToSave, { merge: true });

    return {
      ok: true,
      saleId: input.saleId,
      version: newVersion,
      history: updatedHistory,
      documentGeneratedAt: now.toMillis(),
      documentGeneratedDateStr: createdDateStr,
    };
  } catch (err) {
    logger.error('[saveSalesReportDocument] error:', { error: err instanceof Error ? err.message : String(err) });
    throw new HttpsError('internal', 'Error guardando el documento del reporte de venta.');
  }
});

const DeleteVersionSchema = z.object({
  companyId: z.string().min(1),
  saleId: z.string().min(1),
  versionId: z.string().min(1),
});

export const deleteSalesReportVersion = onCall({ region: 'us-central1' }, async (request) => {
  const auth = requireAuth(request);
  const input = DeleteVersionSchema.parse(request.data);
  assertCompany(auth, input.companyId);
  requireRole(auth, ADMIN_ROLES);

  try {
    const docRef = db.doc(`companies/${input.companyId}/sales_reports/${input.saleId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      return { ok: true, saleId: input.saleId, history: [], documentGenerated: false };
    }

    const data = snap.data() || {};
    const history: SalesReportDocumentVersion[] = Array.isArray(data.history) ? data.history : [];
    const updatedHistory = history.filter((v) => v.id !== input.versionId);

    const updatePayload: Record<string, any> = {
      history: updatedHistory,
      updatedAt: Timestamp.now(),
      updatedBy: auth.uid,
    };

    if (updatedHistory.length === 0) {
      updatePayload.documentGeneratedAt = null;
    } else {
      updatePayload.documentGeneratedAt = Timestamp.fromMillis(updatedHistory[0].createdAt);
    }

    await docRef.update(updatePayload);

    return {
      ok: true,
      saleId: input.saleId,
      history: updatedHistory,
      documentGenerated: updatedHistory.length > 0,
      documentGeneratedAt: updatedHistory.length > 0 ? updatedHistory[0].createdAt : null,
      documentGeneratedDateStr: updatedHistory.length > 0 ? updatedHistory[0].createdDateStr : null,
    };
  } catch (err) {
    logger.error('[deleteSalesReportVersion] error:', { error: err instanceof Error ? err.message : String(err) });
    throw new HttpsError('internal', 'Error eliminando la versión del reporte.');
  }
});
