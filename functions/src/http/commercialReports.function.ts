import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { requireAuth } from '../lib/authContext';
import { getOpenAIClient } from '../integrations/openai/openai.client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const generateExecutiveReportWithAi = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    requireAuth(request);

    const { reportData } = z
      .object({
        reportData: z.any(),
      })
      .parse(request.data);

    if (!reportData) {
      throw new HttpsError('invalid-argument', 'reportData es requerido.');
    }

    const apiKey = env.openaiApiKey();
    if (!apiKey) {
      logger.warn('[commercialReports] OPENAI_API_KEY no configurada, devolviendo datos sin IA');
      return {
        summaryBullets: reportData.summaryBullets,
        attentionPoints: reportData.attentionPoints,
        recommendations: reportData.recommendations,
      };
    }

    try {
      const openai = getOpenAIClient();

      const advisorContext = (reportData.advisorRows || []).map((a: any) => ({
        asesor: a.advisorName,
        captacionesSemana: a.captSemana,
        captacionesMes: a.captMes,
        avanceMesPct: a.avanceMesPct,
        ventasSemana: a.ventasSemana,
        ventasMes: a.ventasMes,
        clientesConSeguimiento: a.clientesConSeguimiento,
        leadsSemConSeguimiento: a.leadsSemConSeguimiento,
        clientesAnteriores: a.clientesAnteriores,
        coberturaPct: a.coberturaPct,
        observacionesEnFichas: (a.sampleObservations || []).slice(0, 8),
      }));

      const isMonthly = reportData.periodType === 'monthly';
      const reportTitle = isMonthly
        ? 'INFORME MENSUAL DE GESTIÓN COMERCIAL — ASESORES'
        : 'INFORME SEMANAL DE GESTIÓN COMERCIAL — ASESORES';

      const systemPrompt = `Eres el Director de Sistemas y Analista Comercial Senior de Grupo Constructor Meraki S.A.S.
Tu función es redactar el "${reportTitle}" dirigido a Gerencia.
El tono debe ser estrictamente ejecutivo, analítico, objetivo y formal (el estilo característico de los informes de Luis Eduardo Salcedo Aya).

Metas Comerciales Oficiales de Meraki (OBLIGATORIAS):
- Meta de Ventas: 3 ventas al mes por asesor comercial.
- Meta de Captación Semanal: 25 captaciones a la semana por asesor.
- Meta de Captación Mensual: 100 captaciones al mes por asesor (25 semanales × 4 semanas = 100 al mes).
- Meta de Cobertura de Seguimiento: Mínimo 70% de prospectos nuevos con bitácora real en ficha técnica.
- Tipo de informe evaluado: ${isMonthly ? 'MENSUAL (mes completo o acumulado a la fecha)' : 'SEMANAL (semana en curso o cerrada)'}.

Reglas de análisis estricto:
- SI ES UN INFORME MENSUAL, NUNCA uses la palabra "semana" en los bullets ni en los puntos de atención. Habla siempre de "en el mes", "meta mensual de 100 captaciones" y "meta mensual de 3 ventas".
- SI ES UN INFORME SEMANAL, evalúa frente a la meta semanal de 25 captaciones y el ritmo hacia las 3 ventas mensuales.
- Criterios de evaluación en "Puntos de atención":
  * ÉXITO / DESTACADO (type: 'success'): Asesores que cumplen o superan su meta (>=25 semanal o >=100 mensual) con ventas confirmadas y buena cobertura (>=70%). SOLO resalta como líder o más destacado a quien realmente lideró el período. NUNCA repitas "la mejor semana del equipo" a múltiples asesores.
  * EN SEGUIMIENTO / ALERTA (type: 'warning'): Quienes tienen captaciones intermedias pero les falta ritmo para la meta o no han cerrado ventas (meta 3). Si un asesor tiene buen volumen (ej. >60 captaciones) pero 0 ventas, alerta explícitamente sobre la necesidad urgente de enfocarse en cierres. Si detectas notas cortas y repetitivas de plantilla, menciónalo entre comillas. Si gestionó base anterior pero descuidó leads nuevos, señálalo.
  * CRÍTICO / RETRASO GRAVE (type: 'danger'): Asesores con menos del 50% de la meta (<12 en semana o <50 en mes), con 0 ventas o con cobertura baja (<40%).
- Lee con atención las "observacionesEnFichas" de cada asesor para fundamentar tus diagnósticos con evidencia real.

Debes responder ÚNICAMENTE un JSON válido con la siguiente estructura:
{
  "summaryBullets": {
    "referencia": "párrafo formal de referencia a las metas esperadas proporcionales a la fecha (3 ventas y 100 captaciones al mes / 25 a la semana)",
    "captacion": "párrafo formal con el total de leads captados, quién supera la meta (25 semana / 100 mes) y quién va atrasado",
    "ventas": "párrafo formal con las ventas del período, quién cerró y cuántas faltan para la meta mensual de 3 ventas",
    "seguimiento": "párrafo formal con clientes gestionados, proporción nuevos vs antiguos y porcentaje sin gestión"
  },
  "cronologiaAi": "párrafo detallado que analiza día por día el ritmo de trabajo de los asesores, qué días se concentró la captación, qué días se hicieron llamadas de seguimiento a fichas y qué días se concretaron ventas o visitas",
  "attentionPoints": [
    {
      "advisorName": "Nombre Completo",
      "text": "diagnóstico analítico conciso en 1 o 2 oraciones, señalando sus métricas frente a las metas (3 ventas y 100 captaciones mes / 25 semana) y lo encontrado en sus fichas técnicas",
      "type": "success | warning | danger | info"
    }
  ],
  "recommendations": [
    "Recomendación 1 para Gerencia / Dirección Comercial enfocada en metas de venta y captación",
    "Recomendación 2...",
    "Recomendación 3...",
    "Recomendación 4..."
  ]
}`;

      const userContent = `Datos del período actual:
Título: ${reportData.title}
Período: ${reportData.periodLabel}
Fecha de corte: ${reportData.reportDateStr}
Total captaciones semana: ${reportData.kpis?.captacionesPeriodo}
Total captaciones mes: ${reportData.kpis?.captacionesMes}
Total ventas semana: ${reportData.kpis?.ventasPeriodo} (en el mes: ${reportData.kpis?.ventasMes})
Clientes con seguimiento real: ${reportData.kpis?.clientesConSeguimiento}
Cobertura semana: ${reportData.kpis?.coberturaPeriodoPct}%

Detalle por asesor y notas de bitácoras:
${JSON.stringify(advisorContext, null, 2)}`;

      let rawText = '{}';
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        });
        rawText = completion.choices[0]?.message?.content || '{}';
      } catch (primaryErr: any) {
        logger.warn('[commercialReports] gpt-4o no disponible, reintentando con gpt-4o-mini:', { error: primaryErr?.message || String(primaryErr) });
        const fallbackCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        });
        rawText = fallbackCompletion.choices[0]?.message?.content || '{}';
      }

      const parsed = JSON.parse(rawText);

      return {
        summaryBullets: parsed.summaryBullets || reportData.summaryBullets,
        attentionPoints: parsed.attentionPoints || reportData.attentionPoints,
        recommendations: parsed.recommendations || reportData.recommendations,
        cronologiaAi: parsed.cronologiaAi || reportData.cronologiaAi,
      };
    } catch (err: any) {
      logger.error('[commercialReports] Error en completion de OpenAI:', { error: err?.message || String(err) });
      return {
        summaryBullets: reportData.summaryBullets,
        attentionPoints: reportData.attentionPoints,
        recommendations: reportData.recommendations,
        cronologiaAi: reportData.cronologiaAi,
      };
    }
  }
);
