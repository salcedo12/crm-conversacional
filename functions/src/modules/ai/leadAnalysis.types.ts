import { Timestamp } from 'firebase-admin/firestore';

/** Temperatura comercial del lead según la IA. */
export type LeadTemperature = 'hot' | 'warm' | 'cold';

/**
 * Categoría fija del principal riesgo/motivo de pérdida — permite agregarlo en
 * el dashboard (torta "por qué se pierden"). Para leads perdidos es el motivo
 * de pérdida; para leads abiertos, el principal riesgo actual.
 */
export type LeadLossCategory =
  | 'precio'         // Precio / presupuesto fuera de alcance
  | 'ubicacion'      // Ubicación / zona no encaja
  | 'competencia'    // Se fue / prefiere a un competidor
  | 'sin_respuesta'  // Dejó de responder / se enfrió
  | 'tiempo'         // No es el momento (compra futura)
  | 'no_califica'    // No cumple perfil / capacidad de compra
  | 'atencion'       // Mala atención / demora en respuesta
  | 'otro'           // Otro motivo
  | 'ninguno';       // Sin riesgo claro / va bien

/**
 * Radiografía IA de un lead: puntaje de calificación + análisis cualitativo
 * de la conversación (WhatsApp + llamadas). Se guarda en el doc del lead
 * (`lead.aiAnalysis`) para poder ordenarlo/filtrarlo y mostrarlo en la ficha.
 */
export interface LeadAnalysis {
  /** Puntaje de calificación 0-100 (probabilidad/calidad de cierre). */
  score:            number;
  /** hot 🔥 / warm / cold — resumen visual del score + intención. */
  temperature:      LeadTemperature;
  /** Resumen ejecutivo de 1-2 frases del estado del lead. */
  summary:          string;
  /** Descripción del nivel de interés detectado. */
  interestLevel:    string;
  /** Señales de compra detectadas (urgencia, presupuesto, decisión…). */
  buyingSignals:    string[];
  /** Objeciones/frenos detectados (precio, ubicación, "lo pienso"…). */
  objections:       string[];
  /** Presupuesto mencionado por el cliente, si lo hubo. */
  budget:           string | null;
  /** Proyecto/zona/producto de interés mencionado, si lo hubo. */
  interestArea:     string | null;
  /** Próximo paso recomendado para el asesor. */
  nextAction:       string;
  /** Por qué se recomienda ese próximo paso. */
  nextActionReason: string;
  /** Principal riesgo de pérdida (o, si ya está perdido, por qué se perdió). */
  lossRisk:         string;
  /** Categoría fija del riesgo/motivo de pérdida (para agregación en dashboard). */
  lossCategory:     LeadLossCategory;
  /** Factores que sustentan el puntaje. */
  scoreReasons:     string[];

  // ── Metadatos (los añade el callable, no la IA) ────────────────────────────
  /** Cuántos mensajes se analizaron. */
  messageCount:     number;
  /** Modelo usado (para trazabilidad). */
  model:            string;
  /** uid del usuario que disparó el análisis. */
  analyzedBy:       string;
  /** Cuándo se generó. */
  analyzedAt:       Timestamp;
}

/** Lo que devuelve la IA (sin los metadatos que añade el servidor). */
export type LeadAnalysisAi = Omit<
  LeadAnalysis,
  'messageCount' | 'model' | 'analyzedBy' | 'analyzedAt'
>;
