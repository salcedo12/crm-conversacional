import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Printer,
  FileSpreadsheet,
  Share2,
  Sparkles,
  Edit3,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  MessageSquare,
  TrendingUp,
  Layers,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Play,
  Bot,
  Megaphone,
  Search,
  Filter,
  User,
  Users,
  X,
  ExternalLink,
  Phone,
  MousePointerClick,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Spinner } from '@/shared/components/Spinner';
import { CommercialAssistantDrawer } from './CommercialAssistantDrawer';
import { AdvisorLeadsDrilldownModal } from './AdvisorLeadsDrilldownModal';
import {
  compileCommercialReportData,
  enhanceReportWithAi,
  exportReportToCsv,
  formatReportForWhatsApp,
} from '../services/commercialReports.service';
import { getCommercialWeekStart } from '../services/commercial.service';
import {
  OFFICIAL_REPORT_PRINT_CSS,
  prepareReportForPrint,
  restoreAfterReportPrint,
} from '../services/officialReportPrint';
import type {
  CommercialExecutiveReportData,
  ReportPeriodType,
  DrilldownCategory,
} from '../types/commercialReports.types';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

interface CommercialReportViewProps {
  companyId: string;
  currentUserName?: string;
  currentUserId?: string;
  isAdmin?: boolean;
}

export function CommercialReportView({
  companyId,
  currentUserName,
  currentUserId,
  isAdmin = true,
}: CommercialReportViewProps) {
  const [loading, setLoading] = useState(true);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [previewMode, setPreviewMode] = useState<'official' | 'crm'>('official');
  const [reportSubTab, setReportSubTab] = useState<'official_doc' | 'daily_activity' | 'marketing_pautas'>('official_doc');
  const [pendingPrint, setPendingPrint] = useState(false);
  const [marketingFilter, setMarketingFilter] = useState<'all' | 'pauta' | 'organico'>('all');
  const [marketingSearch, setMarketingSearch] = useState('');
  const [expandedCampaignKey, setExpandedCampaignKey] = useState<string | null>(null);
  const [reportData, setReportData] = useState<CommercialExecutiveReportData | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [selectedCampaignModal, setSelectedCampaignModal] = useState<any>(null);
  const [modalAdvisorFilter, setModalAdvisorFilter] = useState<string>('all');
  const [modalLeadSearch, setModalLeadSearch] = useState('');

  // Filtro de Asesor: si NO es admin, queda estrictamente bloqueado en su propio usuario
  const [selectedAdvisorFilter, setSelectedAdvisorFilter] = useState<string>(() => {
    return isAdmin ? 'all' : (currentUserId || currentUserName || '');
  });

  // Modal interactivo de prospectos por asesor / totales (semana y mes)
  const [advisorDrilldown, setAdvisorDrilldown] = useState<{
    isOpen: boolean;
    advisorId: string;
    scope: 'period' | 'month';
    filter: 'all' | 'sin_seguimiento' | 'con_seguimiento';
    category?: DrilldownCategory;
  }>({
    isOpen: false,
    advisorId: 'all',
    scope: 'period',
    filter: 'all',
    category: 'period_leads',
  });

  const handleOpenAdvisorDrilldown = (options: {
    advisorId?: string;
    scope?: 'period' | 'month';
    filter?: 'all' | 'sin_seguimiento' | 'con_seguimiento';
    category?: DrilldownCategory;
  }) => {
    const isIndiv = !isAdmin || reportData?.isIndividualReport;
    const effectiveDrillAdvisorId = isIndiv
      ? (reportData?.advisorRows[0]?.advisorId || currentUserId || currentUserName || 'all')
      : (options.advisorId || 'all');

    const effectiveCategory = options.category || (options.scope === 'month' ? 'month_leads' : 'period_leads');

    setAdvisorDrilldown({
      isOpen: true,
      advisorId: effectiveDrillAdvisorId,
      scope: options.scope || (effectiveCategory === 'month_leads' ? 'month' : 'period'),
      filter: options.filter || 'all',
      category: effectiveCategory,
    });
  };

  const handleOpenCampaignModal = (campaign: any, defaultAdvisorFilter: string = 'all') => {
    setSelectedCampaignModal(campaign);
    setModalAdvisorFilter(defaultAdvisorFilter);
    setModalLeadSearch('');
  };

  // Prospectos filtrados en el modal por asesor o término de búsqueda
  const modalFilteredLeads = useMemo(() => {
    if (!selectedCampaignModal || !selectedCampaignModal.sampleLeads) return [];
    return (selectedCampaignModal.sampleLeads as any[]).filter((lead) => {
      if (modalAdvisorFilter !== 'all') {
        const leadAdv = (lead.advisorName || '').toLowerCase().trim();
        const targetAdv = modalAdvisorFilter.toLowerCase().trim();
        if (!leadAdv.includes(targetAdv) && !targetAdv.includes(leadAdv)) {
          return false;
        }
      }
      if (modalLeadSearch.trim()) {
        const q = modalLeadSearch.toLowerCase().trim();
        const name = (lead.clientName || '').toLowerCase();
        const phone = (lead.phone || '').toLowerCase();
        const adv = (lead.advisorName || '').toLowerCase();
        const note = (lead.lastFollowUpSummary || '').toLowerCase();
        const ad = (lead.adExcerpt || '').toLowerCase();
        if (
          !name.includes(q) &&
          !phone.includes(q) &&
          !adv.includes(q) &&
          !note.includes(q) &&
          !ad.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [selectedCampaignModal, modalAdvisorFilter, modalLeadSearch]);

  // Listener para cerrar modal con tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCampaignModal) {
        setSelectedCampaignModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCampaignModal]);

  // Calendario interactivo día a día (cerrado por defecto para mostrar de inmediato el informe oficial)
  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(() => new Date());
  const [selectedRangeStart, setSelectedRangeStart] = useState<Date>(() => getCommercialWeekStart(new Date()));

  const [selectedRangeEnd, setSelectedRangeEnd] = useState<Date>(() => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return now;
  });

  const [calendarPickStep, setCalendarPickStep] = useState<'start' | 'end'>('start');

  // Metadatos editables
  const [preparedBy, setPreparedBy] = useState<string>(() => {
    if (!isAdmin && currentUserName) {
      return `${currentUserName} – Asesor Comercial`;
    }
    return currentUserName ? `${currentUserName} – Sistemas` : 'Luis Eduardo Salcedo Aya – Sistemas';
  });
  const [forRecipient, setForRecipient] = useState<string>('Gerencia');

  // Filtro de día específico en el desglose
  const [selectedDayFilter, setSelectedDayFilter] = useState<string | 'all'>('all');

  // Modo edición de puntos de atención
  const [editingPointIdx, setEditingPointIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [copiedToast, setCopiedToast] = useState(false);
  const [syncingSmartHome, setSyncingSmartHome] = useState(false);
  const [syncResultToast, setSyncResultToast] = useState<string | null>(null);
  const [salesTableTab, setSalesTableTab] = useState<"week" | "month">("week");

  // Formato legible del período
  const periodLabelFormatted = useMemo(() => {
    const s = selectedRangeStart;
    const e = selectedRangeEnd;
    const sDay = s.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const eDay = e.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const eTime = e.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return `${sDay} al ${eDay} (${eTime})`;
  }, [selectedRangeStart, selectedRangeEnd]);

  // Días para la grilla del calendario mensual
  const calendarGrid = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Ajustar a lunes = 0
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: { date: Date; isCurrentMonth: boolean; key: string }[] = [];

    // Días del mes anterior para rellenar
    for (let i = startDayOfWeek; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: d, isCurrentMonth: false, key: k });
    }

    // Días del mes actual
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const d = new Date(year, month, i);
      const k = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ date: d, isCurrentMonth: true, key: k });
    }

    // Días del mes siguiente para completar la grilla (múltiplo de 7)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: d, isCurrentMonth: false, key: k });
    }

    return days;
  }, [calendarViewDate]);

  const [compiledRange, setCompiledRange] = useState<{ start: number; end: number } | null>(null);

  // Saber si el usuario modificó las fechas del calendario pero aún no ha generado el informe
  const isRangePending = useMemo(() => {
    if (!compiledRange) return false;
    return (
      compiledRange.start !== selectedRangeStart.getTime() ||
      compiledRange.end !== selectedRangeEnd.getTime()
    );
  }, [compiledRange, selectedRangeStart, selectedRangeEnd]);

  // Cargar datos del reporte
  const loadReport = useCallback(
    async (withAi = false, customStart?: Date, customEnd?: Date, targetAdvisorId?: string) => {
      if (!companyId) return;
      setLoading(true);
      try {
        const activeStart = customStart || selectedRangeStart;
        const activeEnd = customEnd || selectedRangeEnd;

        const daysDiff = Math.round(
          Math.abs(activeEnd.getTime() - activeStart.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Se considera reporte mensual si cubre 15+ días o inicia el 1 del mes y llega al corte/fin
        const isMonthly =
          daysDiff >= 15 ||
          (activeStart.getDate() === 1 && activeEnd.getDate() >= 20);

        const pType: ReportPeriodType = isMonthly ? 'monthly' : 'weekly';

        const sDay = activeStart.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
        const eDay = activeEnd.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const eTime = activeEnd.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        const labelFormatted = `${sDay} al ${eDay} (${eTime})`;

        // Si NO es admin, queda estrictamente fijado en el usuario asesor actual
        const effectiveAdvisorId = !isAdmin
          ? (currentUserId || currentUserName)
          : (targetAdvisorId !== undefined ? targetAdvisorId : selectedAdvisorFilter);

        const initial = await compileCommercialReportData(companyId, {
          periodType: pType,
          startDate: activeStart.getTime(),
          endDate: activeEnd.getTime(),
          periodLabel: labelFormatted,
          preparedBy,
          forRecipient,
          advisorId: effectiveAdvisorId,
          advisorName: currentUserName,
        });

        if (withAi) {
          setAnalyzingAi(true);
          const enriched = await enhanceReportWithAi(initial);
          setReportData(enriched);
          setAnalyzingAi(false);
        } else {
          setReportData(initial);
        }

        setCompiledRange({ start: activeStart.getTime(), end: activeEnd.getTime() });
      } catch (err) {
        console.error('[CommercialReportView] Error compilando reporte:', err);
      } finally {
        setLoading(false);
      }
    },
    [companyId, selectedRangeStart, selectedRangeEnd, preparedBy, forRecipient, isAdmin, currentUserId, currentUserName, selectedAdvisorFilter]
  );

  const handleAdvisorFilterChange = (newAdvId: string) => {
    if (!isAdmin) return;
    setSelectedAdvisorFilter(newAdvId);
    loadReport(false, undefined, undefined, newAdvId);
  };

  // Carga inicial al montar el componente
  useEffect(() => {
    loadReport(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const handleGenerateReport = async (withAi = true) => {
    await loadReport(withAi, selectedRangeStart, selectedRangeEnd);
  };

  const handleRunAiAnalysis = async () => {
    if (!reportData) return;
    setAnalyzingAi(true);
    try {
      const enriched = await enhanceReportWithAi(reportData);
      setReportData(enriched);
    } catch (err) {
      console.error('[CommercialReportView] Error al ejecutar IA:', err);
    } finally {
      setAnalyzingAi(false);
    }
  };


  const handleSyncSmartHome = async () => {
    if (!companyId || syncingSmartHome) return;
    setSyncingSmartHome(true);
    setSyncResultToast(null);
    try {
      const fn = httpsCallable<
        { companyId: string; daysBack?: number },
        { ok: boolean; message: string; updatedLeads: number; createdLeads: number; bitacorasSynced: number; notesCreated: number; salesCount: number }
      >(functions, 'syncSmartHomeRecentActivity');
      const res = await fn({ companyId, daysBack: 7 });
      const msg = res.data.message || 'Sincronización completada con éxito.';
      setSyncResultToast(msg);
      setTimeout(() => setSyncResultToast(null), 9000);
      await loadReport(false);
    } catch (err: any) {
      console.error('[CommercialReportView] Error sincronizando SmartHome:', err);
      const detail = err?.details || err?.message || 'Error de conexión con SmartHome';
      setSyncResultToast(`Error: ${detail}`);
      setTimeout(() => setSyncResultToast(null), 9000);
    } finally {
      setSyncingSmartHome(false);
    }
  };

  const handlePrint = () => {
    // El documento oficial solo existe en su pestaña: si estamos en otra, se abre y luego se imprime.
    if (reportSubTab === 'official_doc') {
      window.print();
    } else {
      setPendingPrint(true);
      setReportSubTab('official_doc');
    }
  };

  const handleExportCsv = () => {
    if (!reportData) return;
    exportReportToCsv(reportData);
  };

  const handleCopyWhatsApp = () => {
    if (!reportData) return;
    const text = formatReportForWhatsApp(reportData);
    navigator.clipboard.writeText(text);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2500);
  };

  const startEditPoint = (idx: number, currentText: string) => {
    setEditingPointIdx(idx);
    setEditingText(currentText);
  };

  const saveEditPoint = (idx: number) => {
    if (!reportData) return;
    const updated = [...reportData.attentionPoints];
    updated[idx] = { ...updated[idx], text: editingText };
    setReportData({ ...reportData, attentionPoints: updated });
    setEditingPointIdx(null);
  };

  // Manejo de clics en el calendario interactivo
  const handleDayClick = (d: Date) => {
    if (calendarPickStep === 'start') {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      setSelectedRangeStart(start);
      if (selectedRangeEnd < start) {
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        setSelectedRangeEnd(end);
      }
      setCalendarPickStep('end');
    } else {
      let start = new Date(selectedRangeStart);
      let end = new Date(d);
      end.setHours(23, 59, 59, 999);

      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      setSelectedRangeStart(start);
      setSelectedRangeEnd(end);
      setCalendarPickStep('start');
    }
  };

  // Atajos rápidos
  const applyQuickPreset = (preset: 'this_week' | 'last_fri_fri' | 'current_month' | 'last_month' | 'today') => {
    const now = new Date();
    let start: Date;
    let end: Date;

    if (preset === 'this_week') {
      // Semana comercial en curso de Meraki (Ciclo activo que se audita y gestiona)
      start = getCommercialWeekStart(now);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      setCalendarViewDate(new Date(now));
    } else if (preset === 'last_fri_fri') {
      // Semana comercial cerrada anterior (Viernes anterior 00:00 al Viernes corte 09:00 a. m.)
      const currentDay = now.getDay();
      const rawDiff = (currentDay + 2) % 7;
      const daysSinceFriday = rawDiff === 0 ? 7 : rawDiff;
      const lastFriday = new Date(now);
      lastFriday.setDate(now.getDate() - daysSinceFriday);
      lastFriday.setHours(9, 0, 0, 0);

      const prevFriday = new Date(lastFriday);
      prevFriday.setDate(lastFriday.getDate() - 7);
      prevFriday.setHours(0, 0, 0, 0);

      start = prevFriday;
      end = lastFriday;
      setCalendarViewDate(new Date(lastFriday));
    } else if (preset === 'current_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      setCalendarViewDate(new Date(now));
    } else if (preset === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      setCalendarViewDate(new Date(start));
    } else {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      setCalendarViewDate(new Date(now));
    }

    setSelectedRangeStart(start);
    setSelectedRangeEnd(end);
    setCalendarPickStep('start');

    // Cargar y analizar de inmediato el informe con el rango elegido
    loadReport(true, start, end);
  };

  // Días de actividad filtrados si el usuario hace clic en un día concreto
  const displayedDailyActivities = useMemo(() => {
    if (!reportData?.dailyActivities) return [];
    if (selectedDayFilter === 'all') return reportData.dailyActivities;
    return reportData.dailyActivities.filter((d) => d.dateKey === selectedDayFilter);
  }, [reportData?.dailyActivities, selectedDayFilter]);

  useEffect(() => {
    if (!pendingPrint || reportSubTab !== 'official_doc') return;
    setPendingPrint(false);
    window.print();
  }, [pendingPrint, reportSubTab]);

  // Fechas del informe ya generado (no las del calendario, que pueden estar sin aplicar).
  const reportStartDate = reportData?.startDate;
  const reportEndDate = reportData?.endDate;

  useEffect(() => {
    const toIsoDay = (ms?: number) => {
      if (!ms) return '';
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const fileName = `Informe_Gestion_Comercial_${toIsoDay(reportStartDate)}_a_${toIsoDay(reportEndDate)}`;
    const onBeforePrint = () => prepareReportForPrint(fileName);

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', restoreAfterReportPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', restoreAfterReportPrint);
      restoreAfterReportPrint();
    };
  }, [reportStartDate, reportEndDate]);

  if (loading && !reportData) {
    return (
      <div className="flex flex-col items-center justify-center p-20 space-y-4">
        <Spinner size="lg" />
        <p className="text-xs text-zinc-400">Compilando calendario de actividad, bitácoras y ventas día a día...</p>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="p-8 text-center text-xs text-zinc-400">
        No se pudo generar el informe para los parámetros seleccionados.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── BARRA DE CONTROL PRINCIPAL (Oculta al imprimir) ── */}
      <div className="no-print bg-zinc-900 border border-zinc-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="p-3 rounded-2xl bg-gradient-to-br from-violet-600/30 to-amber-500/20 text-amber-400 border border-amber-500/30 shadow-inner">
              <CalendarIcon size={24} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-zinc-100">Generador de Informes Gerenciales</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {reportData.monthLabel}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Calendario día a día con lectura de fichas técnicas y análisis cualitativo con IA.
              </p>
            </div>
          </div>

          {/* Acciones principales de exportación e IA */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* BOTÓN PRIMARIO: GENERAR Y ANALIZAR INFORME */}
            <button
              type="button"
              onClick={() => handleGenerateReport(true)}
              disabled={loading || analyzingAi}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all shadow-lg cursor-pointer disabled:opacity-50 ${
                isRangePending
                  ? 'bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 text-zinc-950 ring-2 ring-amber-300 animate-pulse shadow-amber-500/40'
                  : 'bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-amber-500/20'
              }`}
              title="Carga, compila y analiza todas las fichas, bitácoras y ventas del rango seleccionado con IA"
            >
              {loading ? (
                <RefreshCw size={14} className="animate-spin text-zinc-950" />
              ) : analyzingAi ? (
                <Sparkles size={14} className="animate-spin text-zinc-950" />
              ) : (
                <Play size={14} className="fill-zinc-950 text-zinc-950" />
              )}
              <span>
                {loading
                  ? 'Compilando Informe...'
                  : analyzingAi
                  ? 'Analizando con IA...'
                  : isRangePending
                  ? '⚡ Generar Informe (Nuevas Fechas)'
                  : '⚡ Generar y Analizar Informe'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleSyncSmartHome}
              disabled={syncingSmartHome}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sky-300 border border-sky-500/30 text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
              title="Descarga bitácoras, seguimientos y ventas recientes directamente desde SmartHome al CRM"
            >
              <RefreshCw size={14} className={syncingSmartHome ? 'animate-spin text-sky-400' : 'text-sky-400'} />
              <span>{syncingSmartHome ? 'Sincronizando...' : 'Sincronizar SmartHome'}</span>
            </button>

            <button
              type="button"
              onClick={handleRunAiAnalysis}
              disabled={analyzingAi}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
              title="Lee todas las bitácoras y observaciones para redactar el análisis cualitativo"
            >
              <Sparkles size={14} className={analyzingAi ? 'animate-spin' : ''} />
              <span>{analyzingAi ? 'Analizando Fichas...' : 'Analizar Fichas con IA'}</span>
            </button>

            {/* BOTÓN COPILOTO COMERCIAL IA (Solo Administradores) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsAssistantOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500/20 via-purple-500/20 to-indigo-500/20 hover:from-amber-500/30 hover:to-indigo-500/30 text-amber-300 border border-amber-500/40 text-xs font-black transition-all shadow-md cursor-pointer"
                title="Abre el Copiloto de IA para hacer preguntas en vivo sobre pauta, llamadas, visitas y asesores"
              >
                <Bot size={15} className="text-amber-400" />
                <span>💬 Copiloto Comercial IA</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-extrabold transition shadow-md cursor-pointer"
              title="Abre la ventana de impresión: elige «Guardar como PDF» para descargar solo el informe"
            >
              <Printer size={14} />
              <span>Descargar / Imprimir PDF</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-semibold transition cursor-pointer"
              title="Descarga el anexo en formato Excel / CSV"
            >
              <FileSpreadsheet size={14} />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer"
              title="Copia el resumen formateado para pegar en WhatsApp"
            >
              <Share2 size={14} />
              <span>{copiedToast ? '¡Copiado!' : 'WhatsApp'}</span>
            </button>

            <div className="h-6 w-px bg-zinc-800 mx-1 hidden sm:block" />

            {/* Alternador de pestaña: Informe Oficial (Principal) vs Marketing y Pautas vs Desglose Día a Día */}
            <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1 text-[11px] font-semibold flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setReportSubTab('official_doc')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  reportSubTab === 'official_doc'
                    ? 'bg-amber-500 text-zinc-950 font-black shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileText size={13} />
                <span>Informe Oficial Meraki</span>
              </button>
              <button
                type="button"
                onClick={() => setReportSubTab('marketing_pautas')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  reportSubTab === 'marketing_pautas'
                    ? 'bg-sky-500 text-zinc-950 font-black shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Megaphone size={13} />
                <span>Marketing & Pautas ({reportData?.marketingReport?.campaigns.length ?? 0})</span>
              </button>
              <button
                type="button"
                onClick={() => setReportSubTab('daily_activity')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  reportSubTab === 'daily_activity'
                    ? 'bg-violet-600 text-white font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <CalendarIcon size={13} />
                <span>Desglose Día a Día</span>
              </button>
            </div>

            {/* Alternador modo vista oficial: Hoja A4 blanca vs Oscuro */}
            {reportSubTab === 'official_doc' && (
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setPreviewMode('official')}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    previewMode === 'official' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  A4 Blanco
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('crm')}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    previewMode === 'crm' ? 'bg-zinc-800 text-zinc-200 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Oscuro
                </button>
              </div>
            )}
          </div>
        </div>


      {/* Notificación de resultado de sincronización SmartHome */}
      {syncResultToast && (
        <div
          className={`no-print rounded-2xl p-4 text-xs flex items-center justify-between shadow-xl animate-fade-in ${
            syncResultToast.startsWith('Error')
              ? 'bg-rose-950/90 border border-rose-500/50 text-rose-200'
              : 'bg-emerald-950/90 border border-emerald-500/50 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {syncResultToast.startsWith('Error') ? (
              <AlertCircle size={18} className="text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            )}
            <span className="font-semibold">{syncResultToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncResultToast(null)}
            className="text-zinc-400 hover:text-white px-2 py-0.5 rounded cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

        {/* ── CALENDARIO INTERACTIVO VISUAL (DÍA A DÍA) ── */}
        <div className="pt-3 border-t border-zinc-800/80">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap bg-zinc-950/60 p-3 rounded-2xl border border-zinc-800/90">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <CalendarIcon size={14} className="text-amber-400" />
                <span>Rango:</span>
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold font-mono">
                {periodLabelFormatted}
              </span>

              {/* Selector de Asesor (Solo Admins) o Badge de Asesor Individual (Asesores) */}
              {isAdmin ? (
                <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700/80 rounded-xl px-2.5 py-1 text-xs">
                  <Users size={13} className="text-amber-400 shrink-0" />
                  <span className="text-zinc-400 font-semibold text-[11px] hidden sm:inline">Vista Asesor:</span>
                  <select
                    value={selectedAdvisorFilter}
                    onChange={(e) => handleAdvisorFilterChange(e.target.value)}
                    className="bg-transparent text-xs text-zinc-100 font-bold focus:outline-none cursor-pointer"
                    title="Filtra el informe para un asesor específico o visualiza todo el equipo consolidado"
                  >
                    <option value="all" className="bg-zinc-900 text-zinc-100">
                      👥 Todo el Equipo (Consolidado Gerencial)
                    </option>
                    {(reportData?.allAdvisorsList || []).map((adv) => (
                      <option key={adv.id} value={adv.id} className="bg-zinc-900 text-zinc-100">
                        👤 {adv.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-xs">
                  <User size={13} className="text-amber-400" />
                  <span>
                    Mi Cartera: <strong>{reportData?.targetAdvisorName || currentUserName || 'Asesor'}</strong>
                  </span>
                  <span className="text-[10px] text-amber-400/90 font-mono bg-amber-500/20 px-1.5 py-0.2 rounded font-bold">
                    Solo tus datos
                  </span>
                </div>
              )}

              {isRangePending && (
                <span className="text-[11px] font-bold text-amber-300 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/40 animate-pulse">
                  ⚡ Fechas modificadas — Haz clic en "Generar Informe"
                </span>
              )}
              {calendarPickStep === 'end' && (
                <span className="text-[11px] font-medium text-sky-300 bg-sky-500/15 px-2.5 py-0.5 rounded-full border border-sky-500/30">
                  Paso 2: Haz clic en el día de fin del reporte
                </span>
              )}
            </div>

            {/* Botón de Generar Informe directo */}
            <button
              type="button"
              onClick={() => handleGenerateReport(true)}
              disabled={loading || analyzingAi}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-black text-xs transition shadow-md cursor-pointer ${
                isRangePending
                  ? 'bg-amber-400 hover:bg-amber-300 text-zinc-950 ring-2 ring-amber-300 animate-bounce'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30'
              }`}
              title="Generar y visualizar el informe completo para este rango"
            >
              {loading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />}
              <span>{loading ? 'Generando...' : '⚡ Generar Informe'}</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">

            {/* Atajos Rápidos */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[11px] text-zinc-500 mr-1">Atajos:</span>
              <button
                type="button"
                onClick={() => applyQuickPreset('this_week')}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-[11px] font-bold border border-amber-500/30 transition cursor-pointer"
                title="Semana comercial activa en curso: desde el viernes 09:00 a. m. hasta el momento actual"
              >
                ⚡ Esta Semana en Curso (Viernes a Hoy)
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('last_fri_fri')}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-semibold transition cursor-pointer"
                title="Semana comercial cerrada anterior: del viernes anterior al corte del viernes a las 09:00 a. m."
              >
                ⚡ Semana Anterior Cerrada (16 - 23 Oct)
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('current_month')}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-semibold transition cursor-pointer"
                title="Mes comercial completo acumulado"
              >
                ⚡ Mes Completo (Octubre)
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('today')}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-semibold transition cursor-pointer"
                title="Gestión comercial de hoy"
              >
                ⚡ Hoy
              </button>
              <button
                type="button"
                onClick={() => setShowCalendarDropdown(!showCalendarDropdown)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  showCalendarDropdown
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
                title="Mostrar/Ocultar calendario interactivo"
              >
                <CalendarIcon size={13} />
                <span>{showCalendarDropdown ? 'Ocultar Calendario' : 'Abrir Calendario'}</span>
                {showCalendarDropdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {showCalendarDropdown && (
            <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 shadow-inner">
              {/* Barra superior de mes con navegación */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-zinc-200 capitalize">
                    {MONTH_NAMES[calendarViewDate.getMonth()]} {calendarViewDate.getFullYear()}
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(calendarViewDate);
                      d.setMonth(d.getMonth() - 1);
                      setCalendarViewDate(d);
                    }}
                    className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
                    title="Mes anterior"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarViewDate(new Date())}
                    className="px-2 py-1 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(calendarViewDate);
                      d.setMonth(d.getMonth() + 1);
                      setCalendarViewDate(d);
                    }}
                    className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
                    title="Mes siguiente"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {/* Grilla de Días de la semana */}
              <div className="grid grid-cols-7 gap-1 text-center mb-1 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>

              {/* Celdas del mes */}
              <div className="grid grid-cols-7 gap-1">
                {calendarGrid.map((item) => {
                  const dayTs = item.date.getTime();
                  const startTs = new Date(selectedRangeStart).setHours(0, 0, 0, 0);
                  const endTs = new Date(selectedRangeEnd).setHours(23, 59, 59, 999);

                  const isSelectedStart =
                    item.date.getFullYear() === selectedRangeStart.getFullYear() &&
                    item.date.getMonth() === selectedRangeStart.getMonth() &&
                    item.date.getDate() === selectedRangeStart.getDate();

                  const isSelectedEnd =
                    item.date.getFullYear() === selectedRangeEnd.getFullYear() &&
                    item.date.getMonth() === selectedRangeEnd.getMonth() &&
                    item.date.getDate() === selectedRangeEnd.getDate();

                  const isInRange = dayTs >= startTs && dayTs <= endTs;

                  const isToday =
                    item.date.getFullYear() === new Date().getFullYear() &&
                    item.date.getMonth() === new Date().getMonth() &&
                    item.date.getDate() === new Date().getDate();

                  // Actividad registrada ese día si ya está en dailyActivities
                  const dailyAct = reportData.dailyActivities?.find((a) => a.dateKey === item.key);
                  const hasActivity = dailyAct && (dailyAct.captacionesCount > 0 || dailyAct.bitacorasCount > 0);

                  let cellClass = 'bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800';
                  if (isSelectedStart || isSelectedEnd) {
                    cellClass = 'bg-amber-500 text-zinc-950 font-black shadow-md scale-[1.03] z-10';
                  } else if (isInRange) {
                    cellClass = 'bg-amber-500/20 text-amber-200 border-y border-amber-500/30 font-semibold';
                  } else if (!item.isCurrentMonth) {
                    cellClass = 'text-zinc-600 hover:bg-zinc-900/30';
                  }

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleDayClick(item.date)}
                      className={`relative h-11 sm:h-12 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${cellClass}`}
                    >
                      <span className="text-xs">{item.date.getDate()}</span>

                      {/* Indicador de actividad o ventas */}
                      <div className="flex items-center gap-1 mt-0.5">
                        {dailyAct && dailyAct.ventasCount > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Venta registrada" />
                        )}
                        {hasActivity && (
                          <span
                            className={`text-[9px] font-mono leading-none ${
                              isSelectedStart || isSelectedEnd ? 'text-zinc-950 font-bold' : 'text-amber-400/90'
                            }`}
                          >
                            {dailyAct.captacionesCount > 0 ? `${dailyAct.captacionesCount}c` : `${dailyAct.bitacorasCount}b`}
                          </span>
                        )}
                      </div>

                      {isToday && (
                        <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-violet-400" title="Hoy" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metadatos: Elaborado por y Dirigido a */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Elaborado por</label>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                placeholder="Nombre y cargo"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Dirigido a</label>
              <input
                type="text"
                value={forRecipient}
                onChange={(e) => setForRecipient(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                placeholder="Gerencia / Dirección"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          VISTA 1: ANÁLISIS Y ACTIVIDAD DÍA A DÍA (DESGLOSE COMPLETO)
         ════════════════════════════════════════════════════════════════════════ */}
      {reportSubTab === 'daily_activity' && (
        <div className="space-y-6">
          {/* BANNER CRONOLÓGICO GENERADO CON IA */}
          <div className="p-5 rounded-3xl bg-gradient-to-br from-violet-950/40 via-zinc-900 to-indigo-950/30 border border-violet-500/30 shadow-lg">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-2xl bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  <Sparkles size={20} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <span>Cronología & Ritmo de Trabajo Día a Día</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600/30 text-violet-300 font-mono font-semibold">
                      Análisis IA de Fichas
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Evaluación cronológica del ritmo de captación, llamadas telefónicas y cierres de venta.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRunAiAnalysis}
                disabled={analyzingAi}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
              >
                <Sparkles size={13} className={analyzingAi ? 'animate-spin' : ''} />
                <span>{analyzingAi ? 'Analizando...' : 'Regenerar con IA'}</span>
              </button>
            </div>

            <p className="mt-3 text-xs sm:text-sm text-zinc-200 leading-relaxed bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80">
              {reportData.cronologiaAi ||
                'Haz clic en "Analizar Fichas con IA" para que el modelo examine el ritmo diario de trabajo y genere la cronología ejecutiva.'}
            </p>
          </div>

          {/* GRÁFICO VISUAL DE BARRAS POR DÍA */}
          <div className="p-5 rounded-3xl bg-zinc-900/70 border border-zinc-800 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-amber-400" />
                  <span>Distribución Diaria de Actividad</span>
                </h4>
                <p className="text-[11px] text-zinc-400">
                  Haz clic en un día del gráfico para ver solo lo que se hizo esa jornada.
                </p>
              </div>

              {selectedDayFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedDayFilter('all')}
                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition"
                >
                  Ver todos los días
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {reportData.dailyActivities?.map((d) => {
                const isSelected = selectedDayFilter === d.dateKey;
                const maxVol = Math.max(
                  ...(reportData.dailyActivities?.map((x) => Math.max(x.captacionesCount, x.bitacorasCount)) || [10])
                );
                const captHeight = Math.min(100, Math.round((d.captacionesCount / (maxVol || 1)) * 100));
                const bitHeight = Math.min(100, Math.round((d.bitacorasCount / (maxVol || 1)) * 100));

                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() => setSelectedDayFilter(isSelected ? 'all' : d.dateKey)}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500 shadow-md ring-1 ring-amber-500/50'
                        : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-zinc-200">{d.shortDate}</p>
                      <p className="text-[10px] text-zinc-500">{d.dayName}</p>
                    </div>

                    {/* Mini barras visuales */}
                    <div className="my-3 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                        <span className="text-amber-400 font-bold">{d.captacionesCount} cap</span>
                        <span className="text-violet-400 font-bold">{d.bitacorasCount} bit</span>
                      </div>
                      <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${captHeight}%` }}
                          className="bg-amber-400 h-full rounded-full transition-all"
                          title={`${d.captacionesCount} captaciones`}
                        />
                      </div>
                      <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${bitHeight}%` }}
                          className="bg-violet-500 h-full rounded-full transition-all"
                          title={`${d.bitacorasCount} bitácoras`}
                        />
                      </div>
                    </div>

                    {d.ventasCount > 0 && (
                      <span className="mt-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold text-center block">
                        🏡 {d.ventasCount} venta{d.ventasCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* CRONOGRAMA DETALLADO DÍA POR DÍA: QUIÉN HIZO QUÉ Y OBSERVACIONES */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
              <Layers size={16} className="text-violet-400" />
              <span>Bitácora & Trabajo Detallado de los Asesores por Día</span>
            </h4>

            {displayedDailyActivities.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 bg-zinc-900 rounded-2xl border border-zinc-800">
                Sin registros de actividad para los días seleccionados.
              </div>
            ) : (
              displayedDailyActivities.map((day) => (
                <div
                  key={day.dateKey}
                  className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-5 space-y-4 shadow-md"
                >
                  {/* Cabecera del día */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/80 gap-2">
                    <div className="flex items-center gap-3">
                      <span className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold font-mono text-sm">
                        {day.shortDate}
                      </span>
                      <div>
                        <h5 className="text-sm font-bold text-zinc-100">
                          {day.dayName}, {day.dateFormatted}
                        </h5>
                        <p className="text-[11px] text-zinc-400">
                          {day.captacionesCount} prospectos captados · {day.bitacorasCount} bitácoras diligenciadas ·{' '}
                          {day.ventasCount} cierres
                        </p>
                      </div>
                    </div>

                    {day.ventasCount > 0 && (
                      <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 w-fit">
                        <span>🏡</span>
                        <span>{day.ventasCount} Venta Confirmada</span>
                      </span>
                    )}
                  </div>

                  {/* Ventas cerradas ese día */}
                  {day.sales.length > 0 && (
                    <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-2xl space-y-1.5">
                      <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                        Ventas concretadas en esta jornada:
                      </p>
                      {day.sales.map((s, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-emerald-200">
                          <span>✔</span>
                          <span>
                            <strong>{s.advisorName}</strong> cerró con el cliente <strong>{s.clientName}</strong> en{' '}
                            <strong>{s.property}</strong>.
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Asesores activos y sus bitácoras de ese día */}
                  {day.advisorsActive.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic py-2">
                      Sin captaciones ni bitácoras registradas en esta fecha.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {day.advisorsActive.map((adv) => (
                        <div
                          key={adv.advisorId}
                          className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-4 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <h6 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                              <UserCheck size={13} className="text-amber-400" />
                              <span>{adv.advisorName}</span>
                            </h6>
                            <div className="flex items-center gap-2 text-[10px] font-mono font-bold">
                              {adv.captaciones > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                  +{adv.captaciones} captaciones
                                </span>
                              )}
                              {adv.bitacoras > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">
                                  {adv.bitacoras} bitácoras
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Tipos de acción */}
                          {adv.actions.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                              {adv.actions.map((act) => (
                                <span
                                  key={act.actionType}
                                  className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300"
                                >
                                  {act.actionType}: {act.count}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Observaciones reales escritas en la Ficha Técnica */}
                          {adv.sampleNotes.length > 0 && (
                            <div className="space-y-1.5 pt-1.5 border-t border-zinc-800/60">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                <MessageSquare size={11} />
                                <span>Observaciones escritas en ficha:</span>
                              </p>
                              {adv.sampleNotes.map((note, idx) => (
                                <p
                                  key={idx}
                                  className="text-[11px] text-zinc-300 italic bg-zinc-900/70 p-2 rounded-xl border border-zinc-800/50 leading-relaxed"
                                >
                                  "{note}"
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          VISTA 3: AUDITORÍA DE MARKETING, PAUTAS Y ASIGNACIÓN A ASESORES
         ════════════════════════════════════════════════════════════════════════ */}
      {reportSubTab === 'marketing_pautas' && reportData && (
        <div className="space-y-6 animate-fade-in">
          {/* HEADER PRINCIPAL */}
          <div className="p-6 rounded-3xl bg-gradient-to-br from-sky-950/40 via-zinc-900 to-indigo-950/40 border border-sky-500/30 shadow-xl">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="p-3 rounded-2xl bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  <Megaphone size={24} />
                </span>
                <div>
                  <h2 className="text-base sm:text-lg font-black text-zinc-100 flex items-center gap-2">
                    <span>Atribución de Marketing & Gestión de Pautas</span>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono font-bold border border-sky-500/30">
                      Días Seleccionados
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Prospectos captados en <strong className="text-zinc-200">{reportData.periodLabel}</strong>: de qué pauta publicitaria provienen, a qué asesores fueron asignados y su estado real de seguimiento.
                  </p>
                </div>
              </div>
            </div>

            {/* 4 CARDS DE KPIS DE MARKETING */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Leads en el Período
                </span>
                <span className="text-2xl sm:text-3xl font-black text-zinc-100 font-mono">
                  {reportData.marketingReport?.totalLeadsPeriodo ?? reportData.kpis.captacionesPeriodo}
                </span>
                <span className="text-[11px] text-zinc-500 block mt-1">
                  100% de captaciones registradas
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-sky-950/30 border border-sky-500/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 block mb-1">
                  Leads de Pauta (Meta Ads)
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-sky-300 font-mono">
                    {reportData.marketingReport?.totalPautaLeads ?? 0}
                  </span>
                  <span className="text-xs font-bold text-sky-400">
                    ({reportData.marketingReport?.porcentajePauta ?? 0}%)
                  </span>
                </div>
                <span className="text-[11px] text-sky-300/70 block mt-1">
                  {reportData.marketingReport?.totalOrganicoLeads ?? 0} orgánicos / campo
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
                  Pauta #1 Mayor Volumen
                </span>
                <span className="text-sm sm:text-base font-black text-zinc-200 line-clamp-1" title={reportData.marketingReport?.topCampaignName}>
                  {reportData.marketingReport?.topCampaignName || 'N/A'}
                </span>
                <span className="text-[11px] text-zinc-500 block mt-1">
                  Mayor canal de captación en los días
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">
                  Cobertura Seguimiento Pauta
                </span>
                <span className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono">
                  {reportData.marketingReport?.coberturaSeguimientoPautaPct ?? 0}%
                </span>
                <span className="text-[11px] text-emerald-300/70 block mt-1">
                  Prospectos con gestión real registrada
                </span>
              </div>
            </div>
          </div>

          {/* BARRA DE FILTROS Y BÚSQUEDA */}
          <div className="flex items-center justify-between gap-3 flex-wrap bg-zinc-900/60 p-3 rounded-2xl border border-zinc-800">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-zinc-400 mr-1 flex items-center gap-1">
                <Filter size={13} />
                <span>Filtrar:</span>
              </span>
              <button
                type="button"
                onClick={() => setMarketingFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  marketingFilter === 'all'
                    ? 'bg-amber-500 text-zinc-950 font-black shadow-sm'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Todas ({reportData.marketingReport?.campaigns.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setMarketingFilter('pauta')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  marketingFilter === 'pauta'
                    ? 'bg-sky-500 text-zinc-950 font-black shadow-sm'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Solo Pautas Meta / Ads ({reportData.marketingReport?.campaigns.filter((c) => c.isPauta).length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setMarketingFilter('organico')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  marketingFilter === 'organico'
                    ? 'bg-emerald-500 text-zinc-950 font-black shadow-sm'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Orgánico / Campo / Otros ({reportData.marketingReport?.campaigns.filter((c) => !c.isPauta).length ?? 0})
              </button>
            </div>

            <div className="relative min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Buscar pauta, campaña o asesor..."
                value={marketingSearch}
                onChange={(e) => setMarketingSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* LISTA / TARJETAS DETALLADAS DE CADA PAUTA */}
          <div className="space-y-4">
            {(() => {
              const campaigns = (reportData.marketingReport?.campaigns || []).filter((c) => {
                if (marketingFilter === 'pauta' && !c.isPauta) return false;
                if (marketingFilter === 'organico' && c.isPauta) return false;
                if (marketingSearch.trim()) {
                  const q = marketingSearch.toLowerCase();
                  const matchCamp = (c.campaignName || '').toLowerCase().includes(q);
                  const matchAdv = (c.advisorsDistribution || []).some((a) =>
                    (a.advisorName || '').toLowerCase().includes(q)
                  );
                  return matchCamp || matchAdv;
                }
                return true;
              });

              if (campaigns.length === 0) {
                return (
                  <div className="p-8 text-center bg-zinc-900/40 rounded-2xl border border-zinc-800 text-zinc-500 text-xs">
                    No se encontraron pautas o campañas con los filtros aplicados.
                  </div>
                );
              }

              return campaigns.map((c) => {
                const isExpanded = expandedCampaignKey === c.campaignKey;
                return (
                  <div
                    key={c.campaignKey}
                    className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 transition shadow-lg"
                  >
                    {/* ENCABEZADO DE LA CAMPAÑA */}
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              c.isPauta
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            }`}
                          >
                            {c.isPauta ? 'Pauta Publicitaria' : 'Canal Orgánico / Directo'}
                          </span>
                          <span className="text-[10px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-md font-mono">
                            Canal: {c.source}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                          <span>{c.campaignName}</span>
                        </h3>
                        {c.subtitle && (
                          <p className="text-xs text-amber-300/90 italic font-medium">
                            "{c.subtitle}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleOpenCampaignModal(c)}
                          className="px-3.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                          title="Ver todos los datos de los prospectos que entraron"
                        >
                          <Search size={13} />
                          <span>Ver datos que entraron ({c.totalLeads})</span>
                        </button>
                        <div className="text-right">
                          <span className="text-xl font-black text-amber-400 font-mono">
                            {c.totalLeads} {c.totalLeads === 1 ? 'lead' : 'leads'}
                          </span>
                          <span className="text-[11px] text-zinc-400 block font-medium">
                            {c.percentageOfPeriod}% del total del período
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* SECCIÓN 1: A QUÉ ASESORES SE LES ASIGNÓ */}
                    <div className="mb-3 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
                      <span className="text-[11px] font-bold text-zinc-400 block mb-2 uppercase tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <User size={12} className="text-amber-400" />
                          <span>
                            Asesores a los que se les asignó ({(c.advisorsDistribution || []).length} asesores):
                          </span>
                        </span>
                        <span className="text-[10px] text-zinc-500 font-normal lowercase">
                          Haz clic en un asesor para ver sus leads
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {(c.advisorsDistribution || []).map((adv) => (
                          <button
                            key={adv.advisorId}
                            type="button"
                            onClick={() => handleOpenCampaignModal(c, adv.advisorName)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-amber-950/40 border border-zinc-700/70 hover:border-amber-500/50 text-xs font-semibold text-zinc-200 transition cursor-pointer"
                            title={`Clic para ver los ${adv.count} prospectos de ${adv.advisorName}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            <span>{adv.advisorName}:</span>
                            <strong className="text-amber-300 font-mono">{adv.count}</strong>
                            <span className="text-[10px] text-zinc-500">({adv.percentage}%)</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* SECCIÓN 2: ESTADO Y SEGUIMIENTO DE LOS LEADS */}
                    <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 size={12} className="text-emerald-400" />
                          <span>Seguimiento y Estado de los Leads:</span>
                        </span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">
                          {c.coberturaPct}% con seguimiento real
                        </span>
                      </div>

                      {/* Barra de progreso de cobertura */}
                      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden flex mb-3">
                        <div
                          className="bg-emerald-500 transition-all duration-500"
                          style={{ width: `${c.coberturaPct}%` }}
                          title={`${c.conSeguimientoCount} con seguimiento`}
                        />
                        <div
                          className="bg-rose-500/70 transition-all duration-500"
                          style={{ width: `${100 - c.coberturaPct}%` }}
                          title={`${c.sinGestionCount} sin gestión`}
                        />
                      </div>

                      {/* Badges de estado */}
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-medium">
                          🟢 Con gestión: <strong>{c.conSeguimientoCount}</strong>
                        </span>
                        {c.sinGestionCount > 0 && (
                          <span className="px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 font-medium">
                            🔴 Sin gestión aún: <strong>{c.sinGestionCount}</strong>
                          </span>
                        )}
                        {c.noContestaCount > 0 && (
                          <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-300 font-medium">
                            📞 No contesta / Buzón: <strong>{c.noContestaCount}</strong>
                          </span>
                        )}
                        {c.estadosCount.calificadoOVisita > 0 && (
                          <span className="px-2.5 py-1 rounded-lg bg-violet-950/40 border border-violet-500/40 text-violet-300 font-medium">
                            ⭐ Calificado / Visita: <strong>{c.estadosCount.calificadoOVisita}</strong>
                          </span>
                        )}
                        {c.ventasCount > 0 && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
                            🏆 Ventas: <strong>{c.ventasCount}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* BOTÓN DESPLEGABLE PARA VER LISTA DE LEADS */}
                    {c.sampleLeads && c.sampleLeads.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setExpandedCampaignKey(isExpanded ? null : c.campaignKey)}
                          className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          <span>
                            {isExpanded
                              ? 'Ocultar prospectos'
                              : `Ver prospectos de esta pauta en los días seleccionados (${c.sampleLeads.length} leads)`}
                          </span>
                        </button>
                      </div>
                    )}

                    {/* TABLA DESPLEGADA DE PROSPECTOS */}
                    {isExpanded && c.sampleLeads && (
                      <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
                        <table className="w-full text-[11px] text-left">
                          <thead className="bg-zinc-900 text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
                            <tr>
                              <th className="px-3 py-2">Cliente</th>
                              <th className="px-3 py-2">Teléfono</th>
                              <th className="px-3 py-2">Asesor Asignado</th>
                              <th className="px-3 py-2">Estado</th>
                              <th className="px-3 py-2">Gestión / Seguimiento</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-900 text-zinc-300">
                            {c.sampleLeads.map((sl) => (
                              <tr key={sl.leadId} className="hover:bg-zinc-900/50">
                                <td className="px-3 py-2 font-medium text-zinc-100">{sl.clientName}</td>
                                <td className="px-3 py-2 font-mono text-zinc-400">{sl.phone}</td>
                                <td className="px-3 py-2 text-amber-300 font-medium">{sl.advisorName}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-300">
                                    {sl.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  {sl.hasFollowUp ? (
                                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                                      <CheckCircle2 size={11} />
                                      <span className="line-clamp-1">{sl.lastFollowUpSummary || 'Seguimiento registrado'}</span>
                                    </span>
                                  ) : (
                                    <span className="text-rose-400 font-medium">Sin seguimiento aún</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          VISTA 2: INFORME OFICIAL MERAKI (A4 PIXEL-PERFECT PARA IMPRIMIR)
         ════════════════════════════════════════════════════════════════════════ */}
      {reportSubTab === 'official_doc' && (
        <div className="flex justify-center">
          <div
            id="official-meraki-report-document"
            className={`w-full max-w-[920px] transition-all ${
              previewMode === 'official'
                ? 'bg-white text-zinc-900 shadow-2xl rounded-2xl p-8 sm:p-12 print:p-0 print:shadow-none print:rounded-none'
                : 'bg-zinc-950 text-zinc-100 border border-zinc-800 rounded-3xl p-8 shadow-2xl'
            }`}
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            }}
          >
            {/* PÁGINA 1 */}
            <div className="official-page min-h-[1050px] flex flex-col justify-between">
              <div>
                {/* ENCABEZADO MERAKI */}
                <div className="flex items-start justify-between border-b-2 border-amber-500/80 pb-4 mb-5">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-black tracking-tight text-zinc-950">
                      {reportData.title}
                    </h1>
                    <p className="text-xs font-semibold text-zinc-700 mt-1">
                      {reportData.periodType === 'monthly' ? 'Mes / Período:' : 'Semana / Período:'}{' '}
                      <span className="font-bold text-zinc-950">{reportData.periodLabel}</span>
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-zinc-600 mt-1 flex-wrap font-medium">
                      <span>
                        Para: <strong className="text-zinc-900">{reportData.forRecipient}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Elaborado por: <strong className="text-zinc-900">{reportData.preparedBy}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Fecha: <strong className="text-zinc-900">{reportData.reportDateStr}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end pl-4">
                    <img
                      src="/meraki-logo.png"
                      alt="Meraki Grupo Constructor"
                      className="h-10 sm:h-12 w-auto object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <span className="text-[13px] font-black tracking-wider text-amber-700 font-serif uppercase">
                      MERAKI
                    </span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase">
                      GRUPO CONSTRUCTOR
                    </span>
                    <span className="text-[10px] italic font-serif text-amber-600">Creamos con pasión</span>
                  </div>
                </div>

                {/* SECCIÓN 1: RESUMEN DEL PERÍODO */}
                <div className="mb-6">
                  <h2 className="text-sm font-black text-zinc-950 uppercase tracking-wide flex items-center gap-2 mb-2">
                    <span>1. {reportData.periodType === 'monthly' ? 'Resumen del mes' : 'Resumen de la semana'}</span>
                  </h2>

                  {/* 4 TARJETAS KPI EN ESTILO OFICIAL MERAKI */}
                  <div className="grid grid-cols-4 gap-2.5 sm:gap-4 mb-4">
                    <div
                      onClick={() =>
                        handleOpenAdvisorDrilldown({
                          advisorId: 'all',
                          scope: reportData.periodType === 'monthly' ? 'month' : 'period',
                          filter: 'all',
                        })
                      }
                      className="bg-zinc-950 text-white rounded-xl p-3 sm:p-4 text-center border border-zinc-800 shadow-sm hover:border-amber-500/50 hover:bg-zinc-900/80 transition cursor-pointer group"
                      title="Haz clic para ver todos los prospectos y números"
                    >
                      <p className="text-2xl sm:text-3xl font-black text-amber-400 font-mono group-hover:scale-105 transition-transform">
                        {reportData.kpis.captacionesPeriodo}
                      </p>
                      <p className="text-[10px] sm:text-[11px] font-medium text-zinc-300 mt-0.5 leading-tight flex items-center justify-center gap-1">
                        <span>{reportData.periodType === 'monthly' ? 'Captaciones del mes' : 'Captaciones de la semana'}</span>
                        <ExternalLink size={9} className="opacity-0 group-hover:opacity-70 text-amber-400 transition" />
                      </p>
                    </div>

                    <div className="bg-zinc-950 text-white rounded-xl p-3 sm:p-4 text-center border border-zinc-800 shadow-sm">
                      <p className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
                        {reportData.kpis.ventasPeriodo}
                      </p>
                      <p className="text-[10px] sm:text-[11px] font-medium text-zinc-300 mt-0.5 leading-tight">
                        {reportData.periodType === 'monthly'
                          ? `Ventas del mes (${reportData.monthLabel})`
                          : `Ventas semana (${reportData.kpis.ventasMes} en el mes)`}
                      </p>
                    </div>

                    <div
                      onClick={() =>
                        handleOpenAdvisorDrilldown({
                          advisorId: 'all',
                          category: 'managed_total',
                          filter: 'all',
                        })
                      }
                      className="bg-zinc-950 text-white rounded-xl p-3 sm:p-4 text-center border border-zinc-800 shadow-sm hover:border-emerald-500/50 hover:bg-zinc-900/80 transition cursor-pointer group"
                      title="Haz clic para ver clientes con seguimiento"
                    >
                      <p className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono group-hover:scale-105 transition-transform">
                        {reportData.kpis.clientesConSeguimiento}
                      </p>
                      <p className="text-[10px] sm:text-[11px] font-medium text-zinc-300 mt-0.5 leading-tight flex items-center justify-center gap-1">
                        <span>Clientes con seguimiento real</span>
                        <ExternalLink size={9} className="opacity-0 group-hover:opacity-70 text-emerald-400 transition" />
                      </p>
                    </div>

                    <div
                      onClick={() =>
                        handleOpenAdvisorDrilldown({
                          advisorId: 'all',
                          scope: reportData.periodType === 'monthly' ? 'month' : 'period',
                          filter: 'sin_seguimiento',
                        })
                      }
                      className="bg-zinc-950 text-white rounded-xl p-3 sm:p-4 text-center border border-zinc-800 shadow-sm hover:border-amber-500/50 hover:bg-zinc-900/80 transition cursor-pointer group"
                      title="Haz clic para ver prospectos pendientes de seguimiento"
                    >
                      <p className="text-2xl sm:text-3xl font-black text-amber-400 font-mono group-hover:scale-105 transition-transform">
                        {reportData.kpis.coberturaPeriodoPct}%
                      </p>
                      <p className="text-[10px] sm:text-[11px] font-medium text-zinc-300 mt-0.5 leading-tight flex items-center justify-center gap-1">
                        <span>{reportData.periodType === 'monthly' ? 'Cobertura de leads del mes' : 'Leads semana con seguimiento'}</span>
                        <ExternalLink size={9} className="opacity-0 group-hover:opacity-70 text-amber-400 transition" />
                      </p>
                    </div>
                  </div>

                  {/* PÁRRAFOS ANALÍTICOS DE SÍNTESIS */}
                  <div className="space-y-1.5 text-[11px] sm:text-xs text-zinc-800 leading-relaxed bg-zinc-50 border border-zinc-200 rounded-xl p-3.5">
                    <p className="flex items-start gap-2">
                      <span className="text-amber-600 font-black text-sm leading-none">▪</span>
                      <span>
                        <strong>Referencia:</strong> {reportData.summaryBullets.referencia}
                      </span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="text-amber-600 font-black text-sm leading-none">▪</span>
                      <span>
                        <strong>Captación:</strong> {reportData.summaryBullets.captacion}
                      </span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="text-amber-600 font-black text-sm leading-none">▪</span>
                      <span>
                        <strong>Ventas:</strong> {reportData.summaryBullets.ventas}
                      </span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="text-amber-600 font-black text-sm leading-none">▪</span>
                      <span>
                        <strong>Seguimiento:</strong> {reportData.summaryBullets.seguimiento}
                      </span>
                    </p>
                  </div>
                </div>

                {/* SECCIÓN 2: AVANCE POR ASESOR (TABLA INTERACTIVA CON SEMÁFOROS) */}
                <div className="mb-6">
                  <h2 className="text-sm font-black text-zinc-950 uppercase tracking-wide flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span>
                        {reportData.isIndividualReport || !isAdmin
                          ? `2. Avance de gestión — ${reportData.targetAdvisorName || currentUserName || 'Asesor'}`
                          : '2. Avance por asesor'}
                      </span>
                      <span className="no-print text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full border border-amber-300 flex items-center gap-1">
                        <MousePointerClick size={10} />
                        <span>Clic en cifras para ver prospectos</span>
                      </span>
                    </span>
                    <span className="text-[10px] font-normal lowercase text-zinc-500">
                      {reportData.isIndividualReport || !isAdmin ? 'Ficha individual' : 'Ordenado por captación en el período'}
                    </span>
                  </h2>

                  {/* NOTA INTERACTIVA VISIBLE EN PANTALLA (OCULTA EN IMPRESIÓN) */}
                  <div className="flex items-center justify-between text-[11px] text-amber-950 bg-amber-50/90 border border-amber-300 rounded-lg px-3 py-1.5 mb-2 no-print shadow-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <MousePointerClick size={13} className="text-amber-600 shrink-0" />
                      <span><strong>Tabla interactiva:</strong> Haz clic en cualquier número de <strong>Captaciones</strong> (semana o mes) o <strong>Seguimiento</strong> para abrir el detalle con nombres, números de WhatsApp y ver cuáles tienen seguimiento y cuáles faltan.</span>
                    </span>
                    <span className="text-[10px] text-amber-800 font-bold shrink-0 hidden sm:inline bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                      👆 Clic en las cifras
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-zinc-300 shadow-sm">
                    <table className="w-full text-[11px] border-collapse text-center">
                      <thead>
                        <tr className="bg-zinc-950 text-white font-bold text-[10px] sm:text-[11px]">
                          <th className="py-2 px-2.5 text-left">Asesor</th>
                          <th className="py-2 px-1.5">{reportData.periodType === 'monthly' ? 'Capt. mes' : 'Capt. semana'}</th>
                          <th className="py-2 px-1.5">Capt. acum. {reportData.monthLabel.split(' ')[0]}</th>
                          <th className="py-2 px-1.5">Avance mes (esp. {reportData.totals.expectedMonthPct ?? 46}%)</th>
                          <th className="py-2 px-1.5">{reportData.periodType === 'monthly' ? 'Ventas período' : 'Ventas semana'}</th>
                          <th className="py-2 px-1.5">Ventas mes (meta 3)</th>
                          <th className="py-2 px-1.5">Clientes con seguim.</th>
                          <th className="py-2 px-1.5">{reportData.periodType === 'monthly' ? 'Leads mes con seguim.' : 'Leads sem. con seguim.'}</th>
                          <th className="py-2 px-1.5">Clientes anteriores</th>
                          <th className="py-2 px-2">{reportData.periodType === 'monthly' ? 'Cobertura leads mes' : 'Cobertura leads sem.'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {reportData.advisorRows.map((row) => {
                          const isMonthly = reportData.periodType === 'monthly';
                          const expectedPct = reportData.totals.expectedMonthPct ?? 90;

                          const captColorClass = isMonthly
                            ? row.captSemana >= 100 || row.captSemana >= expectedPct
                              ? 'bg-emerald-100 text-emerald-900 font-bold'
                              : row.captSemana >= 50
                              ? 'bg-amber-100 text-amber-900 font-medium'
                              : 'bg-rose-100 text-rose-900 font-medium'
                            : row.captSemana >= 25
                            ? 'bg-emerald-100 text-emerald-900 font-bold'
                            : row.captSemana >= 15
                            ? 'bg-amber-100 text-amber-900 font-medium'
                            : 'bg-rose-100 text-rose-900 font-medium';

                          const cobColorClass =
                            row.coberturaPct >= 70
                              ? 'bg-emerald-100 text-emerald-900 font-bold'
                              : row.coberturaPct >= 40
                              ? 'bg-amber-100 text-amber-900 font-medium'
                              : 'bg-rose-100 text-rose-900 font-medium';

                          const avanceColorClass =
                            row.avanceMesPct >= expectedPct
                              ? 'bg-emerald-100 text-emerald-900 font-bold'
                              : row.avanceMesPct >= 50
                              ? 'bg-amber-100 text-amber-900 font-medium'
                              : 'bg-rose-100 text-rose-900 font-medium';

                          const ventasMesBadge =
                            row.ventasMes >= 3
                              ? 'bg-emerald-100 text-emerald-900 font-black px-1.5 py-0.5 rounded'
                              : row.ventasMes > 0
                              ? 'bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded'
                              : 'text-zinc-400 font-normal';

                          return (
                            <tr key={row.advisorId} className="hover:bg-zinc-50 transition-colors">
                              {/* ASESOR */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    scope: isMonthly ? 'month' : 'period',
                                    filter: 'all',
                                  })
                                }
                                className="py-1.5 px-2.5 text-left font-semibold text-zinc-900 whitespace-nowrap cursor-pointer hover:text-amber-700 hover:underline transition-colors group"
                                title={`Ver prospectos y números de ${row.advisorName}`}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <span>{row.advisorName}</span>
                                  <ExternalLink size={10} className="opacity-0 group-hover:opacity-70 text-amber-600 transition no-print" />
                                </span>
                              </td>

                              {/* CAPTACIONES SEMANA / PERÍODO */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    scope: 'period',
                                    filter: 'all',
                                  })
                                }
                                className={`py-1.5 px-1.5 ${captColorClass} cursor-pointer hover:opacity-80 active:scale-95 transition-all font-mono`}
                                title={`Ver los ${row.captSemana} prospectos captados en la semana por ${row.advisorName}`}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.captSemana}
                                </span>
                              </td>

                              {/* CAPTACIONES MES */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    scope: 'month',
                                    filter: 'all',
                                  })
                                }
                                className="py-1.5 px-1.5 font-medium text-zinc-800 cursor-pointer hover:bg-zinc-100 hover:text-amber-700 active:scale-95 transition-all font-mono"
                                title={`Ver los ${row.captMes} prospectos captados en el mes por ${row.advisorName}`}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.captMes}
                                </span>
                              </td>

                              {/* AVANCE MES */}
                              <td className={`py-1.5 px-1.5 ${avanceColorClass}`}>{row.avanceMesPct}%</td>

                              {/* VENTAS SEMANA */}
                              <td className="py-1.5 px-1.5 font-bold text-zinc-900">
                                {row.ventasSemana >= (isMonthly ? 3 : 1) ? (
                                  <span className="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-black">
                                    {row.ventasSemana}
                                  </span>
                                ) : row.ventasSemana > 0 ? (
                                  <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded font-bold">
                                    {row.ventasSemana}
                                  </span>
                                ) : (
                                  <span className="text-zinc-400 font-normal">0</span>
                                )}
                              </td>

                              {/* VENTAS MES */}
                              <td className="py-1.5 px-1.5 font-medium text-zinc-800">
                                <span className={ventasMesBadge}>{row.ventasMes}</span>
                              </td>

                              {/* CLIENTES CON SEGUIMIENTO */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    category: 'managed_total',
                                    filter: 'all',
                                  })
                                }
                                className="py-1.5 px-1.5 font-semibold text-zinc-900 cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 transition-all font-mono"
                                title={`Ver los ${row.clientesConSeguimiento} clientes gestionados con seguimiento de ${row.advisorName}`}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.clientesConSeguimiento}
                                </span>
                              </td>

                              {/* LEADS SEM. CON SEGUIMIENTO */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    category: 'leads_sem_con_seguim',
                                    filter: 'all',
                                  })
                                }
                                className="py-1.5 px-1.5 font-medium text-zinc-700 cursor-pointer hover:bg-emerald-50 hover:text-emerald-800 active:scale-95 transition-all font-mono"
                                title={`Ver los ${row.leadsSemConSeguimiento} prospectos de la semana con seguimiento de ${row.advisorName}`}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.leadsSemConSeguimiento}
                                </span>
                              </td>

                              {/* CLIENTES ANTERIORES */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    category: 'clientes_anteriores',
                                    filter: 'all',
                                  })
                                }
                                className="py-1.5 px-1.5 font-medium text-zinc-700 cursor-pointer hover:bg-blue-50 hover:text-blue-800 active:scale-95 transition-all font-mono"
                                title={`Ver los ${row.clientesAnteriores} clientes de base anterior gestionados por ${row.advisorName}`}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.clientesAnteriores}
                                </span>
                              </td>

                              {/* COBERTURA LEADS SEM. */}
                              <td
                                onClick={() =>
                                  handleOpenAdvisorDrilldown({
                                    advisorId: row.advisorId,
                                    category: 'period_leads',
                                    scope: 'period',
                                    filter: row.coberturaPct < 100 ? 'sin_seguimiento' : 'all',
                                  })
                                }
                                className={`py-1.5 px-2 ${cobColorClass} cursor-pointer hover:opacity-80 active:scale-95 transition-all font-mono`}
                                title={
                                  row.coberturaPct < 100
                                    ? `Clic para ver los ${row.captSemana - row.leadsSemConSeguimiento} prospectos que faltan por seguimiento`
                                    : `Cobertura de ${row.advisorName} (${row.coberturaPct}%)`
                                }
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.coberturaPct}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}

                        {/* FILA DE TOTALES (Solo en informe consolidado de todos los asesores) */}
                        {!reportData.isIndividualReport && (
                          <tr className="bg-zinc-900 text-white font-black text-[11px] border-t-2 border-zinc-950">
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  scope: reportData.periodType === 'monthly' ? 'month' : 'period',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-2.5 text-left cursor-pointer hover:text-amber-300 transition-colors"
                              title="Ver todos los prospectos del equipo comercial"
                            >
                              <span className="underline decoration-dotted underline-offset-2">TOTAL</span>
                            </td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  scope: 'period',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-1.5 font-mono text-amber-300 cursor-pointer hover:bg-zinc-800 transition-colors"
                              title={`Ver los ${reportData.totals.captSemana} prospectos captados en la semana por todos los asesores`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.captSemana}
                              </span>
                            </td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  scope: 'month',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-1.5 font-mono cursor-pointer hover:bg-zinc-800 hover:text-amber-300 transition-colors"
                              title={`Ver los ${reportData.totals.captMes} prospectos captados en el mes por todos los asesores`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.captMes}
                              </span>
                            </td>
                            <td className="py-2 px-1.5 font-mono">{reportData.totals.avanceMesPct}%</td>
                            <td className="py-2 px-1.5 font-mono text-emerald-300">{reportData.totals.ventasSemana}</td>
                            <td className="py-2 px-1.5 font-mono">{reportData.totals.ventasMes}</td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  category: 'managed_total',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-1.5 font-mono cursor-pointer hover:bg-zinc-800 hover:text-emerald-300 transition-colors"
                              title={`Ver todos los ${reportData.totals.clientesConSeguimiento} clientes gestionados con seguimiento`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.clientesConSeguimiento}
                              </span>
                            </td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  category: 'leads_sem_con_seguim',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-1.5 font-mono cursor-pointer hover:bg-zinc-800 hover:text-emerald-300 transition-colors"
                              title={`Ver los ${reportData.totals.leadsSemConSeguimiento} prospectos de la semana con seguimiento`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.leadsSemConSeguimiento}
                              </span>
                            </td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  category: 'clientes_anteriores',
                                  filter: 'all',
                                })
                              }
                              className="py-2 px-1.5 font-mono cursor-pointer hover:bg-zinc-800 hover:text-blue-300 transition-colors"
                              title={`Ver los ${reportData.totals.clientesAnteriores} clientes de base anterior gestionados`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.clientesAnteriores}
                              </span>
                            </td>
                            <td
                              onClick={() =>
                                handleOpenAdvisorDrilldown({
                                  advisorId: 'all',
                                  category: 'period_leads',
                                  scope: 'period',
                                  filter: 'sin_seguimiento',
                                })
                              }
                              className="py-2 px-2 font-mono text-amber-300 cursor-pointer hover:bg-zinc-800 transition-colors"
                              title={`Ver los ${reportData.totals.captSemana - reportData.totals.leadsSemConSeguimiento} prospectos de la semana que faltan por seguimiento`}
                            >
                              <span className="underline decoration-dotted underline-offset-2">
                                {reportData.totals.coberturaPct}%
                              </span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[10px] text-zinc-600 mt-1.5 italic">
                    <strong>Simbología:</strong> <strong>Verde</strong> = meta cumplida / en ritmo · <strong>Amarillo</strong> = en proceso / atrasado ·{' '}
                    <strong>Rojo</strong> = crítico. {reportData.periodType === 'monthly' ? `Metas oficiales: 100 captaciones/mes (esp. ${reportData.totals.expectedMonthPct ?? 90}% a la fecha) y 3 ventas/mes por asesor. Cobertura = % de leads del mes con al menos una gestión comercial real.` : 'Metas oficiales: 25 captaciones/semana y 3 ventas/mes por asesor. Cobertura = % de leads de la semana con al menos una gestión comercial real.'}
                  </p>
                </div>
              </div>

              {/* PIE DE PÁGINA 1 */}
              <div className="pt-4 mt-auto border-t border-zinc-200">
                <p className="text-center text-sm font-serif italic font-bold text-zinc-800 mb-2">
                  "Nunca nos cansaremos de mejorar para ti."
                </p>
                <div className="flex items-center justify-between text-[9px] text-zinc-500">
                  <span>Carrera 3 # 42 - 92 Barrio Casa Club</span>
                  <span>servicioalcliente.grupomeraki@gmail.com</span>
                  <span>314 786 80 69</span>
                  <span>www.grupoconstructormeraki.com.co</span>
                  <span className="official-page-number font-bold text-zinc-700">Pág. 1 de 2</span>
                </div>
              </div>
            </div>

            {/* SALTO DE PÁGINA PARA IMPRESIÓN OFICIAL */}
            <div className="page-break my-8 border-b-2 border-dashed border-zinc-300 print:hidden" />

            {/* PÁGINA 2 */}
            <div className="official-page min-h-[1050px] flex flex-col justify-between print:pt-4">
              <div>
                {/* ENCABEZADO CORTO PÁGINA 2 */}
                <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-4">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                    Informe de Gestión Comercial — Asesores (Continuación)
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-700">{reportData.periodLabel}</span>
                </div>

                {/* SECCIÓN 3: ATRIBUCIÓN DE MARKETING Y ASIGNACIÓN DE PAUTAS */}
                {reportData.marketingReport && reportData.marketingReport.campaigns.length > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-black text-zinc-950 uppercase tracking-wide flex items-center gap-2">
                          <span>3. Atribución de Marketing y Pautas (Período)</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-950 font-mono font-bold">
                            {reportData.marketingReport.totalPautaLeads} leads de pauta ({reportData.marketingReport.porcentajePauta}%)
                          </span>
                        </h2>
                        <span className="no-print text-[10px] text-sky-700 font-bold bg-sky-50 border border-sky-200 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                          👆 Haz clic en cualquier pauta o asesor para ver los datos
                        </span>
                      </div>
                      <span className="text-[10px] font-normal lowercase text-zinc-500">
                        {reportData.marketingReport.totalLeadsPeriodo} captaciones en el período
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-zinc-300 shadow-sm mb-2">
                      <table className="w-full text-[10px] sm:text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-zinc-950 text-white font-bold text-[9px] sm:text-[10px]">
                            <th className="py-2 px-3 text-left">Pauta / Campaña</th>
                            <th className="py-2 px-2 text-left">Canal</th>
                            <th className="py-2 px-2 text-center">Leads</th>
                            <th className="py-2 px-2 text-center">% Part.</th>
                            <th className="py-2 px-3 text-left">Asesores Asignados <span className="no-print">(Clic para filtrar)</span></th>
                            <th className="py-2 px-2 text-center">Con Seg.</th>
                            <th className="py-2 px-2 text-center">Sin Gest.</th>
                            <th className="py-2 px-2 text-center">Cobert.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {reportData.marketingReport.campaigns.slice(0, 10).map((c) => (
                            <tr
                              key={c.campaignKey}
                              onClick={() => handleOpenCampaignModal(c)}
                              className="hover:bg-sky-50/70 transition cursor-pointer group"
                              title="Haz clic para ver todos los datos de los prospectos de esta pauta"
                            >
                              <td className="py-2 px-3">
                                <div className="space-y-0.5">
                                  <span className="font-bold text-zinc-950 group-hover:text-sky-800 transition block">
                                    {c.campaignName}
                                  </span>
                                  {c.subtitle && (
                                    <span className="text-[9px] text-zinc-500 line-clamp-1 italic font-normal">
                                      {c.subtitle}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    c.isPauta ? 'bg-sky-100 text-sky-900 border border-sky-300' : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                                  }`}
                                >
                                  {c.canalBadge || c.source}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-center font-mono font-bold text-zinc-950 text-xs">
                                {c.totalLeads}
                              </td>
                              <td className="py-2 px-2 text-center font-mono text-zinc-600">
                                {c.percentageOfPeriod}%
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex flex-wrap gap-1">
                                  {(c.advisorsDistribution || []).map((a) => (
                                    <button
                                      key={a.advisorId}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenCampaignModal(c, a.advisorName);
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 hover:bg-amber-100 border border-zinc-250 hover:border-amber-400 text-zinc-900 transition text-[9px] sm:text-[10px] font-medium cursor-pointer"
                                      title={`Ver los ${a.count} prospectos de ${a.advisorName}`}
                                    >
                                      <span className="font-semibold text-zinc-800">{a.advisorName}:</span>
                                      <strong className="text-amber-800 font-mono">{a.count}</strong>
                                    </button>
                                  ))}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-center font-mono font-bold text-emerald-700">
                                {c.conSeguimientoCount}
                              </td>
                              <td className="py-2 px-2 text-center font-mono font-bold text-rose-700">
                                {c.sinGestionCount}
                              </td>
                              <td className="py-2 px-2 text-center font-mono font-bold text-zinc-950">
                                {c.coberturaPct}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[10px] text-zinc-600 flex items-start gap-1.5">
                      <span className="text-amber-600 font-bold">▪</span>
                      <span>
                        En los días seleccionados entraron <strong>{reportData.marketingReport.totalLeadsPeriodo} leads</strong>, de los cuales <strong>{reportData.marketingReport.totalPautaLeads} ({reportData.marketingReport.porcentajePauta}%)</strong> provinieron de pautas de Meta Ads. La pauta con mayor captación fue <em>"{reportData.marketingReport.topCampaignName}"</em> con una cobertura de gestión del {reportData.marketingReport.coberturaSeguimientoPautaPct}%.
                      </span>
                    </p>
                  </div>
                )}

                {/* SECCIÓN 4: VENTAS (SEMANA Y ACUMULADO DEL MES) */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h2 className="text-sm font-black text-zinc-950 uppercase tracking-wide flex items-center gap-2">
                      <span>4. {salesTableTab === 'week' ? 'Ventas de la semana' : `Ventas del mes (${reportData.monthLabel})`}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 font-mono font-bold">
                        {salesTableTab === 'week' ? reportData.salesList.length : (reportData.monthSalesList?.length ?? reportData.kpis.ventasMes)} ventas
                      </span>
                    </h2>

                    {/* Alternador semana vs mes completo */}
                    <div className="no-print flex items-center bg-zinc-100 border border-zinc-300 rounded-lg p-0.5 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setSalesTableTab('week')}
                        className={`px-2.5 py-1 rounded cursor-pointer transition ${
                          salesTableTab === 'week'
                            ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                        title="Ver ventas cerradas en la semana"
                      >
                        Semana ({reportData.salesList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSalesTableTab('month')}
                        className={`px-2.5 py-1 rounded cursor-pointer transition ${
                          salesTableTab === 'month'
                            ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                        title="Ver todas las ventas acumuladas del mes"
                      >
                        Mes Completo ({reportData.monthSalesList?.length ?? reportData.kpis.ventasMes})
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-zinc-300 shadow-sm mb-2">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-zinc-950 text-white font-bold text-[10px] sm:text-[11px]">
                          <th className="py-1.5 px-3 text-left w-24">Fecha</th>
                          <th className="py-1.5 px-3 text-left">Asesor</th>
                          <th className="py-1.5 px-3 text-left">Cliente</th>
                          <th className="py-1.5 px-3 text-left">Inmueble / Lote</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {((salesTableTab === 'week' ? reportData.salesList : (reportData.monthSalesList && reportData.monthSalesList.length > 0 ? reportData.monthSalesList : reportData.salesList)).length === 0) ? (
                          <tr>
                            <td colSpan={4} className="py-3 px-3 text-center text-xs text-zinc-500 italic">
                              Sin ventas registradas en el período seleccionado.
                            </td>
                          </tr>
                        ) : (
                          (salesTableTab === 'week' ? reportData.salesList : (reportData.monthSalesList && reportData.monthSalesList.length > 0 ? reportData.monthSalesList : reportData.salesList)).map((s, idx) => (
                            <tr key={s.id || idx} className="hover:bg-zinc-50">
                              <td className="py-1.5 px-3 text-zinc-700 font-mono">{s.date}</td>
                              <td className="py-1.5 px-3 font-semibold text-zinc-900">{s.advisorName}</td>
                              <td className="py-1.5 px-3 text-zinc-800">{s.clientName}</td>
                              <td className="py-1.5 px-3 font-medium text-amber-700">{s.property}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-zinc-700 flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">▪</span>
                    <span>
                      {reportData.salesAccumulatedSummary}
                    </span>
                  </p>
                </div>

                {/* SECCIÓN 5: PUNTOS DE ATENCIÓN (ANÁLISIS DE FICHAS Y OBSERVACIONES CON IA) */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-black text-zinc-950 uppercase tracking-wide flex items-center gap-2">
                      <span>5. Puntos de atención</span>
                    </h2>
                    <span className="no-print text-[10px] text-violet-700 font-semibold bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Sparkles size={11} />
                      <span>Generado con IA basada en Fichas Técnicas</span>
                    </span>
                  </div>

                  <div className="space-y-2 text-[11px] sm:text-xs text-zinc-800 leading-relaxed bg-zinc-50 border border-zinc-200 rounded-xl p-3.5">
                    {reportData.attentionPoints.map((item, idx) => (
                      <div key={idx} className="group relative flex items-start gap-2">
                        <span className="text-amber-600 font-black text-sm leading-none mt-0.5">▪</span>
                        <div className="flex-1">
                          {editingPointIdx === idx ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full bg-white border border-amber-500 rounded px-2 py-1 text-xs text-zinc-900"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => saveEditPoint(idx)}
                                className="no-print px-2 py-1 bg-amber-500 text-zinc-950 rounded text-xs font-bold"
                              >
                                Guardar
                              </button>
                            </div>
                          ) : (
                            <p>
                              <strong className="text-zinc-950">{item.advisorName}:</strong> {item.text}
                              <button
                                type="button"
                                onClick={() => startEditPoint(idx, item.text)}
                                className="no-print ml-2 text-zinc-400 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition inline-flex items-center text-[10px]"
                                title="Editar observación"
                              >
                                <Edit3 size={11} />
                              </button>
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SECCIÓN 5: CRITERIOS USADOS (REGLAS DE NEGOCIO Y METODOLOGÍA) */}
                <div className="mb-6">
                  <div className="bg-zinc-100 border border-zinc-300 rounded-xl p-3 text-[10px] text-zinc-700 leading-relaxed">
                    <p className="font-bold text-zinc-900 mb-1 uppercase tracking-wider text-[10px]">
                      Criterios usados
                    </p>
                    <p>{reportData.criteriosText}</p>
                  </div>
                </div>

                {/* SECCIÓN 6: RECOMENDACIONES ESTRATÉGICAS */}
                <div className="mb-4">
                  <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wide mb-1.5">
                    Conclusiones & Acciones Recomendadas
                  </h3>
                  <ul className="space-y-1 text-[11px] text-zinc-800">
                    {reportData.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">✔</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* PIE DE PÁGINA 2 */}
              <div className="pt-4 mt-auto border-t border-zinc-200">
                <p className="text-center text-sm font-serif italic font-bold text-zinc-800 mb-2">
                  "Nunca nos cansaremos de mejorar para ti."
                </p>
                <div className="flex items-center justify-between text-[9px] text-zinc-500">
                  <span>Carrera 3 # 42 - 92 Barrio Casa Club</span>
                  <span>servicioalcliente.grupomeraki@gmail.com</span>
                  <span>314 786 80 69</span>
                  <span>www.grupoconstructormeraki.com.co</span>
                  <span className="official-page-number font-bold text-zinc-700">Pág. 2 de 2</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ESTILOS DE IMPRESIÓN OFICIAL PARA NAVEGADOR / PDF */}
      <style>{OFFICIAL_REPORT_PRINT_CSS}</style>

      {/* MODAL EJECUTIVO: DETALLE DE PROSPECTOS QUE ENTRARON POR PAUTA */}
      {selectedCampaignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-fade-in print:hidden"
          onClick={() => setSelectedCampaignModal(null)}
        >
          <div
            className="bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-zinc-100 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ENCABEZADO */}
            <div className="p-5 border-b border-zinc-800 bg-zinc-900/95 flex items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1.5">
                    <Megaphone size={12} className="text-sky-400" />
                    <span>
                      {selectedCampaignModal.canalBadge ||
                        (selectedCampaignModal.isPauta ? 'Meta Ads' : 'Orgánico')}
                    </span>
                  </span>
                  <span className="text-[10px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-md font-mono">
                    Canal: {selectedCampaignModal.source}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 font-mono">
                    {selectedCampaignModal.totalLeads}{' '}
                    {selectedCampaignModal.totalLeads === 1 ? 'Lead' : 'Leads'} (
                    {selectedCampaignModal.percentageOfPeriod}% del período)
                  </span>
                </div>
                <h3 className="text-lg font-black text-white truncate">
                  {selectedCampaignModal.campaignName}
                </h3>
                {selectedCampaignModal.subtitle && (
                  <p className="text-xs text-amber-300/90 italic font-medium">
                    "{selectedCampaignModal.subtitle}"
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedCampaignModal(null)}
                className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                title="Cerrar modal (Esc)"
              >
                <X size={20} />
              </button>
            </div>

            {/* BARRA DE KPIS RÁPIDOS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 p-3 bg-zinc-900/40 border-b border-zinc-800/80 text-xs">
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  Total Leads
                </span>
                <span className="text-sm font-black text-amber-400 font-mono">
                  {selectedCampaignModal.totalLeads}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  Con Seguimiento
                </span>
                <span className="text-sm font-black text-emerald-400 font-mono">
                  {selectedCampaignModal.conSeguimientoCount} ({selectedCampaignModal.coberturaPct}%)
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  Sin Gestión
                </span>
                <span className="text-sm font-black text-rose-400 font-mono">
                  {selectedCampaignModal.sinGestionCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  No Contesta
                </span>
                <span className="text-sm font-black text-orange-400 font-mono">
                  {selectedCampaignModal.noContestaCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  Visita / Calif.
                </span>
                <span className="text-sm font-black text-purple-400 font-mono">
                  {selectedCampaignModal.estadosCount?.calificadoOVisita || 0}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-medium">
                  Ventas
                </span>
                <span className="text-sm font-black text-emerald-400 font-mono">
                  {selectedCampaignModal.ventasCount || 0}
                </span>
              </div>
            </div>

            {/* FILTROS: ASESORES Y BÚSQUEDA */}
            <div className="p-4 border-b border-zinc-800 bg-zinc-950 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {/* FILTROS POR ASESOR */}
                <div className="flex items-center gap-1.5 flex-wrap flex-1">
                  <span className="text-xs font-bold text-zinc-400 flex items-center gap-1 mr-1">
                    <Filter size={13} className="text-amber-400" />
                    <span>Filtrar Asesor:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalAdvisorFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      modalAdvisorFilter === 'all'
                        ? 'bg-amber-500 text-zinc-950 shadow-sm'
                        : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
                    }`}
                  >
                    Todos ({selectedCampaignModal.sampleLeads?.length || selectedCampaignModal.totalLeads})
                  </button>
                  {selectedCampaignModal.advisorsDistribution?.map((adv: any) => {
                    const isSelected =
                      modalAdvisorFilter.toLowerCase().trim() === adv.advisorName.toLowerCase().trim();
                    return (
                      <button
                        key={adv.advisorId}
                        type="button"
                        onClick={() => setModalAdvisorFilter(isSelected ? 'all' : adv.advisorName)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500 text-zinc-950 font-bold shadow-sm'
                            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                        }`}
                      >
                        <span>{adv.advisorName}:</span>
                        <strong
                          className={isSelected ? 'text-zinc-950 font-black' : 'text-amber-400 font-mono'}
                        >
                          {adv.count}
                        </strong>
                      </button>
                    );
                  })}
                </div>

                {/* BUSCADOR */}
                <div className="relative min-w-[240px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={modalLeadSearch}
                    onChange={(e) => setModalLeadSearch(e.target.value)}
                    placeholder="Buscar cliente, teléfono o nota..."
                    className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
                  />
                  {modalLeadSearch && (
                    <button
                      type="button"
                      onClick={() => setModalLeadSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* TABLA DE LEADS CON DETALLE REAL */}
            <div className="flex-1 overflow-y-auto p-4">
              {modalFilteredLeads.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 space-y-2">
                  <Search size={32} className="mx-auto opacity-30" />
                  <p className="text-sm font-semibold">No se encontraron prospectos con este filtro</p>
                  <p className="text-xs">Prueba seleccionando "Todos" o cambiando el término de búsqueda.</p>
                </div>
              ) : (
                <div className="border border-zinc-800/80 rounded-2xl overflow-hidden shadow-inner">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-zinc-900 text-zinc-400 uppercase tracking-wider text-[10px] font-bold border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center">#</th>
                        <th className="py-2.5 px-3">Fecha Captación</th>
                        <th className="py-2.5 px-3">Prospecto / Cliente</th>
                        <th className="py-2.5 px-3">WhatsApp / Teléfono</th>
                        <th className="py-2.5 px-3">Asesor Asignado</th>
                        <th className="py-2.5 px-3">Estado en Ficha</th>
                        <th className="py-2.5 px-4 w-1/3">Último Seguimiento / Bitácora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/60 font-normal">
                      {modalFilteredLeads.map((lead: any, idx: number) => {
                        const rawDigits = (lead.phone || '').replace(/\D/g, '');
                        const cleanPhone =
                          rawDigits.length === 10 && rawDigits.startsWith('3')
                            ? `57${rawDigits}`
                            : rawDigits;
                        const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

                        return (
                          <tr key={lead.leadId || idx} className="hover:bg-zinc-900/50 transition">
                            <td className="py-2.5 px-3 text-center text-zinc-500 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 text-zinc-300 font-mono text-[11px] whitespace-nowrap">
                              {lead.createdAtFormatted || 'Reciente'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-zinc-100 block">
                                {lead.clientName || 'Cliente sin registrar'}
                              </span>
                              {lead.adExcerpt && (
                                <span
                                  className="text-[10px] text-amber-400/80 block line-clamp-1 italic mt-0.5"
                                  title={lead.adExcerpt}
                                >
                                  "{lead.adExcerpt}"
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {waUrl ? (
                                <a
                                  href={waUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono font-bold transition"
                                  title="Abrir chat en WhatsApp"
                                >
                                  <Phone size={11} className="text-emerald-400" />
                                  <span>{lead.phone}</span>
                                  <ExternalLink size={10} className="opacity-70" />
                                </a>
                              ) : (
                                <span className="text-zinc-500 font-mono text-[11px]">
                                  {lead.phone || 'Sin teléfono'}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                <span>{lead.advisorName || 'Sin asignar'}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {(() => {
                                const st = (lead.status || '').toUpperCase();
                                if (st.includes('NUEVO') || st.includes('ASIGNADO')) {
                                  return (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                      {lead.status}
                                    </span>
                                  );
                                }
                                if (
                                  st.includes('VENTA') ||
                                  st.includes('GANAD') ||
                                  st.includes('VEND')
                                ) {
                                  return (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                      {lead.status}
                                    </span>
                                  );
                                }
                                if (st.includes('NO CONTESTA') || st.includes('SIN RESP')) {
                                  return (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                                      {lead.status}
                                    </span>
                                  );
                                }
                                if (st.includes('DESIST') || st.includes('PERDID')) {
                                  return (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                      {lead.status}
                                    </span>
                                  );
                                }
                                if (st.includes('VISITA') || st.includes('CALIFIC')) {
                                  return (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                      {lead.status}
                                    </span>
                                  );
                                }
                                return (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                                    {lead.status || 'EN GESTIÓN'}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="py-2.5 px-4 text-xs">
                              {lead.hasFollowUp && lead.lastFollowUpSummary ? (
                                <div className="p-2 rounded-xl bg-zinc-900/90 border border-zinc-800/80 text-zinc-300 text-[11px] leading-relaxed">
                                  <span className="font-semibold text-emerald-400 block text-[10px] mb-0.5 flex items-center gap-1">
                                    <CheckCircle2 size={10} />
                                    <span>Bitácora registrada:</span>
                                  </span>
                                  <span>"{lead.lastFollowUpSummary}"</span>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  <AlertCircle size={10} />
                                  <span>Sin bitácora registrada aún</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* PIE DEL MODAL */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 text-[11px]">
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span>
                  Mostrando <strong>{modalFilteredLeads.length}</strong> de{' '}
                  <strong>
                    {selectedCampaignModal.sampleLeads?.length || selectedCampaignModal.totalLeads}
                  </strong>{' '}
                  prospectos captados en este período.
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedCampaignModal(null)}
                className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL DEL COPILOTO COMERCIAL IA */}
      <CommercialAssistantDrawer
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        companyId={companyId}
        periodLabel={reportData?.periodLabel}
        startDate={selectedRangeStart.getTime()}
        endDate={selectedRangeEnd.getTime()}
      />

      {/* MODAL INTERACTIVO DE TRAZABILIDAD Y PROSPECTOS POR ASESOR / TOTALES */}
      {reportData && (
        <AdvisorLeadsDrilldownModal
          isOpen={advisorDrilldown.isOpen}
          onClose={() => setAdvisorDrilldown((prev) => ({ ...prev, isOpen: false }))}
          reportData={reportData}
          initialAdvisorId={advisorDrilldown.advisorId}
          initialScope={advisorDrilldown.scope}
          initialFilter={advisorDrilldown.filter}
          initialCategory={advisorDrilldown.category}
          isAdmin={isAdmin}
          lockedAdvisorId={!isAdmin ? (reportData.targetAdvisorName || currentUserId || currentUserName) : undefined}
        />
      )}
    </div>
  );
}
