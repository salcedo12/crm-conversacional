import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { appointmentsRepository } from '../modules/appointments/appointments.repository';
import { isExcludedFromLeadAssignment } from '../modules/leads/leadAssignment.service';
import { getSmartHomeSales } from '../integrations/smarthome/smarthome.client';
import { logger } from '../utils/logger';

export interface CommercialGoalConfig {
  citasTarget: number;
  visitasTarget: number;
  ventasTarget: number;
  gestionesTarget: number;
}

export interface AdvisorGoalItem {
  citasTarget?: number;
  visitasTarget?: number;
  ventasTarget?: number;
  gestionesTarget?: number;
}

export interface AdvisorLeaderboardItem {
  advisorId: string;
  advisorName: string;
  email: string;
  photoUrl?: string | null;
  role: string;
  rank: number;
  score: number;
  targets: CommercialGoalConfig;
  actuals: {
    citas: number;
    visitas: number;
    ventas: number;
    gestiones: number;
  };
  percentages: {
    citasPct: number;
    visitasPct: number;
    ventasPct: number;
    gestionesPct: number;
    averageCompletionPct: number;
  };
  badges: string[];
}

export interface CommercialLeaderboardResponse {
  monthKey: string;
  monthLabel: string;
  defaultGoals: CommercialGoalConfig;
  advisorGoals: Record<string, AdvisorGoalItem>;
  companyTotals: {
    totalCitas: number;
    totalVisitas: number;
    totalVentas: number;
    totalGestiones: number;
    targetCitas: number;
    targetVisitas: number;
    targetVentas: number;
    targetGestiones: number;
    overallCompletionPct: number;
  };
  leaderboard: AdvisorLeaderboardItem[];
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function getBogotaMonthKey(): string {
  const now = new Date();
  const bogotaFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  });
  return bogotaFormatter.format(now); // "YYYY-MM"
}

// ─── getCommercialLeaderboard ──────────────────────────────────────────────────
// Consulta el ranking y progreso comercial mensual de todo el equipo de ventas.
export const getCommercialLeaderboard = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (request): Promise<CommercialLeaderboardResponse> => {
    const ctx = requireAuth(request);
    const { companyId, monthKey: inputMonthKey } = z.object({
      companyId: z.string().min(1),
      monthKey:  z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    const monthKey = inputMonthKey || getBogotaMonthKey();
    const [year, month] = monthKey.split('-').map(Number);
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

    // Rango de fechas del mes (inicio y fin en hora Colombia UTC-5)
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 5, 0, 0)); // 00:00 Col = 05:00 UTC
    const endOfMonth = new Date(Date.UTC(year, month, 1, 4, 59, 59, 999));
    const startTs = Timestamp.fromDate(startOfMonth);
    const endTs = Timestamp.fromDate(endOfMonth);

    // 1. Cargar metas configuradas en companies/{companyId}/config/commercialGoals
    const goalDoc = await db.collection('companies').doc(companyId).collection('config').doc('commercialGoals').get();
    const goalData = goalDoc.exists ? goalDoc.data() : {};

    const defaultGoals: CommercialGoalConfig = {
      citasTarget:     Number(goalData?.defaultGoals?.citasTarget) || 15,
      visitasTarget:   Number(goalData?.defaultGoals?.visitasTarget) || 6,
      ventasTarget:    Number(goalData?.defaultGoals?.ventasTarget) || 2,
      gestionesTarget: Number(goalData?.defaultGoals?.gestionesTarget) || 40,
    };

    const advisorGoalsMap: Record<string, AdvisorGoalItem> = goalData?.advisorGoals || {};

    // 2. Cargar asesores y usuarios comerciales
    const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
    const advisorsMap = new Map<string, { id: string; name: string; email: string; photoUrl: string | null; role: string }>();

    usersSnap.docs.forEach((d) => {
      const u = d.data();
      const role = u.role || 'advisor';
      // Incluir usuarios con rol asesor, manager o admin (excluyendo cuentas de pruebas)
      if (u.disabled || isExcludedFromLeadAssignment(d.id, u)) return;
      advisorsMap.set(d.id, {
        id: d.id,
        name: (u.displayName as string) || (u.email as string) || 'Asesor',
        email: (u.email as string) || '',
        photoUrl: (u.photoURL as string) || null,
        role,
      });
    });

    // 3. Consultar Citas en el rango del mes
    let apptsList: any[] = [];
    try {
      apptsList = await appointmentsRepository.listInRange(companyId, startOfMonth, endOfMonth);
    } catch (err) {
      logger.warn('[commercialLeaderboard] Error cargando appointments:', { error: String(err) });
    }

    const citasByAdvisor = new Map<string, number>();
    const visitasByAdvisor = new Map<string, number>();

    apptsList.forEach((a) => {
      const advId = a.advisorId;
      if (!advId) return;
      const isVisita = (a.title || '').toLowerCase().includes('terreno') || (a.title || '').toLowerCase().includes('visita');
      if (isVisita) {
        visitasByAdvisor.set(advId, (visitasByAdvisor.get(advId) || 0) + 1);
      } else {
        citasByAdvisor.set(advId, (citasByAdvisor.get(advId) || 0) + 1);
      }
    });

    // 4. Consultar Notas de Ficha Técnica / Gestiones en el mes vía collectionGroup
    const gestionesByAdvisor = new Map<string, number>();
    try {
      const notesSnap = await db.collectionGroup('notes')
        .where('companyId', '==', companyId)
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<=', endTs)
        .get();

      notesSnap.docs.forEach((nd) => {
        const n = nd.data();
        const authorId = n.authorId;
        if (!authorId) return;
        gestionesByAdvisor.set(authorId, (gestionesByAdvisor.get(authorId) || 0) + 1);

        // Si la nota fue una visita a terreno registrada en ficha, sumarla si no vino de appointment
        if (n.actionType === 'visita_terreno') {
          visitasByAdvisor.set(authorId, (visitasByAdvisor.get(authorId) || 0) + 1);
        } else if (n.actionType === 'cita_reunion') {
          citasByAdvisor.set(authorId, (citasByAdvisor.get(authorId) || 0) + 1);
        }
      });
    } catch (err) {
      logger.warn('[commercialLeaderboard] Fallback consultando notas:', { error: String(err) });
    }

    // 5. Consultar Ventas / Cierres en el mes
    const ventasByAdvisor = new Map<string, number>();

    // 5a. Ventas desde leads cerrados en CRM
    try {
      const closedLeadsSnap = await db.collection('companies').doc(companyId).collection('leads')
        .where('pipelineStage', '==', 'cerrado_ganado')
        .get();

      closedLeadsSnap.docs.forEach((ld) => {
        const lead = ld.data();
        const advId = lead.assignedTo;
        if (!advId) return;
        // Revisar si se cerró en el mes seleccionado
        const closedAt = lead.closedAt || lead.lastFollowUpAt || lead.updatedAt || lead.createdAt;
        if (closedAt) {
          const cDate = closedAt.toDate ? closedAt.toDate() : new Date(closedAt);
          if (cDate >= startOfMonth && cDate <= endOfMonth) {
            ventasByAdvisor.set(advId, (ventasByAdvisor.get(advId) || 0) + 1);
          }
        }
      });
    } catch (err) {
      logger.warn('[commercialLeaderboard] Error consultando closedLeads:', { error: String(err) });
    }

    // 5b. Ventas desde SmartHome (si está configurado)
    try {
      const shSales: any = await getSmartHomeSales();
      if (Array.isArray(shSales)) {
        shSales.forEach((s: any) => {
          if (!s?.closeDate || typeof s.closeDate !== 'string') return;
          const sMonth = s.closeDate.slice(0, 7);
          if (sMonth !== monthKey) return;
          // Vincular asesor por nombre o ID si coincide
          const advName = String(s.agentCierre || s.agentCr || '').trim().toLowerCase();
          for (const [id, adv] of advisorsMap.entries()) {
            if (adv.name.toLowerCase().includes(advName) || advName.includes(adv.name.toLowerCase())) {
              ventasByAdvisor.set(id, (ventasByAdvisor.get(id) || 0) + 1);
              break;
            }
          }
        });
      }
    } catch { /* SmartHome opcional */ }

    // 6. Construir lista de items por asesor y calcular puntuación gamificada
    const items: AdvisorLeaderboardItem[] = [];

    for (const [id, adv] of advisorsMap.entries()) {
      const customGoal = advisorGoalsMap[id] || {};
      const targets: CommercialGoalConfig = {
        citasTarget:     customGoal.citasTarget ?? defaultGoals.citasTarget,
        visitasTarget:   customGoal.visitasTarget ?? defaultGoals.visitasTarget,
        ventasTarget:    customGoal.ventasTarget ?? defaultGoals.ventasTarget,
        gestionesTarget: customGoal.gestionesTarget ?? defaultGoals.gestionesTarget,
      };

      const actuals = {
        citas:     citasByAdvisor.get(id) || 0,
        visitas:   visitasByAdvisor.get(id) || 0,
        ventas:    ventasByAdvisor.get(id) || 0,
        gestiones: gestionesByAdvisor.get(id) || 0,
      };

      const citasPct     = targets.citasTarget > 0 ? Math.round((actuals.citas / targets.citasTarget) * 100) : 100;
      const visitasPct   = targets.visitasTarget > 0 ? Math.round((actuals.visitas / targets.visitasTarget) * 100) : 100;
      const ventasPct    = targets.ventasTarget > 0 ? Math.round((actuals.ventas / targets.ventasTarget) * 100) : 100;
      const gestionesPct = targets.gestionesTarget > 0 ? Math.round((actuals.gestiones / targets.gestionesTarget) * 100) : 100;
      const averageCompletionPct = Math.round((citasPct + visitasPct + ventasPct + gestionesPct) / 4);

      // Ponderación gamificada:
      // Ventas (50 pts c/u) + Visitas Terreno (25 pts c/u) + Citas (15 pts c/u) + Gestiones (2 pts c/u)
      const score = (actuals.ventas * 50) + (actuals.visitas * 25) + (actuals.citas * 15) + (actuals.gestiones * 2);

      const badges: string[] = [];
      if (actuals.ventas >= targets.ventasTarget && targets.ventasTarget > 0) badges.push('🎯 Meta de Ventas');
      if (actuals.visitas >= targets.visitasTarget && targets.visitasTarget > 0) badges.push('🏡 Meta de Terrenos');
      if (actuals.citas >= targets.citasTarget && targets.citasTarget > 0) badges.push('🎥 Meta de Citas');
      if (actuals.gestiones >= targets.gestionesTarget && targets.gestionesTarget > 0) badges.push('⚡ Super Asesor');

      items.push({
        advisorId: id,
        advisorName: adv.name,
        email: adv.email,
        photoUrl: adv.photoUrl,
        role: adv.role,
        rank: 0,
        score,
        targets,
        actuals,
        percentages: {
          citasPct,
          visitasPct,
          ventasPct,
          gestionesPct,
          averageCompletionPct,
        },
        badges,
      });
    }

    // 7. Ordenar por Score descendente y asignar puestos (1, 2, 3...)
    items.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.actuals.ventas !== a.actuals.ventas) return b.actuals.ventas - a.actuals.ventas;
      if (b.actuals.visitas !== a.actuals.visitas) return b.actuals.visitas - a.actuals.visitas;
      return b.actuals.citas - a.actuals.citas;
    });

    items.forEach((item, idx) => {
      item.rank = idx + 1;
      if (item.rank === 1) item.badges.unshift('🥇 Líder del Mes');
      else if (item.rank === 2) item.badges.unshift('🥈 Segundo Lugar');
      else if (item.rank === 3) item.badges.unshift('🥉 Tercer Lugar');
    });

    // 8. Totales de equipo
    let totalCitas = 0;
    let totalVisitas = 0;
    let totalVentas = 0;
    let totalGestiones = 0;
    let targetCitas = 0;
    let targetVisitas = 0;
    let targetVentas = 0;
    let targetGestiones = 0;

    items.forEach((i) => {
      totalCitas += i.actuals.citas;
      totalVisitas += i.actuals.visitas;
      totalVentas += i.actuals.ventas;
      totalGestiones += i.actuals.gestiones;
      targetCitas += i.targets.citasTarget;
      targetVisitas += i.targets.visitasTarget;
      targetVentas += i.targets.ventasTarget;
      targetGestiones += i.targets.gestionesTarget;
    });

    const overallCompletionPct = targetVentas > 0
      ? Math.round(((totalVentas / targetVentas) * 0.4 + (totalVisitas / (targetVisitas || 1)) * 0.3 + (totalCitas / (targetCitas || 1)) * 0.2 + (totalGestiones / (targetGestiones || 1)) * 0.1) * 100)
      : 0;

    return {
      monthKey,
      monthLabel,
      defaultGoals,
      advisorGoals: advisorGoalsMap,
      companyTotals: {
        totalCitas,
        totalVisitas,
        totalVentas,
        totalGestiones,
        targetCitas,
        targetVisitas,
        targetVentas,
        targetGestiones,
        overallCompletionPct,
      },
      leaderboard: items,
    };
  }
);

// ─── saveCommercialGoals ───────────────────────────────────────────────────────
// Permite al Administrador configurar o ajustar las metas comerciales globales y por asesor.
export const saveCommercialGoals = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const schema = z.object({
      companyId: z.string().min(1),
      defaultGoals: z.object({
        citasTarget:     z.number().min(0).max(1000),
        visitasTarget:   z.number().min(0).max(500),
        ventasTarget:    z.number().min(0).max(100),
        gestionesTarget: z.number().min(0).max(5000),
      }),
      advisorGoals: z.record(z.string(), z.object({
        citasTarget:     z.number().min(0).optional(),
        visitasTarget:   z.number().min(0).optional(),
        ventasTarget:    z.number().min(0).optional(),
        gestionesTarget: z.number().min(0).optional(),
      })).optional(),
    });

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Datos de metas inválidos.');
    }

    const { companyId, defaultGoals, advisorGoals } = parsed.data;
    assertCompany(ctx, companyId);

    const goalsRef = db.collection('companies').doc(companyId).collection('config').doc('commercialGoals');
    await goalsRef.set({
      defaultGoals,
      advisorGoals: advisorGoals || {},
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    }, { merge: true });

    logger.info('[CommercialGoals] Metas comerciales guardadas', {
      companyId,
      updatedBy: ctx.uid,
      defaultGoals,
    });

    return { ok: true };
  }
);
