import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { isAdminRole, type ContactField, type Lead, type RootStackParams } from '../types';
import {
  createLeadList,
  deleteLeadList,
  importLeadsChunk,
  listAdvisors,
  listLeadLists,
  listLeadsPage,
  shareCsvFile,
  type Advisor,
  type LeadListItemMeta,
} from '../services/enterprise';
import { listContactFields } from '../services/crm';
import { listLeadTransferRequests } from '../services/contacts';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon } from '../components/Icon';
import { Badge, LeadScoreBadge, LeadStatusBadge, type BadgeColor } from '../components/Badge';
import { Button } from '../components/Button';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { EmptyState } from '../components/EmptyState';
import { LoadingView } from '../components/LoadingView';
import { NewLeadModal } from '../components/NewLeadModal';
import { ExportLeadsModal } from '../components/ExportLeadsModal';
import { TransferRequestsModal } from '../components/TransferRequestsModal';
import { LeadDrawerModal } from '../components/LeadDrawerModal';

const PAGE_SIZE = 40;

interface SavedSmartFilters {
  status?: string;
  source?: string;
  advisor?: string;
  ai?: string;
  tag?: string;
}

interface ExtendedLeadList extends LeadListItemMeta {
  kind?: 'smart' | 'import';
  filters?: SavedSmartFilters;
  sourceFileName?: string;
  sourceRowCount?: number;
  importedCount?: number;
  importedCreated?: number;
  importedUpdated?: number;
  importedInvalid?: number;
  createdAt?: any;
}

type SortField = 'lastMessageAt' | 'createdAt' | 'name' | 'status' | 'score';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'closed', label: 'Vendido' },
];

const BASE_SOURCE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Todas las fuentes' },
  { value: 'meta_ads', label: 'Meta Ads (Pauta)' },
  { value: 'whatsapp', label: 'WhatsApp 317' },
  { value: 'advisor_whatsapp', label: 'WhatsApp Asesor' },
  { value: 'web', label: 'Página Web' },
  { value: 'manual', label: 'Registro Manual' },
  { value: 'import', label: 'Importación CSV' },
];

const AI_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'IA y manual' },
  { value: 'enabled', label: 'IA activa' },
  { value: 'disabled', label: 'Modo manual' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'lastMessageAt', label: 'Último mensaje' },
  { value: 'createdAt', label: 'Fecha de creación' },
  { value: 'name', label: 'Nombre (A - Z)' },
  { value: 'status', label: 'Estado' },
  { value: 'score', label: 'Puntaje IA' },
];

function formatRelativeOrShort(ts: any): string {
  if (!ts) return '—';
  const d =
    typeof ts.toDate === 'function'
      ? ts.toDate()
      : typeof ts === 'number'
      ? new Date(ts)
      : typeof ts?.seconds === 'number'
      ? new Date(ts.seconds * 1000)
      : null;
  if (!d || isNaN(d.getTime())) return '—';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function getInitials(name?: string, phone?: string): string {
  const clean = (name || '').trim();
  if (!clean) return (phone || 'C').replace(/\D/g, '').slice(-2) || 'CL';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function resolveSourceBadgeInfo(lead: Lead): { label: string; color: BadgeColor } {
  const custom = (lead.fuenteUbicacion || '').trim();
  const src = (lead.source || '').toLowerCase();
  if (src === 'meta_ads' || custom.toLowerCase().includes('pauta')) {
    return { label: custom || 'Meta Ads', color: 'blue' };
  }
  if (src === 'advisor_whatsapp' || lead.inbox === 'advisor_direct') {
    return { label: custom || 'WA Asesor', color: 'green' };
  }
  if (src === 'whatsapp' || lead.inbox === 'central_317') {
    return { label: custom || 'WhatsApp 317', color: 'green' };
  }
  if (src === 'web') {
    return { label: custom || 'Página Web', color: 'violet' };
  }
  if (src === 'import') {
    return { label: custom || 'Importado', color: 'yellow' };
  }
  return { label: custom || lead.source || 'Directo', color: 'gray' };
}

// ── Robust CSV Parser (supports quoted commas, newlines, ';' and ',') ────────
function parseCsvContent(rawText: string): { headers: string[]; rows: string[][] } {
  const cleaned = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLineEnd = cleaned.indexOf('\n');
  const firstLine = firstLineEnd >= 0 ? cleaned.slice(0, firstLineEnd) : cleaned;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter = tabCount > commaCount && tabCount > semicolonCount ? '\t' : semicolonCount > commaCount ? ';' : ',';

  const allRows: string[][] = [];
  let curRow: string[] = [];
  let curCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          curCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        curCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        curRow.push(curCell.trim());
        curCell = '';
      } else if (ch === '\n') {
        curRow.push(curCell.trim());
        curCell = '';
        if (curRow.some((cell) => cell.length > 0)) {
          allRows.push(curRow);
        }
        curRow = [];
      } else {
        curCell += ch;
      }
    }
  }
  if (curCell.length > 0 || curRow.length > 0) {
    curRow.push(curCell.trim());
    if (curRow.some((cell) => cell.length > 0)) {
      allRows.push(curRow);
    }
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  const headers = allRows[0].map((h, idx) => h || `Columna ${idx + 1}`);
  return { headers, rows: allRows.slice(1) };
}

export function LeadsScreen() {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const authCtx = useAuth();
  const { user, companyId, role, platformAdmin } = authCtx;
  const isAdmin = Boolean((authCtx as { isAdmin?: boolean }).isAdmin ?? (platformAdmin || isAdminRole(role)));

  const initialRouteFilter = (route.params as RootStackParams['Leads'])?.filter;

  // ── Filter & Sort State ────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    initialRouteFilter === 'new'
      ? 'new'
      : initialRouteFilter === 'scheduled'
      ? 'scheduled'
      : 'all'
  );
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [advisorFilter, setAdvisorFilter] = useState<string>('all');
  const [aiFilter, setAiFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [hotOnly, setHotOnly] = useState<boolean>(() => initialRouteFilter === 'hot');
  const [sortField, setSortField] = useState<SortField>(() =>
    initialRouteFilter === 'hot' ? 'score' : 'lastMessageAt'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeListId, setActiveListId] = useState<string>('all');

  // ── Pagination & Data State ────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [cursorStack, setCursorStack] = useState<Array<{ id: string; value?: unknown } | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextCursor, setNextCursor] = useState<{ id: string; value?: unknown } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Lists, Advisors, Custom Fields & Modals ────────────────────────────────
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [lists, setLists] = useState<ExtendedLeadList[]>([]);
  const [contactFields, setContactFields] = useState<ContactField[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState(0);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [smartListOpen, setSmartListOpen] = useState(false);
  const [smartListName, setSmartListName] = useState('');
  const [savingSmartList, setSavingSmartList] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load metadata (advisors, lists, custom fields, pending transfers)
  const loadAuxData = useCallback(async () => {
    if (!companyId) return;
    try {
      const [advRes, listRes, fieldsRes] = await Promise.all([
        listAdvisors(companyId).catch(() => []),
        listLeadLists(companyId).catch(() => []),
        listContactFields(companyId).catch(() => []),
      ]);
      setAdvisors(advRes);
      setLists(listRes as ExtendedLeadList[]);
      setContactFields(fieldsRes);

      if (isAdmin) {
        const tr = await listLeadTransferRequests(companyId, 'pending').catch(() => []);
        setPendingTransfers(tr.length);
      }
    } catch {
      // Non-fatal
    }
  }, [companyId, isAdmin]);

  useEffect(() => {
    loadAuxData();
  }, [loadAuxData]);

  // Build server filters payload matching useLeadsPage.ts
  const serverFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (debouncedSearch) f.search = debouncedSearch;
    if (statusFilter !== 'all') f.status = statusFilter;
    if (sourceFilter !== 'all') f.source = sourceFilter;
    if (isAdmin && advisorFilter !== 'all') {
      f.assignedTo = advisorFilter === '__unassigned__' ? null : advisorFilter;
    } else if (!isAdmin && user?.uid) {
      f.assignedTo = user.uid;
    }
    if (aiFilter === 'enabled') f.aiEnabled = true;
    if (aiFilter === 'disabled') f.aiEnabled = false;
    if (tagFilter !== 'all') f.tag = tagFilter;

    if (activeListId !== 'all') {
      const foundList = lists.find((l) => l.id === activeListId);
      if (foundList && foundList.kind !== 'smart') {
        f.listId = activeListId;
      }
    }
    return f;
  }, [
    debouncedSearch,
    statusFilter,
    sourceFilter,
    isAdmin,
    advisorFilter,
    user?.uid,
    aiFilter,
    tagFilter,
    activeListId,
    lists,
  ]);

  // Reset pagination when filters/sort change
  useEffect(() => {
    setCursorStack([null]);
    setPageIdx(0);
  }, [serverFilters, sortField, sortDir]);

  const currentCursor = cursorStack[pageIdx] ?? null;

  const loadLeads = useCallback(
    async (showSpinner = true) => {
      if (!companyId) {
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const res = await listLeadsPage({
          companyId,
          pageSize: PAGE_SIZE,
          cursor: currentCursor,
          sortField: sortField === 'score' ? 'lastMessageAt' : sortField,
          sortDir,
          filters: serverFilters,
        });
        setLeads(res.leads);
        setNextCursor(res.nextCursor);
        setHasMore(res.hasMore);
      } catch (err: any) {
        Alert.alert('Error al cargar contactos', err?.message || 'Intenta nuevamente.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, currentCursor, sortField, sortDir, serverFilters]
  );

  useEffect(() => {
    loadLeads(true);
  }, [loadLeads]);

  // Client refinement (hotOnly or score sorting)
  const displayedLeads = useMemo(() => {
    let arr = [...leads];
    if (hotOnly) {
      arr = arr.filter(
        (l) => l.aiAnalysis?.temperature === 'hot' || (l.aiAnalysis?.score ?? 0) >= 65
      );
    }
    if (sortField === 'score') {
      arr.sort((a, b) => {
        const sa = a.aiAnalysis?.score ?? -1;
        const sb = b.aiAnalysis?.score ?? -1;
        return sortDir === 'desc' ? sb - sa : sa - sb;
      });
    }
    return arr;
  }, [leads, hotOnly, sortField, sortDir]);

  // KPIs on current dataset
  const pageMetrics = useMemo(() => {
    let nuevos = 0;
    let agendados = 0;
    let iaActiva = 0;
    for (const l of leads) {
      if (l.status === 'new') nuevos++;
      if (l.status === 'scheduled') agendados++;
      if (l.aiEnabled) iaActiva++;
    }
    return {
      total: leads.length,
      nuevos,
      agendados,
      iaActiva,
    };
  }, [leads]);

  const advisorMap = useMemo(() => {
    const m = new Map<string, string>();
    advisors.forEach((a) => m.set(a.id, a.displayName || a.email));
    return m;
  }, [advisors]);

  const advisorSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'Todos los asesores' },
      { value: '__unassigned__', label: 'Sin asignar' },
      ...advisors.map((a) => ({ value: a.id, label: a.displayName || a.email })),
    ],
    [advisors]
  );

  const allTags = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => {
      (l.tags || []).forEach((t) => {
        if (t?.trim()) s.add(t.trim());
      });
    });
    if (tagFilter !== 'all') s.add(tagFilter);
    return Array.from(s).sort();
  }, [leads, tagFilter]);

  const hasActiveFilters =
    searchInput.trim().length > 0 ||
    statusFilter !== 'all' ||
    sourceFilter !== 'all' ||
    advisorFilter !== 'all' ||
    aiFilter !== 'all' ||
    tagFilter !== 'all' ||
    hotOnly ||
    activeListId !== 'all';

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setStatusFilter('all');
    setSourceFilter('all');
    setAdvisorFilter('all');
    setAiFilter('all');
    setTagFilter('all');
    setHotOnly(false);
    setActiveListId('all');
  }, []);

  // ── Smart Lists & Import Lists Handlers ────────────────────────────────────
  const handleSelectList = useCallback((list: ExtendedLeadList | 'all') => {
    if (list === 'all') {
      setActiveListId('all');
      return;
    }
    setActiveListId(list.id);
    if (list.kind === 'smart' && list.filters) {
      setStatusFilter(list.filters.status || 'all');
      setSourceFilter(list.filters.source || 'all');
      setAdvisorFilter(list.filters.advisor || 'all');
      setAiFilter(list.filters.ai || 'all');
      setTagFilter(list.filters.tag || 'all');
    }
  }, []);

  const handleDeleteList = useCallback(
    (list: ExtendedLeadList) => {
      if (!companyId) return;
      Alert.alert(
        'Eliminar lista',
        `¿Seguro que deseas eliminar la lista "${list.name}"? Los contactos no se borrarán.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteLeadList(companyId, list.id);
                if (activeListId === list.id) setActiveListId('all');
                setLists((prev) => prev.filter((item) => item.id !== list.id));
              } catch (err: any) {
                Alert.alert('Error', err?.message || 'No se pudo eliminar la lista.');
              }
            },
          },
        ]
      );
    },
    [companyId, activeListId]
  );

  const handleCreateSmartList = useCallback(async () => {
    if (!companyId || !smartListName.trim()) return;
    setSavingSmartList(true);
    try {
      const fn = getFunctions(undefined, 'us-central1');
      const createCallable = httpsCallable<any, { listId: string }>(fn, 'createLeadList');
      await createCallable({
        companyId,
        name: smartListName.trim(),
        kind: 'smart',
        filters: {
          status: statusFilter,
          source: sourceFilter,
          advisor: advisorFilter,
          ai: aiFilter,
          tag: tagFilter,
        },
        leadIds: [],
      });
      setSmartListName('');
      setSmartListOpen(false);
      await loadAuxData();
    } catch {
      // Fallback to standard createLeadList helper
      try {
        await createLeadList(
          companyId,
          smartListName.trim(),
          displayedLeads.map((l) => l.id)
        );
        setSmartListName('');
        setSmartListOpen(false);
        await loadAuxData();
      } catch (err2: any) {
        Alert.alert('Error', err2?.message || 'No se pudo guardar la lista.');
      }
    } finally {
      setSavingSmartList(false);
    }
  }, [
    companyId,
    smartListName,
    statusFilter,
    sourceFilter,
    advisorFilter,
    aiFilter,
    tagFilter,
    displayedLeads,
    loadAuxData,
  ]);

  // ── Pagination Handlers ────────────────────────────────────────────────────
  const goNextPage = () => {
    if (!hasMore || !nextCursor) return;
    setCursorStack((prev) => {
      const copy = prev.slice(0, pageIdx + 1);
      copy.push(nextCursor);
      return copy;
    });
    setPageIdx((p) => p + 1);
  };

  const goPrevPage = () => {
    if (pageIdx <= 0) return;
    setPageIdx((p) => p - 1);
  };

  // ── Render Lead Card (1:1 with LeadCardList.tsx) ───────────────────────────
  const renderLeadItem = useCallback(
    ({ item: lead }: { item: Lead }) => {
      const sourceInfo = resolveSourceBadgeInfo(lead);
      const advName =
        (lead.assignedTo && advisorMap.get(lead.assignedTo)) ||
        lead.assignedAdvisorName ||
        'Sin asignar';
      const initials = getInitials(lead.name, lead.phone);
      const timeLabel = formatRelativeOrShort(lead.lastMessageAt || lead.createdAt);
      const tags = lead.tags || [];

      return (
        <Pressable
          onPress={() => setSelectedLead(lead)}
          style={({ pressed }) => [
            styles.leadCard,
            {
              backgroundColor: pressed ? palette.bgHover : palette.bgCard,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={styles.cardTopRow}>
            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
              ]}
            >
              <Text style={[styles.avatarText, { color: palette.brandText }]}>{initials}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.nameTimeRow}>
                <Text style={[styles.leadName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {lead.name || lead.phone}
                </Text>
                <Text style={[styles.timeText, { color: palette.textMuted }]}>{timeLabel}</Text>
              </View>
              <Text style={[styles.phoneText, { color: palette.textSecondary }]} numberOfLines={1}>
                {lead.phone}
                {lead.email ? ` · ${lead.email}` : ''}
              </Text>
            </View>
          </View>

          {lead.lastMessageText ? (
            <Text style={[styles.snippetText, { color: palette.textMuted }]} numberOfLines={2}>
              {lead.lastMessageText}
            </Text>
          ) : null}

          {/* Badges Row */}
          <View style={styles.badgesRow}>
            <LeadStatusBadge status={lead.status} size="xs" />
            <Badge label={sourceInfo.label} color={sourceInfo.color} size="xs" />
            <Badge
              label={lead.aiEnabled ? 'IA activa' : 'Modo manual'}
              color={lead.aiEnabled ? 'green' : 'gray'}
              size="xs"
            />
            {typeof lead.aiAnalysis?.score === 'number' && (
              <LeadScoreBadge score={lead.aiAnalysis.score} />
            )}
            {tags.slice(0, 2).map((tg) => (
              <View
                key={`${lead.id}-tg-${tg}`}
                style={[
                  styles.tagChipSmall,
                  { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.tagChipSmallText, { color: palette.textSecondary }]}>
                  #{tg}
                </Text>
              </View>
            ))}
            {tags.length > 2 && (
              <Text style={[styles.moreTagsText, { color: palette.textMuted }]}>
                +{tags.length - 2}
              </Text>
            )}
          </View>

          {/* Bottom Advisor & Open Drawer Chevron */}
          <View style={[styles.cardFooterRow, { borderTopColor: palette.border }]}>
            <View style={styles.inlineAdvisor}>
              <Icon name="User" size={12} color={palette.textMuted} />
              <Text style={[styles.advisorText, { color: palette.textSecondary }]} numberOfLines={1}>
                {advName}
              </Text>
            </View>
            <View style={styles.inlineAdvisor}>
              <Text style={[styles.openDetailHint, { color: palette.brandText }]}>Ver ficha</Text>
              <Icon name="ChevronRight" size={14} color={palette.brandText} />
            </View>
          </View>
        </Pressable>
      );
    },
    [advisorMap, palette]
  );

  // ── Header Component inside FlatList ───────────────────────────────────────
  const renderListHeader = () => (
    <View style={styles.headerBlock}>
      {/* 4 KPI Strip */}
      <View style={styles.kpiRow}>
        {[
          {
            label: 'Total pág.',
            val: pageMetrics.total,
            active: statusFilter === 'all' && aiFilter === 'all' && !hotOnly,
            onPress: () => {
              setStatusFilter('all');
              setAiFilter('all');
              setHotOnly(false);
            },
            accent: palette.textPrimary,
          },
          {
            label: 'Nuevos',
            val: pageMetrics.nuevos,
            active: statusFilter === 'new',
            onPress: () => setStatusFilter((s) => (s === 'new' ? 'all' : 'new')),
            accent: palette.skyText,
          },
          {
            label: 'Agendados',
            val: pageMetrics.agendados,
            active: statusFilter === 'scheduled',
            onPress: () => setStatusFilter((s) => (s === 'scheduled' ? 'all' : 'scheduled')),
            accent: palette.amberText,
          },
          {
            label: 'IA Activa',
            val: pageMetrics.iaActiva,
            active: aiFilter === 'enabled',
            onPress: () => setAiFilter((a) => (a === 'enabled' ? 'all' : 'enabled')),
            accent: palette.emeraldText,
          },
        ].map((k) => (
          <Pressable
            key={k.label}
            onPress={k.onPress}
            style={[
              styles.kpiMiniCard,
              {
                backgroundColor: k.active ? palette.brandSoft : palette.bgCard,
                borderColor: k.active ? palette.brand : palette.border,
              },
            ]}
          >
            <Text style={[styles.kpiMiniVal, { color: k.accent }]}>{k.val}</Text>
            <Text style={[styles.kpiMiniLabel, { color: palette.textMuted }]} numberOfLines={1}>
              {k.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* LeadListsBar (Todos + Saved Lists + Smart List + Import/History) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listsScroll}
      >
        <Pressable
          onPress={() => handleSelectList('all')}
          style={[
            styles.listPill,
            {
              backgroundColor: activeListId === 'all' ? palette.brandSoft : palette.bgCard,
              borderColor: activeListId === 'all' ? palette.brand : palette.border,
            },
          ]}
        >
          <Text
            style={[
              styles.listPillText,
              { color: activeListId === 'all' ? palette.brandText : palette.textSecondary },
            ]}
          >
            Todos
          </Text>
        </Pressable>

        {lists.map((lst) => {
          const active = activeListId === lst.id;
          return (
            <Pressable
              key={lst.id}
              onPress={() => handleSelectList(lst)}
              onLongPress={() => handleDeleteList(lst)}
              style={[
                styles.listPill,
                {
                  backgroundColor: active ? palette.brandSoft : palette.bgCard,
                  borderColor: active ? palette.brand : palette.border,
                },
              ]}
            >
              <Icon
                name={lst.kind === 'smart' ? 'Sparkles' : 'FolderOpen'}
                size={12}
                color={active ? palette.brandText : palette.textMuted}
              />
              <Text
                style={[
                  styles.listPillText,
                  { color: active ? palette.brandText : palette.textSecondary },
                ]}
              >
                {lst.name}
                {typeof lst.count === 'number' && lst.count > 0 ? ` (${lst.count})` : ''}
              </Text>
              {active && (
                <Pressable onPress={() => handleDeleteList(lst)} hitSlop={8}>
                  <Icon name="X" size={12} color={palette.roseText} />
                </Pressable>
              )}
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setSmartListOpen(true)}
          style={[
            styles.listPill,
            { backgroundColor: palette.bgSubtle, borderColor: palette.borderStrong },
          ]}
        >
          <Icon name="Plus" size={12} color={palette.brandText} />
          <Text style={[styles.listPillText, { color: palette.brandText }]}>Lista inteligente</Text>
        </Pressable>
      </ScrollView>

      {/* Search Bar */}
      <View
        style={[
          styles.searchBar,
          { backgroundColor: palette.bgInput, borderColor: palette.borderInput },
        ]}
      >
        <Icon name="Search" size={16} color={palette.textMuted} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Buscar por nombre, celular o correo..."
          placeholderTextColor={palette.placeholder}
          style={[styles.searchInput, { color: palette.textPrimary }]}
          returnKeyType="search"
        />
        {searchInput.length > 0 && (
          <Pressable onPress={() => setSearchInput('')} hitSlop={8}>
            <Icon name="X" size={16} color={palette.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Filter Selectors Row 1 */}
      <View style={styles.filtersGridRow}>
        <SelectModal
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={setStatusFilter}
          title="Estado del Lead"
          icon="Filter"
          compact
          style={{ flex: 1 }}
        />
        <SelectModal
          value={sourceFilter}
          options={BASE_SOURCE_OPTIONS}
          onChange={setSourceFilter}
          title="Fuente de Captación"
          icon="Share2"
          compact
          style={{ flex: 1 }}
        />
        <SelectModal
          value={aiFilter}
          options={AI_OPTIONS}
          onChange={setAiFilter}
          title="Modo de Atención IA"
          icon="Bot"
          compact
          style={{ flex: 1 }}
        />
      </View>

      {/* Filter Selectors Row 2: Advisor (Admin) + Sort + Dir */}
      <View style={styles.filtersGridRow}>
        {isAdmin && (
          <SelectModal
            value={advisorFilter}
            options={advisorSelectOptions}
            onChange={setAdvisorFilter}
            title="Filtrar por Asesor"
            icon="Users"
            searchable
            compact
            style={{ flex: 1.2 }}
          />
        )}
        <SelectModal
          value={sortField}
          options={SORT_OPTIONS}
          onChange={(v) => setSortField(v as SortField)}
          title="Ordenar por"
          icon="Sliders"
          compact
          style={{ flex: 1 }}
        />
        <Pressable
          onPress={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          style={[
            styles.sortDirBtn,
            { backgroundColor: palette.bgCard, borderColor: palette.border },
          ]}
        >
          <Icon
            name={sortDir === 'desc' ? 'ChevronDown' : 'ChevronUp'}
            size={15}
            color={palette.textPrimary}
          />
          <Text style={[styles.sortDirText, { color: palette.textSecondary }]}>
            {sortDir === 'desc' ? 'Desc' : 'Asc'}
          </Text>
        </Pressable>
      </View>

      {/* Selectable Tag Pills */}
      {allTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listsScroll}
        >
          {allTags.map((t) => {
            const selected = tagFilter === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTagFilter((prev) => (prev === t ? 'all' : t))}
                style={[
                  styles.tagFilterPill,
                  {
                    backgroundColor: selected ? palette.brandSoft : palette.bgSubtle,
                    borderColor: selected ? palette.brand : palette.border,
                  },
                ]}
              >
                <Icon
                  name="Tag"
                  size={11}
                  color={selected ? palette.brandText : palette.textMuted}
                />
                <Text
                  style={[
                    styles.tagFilterText,
                    { color: selected ? palette.brandText : palette.textSecondary },
                  ]}
                >
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Results & Clear Row */}
      <View style={styles.metaCountRow}>
        <Text style={[styles.metaCountText, { color: palette.textMuted }]}>
          Mostrando {displayedLeads.length} contacto{displayedLeads.length === 1 ? '' : 's'} · Página{' '}
          {pageIdx + 1}
        </Text>
        {hasActiveFilters && (
          <Pressable onPress={clearAllFilters}>
            <Text style={[styles.clearLink, { color: palette.brandText }]}>Limpiar filtros</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const importListsHistory = useMemo(
    () => lists.filter((l) => l.kind === 'import' || l.sourceFileName),
    [lists]
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Contactos & Leads"
        subtitle="Directorio centralizado, listas inteligentes e importación CSV"
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => loadLeads(true)}
              style={[
                styles.headerIconBtn,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Icon name="RefreshCw" size={15} color={palette.textSecondary} />
            </Pressable>
            <Button
              size="sm"
              variant="primary"
              onPress={() => setNewLeadOpen(true)}
              icon={<Icon name="UserPlus" size={14} color={isDark ? '#09090b' : '#ffffff'} />}
            >
              Nuevo
            </Button>
          </View>
        }
      />

      {/* Admin Action Toolbar: Importar CSV, Exportar, Traslados, Historial */}
      {isAdmin && (
        <View
          style={[
            styles.adminToolbar,
            { backgroundColor: palette.bgCanvas, borderBottomColor: palette.border },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listsScroll}
          >
            <Pressable
              onPress={() => setImportOpen(true)}
              style={[
                styles.actionChip,
                { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
              ]}
            >
              <Icon name="Upload" size={13} color={palette.brandText} />
              <Text style={[styles.actionChipText, { color: palette.brandText }]}>
                Importar CSV
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setExportOpen(true)}
              style={[
                styles.actionChip,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Icon name="Download" size={13} color={palette.textSecondary} />
              <Text style={[styles.actionChipText, { color: palette.textSecondary }]}>
                Exportar
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setTransfersOpen(true)}
              style={[
                styles.actionChip,
                {
                  backgroundColor: pendingTransfers > 0 ? palette.amberBg : palette.bgCard,
                  borderColor: pendingTransfers > 0 ? palette.amberBorder : palette.border,
                },
              ]}
            >
              <Icon
                name="Share2"
                size={13}
                color={pendingTransfers > 0 ? palette.amberText : palette.textSecondary}
              />
              <Text
                style={[
                  styles.actionChipText,
                  { color: pendingTransfers > 0 ? palette.amberText : palette.textSecondary },
                ]}
              >
                Traslados{pendingTransfers > 0 ? ` (${pendingTransfers})` : ''}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={[
                styles.actionChip,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Icon name="Clock" size={13} color={palette.textSecondary} />
              <Text style={[styles.actionChipText, { color: palette.textSecondary }]}>
                Historial CSV
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {loading ? (
        <LoadingView label="Cargando contactos..." />
      ) : (
        <FlatList
          data={displayedLeads}
          keyExtractor={(item) => item.id}
          renderItem={renderLeadItem}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={
            <EmptyState
              title="No se encontraron contactos"
              subtitle={
                hasActiveFilters
                  ? 'Prueba limpiando los filtros o modificando la búsqueda.'
                  : 'Crea un prospecto o importa una base CSV para empezar.'
              }
            />
          }
          ListFooterComponent={
            <View style={styles.paginationFooter}>
              <Button
                variant="secondary"
                size="sm"
                disabled={pageIdx === 0}
                onPress={goPrevPage}
                icon={<Icon name="ChevronLeft" size={14} color={palette.textPrimary} />}
              >
                Anterior
              </Button>
              <Text style={[styles.pageIndicator, { color: palette.textSecondary }]}>
                Página {pageIdx + 1}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasMore}
                onPress={goNextPage}
                icon={<Icon name="ChevronRight" size={14} color={palette.textPrimary} />}
              >
                Siguiente
              </Button>
            </View>
          }
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingBottom: Math.max(insets.bottom + 24, 32),
          }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadLeads(false);
              }}
              tintColor={palette.brand}
            />
          }
        />
      )}

      {/* Smart List Creation Modal */}
      <Modal
        visible={smartListOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSmartListOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.dialogBackdrop, { backgroundColor: palette.backdrop }]}
        >
          <View
            style={[
              styles.dialogBox,
              { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
            ]}
          >
            <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
              Guardar Lista Inteligente
            </Text>
            <Text style={[styles.modalSub, { color: palette.textMuted }]}>
              Guarda la combinación actual de filtros para acceder en 1 toque.
            </Text>
            <TextInput
              value={smartListName}
              onChangeText={setSmartListName}
              placeholder="Ej. Nuevos Meta Ads sin atender"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.inputBox,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderInput,
                  color: palette.textPrimary,
                  marginTop: 12,
                },
              ]}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Button variant="ghost" size="sm" onPress={() => setSmartListOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingSmartList}
                disabled={!smartListName.trim()}
                onPress={handleCreateSmartList}
              >
                Guardar Lista
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Import History Modal */}
      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <Pressable
          style={[styles.sheetBackdrop, { backgroundColor: palette.backdrop }]}
          onPress={() => setHistoryOpen(false)}
        >
          <Pressable
            style={[
              styles.bottomSheet,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 16, 24),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetTop}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
                Historial de Listas Importadas
              </Text>
              <Pressable onPress={() => setHistoryOpen(false)} hitSlop={8}>
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }}>
              {importListsHistory.length === 0 ? (
                <EmptyState
                  title="Sin importaciones registradas"
                  subtitle="Las listas creadas al subir archivos CSV aparecerán aquí."
                />
              ) : (
                importListsHistory.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      handleSelectList(item);
                      setHistoryOpen(false);
                    }}
                    style={[styles.historyRow, { borderBottomColor: palette.border }]}
                  >
                    <Icon name="FileText" size={16} color={palette.brandText} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.leadName, { color: palette.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.modalSub, { color: palette.textMuted }]}>
                        {item.sourceFileName ? `Archivo: ${item.sourceFileName} · ` : ''}
                        Contactos: {item.importedCount ?? item.count ?? 0}
                      </Text>
                    </View>
                    <Icon name="ChevronRight" size={15} color={palette.textMuted} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* CSV Import 4-Step Wizard Modal */}
      {companyId && importOpen ? (
        <CsvImportWizardModal
          visible={importOpen}
          companyId={companyId}
          contactFields={contactFields}
          onClose={() => setImportOpen(false)}
          onCompleted={(createdListId) => {
            setImportOpen(false);
            loadAuxData();
            if (createdListId) setActiveListId(createdListId);
            loadLeads(true);
          }}
        />
      ) : null}

      {/* Shared Modals */}
      {companyId ? (
        <>
          <LeadDrawerModal
            visible={!!selectedLead}
            lead={selectedLead}
            companyId={companyId}
            advisors={advisors}
            allTags={allTags}
            onClose={() => {
              setSelectedLead(null);
              loadLeads(false);
            }}
            onOpenChat={(lead) => {
              setSelectedLead(null);
              navigation.navigate('Chat', { lead });
            }}
          />

          <NewLeadModal
            isOpen={newLeadOpen}
            onClose={() => setNewLeadOpen(false)}
            companyId={companyId}
            advisors={advisors}
            onCreated={() => {
              setNewLeadOpen(false);
              loadLeads(false);
            }}
          />

          <ExportLeadsModal
            isOpen={exportOpen}
            onClose={() => setExportOpen(false)}
            companyId={companyId}
          />

          <TransferRequestsModal
            isOpen={transfersOpen}
            onClose={() => setTransfersOpen(false)}
            companyId={companyId}
            onResolved={() => {
              loadAuxData();
              loadLeads(false);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-MODAL: CsvImportWizardModal (1:1 con ImportContactsModal.tsx)
// Uses expo-document-picker + expo-file-system + importLeadsChunk
// ══════════════════════════════════════════════════════════════════════════════
type WizardStep = 1 | 2 | 3 | 4;

function CsvImportWizardModal({
  visible,
  companyId,
  contactFields,
  onClose,
  onCompleted,
}: {
  visible: boolean;
  companyId: string;
  contactFields: ContactField[];
  onClose: () => void;
  onCompleted: (listId?: string) => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<WizardStep>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [picking, setPicking] = useState(false);

  // Column index mapping (-1 = unmapped)
  const [mapping, setMapping] = useState<Record<string, string>>({
    phone: '__none__',
    name: '__none__',
    email: '__none__',
    project: '__none__',
    tags: '__none__',
  });

  const [listName, setListName] = useState('');
  const [globalTagsInput, setGlobalTagsInput] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [resultStats, setResultStats] = useState<{
    created: number;
    updated: number;
    skipped: number;
    listId?: string;
  } | null>(null);

  const mappableFields = useMemo(() => {
    const std = [
      { key: 'phone', label: 'Teléfono / WhatsApp (Obligatorio *)' },
      { key: 'name', label: 'Nombre completo' },
      { key: 'email', label: 'Correo electrónico' },
      { key: 'project', label: 'Proyecto / Empresa' },
      { key: 'tags', label: 'Etiquetas (separadas por ;)' },
    ];
    const custom = contactFields.map((cf) => ({
      key: `cf_${cf.id}`,
      label: `Campo: ${cf.label}`,
    }));
    return [...std, ...custom];
  }, [contactFields]);

  const headerOptions = useMemo<SelectOption[]>(
    () => [
      { value: '__none__', label: '— No asignar —' },
      ...headers.map((h, idx) => ({ value: String(idx), label: h })),
    ],
    [headers]
  );

  const handleDownloadSample = async () => {
    const sample = [
      'Nombre,Telefono,Correo,Proyecto,Etiquetas',
      'Juan Pérez,+573001234567,juan@ejemplo.com,Laguna Mar,inversionista;caliente',
      'María Gómez,+573109876543,maria@ejemplo.com,Río Claro,lote_campestre',
    ].join('\n');
    try {
      await shareCsvFile('plantilla_importacion_leads.csv', sample);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo generar la plantilla.');
    }
  };

  const handlePickCsv = async () => {
    setPicking(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        return;
      }
      const asset = picked.assets[0];
      const fileObj = new ExpoFile(asset.uri);
      const rawText = await fileObj.text();
      const parsed = parseCsvContent(rawText);

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        Alert.alert(
          'Archivo vacío o inválido',
          'Asegúrate de seleccionar un archivo .CSV con fila de encabezados y al menos 1 contacto.'
        );
        return;
      }

      setFileName(asset.name || 'contactos.csv');
      setHeaders(parsed.headers);
      setRows(parsed.rows);

      const baseTitle = (asset.name || 'Importación').replace(/\.[^.]+$/, '');
      setListName(`${baseTitle} (${new Date().toLocaleDateString('es-CO')})`);

      // Auto-detect common column names
      const autoMap: Record<string, string> = {
        phone: '__none__',
        name: '__none__',
        email: '__none__',
        project: '__none__',
        tags: '__none__',
      };
      parsed.headers.forEach((h, i) => {
        const norm = h
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (
          autoMap.phone === '__none__' &&
          (norm.includes('tel') ||
            norm.includes('cel') ||
            norm.includes('phone') ||
            norm.includes('movil') ||
            norm.includes('whatsapp'))
        ) {
          autoMap.phone = String(i);
        } else if (
          autoMap.name === '__none__' &&
          (norm.includes('nombre') || norm.includes('name') || norm.includes('cliente'))
        ) {
          autoMap.name = String(i);
        } else if (
          autoMap.email === '__none__' &&
          (norm.includes('correo') || norm.includes('email') || norm.includes('mail'))
        ) {
          autoMap.email = String(i);
        } else if (
          autoMap.project === '__none__' &&
          (norm.includes('proyect') || norm.includes('empresa') || norm.includes('interes'))
        ) {
          autoMap.project = String(i);
        } else if (
          autoMap.tags === '__none__' &&
          (norm.includes('tag') || norm.includes('etiqueta'))
        ) {
          autoMap.tags = String(i);
        }
      });
      setMapping(autoMap);
      setStep(2);
    } catch (err: any) {
      Alert.alert('Error al leer el archivo CSV', err?.message || 'Verifica el formato del archivo.');
    } finally {
      setPicking(false);
    }
  };

  // Build normalized rows ready for importLeadsChunk
  const preparedData = useMemo(() => {
    const phoneIdx = mapping.phone !== '__none__' ? Number(mapping.phone) : -1;
    const nameIdx = mapping.name !== '__none__' ? Number(mapping.name) : -1;
    const emailIdx = mapping.email !== '__none__' ? Number(mapping.email) : -1;
    const projectIdx = mapping.project !== '__none__' ? Number(mapping.project) : -1;
    const tagsIdx = mapping.tags !== '__none__' ? Number(mapping.tags) : -1;

    const extraTags = globalTagsInput
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const validRows: Array<{
      name?: string;
      phone: string;
      email?: string;
      project?: string;
      tags?: string[];
    }> = [];
    let invalidCount = 0;

    if (phoneIdx < 0) {
      return { validRows, invalidCount: rows.length };
    }

    for (const r of rows) {
      const rawPhone = String(r[phoneIdx] || '').trim();
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length < 7) {
        invalidCount++;
        continue;
      }
      const rowTags =
        tagsIdx >= 0 && r[tagsIdx]
          ? String(r[tagsIdx])
              .split(/[;|,]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
      const mergedTags = Array.from(new Set([...extraTags, ...rowTags]));

      validRows.push({
        phone: rawPhone,
        name: nameIdx >= 0 && r[nameIdx] ? String(r[nameIdx]).trim() : undefined,
        email: emailIdx >= 0 && r[emailIdx] ? String(r[emailIdx]).trim() : undefined,
        project: projectIdx >= 0 && r[projectIdx] ? String(r[projectIdx]).trim() : undefined,
        tags: mergedTags.length > 0 ? mergedTags : undefined,
      });
    }

    return { validRows, invalidCount };
  }, [rows, mapping, globalTagsInput]);

  const handleRunImport = async () => {
    if (preparedData.validRows.length === 0) {
      Alert.alert('Sin filas válidas', 'Verifica que la columna de Teléfono esté correctamente asignada.');
      return;
    }
    setImporting(true);
    setProgressPct(5);
    try {
      let createdListId: string | undefined;
      if (listName.trim()) {
        try {
          createdListId = await createLeadList(companyId, listName.trim(), []);
        } catch {
          createdListId = undefined;
        }
      }

      const CHUNK_SIZE = 100;
      const total = preparedData.validRows.length;
      let created = 0;
      let updated = 0;
      let skipped = preparedData.invalidCount;

      for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const chunk = preparedData.validRows.slice(offset, offset + CHUNK_SIZE);
        const res = await importLeadsChunk(companyId, chunk, createdListId);
        created += res.created || 0;
        updated += res.updated || 0;
        skipped += res.skipped ?? (res as any).invalid ?? 0;
        const done = Math.min(total, offset + chunk.length);
        setProgressPct(Math.max(10, Math.round((done / total) * 100)));
      }

      setResultStats({ created, updated, skipped, listId: createdListId });
      setStep(4);
    } catch (err: any) {
      Alert.alert('Error durante la importación', err?.message || 'Ocurrió un fallo al importar el lote.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: palette.bgBody }]}
      >
        {/* Wizard Header */}
        <View
          style={[
            styles.wizardHeader,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View style={styles.sheetTop}>
            <View>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
                Importar Contactos (.CSV)
              </Text>
              <Text style={[styles.modalSub, { color: palette.textMuted }]}>
                Paso {step} de 4 ·{' '}
                {step === 1
                  ? 'Seleccionar Archivo'
                  : step === 2
                  ? 'Asignar Columnas'
                  : step === 3
                  ? 'Verificar y Confirmar'
                  : 'Resultado de Importación'}
              </Text>
            </View>
            <Pressable disabled={importing} onPress={onClose} hitSlop={10}>
              <Icon name="X" size={22} color={palette.textMuted} />
            </Pressable>
          </View>

          {/* Step Dots */}
          <View style={styles.stepIndicatorRow}>
            {([1, 2, 3, 4] as WizardStep[]).map((s) => (
              <View
                key={s}
                style={[
                  styles.stepBarSegment,
                  { backgroundColor: s <= step ? palette.brand : palette.bgSubtle },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(insets.bottom + 24, 36),
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <View
              style={[
                styles.wizardCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <View style={styles.uploadHero}>
                <View
                  style={[
                    styles.uploadIconCircle,
                    { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                  ]}
                >
                  <Icon name="Upload" size={28} color={palette.brandText} />
                </View>
                <Text style={[styles.modalTitle, { color: palette.textPrimary, textAlign: 'center' }]}>
                  Sube tu base de datos en CSV
                </Text>
                <Text style={[styles.modalSub, { color: palette.textMuted, textAlign: 'center' }]}>
                  Compatible con archivos exportados de Excel o Google Sheets separados por comas (,) o punto y coma (;).
                </Text>

                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={picking}
                  onPress={handlePickCsv}
                  style={{ marginTop: 10 }}
                  icon={<Icon name="FolderOpen" size={16} color="#09090b" />}
                >
                  Seleccionar archivo .CSV
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onPress={handleDownloadSample}
                  icon={<Icon name="Download" size={14} color={palette.textPrimary} />}
                >
                  Compartir plantilla CSV de ejemplo
                </Button>
              </View>
            </View>
          )}

          {step === 2 && (
            <View
              style={[
                styles.wizardCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border, gap: 12 },
              ]}
            >
              <View style={styles.fileSummaryStrip}>
                <Icon name="FileText" size={16} color={palette.brandText} />
                <Text style={[styles.leadName, { color: palette.textPrimary, flex: 1 }]} numberOfLines={1}>
                  {fileName} ({rows.length} filas)
                </Text>
                <Pressable onPress={() => setStep(1)}>
                  <Text style={[styles.clearLink, { color: palette.brandText }]}>Cambiar</Text>
                </Pressable>
              </View>

              <Text style={[styles.modalSub, { color: palette.textSecondary }]}>
                Relaciona las columnas de tu archivo con los campos del CRM:
              </Text>

              {mappableFields.map((field) => (
                <View key={field.key} style={{ gap: 4 }}>
                  <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>{field.label}</Text>
                  <SelectModal
                    value={mapping[field.key] ?? '__none__'}
                    options={headerOptions}
                    onChange={(val) => setMapping((prev) => ({ ...prev, [field.key]: val }))}
                    title={field.label}
                  />
                </View>
              ))}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <Button variant="secondary" style={{ flex: 1 }} onPress={() => setStep(1)}>
                  Atrás
                </Button>
                <Button
                  variant="primary"
                  style={{ flex: 1.5 }}
                  disabled={mapping.phone === '__none__'}
                  onPress={() => setStep(3)}
                >
                  Continuar ({preparedData.validRows.length} válidos)
                </Button>
              </View>
            </View>
          )}

          {step === 3 && (
            <View
              style={[
                styles.wizardCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border, gap: 12 },
              ]}
            >
              <View style={styles.verifyStatsRow}>
                <View
                  style={[
                    styles.verifyStatBox,
                    { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                  ]}
                >
                  <Text style={[styles.verifyStatNum, { color: palette.emeraldText }]}>
                    {preparedData.validRows.length}
                  </Text>
                  <Text style={[styles.modalSub, { color: palette.emeraldText }]}>Listos para subir</Text>
                </View>
                <View
                  style={[
                    styles.verifyStatBox,
                    { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                  ]}
                >
                  <Text style={[styles.verifyStatNum, { color: palette.amberText }]}>
                    {preparedData.invalidCount}
                  </Text>
                  <Text style={[styles.modalSub, { color: palette.amberText }]}>Sin teléfono válido</Text>
                </View>
              </View>

              {/* Preview first 3 contacts */}
              <View style={{ gap: 6 }}>
                <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>
                  Vista previa de los primeros contactos:
                </Text>
                {preparedData.validRows.slice(0, 3).map((r, i) => (
                  <View
                    key={`prev-${i}`}
                    style={[
                      styles.previewRow,
                      { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>
                      {r.name || 'Sin nombre'} · {r.phone}
                    </Text>
                    <Text style={[styles.modalSub, { color: palette.textMuted }]}>
                      {[r.email, r.project].filter(Boolean).join(' · ') || 'Sin datos extra'}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>
                  Nombre de la lista de importación
                </Text>
                <TextInput
                  value={listName}
                  onChangeText={setListName}
                  placeholder="Ej. Feria Inmobiliaria Octubre"
                  placeholderTextColor={palette.placeholder}
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor: palette.bgInput,
                      borderColor: palette.borderInput,
                      color: palette.textPrimary,
                    },
                  ]}
                />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>
                  Etiquetas globales opcionales (separadas por coma)
                </Text>
                <TextInput
                  value={globalTagsInput}
                  onChangeText={setGlobalTagsInput}
                  placeholder="Ej. base_octubre, lote_campestre"
                  placeholderTextColor={palette.placeholder}
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor: palette.bgInput,
                      borderColor: palette.borderInput,
                      color: palette.textPrimary,
                    },
                  ]}
                />
              </View>

              <Pressable
                onPress={() => setConsentChecked((c) => !c)}
                style={[
                  styles.consentBox,
                  {
                    backgroundColor: consentChecked ? palette.emeraldBg : palette.bgSubtle,
                    borderColor: consentChecked ? palette.emeraldBorder : palette.border,
                  },
                ]}
              >
                <Icon
                  name={consentChecked ? 'CheckCheck' : 'Square'}
                  size={16}
                  color={consentChecked ? palette.emeraldText : palette.textMuted}
                />
                <Text style={[styles.consentText, { color: palette.textSecondary }]}>
                  Confirmo que estos contactos cuentan con autorización para tratamiento de datos y contacto comercial.
                </Text>
              </Pressable>

              {importing && (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={[styles.modalSub, { color: palette.textSecondary }]}>
                      Importando contactos en lotes...
                    </Text>
                    <Text style={[styles.fieldLabel, { color: palette.brandText }]}>{progressPct}%</Text>
                  </View>
                  <View style={[styles.progressBarBg, { backgroundColor: palette.bgSubtle }]}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${progressPct}%`, backgroundColor: palette.brand },
                      ]}
                    />
                  </View>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  disabled={importing}
                  onPress={() => setStep(2)}
                >
                  Atrás
                </Button>
                <Button
                  variant="primary"
                  style={{ flex: 1.6 }}
                  loading={importing}
                  disabled={!consentChecked || preparedData.validRows.length === 0}
                  onPress={handleRunImport}
                >
                  Importar {preparedData.validRows.length} Contactos
                </Button>
              </View>
            </View>
          )}

          {step === 4 && resultStats && (
            <View
              style={[
                styles.wizardCard,
                { backgroundColor: palette.bgCard, borderColor: palette.emeraldBorder, gap: 14 },
              ]}
            >
              <View style={{ alignItems: 'center', gap: 6 }}>
                <View
                  style={[
                    styles.uploadIconCircle,
                    { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                  ]}
                >
                  <Icon name="CheckCheck" size={28} color={palette.emeraldText} />
                </View>
                <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
                  ¡Importación Completada!
                </Text>
                <Text style={[styles.modalSub, { color: palette.textSecondary, textAlign: 'center' }]}>
                  Tu archivo fue procesado correctamente en el CRM.
                </Text>
              </View>

              <View style={styles.verifyStatsRow}>
                <View
                  style={[
                    styles.verifyStatBox,
                    { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                  ]}
                >
                  <Text style={[styles.verifyStatNum, { color: palette.emeraldText }]}>
                    {resultStats.created}
                  </Text>
                  <Text style={[styles.modalSub, { color: palette.emeraldText }]}>Nuevos</Text>
                </View>
                <View
                  style={[
                    styles.verifyStatBox,
                    { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
                  ]}
                >
                  <Text style={[styles.verifyStatNum, { color: palette.skyText }]}>
                    {resultStats.updated}
                  </Text>
                  <Text style={[styles.modalSub, { color: palette.skyText }]}>Actualizados</Text>
                </View>
                <View
                  style={[
                    styles.verifyStatBox,
                    { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.verifyStatNum, { color: palette.textSecondary }]}>
                    {resultStats.skipped}
                  </Text>
                  <Text style={[styles.modalSub, { color: palette.textMuted }]}>Omitidos</Text>
                </View>
              </View>

              <Button
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => onCompleted(resultStats.listId)}
              >
                Finalizar y Ver Contactos
              </Button>
            </View>
          )}
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
  adminToolbar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerBlock: {
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 7,
  },
  kpiMiniCard: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
  },
  kpiMiniVal: {
    fontSize: 17,
    fontWeight: '800',
  },
  kpiMiniLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  listsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  listPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  listPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  filtersGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortDirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
  },
  sortDirText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tagFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagFilterText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metaCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaCountText: {
    fontSize: 11,
    fontWeight: '500',
  },
  clearLink: {
    fontSize: 12,
    fontWeight: '700',
  },
  leadCard: {
    borderRadius: 13,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
  },
  nameTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leadName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  timeText: {
    fontSize: 11,
  },
  phoneText: {
    fontSize: 12,
    marginTop: 1,
  },
  snippetText: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tagChipSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  tagChipSmallText: {
    fontSize: 10,
    fontWeight: '600',
  },
  moreTagsText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inlineAdvisor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '65%',
  },
  advisorText: {
    fontSize: 11,
    fontWeight: '500',
  },
  openDetailHint: {
    fontSize: 11,
    fontWeight: '700',
  },
  paginationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  pageIndicator: {
    fontSize: 12,
    fontWeight: '700',
  },
  // ── Modals & CSV Wizard ────────────────────────────────────────────────────
  dialogBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  dialogBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  modalSub: {
    fontSize: 12,
    marginTop: 2,
  },
  inputBox: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wizardHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    gap: 6,
  },
  stepBarSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  wizardCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 15,
  },
  uploadHero: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  uploadIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  fileSummaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  verifyStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  verifyStatBox: {
    flex: 1,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
  },
  verifyStatNum: {
    fontSize: 20,
    fontWeight: '800',
  },
  previewRow: {
    padding: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  consentBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  consentText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  progressBarBg: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
});
