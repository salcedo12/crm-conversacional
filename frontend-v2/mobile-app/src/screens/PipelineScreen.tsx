import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { isAdminRole } from '../types';
import {
  PIPELINE_GROUPS,
  PIPELINE_STAGES,
  fetchPipelineCards,
  getStageConfig,
  updateLeadPipelineStage,
  type PipelineCardItem,
  type PipelineFilterOptions,
  type PipelineGroup,
  type PipelineStageConfig,
} from '../services/enterprise';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { LoadingView } from '../components/LoadingView';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';

type FollowUpFilter = NonNullable<PipelineFilterOptions['followUpStatus']>;
type DateRangeFilter = NonNullable<PipelineFilterOptions['dateRange']>;

const SOURCE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos los orígenes' },
  { value: 'meta_ads', label: 'Meta Ads / Pauta Digital' },
  { value: 'campo', label: 'Trabajo de Campo' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'whatsapp_ia', label: 'Línea WhatsApp 317 (IA)' },
  { value: 'advisor_whatsapp', label: 'WhatsApp Directo Asesor' },
  { value: 'web', label: 'Página Web' },
  { value: 'ferias', label: 'Ferias / Eventos' },
  { value: 'smarthome', label: 'Base Histórica SmartHome' },
];

const FOLLOW_UP_OPTIONS: Array<{ value: FollowUpFilter; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'uncontacted', label: 'Sin primer contacto' },
  { value: 'overdue', label: 'Seguimiento vencido' },
  { value: 'active', label: 'Seguimiento al día' },
];

const DATE_RANGE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: 'all', label: 'Todo el historial' },
  { value: 'last_30_days', label: 'Últimos 30 días' },
  { value: 'last_60_days', label: 'Últimos 60 días' },
  { value: 'year_2026', label: 'Año 2026' },
  { value: 'year_2025', label: 'Año 2025' },
  { value: 'year_2024', label: 'Año 2024' },
];

const LIMIT_OPTIONS = [100, 250, 500, 1000] as const;

function cleanDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function formatWaDigits(raw: string): string {
  const d = cleanDigits(raw);
  if (!d) return '';
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  return d;
}

export function PipelineScreen() {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const navigation = useNavigation<any>();

  const authCtx = useAuth();
  const { user, profile, companyId, role, platformAdmin } = authCtx;
  const isAdmin = Boolean((authCtx as { isAdmin?: boolean }).isAdmin ?? (platformAdmin || isAdminRole(role)));
  const currentUserId = user?.uid || '';
  const authorName = profile?.displayName || user?.displayName || user?.email || 'Asesor';

  // Responsive column width for 320px - 430px screens (leaves a subtle peek of next column)
  const columnWidth = useMemo(
    () => Math.min(Math.max(windowWidth - 44, 282), 336),
    [windowWidth]
  );

  // ── Applied Filters State ──────────────────────────────────────────────────
  const [selectedAdvisor, setSelectedAdvisor] = useState<string>(() =>
    isAdmin ? 'all' : currentUserId || 'all'
  );
  const [groupFilter, setGroupFilter] = useState<PipelineGroup | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [followUpStatus, setFollowUpStatus] = useState<FollowUpFilter>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [limitCount, setLimitCount] = useState<number>(250);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ── Board Data State ───────────────────────────────────────────────────────
  const [cards, setCards] = useState<PipelineCardItem[]>([]);
  const [advisors, setAdvisors] = useState<{ id: string; name: string }[]>([]);
  const [byProject, setByProject] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Modals & Stage Navigation State ────────────────────────────────────────
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [moveTargetCard, setMoveTargetCard] = useState<PipelineCardItem | null>(null);
  const [movingStage, setMovingStage] = useState(false);
  const [fichaCard, setFichaCard] = useState<PipelineCardItem | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const boardScrollRef = useRef<ScrollView | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMsg(msg);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBannerMsg(null), 2800);
  }, []);

  useEffect(() => {
    if (!isAdmin && currentUserId && selectedAdvisor === 'all') {
      setSelectedAdvisor(currentUserId);
    }
  }, [isAdmin, currentUserId, selectedAdvisor]);

  const loadBoard = useCallback(
    async (showFullLoader = true) => {
      if (!companyId) {
        setLoading(false);
        return;
      }
      if (showFullLoader) setLoading(true);
      try {
        const effectiveAdvisor = isAdmin ? selectedAdvisor : currentUserId || selectedAdvisor;
        const res = await fetchPipelineCards(companyId, {
          advisorId: effectiveAdvisor,
          projectFilter,
          groupFilter: 'all', // Fetch all groups so top phase counters stay accurate, filter locally below
          sourceFilter,
          followUpStatus,
          dateRange,
          limitCount,
        });
        setCards(res.cards);
        if (res.advisors.length > 0) setAdvisors(res.advisors);
        setByProject(res.byProject);
      } catch (err: any) {
        Alert.alert('Error al cargar el tablero', err?.message || 'Intenta nuevamente.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      companyId,
      isAdmin,
      selectedAdvisor,
      currentUserId,
      projectFilter,
      sourceFilter,
      followUpStatus,
      dateRange,
      limitCount,
    ]
  );

  useEffect(() => {
    loadBoard(true);
  }, [loadBoard]);

  // ── Local Search + Group Filtering ─────────────────────────────────────────
  const searchMatchedCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        c.advisorName.toLowerCase().includes(q) ||
        c.project.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q)
    );
  }, [cards, searchQuery]);

  const groupCounts = useMemo(() => {
    const counts: Record<PipelineGroup, number> = {
      captacion: 0,
      linea: 0,
      cierre: 0,
      no_interesado: 0,
    };
    for (const c of searchMatchedCards) {
      counts[c.group] = (counts[c.group] || 0) + 1;
    }
    return counts;
  }, [searchMatchedCards]);

  const filteredCards = useMemo(() => {
    if (groupFilter === 'all') return searchMatchedCards;
    return searchMatchedCards.filter((c) => c.group === groupFilter);
  }, [searchMatchedCards, groupFilter]);

  const visibleStages = useMemo<PipelineStageConfig[]>(() => {
    if (groupFilter === 'all') return PIPELINE_STAGES;
    return PIPELINE_STAGES.filter((s) => s.group === groupFilter);
  }, [groupFilter]);

  const cardsByStage = useMemo(() => {
    const map: Record<string, PipelineCardItem[]> = {};
    for (const st of PIPELINE_STAGES) {
      map[st.id] = [];
    }
    for (const c of filteredCards) {
      if (!map[c.stageId]) map[c.stageId] = [];
      map[c.stageId].push(c);
    }
    return map;
  }, [filteredCards]);

  const conversionRate = useMemo(() => {
    const total = searchMatchedCards.length;
    if (!total) return '0.0';
    const closed = searchMatchedCards.filter((c) => c.stageId === 'firma').length;
    return ((closed / total) * 100).toFixed(1);
  }, [searchMatchedCards]);

  // Follow-up stats computed from loaded cards for the Filter Drawer
  const followUpStats = useMemo(() => {
    const now = Date.now();
    let uncontacted = 0;
    let overdue = 0;
    let active = 0;
    for (const c of cards) {
      const raw = c.rawLead || {};
      const isUnc = !raw.lastMessageAt && !raw.lastFollowUpAt && !raw.advisorFirstContactAt;
      const nextMs = raw.nextFollowUpDate ? Date.parse(String(raw.nextFollowUpDate).replace(' ', 'T')) : NaN;
      if (isUnc) uncontacted++;
      if (!isNaN(nextMs) && nextMs < now) overdue++;
      if (!isNaN(nextMs) && nextMs >= now) active++;
    }
    return { uncontacted, overdue, active };
  }, [cards]);

  const activeAdvancedCount = useMemo(() => {
    let n = 0;
    if (projectFilter !== 'all') n++;
    if (sourceFilter !== 'all') n++;
    if (followUpStatus !== 'all') n++;
    if (dateRange !== 'all') n++;
    if (limitCount !== 250) n++;
    return n;
  }, [projectFilter, sourceFilter, followUpStatus, dateRange, limitCount]);

  // ── Options for Compact Top Selectors ──────────────────────────────────────
  const advisorOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'Todos los Asesores' }];
    if (currentUserId) {
      opts.push({ value: currentUserId, label: `Mis Prospectos (${profile?.displayName || 'Míos'})` });
    }
    const seen = new Set(opts.map((o) => o.value));
    for (const a of advisors) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        opts.push({ value: a.id, label: a.name });
      }
    }
    return opts;
  }, [advisors, currentUserId, profile?.displayName]);

  const groupOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: `Todas las Fases (${searchMatchedCards.length})` },
      { value: 'captacion', label: `1. Captación (${groupCounts.captacion})` },
      { value: 'linea', label: `2. En Línea (${groupCounts.linea})` },
      { value: 'cierre', label: `3. Cierre (${groupCounts.cierre})` },
      { value: 'no_interesado', label: `4. No Interesado (${groupCounts.no_interesado})` },
    ],
    [searchMatchedCards.length, groupCounts]
  );

  const projectOptions = useMemo<SelectOption[]>(() => {
    const entries = Object.entries(byProject).sort((a, b) => b[1] - a[1]);
    return [
      { value: 'all', label: 'Todos los Proyectos' },
      ...entries.map(([proj, cnt]) => ({ value: proj, label: `${proj} (${cnt})` })),
    ];
  }, [byProject]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const jumpToStage = useCallback(
    (idx: number) => {
      setActiveStageIdx(idx);
      boardScrollRef.current?.scrollTo({
        x: idx * (columnWidth + 12),
        animated: true,
      });
    },
    [columnWidth]
  );

  useEffect(() => {
    setActiveStageIdx(0);
    boardScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [groupFilter]);

  const handleMoveCardStage = useCallback(
    async (card: PipelineCardItem, newStageId: string) => {
      if (!companyId || movingStage) return;
      if (card.stageId === newStageId) {
        setMoveTargetCard(null);
        return;
      }
      const nextCfg = getStageConfig(newStageId);
      const snapshot = {
        stageId: card.stageId,
        stageLabel: card.stageLabel,
        group: card.group,
        probability: card.probability,
        probabilityLabel: card.probabilityLabel,
      };

      setMovingStage(true);
      setMoveTargetCard(null);
      // Optimistic UI update
      setCards((prev) =>
        prev.map((c) =>
          c.id === card.id
            ? {
                ...c,
                stageId: nextCfg.id,
                stageLabel: nextCfg.label,
                group: nextCfg.group,
                probability: nextCfg.probability,
                probabilityLabel: nextCfg.probabilityLabel,
              }
            : c
        )
      );

      try {
        await updateLeadPipelineStage(companyId, card.id, newStageId, authorName);
        showBanner(`${card.name} → ${nextCfg.label} (${nextCfg.probabilityLabel})`);
      } catch (err: any) {
        // Rollback on failure
        setCards((prev) =>
          prev.map((c) => (c.id === card.id ? { ...c, ...snapshot } : c))
        );
        Alert.alert('Error al mover etapa', err?.message || 'No se pudo actualizar la etapa en el servidor.');
      } finally {
        setMovingStage(false);
      }
    },
    [companyId, movingStage, authorName, showBanner]
  );

  const toggleMonthGroup = useCallback((key: string) => {
    setCollapsedMonths((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const resetAllFilters = useCallback(() => {
    if (isAdmin) setSelectedAdvisor('all');
    setGroupFilter('all');
    setProjectFilter('all');
    setSourceFilter('all');
    setFollowUpStatus('all');
    setDateRange('all');
    setLimitCount(250);
    setSearchQuery('');
  }, [isAdmin]);

  return (
    <View style={[styles.root, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Embudo de Ventas"
        subtitle="Tablero Kanban de 12 etapas y probabilidad de cierre"
        badge={<Badge label={`${filteredCards.length} leads`} color="yellow" size="xs" />}
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => loadBoard(true)}
              style={[
                styles.iconBtn,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Icon name="RefreshCw" size={15} color={palette.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setFilterDrawerOpen(true)}
              style={[
                styles.filterHeaderBtn,
                {
                  backgroundColor: activeAdvancedCount > 0 ? palette.brandSoft : palette.bgCard,
                  borderColor: activeAdvancedCount > 0 ? palette.brand : palette.border,
                },
              ]}
            >
              <Icon
                name="Sliders"
                size={14}
                color={activeAdvancedCount > 0 ? palette.brandText : palette.textSecondary}
              />
              <Text
                style={[
                  styles.filterHeaderBtnText,
                  { color: activeAdvancedCount > 0 ? palette.brandText : palette.textPrimary },
                ]}
              >
                Filtros{activeAdvancedCount > 0 ? ` (${activeAdvancedCount})` : ''}
              </Text>
            </Pressable>
          </View>
        }
      />

      {bannerMsg && (
        <View
          style={[
            styles.toastBar,
            { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
          ]}
        >
          <Icon name="Check" size={14} color={palette.emeraldText} />
          <Text style={[styles.toastText, { color: palette.emeraldText }]} numberOfLines={1}>
            {bannerMsg}
          </Text>
        </View>
      )}

      {/* Compact Top Controls */}
      <View
        style={[
          styles.controlsContainer,
          { backgroundColor: palette.bgCanvas, borderBottomColor: palette.border },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.selectorsRow}
        >
          {isAdmin ? (
            <SelectModal
              value={selectedAdvisor}
              options={advisorOptions}
              onChange={setSelectedAdvisor}
              title="Filtrar por Asesor"
              icon="Users"
              searchable
              compact
            />
          ) : (
            <View
              style={[
                styles.lockedAdvisorPill,
                { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
              ]}
            >
              <Icon name="User" size={12} color={palette.brandText} />
              <Text style={[styles.lockedAdvisorText, { color: palette.brandText }]}>
                Mi Cartera
              </Text>
            </View>
          )}

          <SelectModal
            value={groupFilter}
            options={groupOptions}
            onChange={(v) => setGroupFilter(v as PipelineGroup | 'all')}
            title="Filtrar Fase del Embudo"
            icon="Layers"
            compact
          />

          <SelectModal
            value={projectFilter}
            options={projectOptions}
            onChange={setProjectFilter}
            title="Filtrar por Proyecto"
            icon="Building2"
            compact
          />
        </ScrollView>

        {/* Search Input + Summary KPI Strip */}
        <View style={styles.searchAndSummaryRow}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: palette.bgInput, borderColor: palette.borderInput },
            ]}
          >
            <Icon name="Search" size={15} color={palette.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar nombre, celular, correo o asesor..."
              placeholderTextColor={palette.placeholder}
              style={[styles.searchInput, { color: palette.textPrimary }]}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Icon name="X" size={15} color={palette.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Phase Metrics & Active Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.metricsStrip}
        >
          {(
            [
              { key: 'captacion', label: 'Captación', count: groupCounts.captacion, color: '#3b82f6' },
              { key: 'linea', label: 'En Línea', count: groupCounts.linea, color: '#f59e0b' },
              { key: 'cierre', label: 'Cierre', count: groupCounts.cierre, color: '#10b981' },
            ] as const
          ).map((m) => {
            const active = groupFilter === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => setGroupFilter((prev) => (prev === m.key ? 'all' : m.key))}
                style={[
                  styles.metricChip,
                  {
                    backgroundColor: active ? `${m.color}22` : palette.bgCard,
                    borderColor: active ? m.color : palette.border,
                  },
                ]}
              >
                <View style={[styles.dotSm, { backgroundColor: m.color }]} />
                <Text style={[styles.metricChipText, { color: palette.textSecondary }]}>
                  {m.label}: <Text style={{ color: palette.textPrimary, fontWeight: '800' }}>{m.count}</Text>
                </Text>
              </Pressable>
            );
          })}

          <View
            style={[
              styles.metricChip,
              { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
            ]}
          >
            <Text style={[styles.metricChipText, { color: palette.emeraldText, fontWeight: '700' }]}>
              Conversión: {conversionRate}%
            </Text>
          </View>

          {activeAdvancedCount > 0 && (
            <Pressable
              onPress={resetAllFilters}
              style={[
                styles.metricChip,
                { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
              ]}
            >
              <Icon name="X" size={11} color={palette.roseText} />
              <Text style={[styles.metricChipText, { color: palette.roseText, fontWeight: '700' }]}>
                Limpiar filtros
              </Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Stage Quick-Jump Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stageJumpStrip}
        >
          {visibleStages.map((stage, idx) => {
            const count = cardsByStage[stage.id]?.length || 0;
            const active = activeStageIdx === idx;
            return (
              <Pressable
                key={stage.id}
                onPress={() => jumpToStage(idx)}
                style={[
                  styles.stageJumpPill,
                  {
                    backgroundColor: active ? `${stage.accentColor}20` : palette.bgSubtle,
                    borderColor: active ? stage.accentColor : palette.border,
                  },
                ]}
              >
                <View style={[styles.dotSm, { backgroundColor: stage.accentColor }]} />
                <Text
                  style={[
                    styles.stageJumpText,
                    { color: active ? palette.textPrimary : palette.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {stage.label}
                </Text>
                <Text
                  style={[
                    styles.stageJumpCount,
                    { color: active ? stage.accentColor : palette.textMuted },
                  ]}
                >
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Horizontal Kanban Columns */}
      {loading ? (
        <LoadingView label="Construyendo tablero de 12 etapas..." />
      ) : (
        <ScrollView
          ref={boardScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={columnWidth + 12}
          decelerationRate="fast"
          onMomentumScrollEnd={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            const idx = Math.round(x / (columnWidth + 12));
            if (idx >= 0 && idx < visibleStages.length) {
              setActiveStageIdx(idx);
            }
          }}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom + 12, 18),
            gap: 12,
          }}
        >
          {visibleStages.map((stage) => {
            const colCards = cardsByStage[stage.id] || [];
            const groupMeta = PIPELINE_GROUPS[stage.group];

            // Group cards inside column by createdMonthYear (1:1 with PipelineColumn.tsx)
            const monthGroups: Array<{ label: string; items: PipelineCardItem[] }> = [];
            const groupIndexMap = new Map<string, number>();
            for (const c of colCards) {
              const gLabel = c.createdMonthYear || 'Sin fecha registrada';
              const existingIdx = groupIndexMap.get(gLabel);
              if (existingIdx === undefined) {
                groupIndexMap.set(gLabel, monthGroups.length);
                monthGroups.push({ label: gLabel, items: [c] });
              } else {
                monthGroups[existingIdx].items.push(c);
              }
            }

            return (
              <View
                key={stage.id}
                style={[
                  styles.columnWrap,
                  {
                    width: columnWidth,
                    backgroundColor: palette.bgCanvas,
                    borderColor: palette.border,
                  },
                ]}
              >
                {/* Top Colored Bar */}
                <View style={[styles.columnTopAccent, { backgroundColor: stage.accentColor }]} />

                {/* Column Header */}
                <View style={[styles.columnHeader, { borderBottomColor: palette.border }]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={[styles.columnGroupTag, { color: groupMeta.color }]}>
                      {groupMeta.label}
                    </Text>
                    <Text style={[styles.columnTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                      {stage.label}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View
                      style={[
                        styles.probBadge,
                        {
                          backgroundColor: `${stage.accentColor}1C`,
                          borderColor: `${stage.accentColor}50`,
                        },
                      ]}
                    >
                      <Text style={[styles.probBadgeText, { color: stage.accentColor }]}>
                        {stage.probabilityLabel}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.colCountBadge,
                        { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
                      ]}
                    >
                      <Text style={[styles.colCountText, { color: palette.textPrimary }]}>
                        {colCards.length}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Column Body Scroll */}
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.columnScrollContent}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={() => {
                        setRefreshing(true);
                        loadBoard(false);
                      }}
                      tintColor={palette.brand}
                    />
                  }
                >
                  {colCards.length === 0 ? (
                    <View style={styles.emptyColBox}>
                      <Icon name="Layers" size={22} color={palette.textSubtle} />
                      <Text style={[styles.emptyColText, { color: palette.textMuted }]}>
                        Sin prospectos en esta etapa
                      </Text>
                    </View>
                  ) : (
                    monthGroups.map((mg) => {
                      const collapseKey = `${stage.id}__${mg.label}`;
                      const collapsed = !!collapsedMonths[collapseKey];
                      return (
                        <View key={collapseKey} style={{ gap: 8 }}>
                          <Pressable
                            onPress={() => toggleMonthGroup(collapseKey)}
                            style={[
                              styles.monthDividerBtn,
                              { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                            ]}
                          >
                            <Icon
                              name={collapsed ? 'ChevronRight' : 'ChevronDown'}
                              size={12}
                              color={palette.textMuted}
                            />
                            <Text
                              style={[styles.monthDividerText, { color: palette.textSecondary, flex: 1 }]}
                              numberOfLines={1}
                            >
                              {mg.label}
                            </Text>
                            <Text style={[styles.monthDividerCount, { color: palette.textMuted }]}>
                              ({mg.items.length})
                            </Text>
                          </Pressable>

                          {!collapsed &&
                            mg.items.map((card) => (
                              <KanbanCard
                                key={card.id}
                                card={card}
                                stageColor={stage.accentColor}
                                onOpenChat={() => navigation.navigate('Chat', { leadId: card.id })}
                                onOpenFicha={() => setFichaCard(card)}
                                onOpenMove={() => setMoveTargetCard(card)}
                              />
                            ))}
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Move Stage Bottom Sheet */}
      <Modal
        visible={!!moveTargetCard}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveTargetCard(null)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: palette.backdrop }]}
          onPress={() => setMoveTargetCard(null)}
        >
          <Pressable
            style={[
              styles.sheetContainer,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 14, 20),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetTopRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
                  Mover Prospecto de Etapa
                </Text>
                <Text style={[styles.sheetSub, { color: palette.textMuted }]} numberOfLines={1}>
                  {moveTargetCard?.name} · Actual: {moveTargetCard?.stageLabel}
                </Text>
              </View>
              <Pressable onPress={() => setMoveTargetCard(null)} hitSlop={10}>
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 410 }}>
              {(['captacion', 'linea', 'cierre', 'no_interesado'] as PipelineGroup[]).map((grp) => {
                const grpMeta = PIPELINE_GROUPS[grp];
                const grpStages = PIPELINE_STAGES.filter((s) => s.group === grp);
                return (
                  <View key={grp} style={{ marginBottom: 8 }}>
                    <Text style={[styles.grpSectionHeader, { color: grpMeta.color }]}>
                      {grpMeta.label}
                    </Text>
                    {grpStages.map((st) => {
                      const isCurrent = moveTargetCard?.stageId === st.id;
                      return (
                        <Pressable
                          key={st.id}
                          onPress={() => moveTargetCard && handleMoveCardStage(moveTargetCard, st.id)}
                          style={[
                            styles.stageOptionRow,
                            {
                              backgroundColor: isCurrent ? palette.brandSoft : 'transparent',
                              borderBottomColor: palette.border,
                            },
                          ]}
                        >
                          <View style={[styles.dotSm, { backgroundColor: st.accentColor }]} />
                          <Text style={[styles.stageOptionText, { color: palette.textPrimary, flex: 1 }]}>
                            {st.label}
                          </Text>
                          <Text style={[styles.stageOptionProb, { color: st.accentColor }]}>
                            {st.probabilityLabel}
                          </Text>
                          {isCurrent && <Icon name="Check" size={16} color={palette.brandText} />}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Advanced Filter Drawer Modal (1:1 with PipelineFilterDrawer.tsx) */}
      <FilterDrawerModal
        visible={filterDrawerOpen}
        isAdmin={isAdmin}
        advisorId={selectedAdvisor}
        advisorOptions={advisorOptions}
        projectFilter={projectFilter}
        byProject={byProject}
        sourceFilter={sourceFilter}
        followUpStatus={followUpStatus}
        followUpStats={followUpStats}
        dateRange={dateRange}
        limitCount={limitCount}
        totalSample={cards.length}
        onClose={() => setFilterDrawerOpen(false)}
        onApply={(next) => {
          if (isAdmin && next.advisorId !== undefined) setSelectedAdvisor(next.advisorId);
          setProjectFilter(next.projectFilter);
          setSourceFilter(next.sourceFilter);
          setFollowUpStatus(next.followUpStatus);
          setDateRange(next.dateRange);
          setLimitCount(next.limitCount);
          setFilterDrawerOpen(false);
        }}
      />

      {/* Ficha Técnica Modal */}
      {companyId ? (
        <FichaTecnicaModal
          isOpen={!!fichaCard}
          onClose={() => setFichaCard(null)}
          onSuccess={() => {
            setFichaCard(null);
            loadBoard(false);
          }}
          companyId={companyId}
          lead={
            fichaCard
              ? {
                  id: fichaCard.id,
                  name: fichaCard.name,
                  phone: fichaCard.phone,
                  project: fichaCard.project,
                  advisorName: fichaCard.advisorName,
                  bitacoras:
                    fichaCard.rawLead?.bitacoras || fichaCard.rawLead?.metadata?.smarthomeBitacoras,
                  metadata: fichaCard.rawLead?.metadata,
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: KanbanCard (1:1 con PipelineCard.tsx)
// ══════════════════════════════════════════════════════════════════════════════
function KanbanCard({
  card,
  stageColor,
  onOpenChat,
  onOpenFicha,
  onOpenMove,
}: {
  card: PipelineCardItem;
  stageColor: string;
  onOpenChat: () => void;
  onOpenFicha: () => void;
  onOpenMove: () => void;
}) {
  const { palette, isDark } = useTheme();
  const digits = cleanDigits(card.phone);
  const waDigits = formatWaDigits(card.phone);

  const scoreTone =
    card.score >= 70
      ? { bg: palette.emeraldBg, border: palette.emeraldBorder, text: palette.emeraldText }
      : card.score >= 40
      ? { bg: palette.amberBg, border: palette.amberBorder, text: palette.amberText }
      : { bg: palette.bgSubtle, border: palette.border, text: palette.textMuted };

  return (
    <View
      style={[
        styles.cardBox,
        {
          backgroundColor: palette.bgCard,
          borderColor: palette.border,
          borderLeftColor: stageColor,
        },
      ]}
    >
      {/* Name + Date + Score */}
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[styles.cardName, { color: palette.textPrimary }]} numberOfLines={1}>
            {card.name}
          </Text>
          <Text style={[styles.cardDateText, { color: palette.textSubtle }]}>
            {card.createdAtText}
          </Text>
        </View>
        {card.score > 0 && (
          <View
            style={[
              styles.scoreBadge,
              { backgroundColor: scoreTone.bg, borderColor: scoreTone.border },
            ]}
          >
            <Icon name="Sparkles" size={10} color={scoreTone.text} />
            <Text style={[styles.scoreBadgeText, { color: scoreTone.text }]}>{card.score}</Text>
          </View>
        )}
      </View>

      {/* Phone & Email */}
      <View style={{ gap: 2 }}>
        <View style={styles.inlineRow}>
          <Icon name="Phone" size={12} color={palette.textMuted} />
          <Text style={[styles.cardContactText, { color: palette.textSecondary }]} numberOfLines={1}>
            {card.phone || 'Sin teléfono'}
          </Text>
        </View>
        {card.email ? (
          <Text style={[styles.cardEmailText, { color: palette.textMuted }]} numberOfLines={1}>
            {card.email}
          </Text>
        ) : null}
      </View>

      {/* Project + Sector / Cupo */}
      <View
        style={[
          styles.projectInfoBox,
          { backgroundColor: palette.bgCardSoft, borderColor: palette.border },
        ]}
      >
        <View style={styles.inlineRow}>
          <Icon name="Building2" size={12} color={palette.brandText} />
          <Text style={[styles.projectTitleText, { color: palette.brandText }]} numberOfLines={1}>
            {card.project}
          </Text>
        </View>
        {(card.sector || card.cupo) && (
          <Text style={[styles.sectorSubText, { color: palette.textMuted }]} numberOfLines={1}>
            {card.sector ? `Sector: ${card.sector}` : ''}
            {card.sector && card.cupo ? ' · ' : ''}
            {card.cupo ? `Cupo: ${card.cupo}` : ''}
          </Text>
        )}
      </View>

      {/* Advisor & Source */}
      <View style={styles.advisorSourceRow}>
        <View style={[styles.inlineRow, { flex: 1 }]}>
          <Icon name="User" size={11} color={palette.textMuted} />
          <Text style={[styles.advisorNameText, { color: palette.textSecondary }]} numberOfLines={1}>
            {card.advisorName}
          </Text>
        </View>
        <View
          style={[
            styles.sourcePill,
            { backgroundColor: palette.bgSubtle, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.sourcePillText, { color: palette.textMuted }]} numberOfLines={1}>
            {card.sourceLabel}
          </Text>
        </View>
      </View>

      {/* Last Bitácora Snippet */}
      {card.lastBitacora ? (
        <View
          style={[
            styles.bitacoraBox,
            { backgroundColor: palette.bgSubtle, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.bitacoraText, { color: palette.textSecondary }]} numberOfLines={2}>
            {card.lastBitacora}
          </Text>
          {card.lastBitacoraDate ? (
            <Text style={[styles.bitacoraDate, { color: palette.textSubtle }]}>
              {String(card.lastBitacoraDate).slice(0, 16)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Card Actions Footer */}
      <View style={[styles.cardActionsRow, { borderTopColor: palette.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Pressable
            disabled={!waDigits}
            onPress={() => waDigits && Linking.openURL(`https://wa.me/${waDigits}`)}
            style={[
              styles.cardIconAction,
              {
                backgroundColor: palette.emeraldBg,
                borderColor: palette.emeraldBorder,
                opacity: waDigits ? 1 : 0.4,
              },
            ]}
          >
            <Icon name="ExternalLink" size={13} color={palette.emeraldText} />
          </Pressable>

          <Pressable
            disabled={!digits}
            onPress={() => digits && Linking.openURL(`tel:${digits}`)}
            style={[
              styles.cardIconAction,
              {
                backgroundColor: palette.bgSubtle,
                borderColor: palette.border,
                opacity: digits ? 1 : 0.4,
              },
            ]}
          >
            <Icon name="Phone" size={13} color={palette.textSecondary} />
          </Pressable>

          <Pressable
            onPress={onOpenChat}
            style={[
              styles.cardIconAction,
              { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
            ]}
          >
            <Icon name="MessageSquare" size={13} color={palette.skyText} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={onOpenFicha}
            style={[
              styles.cardActionPill,
              { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
            ]}
          >
            <Icon name="ClipboardCheck" size={12} color={palette.brandText} />
            <Text style={[styles.cardActionPillText, { color: palette.brandText }]}>Ficha</Text>
          </Pressable>

          <Pressable
            onPress={onOpenMove}
            style={[
              styles.cardActionPill,
              { backgroundColor: palette.brand, borderColor: palette.brand },
            ]}
          >
            <Text
              style={[
                styles.cardActionPillText,
                { color: isDark ? '#09090b' : '#ffffff' },
              ]}
            >
              Mover
            </Text>
            <Icon name="ArrowRight" size={11} color={isDark ? '#09090b' : '#ffffff'} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: FilterDrawerModal (1:1 con PipelineFilterDrawer.tsx)
// ══════════════════════════════════════════════════════════════════════════════
function FilterDrawerModal({
  visible,
  isAdmin,
  advisorId,
  advisorOptions,
  projectFilter,
  byProject,
  sourceFilter,
  followUpStatus,
  followUpStats,
  dateRange,
  limitCount,
  totalSample,
  onClose,
  onApply,
}: {
  visible: boolean;
  isAdmin: boolean;
  advisorId: string;
  advisorOptions: SelectOption[];
  projectFilter: string;
  byProject: Record<string, number>;
  sourceFilter: string;
  followUpStatus: FollowUpFilter;
  followUpStats: { uncontacted: number; overdue: number; active: number };
  dateRange: DateRangeFilter;
  limitCount: number;
  totalSample: number;
  onClose: () => void;
  onApply: (next: {
    advisorId?: string;
    projectFilter: string;
    sourceFilter: string;
    followUpStatus: FollowUpFilter;
    dateRange: DateRangeFilter;
    limitCount: number;
  }) => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const [draftAdvisor, setDraftAdvisor] = useState(advisorId);
  const [draftProject, setDraftProject] = useState(projectFilter);
  const [draftSource, setDraftSource] = useState(sourceFilter);
  const [draftFollowUp, setDraftFollowUp] = useState<FollowUpFilter>(followUpStatus);
  const [draftDate, setDraftDate] = useState<DateRangeFilter>(dateRange);
  const [draftLimit, setDraftLimit] = useState<number>(limitCount);

  useEffect(() => {
    if (visible) {
      setDraftAdvisor(advisorId);
      setDraftProject(projectFilter);
      setDraftSource(sourceFilter);
      setDraftFollowUp(followUpStatus);
      setDraftDate(dateRange);
      setDraftLimit(limitCount);
    }
  }, [visible, advisorId, projectFilter, sourceFilter, followUpStatus, dateRange, limitCount]);

  const sortedProjects = useMemo(
    () => Object.entries(byProject).sort((a, b) => b[1] - a[1]),
    [byProject]
  );

  const handleReset = () => {
    if (isAdmin) setDraftAdvisor('all');
    setDraftProject('all');
    setDraftSource('all');
    setDraftFollowUp('all');
    setDraftDate('all');
    setDraftLimit(250);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.bgBody }]}>
        <View
          style={[
            styles.drawerHeader,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
              Filtros Inteligentes del Embudo
            </Text>
            <Text style={[styles.sheetSub, { color: palette.textMuted }]}>
              Muestra actual: {totalSample} prospectos analizados
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="X" size={22} color={palette.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 24,
            gap: 18,
          }}
        >
          {/* Quick Presets */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              Atajos Rápidos (1 Clic)
            </Text>
            <View style={styles.presetsGrid}>
              {[
                {
                  label: 'Últimos 30 días',
                  apply: () => {
                    setDraftDate('last_30_days');
                    setDraftLimit(250);
                  },
                },
                {
                  label: 'Meta Ads (Pauta)',
                  apply: () => {
                    setDraftSource('meta_ads');
                    setDraftLimit(500);
                  },
                },
                {
                  label: 'Base General (500)',
                  apply: () => {
                    if (isAdmin) setDraftAdvisor('all');
                    setDraftDate('all');
                    setDraftLimit(500);
                  },
                },
                {
                  label: 'Seguimiento Vencido',
                  apply: () => {
                    setDraftFollowUp('overdue');
                    setDraftLimit(500);
                  },
                },
              ].map((p) => (
                <Pressable
                  key={p.label}
                  onPress={p.apply}
                  style={[
                    styles.presetBtn,
                    { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                  ]}
                >
                  <Icon name="Sparkles" size={12} color={palette.brandText} />
                  <Text style={[styles.presetBtnText, { color: palette.brandText }]} numberOfLines={1}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 1. Asesor Comercial */}
          {isAdmin && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
                1. Asesor Comercial
              </Text>
              <SelectModal
                value={draftAdvisor}
                options={advisorOptions}
                onChange={setDraftAdvisor}
                title="Seleccionar Asesor"
                icon="Users"
                searchable
              />
            </View>
          )}

          {/* 2. Proyecto */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              2. Proyecto de Interés
            </Text>
            <View style={styles.chipsWrap}>
              <Pressable
                onPress={() => setDraftProject('all')}
                style={[
                  styles.drawerChip,
                  {
                    backgroundColor: draftProject === 'all' ? palette.brandSoft : palette.bgCard,
                    borderColor: draftProject === 'all' ? palette.brand : palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.drawerChipText,
                    { color: draftProject === 'all' ? palette.brandText : palette.textSecondary },
                  ]}
                >
                  Todos ({totalSample})
                </Text>
              </Pressable>
              {sortedProjects.map(([proj, cnt]) => {
                const active = draftProject === proj;
                return (
                  <Pressable
                    key={proj}
                    onPress={() => setDraftProject(proj)}
                    style={[
                      styles.drawerChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.drawerChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {proj} ({cnt})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 3. Estado de Seguimiento */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              3. Estado de Seguimiento
            </Text>
            <View style={styles.chipsWrap}>
              {FOLLOW_UP_OPTIONS.map((opt) => {
                const active = draftFollowUp === opt.value;
                const countSuffix =
                  opt.value === 'uncontacted'
                    ? ` (${followUpStats.uncontacted})`
                    : opt.value === 'overdue'
                    ? ` (${followUpStats.overdue})`
                    : opt.value === 'active'
                    ? ` (${followUpStats.active})`
                    : '';
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setDraftFollowUp(opt.value)}
                    style={[
                      styles.drawerChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.drawerChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {opt.label}
                      {countSuffix}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 4. Medio / Origen */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              4. Medio / Origen de Captación
            </Text>
            <View style={styles.chipsWrap}>
              {SOURCE_FILTER_OPTIONS.map((opt) => {
                const active = draftSource === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setDraftSource(opt.value)}
                    style={[
                      styles.drawerChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.drawerChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 5. Período / Antigüedad */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              5. Período / Antigüedad de Registro
            </Text>
            <View style={styles.chipsWrap}>
              {DATE_RANGE_OPTIONS.map((opt) => {
                const active = draftDate === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setDraftDate(opt.value)}
                    style={[
                      styles.drawerChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.drawerChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 6. Límite de Lecturas Firestore */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.drawerSectionTitle, { color: palette.textPrimary }]}>
              6. Volumen de Consulta (Lecturas Firestore)
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {LIMIT_OPTIONS.map((lim) => {
                const active = draftLimit === lim;
                return (
                  <Pressable
                    key={lim}
                    onPress={() => setDraftLimit(lim)}
                    style={[
                      styles.limitBtn,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.drawerChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {lim}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.drawerFooter,
            {
              backgroundColor: palette.bgDrawerHeader,
              borderTopColor: palette.border,
              paddingBottom: Math.max(insets.bottom + 12, 18),
            },
          ]}
        >
          <Button variant="secondary" style={{ flex: 1 }} onPress={handleReset}>
            Restablecer
          </Button>
          <Button
            variant="primary"
            style={{ flex: 1.6 }}
            onPress={() =>
              onApply({
                advisorId: draftAdvisor,
                projectFilter: draftProject,
                sourceFilter: draftSource,
                followUpStatus: draftFollowUp,
                dateRange: draftDate,
                limitCount: draftLimit,
              })
            }
          >
            Filtrar y Actualizar
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
  },
  filterHeaderBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toastBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  controlsContainer: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    gap: 8,
  },
  selectorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  lockedAdvisorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  lockedAdvisorText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchAndSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  metricsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  metricChipText: {
    fontSize: 11,
  },
  dotSm: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  stageJumpStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  stageJumpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  stageJumpText: {
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 130,
  },
  stageJumpCount: {
    fontSize: 11,
    fontWeight: '800',
  },
  columnWrap: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    height: '100%',
  },
  columnTopAccent: {
    height: 4,
    width: '100%',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  columnGroupTag: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 1,
  },
  probBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  probBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  colCountBadge: {
    minWidth: 26,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colCountText: {
    fontSize: 11,
    fontWeight: '800',
  },
  columnScrollContent: {
    padding: 10,
    paddingBottom: 24,
    gap: 10,
  },
  emptyColBox: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyColText: {
    fontSize: 12,
    fontWeight: '500',
  },
  monthDividerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  monthDividerText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  monthDividerCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 11,
    gap: 8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardDateText: {
    fontSize: 10,
    marginTop: 1,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  scoreBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardContactText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardEmailText: {
    fontSize: 11,
    paddingLeft: 17,
  },
  projectInfoBox: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  projectTitleText: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  sectorSubText: {
    fontSize: 10,
    paddingLeft: 17,
  },
  advisorSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  advisorNameText: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
  sourcePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    maxWidth: 125,
  },
  sourcePillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bitacoraBox: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  bitacoraText: {
    fontSize: 11,
    lineHeight: 15,
  },
  bitacoraDate: {
    fontSize: 9,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardIconAction: {
    width: 30,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
  },
  cardActionPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  sheetSub: {
    fontSize: 12,
    marginTop: 2,
  },
  grpSectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    paddingVertical: 6,
    letterSpacing: 0.4,
  },
  stageOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stageOptionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stageOptionProb: {
    fontSize: 11,
    fontWeight: '700',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  drawerSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetBtn: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  presetBtnText: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  drawerChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  drawerChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  limitBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  drawerFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});
