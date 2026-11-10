import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth } from '../lib/authContext';
import { getOpenAIClient } from '../integrations/openai/openai.client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const MERAKI_OFFICIAL_ADVISORS = [
  'Luis Carlos Machado',
  'Luisa Fernanda Zuluaga',
  'Adriana Garzón Osorio',
  'Alexander Zuluaga',
  'Juana María Ávila',
  'Edwin Mauricio Ramirez',
  'Isabel Betancourth',
  'Adriana Montaña',
  'Claudia Patricia Bolaños',
  'Karen Ramirez',
  'Oscar Narvaez',
  'Ildre Chona Conde',
];

const AskCommercialAssistantSchema = z.object({
  companyId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    })
  ),
  periodContext: z
    .object({
      startDate: z.number().optional(),
      endDate: z.number().optional(),
      periodLabel: z.string().optional(),
    })
    .optional(),
});

/**
 * Normaliza cadenas para comparaciones flexibles
 */
function cleanNorm(s?: string | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Resuelve el nombre del asesor al nombre oficial de Meraki
 */
function resolveAdvisorName(advRaw?: string | null): string {
  if (!advRaw) return 'Sin Asignar';
  const norm = cleanNorm(advRaw);
  const match = MERAKI_OFFICIAL_ADVISORS.find((o) => {
    const oNorm = cleanNorm(o);
    return oNorm === norm || norm.includes(oNorm) || oNorm.includes(norm);
  });
  return match || advRaw.trim().replace(/\s+/g, ' ');
}

/**
 * Desempaqueta y resuelve el nombre real de la campaña publicitaria o pauta de Meta Ads
 */
function resolveBackendAdCampaignName(l: any): string {
  if (!l) return 'Canal Directo';

  // 1. Si ya viene una campaña explícita con nombre real
  const explicit = l.campaignName || l.metadata?.campaign_name || l.metadata?.ad_name;
  if (explicit && explicit.trim() && explicit !== 'N/A' && !explicit.toLowerCase().includes('chatea')) {
    return explicit.trim();
  }

  // 2. Desempaquetar Meta Ads Click-to-WhatsApp desde sourceMeta
  const sm = l.sourceMeta;
  if (sm) {
    const body = (sm.body || '').trim();
    const hl = (sm.headline || '').trim();

    if (body) {
      const lower = cleanNorm(body);
      if (lower.includes('escrituraci') || lower.includes('escritura') || lower.includes('inmediata')) {
        return 'Escrituración Individual Inmediata';
      }
      if (lower.includes('sala de ventas') || lower.includes('apertura') || lower.includes('casa club') || lower.includes('30 de octubre')) {
        return 'Apertura Sala de Ventas Casa Club (30 Oct)';
      }
      if (lower.includes('mariquita') || lower.includes('129') || lower.includes('rio claro')) {
        return 'Terrenos Mariquita Río Claro ($129.9M)';
      }
      if (lower.includes('cdt') || lower.includes('banco') || lower.includes('inflaci') || lower.includes('rentabil')) {
        return '¿Tienes un CDT? Invierte en Tierra';
      }
      if (lower.includes('colombia') || lower.includes('proximo proyecto')) {
        return 'Tu Próximo Proyecto en Colombia';
      }
      const firstSentence = body.split(/[.\n!?]/)[0].trim();
      if (firstSentence.length >= 6) {
        return firstSentence.length > 40 ? `${firstSentence.slice(0, 38)}...` : firstSentence;
      }
    }

    if (hl && hl.length >= 4 && !hl.toLowerCase().includes('chatea') && !hl.toLowerCase().includes('registrate')) {
      return hl;
    }
  }

  // 3. Proyecto o lote de interés
  if (l.project && l.project.trim() && l.project !== 'N/A') {
    return l.project.trim();
  }

  // 4. Si la fuente es Meta/Facebook/Instagram
  const src = cleanNorm(l.source || l.metadata?.fuente || l.metadata?.source || l.fuenteUbicacion);
  if (src.includes('meta') || src.includes('face') || src.includes('insta') || src.includes('pauta') || src.includes('ads')) {
    return 'Meta Ads General (Pauta WhatsApp)';
  }

  return l.source || 'Orgánico / Directo';
}

export const askCommercialAssistant = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    requireAuth(request);

    const parsed = AskCommercialAssistantSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Parámetros inválidos para la consulta.');
    }

    const { companyId, messages, periodContext } = parsed.data;

    const apiKey = env.openaiApiKey();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Clave de OpenAI no configurada en el sistema.');
    }

    const openai = getOpenAIClient();

    // Herramientas que GPT-4o puede ejecutar para consultar Firestore
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'getAdvisorsRankingAndMetrics',
          description:
            'Obtiene el resumen oficial de desempeño de los 11 asesores comerciales: captaciones del mes/período, avance frente a meta de 100, ventas cerradas (meta 3) y cobertura de seguimiento.',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                enum: ['current_month', 'current_week', 'all'],
                description: 'Período a consultar (por defecto current_month)',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'queryLeadsAndCampaigns',
          description:
            'Busca y filtra leads por origen/pauta (Meta Ads, Google, Orgánico, SmartHome), asesor asignado, estado (no contesta, desistido, vencido, cerrado, en_gestion) o campaña publicitaria.',
          parameters: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Fuente del lead (ej: "meta", "facebook", "instagram", "google", "smarthome", "directo")',
              },
              campaignName: {
                type: 'string',
                description: 'Nombre o palabra clave de la campaña publicitaria (ej: "bosque", "campestre", "pauta")',
              },
              advisorName: {
                type: 'string',
                description: 'Nombre del asesor comercial a filtrar',
              },
              statusKeyword: {
                type: 'string',
                description: 'Filtro por estado o subestado (ej: "no contesta", "desistido", "vencido", "cerrado", "sin gestion")',
              },
              limit: {
                type: 'number',
                description: 'Máximo número de leads representativos a devolver (por defecto 40)',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'queryBitacorasAndVisitas',
          description:
            'Busca en las bitácoras y registros de seguimiento de SmartHome / CRM acciones específicas como llamadas, visitas a sala de ventas o proyecto, y resultados (no contesta, no interesado, presupuesto, permuta).',
          parameters: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                description: 'Tipo de acción (ej: "visita", "llamada", "whatsapp", "reunion")',
              },
              resultKeyword: {
                type: 'string',
                description: 'Palabra clave en la observación (ej: "no contesta", "desistio", "presupuesto", "cesantias", "visita sala")',
              },
              advisorName: {
                type: 'string',
                description: 'Nombre del asesor comercial',
              },
              projectName: {
                type: 'string',
                description: 'Proyecto de interés',
              },
              limit: {
                type: 'number',
                description: 'Máximo de bitácoras a devolver (por defecto 50)',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'queryDesistimientosYVentas',
          description:
            'Obtiene el desglose de ventas confirmadas y de prospectos que desistieron, incluyendo el motivo del desistimiento y el asesor a cargo.',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['desistimientos', 'ventas', 'ambos'],
                description: 'Si se consultan desistimientos, ventas o ambos',
              },
              advisorName: {
                type: 'string',
                description: 'Asesor a filtrar opcionalmente',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'auditConversationsAndUnresponsiveLeads',
          description:
            'Audita en tiempo real las conversaciones de chat (WhatsApp/Meta Ads) de los leads en Firestore para detectar prospectos que NUNCA contestaron el mensaje del asesor o que dejaron en visto, cruzando estos datos con las fichas que los asesores NO han marcado o tienen desactualizadas.',
          parameters: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Fuente del lead (por defecto "meta", o "facebook", "instagram", "google", "all")',
              },
              type: {
                type: 'string',
                enum: ['nunca_contestaron', 'dejaron_en_visto', 'fichas_sin_marcar', 'todos'],
                description:
                  'Tipo de análisis: "nunca_contestaron" (el CRM/asesor envió mensaje pero el cliente jamás respondió), "dejaron_en_visto" (cliente dejó en visto el último mensaje del asesor), "fichas_sin_marcar" (cliente no contestó y la ficha del asesor sigue abierta sin marcar), o "todos" para auditoría completa.',
              },
              advisorName: {
                type: 'string',
                description: 'Filtrar por nombre de un asesor comercial específico',
              },
              campaignName: {
                type: 'string',
                description: 'Filtrar por pauta o campaña publicitaria',
              },
              limit: {
                type: 'number',
                description: 'Cantidad máxima de fichas en la muestra representativa (por defecto 35)',
              },
            },
          },
        },
      },
    ];

    // Helper para ejecutar las herramientas de consulta
    async function executeTool(name: string, args: Record<string, any>): Promise<any> {
      const leadsCol = db.collection('companies').doc(companyId).collection('leads');

      if (name === 'getAdvisorsRankingAndMetrics') {
        const snap = await leadsCol
          .limit(3000)
          .get();

        const advisorStats: Record<string, {
          captaciones: number;
          conSeguimiento: number;
          ventas: number;
          desistidos: number;
          noContesta: number;
          fuentes: Record<string, number>;
        }> = {};

        MERAKI_OFFICIAL_ADVISORS.forEach((name) => {
          advisorStats[name] = { captaciones: 0, conSeguimiento: 0, ventas: 0, desistidos: 0, noContesta: 0, fuentes: {} };
        });

        // Incluir también dinámicamente asesores activos registrados en Firestore
        try {
          const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
          usersSnap.docs.forEach((uDoc) => {
            const u = uDoc.data() || {};
            if (u.disabled || u.active === false) return;
            const role = String(u.role || '').toLowerCase();
            if (role === 'admin' || role === 'viewer' || role === 'superadmin') return;
            const rawName = String(u.displayName || u.name || '').trim();
            if (!rawName || cleanNorm(rawName).includes('prueba') || cleanNorm(rawName).includes('test')) return;
            const resolved = resolveAdvisorName(rawName);
            if (!advisorStats[resolved]) {
              advisorStats[resolved] = { captaciones: 0, conSeguimiento: 0, ventas: 0, desistidos: 0, noContesta: 0, fuentes: {} };
            }
          });
        } catch (uErr: any) {
          logger.warn('[commercialAssistant] Error cargando usuarios dinámicos en ranking:', { error: uErr?.message || String(uErr) });
        }

        // Contar ventas confirmadas desde smarthomeSales
        try {
          const salesSnap = await db.collection('companies').doc(companyId).collection('smarthomeSales').get();
          salesSnap.docs.forEach((doc) => {
            const s = doc.data();
            if (s.ignored) return;
            const advResolved = resolveAdvisorName(s.advisorName || s.agentCierre || s.agentCr);
            if (advisorStats[advResolved]) {
              advisorStats[advResolved].ventas++;
            }
          });
        } catch (e: any) {
          logger.warn('[commercialAssistant] Error cargando ventas en ranking:', { error: e?.message || String(e) });
        }

        snap.docs.forEach((d) => {
          const l = d.data();
          if (l.disabled) return;

          const advNameRaw = l.assignedToName || l.smartHomeAdvisorName || '';
          const matchedOfficial = resolveAdvisorName(advNameRaw);
          if (!advisorStats[matchedOfficial]) return;

          const stats = advisorStats[matchedOfficial];
          stats.captaciones++;

          // Fuente
          const src = l.source || l.metadata?.fuente || 'Directo/Otros';
          stats.fuentes[src] = (stats.fuentes[src] || 0) + 1;

          // Estado y bitácoras
          const rawBits = [
            ...(Array.isArray(l.bitacoras) ? l.bitacoras : []),
            ...(Array.isArray(l.metadata?.smarthomeBitacoras) ? l.metadata.smarthomeBitacoras : []),
            ...(Array.isArray(l.smartHomeBitacoras) ? l.smartHomeBitacoras : []),
          ];
          const bitText = rawBits.map((b: any) => `${b.action || ''} ${b.description || ''}`).join(' ');
          const allText = `${l.status || ''} ${l.subEstado || ''} ${l.lastFollowUpSummary || ''} ${bitText}`.toLowerCase();

          if (allText.includes('no contesta') || allText.includes('no responde') || allText.includes('buzon') || allText.includes('no contesto')) {
            stats.noContesta++;
          }
          if (allText.includes('desist') || allText.includes('cancel') || allText.includes('no interesado')) {
            stats.desistidos++;
          }

          const hasFollowUp = rawBits.length > 0 || !!l.lastFollowUpAt || !!l.lastFollowUpSummary;
          if (hasFollowUp) {
            stats.conSeguimiento++;
          }
        });

        const ranking = Object.entries(advisorStats).map(([asesor, s]) => ({
          asesor,
          captaciones: s.captaciones,
          avanceMeta100Pct: Math.round((s.captaciones / 100) * 100),
          ventas: s.ventas,
          metaVentas3Cumplida: s.ventas >= 3,
          coberturaSeguimientoPct: s.captaciones > 0 ? Math.round((s.conSeguimiento / s.captaciones) * 100) : 0,
          noContestaCount: s.noContesta,
          desistidosCount: s.desistidos,
          topFuentes: Object.entries(s.fuentes).sort((a, b) => b[1] - a[1]).slice(0, 3),
        })).sort((a, b) => b.captaciones - a.captaciones);

        return { ranking, metaOficial: '100 captaciones/mes y 3 ventas/mes por asesor' };
      }

      if (name === 'queryLeadsAndCampaigns') {
        const { source, campaignName, advisorName, statusKeyword, limit = 50 } = args;
        const snap = await leadsCol
          .limit(2500)
          .get();

        const normSrc = cleanNorm(source);
        const normCamp = cleanNorm(campaignName);
        const normAdv = cleanNorm(advisorName);
        const normStat = cleanNorm(statusKeyword);

        const results: Array<Record<string, any>> = [];
        let totalMatches = 0;
        const countsByAdvisor: Record<string, number> = {};
        const countsByCampaign: Record<string, number> = {};

        snap.docs.forEach((doc) => {
          const l = doc.data();
          if (l.disabled) return;

          const lSrc = cleanNorm(l.source || l.metadata?.fuente || l.metadata?.source);
          const lCamp = cleanNorm(l.campaignName || l.metadata?.campaign_name || l.metadata?.ad_name || l.metadata?.adset_name || l.project);
          const lAdvRaw = l.assignedToName || l.smartHomeAdvisorName || '';
          const lAdv = cleanNorm(lAdvRaw);
          const lStat = cleanNorm(l.status || l.subEstado || l.lastFollowUpSummary);

          // Coincidencia flexible de fuente / pauta (Meta incluye Facebook, Instagram, Lead Ads, Pauta)
          if (normSrc) {
            let isSrcMatch = false;
            if (normSrc === 'meta' || normSrc === 'facebook' || normSrc === 'pauta' || normSrc === 'instagram' || normSrc === 'ads') {
              isSrcMatch =
                lSrc.includes('meta') ||
                lSrc.includes('face') ||
                lSrc.includes('insta') ||
                lSrc.includes('pauta') ||
                lSrc.includes('ads') ||
                lSrc.includes('form') ||
                lCamp.includes('meta') ||
                lCamp.includes('pauta') ||
                lCamp.includes('ads');
            } else {
              isSrcMatch = lSrc.includes(normSrc);
            }
            if (!isSrcMatch) return;
          }

          if (normCamp && !lCamp.includes(normCamp)) return;
          if (normAdv && !lAdv.includes(normAdv)) return;

          // Notas y bitácoras
          const rawBits = [
            ...(Array.isArray(l.bitacoras) ? l.bitacoras : []),
            ...(Array.isArray(l.metadata?.smarthomeBitacoras) ? l.metadata.smarthomeBitacoras : []),
            ...(Array.isArray(l.smartHomeBitacoras) ? l.smartHomeBitacoras : []),
          ];
          const bitacorasText = rawBits.map((b: any) => `${b.action || ''} ${b.description || ''}`).join(' ');
          const allLeadText = `${lStat} ${bitacorasText}`.toLowerCase();

          // Coincidencia flexible de estado o notas de bitácora
          if (normStat) {
            let isStatMatch = false;
            if (normStat.includes('no contesta') || normStat.includes('no responde') || normStat.includes('buzon')) {
              isStatMatch =
                allLeadText.includes('no contesta') ||
                allLeadText.includes('no responde') ||
                allLeadText.includes('buzon') ||
                allLeadText.includes('perdida') ||
                allLeadText.includes('no contesto') ||
                allLeadText.includes('deja de contestar');
            } else if (normStat.includes('desist') || normStat.includes('no interesado')) {
              isStatMatch =
                allLeadText.includes('desist') ||
                allLeadText.includes('cancel') ||
                allLeadText.includes('no interesado') ||
                allLeadText.includes('no le interesa');
            } else if (normStat.includes('sin gestion') || normStat.includes('sin seguimiento')) {
              isStatMatch = rawBits.length === 0 && !l.lastFollowUpSummary;
            } else {
              isStatMatch = allLeadText.includes(normStat);
            }
            if (!isStatMatch) return;
          }

          totalMatches++;
          const resolvedAdv = resolveAdvisorName(lAdvRaw);
          countsByAdvisor[resolvedAdv] = (countsByAdvisor[resolvedAdv] || 0) + 1;

          const campDisplay = resolveBackendAdCampaignName(l);
          countsByCampaign[campDisplay] = (countsByCampaign[campDisplay] || 0) + 1;

          if (results.length < limit) {
            results.push({
              id: doc.id,
              nombre: l.name || l.fullName || 'Sin nombre',
              telefono: l.phone || l.normalizedPhone || 'Sin tel',
              fuente: l.source || l.metadata?.fuente || 'Meta Ads',
              campana: campDisplay,
              asesor: resolvedAdv,
              estado: l.status || 'N/A',
              ultimoSeguimiento: l.lastFollowUpSummary || (rawBits[rawBits.length - 1]?.description) || 'Ninguno',
              fechaCaptacion: l.createdAt ? (l.createdAt.toDate ? l.createdAt.toDate().toISOString() : l.createdAt) : null,
            });
          }
        });

        return {
          totalCoincidencias: totalMatches,
          distribucionPorAsesor: countsByAdvisor,
          distribucionPorCampana: countsByCampaign,
          muestraRepresentativa: results,
        };
      }

      if (name === 'queryBitacorasAndVisitas') {
        const { actionType, resultKeyword, advisorName, projectName, limit = 60 } = args;
        const snap = await leadsCol
          .limit(2000)
          .get();

        const normAct = cleanNorm(actionType);
        const normRes = cleanNorm(resultKeyword);
        const normAdv = cleanNorm(advisorName);
        const normProj = cleanNorm(projectName);

        const matchingEntries: Array<Record<string, any>> = [];
        let totalCount = 0;
        const advisorBreakdown: Record<string, number> = {};

        snap.docs.forEach((doc) => {
          const l = doc.data();
          if (l.disabled) return;

          const lProj = cleanNorm(l.project || l.metadata?.loteInteres);
          if (normProj && !lProj.includes(normProj)) return;

          const bitacoras = [
            ...(Array.isArray(l.bitacoras) ? l.bitacoras : []),
            ...(Array.isArray(l.metadata?.smarthomeBitacoras) ? l.metadata.smarthomeBitacoras : []),
            ...(Array.isArray(l.smartHomeBitacoras) ? l.smartHomeBitacoras : []),
          ];

          if (l.lastFollowUpSummary) {
            bitacoras.push({
              action: l.lastFollowUpAction || 'Seguimiento CRM',
              description: l.lastFollowUpSummary,
              fecha: l.lastFollowUpAt,
              asesor: l.lastFollowUpAuthor || l.assignedToName,
            });
          }

          bitacoras.forEach((b: any) => {
            const bAct = cleanNorm(b.action || '');
            const bDesc = cleanNorm(b.description || '');
            const bAdvRaw = b.asesor || l.assignedToName || l.smartHomeAdvisorName || '';
            const bAdv = cleanNorm(bAdvRaw);

            if (normAct && !bAct.includes(normAct) && !bDesc.includes(normAct)) return;
            if (normRes && !bDesc.includes(normRes) && !bAct.includes(normRes)) return;
            if (normAdv && !bAdv.includes(normAdv)) return;

            totalCount++;
            const resolvedAdv = resolveAdvisorName(bAdvRaw);
            advisorBreakdown[resolvedAdv] = (advisorBreakdown[resolvedAdv] || 0) + 1;

            if (matchingEntries.length < limit) {
              matchingEntries.push({
                leadId: doc.id,
                leadNombre: l.name || l.fullName,
                asesor: resolvedAdv,
                accion: b.action || 'Bitácora',
                fecha: b.fecha || b.date,
                observacion: b.description,
                proyecto: l.project || 'N/A',
                fuenteLead: l.source || 'N/A',
              });
            }
          });
        });

        return {
          totalBitacorasEncontradas: totalCount,
          desglosePorAsesor: advisorBreakdown,
          muestraRegistros: matchingEntries,
        };
      }

      if (name === 'queryDesistimientosYVentas') {
        const { type = 'ambos', advisorName } = args;
        const normAdv = cleanNorm(advisorName);

        const salesSnap = await db.collection('companies').doc(companyId).collection('smarthomeSales').get();
        const ventas: Array<Record<string, any>> = [];
        salesSnap.docs.forEach((doc) => {
          const s = doc.data();
          if (s.ignored) return;
          const adv = s.advisorName || s.agentCierre || s.agentCr || 'Sin Asignar';
          if (normAdv && !cleanNorm(adv).includes(normAdv)) return;
          ventas.push({
            id: doc.id,
            cliente: s.buyerName || s.clientName || 'Cliente',
            asesor: adv,
            proyecto: s.lotName || s.property || s.project || 'N/A',
            fechaCierre: s.closeDate || s.date,
          });
        });

        const snap = await leadsCol
          .limit(2000)
          .get();

        const desistimientos: Array<Record<string, any>> = [];
        const motivosDesistimiento: Record<string, number> = {};

        snap.docs.forEach((doc) => {
          const l = doc.data();
          if (l.disabled) return;
          const advRaw = l.assignedToName || l.smartHomeAdvisorName || 'Sin Asignar';
          const adv = resolveAdvisorName(advRaw);
          if (normAdv && !cleanNorm(adv).includes(normAdv)) return;

          const st = cleanNorm(l.status || l.subEstado);
          const notes = cleanNorm(l.lastFollowUpSummary);

          // Desistido
          if (st.includes('desist') || st.includes('cancel') || st.includes('no_interesado') || notes.includes('desist')) {
            if (type === 'desistimientos' || type === 'ambos') {
              const motivo = l.motivoDesistimiento || l.subEstado || l.lastFollowUpSummary || 'Sin motivo especificado';
              motivosDesistimiento[motivo] = (motivosDesistimiento[motivo] || 0) + 1;
              desistimientos.push({
                leadId: doc.id,
                cliente: l.name || l.fullName,
                asesor: adv,
                motivo,
                proyecto: l.project || 'N/A',
                fuente: l.source || 'N/A',
              });
            }
          }
        });

        return {
          totalVentas: ventas.length,
          listaVentas: ventas,
          totalDesistimientos: desistimientos.length,
          resumenMotivosDesistimiento: motivosDesistimiento,
          muestraDesistimientos: desistimientos.slice(0, 30),
        };
      }

      if (name === 'auditConversationsAndUnresponsiveLeads') {
        const {
          source = 'meta',
          advisorName,
          campaignName,
          limit = 35,
        } = args;

        const snap = await leadsCol
          .limit(3000)
          .get();

        const normSrc = cleanNorm(source);
        const normCamp = cleanNorm(campaignName);
        const normAdv = cleanNorm(advisorName);

        let totalAnalizados = 0;
        let totalNuncaContestaron = 0;
        let totalDejaronEnVisto = 0;
        let totalFichasSinMarcar = 0;

        const porAsesorNuncaContestaron: Record<string, number> = {};
        const porAsesorFichasSinMarcar: Record<string, number> = {};
        const porAsesorDejaronEnVisto: Record<string, number> = {};
        const porCampanaSinRespuesta: Record<string, number> = {};

        const muestraFichasSinMarcar: Array<Record<string, any>> = [];

        snap.docs.forEach((doc) => {
          const l = doc.data();
          if (l.disabled) return;

          const lSrc = cleanNorm(l.source || l.metadata?.fuente || l.metadata?.source || l.fuenteUbicacion);
          const lCamp = cleanNorm(l.campaignName || l.metadata?.campaign_name || l.metadata?.ad_name || l.metadata?.adset_name || l.project || l.campaign || l.sourceMeta?.headline);
          const lAdvRaw = l.assignedToName || l.smartHomeAdvisorName || '';
          const lAdv = cleanNorm(lAdvRaw);

          if (normSrc && normSrc !== 'all') {
            let isSrcMatch = false;
            if (normSrc === 'meta' || normSrc === 'facebook' || normSrc === 'pauta' || normSrc === 'instagram' || normSrc === 'ads') {
              isSrcMatch =
                lSrc.includes('meta') ||
                lSrc.includes('face') ||
                lSrc.includes('insta') ||
                lSrc.includes('pauta') ||
                lSrc.includes('ads') ||
                lSrc.includes('form') ||
                lCamp.includes('meta') ||
                lCamp.includes('pauta') ||
                lCamp.includes('ads') ||
                !!l.sourceMeta;
            } else {
              isSrcMatch = lSrc.includes(normSrc);
            }
            if (!isSrcMatch) return;
          }

          if (normCamp && !lCamp.includes(normCamp)) return;
          if (normAdv && !lAdv.includes(normAdv)) return;

          totalAnalizados++;

          const hasInbound = !!l.lastInboundAt;
          const hasOutbound = !!l.lastAdvisorMessageAt || !!l.advisorFirstContactAt || !!l.lastMessageText;

          // Estado formal en ficha y bitácoras
          const rawBits = [
            ...(Array.isArray(l.bitacoras) ? l.bitacoras : []),
            ...(Array.isArray(l.metadata?.smarthomeBitacoras) ? l.metadata.smarthomeBitacoras : []),
            ...(Array.isArray(l.smartHomeBitacoras) ? l.smartHomeBitacoras : []),
          ];
          const bitacorasText = rawBits.map((b: any) => `${b.action || ''} ${b.description || ''}`).join(' ');
          const lStat = cleanNorm(l.status || l.subEstado || l.lastFollowUpSummary);
          const fullText = `${lStat} ${bitacorasText}`.toLowerCase();

          const isFichaMarkedNoContesta =
            fullText.includes('no contesta') ||
            fullText.includes('no_contesta') ||
            fullText.includes('buzon') ||
            fullText.includes('desist') ||
            fullText.includes('cancel') ||
            fullText.includes('no_interesado');

          const resolvedAdv = resolveAdvisorName(lAdvRaw);
          const campDisplay = resolveBackendAdCampaignName(l);

          // 1. Nunca contestó el chat (mensaje inicial/plantilla enviado pero 0 inbound)
          const isNuncaContesto = hasOutbound && !hasInbound;
          if (isNuncaContesto) {
            totalNuncaContestaron++;
            porAsesorNuncaContestaron[resolvedAdv] = (porAsesorNuncaContestaron[resolvedAdv] || 0) + 1;
            porCampanaSinRespuesta[campDisplay] = (porCampanaSinRespuesta[campDisplay] || 0) + 1;

            if (!isFichaMarkedNoContesta) {
              totalFichasSinMarcar++;
              porAsesorFichasSinMarcar[resolvedAdv] = (porAsesorFichasSinMarcar[resolvedAdv] || 0) + 1;

              if (muestraFichasSinMarcar.length < limit) {
                muestraFichasSinMarcar.push({
                  leadId: doc.id,
                  cliente: l.name || l.fullName || 'Cliente',
                  telefono: l.phone || l.normalizedPhone || 'N/A',
                  campana: campDisplay,
                  asesor: resolvedAdv,
                  estadoEnFicha: l.status || l.subEstado || 'nuevo/sin marcar',
                  ultimoMensaje: l.lastMessageText ? String(l.lastMessageText).slice(0, 100) : 'Mensaje inicial enviado',
                  diagnostico: 'El cliente NUNCA contestó en WhatsApp y el asesor tiene la ficha abierta sin marcar como No Contesta',
                });
              }
            }
          }

          // 2. Dejaron en visto al asesor
          if (hasInbound && hasOutbound) {
            const inTime = l.lastInboundAt?.toMillis ? l.lastInboundAt.toMillis() : (l.lastInboundAt ? new Date(l.lastInboundAt).getTime() : 0);
            const outTime = l.lastAdvisorMessageAt?.toMillis ? l.lastAdvisorMessageAt.toMillis() : (l.lastAdvisorMessageAt ? new Date(l.lastAdvisorMessageAt).getTime() : 0);
            if (outTime > inTime) {
              totalDejaronEnVisto++;
              porAsesorDejaronEnVisto[resolvedAdv] = (porAsesorDejaronEnVisto[resolvedAdv] || 0) + 1;
            }
          }
        });

        return {
          totalProspectosAnalizados: totalAnalizados,
          totalNuncaContestaronElChat: totalNuncaContestaron,
          totalDejaronEnVistoAlAsesor: totalDejaronEnVisto,
          totalFichasSinMarcarPorAsesor: totalFichasSinMarcar,
          desgloseFichasSinMarcarPorAsesor: porAsesorFichasSinMarcar,
          desgloseNuncaContestaronPorAsesor: porAsesorNuncaContestaron,
          desgloseDejaronEnVistoPorAsesor: porAsesorDejaronEnVisto,
          topCampanasConLeadsSinRespuesta: Object.entries(porCampanaSinRespuesta).sort((a, b) => b[1] - a[1]).slice(0, 8),
          muestraFichasSinMarcar,
        };
      }

      return { error: `Herramienta desconocida: ${name}` };
    }

    // System prompt para GPT-4o
    const systemPrompt = `Eres el "Copiloto de Inteligencia Comercial de Grupo Constructor Meraki S.A.S."
Trabajas mano a mano con Luis Eduardo Salcedo Aya (Sistemas) y la Gerencia de Meraki.
Tu propósito es responder preguntas comerciales complejas, auditorías de asesores, análisis de pauta publicitaria (Meta Ads, Google), llamadas no contestadas, visitas a salas de ventas/proyectos, desistimientos y AUDITORÍA DE CONVERSACIONES DE CHAT (WhatsApp).

Reglas fundamentales de Meraki:
- Metas oficiales: 100 captaciones al mes por asesor (25 semanales × 4 semanas) y 3 ventas al mes por asesor.
- Asesores comerciales oficiales (exactamente 11):
  ${MERAKI_OFFICIAL_ADVISORS.join(', ')}.
- AUDITORÍA DE CONVERSACIONES REALES VS FICHAS:
  Muchos asesores NO marcan las fichas de los prospectos (las dejan como "nuevo", "en seguimiento" o sin bitácora), pero en las conversaciones reales de WhatsApp el prospecto NUNCA contestó o dejó en visto al asesor.
  Cuando te pregunten sobre prospectos que no contestan, pautas que no contestan o si los asesores no marcaron las fichas, SIEMPRE utiliza 'auditConversationsAndUnresponsiveLeads' y 'queryLeadsAndCampaigns' para auditar tanto las fichas formales como la realidad de las conversaciones del chat.
- AMPLITUD DEL ANÁLISIS:
  El contexto de período de pantalla es solo la vista que el usuario tiene abierta actualmente en el CRM.
  Si el usuario hace una pregunta general sobre prospectos, pautas, asesores o pide auditar el sistema, AUDITA TODO EL SISTEMA y muestra tanto los datos globales como los del período si aplican. Nunca respondas "no hay datos en este intervalo de fechas" sin haber auditado el panorama global del CRM.
- Tu tono debe ser ejecutivo, directo, analítico y en español formal pero claro.
- Siempre que cites métricas, incluye el número exacto, el porcentaje y el desglose por asesor o campaña según corresponda.
- FORMATO VISUAL EJECUTIVO:
  * Estructura siempre tus respuestas con encabezados limpios de nivel 3 (###) con emojis de sección:
    - ### 👥 Distribución por Asesor
    - ### 📢 Distribución por Campaña o Pauta
    - ### 📋 Muestra Representativa de Prospectos
    - ### 💡 Diagnóstico y Recomendaciones Ejecutivas
  * En la lista de asesores, ordénalos siempre de mayor a menor volumen con formato: "- **Nombre del Asesor**: X prospectos".
  * Si existen prospectos "Sin Asignar", señálalo con prioridad alta porque es una fuga de leads.
  * Para tablas de prospectos, usa siempre columnas ejecutivas: "| Cliente | Teléfono | Asesor | Campaña / Pauta | Estado en Ficha |".
  * Incluye el número de teléfono con formato internacional (ej. +57...) para facilitar el contacto.
  * Concluye siempre con un diagnóstico conciso y 2-3 acciones prioritarias para Gerencia.`;

    // Historial con mensajes
    const conversationMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    if (periodContext?.periodLabel) {
      conversationMessages.push({
        role: 'system',
        content: `Contexto del período seleccionado actualmente en pantalla: ${periodContext.periodLabel}.`,
      });
    }

    try {
      // 1. Primer turno con GPT-4o con tools disponibles
      const firstResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversationMessages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      });

      const responseMessage = firstResponse.choices[0]?.message;

      // Si GPT-4o decidió ejecutar herramientas
      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        conversationMessages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          if (!('function' in toolCall)) continue;
          const fnName = toolCall.function.name;
          const fnArgs = JSON.parse(toolCall.function.arguments || '{}');

          logger.info(`[commercialAssistant] Ejecutando tool ${fnName}`, { fnArgs });
          const toolResult = await executeTool(fnName, fnArgs);

          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        // 2. Segundo turno: GPT-4o sintetiza los datos reales obtenidos
        const secondResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: conversationMessages,
          temperature: 0.2,
        });

        const replyContent = secondResponse.choices[0]?.message?.content || 'No se pudo obtener respuesta del análisis.';
        return { reply: replyContent };
      }

      // Si no requirió herramientas
      return { reply: responseMessage?.content || 'No se generó respuesta.' };
    } catch (err: any) {
      logger.error('[commercialAssistant] Error procesando consulta con GPT-4o:', { error: err?.message || String(err) });
      throw new HttpsError('internal', `Error al consultar al Copiloto de IA: ${err?.message || 'Error de servicio'}`);
    }
  }
);
