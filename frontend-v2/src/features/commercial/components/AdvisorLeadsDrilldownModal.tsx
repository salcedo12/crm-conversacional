import { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  Phone,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Calendar,
  Users,
  User,
  Filter,
  Building,
  Clock,
  Sparkles,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  ArrowUpRight,
} from 'lucide-react';
import type {
  CommercialExecutiveReportData,
  AdvisorLeadDetailItem,
  AdvisorReportRow,
  DrilldownCategory,
} from '../types/commercialReports.types';

export interface AdvisorLeadsDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: CommercialExecutiveReportData;
  initialAdvisorId?: string; // 'all' or advisorId
  initialScope?: 'period' | 'month';
  initialFilter?: 'all' | 'sin_seguimiento' | 'con_seguimiento';
  initialCategory?: DrilldownCategory;
  isAdmin?: boolean;
  lockedAdvisorId?: string;
}

export function AdvisorLeadsDrilldownModal({
  isOpen,
  onClose,
  reportData,
  initialAdvisorId = 'all',
  initialScope = 'period',
  initialFilter = 'all',
  initialCategory,
  isAdmin = true,
  lockedAdvisorId,
}: AdvisorLeadsDrilldownModalProps) {
  const isIndividual = reportData.isIndividualReport || !isAdmin || !!lockedAdvisorId;
  const lockedId = lockedAdvisorId || (isIndividual ? reportData.advisorRows[0]?.advisorId : undefined);

  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>(() => {
    if (lockedId) return lockedId;
    return initialAdvisorId;
  });
  const [category, setCategory] = useState<DrilldownCategory>(() => {
    if (initialCategory) return initialCategory;
    return initialScope === 'month' ? 'month_leads' : 'period_leads';
  });
  const [scope, setScope] = useState<'period' | 'month'>(initialScope);
  const [statusFilter, setStatusFilter] = useState<'all' | 'sin_seguimiento' | 'con_seguimiento'>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [copiedAllFeedback, setCopiedAllFeedback] = useState(false);
  const [copiedSinglePhone, setCopiedSinglePhone] = useState<string | null>(null);

  // Sincronizar estado cuando se abre el modal con parámetros específicos
  useEffect(() => {
    if (isOpen) {
      setSelectedAdvisorId(lockedId || initialAdvisorId || 'all');
      const effCategory = initialCategory || (initialScope === 'month' ? 'month_leads' : 'period_leads');
      setCategory(effCategory);
      setScope(effCategory === 'month_leads' ? 'month' : 'period');
      setStatusFilter(initialFilter || 'all');
      setSearchQuery('');
      setExpandedLeadId(null);
      setCopiedAllFeedback(false);
      setCopiedSinglePhone(null);
    }
  }, [isOpen, initialAdvisorId, initialScope, initialFilter, initialCategory, lockedId]);

  // Cerrar con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Encontrar el asesor seleccionado si no es 'all'
  const currentAdvisorRow = useMemo<AdvisorReportRow | undefined>(() => {
    if (selectedAdvisorId === 'all') return undefined;
    return reportData.advisorRows.find(
      (r) => r.advisorId === selectedAdvisorId || r.advisorName.toLowerCase() === selectedAdvisorId.toLowerCase()
    );
  }, [reportData.advisorRows, selectedAdvisorId]);

  // Lista base de leads según el asesor y la categoría solicitada
  const baseLeads = useMemo<AdvisorLeadDetailItem[]>(() => {
    if (selectedAdvisorId === 'all') {
      if (category === 'managed_total') return reportData.allManagedPeriodLeads || [];
      if (category === 'clientes_anteriores') return reportData.allOldManagedPeriodLeads || [];
      if (category === 'leads_sem_con_seguim') return reportData.allNewManagedPeriodLeads || [];
      if (category === 'month_leads') return reportData.allMonthLeads || [];
      return reportData.allPeriodLeads || [];
    }
    if (!currentAdvisorRow) return [];
    if (category === 'managed_total') return currentAdvisorRow.managedPeriodLeads || [];
    if (category === 'clientes_anteriores') return currentAdvisorRow.oldManagedPeriodLeads || [];
    if (category === 'leads_sem_con_seguim') return currentAdvisorRow.newManagedPeriodLeads || [];
    if (category === 'month_leads') return currentAdvisorRow.monthLeads || [];
    return currentAdvisorRow.periodLeads || [];
  }, [selectedAdvisorId, category, reportData, currentAdvisorRow]);

  // Contadores y métricas sobre la lista base
  const metrics = useMemo(() => {
    const total = baseLeads.length;
    let conSeguimiento = 0;
    let sinSeguimiento = 0;

    baseLeads.forEach((l) => {
      const isManaged = category === 'month_leads'
        ? (l.hasMonthFollowUp || l.hasFollowUp)
        : (l.hasPeriodFollowUp || l.hasFollowUp);
      if (isManaged) {
        conSeguimiento++;
      } else {
        sinSeguimiento++;
      }
    });

    const cobertura = total > 0 ? Math.round((conSeguimiento / total) * 100) : 0;
    return { total, conSeguimiento, sinSeguimiento, cobertura };
  }, [baseLeads, category]);

  // Filtrar según el estado de seguimiento y el texto de búsqueda
  const filteredLeads = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return baseLeads.filter((lead) => {
      const isManaged = scope === 'month' ? (lead.hasMonthFollowUp || lead.hasFollowUp) : (lead.hasPeriodFollowUp || lead.hasFollowUp);

      // Filtro de seguimiento
      if (statusFilter === 'con_seguimiento' && !isManaged) return false;
      if (statusFilter === 'sin_seguimiento' && isManaged) return false;

      // Filtro de búsqueda
      if (q) {
        const name = (lead.clientName || '').toLowerCase();
        const phone = (lead.phone || '').toLowerCase();
        const proj = (lead.project || '').toLowerCase();
        const adv = (lead.advisorName || '').toLowerCase();
        const note = (lead.lastFollowUpSummary || '').toLowerCase();
        const status = (lead.status || '').toLowerCase();

        if (
          !name.includes(q) &&
          !phone.includes(q) &&
          !proj.includes(q) &&
          !adv.includes(q) &&
          !note.includes(q) &&
          !status.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [baseLeads, scope, statusFilter, searchQuery]);

  // Abrir el contacto en otra página (nueva pestaña en la Bandeja del CRM)
  const handleOpenLeadInNewTab = (leadId: string) => {
    if (!leadId) return;
    window.open(`/dashboard/inbox?lead=${encodeURIComponent(leadId)}`, '_blank');
  };

  // Acción: Copiar lista de todos los teléfonos visibles
  const handleCopyAllPhones = () => {
    const phones = filteredLeads
      .map((l) => l.phoneRaw || l.phone.replace(/\D/g, ''))
      .filter((p) => p && p.length >= 7);
    const uniquePhones = Array.from(new Set(phones));

    if (uniquePhones.length === 0) return;

    navigator.clipboard.writeText(uniquePhones.join(', '));
    setCopiedAllFeedback(true);
    setTimeout(() => setCopiedAllFeedback(false), 2500);
  };

  // Acción: Copiar un teléfono individual
  const handleCopySinglePhone = (phone: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedSinglePhone(phone);
    setTimeout(() => setCopiedSinglePhone(null), 2000);
  };

  // Acción: Exportar prospectos a CSV
  const handleExportCsv = () => {
    const headers = [
      '#',
      'Fecha Captación',
      'Cliente',
      'Teléfono',
      'Asesor Asignado',
      'Proyecto',
      'Tiene Seguimiento',
      'Última Bitácora / Gestión',
      'Fecha Último Seguimiento',
      'Estado CRM',
    ];

    const rows = filteredLeads.map((l, idx) => {
      const isManaged = scope === 'month' ? (l.hasMonthFollowUp || l.hasFollowUp) : (l.hasPeriodFollowUp || l.hasFollowUp);
      return [
        idx + 1,
        `"${l.createdAtFormatted}"`,
        `"${(l.clientName || '').replace(/"/g, '""')}"`,
        `"${l.phone}"`,
        `"${l.advisorName}"`,
        `"${(l.project || '').replace(/"/g, '""')}"`,
        isManaged ? 'SÍ (Con Seguimiento)' : 'NO (Falta Seguimiento)',
        `"${(l.lastFollowUpSummary || 'Sin registro').replace(/"/g, '""')}"`,
        `"${l.lastFollowUpFormatted || ''}"`,
        `"${l.status || 'nuevo'}"`,
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const advTag = selectedAdvisorId === 'all' ? 'todos' : (currentAdvisorRow?.advisorName || 'asesor').replace(/\s+/g, '_');
    link.setAttribute('href', url);
    link.setAttribute('download', `prospectos_${scope}_${advTag}_${statusFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  const currentTitle =
    isIndividual
      ? (reportData.targetAdvisorName || reportData.advisorRows[0]?.advisorName || 'Mi Cartera')
      : selectedAdvisorId === 'all'
      ? 'Consolidado General (Todos los Asesores)'
      : (currentAdvisorRow?.advisorName || 'Detalle del Asesor');

  const scopeLabel =
    scope === 'month'
      ? `Mes de ${reportData.monthLabel}`
      : `Semana / Período: ${reportData.periodLabel}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100 ring-1 ring-zinc-300/50 dark:ring-zinc-700/50">
        {/* ENCABEZADO SUPERIOR */}
        <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800/80 bg-gradient-to-r from-zinc-50 via-white to-zinc-50 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                <Sparkles size={12} className="text-amber-500 dark:text-amber-400" />
                <span>Auditoría Interactiva de Captaciones</span>
              </span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-800">
                {scopeLabel}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-2">
                <Users size={22} className="text-amber-500 dark:text-amber-400" />
                <span>{currentTitle}</span>
              </h2>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-2xl">
              Haz clic en cualquier prospecto para <strong>abrir su contacto en otra página</strong> o en <strong>"Ver seguimiento"</strong> para revisar su historial de bitácoras y llamadas.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white border border-zinc-200 dark:border-zinc-800 transition cursor-pointer"
            title="Cerrar modal (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* SELECTOR DE ÁMBITO (SEMANA VS MES) + ASESOR + TARJETAS KPI */}
        <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/40 space-y-3.5">
          {/* BOTONES PRINCIPALES DE ÁMBITO Y SELECTOR DE ASESOR */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex p-1 bg-zinc-900/90 rounded-2xl border border-zinc-800 shadow-inner flex-wrap gap-1">
              {/* 1. CAPTADOS SEMANA */}
              <button
                type="button"
                onClick={() => {
                  setCategory('period_leads');
                  setScope('period');
                  setStatusFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  category === 'period_leads'
                    ? 'bg-amber-500 text-zinc-950 shadow-md font-black'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Calendar size={13} />
                <span>Captados Semana</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
                    category === 'period_leads' ? 'bg-zinc-950/25 text-zinc-950 font-black' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {selectedAdvisorId === 'all'
                    ? reportData.totals.captSemana
                    : currentAdvisorRow?.captSemana || 0}
                </span>
              </button>

              {/* 2. CAPTADOS MES */}
              <button
                type="button"
                onClick={() => {
                  setCategory('month_leads');
                  setScope('month');
                  setStatusFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  category === 'month_leads'
                    ? 'bg-amber-500 text-zinc-950 shadow-md font-black'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Calendar size={13} />
                <span>Captados Mes</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
                    category === 'month_leads' ? 'bg-zinc-950/25 text-zinc-950 font-black' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {selectedAdvisorId === 'all'
                    ? reportData.totals.captMes
                    : currentAdvisorRow?.captMes || 0}
                </span>
              </button>

              {/* 3. CLIENTES CON SEGUIMIENTO TOTAL (e.g. los 39 de Edwin) */}
              <button
                type="button"
                onClick={() => {
                  setCategory('managed_total');
                  setScope('period');
                  setStatusFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  category === 'managed_total'
                    ? 'bg-emerald-500 text-zinc-950 shadow-md font-black'
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <CheckCircle2 size={13} />
                <span>Clientes con Seguim.</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
                    category === 'managed_total' ? 'bg-zinc-950/25 text-zinc-950 font-black' : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                  }`}
                >
                  {selectedAdvisorId === 'all'
                    ? reportData.totals.clientesConSeguimiento
                    : currentAdvisorRow?.clientesConSeguimiento || 0}
                </span>
              </button>

              {/* 4. LEADS SEMANA CON SEGUIMIENTO */}
              <button
                type="button"
                onClick={() => {
                  setCategory('leads_sem_con_seguim');
                  setScope('period');
                  setStatusFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  category === 'leads_sem_con_seguim'
                    ? 'bg-emerald-600 text-white shadow-md font-black'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Leads Sem. con Seguim.</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
                    category === 'leads_sem_con_seguim' ? 'bg-zinc-950/25 text-white font-black' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {selectedAdvisorId === 'all'
                    ? reportData.totals.leadsSemConSeguimiento
                    : currentAdvisorRow?.leadsSemConSeguimiento || 0}
                </span>
              </button>

              {/* 5. CLIENTES ANTERIORES */}
              <button
                type="button"
                onClick={() => {
                  setCategory('clientes_anteriores');
                  setScope('period');
                  setStatusFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  category === 'clientes_anteriores'
                    ? 'bg-blue-500 text-zinc-950 shadow-md font-black'
                    : 'text-blue-400 hover:text-blue-200'
                }`}
              >
                <Users size={13} />
                <span>Base Anterior</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] ${
                    category === 'clientes_anteriores' ? 'bg-zinc-950/25 text-zinc-950 font-black' : 'bg-blue-950/80 text-blue-300 border border-blue-800/60'
                  }`}
                >
                  {selectedAdvisorId === 'all'
                    ? reportData.totals.clientesAnteriores
                    : currentAdvisorRow?.clientesAnteriores || 0}
                </span>
              </button>
            </div>

            {/* SELECTOR RÁPIDO DE ASESOR */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400 font-semibold flex items-center gap-1.5">
                <Filter size={13} className="text-amber-400" />
                <span>Asesor:</span>
              </label>
              {isIndividual ? (
                <span className="bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-1.5 text-xs text-amber-300 font-semibold flex items-center gap-1.5 shadow-sm">
                  <User size={12} className="text-amber-400" />
                  <span>{reportData.targetAdvisorName || reportData.advisorRows[0]?.advisorName || 'Mi Cartera'}</span>
                </span>
              ) : (
                <select
                  value={selectedAdvisorId}
                  onChange={(e) => setSelectedAdvisorId(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 hover:border-amber-500/60 rounded-xl px-3 py-1.5 text-xs text-zinc-100 font-medium focus:outline-none focus:border-amber-500 cursor-pointer transition shadow-sm"
                >
                  <option value="all">
                    👥 Todos los Asesores ({category === 'managed_total' ? reportData.totals.clientesConSeguimiento : category === 'clientes_anteriores' ? reportData.totals.clientesAnteriores : category === 'leads_sem_con_seguim' ? reportData.totals.leadsSemConSeguimiento : category === 'month_leads' ? reportData.totals.captMes : reportData.totals.captSemana})
                  </option>
                  {reportData.advisorRows.map((adv) => {
                    const count =
                      category === 'managed_total'
                        ? (adv.clientesConSeguimiento || 0)
                        : category === 'clientes_anteriores'
                        ? (adv.clientesAnteriores || 0)
                        : category === 'leads_sem_con_seguim'
                        ? (adv.leadsSemConSeguimiento || 0)
                        : category === 'month_leads'
                        ? adv.captMes
                        : adv.captSemana;
                    return (
                      <option key={adv.advisorId} value={adv.advisorId}>
                        {adv.advisorName} ({count})
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          </div>

          {/* 4 TARJETAS KPI DE RESUMEN */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center shadow-sm">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-semibold">
                {category === 'managed_total'
                  ? 'Total Clientes Gestionados'
                  : category === 'clientes_anteriores'
                  ? 'Total Base Anterior'
                  : category === 'leads_sem_con_seguim'
                  ? 'Leads Sem. con Seguim.'
                  : `Total Captados (${category === 'month_leads' ? 'Mes' : 'Semana'})`}
              </span>
              <span className="text-2xl sm:text-3xl font-black text-amber-400 font-mono mt-0.5 block">
                {metrics.total}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setStatusFilter('con_seguimiento')}
              className={`p-3 rounded-2xl border text-center transition cursor-pointer shadow-sm ${
                statusFilter === 'con_seguimiento'
                  ? 'bg-emerald-950/70 border-emerald-500 shadow-md ring-1 ring-emerald-500/60'
                  : 'bg-zinc-900/80 border-zinc-800 hover:border-emerald-500/40'
              }`}
            >
              <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-bold flex items-center justify-center gap-1">
                <CheckCircle2 size={11} />
                <span>Con Seguimiento</span>
              </span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mt-0.5 block">
                {metrics.conSeguimiento}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('sin_seguimiento')}
              className={`p-3 rounded-2xl border text-center transition cursor-pointer shadow-sm ${
                statusFilter === 'sin_seguimiento'
                  ? 'bg-rose-950/70 border-rose-500 shadow-md ring-1 ring-rose-500/60'
                  : 'bg-zinc-900/80 border-zinc-800 hover:border-rose-500/40'
              }`}
            >
              <span className="text-[10px] text-rose-400 uppercase tracking-wider block font-bold flex items-center justify-center gap-1">
                <AlertCircle size={11} />
                <span>Faltan Seguimiento</span>
              </span>
              <span className="text-2xl sm:text-3xl font-black text-rose-400 font-mono mt-0.5 block">
                {metrics.sinSeguimiento}
              </span>
            </button>

            <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center shadow-sm">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-semibold">
                {category === 'managed_total' ? 'Gestión Registrada' : category === 'clientes_anteriores' ? 'Gestión Base Previa' : 'Cobertura'}
              </span>
              <span
                className={`text-2xl sm:text-3xl font-black font-mono mt-0.5 block ${
                  metrics.cobertura >= 70
                    ? 'text-emerald-400'
                    : metrics.cobertura >= 40
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {metrics.cobertura}%
              </span>
            </div>
          </div>
        </div>

        {/* BARRA DE HERRAMIENTAS: FILTROS + BUSCADOR + MODO VISTA + ACCIONES */}
        <div className="p-3.5 border-b border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3">
          {/* Pestañas de Estado */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-amber-500 text-zinc-950 shadow-sm font-black'
                  : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
              }`}
            >
              Todos ({metrics.total})
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('sin_seguimiento')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'sin_seguimiento'
                  ? 'bg-rose-600 text-white shadow-sm font-black ring-1 ring-rose-400'
                  : 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60'
              }`}
            >
              <AlertCircle size={13} className="text-rose-400" />
              <span>⚠️ Faltan seguimiento ({metrics.sinSeguimiento})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('con_seguimiento')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'con_seguimiento'
                  ? 'bg-emerald-600 text-white shadow-sm font-black ring-1 ring-emerald-400'
                  : 'bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/60'
              }`}
            >
              <CheckCircle2 size={13} className="text-emerald-400" />
              <span>✅ Con seguimiento ({metrics.conSeguimiento})</span>
            </button>
          </div>

          {/* Buscador + Selector de Vista + Botones de Acción */}
          <div className="flex items-center gap-2 flex-wrap flex-1 sm:flex-initial justify-end">
            {/* Buscador */}
            <div className="relative min-w-[210px] flex-1 sm:flex-initial">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar cliente, teléfono o nota..."
                className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Alternar modo de visualización: Tarjetas vs Tabla */}
            <div className="inline-flex p-0.5 bg-zinc-900 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-zinc-800 text-amber-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Vista de Fichas Ejecutivas"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-zinc-800 text-amber-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Vista de Tabla Estructurada"
              >
                <List size={14} />
              </button>
            </div>

            {/* Copiar lista de teléfonos */}
            <button
              type="button"
              onClick={handleCopyAllPhones}
              disabled={filteredLeads.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
              title="Copiar todos los números visibles separados por coma"
            >
              {copiedAllFeedback ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span className="text-emerald-400 font-bold">¡Copiados!</span>
                </>
              ) : (
                <>
                  <Copy size={13} className="text-amber-400" />
                  <span className="hidden sm:inline">Copiar teléfonos</span>
                </>
              )}
            </button>

            {/* Exportar CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredLeads.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
              title="Descargar lista en CSV / Excel"
            >
              <Download size={13} className="text-zinc-400" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>

        {/* LISTA PRINCIPAL DE PROSPECTOS */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-950">
          {filteredLeads.length === 0 ? (
            <div className="py-20 text-center text-zinc-500 space-y-3">
              <Search size={40} className="mx-auto opacity-30 text-amber-400" />
              <p className="text-base font-semibold text-zinc-300">
                No se encontraron prospectos con los filtros actuales
              </p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Prueba seleccionando la pestaña "Todos", cambiando de asesor o borrando los términos del buscador.
              </p>
            </div>
          ) : viewMode === 'cards' ? (
            /* ═══════════ VISTA 1: FICHAS EJECUTIVAS MODERNAS (RECOMENDADA) ═══════════ */
            <div className="grid grid-cols-1 gap-3">
              {filteredLeads.map((lead, idx) => {
                const isManaged = scope === 'month' ? (lead.hasMonthFollowUp || lead.hasFollowUp) : (lead.hasPeriodFollowUp || lead.hasFollowUp);
                const rawDigits = lead.phoneRaw || lead.phone.replace(/\D/g, '');
                const cleanPhone =
                  rawDigits.length === 10 && rawDigits.startsWith('3')
                    ? `57${rawDigits}`
                    : rawDigits;
                const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
                const isCopied = copiedSinglePhone === lead.phone;
                const isExpanded = expandedLeadId === lead.leadId;
                const bitacorasCount = lead.allBitacoras?.length || (lead.hasFollowUp ? 1 : 0);

                return (
                  <div
                    key={lead.leadId || idx}
                    className={`rounded-2xl border transition-all p-4 shadow-sm ${
                      !isManaged
                        ? 'bg-gradient-to-r from-rose-50/90 via-white to-white dark:from-rose-950/20 dark:via-zinc-900/60 dark:to-zinc-900/40 border-rose-300 dark:border-rose-900/50 hover:border-rose-400 dark:hover:border-rose-500/70'
                        : 'bg-white dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 border-zinc-200 dark:border-zinc-800/90 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    {/* FILA SUPERIOR: CLIENTE + ACCIONES DIRECTAS */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 flex-1 min-w-[240px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold text-zinc-600 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                            #{idx + 1}
                          </span>

                          {/* Nombre del cliente con enlace directo a nueva pestaña */}
                          <button
                            type="button"
                            onClick={() => handleOpenLeadInNewTab(lead.leadId)}
                            className="font-black text-zinc-900 dark:text-white hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1.5 text-left group cursor-pointer"
                            title="Haz clic para abrir el contacto en otra página (Bandeja CRM)"
                          >
                            <span className="text-base group-hover:underline">
                              {lead.clientName}
                            </span>
                            <ArrowUpRight size={15} className="text-zinc-400 group-hover:text-amber-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                          </button>

                          {/* Estado CRM */}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                              lead.status === 'lost' || lead.status?.toLowerCase().includes('cancel') || lead.status?.toLowerCase().includes('no_interesado')
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : lead.status === 'closed'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                            }`}
                          >
                            {lead.status === 'lost' ? 'Cancelado / No Interesado' : (lead.status || 'Nuevo')}
                          </span>

                          {/* Origen: Captado en la semana vs Traslado vs Base Anterior */}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                              lead.fromTransfer
                                ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                : lead.isPeriodCreated
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                  : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                            }`}
                          >
                            {lead.fromTransfer
                              ? 'Traslado / Calle'
                              : lead.isPeriodCreated
                                ? 'Captado Semana'
                                : 'Base Anterior'}
                          </span>

                          {/* Origen */}
                          {lead.source && (
                            <span className="text-[10px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                              {lead.source}
                            </span>
                          )}
                        </div>

                        {/* Metadatos secundarios: Fecha, Asesor, Proyecto */}
                        <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap pt-0.5">
                          <span className="flex items-center gap-1 text-zinc-300">
                            <Clock size={12} className="text-zinc-500" />
                            <span>Captado: <strong>{lead.createdAtFormatted}</strong></span>
                          </span>

                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            <span>Asesor: <strong className="text-zinc-200">{lead.advisorName}</strong></span>
                          </span>

                          {lead.project && (
                            <span className="flex items-center gap-1 text-zinc-300">
                              <Building size={12} className="text-zinc-500" />
                              <span>{lead.project}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* BOTONES DE ACCIÓN RÁPIDA */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* 1. Teléfono / WhatsApp Directo */}
                        {waUrl ? (
                          <div className="inline-flex items-center gap-1">
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/35 text-xs font-mono font-bold transition shadow-xs"
                              title="Abrir chat en WhatsApp"
                            >
                              <Phone size={12} className="text-emerald-400" />
                              <span>{lead.phone}</span>
                              <ExternalLink size={10} className="opacity-70" />
                            </a>

                            <button
                              type="button"
                              onClick={() => handleCopySinglePhone(lead.phone)}
                              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                              title="Copiar número de teléfono"
                            >
                              {isCopied ? (
                                <Check size={13} className="text-emerald-400" />
                              ) : (
                                <Copy size={13} />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500 font-mono">
                            {lead.phone || 'Sin número'}
                          </span>
                        )}

                        {/* 2. Botón Ver Seguimiento */}
                        <button
                          type="button"
                          onClick={() => setExpandedLeadId(isExpanded ? null : lead.leadId)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                            isExpanded
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                              : isManaged
                              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                              : 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60'
                          }`}
                          title="Desplegar el historial de bitácoras y llamadas"
                        >
                          <Clock size={12} />
                          <span>
                            {isExpanded ? 'Ocultar seguimiento' : `Ver seguimiento (${bitacorasCount})`}
                          </span>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>

                        {/* 3. Botón Abrir Contacto en Otra Página */}
                        <button
                          type="button"
                          onClick={() => handleOpenLeadInNewTab(lead.leadId)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-950/40 hover:bg-sky-900/60 text-sky-300 border border-sky-700/50 text-xs font-bold transition cursor-pointer shadow-xs"
                          title="Abrir este contacto en una nueva pestaña (Bandeja CRM)"
                        >
                          <MessageSquare size={12} className="text-sky-400" />
                          <span>Ver contacto en otra página</span>
                          <ExternalLink size={11} className="opacity-80" />
                        </button>
                      </div>
                    </div>

                    {/* VISTA PREVIA RÁPIDA DEL SEGUIMIENTO (O ALERTA SI FALTA) */}
                    <div className="mt-3 pt-2.5 border-t border-zinc-800/80">
                      {isManaged ? (
                        <div className="flex items-start justify-between gap-3 text-xs bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-2.5">
                          <div className="space-y-0.5">
                            <span className="font-bold text-emerald-400 inline-flex items-center gap-1 text-[11px]">
                              <CheckCircle2 size={12} />
                              <span>Con seguimiento registrado</span>
                              {lead.lastFollowUpAuthor && (
                                <span className="text-zinc-400 font-normal">por {lead.lastFollowUpAuthor}</span>
                              )}
                            </span>
                            {lead.lastFollowUpSummary ? (
                              <p className="text-zinc-300 italic text-xs leading-relaxed">
                                "{lead.lastFollowUpSummary}"
                              </p>
                            ) : (
                              <p className="text-zinc-400 italic text-[11px]">
                                Bitácora o llamada registrada en el período.
                              </p>
                            )}
                          </div>

                          {lead.lastFollowUpFormatted && (
                            <span className="text-[11px] text-zinc-400 font-mono whitespace-nowrap bg-zinc-900/80 px-2 py-0.5 rounded-md border border-zinc-800">
                              {lead.lastFollowUpFormatted}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 text-xs bg-rose-950/30 border border-rose-800/50 rounded-xl p-2.5 text-rose-300">
                          <span className="font-black text-rose-400 flex items-center gap-1.5 text-xs">
                            <AlertCircle size={14} className="text-rose-400 shrink-0" />
                            <span>⚠️ FALTA SEGUIMIENTO: Sin llamadas ni bitácoras registradas en este período.</span>
                          </span>

                          {waUrl && (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-bold text-amber-300 hover:text-white underline decoration-dotted flex items-center gap-1 shrink-0"
                            >
                              <span>Contactar ahora</span>
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* HISTORIAL EXPANDIDO COMPLETO DE BITÁCORAS */}
                    {isExpanded && (
                      <div className="mt-3.5 p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-2.5 animate-in fade-in-50 duration-150">
                        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                          <span className="font-bold text-zinc-200 flex items-center gap-1.5 text-xs">
                            <Clock size={13} className="text-amber-400" />
                            <span>Historial Completo de Bitácoras & Gestiones de {lead.clientName}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenLeadInNewTab(lead.leadId)}
                            className="text-xs text-amber-400 hover:underline flex items-center gap-1 cursor-pointer font-semibold"
                          >
                            <span>Abrir ficha completa en Bandeja CRM</span>
                            <ExternalLink size={11} />
                          </button>
                        </div>

                        {lead.allBitacoras && lead.allBitacoras.length > 0 ? (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {lead.allBitacoras.map((b, bIdx) => (
                              <div
                                key={bIdx}
                                className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1"
                              >
                                <div className="flex items-center justify-between text-xs flex-wrap gap-1">
                                  <span className="font-bold text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 size={12} />
                                    <span>{b.action || 'Gestión comercial'}</span>
                                  </span>
                                  <span className="text-zinc-400 font-mono text-[11px] bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                                    {b.date}
                                  </span>
                                </div>
                                <p className="text-zinc-200 text-xs leading-relaxed italic">
                                  "{b.description}"
                                </p>
                                <div className="text-[10px] text-zinc-500 pt-0.5">
                                  Asesor autor: <strong className="text-zinc-300">{b.author}</strong>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-300 text-xs flex items-start gap-2.5">
                            <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-rose-200">Sin bitácoras registradas</p>
                              <p className="text-[11px] text-rose-300/80 mt-0.5">
                                Este prospecto aún no cuenta con notas ni llamadas registradas en su ficha técnica del CRM.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ═══════════ VISTA 2: TABLA ESTRUCTURADA CON ENCABEZADOS NÍTIDOS ═══════════ */
            <div className="border border-zinc-800 rounded-2xl overflow-hidden shadow-inner bg-zinc-900/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-900 text-zinc-300 uppercase tracking-wider text-[11px] font-bold border-b border-zinc-800 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center text-zinc-400">#</th>
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Cliente / Contacto</th>
                    <th className="py-3 px-3">Teléfono / WhatsApp</th>
                    <th className="py-3 px-3">Asesor</th>
                    <th className="py-3 px-3">Proyecto</th>
                    <th className="py-3 px-4 w-1/3">Seguimiento / Bitácora</th>
                    <th className="py-3 px-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80 bg-zinc-950 font-normal">
                  {filteredLeads.map((lead, idx) => {
                    const isManaged = scope === 'month' ? (lead.hasMonthFollowUp || lead.hasFollowUp) : (lead.hasPeriodFollowUp || lead.hasFollowUp);
                    const rawDigits = lead.phoneRaw || lead.phone.replace(/\D/g, '');
                    const cleanPhone =
                      rawDigits.length === 10 && rawDigits.startsWith('3')
                        ? `57${rawDigits}`
                        : rawDigits;
                    const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
                    const isCopied = copiedSinglePhone === lead.phone;

                    return (
                      <tr
                        key={lead.leadId || idx}
                        className={`hover:bg-zinc-900/70 transition ${
                          !isManaged ? 'bg-rose-950/10' : ''
                        }`}
                      >
                        {/* Num */}
                        <td className="py-3 px-3 text-center text-zinc-500 font-mono text-xs">
                          {idx + 1}
                        </td>

                        {/* Fecha */}
                        <td className="py-3 px-3 text-zinc-300 font-mono text-[11px] whitespace-nowrap">
                          {lead.createdAtFormatted}
                        </td>

                        {/* Cliente con clic directo para abrir en otra página */}
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleOpenLeadInNewTab(lead.leadId)}
                            className="font-bold text-white hover:text-amber-400 text-left transition flex items-center gap-1 group cursor-pointer"
                            title="Abrir este contacto en otra página"
                          >
                            <span className="group-hover:underline text-xs">{lead.clientName}</span>
                            <ArrowUpRight size={12} className="text-zinc-500 group-hover:text-amber-400 opacity-70" />
                          </button>
                          <div className="flex items-center gap-1 pt-0.5 flex-wrap">
                            <span className="text-[10px] text-zinc-500">
                              {lead.source || 'Directo'}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full uppercase border ${
                                lead.status === 'lost' || lead.status?.toLowerCase().includes('cancel') || lead.status?.toLowerCase().includes('no_interesado')
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                  : lead.status === 'closed'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                              }`}
                            >
                              {lead.status === 'lost' ? 'Cancelado' : (lead.status || 'Nuevo')}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                lead.fromTransfer
                                  ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                  : lead.isPeriodCreated
                                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                    : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                              }`}
                            >
                              {lead.fromTransfer ? 'Traslado' : lead.isPeriodCreated ? 'Semana' : 'Base Anterior'}
                            </span>
                          </div>
                        </td>

                        {/* Teléfono */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {waUrl ? (
                            <div className="inline-flex items-center gap-1.5">
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono font-bold transition"
                                title="Abrir WhatsApp"
                              >
                                <Phone size={11} className="text-emerald-400" />
                                <span>{lead.phone}</span>
                                <ExternalLink size={10} className="opacity-70" />
                              </a>
                              <button
                                type="button"
                                onClick={() => handleCopySinglePhone(lead.phone)}
                                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                                title="Copiar número"
                              >
                                {isCopied ? (
                                  <Check size={11} className="text-emerald-400" />
                                ) : (
                                  <Copy size={11} />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-zinc-500 font-mono text-xs">
                              {lead.phone || 'Sin número'}
                            </span>
                          )}
                        </td>

                        {/* Asesor */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="text-xs text-zinc-200 font-medium">
                            {lead.advisorName}
                          </span>
                        </td>

                        {/* Proyecto */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="text-xs text-zinc-300">
                            {lead.project || 'Sin proyecto'}
                          </span>
                        </td>

                        {/* Seguimiento */}
                        <td className="py-3 px-4 text-xs">
                          {isManaged ? (
                            <div className="space-y-0.5">
                              <span className="font-bold text-emerald-400 inline-flex items-center gap-1 text-[11px]">
                                <CheckCircle2 size={11} />
                                <span>Con seguimiento</span>
                              </span>
                              {lead.lastFollowUpSummary && (
                                <p className="text-zinc-300 italic text-[11px] line-clamp-2">
                                  "{lead.lastFollowUpSummary}"
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded-md border border-rose-800/60">
                              <AlertCircle size={12} />
                              <span>FALTA SEGUIMIENTO</span>
                            </span>
                          )}
                        </td>

                        {/* Acciones */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenLeadInNewTab(lead.leadId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-950/50 hover:bg-sky-900 text-sky-300 border border-sky-800/60 text-xs font-semibold transition cursor-pointer"
                            title="Abrir contacto en otra página"
                          >
                            <ExternalLink size={12} />
                            <span>Ver ficha</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PIE DE PÁGINA DEL MODAL */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between text-xs text-zinc-400">
          <span className="flex items-center gap-2 text-xs">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>
              Mostrando <strong>{filteredLeads.length}</strong> de <strong>{metrics.total}</strong> prospectos{' '}
              {category === 'managed_total'
                ? '(clientes gestionados con seguimiento real)'
                : category === 'clientes_anteriores'
                ? '(clientes de base anterior gestionados)'
                : category === 'leads_sem_con_seguim'
                ? '(leads de la semana con seguimiento)'
                : category === 'month_leads'
                ? '(del mes)'
                : '(de la semana)'}
              .
            </span>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs transition cursor-pointer shadow-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
