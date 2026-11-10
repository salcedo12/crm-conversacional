export type ReportPeriodType = 'weekly' | 'monthly' | 'custom';

export type DrilldownCategory =
  | 'period_leads'
  | 'month_leads'
  | 'managed_total'
  | 'leads_sem_con_seguim'
  | 'clientes_anteriores';

export interface CommercialReportKPIs {
  captacionesPeriodo: number;
  captacionesMes: number;
  ventasPeriodo: number;
  ventasMes: number;
  clientesConSeguimiento: number;
  leadsPeriodoConSeguimiento: number;
  coberturaPeriodoPct: number;
  totalLeadsActivos?: number;
}

export interface AdvisorLeadFollowUpHistoryItem {
  date: string;
  action: string;
  description: string;
  author: string;
}

export interface AdvisorLeadDetailItem {
  leadId: string;
  clientName: string;
  phone: string;
  phoneRaw?: string;
  advisorId: string;
  advisorName: string;
  createdAt: number;
  createdAtFormatted: string;
  project?: string;
  source?: string;
  status: string;
  hasFollowUp: boolean;
  hasPeriodFollowUp: boolean;
  hasMonthFollowUp: boolean;
  lastFollowUpAt?: number;
  lastFollowUpFormatted?: string;
  lastFollowUpSummary?: string;
  lastFollowUpAuthor?: string;
  allBitacoras?: AdvisorLeadFollowUpHistoryItem[];
  isPeriodCreated: boolean;
  isMonthCreated: boolean;
  fromTransfer?: boolean;
  transferReason?: string;
}

export interface AdvisorReportRow {
  advisorId: string;
  advisorName: string;
  captSemana: number;
  captMes: number;
  avanceMesPct: number;
  expectedMonthPct?: number;
  ventasSemana: number;
  ventasMes: number;
  clientesConSeguimiento: number;
  leadsSemConSeguimiento: number;
  clientesAnteriores: number;
  coberturaPct: number;
  statusColor: 'green' | 'yellow' | 'red';
  noteCount: number;
  sampleObservations: string[];
  notePatternWarning?: string;
  periodLeads?: AdvisorLeadDetailItem[];
  monthLeads?: AdvisorLeadDetailItem[];
  managedLeads?: AdvisorLeadDetailItem[];
  managedPeriodLeads?: AdvisorLeadDetailItem[];
  oldManagedPeriodLeads?: AdvisorLeadDetailItem[];
  newManagedPeriodLeads?: AdvisorLeadDetailItem[];
}

export interface AdvisorReportTotals {
  captSemana: number;
  captMes: number;
  avanceMesPct: number;
  expectedMonthPct?: number;
  ventasSemana: number;
  ventasMes: number;
  clientesConSeguimiento: number;
  leadsSemConSeguimiento: number;
  clientesAnteriores: number;
  coberturaPct: number;
}

export interface DailyAdvisorWork {
  advisorId: string;
  advisorName: string;
  captaciones: number;
  bitacoras: number;
  actions: { actionType: string; label: string; count: number }[];
  sampleNotes: string[];
}

export interface DailyActivityItem {
  dateKey: string; // "YYYY-MM-DD"
  dayName: string; // "Miércoles"
  dateFormatted: string; // "21 de Octubre"
  shortDate: string; // "Mié 21"
  timestamp: number;
  captacionesCount: number;
  bitacorasCount: number;
  ventasCount: number;
  advisorsActive: DailyAdvisorWork[];
  sales: SaleReportItem[];
}

export interface SaleReportItem {
  id?: string;
  date: string;
  advisorName: string;
  clientName: string;
  property: string;
  amount?: number;
}

export interface AttentionPointItem {
  advisorName: string;
  text: string;
  type?: 'success' | 'warning' | 'danger' | 'info';
}

export interface CaptacionDayItem {
  day: string;
  dateStr: string;
  count: number;
}

export interface CaptacionProjectItem {
  project: string;
  count: number;
  percentage: number;
}

export interface CaptacionSourceItem {
  source: string;
  count: number;
  percentage: number;
}

export interface DataQualityMetrics {
  phonePct: number;
  emailPct: number;
  idPct: number;
  cityPct: number;
  stagePct: number;
  totalEvaluated: number;
}

export interface CommercialExecutiveReportData {
  title: string;
  reportType: 'advisors' | 'captacion';
  periodType: ReportPeriodType;
  periodLabel: string;
  startDate: number;
  endDate: number;
  monthStart: number;
  monthEnd: number;
  monthLabel: string;
  preparedBy: string;
  forRecipient: string;
  reportDateStr: string;

  kpis: CommercialReportKPIs;

  summaryBullets: {
    referencia: string;
    captacion: string;
    ventas: string;
    seguimiento: string;
  };

  advisorRows: AdvisorReportRow[];
  totals: AdvisorReportTotals;

  // Detalle interactivo de prospectos y trazabilidad
  allPeriodLeads?: AdvisorLeadDetailItem[];
  allMonthLeads?: AdvisorLeadDetailItem[];
  allManagedLeads?: AdvisorLeadDetailItem[];
  allManagedPeriodLeads?: AdvisorLeadDetailItem[];
  allOldManagedPeriodLeads?: AdvisorLeadDetailItem[];
  allNewManagedPeriodLeads?: AdvisorLeadDetailItem[];

  salesList: SaleReportItem[];
  monthSalesList?: SaleReportItem[];
  salesAccumulatedSummary: string;

  attentionPoints: AttentionPointItem[];
  recommendations: string[];
  criteriosText: string;

  // Desglose y Actividad Día a Día
  dailyActivities?: DailyActivityItem[];
  cronologiaAi?: string;

  // Datos adicionales para Informe de Captación
  capturedByDay?: CaptacionDayItem[];
  capturedByProject?: CaptacionProjectItem[];
  capturedBySource?: CaptacionSourceItem[];
  dataQuality?: DataQualityMetrics;

  // Auditoría y Atribución de Marketing / Pautas
  marketingReport?: MarketingPeriodReportData;

  // Metadatos de alcance y permisos (Individual vs Consolidado)
  isIndividualReport?: boolean;
  targetAdvisorName?: string;
  allAdvisorsList?: Array<{ id: string; name: string }>;
}

export interface MarketingAdvisorAssignment {
  advisorId: string;
  advisorName: string;
  count: number;
  percentage: number;
}

export interface MarketingCampaignReportItem {
  campaignKey: string;
  campaignName: string;
  subtitle?: string;
  canalBadge?: string;
  source: string;
  isPauta: boolean;
  totalLeads: number;
  percentageOfPeriod: number;
  advisorsDistribution: MarketingAdvisorAssignment[];
  conSeguimientoCount: number;
  sinGestionCount: number;
  coberturaPct: number;
  noContestaCount: number;
  desistidosCount: number;
  ventasCount: number;
  estadosCount: {
    nuevo: number;
    enSeguimiento: number;
    noContesta: number;
    calificadoOVisita: number;
    desistido: number;
    venta: number;
  };
  sampleLeads: Array<{
    leadId: string;
    clientName: string;
    phone: string;
    advisorName: string;
    status: string;
    hasFollowUp: boolean;
    lastFollowUpSummary?: string;
    createdAtFormatted?: string;
    adExcerpt?: string;
  }>;
}

export interface MarketingPeriodReportData {
  totalLeadsPeriodo: number;
  totalPautaLeads: number;
  totalOrganicoLeads: number;
  porcentajePauta: number;
  topCampaignName: string;
  coberturaSeguimientoPautaPct: number;
  campaigns: MarketingCampaignReportItem[];
}
