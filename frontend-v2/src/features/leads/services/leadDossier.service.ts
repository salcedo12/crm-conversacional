import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { LeadAnalysis } from '@/features/inbox/types';

/** Diagnóstico del lado CRM (derivado de datos ya guardados, sin costo IA). */
export interface CrmDossier {
  status:          string;
  source:          string;
  advisorName:     string;
  createdAt:       number | null;
  createdHour:     number;
  nightLead:       boolean;
  lastMessageAt:   number | null;
  lastMessageText: string;
  lastInboundAt:   number | null;
  firstContactAt:  number | null;
  advisorMsgCount: number;
  waitingReply:    boolean;
  waitingMin:      number | null;
  staleDays:       number | null;
  avgResponseMin:  number | null;
  responseSamples: number;
  flags:           string[];
}

/** Una entrada de la bitácora de SmartHome. */
export interface SmartHomeEvent {
  date:    string;
  content: string;
  action:  string;
  system:  boolean;   // true = evento automático del sistema (no nota del asesor)
  userId?: string;
}

/** Resumen del seguimiento del cliente en SmartHome (BI + bitácora real). */
export interface SmartHomeDossier {
  error:        boolean;   // true = no se pudo consultar SmartHome
  found:        boolean;   // false = el cliente no existe en SmartHome
  prospectId?:  string;
  name?:        string;
  advisor?:     string;
  seller?:      string;
  stage?:       string;
  saleCycle?:   string;
  followUps:    number;
  score?:       number;
  probability?: number;
  source?:      string;
  createdDate?: string;
  closeDate?:   string;
  actions:      { label: string; count: number }[];
  channels:     { label: string; count: number }[];
  events:       SmartHomeEvent[];
  advisorNotes: number;
}

/** Análisis IA sin los metadatos que solo existen cuando se persiste. */
export type DossierAi = Omit<LeadAnalysis, 'messageCount' | 'model' | 'analyzedBy' | 'analyzedAt'>;

export interface LeadDossier {
  generatedAt: number;
  crm:         CrmDossier;
  smartHome:   SmartHomeDossier;
  ai:          DossierAi | null;
}

const _generate = httpsCallable<
  { companyId: string; leadId: string; withAi: boolean },
  LeadDossier
>(functions, 'generateLeadDossier');

/**
 * Genera bajo demanda la radiografía CRM + SmartHome de un lead. NO se guarda en
 * base: cada clic consume lecturas del lead + API SmartHome (+ IA si withAi).
 */
export async function generateLeadDossier(companyId: string, leadId: string, withAi = false): Promise<LeadDossier> {
  const r = await _generate({ companyId, leadId, withAi });
  return r.data;
}
