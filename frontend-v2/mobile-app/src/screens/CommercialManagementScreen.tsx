import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore, { type FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { isAdminRole } from '../types';
import {
  PIPELINE_STAGES,
  fetchCommercialLeaderboard,
  fetchCommercialManagementData,
  listAdvisors,
  reassignLead,
  recordLeadAudit,
  registerQuickNoContesto,
  reportAppointmentFicha,
  saveCommercialGoalsConfig,
  searchCommercialLeads,
  shareCsvFile,
  updateLeadPipelineStage,
  type Advisor,
  type AdvisorLeaderboardItem,
  type CommercialGoalConfig,
  type CommercialKPIs,
  type CommercialLeadItem,
  type CommercialLeaderboardResponse,
  type CommercialSuggestion,
} from '../services/enterprise';
import { listLeadTransferRequests } from '../services/contacts';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon, type LucideIconName } from '../components/Icon';
import { Button } from '../components/Button';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { EmptyState } from '../components/EmptyState';
import { LoadingView } from '../components/LoadingView';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import { NewLeadModal } from '../components/NewLeadModal';
import { TransferRequestsModal } from '../components/TransferRequestsModal';

type CategoryFilter = 'all' | 'missing_followup' | 'overdue' | 'today' | 'missing_ficha' | 'upcoming' | 'with_ficha' | 'cancelled' | 'closed';
type SortOption = 'urgency' | 'recent' | 'oldest' | 'name';
type ActiveView = 'fichas' | 'metas';
export type PeriodPreset = 'week' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all';

export const PERIOD_OPTIONS: SelectOption[] = [
  { value: 'week', label: 'Esta semana' },
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'all', label: 'Histórico completo' },
];

export function getPeriodDates(preset: PeriodPreset): { startDate: Date | null; endDate: Date | null } {
  const now = new Date();
  if (preset === 'all') return { startDate: null, endDate: null };
  if (preset === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { startDate: s, endDate: e };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const s = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0);
    const e = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
    return { startDate: s, endDate: e };
  }
  if (preset === '7d') {
    const s = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    return { startDate: s, endDate: now };
  }
  if (preset === '30d') {
    const s = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    return { startDate: s, endDate: now };
  }
  if (preset === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    return { startDate: s, endDate: now };
  }
  // Preset 'week'
  const currentDay = now.getDay();
  const rawDiff = (currentDay + 2) % 7;
  const daysSinceFriday = rawDiff === 0 ? 7 : rawDiff;
  const lastFriday = new Date(now);
  lastFriday.setDate(now.getDate() - daysSinceFriday);
  lastFriday.setHours(9, 0, 0, 0);
  return { startDate: lastFriday, endDate: now };
}

function parseToMillis(val: any): number {
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
    parseToMillis(lead.lastMessageAt) ||
    parseToMillis(lead.createdAt) ||
    parseToMillis(lead.updatedAt) ||
    parseToMillis(lead.lastFollowUpDate) ||
    0
  );
}

const FOCUS_ACTION_RESULTS: Array<{
  id: string;
  label: string;
  actionType: 'llamada' | 'cita_reunion' | 'envio_informacion' | 'seguimiento_general';
  result: string;
  defaultNextAction: string;
}> = [
  {
    id: 'contactado_interesado',
    label: 'Contacto efectivo · Interesado',
    actionType: 'llamada',
    result: 'Contacto efectivo - Interesado',
    defaultNextAction: 'Seguimiento comercial / envío de propuesta',
  },
  {
    id: 'cita_concretada',
    label: 'Cita / Visita concretada',
    actionType: 'cita_reunion',
    result: 'Cita concretada',
    defaultNextAction: 'Confirmar asistencia a cita / visita',
  },
  {
    id: 'solicito_info',
    label: 'Solicitó envío de información / cotización',
    actionType: 'envio_informacion',
    result: 'Solicitó información',
    defaultNextAction: 'Validar revisión de información enviada',
  },
  {
    id: 'ocupado_llamar_luego',
    label: 'Ocupado · Llamar en otro momento',
    actionType: 'llamada',
    result: 'Ocupado - Llamar luego',
    defaultNextAction: 'Reintentar llamada telefónica',
  },
  {
    id: 'no_interesado',
    label: 'No interesado / Descartado',
    actionType: 'seguimiento_general',
    result: 'No interesado',
    defaultNextAction: 'Cierre de seguimiento (No interesado)',
  },
];

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const d = new Date(Number(yStr), Number(mStr) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function cleanPhoneDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function formatWaPhone(raw: string): string {
  const digits = cleanPhoneDigits(raw);
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

export function CommercialManagementScreen() {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const authCtx = useAuth();
  const { user, profile, companyId, role, platformAdmin } = authCtx;
  const isAdmin = Boolean((authCtx as { isAdmin?: boolean }).isAdmin ?? (platformAdmin || isAdminRole(role)));

  const currentUserId = user?.uid || '';
  const authorName = profile?.displayName || user?.displayName || user?.email || 'Asesor';

  // ── Main View State ────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>('fichas');

  // ── Fichas Data State ──────────────────────────────────────────────────────
  const [selectedAdvisor, setSelectedAdvisor] = useState<string>(() => (isAdmin ? 'all' : currentUserId || 'all'));
  const [leads, setLeads] = useState<CommercialLeadItem[]>([]);
  const [kpis, setKpis] = useState<CommercialKPIs>({
    missingFollowUpCount: 0,
    overdueCount: 0,
    todayCount: 0,
    missingFichaCount: 0,
    upcomingCount: 0,
    completedThisMonthCount: 0,
    totalLeads: 0,
  });
  const [suggestions, setSuggestions] = useState<CommercialSuggestion[]>([]);
  const [advisorsSimple, setAdvisorsSimple] = useState<{ id: string; name: string }[]>([]);
  const [fullAdvisors, setFullAdvisors] = useState<Advisor[]>([]);
  const [lastDoc, setLastDoc] = useState<FirebaseFirestoreTypes.QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Filters & Search State ─────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('week');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSearchResults, setServerSearchResults] = useState<CommercialLeadItem[] | null>(null);
  const [isSearchingServer, setIsSearchingServer] = useState(false);

  // ── Row Interactions & Modals ──────────────────────────────────────────────
  const [expandedLeadIds, setExpandedLeadIds] = useState<Record<string, boolean>>({});
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [stageTargetLead, setStageTargetLead] = useState<CommercialLeadItem | null>(null);
  const [reassignTargetLead, setReassignTargetLead] = useState<CommercialLeadItem | null>(null);
  const [fuenteEditLead, setFuenteEditLead] = useState<CommercialLeadItem | null>(null);
  const [fuenteDraft, setFuenteDraft] = useState('');
  const [savingFuente, setSavingFuente] = useState(false);

  const [fichaLead, setFichaLead] = useState<CommercialLeadItem | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [pendingTransfersCount, setPendingTransfersCount] = useState(0);
  const [focusModalOpen, setFocusModalOpen] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [toastBanner, setToastBanner] = useState<string | null>(null);

  // ── Ranking & Metas State ──────────────────────────────────────────────────
  const [monthKey, setMonthKey] = useState<string>(getCurrentMonthKey);
  const [leaderboardData, setLeaderboardData] = useState<CommercialLeaderboardResponse | null>(null);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [leaderboardScope, setLeaderboardScope] = useState<'all' | 'mine'>('all');
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastBanner(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastBanner(null), 3200);
  }, []);

  useEffect(() => {
    if (!isAdmin && currentUserId && selectedAdvisor === 'all') {
      setSelectedAdvisor(currentUserId);
    }
  }, [isAdmin, currentUserId, selectedAdvisor]);

  const loadPendingTransfers = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    try {
      const items = await listLeadTransferRequests(companyId, 'pending');
      setPendingTransfersCount(items.length);
    } catch {
      // Ignore silently if permission restricted
    }
  }, [companyId, isAdmin]);

  const loadFullAdvisors = useCallback(async () => {
    if (!companyId) return;
    try {
      const list = await listAdvisors(companyId);
      setFullAdvisors(list);
    } catch {
      // Optional list for modals
    }
  }, [companyId]);

  const loadData = useCallback(
    async (showFullLoader = true) => {
      if (!companyId) {
        setLoading(false);
        return;
      }
      if (showFullLoader) setLoading(true);
      try {
        const targetAdv = isAdmin ? selectedAdvisor : currentUserId || selectedAdvisor;
        const { startDate, endDate } = getPeriodDates(periodPreset);
        const res = await fetchCommercialManagementData(
          companyId,
          targetAdv,
          80,
          null,
          isAdmin,
          currentUserId,
          startDate,
          endDate
        );
        setLeads(res.leads);
        setKpis(res.kpis);
        setSuggestions(res.suggestions);
        if (res.advisors.length > 0) setAdvisorsSimple(res.advisors);
        setLastDoc(res.lastVisibleDoc);
        setHasMore(res.hasMore);
      } catch (err: any) {
        Alert.alert('Error al cargar gestión comercial', err?.message || 'Intenta nuevamente.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, selectedAdvisor, isAdmin, currentUserId, periodPreset]
  );

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  useEffect(() => {
    loadPendingTransfers();
    loadFullAdvisors();
  }, [loadPendingTransfers, loadFullAdvisors]);

  const handleLoadMore = useCallback(async () => {
    if (!companyId || !hasMore || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const targetAdv = isAdmin ? selectedAdvisor : currentUserId || selectedAdvisor;
      const { startDate, endDate } = getPeriodDates(periodPreset);
      const res = await fetchCommercialManagementData(
        companyId,
        targetAdv,
        80,
        lastDoc,
        isAdmin,
        currentUserId,
        startDate,
        endDate
      );
      setLeads((prev) => {
        const existing = new Set(prev.map((l) => l.id));
        const incoming = res.leads.filter((l) => !existing.has(l.id));
        const merged = [...prev, ...incoming];
        // Recompute live KPIs across loaded set
        let overdueCount = 0;
        let todayCount = 0;
        let missingFichaCount = 0;
        let upcomingCount = 0;
        let missingFollowUpCount = 0;
        for (const item of merged) {
          if (item.missingPeriodFollowUp) missingFollowUpCount++;
          if (item.isOverdue) overdueCount++;
          else if (item.isToday) todayCount++;
          else if (item.isUpcoming) upcomingCount++;
          if (!item.hasFicha) missingFichaCount++;
        }
        setKpis((prevKpi) => ({
          missingFollowUpCount,
          overdueCount,
          todayCount,
          missingFichaCount,
          upcomingCount,
          completedThisMonthCount: prevKpi.completedThisMonthCount + res.kpis.completedThisMonthCount,
          totalLeads: merged.length,
        }));
        const nextSugs: CommercialSuggestion[] = [];
        if (missingFollowUpCount > 0) {
          nextSugs.push({
            id: 'sug-missing-followup',
            type: 'missing_followup',
            title: `${missingFollowUpCount} captado${missingFollowUpCount > 1 ? 's' : ''} esta semana sin gestión`,
            description: 'Prospectos recién captados sin llamadas ni bitácoras comerciales registradas en la semana.',
            count: missingFollowUpCount,
            actionFilter: 'missing_followup',
          });
        }
        if (overdueCount > 0) {
          nextSugs.push({
            id: 'sug-overdue',
            type: 'urgent',
            title: `${overdueCount} seguimiento${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''}`,
            description: 'Fecha límite expirada. Recontáctalos cuanto antes para no enfriar el interés.',
            count: overdueCount,
            actionFilter: 'urgent',
          });
        }
        if (todayCount > 0) {
          nextSugs.push({
            id: 'sug-today',
            type: 'today',
            title: `${todayCount} contacto${todayCount > 1 ? 's' : ''} para hoy`,
            description: 'Tienes acuerdos de llamadas, citas o cotizaciones programados para hoy.',
            count: todayCount,
            actionFilter: 'today',
          });
        }
        if (missingFichaCount > 0) {
          nextSugs.push({
            id: 'sug-missing',
            type: 'missing_ficha',
            title: `${missingFichaCount} sin primera ficha técnica`,
            description: 'Registra acuerdos o resumen inicial en la bitácora de estos prospectos.',
            count: missingFichaCount,
            actionFilter: 'missing',
          });
        }
        setSuggestions(nextSugs);
        return merged;
      });
      setLastDoc(res.lastVisibleDoc);
      setHasMore(res.hasMore);
    } catch (err: any) {
      Alert.alert('Error al cargar más prospectos', err?.message || 'Intenta nuevamente.');
    } finally {
      setLoadingMore(false);
    }
  }, [companyId, hasMore, lastDoc, loadingMore, isAdmin, selectedAdvisor, currentUserId, periodPreset]);

  // ── Debounced Server + Local Search ────────────────────────────────────────
  useEffect(() => {
    const term = searchQuery.trim();
    if (!term || !companyId) {
      setServerSearchResults(null);
      setIsSearchingServer(false);
      return;
    }
    setIsSearchingServer(true);
    const timer = setTimeout(async () => {
      try {
        const targetAdv = isAdmin ? selectedAdvisor : currentUserId || selectedAdvisor;
        const found = await searchCommercialLeads(companyId, term, targetAdv, isAdmin, currentUserId);
        setServerSearchResults(found);
      } catch {
        setServerSearchResults([]);
      } finally {
        setIsSearchingServer(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, companyId, isAdmin, selectedAdvisor, currentUserId]);

  // ── Leaderboard Loader ─────────────────────────────────────────────────────
  const loadLeaderboard = useCallback(async () => {
    if (!companyId) return;
    setLoadingLeaderboard(true);
    try {
      const res = await fetchCommercialLeaderboard(companyId, monthKey);
      setLeaderboardData(res);
    } catch (err: any) {
      Alert.alert('Error al cargar ranking', err?.message || 'No se pudo consultar el ranking del mes.');
    } finally {
      setLoadingLeaderboard(false);
    }
  }, [companyId, monthKey]);

  useEffect(() => {
    if (activeView === 'metas') {
      loadLeaderboard();
    }
  }, [activeView, loadLeaderboard]);

  // ── Derived Filter Options & Filtered Leads ────────────────────────────────
  const advisorOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'Todos los Asesores' }];
    if (currentUserId) {
      opts.push({
        value: currentUserId,
        label: `Mis Prospectos (${profile?.displayName || 'Míos'})`,
      });
    }
    const seen = new Set(opts.map((o) => o.value));
    const sourceList =
      advisorsSimple.length > 0
        ? advisorsSimple
        : fullAdvisors.map((a) => ({ id: a.id, name: a.displayName || a.email }));
    for (const adv of sourceList) {
      if (!seen.has(adv.id)) {
        seen.add(adv.id);
        opts.push({ value: adv.id, label: adv.name });
      }
    }
    return opts;
  }, [advisorsSimple, fullAdvisors, currentUserId, profile?.displayName]);

  const availableProjects = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.project) set.add(l.project);
    });
    return Array.from(set).sort();
  }, [leads]);

  const projectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'Todos los Proyectos' },
      ...availableProjects.map((p) => ({ value: p, label: p })),
    ],
    [availableProjects]
  );

  const stageOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'Todas las Etapas' },
      ...PIPELINE_STAGES.map((s) => ({
        value: s.id,
        label: `${s.label} (${s.probabilityLabel})`,
      })),
    ],
    []
  );

  const sortOptions: SelectOption[] = useMemo(
    () => [
      { value: 'urgency', label: 'Prioridad / Urgencia' },
      { value: 'recent', label: 'Última gestión reciente' },
      { value: 'oldest', label: 'Sin gestión reciente' },
      { value: 'name', label: 'Nombre A - Z' },
    ],
    []
  );

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let base: CommercialLeadItem[] = leads;

    if (q) {
      const localMatches = leads.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          l.project.toLowerCase().includes(q) ||
          l.advisorName.toLowerCase().includes(q)
      );
      const map = new Map<string, CommercialLeadItem>();
      localMatches.forEach((l) => map.set(l.id, l));
      (serverSearchResults || []).forEach((l) => {
        if (!map.has(l.id)) map.set(l.id, l);
      });
      base = Array.from(map.values());
    }

    const list = base.filter((l) => {
      // 0. Si se filtra por asesor específico, solo mostrar leads asignados a él
      if (selectedAdvisor !== 'all' && l.advisorId && l.advisorId !== selectedAdvisor) {
        return false;
      }

      const isLost = l.status === 'lost';
      const isClosed = l.status === 'closed';

      if (categoryFilter === 'cancelled') {
        if (!isLost) return false;
      } else if (categoryFilter === 'closed') {
        if (!isClosed) return false;
      } else {
        if (isLost) return false;
        if (categoryFilter === 'missing_followup' && !l.missingPeriodFollowUp) return false;
        if (categoryFilter === 'overdue' && !l.isOverdue) return false;
        if (categoryFilter === 'today' && !l.isToday) return false;
        if (categoryFilter === 'missing_ficha' && l.hasFicha) return false;
        if (categoryFilter === 'upcoming' && !l.isUpcoming) return false;
        if (categoryFilter === 'with_ficha') {
          if (periodPreset === 'all') {
            if (!l.hasFicha) return false;
          } else {
            if (!l.hadPeriodFollowUp) return false;
          }
        }
      }

      if (projectFilter !== 'all' && l.project !== projectFilter) return false;
      if (stageFilter !== 'all' && l.pipelineStage !== stageFilter) return false;
      return true;
    });

    const sorted = [...list];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } else if (sortBy === 'recent') {
      sorted.sort((a, b) => getLeadRecentTimestamp(b) - getLeadRecentTimestamp(a));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => getLeadRecentTimestamp(a) - getLeadRecentTimestamp(b));
    } else {
      sorted.sort((a, b) => {
        if (a.missingPeriodFollowUp !== b.missingPeriodFollowUp) return a.missingPeriodFollowUp ? -1 : 1;
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
        if (a.hasFicha !== b.hasFicha) return !a.hasFicha ? -1 : 1;
        return getLeadRecentTimestamp(b) - getLeadRecentTimestamp(a);
      });
    }
    return sorted;
  }, [leads, searchQuery, serverSearchResults, categoryFilter, projectFilter, stageFilter, sortBy, periodPreset, selectedAdvisor]);

  const focusTargetLeads = useMemo(() => {
    const urgent = filteredLeads.filter((l) => l.isOverdue || l.isToday || !l.hasFicha);
    return urgent.length > 0 ? urgent : filteredLeads;
  }, [filteredLeads]);

  const hasActiveFilters =
    categoryFilter !== 'all' || projectFilter !== 'all' || stageFilter !== 'all' || searchQuery.trim().length > 0;

  const resetFilters = useCallback(() => {
    setCategoryFilter('all');
    setProjectFilter('all');
    setStageFilter('all');
    setSortBy('urgency');
    setSearchQuery('');
  }, []);

  // ── Quick Actions ──────────────────────────────────────────────────────────
  const handleQuickNoContesto = useCallback(
    async (lead: CommercialLeadItem) => {
      if (!companyId || quickBusyId) return;
      setQuickBusyId(lead.id);
      try {
        const res = await registerQuickNoContesto(companyId, lead, authorName);
        setLeads((prev) =>
          prev.map((item) =>
            item.id === lead.id
              ? {
                  ...item,
                  hasFicha: true,
                  isOverdue: false,
                  isToday: true,
                  nextFollowUpDate: res.nextFollowUpDate,
                  nextFollowUpAction: res.nextFollowUpAction,
                  lastFollowUpAction: 'llamada',
                  lastFollowUpSummary: res.bitacoraEntry.description,
                  lastFollowUpDate: 'Hace un momento',
                  bitacorasCount: (item.bitacorasCount || 0) + 1,
                  bitacoras: [res.bitacoraEntry, ...(item.bitacoras || [])],
                }
              : item
          )
        );
        showToast(`Reintento agendado (${res.nextFollowUpDate}) para ${lead.name}`);
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'No se pudo registrar el intento de llamada.');
      } finally {
        setQuickBusyId(null);
      }
    },
    [companyId, quickBusyId, authorName, showToast]
  );

  const handleStageChange = useCallback(
    async (lead: CommercialLeadItem, newStageId: string) => {
      if (!companyId) return;
      const stageCfg = PIPELINE_STAGES.find((s) => s.id === newStageId);
      if (!stageCfg) return;
      const prevStage = lead.pipelineStage;
      const prevLabel = lead.pipelineStageLabel;
      setStageTargetLead(null);
      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, pipelineStage: stageCfg.id, pipelineStageLabel: stageCfg.label } : l
        )
      );
      try {
        await updateLeadPipelineStage(companyId, lead.id, newStageId, authorName);
        showToast(`Etapa actualizada: ${stageCfg.label}`);
      } catch (err: any) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id ? { ...l, pipelineStage: prevStage, pipelineStageLabel: prevLabel } : l
          )
        );
        Alert.alert('Error', err?.message || 'No se pudo cambiar la etapa.');
      }
    },
    [companyId, authorName, showToast]
  );

  const handleReassignAdvisor = useCallback(
    async (lead: CommercialLeadItem, newAdvisorId: string) => {
      if (!companyId) return;
      const advObj =
        advisorsSimple.find((a) => a.id === newAdvisorId) ||
        fullAdvisors
          .map((a) => ({ id: a.id, name: a.displayName || a.email }))
          .find((a) => a.id === newAdvisorId);
      const newName = newAdvisorId ? advObj?.name || 'Asesor' : 'Sin asignar';
      setReassignTargetLead(null);
      const oldId = lead.advisorId;
      const oldName = lead.advisorName;
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, advisorId: newAdvisorId, advisorName: newName } : l))
      );
      try {
        await reassignLead(companyId, lead.id, newAdvisorId || null);
        await recordLeadAudit(
          companyId,
          lead.id,
          'reassigned_advisor',
          { from: oldName, to: newName, advisorId: newAdvisorId },
          authorName
        );
        showToast(`Prospecto asignado a ${newName}`);
      } catch (err: any) {
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, advisorId: oldId, advisorName: oldName } : l))
        );
        Alert.alert('Error al reasignar', err?.message || 'No se pudo reasignar el asesor.');
      }
    },
    [companyId, advisorsSimple, fullAdvisors, authorName, showToast]
  );

  const handleSaveFuenteUbicacion = useCallback(async () => {
    if (!companyId || !fuenteEditLead) return;
    const clean = fuenteDraft.trim() || 'Directo';
    setSavingFuente(true);
    try {
      await firestore()
        .collection('companies')
        .doc(companyId)
        .collection('leads')
        .doc(fuenteEditLead.id)
        .update({
          fuenteUbicacion: clean,
          'metadata.fuenteUbicacion': clean,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      await recordLeadAudit(
        companyId,
        fuenteEditLead.id,
        'updated_fuente_ubicacion',
        { from: fuenteEditLead.fuenteUbicacion || 'Directo', to: clean },
        authorName
      );
      setLeads((prev) =>
        prev.map((l) => (l.id === fuenteEditLead.id ? { ...l, fuenteUbicacion: clean } : l))
      );
      setFuenteEditLead(null);
      showToast('Fuente / ubicación actualizada');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo actualizar la fuente.');
    } finally {
      setSavingFuente(false);
    }
  }, [companyId, fuenteEditLead, fuenteDraft, authorName, showToast]);

  const handleExportCsv = useCallback(async () => {
    if (filteredLeads.length === 0) {
      Alert.alert('Sin registros', 'No hay prospectos en la vista actual para exportar.');
      return;
    }
    setExportingCsv(true);
    try {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const headers = [
        'Nombre',
        'Teléfono',
        'Proyecto',
        'Asesor',
        'Etapa Embudo',
        'Fuente / Ubicación',
        'Tiene Ficha',
        'Total Gestiones',
        'Última Gestión Fecha',
        'Última Gestión Resumen',
        'Próximo Seguimiento Fecha',
        'Próximo Seguimiento Acción',
      ];
      const rows = filteredLeads.map((l) =>
        [
          esc(l.name),
          esc(l.phone),
          esc(l.project),
          esc(l.advisorName),
          esc(l.pipelineStageLabel),
          esc(l.fuenteUbicacion || l.source),
          esc(l.hasFicha ? 'Sí' : 'No'),
          esc(l.bitacorasCount),
          esc(l.lastFollowUpDate || ''),
          esc(l.lastFollowUpSummary || ''),
          esc(l.nextFollowUpDate || ''),
          esc(l.nextFollowUpAction || ''),
        ].join(',')
      );
      const csv = [headers.map(esc).join(','), ...rows].join('\n');
      const todayStr = new Date().toISOString().slice(0, 10);
      await shareCsvFile(`gestion_comercial_${todayStr}.csv`, csv);
    } catch (err: any) {
      Alert.alert('Error al exportar', err?.message || 'No se pudo compartir el archivo CSV.');
    } finally {
      setExportingCsv(false);
    }
  }, [filteredLeads]);

  const toggleExpandBitacoras = useCallback((leadId: string) => {
    setExpandedLeadIds((prev) => ({ ...prev, [leadId]: !prev[leadId] }));
  }, []);

  // ── Render Lead Card (Mobile 1:1 Parity with CommercialLeadsTable) ─────────
  const renderLeadCard = useCallback(
    ({ item: lead }: { item: CommercialLeadItem }) => {
      const stageCfg = PIPELINE_STAGES.find((s) => s.id === lead.pipelineStage) || PIPELINE_STAGES[0];
      const isExpanded = !!expandedLeadIds[lead.id];
      const digits = cleanPhoneDigits(lead.phone);
      const waDigits = formatWaPhone(lead.phone);
      const bitacorasList = Array.isArray(lead.bitacoras) ? lead.bitacoras : [];

      let nextColor = palette.textMuted;
      let nextBg = palette.bgSubtle;
      let nextBorder = palette.border;
      let nextTag = 'Sin programar';
      if (lead.nextFollowUpDate) {
        if (lead.isOverdue) {
          nextColor = palette.roseText;
          nextBg = palette.roseBg;
          nextBorder = palette.roseBorder;
          nextTag = 'Vencido';
        } else if (lead.isToday) {
          nextColor = palette.amberText;
          nextBg = palette.amberBg;
          nextBorder = palette.amberBorder;
          nextTag = 'Para Hoy';
        } else {
          nextColor = palette.emeraldText;
          nextBg = palette.emeraldBg;
          nextBorder = palette.emeraldBorder;
          nextTag = 'Próximo';
        }
      }

      return (
        <View
          style={[
            styles.leadCard,
            {
              backgroundColor: isDark ? palette.bgCard : '#ffffff',
              borderColor: lead.missingPeriodFollowUp
                ? (isDark ? palette.roseBorder : '#fca5a5')
                : lead.isOverdue
                ? (isDark ? palette.roseBorder : '#fca5a5')
                : (isDark ? palette.border : '#cbd5e1'),
              borderWidth: lead.missingPeriodFollowUp || lead.isOverdue ? 1.5 : 1,
            },
          ]}
        >
          {/* Row 1: Name + Stage Selector Pill */}
          <View style={styles.cardTopRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.leadName, { color: isDark ? '#ffffff' : '#0f172a' }]} numberOfLines={1}>
                {lead.name}
              </Text>
              <View style={styles.metaChipRow}>
                {lead.missingPeriodFollowUp && (
                  <View
                    style={[
                      styles.projectChip,
                      {
                        backgroundColor: isDark ? palette.roseBg : '#fee2e2',
                        borderColor: isDark ? palette.roseBorder : '#fca5a5',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.projectChipText,
                        { color: isDark ? palette.roseText : '#991b1b', fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      ⚠️ Falta seguimiento semana
                    </Text>
                  </View>
                )}

                <View
                  style={[
                    styles.projectChip,
                    {
                      backgroundColor: isDark ? palette.brandSoft : '#f1f5f9',
                      borderColor: isDark ? palette.brandBorder : '#cbd5e1',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.projectChipText,
                      { color: isDark ? palette.brandText : '#334155' },
                    ]}
                    numberOfLines={1}
                  >
                    {lead.project}
                  </Text>
                </View>

                {lead.status === 'lost' && (
                  <View
                    style={[
                      styles.projectChip,
                      {
                        backgroundColor: isDark ? palette.roseBg : '#fee2e2',
                        borderColor: isDark ? palette.roseBorder : '#fca5a5',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.projectChipText,
                        { color: isDark ? palette.roseText : '#991b1b' },
                      ]}
                      numberOfLines={1}
                    >
                      Cancelado
                    </Text>
                  </View>
                )}
                {lead.status === 'closed' && (
                  <View
                    style={[
                      styles.projectChip,
                      {
                        backgroundColor: isDark ? palette.emeraldBg : '#dcfce7',
                        borderColor: isDark ? palette.emeraldBorder : '#86efac',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.projectChipText,
                        { color: isDark ? palette.emeraldText : '#14532d' },
                      ]}
                      numberOfLines={1}
                    >
                      Venta 🎉
                    </Text>
                  </View>
                )}

                <Pressable
                  onPress={() => {
                    if (!isAdmin) return;
                    setFuenteDraft(lead.fuenteUbicacion || lead.source || '');
                    setFuenteEditLead(lead);
                  }}
                  style={[
                    styles.fuenteChip,
                    {
                      backgroundColor: isDark ? palette.bgSubtle : '#f8fafc',
                      borderColor: isDark ? palette.border : '#e2e8f0',
                    },
                  ]}
                >
                  <Icon name="MapPin" size={11} color={isDark ? palette.textMuted : '#64748b'} />
                  <Text
                    style={[
                      styles.fuenteChipText,
                      { color: isDark ? palette.textSecondary : '#475569' },
                    ]}
                    numberOfLines={1}
                  >
                    {lead.fuenteUbicacion || lead.source || 'Directo'}
                  </Text>
                  {isAdmin && <Icon name="Pencil" size={10} color={isDark ? palette.textMuted : '#64748b'} />}
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={() => setStageTargetLead(lead)}
              style={[
                styles.stagePill,
                {
                  backgroundColor: `${stageCfg.accentColor}18`,
                  borderColor: `${stageCfg.accentColor}55`,
                },
              ]}
            >
              <View style={[styles.stageDot, { backgroundColor: stageCfg.accentColor }]} />
              <Text style={[styles.stagePillText, { color: stageCfg.accentColor }]} numberOfLines={1}>
                {lead.pipelineStageLabel}
              </Text>
              <Icon name="ChevronDown" size={12} color={stageCfg.accentColor} />
            </Pressable>
          </View>

          {lead.missingPeriodFollowUp && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: isDark ? palette.roseBg : '#fef2f2',
                borderWidth: 1,
                borderColor: isDark ? palette.roseBorder : '#fecaca',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <Icon name="AlertCircle" size={14} color={isDark ? palette.roseText : '#dc2626'} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: isDark ? palette.roseText : '#991b1b',
                  }}
                  numberOfLines={1}
                >
                  FALTA SEGUIMIENTO EN LA SEMANA
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    color: isDark ? palette.textSecondary : '#7f1d1d',
                  }}
                  numberOfLines={1}
                >
                  Captado esta semana sin llamadas ni bitácoras comerciales registradas.
                </Text>
              </View>
            </View>
          )}

          {/* Row 2: Phone + Advisor */}
          <View style={[styles.phoneAdvisorRow, { borderColor: isDark ? palette.border : '#e2e8f0' }]}>
            <View style={styles.inlineInfo}>
              <Icon name="Phone" size={13} color={isDark ? palette.textMuted : '#64748b'} />
              <Text style={[styles.phoneText, { color: isDark ? palette.textSecondary : '#1e293b' }]} numberOfLines={1}>
                {lead.phone || 'Sin número registrado'}
              </Text>
            </View>

            {isAdmin ? (
              <Pressable
                onPress={() => setReassignTargetLead(lead)}
                style={[
                  styles.advisorPill,
                  {
                    backgroundColor: isDark ? palette.bgSubtle : '#f1f5f9',
                    borderColor: isDark ? palette.borderStrong : '#cbd5e1',
                  },
                ]}
              >
                <Icon name="User" size={12} color={isDark ? palette.brandText : '#78350f'} />
                <Text style={[styles.advisorPillText, { color: isDark ? palette.textPrimary : '#0f172a' }]} numberOfLines={1}>
                  {lead.advisorName}
                </Text>
                <Icon name="ChevronDown" size={11} color={isDark ? palette.textMuted : '#64748b'} />
              </Pressable>
            ) : (
              <View style={styles.inlineInfo}>
                <Icon name="User" size={12} color={isDark ? palette.textMuted : '#64748b'} />
                <Text style={[styles.advisorReadonly, { color: isDark ? palette.textMuted : '#475569' }]} numberOfLines={1}>
                  {lead.advisorName}
                </Text>
              </View>
            )}
          </View>

          {/* Row 3: Ficha Status & Bitácora Summary */}
          <View
            style={[
              styles.fichaBox,
              {
                backgroundColor: isDark ? palette.bgCardSoft : '#f8fafc',
                borderColor: isDark ? palette.border : '#e2e8f0',
              },
            ]}
          >
            <View style={styles.fichaHeaderRow}>
              <View
                style={[
                  styles.fichaStatusBadge,
                  {
                    backgroundColor: lead.hasFicha
                      ? (isDark ? palette.emeraldBg : '#dcfce7')
                      : (isDark ? palette.amberBg : '#fef3c7'),
                    borderColor: lead.hasFicha
                      ? (isDark ? palette.emeraldBorder : '#86efac')
                      : (isDark ? palette.amberBorder : '#fcd34d'),
                  },
                ]}
              >
                <Icon
                  name={lead.hasFicha ? 'Check' : 'AlertCircle'}
                  size={11}
                  color={lead.hasFicha ? (isDark ? palette.emeraldText : '#15803d') : (isDark ? palette.amberText : '#b45309')}
                />
                <Text
                  style={[
                    styles.fichaStatusText,
                    {
                      color: lead.hasFicha
                        ? (isDark ? palette.emeraldText : '#15803d')
                        : (isDark ? palette.amberText : '#b45309'),
                    },
                  ]}
                >
                  {lead.hasFicha ? 'Con Ficha' : 'Sin Ficha'}
                </Text>
              </View>

              {lead.lastFollowUpDate ? (
                <Text style={[styles.lastDateText, { color: isDark ? palette.textMuted : '#64748b' }]}>
                  Última: {lead.lastFollowUpDate}
                </Text>
              ) : (
                <Text style={[styles.lastDateText, { color: isDark ? palette.textSubtle : '#94a3b8' }]}>
                  Sin gestiones previas
                </Text>
              )}
            </View>

            {lead.lastFollowUpSummary ? (
              <Text
                style={[
                  styles.summaryText,
                  { color: isDark ? palette.textSecondary : '#334155' },
                ]}
                numberOfLines={isExpanded ? 10 : 2}
              >
                {lead.lastFollowUpSummary}
              </Text>
            ) : null}

            {lead.bitacorasCount > 0 && (
              <Pressable
                onPress={() => toggleExpandBitacoras(lead.id)}
                style={styles.expandBtn}
              >
                <Icon
                  name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                  size={13}
                  color={palette.brandText}
                />
                <Text style={[styles.expandBtnText, { color: palette.brandText }]}>
                  {isExpanded
                    ? 'Ocultar bitácoras'
                    : `Ver historial (${lead.bitacorasCount} gesti${lead.bitacorasCount === 1 ? 'ón' : 'ones'})`}
                </Text>
              </Pressable>
            )}

            {isExpanded && bitacorasList.length > 0 && (
              <View style={[styles.timelineWrap, { borderTopColor: palette.border }]}>
                {bitacorasList.slice(0, 8).map((b: any, idx: number) => (
                  <View key={`${lead.id}-bit-${idx}`} style={styles.timelineItem}>
                    <View style={[styles.timelineDot, { backgroundColor: palette.brand }]} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.timelineHeader}>
                        <Text style={[styles.timelineAction, { color: palette.textPrimary }]} numberOfLines={1}>
                          {b.action || 'Gestión comercial'}
                        </Text>
                        <Text style={[styles.timelineDate, { color: palette.textMuted }]}>
                          {String(b.fecha || b.lastDate || '').slice(0, 16)}
                        </Text>
                      </View>
                      {b.description ? (
                        <Text style={[styles.timelineDesc, { color: palette.textSecondary }]}>
                          {b.description}
                        </Text>
                      ) : null}
                      {b.asesor ? (
                        <Text style={[styles.timelineAuthor, { color: palette.textSubtle }]}>
                          Por: {b.asesor}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Row 4: Next Follow-Up Banner */}
          <View
            style={[
              styles.nextFollowRow,
              {
                backgroundColor: lead.isOverdue
                  ? (isDark ? palette.roseBg : '#fee2e2')
                  : lead.isToday
                  ? (isDark ? palette.amberBg : '#fef3c7')
                  : (isDark ? palette.bgCardSoft : '#f1f5f9'),
                borderColor: lead.isOverdue
                  ? (isDark ? palette.roseBorder : '#fca5a5')
                  : lead.isToday
                  ? (isDark ? palette.amberBorder : '#fcd34d')
                  : (isDark ? palette.border : '#cbd5e1'),
              },
            ]}
          >
            <Icon
              name={lead.isOverdue ? 'AlertTriangle' : 'Clock'}
              size={13}
              color={
                lead.isOverdue
                  ? (isDark ? palette.roseText : '#991b1b')
                  : lead.isToday
                  ? (isDark ? palette.amberText : '#92400e')
                  : (isDark ? palette.textPrimary : '#0f172a')
              }
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.nextFollowTitle,
                  {
                    color:
                      lead.isOverdue
                        ? (isDark ? palette.roseText : '#991b1b')
                        : lead.isToday
                        ? (isDark ? palette.amberText : '#92400e')
                        : (isDark ? palette.textPrimary : '#0f172a'),
                    fontWeight: '700',
                  },
                ]}
                numberOfLines={1}
              >
                {nextTag}
                {lead.nextFollowUpDate ? ` · ${lead.nextFollowUpDate}` : ''}
              </Text>
              {lead.nextFollowUpAction ? (
                <Text
                  style={[
                    styles.nextFollowSub,
                    { color: isDark ? palette.textSecondary : '#475569' },
                  ]}
                  numberOfLines={1}
                >
                  {lead.nextFollowUpAction}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Row 5: Mobile 4-Action Grid (High Contrast & Clear Colors) */}
          <View style={styles.actionsGrid}>
            {/* 1. No contestó */}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={quickBusyId === lead.id}
              onPress={() => handleQuickNoContesto(lead)}
              style={[
                styles.quickBtn,
                {
                  backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2',
                  borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : '#fca5a5',
                  opacity: quickBusyId === lead.id ? 0.6 : 1,
                },
              ]}
            >
              {quickBusyId === lead.id ? (
                <ActivityIndicator size="small" color={isDark ? '#f87171' : '#991b1b'} />
              ) : (
                <>
                  <Icon name="PhoneOff" size={14} color={isDark ? '#f87171' : '#991b1b'} />
                  <Text
                    style={[
                      styles.quickBtnText,
                      { color: isDark ? '#f87171' : '#991b1b' },
                    ]}
                    numberOfLines={1}
                  >
                    No contestó
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* 2. Chat CRM */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Chat', { leadId: lead.id })}
              style={[
                styles.quickBtn,
                {
                  backgroundColor: isDark ? 'rgba(14, 165, 233, 0.15)' : '#e0f2fe',
                  borderColor: isDark ? 'rgba(14, 165, 233, 0.35)' : '#7dd3fc',
                },
              ]}
            >
              <Icon name="MessageSquare" size={14} color={isDark ? '#38bdf8' : '#075985'} />
              <Text
                style={[
                  styles.quickBtnText,
                  { color: isDark ? '#38bdf8' : '#075985' },
                ]}
                numberOfLines={1}
              >
                Chat CRM
              </Text>
            </TouchableOpacity>

            {/* 3. Llamar */}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!digits}
              onPress={() => digits && Linking.openURL(`tel:${digits}`)}
              style={[
                styles.quickBtn,
                {
                  backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fef3c7',
                  borderColor: isDark ? 'rgba(245, 158, 11, 0.35)' : '#fcd34d',
                  opacity: !digits ? 0.4 : 1,
                },
              ]}
            >
              <Icon name="Phone" size={14} color={isDark ? '#fbbf24' : '#92400e'} />
              <Text
                style={[
                  styles.quickBtnText,
                  { color: isDark ? '#fbbf24' : '#92400e' },
                ]}
                numberOfLines={1}
              >
                Llamar
              </Text>
            </TouchableOpacity>

            {/* 4. WhatsApp Directo */}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!waDigits}
              onPress={() => waDigits && Linking.openURL(`https://wa.me/${waDigits}`)}
              style={[
                styles.quickBtn,
                {
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#dcfce7',
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.35)' : '#86efac',
                  opacity: !waDigits ? 0.4 : 1,
                },
              ]}
            >
              <Icon name="MessageCircle" size={14} color={isDark ? '#34d399' : '#14532d'} />
              <Text
                style={[
                  styles.quickBtnText,
                  { color: isDark ? '#34d399' : '#14532d' },
                ]}
                numberOfLines={1}
              >
                WhatsApp
              </Text>
            </TouchableOpacity>
          </View>

          {/* 5. Primary Full-Width CTA: Diligenciar / Actualizar Ficha Técnica (Vibrant Green matching iPhone) */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setFichaLead(lead)}
            style={[
              styles.fichaPrimaryBtn,
              {
                backgroundColor: '#059669',
                borderColor: '#10b981',
              },
            ]}
          >
            <Icon name="ClipboardList" size={16} color="#ffffff" />
            <Text style={styles.fichaPrimaryBtnText}>
              {lead.hasFicha || (lead.bitacorasCount ?? 0) > 0
                ? 'Actualizar Ficha Técnica'
                : 'Diligenciar Ficha Técnica'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    },
    [
      expandedLeadIds,
      palette,
      isDark,
      isAdmin,
      quickBusyId,
      toggleExpandBitacoras,
      handleQuickNoContesto,
      navigation,
    ]
  );

  // ── List Header for Fichas View (1:1 with Responsive Web Screenshot 2) ─────
  const kpiCards: Array<{
    key: CategoryFilter;
    label: string;
    sub: string;
    value: number;
    icon: LucideIconName;
    accent: string;
    softBg: string;
    border: string;
  }> = [
    {
      key: 'missing_followup',
      label: 'Falta Seguimiento',
      sub: 'Captados semana sin gestión',
      value: kpis.missingFollowUpCount || 0,
      icon: 'AlertCircle',
      accent: palette.roseText,
      softBg: palette.roseBg,
      border: palette.roseBorder,
    },
    {
      key: 'overdue',
      label: 'Vencidos / Urgentes',
      sub: 'Atención inmediata',
      value: kpis.overdueCount,
      icon: 'AlertTriangle',
      accent: palette.roseText,
      softBg: palette.roseBg,
      border: palette.roseBorder,
    },
    {
      key: 'today',
      label: 'Pendientes Hoy',
      sub: 'Agenda de hoy',
      value: kpis.todayCount,
      icon: 'Clock',
      accent: palette.amberText,
      softBg: palette.amberBg,
      border: palette.amberBorder,
    },
    {
      key: 'missing_ficha',
      label: 'Sin Ficha Técnica',
      sub: 'Falta registrar',
      value: kpis.missingFichaCount,
      icon: 'FileText',
      accent: palette.skyText,
      softBg: palette.skyBg,
      border: palette.skyBorder,
    },
    {
      key: 'upcoming',
      label: 'Próximos Días',
      sub: 'Agenda a futuro',
      value: kpis.upcomingCount,
      icon: 'Calendar',
      accent: isDark ? '#818cf8' : '#4f46e5',
      softBg: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(79, 70, 229, 0.10)',
      border: isDark ? 'rgba(99, 102, 241, 0.35)' : 'rgba(79, 70, 229, 0.30)',
    },
    {
      key: 'with_ficha',
      label:
        periodPreset === 'all'
          ? 'Total con Ficha'
          : periodPreset === 'today'
          ? 'Gestionados Hoy'
          : periodPreset === 'yesterday'
          ? 'Gestionados Ayer'
          : periodPreset === 'month'
          ? 'Gestionados Este Mes'
          : periodPreset === '30d'
          ? 'Gestionados (30 días)'
          : periodPreset === '7d'
          ? 'Gestionados (7 días)'
          : 'Gestionados Esta Semana',
      sub:
        periodPreset === 'all'
          ? 'Histórico completo'
          : periodPreset === 'today'
          ? 'Día de hoy'
          : periodPreset === 'yesterday'
          ? 'Día anterior'
          : periodPreset === 'month'
          ? 'Mes en curso'
          : periodPreset === '30d'
          ? 'Últimos 30 días'
          : periodPreset === '7d'
          ? 'Últimos 7 días'
          : 'Semana comercial',
      value: kpis.completedThisMonthCount,
      icon: 'CheckCircle2',
      accent: palette.emeraldText,
      softBg: palette.emeraldBg,
      border: palette.emeraldBorder,
    },
  ];

  const categoryPills: Array<{ id: CategoryFilter; label: string; count: number; icon?: LucideIconName }> = [
    { id: 'all', label: 'Todos', count: leads.filter((l) => l.status !== 'lost').length },
    { id: 'missing_followup', label: 'Falta Seguimiento', count: kpis.missingFollowUpCount || 0, icon: 'AlertCircle' },
    { id: 'overdue', label: 'Vencidos', count: kpis.overdueCount, icon: 'AlertTriangle' },
    { id: 'today', label: 'Para Hoy', count: kpis.todayCount, icon: 'Clock' },
    { id: 'missing_ficha', label: 'Falta Ficha', count: kpis.missingFichaCount, icon: 'FileText' },
    { id: 'upcoming', label: 'Próximos', count: kpis.upcomingCount, icon: 'Calendar' },
    {
      id: 'with_ficha',
      label: periodPreset === 'all' ? 'Con Ficha' : 'Con Gestión',
      count: kpis.completedThisMonthCount,
      icon: 'CheckCircle2',
    },
    { id: 'cancelled', label: 'Cancelados', count: kpis.cancelledCount || 0, icon: 'UserX' },
    { id: 'closed', label: 'Ventas', count: kpis.closedCount || 0, icon: 'Handshake' },
  ];

  const renderWebPageHeader = () => (
    <View style={styles.webPageHeaderWrap}>
      {/* Title & Subtitle Block */}
      <View style={styles.webTitleBlock}>
        <View
          style={[
            styles.webTitleIconBox,
            {
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              borderColor: 'rgba(16, 185, 129, 0.30)',
            },
          ]}
        >
          <Icon name="ClipboardList" size={20} color="#34d399" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.webPageTitle, { color: palette.textPrimary }]}>
            Gestión Comercial & Fichas Técnicas
          </Text>
          <Text style={[styles.webPageSubtitle, { color: palette.textMuted }]}>
            Seguimiento diario de prospectos, agenda de recordatorios y diligenciamiento de bitácoras.
          </Text>
        </View>
      </View>

      {/* Action Row 1: Advisor Selector + Solicitudes de Traslado */}
      <View style={styles.webActionRow}>
        {isAdmin ? (
          <SelectModal
            value={selectedAdvisor}
            options={advisorOptions}
            onChange={setSelectedAdvisor}
            prefixLabel="Asesor:"
            title="Seleccionar Cartera / Asesor"
            icon="UserCheck"
            searchable
            compact
            style={[
              styles.webAdvisorSelect,
              {
                backgroundColor: palette.bgCard,
                borderColor: palette.border,
              },
            ]}
          />
        ) : (
          <View
            style={[
              styles.lockedScopeChip,
              { flex: 1, backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Icon name="UserCheck" size={14} color={palette.brandText} />
            <Text style={[styles.lockedScopeText, { color: palette.textPrimary }]} numberOfLines={1}>
              Asesor: {profile?.displayName || 'Mi Cartera'}
            </Text>
          </View>
        )}

        {isAdmin && (
          <Pressable
            onPress={() => setTransfersOpen(true)}
            style={[
              styles.webTransferBtn,
              {
                backgroundColor: pendingTransfersCount > 0 ? palette.amberBg : palette.bgCard,
                borderColor: pendingTransfersCount > 0 ? palette.amberBorder : palette.border,
              },
            ]}
          >
            <Icon
              name="ArrowRightLeft"
              size={14}
              color={pendingTransfersCount > 0 ? palette.amberText : palette.textSecondary}
            />
            <Text
              style={[
                styles.webTransferBtnText,
                {
                  color: pendingTransfersCount > 0 ? palette.amberText : palette.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              Solicitudes de Traslado
            </Text>
            {pendingTransfersCount > 0 && (
              <View style={styles.transferCountDot}>
                <Text style={styles.transferCountDotText}>{pendingTransfersCount}</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>

      {/* Action Row 1.5: Period Selector */}
      <View style={styles.webActionRow}>
        <SelectModal
          value={periodPreset}
          options={PERIOD_OPTIONS}
          onChange={(v) => setPeriodPreset(v as PeriodPreset)}
          prefixLabel="Período:"
          title="Filtrar por Período de Tiempo"
          icon="Calendar"
          compact
          style={[
            styles.webPeriodSelect,
            {
              backgroundColor:
                periodPreset !== 'all' ? (isDark ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5') : palette.bgCard,
              borderColor:
                periodPreset !== 'all' ? (isDark ? 'rgba(16, 185, 129, 0.35)' : '#a7f3d0') : palette.border,
            },
          ]}
        />
        {periodPreset !== 'week' && (
          <Pressable
            onPress={() => setPeriodPreset('week')}
            style={[
              styles.clearPeriodBtn,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Icon name="RefreshCw" size={13} color={palette.textSecondary} />
            <Text style={[styles.clearPeriodText, { color: palette.textSecondary }]}>Esta semana</Text>
          </Pressable>
        )}
      </View>

      {/* Action Row 2: Modo Llamadas + Excel + IA Report + Refresh */}
      <View style={styles.webActionRow}>
        <Pressable
          onPress={() => {
            if (focusTargetLeads.length === 0) {
              Alert.alert('Sin prospectos', 'No hay prospectos en la lista actual para iniciar Modo Llamadas.');
              return;
            }
            setFocusModalOpen(true);
          }}
          style={[
            styles.webCallModeBtn,
            {
              backgroundColor: 'rgba(245, 158, 11, 0.14)',
              borderColor: 'rgba(245, 158, 11, 0.40)',
            },
          ]}
        >
          <Icon name="Sparkles" size={14} color="#fcd34d" />
          <Text style={styles.webCallModeBtnText}>Modo Llamadas</Text>
          <View style={styles.webCallModeCountPill}>
            <Text style={styles.webCallModeCountText}>{focusTargetLeads.length}</Text>
          </View>
        </Pressable>

        <Pressable
          disabled={exportingCsv}
          onPress={handleExportCsv}
          style={[
            styles.webSquareIconBtn,
            { backgroundColor: palette.bgCard, borderColor: palette.border },
          ]}
        >
          {exportingCsv ? (
            <ActivityIndicator size="small" color="#34d399" />
          ) : (
            <Icon name="FileSpreadsheet" size={16} color="#34d399" />
          )}
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('Reports')}
          style={[
            styles.webAiReportBtn,
            {
              backgroundColor: 'rgba(183, 135, 28, 0.15)',
              borderColor: 'rgba(183, 135, 28, 0.40)',
            },
          ]}
        >
          <Icon name="FileText" size={15} color="#D9B545" />
          <View style={styles.webAiSparklePill}>
            <Text style={styles.webAiSparkleText}>IA ✨</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => (activeView === 'fichas' ? loadData(true) : loadLeaderboard())}
          style={[
            styles.webSquareIconBtn,
            { backgroundColor: palette.bgCard, borderColor: palette.border },
          ]}
        >
          <Icon name="RefreshCw" size={15} color={palette.textSecondary} />
        </Pressable>
      </View>

      {/* Action Row 3: Full-Width + Nuevo Prospecto */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setNewLeadOpen(true)}
        style={[
          styles.newLeadFullBtn,
          {
            backgroundColor: '#059669',
            borderColor: '#10b981',
          },
        ]}
      >
        <Icon name="UserPlus" size={16} color="#ffffff" />
        <Text style={styles.newLeadFullBtnText}>+ Nuevo Prospecto</Text>
      </TouchableOpacity>

      {/* Subtle Divider */}
      <View style={[styles.webHeaderDivider, { backgroundColor: palette.border }]} />

      {/* Main View Switcher Tabs (1:1 with Screenshot 2) */}
      <View
        style={[
          styles.viewTabsWrap,
          {
            backgroundColor: isDark ? '#141417' : '#e2e8f0',
            borderColor: isDark ? '#27272a' : '#cbd5e1',
          },
        ]}
      >
        <Pressable
          onPress={() => setActiveView('fichas')}
          style={[
            styles.viewTabBtn,
            activeView === 'fichas'
              ? {
                  backgroundColor: '#059669',
                  borderColor: '#10b981',
                }
              : {
                  backgroundColor: 'transparent',
                  borderColor: 'transparent',
                },
          ]}
        >
          <Icon
            name="ClipboardList"
            size={13}
            color={activeView === 'fichas' ? '#ffffff' : (isDark ? '#a1a1aa' : '#475569')}
          />
          <Text
            style={[
              styles.viewTabText,
              {
                color: activeView === 'fichas' ? '#ffffff' : (isDark ? '#a1a1aa' : '#334155'),
                fontWeight: activeView === 'fichas' ? '800' : '600',
              },
            ]}
          >
            {'Gestión &\nFichas\nTécnicas'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveView('metas')}
          style={[
            styles.viewTabBtn,
            activeView === 'metas'
              ? {
                  backgroundColor: '#059669',
                  borderColor: '#10b981',
                }
              : {
                  backgroundColor: 'transparent',
                  borderColor: 'transparent',
                },
          ]}
        >
          <Icon
            name="Trophy"
            size={13}
            color={activeView === 'metas' ? '#ffffff' : (isDark ? '#a1a1aa' : '#475569')}
          />
          <Text
            style={[
              styles.viewTabText,
              {
                color: activeView === 'metas' ? '#ffffff' : (isDark ? '#a1a1aa' : '#334155'),
                fontWeight: activeView === 'metas' ? '800' : '600',
              },
            ]}
          >
            {'Ranking\n& Metas\ndel Mes'}
          </Text>
          <View
            style={[
              styles.nuevoTag,
              {
                backgroundColor: isDark ? 'rgba(245, 158, 11, 0.20)' : '#fef3c7',
                borderColor: isDark ? 'rgba(245, 158, 11, 0.35)' : '#fcd34d',
              },
            ]}
          >
            <Text style={[styles.nuevoTagText, { color: isDark ? '#fbbf24' : '#92400e' }]}>
              Nuevo
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('Reports')}
          style={[
            styles.viewTabBtn,
            {
              backgroundColor: 'transparent',
              borderColor: 'transparent',
            },
          ]}
        >
          <Icon
            name="FileText"
            size={13}
            color={isDark ? '#a1a1aa' : '#475569'}
          />
          <Text
            style={[
              styles.viewTabText,
              {
                color: isDark ? '#a1a1aa' : '#334155',
                fontWeight: '600',
              },
            ]}
          >
            {isAdmin ? 'Generar\nInforme\nGerencial' : 'Mi\nInforme\nComercial'}
          </Text>
          <View
            style={[
              styles.nuevoTag,
              {
                backgroundColor: isDark ? 'rgba(183, 135, 28, 0.20)' : '#fde68a',
                borderColor: isDark ? 'rgba(183, 135, 28, 0.38)' : '#fcd34d',
              },
            ]}
          >
            <Text style={[styles.nuevoTagText, { color: isDark ? '#D9B545' : '#92400e' }]}>
              IA ✨
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );

  const renderFichasHeader = () => (
    <View style={styles.listHeaderWrap}>
      {renderWebPageHeader()}

      {/* KPI Grid (2x3 Grid matching Screenshot 2 1:1) */}
      <View style={styles.kpiGrid}>
        {kpiCards.map((card) => {
          const selected = categoryFilter === card.key;
          return (
            <Pressable
              key={card.key}
              onPress={() => setCategoryFilter((prev) => (prev === card.key ? 'all' : card.key))}
              style={[
                styles.kpiCard,
                {
                  backgroundColor: selected
                    ? card.softBg
                    : isDark
                    ? 'rgba(24, 24, 27, 0.72)'
                    : palette.bgCard,
                  borderColor: selected ? card.accent : card.border,
                },
              ]}
            >
              <View style={styles.kpiTopRow}>
                <View style={[styles.kpiIconBox, { backgroundColor: card.softBg, borderColor: card.border }]}>
                  <Icon name={card.icon} size={17} color={card.accent} />
                </View>
                <View style={[styles.kpiBadgePill, { backgroundColor: card.softBg }]}>
                  <Text style={[styles.kpiValue, { color: card.accent }]}>{card.value}</Text>
                </View>
              </View>
              <Text style={[styles.kpiLabel, { color: palette.textPrimary }]} numberOfLines={1}>
                {card.label}
              </Text>
              <Text style={[styles.kpiSub, { color: palette.textMuted }]} numberOfLines={1}>
                {card.sub}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Smart Follow-Up Suggestions (1:1 with Screenshot 2) */}
      {suggestions.length === 0 ? (
        <View
          style={[
            styles.allClearCard,
            { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
          ]}
        >
          <Icon name="CheckCheck" size={18} color={palette.emeraldText} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.allClearTitle, { color: palette.emeraldText }]}>
              ¡Al día con la gestión comercial!
            </Text>
            <Text style={[styles.allClearSub, { color: palette.textSecondary }]}>
              No tienes seguimientos vencidos ni prospectos pendientes de primera ficha en esta vista.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.suggestionsBlock}>
          <View style={styles.sectionLabelRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Icon name="Lightbulb" size={15} color="#fbbf24" />
              <Text style={[styles.sectionLabelText, { color: palette.textSecondary }]}>
                SUGERENCIAS DE SEGUIMIENTO{'\n'}COMERCIAL
              </Text>
            </View>
            <Text style={[styles.sectionPriorityHint, { color: palette.textSubtle }]}>
              Priorizadas por{'\n'}urgencia
            </Text>
          </View>
          {suggestions.map((s) => {
            const targetCat: CategoryFilter =
              s.actionFilter === 'missing_followup'
                ? 'missing_followup'
                : s.actionFilter === 'urgent'
                ? 'overdue'
                : s.actionFilter === 'today'
                ? 'today'
                : 'missing_ficha';
            const toneColor =
              s.type === 'missing_followup' || s.type === 'urgent'
                ? palette.roseText
                : s.type === 'today'
                ? palette.amberText
                : palette.skyText;
            const toneBg =
              s.type === 'missing_followup' || s.type === 'urgent'
                ? palette.roseBg
                : s.type === 'today'
                ? palette.amberBg
                : palette.skyBg;
            const toneBorder =
              s.type === 'missing_followup' || s.type === 'urgent'
                ? palette.roseBorder
                : s.type === 'today'
                ? palette.amberBorder
                : palette.skyBorder;
            const suggestionIcon: LucideIconName =
              s.type === 'missing_followup'
                ? 'AlertCircle'
                : s.type === 'urgent'
                ? 'AlertTriangle'
                : s.type === 'today'
                ? 'Clock'
                : 'FileText';

            return (
              <View
                key={s.id}
                style={[
                  styles.suggestionCard,
                  {
                    backgroundColor: isDark ? 'rgba(24, 24, 27, 0.72)' : palette.bgCard,
                    borderColor: toneBorder,
                  },
                ]}
              >
                <View style={styles.suggestionTopRow}>
                  <View
                    style={[
                      styles.suggestionIconBox,
                      { backgroundColor: toneBg, borderColor: toneBorder },
                    ]}
                  >
                    <Icon name={suggestionIcon} size={15} color={toneColor} />
                  </View>
                  <Text style={[styles.suggestionTitle, { color: toneColor, flex: 1 }]}>
                    {s.title}
                  </Text>
                </View>

                <Text style={[styles.suggestionDesc, { color: palette.textMuted }]}>
                  {s.description}
                </Text>

                <Pressable
                  onPress={() => setCategoryFilter(targetCat)}
                  style={[
                    styles.suggestionCtaBtn,
                    {
                      backgroundColor: isDark ? 'rgba(39, 39, 42, 0.85)' : palette.bgElevated,
                      borderColor: isDark ? 'rgba(63, 63, 70, 0.65)' : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.suggestionCtaText, { color: palette.textPrimary }]}>
                    Ver estos casos ({s.count}) →
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* Horizontal Category Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
      >
        {categoryPills.map((pill) => {
          const active = categoryFilter === pill.id;
          return (
            <Pressable
              key={pill.id}
              onPress={() => setCategoryFilter(pill.id)}
              style={[
                styles.catPill,
                {
                  backgroundColor: active
                    ? (isDark ? palette.brandSoft : '#fef3c7')
                    : (isDark ? palette.bgCard : '#ffffff'),
                  borderColor: active
                    ? palette.brand
                    : (isDark ? palette.border : '#cbd5e1'),
                },
              ]}
            >
              {pill.icon && (
                <Icon
                  name={pill.icon}
                  size={13}
                  color={
                    active
                      ? (isDark ? palette.brandText : '#78350f')
                      : (isDark ? palette.textMuted : '#64748b')
                  }
                />
              )}
              <Text
                style={[
                  styles.catPillText,
                  {
                    color: active
                      ? (isDark ? palette.brandText : '#78350f')
                      : (isDark ? palette.textSecondary : '#334155'),
                    fontWeight: active ? '700' : '600',
                  },
                ]}
              >
                {pill.label}
              </Text>
              <View
                style={[
                  styles.catCountBubble,
                  {
                    backgroundColor: active
                      ? palette.brand
                      : (isDark ? palette.bgSubtle : '#e2e8f0'),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.catCountText,
                    {
                      color: active
                        ? '#ffffff'
                        : (isDark ? palette.textMuted : '#475569'),
                    },
                  ]}
                >
                  {pill.count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Search Input */}
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: isDark ? palette.bgInput : '#ffffff',
            borderColor: isDark ? palette.borderInput : '#cbd5e1',
          },
        ]}
      >
        <Icon name="Search" size={16} color={isDark ? palette.textMuted : '#64748b'} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar por nombre, celular o proyecto en toda la base..."
          placeholderTextColor={isDark ? palette.placeholder : '#64748b'}
          style={[styles.searchInput, { color: isDark ? palette.textPrimary : '#0f172a' }]}
          returnKeyType="search"
        />
        {isSearchingServer && <ActivityIndicator size="small" color={palette.brand} />}
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <Icon name="X" size={16} color={isDark ? palette.textMuted : '#64748b'} />
          </Pressable>
        )}
      </View>

      {/* Filter Row: Project, Stage, Sort (2-Row Responsive Layout matching iPhone) */}
      <View style={styles.filtersContainer}>
        <View style={styles.filtersTwoCol}>
          <SelectModal
            value={projectFilter}
            options={projectOptions}
            onChange={setProjectFilter}
            title="Filtrar por Proyecto"
            icon="Building2"
            compact
            style={{ flex: 1 }}
          />
          <SelectModal
            value={stageFilter}
            options={stageOptions}
            onChange={setStageFilter}
            title="Filtrar por Etapa"
            icon="Layers"
            searchable
            compact
            style={{ flex: 1 }}
          />
        </View>
        <SelectModal
          value={sortBy}
          options={sortOptions}
          onChange={(v) => setSortBy(v as SortOption)}
          title="Ordenar Prospectos"
          icon="Sliders"
          compact
          style={{ width: '100%' }}
        />
      </View>

      {/* Results Count & Clear Filters */}
      <View style={styles.resultsMetaRow}>
        <Text style={[styles.resultsMetaText, { color: palette.textMuted }]}>
          {searchQuery.trim()
            ? `${filteredLeads.length} resultado${filteredLeads.length === 1 ? '' : 's'} en toda la base`
            : `Mostrando ${filteredLeads.length} de ${leads.length} prospectos cargados`}
        </Text>
        {hasActiveFilters && (
          <Pressable onPress={resetFilters}>
            <Text style={[styles.clearFiltersLink, { color: palette.brandText }]}>Limpiar filtros</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  // ── Render Ranking & Metas View ────────────────────────────────────────────
  const renderLeaderboardView = () => {
    const isCurrentMonth = monthKey >= getCurrentMonthKey();
    const totals = leaderboardData?.companyTotals;
    const allItems = leaderboardData?.leaderboard || [];
    const displayedItems =
      leaderboardScope === 'mine' && currentUserId
        ? allItems.filter((a) => a.advisorId === currentUserId)
        : allItems;
    const top3 = allItems.slice(0, 3);

    return (
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: Math.max(insets.top + 8, 16),
          paddingBottom: Math.max(insets.bottom + 24, 36),
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loadingLeaderboard}
            onRefresh={loadLeaderboard}
            tintColor={palette.brand}
          />
        }
      >
        {renderWebPageHeader()}

        {/* Month Selector & Actions */}
        <View
          style={[
            styles.monthBar,
            { backgroundColor: palette.bgCard, borderColor: palette.border },
          ]}
        >
          <View style={styles.monthNavGroup}>
            <Pressable
              onPress={() => setMonthKey((m) => shiftMonthKey(m, -1))}
              style={[styles.iconSquareBtn, { backgroundColor: palette.bgSubtle, borderColor: palette.border }]}
            >
              <Icon name="ChevronLeft" size={16} color={palette.textPrimary} />
            </Pressable>
            <View style={{ alignItems: 'center', minWidth: 130 }}>
              <Text style={[styles.monthLabelText, { color: palette.textPrimary }]}>
                {leaderboardData?.monthLabel || monthKey}
              </Text>
              <Text style={[styles.monthSubText, { color: palette.textMuted }]}>
                Cumplimiento global: {Math.round(totals?.overallCompletionPct || 0)}%
              </Text>
            </View>
            <Pressable
              disabled={isCurrentMonth}
              onPress={() => !isCurrentMonth && setMonthKey((m) => shiftMonthKey(m, 1))}
              style={[
                styles.iconSquareBtn,
                {
                  backgroundColor: palette.bgSubtle,
                  borderColor: palette.border,
                  opacity: isCurrentMonth ? 0.35 : 1,
                },
              ]}
            >
              <Icon name="ChevronRight" size={16} color={palette.textPrimary} />
            </Pressable>
          </View>

          {isAdmin && (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setGoalsModalOpen(true)}
              icon={<Icon name="Settings" size={14} color={palette.brandText} />}
            >
              Metas
            </Button>
          )}
        </View>

        {loadingLeaderboard && !leaderboardData ? (
          <LoadingView label="Calculando ranking y metas del mes..." />
        ) : !leaderboardData ? (
          <EmptyState
            title="Sin datos de ranking"
            subtitle="No se encontraron métricas comerciales para este período."
          />
        ) : (
          <>
            {/* 4 Global Team Goal Cards */}
            <View style={styles.goalCardsGrid}>
              {[
                {
                  label: 'Ventas / Lotes',
                  actual: totals?.totalVentas || 0,
                  target: totals?.targetVentas || 0,
                  color: palette.emerald,
                },
                {
                  label: 'Visitas Terreno',
                  actual: totals?.totalVisitas || 0,
                  target: totals?.targetVisitas || 0,
                  color: palette.brand,
                },
                {
                  label: 'Citas Virtuales',
                  actual: totals?.totalCitas || 0,
                  target: totals?.targetCitas || 0,
                  color: palette.sky,
                },
                {
                  label: 'Gestiones Hechas',
                  actual: totals?.totalGestiones || 0,
                  target: totals?.targetGestiones || 0,
                  color: palette.amber,
                },
              ].map((g) => {
                const pct = g.target > 0 ? Math.min(100, Math.round((g.actual / g.target) * 100)) : 0;
                return (
                  <View
                    key={g.label}
                    style={[
                      styles.goalMetricCard,
                      { backgroundColor: palette.bgCard, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.goalMetricLabel, { color: palette.textMuted }]} numberOfLines={1}>
                      {g.label}
                    </Text>
                    <View style={styles.goalMetricNums}>
                      <Text style={[styles.goalActualText, { color: palette.textPrimary }]}>{g.actual}</Text>
                      <Text style={[styles.goalTargetText, { color: palette.textMuted }]}>
                        / {g.target} ({pct}%)
                      </Text>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: palette.bgSubtle }]}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${pct}%`, backgroundColor: g.color },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Podio de Honor del Mes */}
            {top3.length > 0 && (
              <View
                style={[
                  styles.podiumContainer,
                  { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
                ]}
              >
                <View style={styles.sectionLabelRow}>
                  <Icon name="Trophy" size={16} color={palette.brandText} />
                  <Text style={[styles.podiumHeaderTitle, { color: palette.textPrimary }]}>
                    Podio de Honor del Mes
                  </Text>
                </View>

                <View style={{ gap: 10, marginTop: 8 }}>
                  {top3.map((adv, idx) => {
                    const medal =
                      idx === 0 ? '👑 Líder Comercial' : idx === 1 ? '🥈 2° Lugar' : '🥉 3° Lugar';
                    const highlightBorder = idx === 0 ? palette.brand : palette.border;
                    const highlightBg = idx === 0 ? palette.brandSoft : palette.bgCardSoft;
                    return (
                      <View
                        key={adv.advisorId}
                        style={[
                          styles.podiumItem,
                          { backgroundColor: highlightBg, borderColor: highlightBorder },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.podiumMedal, { color: palette.brandText }]}>{medal}</Text>
                          <Text style={[styles.podiumName, { color: palette.textPrimary }]} numberOfLines={1}>
                            {adv.advisorName}
                          </Text>
                          <Text style={[styles.podiumStats, { color: palette.textSecondary }]}>
                            {adv.actuals.ventas} Ventas · {adv.actuals.visitas} Visitas · {adv.actuals.citas} Citas
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[styles.podiumPts, { color: palette.brandText }]}>{adv.score} pts</Text>
                          <Text style={[styles.podiumPct, { color: palette.emeraldText }]}>
                            {Math.round(adv.percentages.averageCompletionPct)}% meta
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Scope Toggle + Individual Breakdown */}
            <View style={styles.scopeHeaderRow}>
              <Text style={[styles.podiumHeaderTitle, { color: palette.textPrimary }]}>
                Desglose por Asesor
              </Text>
              <View
                style={[
                  styles.scopeToggleWrap,
                  { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                ]}
              >
                <Pressable
                  onPress={() => setLeaderboardScope('all')}
                  style={[
                    styles.scopeBtn,
                    leaderboardScope === 'all' && { backgroundColor: palette.bgCard },
                  ]}
                >
                  <Text
                    style={[
                      styles.scopeBtnText,
                      {
                        color:
                          leaderboardScope === 'all' ? palette.textPrimary : palette.textMuted,
                      },
                    ]}
                  >
                    Todo el Equipo
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setLeaderboardScope('mine')}
                  style={[
                    styles.scopeBtn,
                    leaderboardScope === 'mine' && { backgroundColor: palette.bgCard },
                  ]}
                >
                  <Text
                    style={[
                      styles.scopeBtnText,
                      {
                        color:
                          leaderboardScope === 'mine' ? palette.textPrimary : palette.textMuted,
                      },
                    ]}
                  >
                    Mi Rendimiento
                  </Text>
                </Pressable>
              </View>
            </View>

            {displayedItems.length === 0 ? (
              <EmptyState
                title="Sin métricas individuales"
                subtitle="No se encontró tu usuario en la tabla de asesores de este mes."
              />
            ) : (
              displayedItems.map((adv: AdvisorLeaderboardItem) => {
                const isMe = adv.advisorId === currentUserId;
                return (
                  <View
                    key={adv.advisorId}
                    style={[
                      styles.advisorRankCard,
                      {
                        backgroundColor: palette.bgCard,
                        borderColor: isMe ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.advisorRankTop}>
                      <View
                        style={[
                          styles.rankBadge,
                          {
                            backgroundColor:
                              adv.rank <= 3 ? palette.brandSoft : palette.bgSubtle,
                            borderColor: adv.rank <= 3 ? palette.brandBorder : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.rankBadgeText,
                            { color: adv.rank <= 3 ? palette.brandText : palette.textSecondary },
                          ]}
                        >
                          #{adv.rank}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.advisorRankName, { color: palette.textPrimary }]} numberOfLines={1}>
                            {adv.advisorName}
                          </Text>
                          {isMe && (
                            <View style={[styles.meTag, { backgroundColor: palette.brandSoft }]}>
                              <Text style={[styles.meTagText, { color: palette.brandText }]}>Tú</Text>
                            </View>
                          )}
                        </View>
                        {adv.badges?.length > 0 && (
                          <View style={styles.badgesWrap}>
                            {adv.badges.map((b, i) => (
                              <View
                                key={`${adv.advisorId}-b-${i}`}
                                style={[
                                  styles.achievementPill,
                                  { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                                ]}
                              >
                                <Text style={[styles.achievementText, { color: palette.amberText }]}>
                                  {b}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.podiumPts, { color: palette.brandText }]}>{adv.score} pts</Text>
                        <Text style={[styles.monthSubText, { color: palette.textMuted }]}>
                          {Math.round(adv.percentages.averageCompletionPct)}% global
                        </Text>
                      </View>
                    </View>

                    <View style={styles.advisorBarsGrid}>
                      {[
                        {
                          label: 'Ventas',
                          val: `${adv.actuals.ventas}/${adv.targets.ventasTarget}`,
                          pct: adv.percentages.ventasPct,
                          color: palette.emerald,
                        },
                        {
                          label: 'Visitas',
                          val: `${adv.actuals.visitas}/${adv.targets.visitasTarget}`,
                          pct: adv.percentages.visitasPct,
                          color: palette.brand,
                        },
                        {
                          label: 'Citas',
                          val: `${adv.actuals.citas}/${adv.targets.citasTarget}`,
                          pct: adv.percentages.citasPct,
                          color: palette.sky,
                        },
                        {
                          label: 'Gestiones',
                          val: `${adv.actuals.gestiones}/${adv.targets.gestionesTarget}`,
                          pct: adv.percentages.gestionesPct,
                          color: palette.amber,
                        },
                      ].map((m) => (
                        <View key={m.label} style={styles.miniMetricBox}>
                          <View style={styles.miniMetricRow}>
                            <Text style={[styles.miniMetricLabel, { color: palette.textMuted }]}>{m.label}</Text>
                            <Text style={[styles.miniMetricVal, { color: palette.textPrimary }]}>{m.val}</Text>
                          </View>
                          <View style={[styles.progressTrackSm, { backgroundColor: palette.bgSubtle }]}>
                            <View
                              style={[
                                styles.progressFillSm,
                                {
                                  width: `${Math.min(100, Math.max(0, m.pct))}%`,
                                  backgroundColor: m.color,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.bgBody }]}>
      {toastBanner && (
        <View
          style={[
            styles.toastBanner,
            {
              backgroundColor: palette.emeraldBg,
              borderColor: palette.emeraldBorder,
              marginTop: Math.max(insets.top + 6, 12),
            },
          ]}
        >
          <Icon name="Check" size={14} color={palette.emeraldText} />
          <Text style={[styles.toastText, { color: palette.emeraldText }]} numberOfLines={2}>
            {toastBanner}
          </Text>
        </View>
      )}

      {/* Main Content Area (Entire screen scrolls smoothly matching Responsive Web 1:1) */}
      {activeView === 'metas' ? (
        renderLeaderboardView()
      ) : loading ? (
        <View style={{ flex: 1, paddingTop: Math.max(insets.top + 8, 16), paddingHorizontal: 14 }}>
          {renderWebPageHeader()}
          <LoadingView label="Cargando gestión comercial..." />
        </View>
      ) : (
        <FlatList
          data={filteredLeads}
          keyExtractor={(item) => item.id}
          renderItem={renderLeadCard}
          ListHeaderComponent={renderFichasHeader()}
          ListEmptyComponent={
            <EmptyState
              title="No se encontraron prospectos"
              subtitle={
                hasActiveFilters
                  ? 'Prueba ajustando o limpiando los filtros activos.'
                  : 'Aún no hay prospectos asignados en esta cartera.'
              }
            />
          }
          ListFooterComponent={
            hasMore && !searchQuery.trim() ? (
              <View style={{ paddingVertical: 14 }}>
                <Button
                  variant="secondary"
                  fullWidth
                  loading={loadingMore}
                  onPress={handleLoadMore}
                  icon={<Icon name="Plus" size={15} color={palette.textPrimary} />}
                >
                  Cargar 40 prospectos más (+40)
                </Button>
              </View>
            ) : (
              <View style={{ height: 16 }} />
            )
          }
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: Math.max(insets.top + 8, 16),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadData(false);
              }}
              tintColor={palette.brand}
            />
          }
        />
      )}

      {/* Stage Change Modal */}
      <Modal
        visible={!!stageTargetLead}
        transparent
        animationType="slide"
        onRequestClose={() => setStageTargetLead(null)}
      >
        <Pressable style={[styles.modalBackdrop, { backgroundColor: palette.backdrop }]} onPress={() => setStageTargetLead(null)}>
          <Pressable
            style={[
              styles.sheetCard,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 14, 20),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Cambiar Etapa del Embudo</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {stageTargetLead?.name}
                </Text>
              </View>
              <Pressable onPress={() => setStageTargetLead(null)} hitSlop={10}>
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {PIPELINE_STAGES.map((st) => {
                const selected = stageTargetLead?.pipelineStage === st.id;
                return (
                  <Pressable
                    key={st.id}
                    onPress={() => stageTargetLead && handleStageChange(stageTargetLead, st.id)}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: selected ? palette.brandSoft : 'transparent',
                        borderBottomColor: palette.border,
                      },
                    ]}
                  >
                    <View style={[styles.stageDot, { backgroundColor: st.accentColor }]} />
                    <Text style={[styles.optionLabel, { color: palette.textPrimary, flex: 1 }]}>
                      {st.label}
                    </Text>
                    <Text style={[styles.optionMeta, { color: palette.textMuted }]}>{st.probabilityLabel}</Text>
                    {selected && <Icon name="Check" size={16} color={palette.brandText} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reassign Advisor Modal (Admin) */}
      <Modal
        visible={!!reassignTargetLead}
        transparent
        animationType="slide"
        onRequestClose={() => setReassignTargetLead(null)}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: palette.backdrop }]}
          onPress={() => setReassignTargetLead(null)}
        >
          <Pressable
            style={[
              styles.sheetCard,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 14, 20),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Reasignar Asesor</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {reassignTargetLead?.name}
                </Text>
              </View>
              <Pressable onPress={() => setReassignTargetLead(null)} hitSlop={10}>
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              <Pressable
                onPress={() => reassignTargetLead && handleReassignAdvisor(reassignTargetLead, '')}
                style={[styles.optionRow, { borderBottomColor: palette.border }]}
              >
                <Icon name="User" size={15} color={palette.textMuted} />
                <Text style={[styles.optionLabel, { color: palette.textSecondary, flex: 1 }]}>Sin asignar</Text>
              </Pressable>
              {(advisorsSimple.length > 0
                ? advisorsSimple
                : fullAdvisors.map((a) => ({ id: a.id, name: a.displayName || a.email }))
              ).map((adv) => {
                const selected = reassignTargetLead?.advisorId === adv.id;
                return (
                  <Pressable
                    key={adv.id}
                    onPress={() => reassignTargetLead && handleReassignAdvisor(reassignTargetLead, adv.id)}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: selected ? palette.brandSoft : 'transparent',
                        borderBottomColor: palette.border,
                      },
                    ]}
                  >
                    <Icon name="User" size={15} color={selected ? palette.brandText : palette.textMuted} />
                    <Text style={[styles.optionLabel, { color: palette.textPrimary, flex: 1 }]}>{adv.name}</Text>
                    {selected && <Icon name="Check" size={16} color={palette.brandText} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit Fuente / Ubicación Modal (Admin) */}
      <Modal
        visible={!!fuenteEditLead}
        transparent
        animationType="fade"
        onRequestClose={() => setFuenteEditLead(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.modalBackdrop, { backgroundColor: palette.backdrop, justifyContent: 'center', padding: 18 }]}
        >
          <View
            style={[
              styles.dialogCard,
              { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Editar Fuente / Ubicación</Text>
            <Text style={[styles.sheetSubtitle, { color: palette.textMuted, marginBottom: 12 }]}>
              Prospecto: {fuenteEditLead?.name}
            </Text>
            <TextInput
              value={fuenteDraft}
              onChangeText={setFuenteDraft}
              placeholder="Ej. Pauta Meta, Trabajo de campo, Referido..."
              placeholderTextColor={palette.placeholder}
              style={[
                styles.textField,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderInput,
                  color: palette.textPrimary,
                },
              ]}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Button variant="ghost" size="sm" onPress={() => setFuenteEditLead(null)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" loading={savingFuente} onPress={handleSaveFuenteUbicacion}>
                Guardar
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Ficha Técnica Modal */}
      {companyId ? (
        <FichaTecnicaModal
          isOpen={!!fichaLead}
          onClose={() => setFichaLead(null)}
          onSuccess={() => {
            setFichaLead(null);
            loadData(false);
          }}
          companyId={companyId}
          lead={
            fichaLead
              ? {
                  id: fichaLead.id,
                  name: fichaLead.name,
                  phone: fichaLead.phone,
                  project: fichaLead.project,
                  advisorName: fichaLead.advisorName,
                  bitacoras: fichaLead.bitacoras,
                  metadata: fichaLead.metadata,
                }
              : undefined
          }
        />
      ) : null}

      {/* New Lead Modal */}
      {companyId ? (
        <NewLeadModal
          isOpen={newLeadOpen}
          onClose={() => setNewLeadOpen(false)}
          companyId={companyId}
          advisors={fullAdvisors}
          onCreated={(_leadId, existed) => {
            setNewLeadOpen(false);
            showToast(existed ? 'El prospecto ya existía en la base.' : 'Nuevo prospecto creado con éxito.');
            loadData(false);
          }}
        />
      ) : null}

      {/* Transfer Requests Modal */}
      {companyId ? (
        <TransferRequestsModal
          isOpen={transfersOpen}
          onClose={() => setTransfersOpen(false)}
          companyId={companyId}
          onResolved={() => {
            loadPendingTransfers();
            loadData(false);
          }}
        />
      ) : null}

      {/* Modo Llamadas (CommercialFocusSessionModal) */}
      {companyId && focusModalOpen ? (
        <FocusSessionModal
          visible={focusModalOpen}
          companyId={companyId}
          authorName={authorName}
          leads={focusTargetLeads}
          onClose={() => {
            setFocusModalOpen(false);
            loadData(false);
          }}
        />
      ) : null}

      {/* Configurar Metas Modal (Admin) */}
      {companyId && goalsModalOpen && leaderboardData ? (
        <GoalsConfigModal
          visible={goalsModalOpen}
          companyId={companyId}
          defaultGoals={leaderboardData.defaultGoals}
          advisorGoals={leaderboardData.advisorGoals || {}}
          advisors={leaderboardData.leaderboard}
          onClose={() => setGoalsModalOpen(false)}
          onSaved={() => {
            setGoalsModalOpen(false);
            showToast('Metas comerciales actualizadas.');
            loadLeaderboard();
          }}
        />
      ) : null}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-MODAL 1: Modo Llamadas (1:1 con CommercialFocusSessionModal.tsx)
// ══════════════════════════════════════════════════════════════════════════════
function FocusSessionModal({
  visible,
  companyId,
  authorName,
  leads,
  onClose,
}: {
  visible: boolean;
  companyId: string;
  authorName: string;
  leads: CommercialLeadItem[];
  onClose: () => void;
}) {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [index, setIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [selectedResultId, setSelectedResultId] = useState(FOCUS_ACTION_RESULTS[0].id);
  const [notes, setNotes] = useState('');
  const [nextDate, setNextDate] = useState(() => addDaysISO(2));
  const [nextTime, setNextTime] = useState('10:00');
  const [saving, setSaving] = useState(false);

  const total = leads.length;
  const finished = index >= total;
  const current = !finished ? leads[index] : null;
  const selectedOpt =
    FOCUS_ACTION_RESULTS.find((r) => r.id === selectedResultId) || FOCUS_ACTION_RESULTS[0];

  const resetFormAndAdvance = () => {
    setNotes('');
    setSelectedResultId(FOCUS_ACTION_RESULTS[0].id);
    setNextDate(addDaysISO(2));
    setNextTime('10:00');
    setIndex((prev) => prev + 1);
  };

  const handleQuickNoAnswer = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      await registerQuickNoContesto(companyId, current, authorName);
      setCompletedCount((c) => c + 1);
      resetFormAndAdvance();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo registrar el intento.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndNext = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      const isNoInterested = selectedOpt.id === 'no_interesado';
      const nextDateCombined =
        !isNoInterested && nextDate.trim() ? `${nextDate.trim()}T${nextTime.trim() || '10:00'}:00` : undefined;

      await reportAppointmentFicha(companyId, {
        leadId: current.id,
        actionType: selectedOpt.actionType,
        result: selectedOpt.result,
        attended: true,
        nextAction: selectedOpt.defaultNextAction,
        nextActionDate: nextDateCombined,
        notes: notes.trim() || `${selectedOpt.label} registrado en Modo Llamadas por ${authorName}.`,
        pipelineStage: isNoInterested ? 'no_interesado_otra' : undefined,
      });
      setCompletedCount((c) => c + 1);
      resetFormAndAdvance();
    } catch (err: any) {
      Alert.alert('Error al guardar gestión', err?.message || 'Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  const progressPct = total > 0 ? Math.min(100, Math.round((index / total) * 100)) : 100;
  const digits = current ? cleanPhoneDigits(current.phone) : '';
  const waDigits = current ? formatWaPhone(current.phone) : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: palette.bgBody }]}
      >
        <View
          style={[
            styles.focusHeader,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View style={styles.focusHeaderTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="PhoneCall" size={18} color={palette.emeraldText} />
              <View>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Modo Llamadas</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  {finished ? 'Sesión finalizada' : `Prospecto ${index + 1} de ${total}`}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="X" size={22} color={palette.textMuted} />
            </Pressable>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: palette.bgSubtle, marginTop: 10 }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${finished ? 100 : progressPct}%`, backgroundColor: palette.emerald },
              ]}
            />
          </View>
        </View>

        {finished || !current ? (
          <View style={styles.focusDoneWrap}>
            <View
              style={[
                styles.doneTrophyCircle,
                { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
              ]}
            >
              <Icon name="Trophy" size={38} color={palette.emeraldText} />
            </View>
            <Text style={[styles.doneTitle, { color: palette.textPrimary }]}>
              ¡Sesión de Llamadas Completada!
            </Text>
            <Text style={[styles.doneSub, { color: palette.textSecondary }]}>
              Registraste {completedCount} gesti{completedCount === 1 ? 'ón' : 'ones'} efectivas de {total} prospectos en cola.
            </Text>
            <Button variant="primary" size="lg" onPress={onClose} style={{ marginTop: 18 }}>
              Cerrar y Actualizar Tabla
            </Button>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              paddingBottom: Math.max(insets.bottom + 24, 36),
              gap: 14,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Current Lead Card */}
            <View
              style={[
                styles.leadCard,
                { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
              ]}
            >
              <Text style={[styles.focusLeadName, { color: palette.textPrimary }]}>{current.name}</Text>
              <Text style={[styles.focusLeadPhone, { color: palette.brandText }]}>{current.phone}</Text>
              <View style={[styles.metaChipRow, { marginTop: 8 }]}>
                <View
                  style={[
                    styles.projectChip,
                    { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                  ]}
                >
                  <Text style={[styles.projectChipText, { color: palette.brandText }]}>{current.project}</Text>
                </View>
                <View
                  style={[
                    styles.projectChip,
                    { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.projectChipText, { color: palette.textSecondary }]}>
                    {current.pipelineStageLabel}
                  </Text>
                </View>
              </View>

              {current.nextFollowUpAction || current.lastFollowUpSummary ? (
                <Text style={[styles.summaryText, { color: palette.textSecondary, marginTop: 8 }]}>
                  {current.nextFollowUpAction || current.lastFollowUpSummary}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Button
                  variant="primary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={!digits}
                  onPress={() => digits && Linking.openURL(`tel:${digits}`)}
                  icon={<Icon name="Phone" size={15} color={isDark ? '#09090b' : '#ffffff'} />}
                >
                  Llamar Ahora
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={!waDigits}
                  onPress={() => waDigits && Linking.openURL(`https://wa.me/${waDigits}`)}
                  icon={<Icon name="ExternalLink" size={15} color={palette.emerald} />}
                >
                  WhatsApp
                </Button>
              </View>

              <Pressable
                disabled={saving}
                onPress={handleQuickNoAnswer}
                style={[
                  styles.noAnswerFullBtn,
                  { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                ]}
              >
                <Icon name="PhoneOff" size={14} color={palette.amberText} />
                <Text style={[styles.quickBtnText, { color: palette.amberText }]}>
                  No Contestó (Reprogramar automático +3h)
                </Text>
              </Pressable>
            </View>

            {/* Result Options */}
            <View
              style={[
                styles.leadCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.formSectionTitle, { color: palette.textPrimary }]}>
                Resultado de la Llamada
              </Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                {FOCUS_ACTION_RESULTS.map((opt) => {
                  const active = selectedResultId === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setSelectedResultId(opt.id)}
                      style={[
                        styles.resultRadioRow,
                        {
                          backgroundColor: active ? palette.brandSoft : palette.bgSubtle,
                          borderColor: active ? palette.brand : palette.border,
                        },
                      ]}
                    >
                      <Icon
                        name={active ? 'Check' : 'ChevronRight'}
                        size={14}
                        color={active ? palette.brandText : palette.textMuted}
                      />
                      <Text
                        style={[
                          styles.resultRadioLabel,
                          { color: active ? palette.textPrimary : palette.textSecondary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.formSectionTitle, { color: palette.textPrimary, marginTop: 14 }]}>
                Observaciones / Acuerdos
              </Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                placeholder="Escribe resumen de lo conversado con el prospecto..."
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.textArea,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderInput,
                    color: palette.textPrimary,
                  },
                ]}
              />

              {selectedResultId !== 'no_interesado' && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <Text style={[styles.formSectionTitle, { color: palette.textPrimary }]}>
                    Próximo Seguimiento (YYYY-MM-DD y Hora)
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Mañana', d: 1 },
                      { label: '+3 días', d: 3 },
                      { label: '+7 días', d: 7 },
                    ].map((preset) => (
                      <Pressable
                        key={preset.label}
                        onPress={() => setNextDate(addDaysISO(preset.d))}
                        style={[
                          styles.presetChip,
                          { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                        ]}
                      >
                        <Text style={[styles.presetChipText, { color: palette.brandText }]}>
                          {preset.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TextInput
                      value={nextDate}
                      onChangeText={setNextDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={palette.placeholder}
                      style={[
                        styles.textField,
                        {
                          flex: 1.3,
                          backgroundColor: palette.bgInput,
                          borderColor: palette.borderInput,
                          color: palette.textPrimary,
                        },
                      ]}
                    />
                    <TextInput
                      value={nextTime}
                      onChangeText={setNextTime}
                      placeholder="10:00"
                      placeholderTextColor={palette.placeholder}
                      style={[
                        styles.textField,
                        {
                          flex: 1,
                          backgroundColor: palette.bgInput,
                          borderColor: palette.borderInput,
                          color: palette.textPrimary,
                        },
                      ]}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Footer Navigation */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                disabled={saving}
                onPress={resetFormAndAdvance}
              >
                Omitir / Siguiente
              </Button>
              <Button
                variant="primary"
                size="md"
                style={{ flex: 1.5 }}
                loading={saving}
                onPress={handleSaveAndNext}
              >
                Guardar y Siguiente
              </Button>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-MODAL 2: Configurar Metas Comerciales (1:1 con CommercialGoalsConfigModal)
// ══════════════════════════════════════════════════════════════════════════════
function GoalsConfigModal({
  visible,
  companyId,
  defaultGoals,
  advisorGoals,
  advisors,
  onClose,
  onSaved,
}: {
  visible: boolean;
  companyId: string;
  defaultGoals: CommercialGoalConfig;
  advisorGoals: Record<string, Partial<CommercialGoalConfig>>;
  advisors: AdvisorLeaderboardItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'general' | 'individual'>('general');
  const [baseGoals, setBaseGoals] = useState<CommercialGoalConfig>({
    ventasTarget: defaultGoals?.ventasTarget ?? 2,
    visitasTarget: defaultGoals?.visitasTarget ?? 8,
    citasTarget: defaultGoals?.citasTarget ?? 15,
    gestionesTarget: defaultGoals?.gestionesTarget ?? 60,
  });
  const [customGoals, setCustomGoals] = useState<Record<string, Partial<CommercialGoalConfig>>>(() => ({
    ...advisorGoals,
  }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCommercialGoalsConfig(companyId, baseGoals, customGoals);
      onSaved();
    } catch (err: any) {
      Alert.alert('Error al guardar metas', err?.message || 'No se pudieron actualizar las metas.');
    } finally {
      setSaving(false);
    }
  };

  const updateAdvisorField = (advisorId: string, key: keyof CommercialGoalConfig, raw: string) => {
    const num = Math.max(0, parseInt(raw || '0', 10) || 0);
    setCustomGoals((prev) => ({
      ...prev,
      [advisorId]: {
        ...(prev[advisorId] || {}),
        [key]: num,
      },
    }));
  };

  const resetAdvisorCustom = (advisorId: string) => {
    setCustomGoals((prev) => {
      const next = { ...prev };
      delete next[advisorId];
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: palette.bgBody }]}
      >
        <View
          style={[
            styles.focusHeader,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View style={styles.focusHeaderTop}>
            <View>
              <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
                Configurar Metas Comerciales
              </Text>
              <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                Cuotas mensuales generales e individuales por asesor
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="X" size={22} color={palette.textMuted} />
            </Pressable>
          </View>

          <View
            style={[
              styles.viewTabsWrap,
              { backgroundColor: palette.bgSubtle, borderColor: palette.border, marginTop: 12 },
            ]}
          >
            <Pressable
              onPress={() => setTab('general')}
              style={[
                styles.viewTabBtn,
                tab === 'general' && { backgroundColor: palette.bgCard },
              ]}
            >
              <Text
                style={[
                  styles.viewTabText,
                  { color: tab === 'general' ? palette.textPrimary : palette.textMuted },
                ]}
              >
                Meta Base Equipo
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('individual')}
              style={[
                styles.viewTabBtn,
                tab === 'individual' && { backgroundColor: palette.bgCard },
              ]}
            >
              <Text
                style={[
                  styles.viewTabText,
                  { color: tab === 'individual' ? palette.textPrimary : palette.textMuted },
                ]}
              >
                Cuotas por Asesor
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(insets.bottom + 24, 36),
            gap: 12,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'general' ? (
            <View
              style={[
                styles.leadCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border, gap: 12 },
              ]}
            >
              <Text style={[styles.summaryText, { color: palette.textSecondary }]}>
                Define la cuota mensual estándar que aplica a cada asesor comercial salvo que tenga una cuota personalizada.
              </Text>
              {(
                [
                  { key: 'ventasTarget', label: 'Meta Mensual de Ventas / Cierres' },
                  { key: 'visitasTarget', label: 'Meta Mensual de Visitas a Proyecto' },
                  { key: 'citasTarget', label: 'Meta Mensual de Citas / Reuniones' },
                  { key: 'gestionesTarget', label: 'Meta Mensual de Gestiones / Fichas' },
                ] as const
              ).map((f) => (
                <View key={f.key}>
                  <Text style={[styles.miniMetricLabel, { color: palette.textSecondary, marginBottom: 4 }]}>
                    {f.label}
                  </Text>
                  <TextInput
                    keyboardType="number-pad"
                    value={String(baseGoals[f.key] ?? 0)}
                    onChangeText={(txt) =>
                      setBaseGoals((prev) => ({
                        ...prev,
                        [f.key]: Math.max(0, parseInt(txt || '0', 10) || 0),
                      }))
                    }
                    style={[
                      styles.textField,
                      {
                        backgroundColor: palette.bgInput,
                        borderColor: palette.borderInput,
                        color: palette.textPrimary,
                      },
                    ]}
                  />
                </View>
              ))}
            </View>
          ) : (
            advisors.map((adv) => {
              const custom = customGoals[adv.advisorId];
              const hasCustom = !!custom && Object.keys(custom).length > 0;
              return (
                <View
                  key={adv.advisorId}
                  style={[
                    styles.leadCard,
                    {
                      backgroundColor: palette.bgCard,
                      borderColor: hasCustom ? palette.brand : palette.border,
                    },
                  ]}
                >
                  <View style={styles.focusHeaderTop}>
                    <Text style={[styles.leadName, { color: palette.textPrimary, flex: 1 }]} numberOfLines={1}>
                      {adv.advisorName}
                    </Text>
                    {hasCustom && (
                      <Pressable onPress={() => resetAdvisorCustom(adv.advisorId)}>
                        <Text style={[styles.clearFiltersLink, { color: palette.roseText }]}>
                          Restaurar base
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={[styles.advisorBarsGrid, { marginTop: 8 }]}>
                    {(
                      [
                        { key: 'ventasTarget', label: 'Ventas' },
                        { key: 'visitasTarget', label: 'Visitas' },
                        { key: 'citasTarget', label: 'Citas' },
                        { key: 'gestionesTarget', label: 'Gestiones' },
                      ] as const
                    ).map((f) => (
                      <View key={f.key} style={styles.miniMetricBox}>
                        <Text style={[styles.miniMetricLabel, { color: palette.textMuted, marginBottom: 4 }]}>
                          {f.label}
                        </Text>
                        <TextInput
                          keyboardType="number-pad"
                          value={String(custom?.[f.key] ?? baseGoals[f.key] ?? 0)}
                          onChangeText={(txt) => updateAdvisorField(adv.advisorId, f.key, txt)}
                          style={[
                            styles.textFieldSm,
                            {
                              backgroundColor: palette.bgInput,
                              borderColor: palette.borderInput,
                              color: palette.textPrimary,
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Button variant="secondary" fullWidth style={{ flex: 1 }} onPress={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" fullWidth style={{ flex: 1.4 }} loading={saving} onPress={handleSave}>
              Guardar Metas
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
  },
  headerNewBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  webPageHeaderWrap: {
    gap: 10,
    marginBottom: 4,
  },
  webTitleBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  webTitleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  webPageTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  webPageSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  webActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  webAdvisorSelect: {
    flex: 1,
    height: 38,
    borderRadius: 11,
  },
  webPeriodSelect: {
    flex: 1,
    height: 38,
    borderRadius: 11,
  },
  clearPeriodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
  },
  clearPeriodText: {
    fontSize: 12,
    fontWeight: '500',
  },
  webTransferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
  },
  webTransferBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  transferCountDot: {
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  transferCountDotText: {
    color: '#09090b',
    fontSize: 10,
    fontWeight: '800',
  },
  webCallModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
  },
  webCallModeBtnText: {
    color: '#fcd34d',
    fontSize: 12,
    fontWeight: '700',
  },
  webCallModeCountPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  webCallModeCountText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '800',
  },
  webSquareIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webAiReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
  },
  webAiSparklePill: {
    backgroundColor: 'rgba(139, 92, 246, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  webAiSparkleText: {
    color: '#F3E8FF',
    fontSize: 10,
    fontWeight: '800',
  },
  webHeaderDivider: {
    height: 1,
    width: '100%',
    marginVertical: 2,
  },
  topToolbar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  toolbarScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedScopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
  },
  lockedScopeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  toolbarBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionRowFull: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  refreshSquareBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newLeadFullBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    borderRadius: 11,
    borderWidth: 1,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  newLeadFullBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  viewTabsWrap: {
    flexDirection: 'row',
    padding: 5,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    marginTop: 2,
  },
  viewTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    minHeight: 54,
  },
  viewTabText: {
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 15,
  },
  nuevoTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  nuevoTagText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  listHeaderWrap: {
    paddingTop: 4,
    paddingBottom: 10,
    gap: 14,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  kpiCard: {
    width: '48.6%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    gap: 4,
  },
  kpiCardFull: {
    width: '100%',
  },
  kpiTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  kpiIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiBadgePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  kpiLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  kpiSub: {
    fontSize: 11,
  },
  allClearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  allClearTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  allClearSub: {
    fontSize: 11,
    marginTop: 2,
  },
  suggestionsBlock: {
    gap: 10,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionLabelText: {
    fontSize: 11.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    lineHeight: 15,
  },
  sectionPriorityHint: {
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'right',
    lineHeight: 14,
  },
  suggestionCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  suggestionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionCount: {
    fontSize: 16,
    fontWeight: '800',
  },
  suggestionTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  suggestionDesc: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  suggestionCtaBtn: {
    width: '100%',
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  suggestionCtaText: {
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionCta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  categoryScroll: {
    flexDirection: 'row',
    gap: 7,
    paddingVertical: 2,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  catPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  catCountBubble: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  catCountText: {
    fontSize: 10,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  filtersContainer: {
    gap: 8,
  },
  filtersTwoCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
  },
  resultsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultsMetaText: {
    fontSize: 11,
    fontWeight: '500',
  },
  clearFiltersLink: {
    fontSize: 12,
    fontWeight: '700',
  },
  leadCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    gap: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  leadName: {
    fontSize: 15,
    fontWeight: '700',
  },
  metaChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  projectChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    maxWidth: 165,
  },
  projectChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fuenteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    maxWidth: 155,
  },
  fuenteChipText: {
    fontSize: 11,
    maxWidth: 110,
  },
  stagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 145,
  },
  stageDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  stagePillText: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  phoneAdvisorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  phoneText: {
    fontSize: 12,
    fontWeight: '600',
  },
  advisorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    maxWidth: 175,
  },
  advisorPillText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  advisorReadonly: {
    fontSize: 11,
    maxWidth: 160,
  },
  fichaBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  fichaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fichaStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  fichaStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  lastDateText: {
    fontSize: 11,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 17,
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  expandBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timelineWrap: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  timelineAction: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  timelineDate: {
    fontSize: 10,
  },
  timelineDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  timelineAuthor: {
    fontSize: 10,
    marginTop: 1,
  },
  nextFollowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  nextFollowTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  nextFollowSub: {
    fontSize: 11,
    marginTop: 1,
  },
  actionsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    paddingTop: 3,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  quickBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  fichaPrimaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#059669',
    borderWidth: 1,
    borderColor: '#10b981',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
    elevation: 4,
    marginTop: 6,
  },
  fichaPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  // ── Leaderboard Styles ─────────────────────────────────────────────────────
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  monthNavGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconSquareBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabelText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  monthSubText: {
    fontSize: 11,
  },
  goalCardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalMetricCard: {
    width: '48.6%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  goalMetricLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  goalMetricNums: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  goalActualText: {
    fontSize: 20,
    fontWeight: '800',
  },
  goalTargetText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressTrackSm: {
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFillSm: {
    height: '100%',
    borderRadius: 999,
  },
  podiumContainer: {
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  podiumHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  podiumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 11,
    borderRadius: 11,
    borderWidth: 1,
    gap: 10,
  },
  podiumMedal: {
    fontSize: 11,
    fontWeight: '800',
  },
  podiumName: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 1,
  },
  podiumStats: {
    fontSize: 11,
    marginTop: 2,
  },
  podiumPts: {
    fontSize: 15,
    fontWeight: '800',
  },
  podiumPct: {
    fontSize: 11,
    fontWeight: '700',
  },
  scopeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  scopeToggleWrap: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  scopeBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  scopeBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  advisorRankCard: {
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    gap: 10,
  },
  advisorRankTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  advisorRankName: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  meTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
  },
  meTagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  badgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  achievementPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  achievementText: {
    fontSize: 10,
    fontWeight: '600',
  },
  advisorBarsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  miniMetricBox: {
    width: '48.4%',
    gap: 4,
  },
  miniMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  miniMetricLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  miniMetricVal: {
    fontSize: 11,
    fontWeight: '700',
  },
  // ── Modals & Focus Mode ────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  dialogCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  optionMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  textField: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  textFieldSm: {
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  textArea: {
    minHeight: 78,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: 'top',
    marginTop: 6,
  },
  focusHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  focusHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  focusDoneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  doneTrophyCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  doneSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  focusLeadName: {
    fontSize: 18,
    fontWeight: '800',
  },
  focusLeadPhone: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  noAnswerFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 8,
  },
  formSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  resultRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  resultRadioLabel: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
