import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  LeadRow,
  getManualTakeoverSlaInfo,
  parseFollowUpMillis,
  sourceLabel,
} from '../components/LeadRow';
import { LoadingView } from '../components/LoadingView';
import { EmptyState } from '../components/EmptyState';
import { NewLeadModal } from '../components/NewLeadModal';
import { Icon } from '../components/Icon';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useLeads } from '../hooks/useLeads';
import { markLeadsRead } from '../services/crm';
import { listAdvisors, type Advisor } from '../services/enterprise';
import { isUnread } from '../utils/format';
import type { Lead, MainTabsParams, RootStackParams } from '../types';

function hasNoFirstContact(lead: Lead): boolean {
  return !!lead.lastInboundAt && !lead.lastAdvisorMessageAt && !lead.advisorFirstContactAt;
}

function isFollowUpTodayOrOverdue(lead: Lead): boolean {
  const ms = parseFollowUpMillis(lead.nextFollowUpDate);
  if (ms === null) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  // Considera seguimientos programados para hoy (los residuos anteriores a hoy quedan ignorados).
  return ms >= startOfToday.getTime() && ms <= endOfToday.getTime();
}

/** Perdido / No interesado / Cancelado: sale de la bandeja principal (mismo criterio que la web). */
function isDiscardedLead(lead: Lead): boolean {
  if (lead.isArchived) return true;
  if (lead.status === 'lost') return true;
  const stage = String(lead.pipelineStage ?? '');
  return stage.startsWith('no_interesado') || stage === 'cancelado';
}

/** Sin chat: registro manual (trabajo de campo) que solo subió por guardar la Ficha. */
function hasNoConversation(lead: Lead): boolean {
  return !lead.lastInboundAt && !lead.lastMessageText?.trim();
}

function isAdvisorDirectChannel(lead: Lead): boolean {
  return (
    lead.inbox === 'advisor_direct' ||
    lead.source === 'advisor_whatsapp' ||
    lead.metadata?.advisorWhatsappMirror === 'true' ||
    (!lead.inboxId &&
      (lead.id.startsWith('sm_') ||
        Boolean(lead.tags?.includes('smarthome_migracion')) ||
        Boolean(lead.metadata?.migratedFrom) ||
        lead.source === 'manual'))
  );
}

export function InboxScreen() {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { companyId, profile, user, platformAdmin } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute();
  const routeParams = route.params as MainTabsParams['Bandeja'];

  const [search, setSearch] = useState('');
  const [limitSize, setLimitSize] = useState(50);
  const activeLimit = search.trim().length > 0 ? 500 : limitSize;
  const { leads, loading, error } = useLeads(
    companyId,
    user?.uid ?? null,
    profile?.role,
    activeLimit,
    platformAdmin
  );

  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [inbox, setInbox] = useState<'all' | 'central_317' | 'advisor_direct'>('all');
  const [selectedAdvisors, setSelectedAdvisors] = useState<string[]>([]);
  const [advisorModalOpen, setAdvisorModalOpen] = useState(false);
  const [source, setSource] = useState<string>('all');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);

  const [noFirstContact, setNoFirstContact] = useState(false);
  const [dueFollowUpsOnly, setDueFollowUpsOnly] = useState(false);
  const [manualTakeoverOnly, setManualTakeoverOnly] = useState(false);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);

  // Un descartado con mensaje nuevo sin leer se queda en la bandeja principal.
  const discardedIds = useMemo(
    () =>
      new Set(
        leads
          .filter(
            (lead) =>
              isDiscardedLead(lead) &&
              !isUnread(lead.lastInboundAt, lead.readBy?.[user?.uid ?? ''])
          )
          .map((lead) => lead.id)
      ),
    [leads, user?.uid]
  );
  const discardedCount = useMemo(
    () => leads.filter((lead) => discardedIds.has(lead.id) && !hasNoConversation(lead)).length,
    [leads, discardedIds]
  );
  const sectionLeads = useMemo(
    () => leads.filter((lead) => discardedIds.has(lead.id) === showDiscarded),
    [leads, discardedIds, showDiscarded]
  );
  const sectionConversations = useMemo(
    () => sectionLeads.filter((lead) => !hasNoConversation(lead)),
    [sectionLeads]
  );

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    listAdvisors(companyId)
      .then((rows) => {
        if (active) setAdvisors(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [companyId]);

  useEffect(() => {
    if (routeParams?.leadId) {
      navigation.navigate('Chat', { leadId: routeParams.leadId });
    }
  }, [routeParams?.leadId, navigation]);

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (lead.source) counts.set(lead.source, (counts.get(lead.source) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: sourceLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [leads]);

  const advisorCount = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (lead.assignedTo) {
        counts.set(lead.assignedTo, (counts.get(lead.assignedTo) ?? 0) + 1);
      }
    });
    return counts;
  }, [leads]);

  const advisorOptions = useMemo(
    () =>
      advisors
        .filter((advisor) => advisor.active && advisorCount.has(advisor.id))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [advisors, advisorCount]
  );

  const selectedAdvisorNames = useMemo(
    () =>
      selectedAdvisors
        .map((id) => advisors.find((advisor) => advisor.id === id)?.displayName)
        .filter(Boolean) as string[],
    [advisors, selectedAdvisors]
  );

  const noFirstContactCount = useMemo(
    () => sectionConversations.filter(hasNoFirstContact).length,
    [sectionConversations]
  );
  const dueFollowUpsCount = useMemo(
    () => sectionLeads.filter(isFollowUpTodayOrOverdue).length,
    [sectionLeads]
  );

  const manualTakeoverStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let overdue = 0;
    for (const lead of sectionConversations) {
      const info = getManualTakeoverSlaInfo(lead);
      if (info) {
        total++;
        if (info.isOverdue) overdue++;
        else if (!info.isCompliant) pending++;
      }
    }
    return { total, pending, overdue, actionable: pending + overdue };
  }, [sectionConversations]);

  const unreadCount = useMemo(
    () =>
      leads.filter((lead) => isUnread(lead.lastInboundAt, lead.readBy?.[user?.uid ?? ''])).length,
    [leads, user?.uid]
  );

  const filtered = useMemo(() => {
    const routeFilter = routeParams?.filter;
    const searching = search.trim().length > 0;
    const base = leads.filter((lead) => {
      if (
        !dueFollowUpsOnly &&
        (lead.lastMessageText === 'Prospecto outbound agregado manualmente' ||
          lead.lastMessageText === 'Contacto importado')
      ) {
        return false;
      }
      // Registros manuales sin chat: fuera de la bandeja (siguen en seguimientos y búsqueda).
      if (!dueFollowUpsOnly && !searching && hasNoConversation(lead)) return false;
      // Bandeja principal = activos; Perdidos/No interesados en su sección. La búsqueda ve todo.
      if (!searching && discardedIds.has(lead.id) !== showDiscarded) return false;

      if (
        routeFilter === 'pending' &&
        !isUnread(lead.lastInboundAt, lead.readBy?.[user?.uid ?? ''])
      ) {
        return false;
      }
      if (routeFilter === 'hot' && lead.aiAnalysis?.temperature !== 'hot') {
        return false;
      }

      if (inbox !== 'all') {
        const direct = isAdvisorDirectChannel(lead);
        if (inbox === 'central_317' && direct) return false;
        if (inbox === 'advisor_direct' && !direct) return false;
      }

      if (
        selectedAdvisors.length > 0 &&
        (!lead.assignedTo || !selectedAdvisors.includes(lead.assignedTo))
      ) {
        return false;
      }
      if (source !== 'all' && lead.source !== source) return false;
      if (noFirstContact && !hasNoFirstContact(lead)) return false;
      if (dueFollowUpsOnly && !isFollowUpTodayOrOverdue(lead)) return false;
      if (manualTakeoverOnly && lead.aiEnabled) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          Boolean(lead.name?.toLowerCase().includes(q)) ||
          Boolean(lead.phone?.toLowerCase().includes(q)) ||
          Boolean(lead.lastMessageText?.toLowerCase().includes(q))
        );
      }

      return true;
    });

    if (dueFollowUpsOnly) {
      return [...base].sort((a, b) => {
        const ma = parseFollowUpMillis(a.nextFollowUpDate) ?? Number.MAX_SAFE_INTEGER;
        const mb = parseFollowUpMillis(b.nextFollowUpDate) ?? Number.MAX_SAFE_INTEGER;
        return ma - mb;
      });
    }

    if (manualTakeoverOnly) {
      return [...base].sort((a, b) => {
        const infoA = getManualTakeoverSlaInfo(a);
        const infoB = getManualTakeoverSlaInfo(b);
        if (infoA?.isOverdue && !infoB?.isOverdue) return -1;
        if (!infoA?.isOverdue && infoB?.isOverdue) return 1;
        if (infoA && infoB && !infoA.isCompliant && !infoB.isCompliant) {
          return infoA.deadlineMillis - infoB.deadlineMillis;
        }
        if (!infoA?.isCompliant && infoB?.isCompliant) return -1;
        if (infoA?.isCompliant && !infoB?.isCompliant) return 1;
        return 0;
      });
    }

    return base;
  }, [
    leads,
    routeParams?.filter,
    user?.uid,
    inbox,
    selectedAdvisors,
    source,
    noFirstContact,
    dueFollowUpsOnly,
    manualTakeoverOnly,
    search,
    discardedIds,
    showDiscarded,
  ]);

  const handleMarkAllRead = async () => {
    if (!companyId || !user) return;
    const unreadIds = filtered
      .filter((lead) => isUnread(lead.lastInboundAt, lead.readBy?.[user.uid]))
      .map((lead) => lead.id);
    if (unreadIds.length === 0) return;
    try {
      await markLeadsRead(companyId, unreadIds);
    } catch {
      Alert.alert('Error', 'No se pudieron marcar como leídos.');
    }
  };

  const toggleAdvisor = (advisorId: string) => {
    setSelectedAdvisors((current) =>
      current.includes(advisorId)
        ? current.filter((id) => id !== advisorId)
        : [...current, advisorId]
    );
  };

  const anyFilterActive =
    !!search.trim() ||
    selectedAdvisors.length > 0 ||
    source !== 'all' ||
    noFirstContact ||
    dueFollowUpsOnly ||
    manualTakeoverOnly;

  const emptyTitle = dueFollowUpsOnly
    ? '¡Al día! Cero seguimientos pendientes hoy'
    : manualTakeoverOnly
    ? '¡Excelente! Cero prospectos en toma manual'
    : anyFilterActive
    ? 'Sin resultados'
    : 'Sin leads aún';

  const emptySubtitle = dueFollowUpsOnly
    ? 'Todos tus recordatorios y seguimientos de hoy han sido evacuados.'
    : manualTakeoverOnly
    ? 'No tienes prospectos con la IA apagada pendientes de Ficha Técnica.'
    : anyFilterActive
    ? 'Prueba con otro filtro o búsqueda'
    : error || 'Los mensajes de WhatsApp aparecerán aquí';

  return (
    <View style={[styles.root, { backgroundColor: palette.bgCanvas }]}>
      {/* Cabecera y Filtros de Bandeja (réplica 1:1 de LeadList.tsx) */}
      <View
        style={[
          styles.headerPanel,
          {
            paddingTop: Math.max(insets.top + 8, 14),
            borderBottomColor: palette.border,
            backgroundColor: palette.bgCanvas,
          },
        ]}
      >
        {/* Fila superior: Título + Contadores + Botón Nuevo */}
        <View style={styles.titleBar}>
          <View style={styles.titleLeft}>
            <Text style={[styles.title, { color: palette.textPrimary }]}>
              {showDiscarded ? 'Perdidos / No interesados' : 'Bandeja de Entrada'}
            </Text>
            {!loading && filtered.length !== leads.length && (
              <Text style={[styles.countText, { color: palette.textSubtle }]}>
                ({filtered.length}/{leads.length})
              </Text>
            )}
            {!loading && unreadCount > 0 && (
              <View
                style={[
                  styles.unreadBadge,
                  { backgroundColor: palette.brandBg, borderColor: palette.brandBorder },
                ]}
              >
                <Text style={[styles.unreadBadgeText, { color: palette.brandText }]}>
                  {unreadCount} sin leer
                </Text>
              </View>
            )}
          </View>

          <View style={styles.titleRight}>
            {!loading && unreadCount > 0 && (
              <Pressable
                onPress={handleMarkAllRead}
                hitSlop={6}
                style={[
                  styles.markReadInline,
                  { backgroundColor: palette.bgElevated, borderColor: palette.border },
                ]}
              >
                <Icon name="CheckCheck" size={12} color={palette.brandText} />
                <Text style={[styles.markReadText, { color: palette.brandText }]}>Leídos</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => setShowNewLeadModal(true)}
              style={({ pressed }) => [
                styles.newBtn,
                {
                  backgroundColor: pressed ? palette.brand : palette.brandBg,
                  borderColor: palette.brandBorder,
                },
              ]}
            >
              <Icon name="UserPlus" size={12} color={palette.brandText} />
              <Text style={[styles.newBtnText, { color: palette.brandText }]}>Nuevo</Text>
            </Pressable>
          </View>
        </View>

        {/* Píldoras de Canal: Todos / Línea 317 / Asesores Directo */}
        <View style={styles.channelPillsRow}>
          <Pressable
            onPress={() => setInbox('all')}
            style={[
              styles.channelPill,
              inbox === 'all'
                ? {
                    backgroundColor: palette.brandBg,
                    borderColor: palette.brandBorder,
                  }
                : {
                    backgroundColor: palette.bgElevated,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <Text
              style={[
                styles.channelPillText,
                { color: inbox === 'all' ? palette.brandText : palette.textMuted },
              ]}
            >
              Todos ({sectionConversations.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setInbox('central_317')}
            style={[
              styles.channelPill,
              inbox === 'central_317'
                ? {
                    backgroundColor: palette.emeraldBg,
                    borderColor: palette.emeraldBorder,
                  }
                : {
                    backgroundColor: palette.bgElevated,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <Text
              style={[
                styles.channelPillText,
                { color: inbox === 'central_317' ? palette.emeraldText : palette.textMuted },
              ]}
            >
              🏢 Línea 317
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setInbox('advisor_direct')}
            style={[
              styles.channelPill,
              inbox === 'advisor_direct'
                ? {
                    backgroundColor: palette.skyBg,
                    borderColor: palette.skyBorder,
                  }
                : {
                    backgroundColor: palette.bgElevated,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <Text
              style={[
                styles.channelPillText,
                { color: inbox === 'advisor_direct' ? palette.skyText : palette.textMuted },
              ]}
            >
              👤 Asesores Directo
            </Text>
          </Pressable>
        </View>

        {/* Fila Dual: Filtros por Asesor y por Fuente */}
        {(advisorOptions.length > 1 || sourceOptions.length > 1) && (
          <View style={styles.dualFiltersRow}>
            {advisorOptions.length > 1 && (
              <Pressable
                onPress={() => setAdvisorModalOpen(true)}
                style={[
                  styles.dualFilterBtn,
                  selectedAdvisors.length > 0
                    ? {
                        backgroundColor: palette.skyBg,
                        borderColor: palette.skyBorder,
                      }
                    : {
                        backgroundColor: palette.bgInput,
                        borderColor: palette.borderStrong,
                      },
                ]}
              >
                <View style={styles.dualFilterContent}>
                  <Icon
                    name="Users"
                    size={12}
                    color={selectedAdvisors.length > 0 ? palette.skyText : palette.textMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dualFilterLabel,
                      {
                        color: selectedAdvisors.length > 0 ? palette.skyText : palette.textMuted,
                      },
                    ]}
                  >
                    {selectedAdvisors.length === 0
                      ? 'Filtrar asesor'
                      : selectedAdvisors.length === 1
                      ? selectedAdvisorNames[0]
                      : `${selectedAdvisors.length} asesores`}
                  </Text>
                </View>
                {selectedAdvisors.length > 0 ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setSelectedAdvisors([]);
                    }}
                    hitSlop={8}
                  >
                    <Icon name="X" size={12} color={palette.skyText} />
                  </Pressable>
                ) : (
                  <Icon name="ChevronDown" size={12} color={palette.textSubtle} />
                )}
              </Pressable>
            )}

            {sourceOptions.length > 1 && (
              <Pressable
                onPress={() => setSourceModalOpen(true)}
                style={[
                  styles.dualFilterBtn,
                  source !== 'all'
                    ? {
                        backgroundColor: palette.amberBg,
                        borderColor: palette.amberBorder,
                      }
                    : {
                        backgroundColor: palette.bgInput,
                        borderColor: palette.borderStrong,
                      },
                ]}
              >
                <View style={styles.dualFilterContent}>
                  <Icon
                    name="Tag"
                    size={12}
                    color={source !== 'all' ? palette.amberText : palette.textMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dualFilterLabel,
                      { color: source !== 'all' ? palette.amberText : palette.textMuted },
                    ]}
                  >
                    {source === 'all' ? 'Filtrar fuente' : sourceLabel(source)}
                  </Text>
                </View>
                {source !== 'all' ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setSource('all');
                    }}
                    hitSlop={8}
                  >
                    <Icon name="X" size={12} color={palette.amberText} />
                  </Pressable>
                ) : (
                  <Icon name="ChevronDown" size={12} color={palette.textSubtle} />
                )}
              </Pressable>
            )}
          </View>
        )}

        {/* Fila Dual: Filtros Rápidos (Seguimientos Hoy y Toma Manual SLA) */}
        <View style={styles.dualFiltersRow}>
          {/* Filtro rápido 1: Seguimientos para Hoy / Vencidos */}
          <Pressable
            onPress={() => {
              setDueFollowUpsOnly((v) => {
                const next = !v;
                if (next) setManualTakeoverOnly(false);
                return next;
              });
            }}
            style={[
              styles.dualFilterBtn,
              dueFollowUpsOnly
                ? {
                    backgroundColor: palette.amberBg,
                    borderColor: palette.amberBorder,
                  }
                : dueFollowUpsCount > 0
                ? {
                    backgroundColor: palette.isDark
                      ? 'rgba(245, 158, 11, 0.06)'
                      : 'rgba(245, 158, 11, 0.08)',
                    borderColor: palette.amberBorder,
                  }
                : {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <View style={styles.dualFilterContent}>
              <Icon
                name="Clock"
                size={12}
                color={
                  dueFollowUpsOnly || dueFollowUpsCount > 0 ? palette.amberText : palette.textMuted
                }
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.dualFilterLabel,
                  {
                    color:
                      dueFollowUpsOnly || dueFollowUpsCount > 0
                        ? palette.amberText
                        : palette.textMuted,
                    fontWeight: '500',
                  },
                ]}
              >
                ⏰ Hoy / Vencidos
              </Text>
            </View>
            <View
              style={[
                styles.counterPill,
                {
                  backgroundColor:
                    dueFollowUpsOnly || dueFollowUpsCount > 0
                      ? palette.amberBg
                      : palette.bgElevated,
                },
              ]}
            >
              <Text
                style={[
                  styles.counterPillText,
                  {
                    color:
                      dueFollowUpsOnly || dueFollowUpsCount > 0
                        ? palette.amberText
                        : palette.textMuted,
                  },
                ]}
              >
                {dueFollowUpsCount}
              </Text>
            </View>
          </Pressable>

          {/* Filtro rápido 2: En Toma Manual / SLA 24h */}
          {manualTakeoverStats.total > 0 && (
            <Pressable
              onPress={() => {
                setManualTakeoverOnly((v) => {
                  const next = !v;
                  if (next) {
                    setDueFollowUpsOnly(false);
                    setNoFirstContact(false);
                  }
                  return next;
                });
              }}
              style={[
                styles.dualFilterBtn,
                manualTakeoverOnly
                  ? {
                      backgroundColor: palette.amberBg,
                      borderColor: palette.amberBorder,
                    }
                  : manualTakeoverStats.overdue > 0
                  ? {
                      backgroundColor: palette.roseBg,
                      borderColor: palette.roseBorder,
                    }
                  : manualTakeoverStats.actionable > 0
                  ? {
                      backgroundColor: palette.amberBg,
                      borderColor: palette.amberBorder,
                    }
                  : {
                      backgroundColor: palette.bgInput,
                      borderColor: palette.borderStrong,
                    },
              ]}
            >
              <View style={styles.dualFilterContent}>
                <Icon
                  name="Clock"
                  size={12}
                  color={
                    manualTakeoverStats.overdue > 0
                      ? palette.roseText
                      : manualTakeoverStats.actionable > 0 || manualTakeoverOnly
                      ? palette.amberText
                      : palette.textMuted
                  }
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.dualFilterLabel,
                    {
                      color:
                        manualTakeoverOnly
                          ? palette.amberText
                          : manualTakeoverStats.overdue > 0
                          ? palette.roseText
                          : manualTakeoverStats.actionable > 0
                          ? palette.amberText
                          : palette.textMuted,
                      fontWeight: '500',
                    },
                  ]}
                >
                  ⏳ SLA 24h
                </Text>
              </View>
              <View style={styles.slaRightCounters}>
                {manualTakeoverStats.overdue > 0 && (
                  <View
                    style={[
                      styles.overdueMiniBadge,
                      {
                        backgroundColor: palette.roseBg,
                        borderColor: palette.roseBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.overdueMiniText, { color: palette.roseText }]}>
                      {manualTakeoverStats.overdue}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.counterPill,
                    {
                      backgroundColor:
                        manualTakeoverOnly || manualTakeoverStats.actionable > 0
                          ? palette.amberBg
                          : palette.bgElevated,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.counterPillText,
                      {
                        color:
                          manualTakeoverOnly || manualTakeoverStats.actionable > 0
                            ? palette.amberText
                            : palette.textMuted,
                      },
                    ]}
                  >
                    {manualTakeoverStats.total}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
        </View>

        {/* Sección aparte: Perdidos / No interesados (no salen en la bandeja principal) */}
        {(discardedCount > 0 || showDiscarded) && (
          <Pressable
            onPress={() => setShowDiscarded((v) => !v)}
            style={[
              styles.filterBarBtn,
              showDiscarded
                ? { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }
                : { backgroundColor: palette.bgInput, borderColor: palette.borderStrong },
            ]}
          >
            <View style={styles.filterBarLeft}>
              <Icon
                name={showDiscarded ? 'ArrowLeft' : 'UserX'}
                size={12}
                color={showDiscarded ? palette.roseText : palette.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.filterBarLabel,
                  { color: showDiscarded ? palette.roseText : palette.textMuted },
                ]}
              >
                {showDiscarded ? 'Volver a activos' : 'Perdidos / No interesados'}
              </Text>
            </View>
            <View
              style={[
                styles.counterPill,
                { backgroundColor: showDiscarded ? palette.roseBg : palette.bgElevated },
              ]}
            >
              <Text
                style={[
                  styles.counterPillText,
                  { color: showDiscarded ? palette.roseText : palette.textMuted },
                ]}
              >
                {discardedCount}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Filtro rápido 3: Sin primer contacto del asesor (solo si existe y es relevante) */}
        {noFirstContactCount > 0 && (
          <Pressable
            onPress={() => {
              setNoFirstContact((v) => {
                const next = !v;
                if (next) setManualTakeoverOnly(false);
                return next;
              });
            }}
            style={[
              styles.filterBarBtn,
              noFirstContact
                ? {
                    backgroundColor: palette.roseBg,
                    borderColor: palette.roseBorder,
                  }
                : {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <View style={styles.filterBarLeft}>
              <Icon
                name="Clock"
                size={12}
                color={noFirstContact ? palette.roseText : palette.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.filterBarLabel,
                  { color: noFirstContact ? palette.roseText : palette.textMuted },
                ]}
              >
                Sin primer contacto del asesor
              </Text>
            </View>
            <View
              style={[
                styles.counterPill,
                { backgroundColor: noFirstContact ? palette.roseBg : palette.bgElevated },
              ]}
            >
              <Text
                style={[
                  styles.counterPillText,
                  { color: noFirstContact ? palette.roseText : palette.textMuted },
                ]}
              >
                {noFirstContactCount}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Buscador con ícono interior izquierdo */}
        <View style={styles.searchWrap}>
          <View style={styles.searchIconLeft} pointerEvents="none">
            <Icon name="Search" size={13} color={palette.textSubtle} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar lead por nombre o teléfono..."
            placeholderTextColor={palette.textPlaceholder}
            style={[
              styles.searchInput,
              {
                backgroundColor: palette.bgInput,
                borderColor: palette.borderStrong,
                color: palette.textPrimary,
              },
            ]}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} style={styles.clearSearchBtn} hitSlop={8}>
              <Icon name="X" size={14} color={palette.textSubtle} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Lista de Conversaciones */}
      {loading ? (
        <LoadingView label="Cargando conversaciones..." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(lead) => lead.id}
          renderItem={({ item }) => (
            <LeadRow
              lead={item}
              userId={user?.uid ?? ''}
              onPress={() => navigation.navigate('Chat', { lead: item, leadId: item.id })}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="💬" title={emptyTitle} subtitle={emptySubtitle} />
          }
          ListFooterComponent={
            !search.trim() && leads.length >= limitSize ? (
              <Pressable
                onPress={() => setLimitSize((s) => s + 50)}
                style={[styles.loadMoreBtn, { borderTopColor: palette.border }]}
              >
                <Text style={[styles.loadMoreText, { color: palette.brandText }]}>
                  Cargar más leads
                </Text>
              </Pressable>
            ) : null
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={filtered.length ? undefined : { flexGrow: 1 }}
        />
      )}

      {/* Modal Nuevo Contacto / Prospecto */}
      {companyId && (
        <NewLeadModal
          isOpen={showNewLeadModal}
          onClose={() => setShowNewLeadModal(false)}
          companyId={companyId}
          advisors={advisors}
          onCreated={(leadId) => {
            setShowNewLeadModal(false);
            navigation.navigate('Chat', { leadId });
          }}
        />
      )}

      {/* Modal Selector Múltiple de Asesores */}
      <Modal
        visible={advisorModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAdvisorModalOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAdvisorModalOpen(false)} />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.bgSurface,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
                Filtrar por asesor
              </Text>
              <Pressable onPress={() => setAdvisorModalOpen(false)} hitSlop={8}>
                <Icon name="X" size={18} color={palette.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              {advisorOptions.map((advisor) => {
                const checked = selectedAdvisors.includes(advisor.id);
                return (
                  <Pressable
                    key={advisor.id}
                    onPress={() => toggleAdvisor(advisor.id)}
                    style={[
                      styles.modalOptionRow,
                      {
                        backgroundColor: checked ? palette.skyBg : 'transparent',
                      },
                    ]}
                  >
                    <View style={styles.modalOptionLeft}>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: checked ? palette.sky : palette.borderStrong,
                            backgroundColor: checked ? palette.sky : 'transparent',
                          },
                        ]}
                      >
                        {checked && <Icon name="Check" size={11} color="#ffffff" />}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={{ color: palette.textPrimary, fontSize: 13, flex: 1 }}
                      >
                        {advisor.displayName}
                      </Text>
                    </View>
                    <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                      {advisorCount.get(advisor.id) ?? 0}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={[styles.modalFooter, { borderTopColor: palette.border }]}>
              <Pressable
                onPress={() => setSelectedAdvisors([])}
                style={[styles.modalActionBtn, { backgroundColor: palette.bgElevated }]}
              >
                <Text style={{ color: palette.textSecondary, fontSize: 12, fontWeight: '600' }}>
                  Limpiar
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAdvisorModalOpen(false)}
                style={[styles.modalActionBtn, { backgroundColor: palette.brand }]}
              >
                <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>Aplicar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Selector de Fuente */}
      <Modal
        visible={sourceModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSourceModalOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSourceModalOpen(false)} />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.bgSurface,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>
                Filtrar por fuente
              </Text>
              <Pressable onPress={() => setSourceModalOpen(false)} hitSlop={8}>
                <Icon name="X" size={18} color={palette.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              <Pressable
                onPress={() => {
                  setSource('all');
                  setSourceModalOpen(false);
                }}
                style={[
                  styles.modalOptionRow,
                  { backgroundColor: source === 'all' ? palette.amberBg : 'transparent' },
                ]}
              >
                <Text
                  style={{
                    color: source === 'all' ? palette.amberText : palette.textPrimary,
                    fontSize: 13,
                    fontWeight: source === 'all' ? '600' : '400',
                  }}
                >
                  Todas las fuentes
                </Text>
                <Text style={{ color: palette.textSubtle, fontSize: 11 }}>{leads.length}</Text>
              </Pressable>
              {sourceOptions.map((opt) => {
                const active = source === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setSource(opt.value);
                      setSourceModalOpen(false);
                    }}
                    style={[
                      styles.modalOptionRow,
                      { backgroundColor: active ? palette.amberBg : 'transparent' },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? palette.amberText : palette.textPrimary,
                        fontSize: 13,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {opt.label}
                    </Text>
                    <Text style={{ color: palette.textSubtle, fontSize: 11 }}>{opt.count}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerPanel: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  titleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  countText: {
    fontSize: 12,
  },
  unreadBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  unreadBadgeText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  markReadInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3.5,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  markReadText: {
    fontSize: 11,
    fontWeight: '600',
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  newBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  channelPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  channelPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  channelPillText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  dualFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dualFilterBtn: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  dualFilterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  dualFilterLabel: {
    fontSize: 11.5,
    flex: 1,
  },
  filterBarBtn: {
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  filterBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  filterBarLabel: {
    fontSize: 12,
    flex: 1,
  },
  slaRightCounters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  overdueMiniBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  overdueMiniText: {
    fontSize: 9,
    fontWeight: '700',
  },
  counterPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  counterPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  searchWrap: {
    position: 'relative',
    justifyContent: 'center',
    marginTop: 2,
  },
  searchIconLeft: {
    position: 'absolute',
    left: 10,
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: 30,
    paddingRight: 32,
    paddingVertical: 0,
    fontSize: 12,
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 8,
    padding: 2,
  },
  loadMoreBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
  },
  loadMoreText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  modalCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },
  modalOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  checkbox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  modalActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
});
