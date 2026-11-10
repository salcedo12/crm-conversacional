export type PipelineGroup = 'captacion' | 'linea' | 'cierre' | 'no_interesado';

export interface PipelineStageConfig {
  id: string;
  label: string;
  group: PipelineGroup;
  probability: number | null; // e.g. 5, 10, 20, 35, 50, 65, 75, 85, 100, or null
  probabilityLabel: string;
  badgeColor: string;
  accentColor: string;
  headerBg: string;
  columnBorder: string;
  iconName: string;
}

export const PIPELINE_GROUPS: Record<PipelineGroup, { label: string; badge: string; border: string }> = {
  captacion: {
    label: '1. Captación',
    badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    border: 'border-blue-500/40',
  },
  linea: {
    label: '2. En Línea',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    border: 'border-amber-500/40',
  },
  cierre: {
    label: '3. Cierre',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/40',
  },
  no_interesado: {
    label: '4. No Interesado',
    badge: 'bg-red-500/20 text-red-300 border-red-500/30',
    border: 'border-red-500/40',
  },
};

export const PIPELINE_STAGES: PipelineStageConfig[] = [
  // ── CAPTACIÓN ──
  {
    id: 'prospecto',
    label: 'Prospecto',
    group: 'captacion',
    probability: 5,
    probabilityLabel: '5%',
    badgeColor: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    accentColor: '#3b82f6',
    headerBg: 'bg-blue-950/40',
    columnBorder: 'border-blue-500/20',
    iconName: 'Sparkles',
  },
  {
    id: 'contactado',
    label: 'Contactado',
    group: 'captacion',
    probability: 10,
    probabilityLabel: '10%',
    badgeColor: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    accentColor: '#06b6d4',
    headerBg: 'bg-cyan-950/40',
    columnBorder: 'border-cyan-500/20',
    iconName: 'MessageSquare',
  },
  {
    id: 'envio_info',
    label: 'Envío de Info',
    group: 'captacion',
    probability: 20,
    probabilityLabel: '20%',
    badgeColor: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    accentColor: '#0284c7',
    headerBg: 'bg-sky-950/40',
    columnBorder: 'border-sky-500/20',
    iconName: 'FileText',
  },

  // ── LÍNEA ──
  {
    id: 'cita',
    label: 'Cita',
    group: 'linea',
    probability: 35,
    probabilityLabel: '35%',
    badgeColor: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    accentColor: '#f59e0b',
    headerBg: 'bg-amber-950/40',
    columnBorder: 'border-amber-500/20',
    iconName: 'Calendar',
  },
  {
    id: 'cotizacion',
    label: 'Cotización',
    group: 'linea',
    probability: 50,
    probabilityLabel: '50%',
    badgeColor: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    accentColor: '#f97316',
    headerBg: 'bg-orange-950/40',
    columnBorder: 'border-orange-500/20',
    iconName: 'Calculator',
  },
  {
    id: 'visita_realizada',
    label: 'Visita Realizada',
    group: 'linea',
    probability: 65,
    probabilityLabel: '65%',
    badgeColor: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    accentColor: '#eab308',
    headerBg: 'bg-yellow-950/40',
    columnBorder: 'border-yellow-500/20',
    iconName: 'MapPin',
  },

  // ── CIERRE ──
  {
    id: 'negociacion',
    label: 'Negociación',
    group: 'cierre',
    probability: 75,
    probabilityLabel: '75%',
    badgeColor: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    accentColor: '#14b8a6',
    headerBg: 'bg-teal-950/40',
    columnBorder: 'border-teal-500/20',
    iconName: 'Handshake',
  },
  {
    id: 'documentacion',
    label: 'Documentación',
    group: 'cierre',
    probability: 85,
    probabilityLabel: '85%',
    badgeColor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    accentColor: '#10b981',
    headerBg: 'bg-emerald-950/40',
    columnBorder: 'border-emerald-500/20',
    iconName: 'FileCheck',
  },
  {
    id: 'firma',
    label: 'Firma / Separación',
    group: 'cierre',
    probability: 100,
    probabilityLabel: '100%',
    badgeColor: 'bg-green-500/20 text-green-300 border-green-500/40 font-semibold',
    accentColor: '#22c55e',
    headerBg: 'bg-green-950/50',
    columnBorder: 'border-green-500/30',
    iconName: 'CheckCircle2',
  },

  // ── NO INTERESADO ──
  {
    id: 'no_interesado_ubicacion',
    label: 'No Interesado: Ubicación',
    group: 'no_interesado',
    probability: null,
    probabilityLabel: 'Descarte',
    badgeColor: 'bg-red-500/15 text-red-300 border-red-500/30',
    accentColor: '#ef4444',
    headerBg: 'bg-red-950/40',
    columnBorder: 'border-red-500/20',
    iconName: 'MapPinOff',
  },
  {
    id: 'no_interesado_dinero',
    label: 'No Interesado: Dinero',
    group: 'no_interesado',
    probability: null,
    probabilityLabel: 'Descarte',
    badgeColor: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    accentColor: '#f43f5e',
    headerBg: 'bg-rose-950/40',
    columnBorder: 'border-rose-500/20',
    iconName: 'DollarSign',
  },
  {
    id: 'no_interesado_otra',
    label: 'No Interesado: Otra Razón',
    group: 'no_interesado',
    probability: null,
    probabilityLabel: 'Descarte',
    badgeColor: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    accentColor: '#71717a',
    headerBg: 'bg-zinc-900/60',
    columnBorder: 'border-zinc-800',
    iconName: 'XCircle',
  },
];

export interface PipelineCardItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  project: string;
  sector?: string;
  cupo?: string;
  advisorId: string;
  advisorName: string;
  source: string;
  sourceLabel: string;
  stageId: string;
  stageLabel: string;
  group: PipelineGroup;
  probability: number | null;
  probabilityLabel: string;
  createdAtText: string;
  createdMonthYear: string;
  score: number;
  lastBitacora?: string;
  lastBitacoraDate?: string;
  rawLead?: Record<string, unknown>;
}
