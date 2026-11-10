export interface CommercialLeadItem {
  id: string;
  name: string;
  phone: string;
  project: string;
  advisorId: string;
  advisorName: string;
  pipelineStage: string;
  pipelineStageLabel: string;
  status: string;
  source: string;
  fuenteUbicacion?: string;
  hasFicha: boolean;
  lastFollowUpDate?: string | null;
  lastFollowUpAction?: string | null;
  lastFollowUpResult?: string | null;
  lastFollowUpAuthor?: string | null;
  lastFollowUpSummary?: string | null;
  nextFollowUpDate?: string | null;
  nextFollowUpAction?: string | null;
  isOverdue: boolean;
  isToday: boolean;
  isUpcoming: boolean;
  isPeriodCreated?: boolean;
  hadPeriodFollowUp?: boolean;
  missingPeriodFollowUp?: boolean;
  createdAt?: any;
  lastMessageAt?: any;
  updatedAt?: any;
  bitacorasCount: number;
  metadata?: Record<string, any>;
  bitacoras?: any[];
}

export interface CommercialKPIs {
  missingFollowUpCount: number;
  overdueCount: number;
  todayCount: number;
  missingFichaCount: number;
  upcomingCount: number;
  completedThisMonthCount: number;
  cancelledCount?: number;
  closedCount?: number;
  totalLeads: number;
}

export interface CommercialSuggestion {
  id: string;
  type: 'urgent' | 'today' | 'missing_ficha' | 'stalled' | 'missing_followup';
  icon: string;
  title: string;
  description: string;
  count: number;
  actionFilter: 'urgent' | 'today' | 'missing' | 'stalled' | 'missing_followup';
  badgeColor: string;
}
