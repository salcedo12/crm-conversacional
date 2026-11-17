import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import {
  RefreshCw, Search, UserPlus, ClipboardList, AlertTriangle, AlertCircle, Clock,
  FileText, Calendar, CheckCircle2, UserCheck, Building2, Users,
  FileSpreadsheet, Sparkles, Filter, ArrowUpDown, Loader2, X, Trophy, ArrowRightLeft, UserX,
  CalendarDays
} from 'lucide-react';
import { CommercialDateFilter, buildPresetRange, type DateRangeValue } from '../components/CommercialDateFilter';
import { CommercialKPIsBar } from '../components/CommercialKPIsBar';
import { SmartFollowUpSuggestions } from '../components/SmartFollowUpSuggestions';
import { CommercialLeadsTable } from '../components/CommercialLeadsTable';
import { CommercialFocusSessionModal } from '../components/CommercialFocusSessionModal';
import { CommercialLeaderboard } from '../components/CommercialLeaderboard';
import { CommercialReportView } from '../components/CommercialReportView';
import {
  fetchCommercialManagementData,
  searchCommercialLeads,
  exportCommercialLeadsToCsv,
  leadBelongsToAdvisor
} from '../services/commercial.service';
import { PIPELINE_STAGES } from '@/features/pipeline/types/pipeline.types';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';
import { NewLeadModal } from '@/features/leads/components/NewLeadModal';
import { TransferRequestsModal } from '@/features/leads/components/TransferRequestsModal';
import { listLeadTransferRequests } from '@/features/inbox/services/contacts.service';
import type { CommercialLeadItem, CommercialKPIs, CommercialSuggestion } from '../types/commercial.types';

function toMillisAny(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.seconds === 'number') return val.seconds * 1000;
  if (typeof val._seconds === 'number') return val._seconds * 1000;
  if (typeof val === 'string') {
    const parsed = Date.parse(val.replace(' ', 'T'));
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

function getLeadRecentTimestamp(lead: CommercialLeadItem): number {
  return (
    toMillisAny(lead.lastMessageAt) ||
    toMillisAny(lead.createdAt) ||
    toMillisAny(lead.updatedAt) ||
    toMillisAny(lead.lastFollowUpDate) ||
    0
  );
}

export function CommercialManagementPage() {
  const { companyId, user, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leads, setLeads] = useState<CommercialLeadItem[]>([]);
  const [kpis, setKpis] = useState<CommercialKPIs>({
    missingFollowUpCount: 0,
    overdueCount: 0,
    todayCount: 0,
    missingFichaCount: 0,
    upcomingCount: 0,
    completedThisMonthCount: 0,
    cancelledCount: 0,
    closedCount: 0,
    totalLeads: 0,
  });
  const [suggestions, setSuggestions] = useState<CommercialSuggestion[]>([]);
  const [advisors, setAdvisors] = useState<{ id: string; name: string }[]>([]);

  // Filtro de Fecha Interactivo (Por defecto: Semana comercial activa)
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => buildPresetRange('week'));

  // Filtros y Permisos
  // Si es admin: puede consultar 'all' o un asesor específico.
  // Si es rol asesor: queda estrictamente bloqueado en su propio user.uid
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>(() => {
    return isAdmin ? 'all' : (user?.uid || '');
  });

  useEffect(() => {
    if (!isAdmin && user?.uid && selectedAdvisorId !== user.uid) {
      setSelectedAdvisorId(user.uid);
    }
  }, [isAdmin, user?.uid, selectedAdvisorId]);

  const [mainView, setMainView] = useState<'fichas' | 'ranking' | 'report'>('fichas');
  const [activeCategory, setActiveCategory] = useState<
    'all' | 'urgent' | 'today' | 'missing' | 'upcoming' | 'completed' | 'cancelled' | 'closed' | 'missing_followup'
  >('all');
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedStage, setSelectedStage] = useState('all');
  const [sortBy, setSortBy] = useState<'urgency' | 'recent' | 'oldest' | 'name'>('recent');

  // Búsqueda profunda en servidor
  const [searchResults, setSearchResults] = useState<CommercialLeadItem[] | null>(null);
  const [searchingServer, setSearchingServer] = useState(false);

  // Paginación por lotes inteligentes
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Modales
  const [fichaTargetLead, setFichaTargetLead] = useState<CommercialLeadItem | null>(null);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showFocusSession, setShowFocusSession] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pendingTransfersCount, setPendingTransfersCount] = useState(0);

  const refreshPendingTransfers = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    try {
      const pending = await listLeadTransferRequests(companyId, 'pending');
      setPendingTransfersCount(pending.length);
    } catch {
      // ignore
    }
  }, [companyId, isAdmin]);

  useEffect(() => {
    refreshPendingTransfers();
    if (!companyId || !isAdmin) return;
    const q = query(
      collection(db, 'companies', companyId, 'leadTransferRequests'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setPendingTransfersCount(snap.size),
      () => {}
    );
    return () => unsub();
  }, [refreshPendingTransfers, companyId, isAdmin]);

  const loadData = useCallback(async (isSilent = false) => {
    if (!companyId) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      // Seguridad: si es asesor, forzar estrictamente su propio uid
      const effectiveAdvId = isAdmin ? selectedAdvisorId : (user?.uid || '');
      const data = await fetchCommercialManagementData(
        companyId,
        effectiveAdvId,
        80, // Lote inteligente para auditoría rápida
        null, // primera página
        isAdmin,
        user?.uid,
        dateRange.startDate,
        dateRange.endDate
      );
      setLeads(data.leads);
      setKpis(data.kpis);
      setSuggestions(data.suggestions);
      if (isAdmin && data.advisors.length > 0) {
        setAdvisors(data.advisors);
      }
      setLastVisibleDoc(data.lastVisibleDoc);
      setHasMore(data.hasMore);
    } catch (err) {
      console.error('[CommercialManagementPage] Error cargando datos:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId, selectedAdvisorId, isAdmin, user?.uid, dateRange.startDate, dateRange.endDate]);

  const handleLoadMore = async () => {
    if (!companyId || !lastVisibleDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const effectiveAdvId = isAdmin ? selectedAdvisorId : (user?.uid || '');
      const data = await fetchCommercialManagementData(
        companyId,
        effectiveAdvId,
        60,
        lastVisibleDoc,
        isAdmin,
        user?.uid,
        dateRange.startDate,
        dateRange.endDate
      );
      setLeads((prev) => [...prev, ...data.leads]);
      setLastVisibleDoc(data.lastVisibleDoc);
      setHasMore(data.hasMore);
    } catch (err) {
      console.error('[CommercialManagementPage] Error cargando más prospectos:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Búsqueda profunda en servidor / Firestore cuando el usuario busca por teléfono o texto
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) {
      setSearchResults(null);
      setSearchingServer(false);
      return;
    }

    let isMounted = true;
    setSearchingServer(true);

    const timer = setTimeout(async () => {
      try {
        if (!companyId) return;
        const effectiveAdvId = isAdmin ? selectedAdvisorId : (user?.uid || '');
        const serverFound = await searchCommercialLeads(
          companyId,
          q,
          effectiveAdvId,
          isAdmin,
          user?.uid
        );

        if (!isMounted) return;

        // Combinar con cualquier lead local que coincida (por si estaba en memoria)
        const qDigits = q.replace(/\D/g, '');
        const localMatches = leads.filter((l) => {
          const lDigits = l.phone.replace(/\D/g, '');
          const matchPhone =
            l.phone.includes(q) ||
            (qDigits.length >= 3 && lDigits.includes(qDigits)) ||
            (qDigits.length >= 10 && lDigits.endsWith(qDigits.slice(-10)));
          const matchName = l.name.toLowerCase().includes(q.toLowerCase());
          return matchPhone || matchName;
        });

        const mergedMap = new Map<string, CommercialLeadItem>();
        serverFound.forEach((l) => mergedMap.set(l.id, l));
        localMatches.forEach((l) => mergedMap.set(l.id, l));

        setSearchResults(Array.from(mergedMap.values()));
      } catch (err) {
        console.error('[CommercialManagementPage] Error buscando prospectos:', err);
      } finally {
        if (isMounted) setSearchingServer(false);
      }
    }, 350);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [search, companyId, selectedAdvisorId, isAdmin, user?.uid, leads]);

  // Actualización reactiva en memoria sin recargar toda la base de datos
  const handleLeadUpdated = (leadId: string, updates: Partial<CommercialLeadItem>) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, ...updates } : l))
    );
    setSearchResults((prev) =>
      prev ? prev.map((l) => (l.id === leadId ? { ...l, ...updates } : l)) : null
    );
  };

  // Lista de proyectos presentes para el filtro
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    const pool = searchResults !== null ? [...leads, ...searchResults] : leads;
    pool.forEach((l) => {
      if (l.project && l.project !== 'General') set.add(l.project);
    });
    return Array.from(set).sort();
  }, [leads, searchResults]);

  // Filtrado y ordenamiento reactivo en memoria
  const filteredLeads = useMemo(() => {
    const pool = searchResults !== null ? searchResults : leads;
    const effectiveAdvName = selectedAdvisorId !== 'all' ? (advisors.find((a) => a.id === selectedAdvisorId)?.name || '') : '';

    const filtered = pool.filter((lead) => {
      // 0. Filtro estricto por asesor seleccionado: solo trae lo de él
      if (selectedAdvisorId !== 'all') {
        const belongs = leadBelongsToAdvisor(lead, selectedAdvisorId, effectiveAdvName);
        if (!belongs) return false;
      }

      // 1. Filtro por categoría / KPI
      const isLost = lead.status === 'lost';
      const isClosed = lead.status === 'closed';

      if (activeCategory === 'cancelled') {
        if (!isLost) return false;
      } else if (activeCategory === 'closed') {
        if (!isClosed) return false;
      } else if (activeCategory === 'all') {
        // En "Todos", mostrar toda la cartera activa o con actividad en el período
      } else {
        // En vistas activas operativas, excluir cancelados / no interesados y cerrados
        if (isLost || isClosed) return false;
        if (activeCategory === 'missing_followup' && !lead.missingPeriodFollowUp) return false;
        if (activeCategory === 'urgent' && !lead.isOverdue) return false;
        if (activeCategory === 'today' && !lead.isToday) return false;
        if (activeCategory === 'missing' && lead.hasFicha) return false;
        if (activeCategory === 'upcoming' && !lead.isUpcoming) return false;
        if (activeCategory === 'completed') {
          // Si hay rango de fechas activo, mostrar estrictamente los que recibieron seguimiento en esas fechas
          if (dateRange.startDate && dateRange.endDate) {
            if (!lead.hadPeriodFollowUp) return false;
          } else {
            if (!lead.hasFicha) return false;
          }
        }
      }

      // 2. Filtro por proyecto
      if (selectedProject !== 'all' && lead.project !== selectedProject) return false;

      // 3. Filtro por etapa del embudo
      if (selectedStage !== 'all' && lead.pipelineStage !== selectedStage) return false;

      // 4. Búsqueda por texto / teléfono
      if (search.trim()) {
        const q = search.toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        const leadPhoneDigits = lead.phone.replace(/\D/g, '');
        const matchName = lead.name.toLowerCase().includes(q);
        // Por los últimos 10 dígitos también: "+1 312…" y "+57 312…" se guardan distinto
        const matchPhone =
          lead.phone.includes(q) ||
          (qDigits.length >= 3 && leadPhoneDigits.includes(qDigits)) ||
          (qDigits.length >= 10 && leadPhoneDigits.endsWith(qDigits.slice(-10)));
        const matchProject = lead.project?.toLowerCase().includes(q);
        const matchSummary = (lead.periodFollowUpSummary || lead.lastFollowUpSummary)?.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchProject && !matchSummary) return false;
      }

      return true;
    });

    // Ordenamiento
    return filtered.sort((a, b) => {
      if (sortBy === 'urgency') {
        if (a.missingPeriodFollowUp && !b.missingPeriodFollowUp) return -1;
        if (!a.missingPeriodFollowUp && b.missingPeriodFollowUp) return 1;
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        if (a.isToday && !b.isToday) return -1;
        if (!a.isToday && b.isToday) return 1;
        if (!a.hasFicha && b.hasFicha) return -1;
        if (a.hasFicha && !b.hasFicha) return 1;
        return getLeadRecentTimestamp(b) - getLeadRecentTimestamp(a);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'recent') {
        return getLeadRecentTimestamp(b) - getLeadRecentTimestamp(a);
      }
      if (sortBy === 'oldest') {
        return getLeadRecentTimestamp(a) - getLeadRecentTimestamp(b);
      }
      return 0;
    });
  }, [leads, searchResults, activeCategory, selectedProject, selectedStage, search, sortBy, selectedAdvisorId, advisors, dateRange]);

  // Prospectos objetivo para la Sesión de Enfoque / Maratón de Llamadas
  const focusTargetLeads = useMemo(() => {
    const urgentOrToday = filteredLeads.filter((l) => l.isOverdue || l.isToday);
    return urgentOrToday.length > 0 ? urgentOrToday : filteredLeads;
  }, [filteredLeads]);

  const handleApplySuggestion = (filter: 'urgent' | 'today' | 'missing' | 'stalled' | 'missing_followup') => {
    if (filter === 'missing_followup') setActiveCategory('missing_followup');
    else if (filter === 'urgent') setActiveCategory('urgent');
    else if (filter === 'today') setActiveCategory('today');
    else if (filter === 'missing') setActiveCategory('missing');
  };

  const handleExportCsv = () => {
    const filename = `gestion_comercial_${selectedProject !== 'all' ? selectedProject.replace(/\s+/g, '_') : 'general'}_${new Date().toISOString().slice(0, 10)}.csv`;
    exportCommercialLeadsToCsv(filteredLeads, filename);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-950 overscroll-contain">
      <div className="max-w-7xl mx-auto p-3.5 sm:p-6 space-y-5 sm:space-y-6 text-zinc-100 w-full pb-36 sm:pb-28">
        {/* ── Encabezado Principal ── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                <ClipboardList size={20} />
              </span>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                  <span>Gestión Comercial & Fichas Técnicas</span>
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 sm:line-clamp-none">
                  Seguimiento diario de prospectos, agenda de recordatorios y diligenciamiento de bitácoras.
                </p>
              </div>
            </div>
          </div>

          {/* Acciones de Encabezado */}
          <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto">
            {/* Selector de Asesor (visible para directores/admins) o Placa Bloqueada (para asesor) */}
            {isAdmin ? (
              <div className="flex-1 sm:flex-initial flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-sm min-w-[150px]">
                <UserCheck size={13} className="text-zinc-400 shrink-0" />
                <span className="text-[11px] text-zinc-500 font-medium shrink-0">Asesor:</span>
                <select
                  value={selectedAdvisorId}
                  onChange={(e) => setSelectedAdvisorId(e.target.value)}
                  className="bg-zinc-900 text-xs text-zinc-200 outline-none font-semibold cursor-pointer w-full sm:max-w-[150px] truncate"
                >
                  <option value="all" className="bg-zinc-900 text-zinc-100 py-1.5">Todos los Asesores</option>
                  {user?.uid && <option value={user.uid} className="bg-zinc-900 text-emerald-400 font-semibold py-1.5">Mis Prospectos ({user.displayName || 'Yo'})</option>}
                  {advisors
                    .filter((a) => a.id !== user?.uid)
                    .map((a) => (
                      <option key={a.id} value={a.id} className="bg-zinc-900 text-zinc-200 py-1.5">
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="flex-1 sm:flex-initial flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-2.5 py-1.5 shadow-sm text-emerald-300">
                <UserCheck size={13} className="text-emerald-400 shrink-0" />
                <span className="text-[11px] font-medium text-emerald-400/80 shrink-0">Mi Cartera:</span>
                <span className="text-xs font-semibold max-w-[160px] truncate">{user?.displayName || 'Asesor'}</span>
              </div>
            )}

            {/* Selector de Rango de Fechas / Calendario Interactivo */}
            <CommercialDateFilter value={dateRange} onChange={setDateRange} />

            {/* Botón Solicitudes de Traslado (solo Admin) */}
            {isAdmin && companyId && (
              <button
                type="button"
                onClick={() => setShowTransferModal(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer border ${
                  pendingTransfersCount > 0
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-500'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800'
                }`}
                title="Ver solicitudes de traslado de prospectos entre asesores"
              >
                <ArrowRightLeft size={14} className={pendingTransfersCount > 0 ? 'text-amber-400 shrink-0' : 'text-zinc-400 shrink-0'} />
                <span>Solicitudes de Traslado</span>
                {pendingTransfersCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-mono font-bold shadow-sm animate-pulse">
                    {pendingTransfersCount}
                  </span>
                )}
              </button>
            )}

            {/* Botón Modo Enfoque / Maratón de Llamadas */}
            <button
              type="button"
              onClick={() => setShowFocusSession(true)}
              disabled={filteredLeads.length === 0}
              title="Iniciar sesión guiada para llamar prospectos uno a uno"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Sparkles size={14} className="text-amber-400 shrink-0" />
              <span>Modo Llamadas</span>
              {focusTargetLeads.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-200 text-[10px] font-mono font-bold">
                  {focusTargetLeads.length}
                </span>
              )}
            </button>

            {/* Exportar a Excel */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredLeads.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-800 text-xs font-medium transition-colors cursor-pointer"
              title="Descargar listado en formato Excel / CSV con historial"
            >
              <FileSpreadsheet size={14} className="text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Exportar Excel</span>
            </button>

            {/* Generar Informe */}
            <button
              type="button"
              onClick={() => setMainView('report')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                mainView === 'report'
                  ? 'bg-violet-600 text-white border-violet-500 shadow-md'
                  : 'bg-violet-600/15 hover:bg-violet-600/25 text-violet-300 border-violet-500/40'
              }`}
              title="Generar informe semanal o mensual con lectura de fichas por IA"
            >
              <FileText size={14} className="text-violet-400 shrink-0" />
              <span className="hidden sm:inline">Generar Informe</span>
              <span className="px-1.5 py-0.2 rounded-full bg-violet-500/30 text-violet-200 text-[10px] font-mono font-bold">
                IA ✨
              </span>
            </button>

            <button
              type="button"
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
              title="Refrescar datos"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              onClick={() => setShowNewLeadModal(true)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
            >
              <UserPlus size={14} className="shrink-0" />
              <span>+ Nuevo Prospecto</span>
            </button>
          </div>
        </div>

        {/* ── Banner de Solicitudes de Traslado Pendientes (solo Admin) ── */}
        {isAdmin && pendingTransfersCount > 0 && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/35 flex items-center justify-between gap-3 flex-wrap shadow-sm">
            <div className="flex items-center gap-2.5 text-xs text-amber-200">
              <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300">
                <ArrowRightLeft size={16} />
              </span>
              <div>
                <p className="font-bold text-amber-200">
                  Tienes {pendingTransfersCount} solicitud{pendingTransfersCount === 1 ? '' : 'es'} de traslado pendiente{pendingTransfersCount === 1 ? '' : 's'} de revisión
                </p>
                <p className="text-[11px] text-amber-200/80">
                  Revisa cuándo hizo seguimiento por última vez el asesor actual y aprueba o rechaza el cambio.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTransferModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs shadow-sm transition-colors cursor-pointer"
            >
              Ver Solicitudes ({pendingTransfersCount})
            </button>
          </div>
        )}

        {/* ── Selector de Vista Principal: Fichas vs Metas y Ranking ── */}
        <div className="flex items-center gap-2 p-1 bg-zinc-900 border border-zinc-800 rounded-2xl w-fit shadow-inner">
          <button
            type="button"
            onClick={() => setMainView('fichas')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              mainView === 'fichas'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ClipboardList size={15} />
            <span>Gestión & Fichas Técnicas</span>
          </button>
          <button
            type="button"
            onClick={() => setMainView('ranking')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              mainView === 'ranking'
                ? 'bg-amber-500 text-zinc-950 shadow-md font-extrabold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Trophy size={15} />
            <span>Ranking & Metas del Mes</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              mainView === 'ranking' ? 'bg-zinc-900 text-amber-300' : 'bg-amber-500/20 text-amber-300'
            }`}>
              Nuevo
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMainView('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              mainView === 'report'
                ? 'bg-violet-600 text-white shadow-md font-extrabold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText size={15} />
            <span>{isAdmin ? 'Generar Informe Gerencial' : 'Mi Informe Comercial'}</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              mainView === 'report' ? 'bg-zinc-900 text-violet-300' : 'bg-violet-500/20 text-violet-300'
            }`}>
              IA ✨
            </span>
          </button>
        </div>

        {mainView === 'report' ? (
          companyId && (
            <CommercialReportView
              companyId={companyId}
              currentUserName={user?.displayName || user?.email || undefined}
              currentUserId={user?.uid}
              isAdmin={isAdmin}
            />
          )
        ) : mainView === 'ranking' ? (
          companyId && (
            <CommercialLeaderboard
              companyId={companyId}
              isAdmin={isAdmin}
              currentUserId={user?.uid}
            />
          )
        ) : (
          <>
            {/* ── Pequeño Dashboard / KPIs Comerciales ── */}
            <CommercialKPIsBar
              kpis={kpis}
              activeFilter={activeCategory}
              onSelectFilter={setActiveCategory}
              datePreset={dateRange.preset}
              dateLabel={dateRange.label}
            />

            {/* ── Sugerencias Inteligentes de Seguimiento ── */}
            <SmartFollowUpSuggestions
              suggestions={suggestions}
              onApplyFilter={handleApplySuggestion}
            />

            {/* ── Barra de Búsqueda, Filtros y Pestañas de Trabajo ── */}
        <div className="space-y-3 pt-2">
          {/* Pestañas rápidas con scroll horizontal suave en móvil */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'all'
                  ? 'bg-zinc-200 text-zinc-950 font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users size={13} className={activeCategory === 'all' ? 'text-zinc-950' : 'text-zinc-400'} />
              <span>Todos ({leads.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('missing_followup')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'missing_followup'
                  ? 'bg-rose-600 text-white font-bold shadow-sm ring-2 ring-rose-400'
                  : 'bg-rose-950/40 border border-rose-500/40 text-rose-300 hover:bg-rose-900/40'
              }`}
            >
              <AlertCircle size={13} className={activeCategory === 'missing_followup' ? 'text-white' : 'text-rose-400'} />
              <span>Falta Seguimiento</span>
              {kpis.missingFollowUpCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                  activeCategory === 'missing_followup' ? 'bg-rose-950/80 text-white' : 'bg-rose-500/30 text-rose-200'
                }`}>
                  {kpis.missingFollowUpCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('urgent')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'urgent'
                  ? 'bg-rose-500 text-white font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-rose-400 hover:bg-zinc-800'
              }`}
            >
              <AlertTriangle size={13} className={activeCategory === 'urgent' ? 'text-white' : 'text-rose-400'} />
              <span>Vencidos</span>
              {kpis.overdueCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'urgent' ? 'bg-rose-950/60 text-white' : 'bg-rose-950 text-rose-300'
                }`}>
                  {kpis.overdueCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('today')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'today'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-amber-400 hover:bg-zinc-800'
              }`}
            >
              <Clock size={13} className={activeCategory === 'today' ? 'text-zinc-950' : 'text-amber-400'} />
              <span>Para Hoy</span>
              {kpis.todayCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'today' ? 'bg-amber-950/40 text-zinc-950' : 'bg-amber-950 text-amber-300'
                }`}>
                  {kpis.todayCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('missing')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'missing'
                  ? 'bg-sky-500 text-zinc-950 font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-sky-400 hover:bg-zinc-800'
              }`}
            >
              <FileText size={13} className={activeCategory === 'missing' ? 'text-zinc-950' : 'text-sky-400'} />
              <span>Falta Ficha</span>
              {kpis.missingFichaCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'missing' ? 'bg-sky-950/40 text-zinc-950' : 'bg-sky-950 text-sky-300'
                }`}>
                  {kpis.missingFichaCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('upcoming')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'upcoming'
                  ? 'bg-indigo-500 text-white font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-indigo-400 hover:bg-zinc-800'
              }`}
            >
              <Calendar size={13} className={activeCategory === 'upcoming' ? 'text-white' : 'text-indigo-400'} />
              <span>Próximos</span>
              {kpis.upcomingCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'upcoming' ? 'bg-indigo-950/60 text-white' : 'bg-indigo-950 text-indigo-300'
                }`}>
                  {kpis.upcomingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('completed')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'completed'
                  ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-emerald-400 hover:bg-zinc-800'
              }`}
            >
              <CheckCircle2 size={13} className={activeCategory === 'completed' ? 'text-zinc-950' : 'text-emerald-400'} />
              <span>{dateRange.startDate && dateRange.endDate ? 'Con Seguimiento' : 'Con Ficha'}</span>
              {kpis.completedThisMonthCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'completed' ? 'bg-emerald-950/40 text-zinc-950' : 'bg-emerald-950 text-emerald-300'
                }`}>
                  {kpis.completedThisMonthCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('cancelled')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'cancelled'
                  ? 'bg-rose-600 text-white font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-rose-400 hover:bg-zinc-800'
              }`}
            >
              <UserX size={13} className={activeCategory === 'cancelled' ? 'text-white' : 'text-rose-400'} />
              <span>Cancelados</span>
              {kpis.cancelledCount !== undefined && kpis.cancelledCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'cancelled' ? 'bg-rose-950/60 text-white' : 'bg-rose-950 text-rose-300'
                }`}>
                  {kpis.cancelledCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('closed')}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeCategory === 'closed'
                  ? 'bg-teal-600 text-white font-bold shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-teal-400 hover:bg-zinc-800'
              }`}
            >
              <Trophy size={13} className={activeCategory === 'closed' ? 'text-white' : 'text-teal-400'} />
              <span>Ventas</span>
              {kpis.closedCount !== undefined && kpis.closedCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeCategory === 'closed' ? 'bg-teal-950/60 text-white' : 'bg-teal-950 text-teal-300'
                }`}>
                  {kpis.closedCount}
                </span>
              )}
            </button>
          </div>

          {/* Segunda Fila: Filtro Fecha (Calendario), Filtro Proyecto, Filtro Etapa, Ordenamiento y Buscador */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* Selector de Rango de Fechas / Calendario Interactivo */}
              <CommercialDateFilter value={dateRange} onChange={setDateRange} />

              {/* Filtro Proyecto */}
              {projectOptions.length > 0 && (
                <div className="flex-1 min-w-[130px] flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-sm">
                  <Building2 size={13} className="text-zinc-400 shrink-0" />
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="bg-zinc-900 text-xs text-zinc-200 outline-none focus:border-emerald-500 cursor-pointer w-full truncate"
                  >
                    <option value="all" className="bg-zinc-900 text-zinc-100 py-1">Todos los Proyectos</option>
                    {projectOptions.map((p) => (
                      <option key={p} value={p} className="bg-zinc-900 text-zinc-200 py-1">
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Filtro por Etapa del Embudo */}
              <div className="flex-1 min-w-[130px] flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-sm">
                <Filter size={13} className="text-zinc-400 shrink-0" />
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="bg-zinc-900 text-xs text-zinc-200 outline-none focus:border-emerald-500 cursor-pointer w-full truncate"
                >
                  <option value="all" className="bg-zinc-900 text-zinc-100 py-1">Todas las Etapas</option>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.id} value={s.id} className="bg-zinc-900 text-zinc-200 py-1">
                      {s.label} ({s.probabilityLabel})
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector de Ordenamiento */}
              <div className="flex-1 min-w-[130px] flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-sm">
                <ArrowUpDown size={13} className="text-zinc-400 shrink-0" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-zinc-900 text-xs text-zinc-200 outline-none focus:border-emerald-500 cursor-pointer w-full truncate"
                >
                  <option value="urgency" className="bg-zinc-900 text-zinc-100 py-1">Más urgentes primero</option>
                  <option value="recent" className="bg-zinc-900 text-zinc-200 py-1">Más recientes</option>
                  <option value="oldest" className="bg-zinc-900 text-zinc-200 py-1">Más antiguos</option>
                  <option value="name" className="bg-zinc-900 text-zinc-200 py-1">Nombre (A - Z)</option>
                </select>
              </div>
            </div>

            {/* Buscador de prospectos con Búsqueda en Servidor */}
            <div className="relative w-full md:w-72">
              {searchingServer ? (
                <Loader2 size={14} className="absolute left-3 top-2.5 text-emerald-400 animate-spin" />
              ) : (
                <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
              )}
              <input
                type="text"
                placeholder="Buscar prospecto o teléfono exacto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-8 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  title="Limpiar búsqueda"
                  className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Contador y Resumen de Registros ── */}
        <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1 pt-1">
          <div>
            {searchResults !== null ? (
              <span>
                Búsqueda en base de datos: <strong className="text-emerald-400 font-semibold">{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'contacto encontrado' : 'contactos encontrados'} para <span className="text-zinc-300 font-mono">"{search}"</span>
              </span>
            ) : (
              <span>Mostrando <strong className="text-zinc-300 font-semibold">{filteredLeads.length}</strong> de {leads.length} prospectos</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {searchResults !== null && (
              <button
                onClick={() => setSearch('')}
                className="text-emerald-400 hover:underline cursor-pointer text-[11px]"
              >
                Ver todos
              </button>
            )}
            {activeCategory !== 'all' && (
              <button
                onClick={() => setActiveCategory('all')}
                className="text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
              >
                Restablecer filtros
              </button>
            )}
          </div>
        </div>

        {/* ── Barra Informativa de Filtros Activos (Asesor + Fechas + Vista) ── */}
        {(selectedAdvisorId !== 'all' || (dateRange.preset !== 'all' && dateRange.startDate) || activeCategory !== 'all') && (
          <div className="flex items-center gap-2 flex-wrap text-xs bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-300 shadow-sm">
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Filtros aplicados:</span>
            {selectedAdvisorId !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <UserCheck size={12} />
                <span>Asesor: {advisors.find((a) => a.id === selectedAdvisorId)?.name || 'Seleccionado'}</span>
                {isAdmin && (
                  <button type="button" onClick={() => setSelectedAdvisorId('all')} className="hover:text-white cursor-pointer ml-1" title="Quitar filtro de asesor">
                    <X size={12} />
                  </button>
                )}
              </span>
            )}
            {dateRange.preset !== 'all' && dateRange.startDate && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <CalendarDays size={12} />
                <span>Período: {dateRange.label}</span>
                <button type="button" onClick={() => setDateRange(buildPresetRange('all'))} className="hover:text-white cursor-pointer ml-1" title="Ver histórico completo">
                  <X size={12} />
                </button>
              </span>
            )}
            {activeCategory !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700 text-xs font-medium">
                <span>Pestaña: {activeCategory === 'completed' ? 'Con Seguimiento' : activeCategory}</span>
                <button type="button" onClick={() => setActiveCategory('all')} className="hover:text-white cursor-pointer ml-1" title="Mostrar todos">
                  <X size={12} />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (isAdmin) setSelectedAdvisorId('all');
                setDateRange(buildPresetRange('all'));
                setActiveCategory('all');
                setSelectedProject('all');
                setSelectedStage('all');
                setSearch('');
              }}
              className="text-xs text-zinc-400 hover:text-zinc-100 hover:underline cursor-pointer ml-auto font-medium"
            >
              Restablecer todo
            </button>
          </div>
        )}

        {/* ── Tabla Interactiva de Prospectos ── */}
        <CommercialLeadsTable
          leads={filteredLeads}
          loading={loading}
          companyId={companyId || undefined}
          authorName={user?.displayName || 'Asesor'}
          isAdmin={isAdmin}
          advisors={advisors}
          onOpenFicha={(lead) => setFichaTargetLead(lead)}
          onLeadUpdated={handleLeadUpdated}
        />

        {/* ── Paginación / Cargar Más Prospectos (Ahorro de lecturas en Firestore) ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 pb-6 px-1 text-xs text-zinc-400 border-t border-zinc-800/60">
          <div>
            {searchResults !== null ? (
              <span>
                Resultados de búsqueda global: <strong className="text-zinc-200 font-bold">{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'prospecto encontrado' : 'prospectos encontrados'} en toda la base de datos
              </span>
            ) : (
              <span>
                Mostrando <strong className="text-zinc-200 font-bold">{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'prospecto' : 'prospectos'}
                {leads.length > filteredLeads.length && ` (de ${leads.length} cargados en memoria)`}
              </span>
            )}
          </div>

          <div>
            {searchResults !== null ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs border border-zinc-700 cursor-pointer"
              >
                <X size={12} /> Limpiar búsqueda y volver a la lista
              </button>
            ) : hasMore ? (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700/80 hover:border-emerald-500/50 text-xs font-semibold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={13} className="animate-spin text-emerald-400" />
                    <span>Cargando 40 prospectos más...</span>
                  </>
                ) : (
                  <>
                    <span>Cargar 40 prospectos más</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono font-bold">+40</span>
                  </>
                )}
              </button>
            ) : leads.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-zinc-500 text-xs">
                <CheckCircle2 size={13} className="text-emerald-500/70" />
                <span>Has cargado todos los prospectos disponibles ({leads.length})</span>
              </span>
            ) : null}
          </div>
        </div>
        </>
        )}
      </div>

      {/* ── Modal de Ficha Técnica Integrada ── */}
      {fichaTargetLead && companyId && (
        <FichaTecnicaModal
          isOpen={!!fichaTargetLead}
          onClose={() => setFichaTargetLead(null)}
          companyId={companyId}
          lead={{
            id: fichaTargetLead.id,
            name: fichaTargetLead.name,
            phone: fichaTargetLead.phone,
            project: fichaTargetLead.project,
            advisorName: fichaTargetLead.advisorName,
            bitacoras: fichaTargetLead.bitacoras,
            metadata: fichaTargetLead.metadata,
          }}
          onSuccess={() => {
            loadData(true);
          }}
        />
      )}

      {/* ── Modal de Nuevo Prospecto ── */}
      {showNewLeadModal && companyId && (
        <NewLeadModal
          isOpen={showNewLeadModal}
          onClose={() => setShowNewLeadModal(false)}
          companyId={companyId}
          advisors={advisors.map((a) => ({
            id: a.id,
            displayName: a.name,
            email: '',
            role: 'advisor',
            active: true,
            googleConnected: false,
          }))}
          onCreated={() => {
            loadData(true);
          }}
        />
      )}

      {/* ── Modal de Modo Enfoque / Maratón de Llamadas ── */}
      {showFocusSession && companyId && (
        <CommercialFocusSessionModal
          isOpen={showFocusSession}
          onClose={() => setShowFocusSession(false)}
          leads={focusTargetLeads}
          companyId={companyId}
          authorName={user?.displayName || 'Asesor'}
          onLeadUpdated={() => {
            loadData(true);
          }}
        />
      )}

      {/* ── Modal de Solicitudes de Traslado (solo Admin) ── */}
      {isAdmin && companyId && (
        <TransferRequestsModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          companyId={companyId}
          onResolved={() => {
            refreshPendingTransfers();
            loadData(true);
          }}
        />
      )}
    </div>
  );
}

