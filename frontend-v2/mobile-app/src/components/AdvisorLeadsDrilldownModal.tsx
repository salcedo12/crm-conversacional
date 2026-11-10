import React, { useState, useMemo } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import {
  isAdvisorMatch,
  type CommercialExecutiveReportData,
  type AdvisorLeadDetailItem,
  type AdvisorReportRow,
} from '../services/commercialReports';

export type DrilldownFilterType =
  | 'all'
  | 'sin_seguimiento'
  | 'con_seguimiento'
  | 'clientes_seguimiento_total'
  | 'clientes_anteriores';

export interface AdvisorLeadsDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: CommercialExecutiveReportData | null;
  initialAdvisorId?: string;
  initialScope?: 'period' | 'month';
  initialFilter?: DrilldownFilterType;
  onOpenChat: (leadId: string) => void;
  onOpenFicha: (leadId: string) => void;
}

export function AdvisorLeadsDrilldownModal({
  isOpen,
  onClose,
  reportData,
  initialAdvisorId = 'all',
  initialScope = 'period',
  initialFilter = 'all',
  onOpenChat,
  onOpenFicha,
}: AdvisorLeadsDrilldownModalProps) {
  const insets = useSafeAreaInsets();
  const { palette, isDark } = useTheme();

  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>(initialAdvisorId || 'all');
  const [scope, setScope] = useState<'period' | 'month'>(initialScope);
  const [statusFilter, setStatusFilter] = useState<DrilldownFilterType>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [showAdvisorPicker, setShowAdvisorPicker] = useState(false);

  const isIndividual = Boolean(reportData?.isIndividualReport);

  // Sincronizar parámetros iniciales al abrir
  React.useEffect(() => {
    if (isOpen) {
      const lockedAdvId = reportData?.isIndividualReport
        ? reportData?.advisorRows?.[0]?.advisorId || reportData?.targetAdvisorId || initialAdvisorId || 'all'
        : initialAdvisorId || 'all';
      setSelectedAdvisorId(lockedAdvId);
      setScope(initialScope);
      setStatusFilter(initialFilter);
      setSearchQuery('');
      setExpandedLeadId(null);
      setCopiedFeedback(false);
      setShowAdvisorPicker(false);
    }
  }, [isOpen, initialAdvisorId, initialScope, initialFilter, reportData?.isIndividualReport, reportData?.advisorRows, reportData?.targetAdvisorId]);

  // Fila del asesor seleccionado si aplica (SIEMPRE antes del early return para cumplir Rules of Hooks)
  const currentAdvisorRow = useMemo(() => {
    if (!reportData) return undefined;
    if (isIndividual) return reportData.advisorRows[0];
    if (selectedAdvisorId === 'all') return undefined;
    return reportData.advisorRows.find(
      (r) => r.advisorId === selectedAdvisorId || isAdvisorMatch(r.advisorName, selectedAdvisorId)
    );
  }, [reportData, isIndividual, selectedAdvisorId]);

  const currentAdvisorDisplayName = useMemo(() => {
    if (!reportData) return 'Mi Cartera';
    if (isIndividual) {
      return reportData.advisorRows[0]?.advisorName || reportData.targetAdvisorName || 'Mi Cartera';
    }
    if (selectedAdvisorId === 'all') return 'Todo el Equipo Comercial';
    return currentAdvisorRow?.advisorName || selectedAdvisorId;
  }, [isIndividual, selectedAdvisorId, currentAdvisorRow, reportData]);

  // Base leads según ámbito (período de la semana vs mes completo) y asesor filtrado
  const baseLeads: AdvisorLeadDetailItem[] = useMemo(() => {
    if (!reportData) return [];

    // Si el usuario abrió específicamente "Clientes con seguimiento total" o "Clientes anteriores"
    if (statusFilter === 'clientes_seguimiento_total' || statusFilter === 'clientes_anteriores') {
      let managedPool: AdvisorLeadDetailItem[] = [];
      if (isIndividual) {
        managedPool =
          reportData.advisorRows[0]?.managedLeads ||
          reportData.allManagedPeriodLeads ||
          reportData.allPeriodLeads.filter((l) => l.hasPeriodFollowUp);
      } else if (selectedAdvisorId === 'all') {
        managedPool =
          reportData.allManagedPeriodLeads ||
          reportData.allPeriodLeads.filter((l) => l.hasPeriodFollowUp);
      } else if (currentAdvisorRow?.managedLeads) {
        managedPool = currentAdvisorRow.managedLeads;
      } else {
        const allManaged = reportData.allManagedPeriodLeads || reportData.allPeriodLeads;
        managedPool = allManaged.filter(
          (l) => l.advisorId === selectedAdvisorId || isAdvisorMatch(l.advisorName, selectedAdvisorId)
        );
      }

      if (statusFilter === 'clientes_anteriores') {
        return managedPool.filter((l) => !l.isPeriodCreated);
      }
      return managedPool;
    }

    if (isIndividual) {
      const row = reportData.advisorRows[0];
      if (row) {
        return scope === 'month' ? row.monthLeads : row.periodLeads;
      }
      return scope === 'month' ? reportData.allMonthLeads : reportData.allPeriodLeads;
    }
    if (selectedAdvisorId === 'all') {
      return scope === 'month' ? reportData.allMonthLeads : reportData.allPeriodLeads;
    }
    if (currentAdvisorRow) {
      return scope === 'month' ? currentAdvisorRow.monthLeads : currentAdvisorRow.periodLeads;
    }
    const full = scope === 'month' ? reportData.allMonthLeads : reportData.allPeriodLeads;
    return full.filter(
      (l) => l.advisorId === selectedAdvisorId || isAdvisorMatch(l.advisorName, selectedAdvisorId)
    );
  }, [isIndividual, selectedAdvisorId, scope, statusFilter, reportData, currentAdvisorRow]);

  // Métricas de resumen
  const metrics = useMemo(() => {
    const total = baseLeads.length;
    let conSeguimiento = 0;
    let sinSeguimiento = 0;

    baseLeads.forEach((l) => {
      const isManaged =
        scope === 'month'
          ? l.hasMonthFollowUp || l.hasFollowUp
          : l.hasPeriodFollowUp || l.hasFollowUp;
      if (isManaged) conSeguimiento++;
      else sinSeguimiento++;
    });

    const cobertura = total > 0 ? Math.round((conSeguimiento / total) * 100) : 0;
    return { total, conSeguimiento, sinSeguimiento, cobertura };
  }, [baseLeads, scope]);

  // Filtrado por estado de seguimiento y término de búsqueda
  const filteredLeads = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return baseLeads.filter((lead) => {
      const isManaged =
        scope === 'month'
          ? lead.hasMonthFollowUp || lead.hasFollowUp
          : lead.hasPeriodFollowUp || lead.hasFollowUp;

      if (statusFilter === 'con_seguimiento' && !isManaged) return false;
      if (statusFilter === 'sin_seguimiento' && isManaged) return false;

      if (q) {
        const name = (lead.clientName || '').toLowerCase();
        const phone = (lead.phone || '').toLowerCase();
        const proj = (lead.project || '').toLowerCase();
        const adv = (lead.advisorName || '').toLowerCase();
        const note = (lead.lastFollowUpSummary || '').toLowerCase();
        if (
          !name.includes(q) &&
          !phone.includes(q) &&
          !proj.includes(q) &&
          !adv.includes(q) &&
          !note.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [baseLeads, scope, statusFilter, searchQuery]);

  if (!isOpen || !reportData) return null;

  const handleCopySinglePhone = async (phone: string) => {
    if (!phone || phone === 'Sin teléfono') return;
    await Clipboard.setStringAsync(phone);
    Alert.alert('Teléfono copiado', `Se copió ${phone} al portapapeles.`);
  };

  const handleCopyAllPhones = async () => {
    const phones = filteredLeads
      .map((l) => l.phoneRaw || l.phone.replace(/\D/g, ''))
      .filter((p) => p && p.length >= 7);

    if (phones.length === 0) {
      Alert.alert('Sin teléfonos', 'No hay números disponibles en la lista actual.');
      return;
    }

    const text = phones.join(', ');
    await Clipboard.setStringAsync(text);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 2500);
    Alert.alert('Teléfonos copiados', `Se copiaron ${phones.length} números al portapapeles.`);
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent={false}
      statusBarTranslucent={false}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: isDark ? '#09090b' : '#f8fafc' }]}>
        {/* HEADER MODAL */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: isDark ? '#111114' : '#ffffff',
              borderBottomColor: isDark ? '#27272a' : '#e4e4e7',
              paddingTop: Math.max(insets.top + 8, 16),
            },
          ]}
        >
          <View style={styles.headerTopRow}>
            <View style={styles.pillBadge}>
              <Icon name="Sparkles" size={13} color="#f59e0b" />
              <Text style={styles.pillBadgeText}>Auditoría Interactiva de Captaciones</Text>
            </View>

            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: isDark ? '#27272a' : '#f4f4f5' }]}
              hitSlop={10}
            >
              <Icon name="X" size={16} color={palette.textSecondary} />
            </Pressable>
          </View>

          <Text style={[styles.periodSubtitle, { color: palette.textSubtle }]} numberOfLines={1}>
            Semana / Período: {reportData.periodLabel}
          </Text>

          {/* Asesor Title Banner & Picker */}
          <View style={styles.advisorSelectorRow}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="User" size={17} color="#f59e0b" />
              <Text style={[styles.advisorTitle, { color: isDark ? '#ffffff' : '#09090b' }]} numberOfLines={1}>
                {currentAdvisorDisplayName}
              </Text>
            </View>

            {!isIndividual && (
              <Pressable
                onPress={() => setShowAdvisorPicker(!showAdvisorPicker)}
                style={[
                  styles.changeAdvisorBtn,
                  { backgroundColor: isDark ? '#27272a' : '#f4f4f5', borderColor: isDark ? '#3f3f46' : '#d4d4d8' },
                ]}
              >
                <Icon name="Filter" size={11} color="#f59e0b" />
                <Text style={[styles.changeAdvisorBtnText, { color: palette.textPrimary }]}>
                  {showAdvisorPicker ? 'Ocultar' : 'Filtrar Asesor'}
                </Text>
                <Icon name={showAdvisorPicker ? 'ChevronUp' : 'ChevronDown'} size={12} color={palette.textSubtle} />
              </Pressable>
            )}
          </View>

          {/* Lista desplegable para seleccionar asesor en modo Admin */}
          {showAdvisorPicker && !isIndividual && (
            <View style={[styles.advisorDropdownList, { backgroundColor: isDark ? '#18181b' : '#f8fafc', borderColor: isDark ? '#27272a' : '#e2e8f0' }]}>
              <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                <Pressable
                  onPress={() => {
                    setSelectedAdvisorId('all');
                    setShowAdvisorPicker(false);
                  }}
                  style={[
                    styles.advisorDropdownItem,
                    selectedAdvisorId === 'all' && styles.advisorDropdownItemActive,
                  ]}
                >
                  <Text style={[styles.advisorDropdownItemText, selectedAdvisorId === 'all' && { fontWeight: '800', color: '#09090b' }]}>
                    👥 Todo el Equipo ({scope === 'month' ? reportData.allMonthLeads.length : reportData.allPeriodLeads.length} captados)
                  </Text>
                </Pressable>

                {reportData.advisorRows.map((adv) => {
                  const count = scope === 'month' ? adv.captMes : adv.captSemana;
                  const isCur = selectedAdvisorId === adv.advisorId || isAdvisorMatch(selectedAdvisorId, adv.advisorName);
                  return (
                    <Pressable
                      key={adv.advisorId}
                      onPress={() => {
                        setSelectedAdvisorId(adv.advisorId);
                        setShowAdvisorPicker(false);
                      }}
                      style={[
                        styles.advisorDropdownItem,
                        isCur && styles.advisorDropdownItemActive,
                      ]}
                    >
                      <Text style={[styles.advisorDropdownItemText, isCur && { fontWeight: '800', color: '#09090b' }]}>
                        {adv.advisorName} ({count} {scope === 'month' ? 'en el mes' : 'en la semana'})
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <Text style={[styles.helperExplanation, { color: palette.textMuted }]}>
            Haz clic en cualquier prospecto para abrir su chat o en "Ver seguimiento" para revisar su historial de bitácoras y llamadas.
          </Text>

          {/* SELECTOR DE ÁMBITO (SEMANA VS MES) */}
          <View style={[styles.scopeTabsBar, { backgroundColor: isDark ? '#18181b' : '#f1f5f9' }]}>
            <Pressable
              onPress={() => {
                setScope('period');
                if (statusFilter === 'clientes_seguimiento_total' || statusFilter === 'clientes_anteriores') {
                  setStatusFilter('all');
                }
              }}
              style={[
                styles.scopeTabBtn,
                scope === 'period' && styles.scopeTabBtnActive,
              ]}
            >
              <Icon
                name="Calendar"
                size={13}
                color={scope === 'period' ? '#09090b' : palette.textSubtle}
              />
              <Text
                style={[
                  styles.scopeTabText,
                  { color: scope === 'period' ? '#09090b' : palette.textSubtle },
                  scope === 'period' && styles.scopeTabTextActive,
                ]}
              >
                Captados en la Semana
              </Text>
              <View
                style={[
                  styles.countPill,
                  {
                    backgroundColor:
                      scope === 'period'
                        ? 'rgba(0,0,0,0.18)'
                        : isDark
                        ? '#27272a'
                        : '#e2e8f0',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countPillText,
                    { color: scope === 'period' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  {isIndividual
                    ? reportData.allPeriodLeads.length
                    : selectedAdvisorId === 'all'
                    ? reportData.allPeriodLeads.length
                    : currentAdvisorRow?.captSemana || 0}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => {
                setScope('month');
                if (statusFilter === 'clientes_seguimiento_total' || statusFilter === 'clientes_anteriores') {
                  setStatusFilter('all');
                }
              }}
              style={[
                styles.scopeTabBtn,
                scope === 'month' && styles.scopeTabBtnActive,
              ]}
            >
              <Icon
                name="Calendar"
                size={13}
                color={scope === 'month' ? '#09090b' : palette.textSubtle}
              />
              <Text
                style={[
                  styles.scopeTabText,
                  { color: scope === 'month' ? '#09090b' : palette.textSubtle },
                  scope === 'month' && styles.scopeTabTextActive,
                ]}
              >
                Captados del Mes
              </Text>
              <View
                style={[
                  styles.countPill,
                  {
                    backgroundColor:
                      scope === 'month'
                        ? 'rgba(0,0,0,0.18)'
                        : isDark
                        ? '#27272a'
                        : '#e2e8f0',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countPillText,
                    { color: scope === 'month' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  {isIndividual
                    ? reportData.allMonthLeads.length
                    : selectedAdvisorId === 'all'
                    ? reportData.allMonthLeads.length
                    : currentAdvisorRow?.captMes || 0}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* 4 KPIS DE RESUMEN */}
          <View style={styles.kpiRow}>
            <View
              style={[
                styles.kpiBox,
                {
                  backgroundColor: isDark ? '#18181b' : '#ffffff',
                  borderColor: isDark ? '#27272a' : '#e4e4e7',
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                TOTAL CAPTADOS ({scope === 'month' ? 'MES' : 'SEMANA'})
              </Text>
              <Text style={[styles.kpiValue, { color: '#f59e0b' }]}>{metrics.total}</Text>
            </View>

            <Pressable
              onPress={() =>
                setStatusFilter(statusFilter === 'con_seguimiento' ? 'all' : 'con_seguimiento')
              }
              style={[
                styles.kpiBox,
                {
                  backgroundColor:
                    statusFilter === 'con_seguimiento'
                      ? isDark
                        ? '#064e3b'
                        : '#dcfce7'
                      : isDark
                      ? '#18181b'
                      : '#ffffff',
                  borderColor:
                    statusFilter === 'con_seguimiento'
                      ? '#10b981'
                      : isDark
                      ? '#27272a'
                      : '#e4e4e7',
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: '#10b981' }]}>✅ CON SEGUIMIENTO</Text>
              <Text style={[styles.kpiValue, { color: '#10b981' }]}>{metrics.conSeguimiento}</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                setStatusFilter(statusFilter === 'sin_seguimiento' ? 'all' : 'sin_seguimiento')
              }
              style={[
                styles.kpiBox,
                {
                  backgroundColor:
                    statusFilter === 'sin_seguimiento'
                      ? isDark
                        ? '#4c0519'
                        : '#ffe4e6'
                      : isDark
                      ? '#18181b'
                      : '#ffffff',
                  borderColor:
                    statusFilter === 'sin_seguimiento'
                      ? '#f43f5e'
                      : isDark
                      ? '#27272a'
                      : '#e4e4e7',
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: '#f43f5e' }]}>⚠️ FALTAN SEGUIMIENTO</Text>
              <Text style={[styles.kpiValue, { color: '#f43f5e' }]}>{metrics.sinSeguimiento}</Text>
            </Pressable>

            <View
              style={[
                styles.kpiBox,
                {
                  backgroundColor: isDark ? '#18181b' : '#ffffff',
                  borderColor: isDark ? '#27272a' : '#e4e4e7',
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>COBERTURA</Text>
              <Text
                style={[
                  styles.kpiValue,
                  {
                    color:
                      metrics.cobertura >= 70
                        ? '#10b981'
                        : metrics.cobertura >= 40
                        ? '#f59e0b'
                        : '#f43f5e',
                  },
                ]}
              >
                {metrics.cobertura}%
              </Text>
            </View>
          </View>
        </View>

        {/* BARRA DE FILTROS & BUSCADOR */}
        <View
          style={[
            styles.filterBar,
            {
              backgroundColor: isDark ? '#111114' : '#f1f5f9',
              borderBottomColor: isDark ? '#27272a' : '#e2e8f0',
            },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterPillsScroll}
          >
            <Pressable
              onPress={() => setStatusFilter('all')}
              style={[
                styles.filterPill,
                statusFilter === 'all'
                  ? styles.filterPillActive
                  : {
                      backgroundColor: isDark ? '#18181b' : '#ffffff',
                      borderColor: isDark ? '#27272a' : '#cbd5e1',
                    },
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: statusFilter === 'all' ? '#09090b' : palette.textPrimary },
                ]}
              >
                Todos ({metrics.total})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setStatusFilter('sin_seguimiento')}
              style={[
                styles.filterPill,
                statusFilter === 'sin_seguimiento'
                  ? { backgroundColor: '#e11d48', borderColor: '#f43f5e' }
                  : {
                      backgroundColor: isDark ? '#271015' : '#fff1f2',
                      borderColor: isDark ? '#4c0519' : '#fecdd3',
                    },
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: statusFilter === 'sin_seguimiento' ? '#ffffff' : '#f43f5e' },
                ]}
              >
                ⚠️ Faltan seguimiento ({metrics.sinSeguimiento})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setStatusFilter('con_seguimiento')}
              style={[
                styles.filterPill,
                statusFilter === 'con_seguimiento'
                  ? { backgroundColor: '#059669', borderColor: '#10b981' }
                  : {
                      backgroundColor: isDark ? '#06281e' : '#f0fdf4',
                      borderColor: isDark ? '#064e3b' : '#bbf7d0',
                    },
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: statusFilter === 'con_seguimiento' ? '#ffffff' : '#10b981' },
                ]}
              >
                ✅ Con seguimiento ({metrics.conSeguimiento})
              </Text>
            </Pressable>
          </ScrollView>

          {/* Buscador + Botón Copiar Teléfonos */}
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: isDark ? '#18181b' : '#ffffff',
                  borderColor: isDark ? '#27272a' : '#cbd5e1',
                },
              ]}
            >
              <Icon name="Search" size={14} color={palette.textSubtle} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Buscar cliente, teléfono o nota..."
                placeholderTextColor={palette.placeholder}
                style={[styles.searchInput, { color: palette.textPrimary }]}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Icon name="X" size={14} color={palette.textSubtle} />
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={handleCopyAllPhones}
              style={[
                styles.copyPhonesBtn,
                {
                  backgroundColor: isDark ? '#18181b' : '#ffffff',
                  borderColor: isDark ? '#27272a' : '#cbd5e1',
                },
              ]}
            >
              <Icon
                name={copiedFeedback ? 'Check' : 'Copy'}
                size={13}
                color={copiedFeedback ? '#10b981' : '#f59e0b'}
              />
              <Text
                style={[
                  styles.copyPhonesText,
                  { color: copiedFeedback ? '#10b981' : palette.textPrimary },
                ]}
              >
                {copiedFeedback ? '¡Copiados!' : 'Copiar teléfonos'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* LISTADO DE PROSPECTOS */}
        <ScrollView
          style={styles.leadsList}
          contentContainerStyle={[
            styles.leadsListContent,
            { paddingBottom: Math.max(insets.bottom + 80, 96) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {filteredLeads.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name="Search" size={36} color={palette.textSubtle} />
              <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
                No se encontraron prospectos
              </Text>
              <Text style={[styles.emptySubtitle, { color: palette.textSubtle }]}>
                {scope === 'period'
                  ? 'No hay prospectos en la semana para este filtro. Prueba seleccionando "Captados del Mes" o cambiando de asesor.'
                  : 'Prueba cambiando los filtros o borrando el término de búsqueda.'}
              </Text>
            </View>
          ) : (
            filteredLeads.map((lead, idx) => {
              const isManaged =
                scope === 'month'
                  ? lead.hasMonthFollowUp || lead.hasFollowUp
                  : lead.hasPeriodFollowUp || lead.hasFollowUp;
              const isExpanded = expandedLeadId === lead.leadId;
              const bitacorasCount = lead.allBitacoras?.length || 0;

              return (
                <View
                  key={lead.leadId}
                  style={[
                    styles.leadCard,
                    {
                      backgroundColor: isDark ? '#121215' : '#ffffff',
                      borderColor: !isManaged
                        ? isDark
                          ? 'rgba(244, 63, 94, 0.45)'
                          : '#fca5a5'
                        : isDark
                        ? '#27272a'
                        : '#e4e4e7',
                    },
                  ]}
                >
                  {/* Top Bar: #N + Name + Badges */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.leadHeaderLeft}>
                      <View
                        style={[
                          styles.indexPill,
                          { backgroundColor: isDark ? '#27272a' : '#f4f4f5' },
                        ]}
                      >
                        <Text style={[styles.indexPillText, { color: palette.textSubtle }]}>
                          #{idx + 1}
                        </Text>
                      </View>
                      <Text
                        style={[styles.leadName, { color: isDark ? '#ffffff' : '#09090b' }]}
                        numberOfLines={1}
                      >
                        {lead.clientName}
                      </Text>
                      <View
                        style={[
                          styles.statusTag,
                          { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusTagText,
                            { color: isDark ? '#9ca3af' : '#4b5563' },
                          ]}
                        >
                          {lead.status.toUpperCase()}
                        </Text>
                      </View>
                      {lead.fromTransfer ? (
                        <View
                          style={[
                            styles.sourceTag,
                            {
                              backgroundColor: 'rgba(168, 85, 247, 0.15)',
                              borderColor: 'rgba(168, 85, 247, 0.35)',
                            },
                          ]}
                        >
                          <Text style={[styles.sourceTagText, { color: '#c084fc', fontWeight: '700' }]}>
                            Traslado / Calle
                          </Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.sourceTag,
                            {
                              backgroundColor: lead.isPeriodCreated
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(59, 130, 246, 0.15)',
                              borderColor: lead.isPeriodCreated
                                ? 'rgba(245, 158, 11, 0.35)'
                                : 'rgba(59, 130, 246, 0.35)',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.sourceTagText,
                              {
                                color: lead.isPeriodCreated ? '#f59e0b' : '#60a5fa',
                                fontWeight: '700',
                              },
                            ]}
                          >
                            {lead.isPeriodCreated ? 'Captado Semana' : 'Base Anterior'}
                          </Text>
                        </View>
                      )}
                      {lead.source ? (
                        <View
                          style={[
                            styles.sourceTag,
                            {
                              backgroundColor: isDark ? '#18181b' : '#f8fafc',
                              borderColor: isDark ? '#27272a' : '#e2e8f0',
                            },
                          ]}
                        >
                          <Text style={[styles.sourceTagText, { color: palette.textSubtle }]}>
                            {lead.source}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* Metadata Row: Captado + Asesor + Proyecto */}
                  <View style={styles.leadMetaRow}>
                    <View style={styles.metaItem}>
                      <Icon name="Clock" size={11} color={palette.textSubtle} />
                      <Text style={[styles.metaText, { color: palette.textSubtle }]}>
                        Captado:{' '}
                        <Text style={{ color: palette.textPrimary, fontWeight: '600' }}>
                          {lead.createdAtFormatted}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <View style={styles.advisorDot} />
                      <Text style={[styles.metaText, { color: palette.textSubtle }]}>
                        Asesor:{' '}
                        <Text style={{ color: palette.textPrimary, fontWeight: '600' }}>
                          {lead.advisorName}
                        </Text>
                      </Text>
                    </View>
                    {lead.project ? (
                      <View style={styles.metaItem}>
                        <Icon name="Building2" size={11} color={palette.textSubtle} />
                        <Text style={[styles.metaText, { color: palette.textSubtle }]}>
                          {lead.project}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Phone + Action buttons */}
                  <View style={styles.cardActionsRow}>
                    {lead.phone && lead.phone !== 'Sin teléfono' ? (
                      <Pressable
                        onPress={() => handleCopySinglePhone(lead.phone)}
                        style={[
                          styles.phoneBadge,
                          {
                            backgroundColor: isDark ? '#06281e' : '#ecfdf5',
                            borderColor: isDark ? '#064e3b' : '#a7f3d0',
                          },
                        ]}
                      >
                        <Icon name="Phone" size={11} color="#10b981" />
                        <Text style={styles.phoneText}>{lead.phone}</Text>
                        <Icon name="Copy" size={10} color="#10b981" />
                      </Pressable>
                    ) : (
                      <View
                        style={[
                          styles.phoneBadge,
                          {
                            backgroundColor: isDark ? '#18181b' : '#f4f4f5',
                            borderColor: isDark ? '#27272a' : '#e4e4e7',
                          },
                        ]}
                      >
                        <Text style={[styles.phoneText, { color: palette.textSubtle }]}>
                          Sin teléfono
                        </Text>
                      </View>
                    )}

                    {/* Accordion toggle: Ver seguimiento (N) */}
                    <Pressable
                      onPress={() => setExpandedLeadId(isExpanded ? null : lead.leadId)}
                      style={[
                        styles.followUpToggleBtn,
                        {
                          backgroundColor: isExpanded
                            ? isDark
                              ? '#27272a'
                              : '#e2e8f0'
                            : isDark
                            ? '#18181b'
                            : '#f8fafc',
                          borderColor: isDark ? '#27272a' : '#cbd5e1',
                        },
                      ]}
                    >
                      <Icon name="Clock" size={11} color={isDark ? '#f59e0b' : '#d97706'} />
                      <Text
                        style={[
                          styles.followUpToggleText,
                          { color: isDark ? '#f59e0b' : '#d97706' },
                        ]}
                      >
                        Ver seguimiento ({bitacorasCount})
                      </Text>
                      <Icon
                        name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                        size={12}
                        color={palette.textSubtle}
                      />
                    </Pressable>

                    {/* Chat button */}
                    <Pressable
                      onPress={() => {
                        onClose();
                        onOpenChat(lead.leadId);
                      }}
                      style={[
                        styles.openChatBtn,
                        {
                          backgroundColor: isDark ? '#1e293b' : '#e0f2fe',
                          borderColor: isDark ? '#334155' : '#bae6fd',
                        },
                      ]}
                    >
                      <Icon name="MessageSquare" size={11} color="#0284c7" />
                      <Text style={styles.openChatText}>Ver en chat ↗</Text>
                    </Pressable>
                  </View>

                  {/* FALTA SEGUIMIENTO ALERT BANNER */}
                  {!isManaged && (
                    <View
                      style={[
                        styles.missingAlertBanner,
                        {
                          backgroundColor: isDark ? '#271015' : '#fff1f2',
                          borderColor: isDark ? '#4c0519' : '#fecdd3',
                        },
                      ]}
                    >
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="AlertCircle" size={13} color="#f43f5e" />
                        <Text style={styles.missingAlertText} numberOfLines={2}>
                          FALTA SEGUIMIENTO: Sin llamadas ni bitácoras registradas en este período.
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          onClose();
                          onOpenFicha(lead.leadId);
                        }}
                        style={styles.contactNowBtn}
                      >
                        <Text style={styles.contactNowBtnText}>Ficha 📝</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* EXPANDED FOLLOW-UP TIMELINE */}
                  {isExpanded && (
                    <View
                      style={[
                        styles.expandedTimeline,
                        {
                          backgroundColor: isDark ? '#0c0c0e' : '#f8fafc',
                          borderColor: isDark ? '#27272a' : '#e2e8f0',
                        },
                      ]}
                    >
                      <Text style={[styles.timelineHeaderTitle, { color: palette.textPrimary }]}>
                        Historial de bitácoras y llamadas ({bitacorasCount}):
                      </Text>

                      {bitacorasCount === 0 ? (
                        <Text style={[styles.emptyTimelineText, { color: palette.textSubtle }]}>
                          No hay bitácoras comerciales registradas para este prospecto aún.
                        </Text>
                      ) : (
                        lead.allBitacoras.map((b, bIdx) => (
                          <View
                            key={b.id || bIdx}
                            style={[
                              styles.timelineItem,
                              bIdx < lead.allBitacoras.length - 1 && {
                                borderBottomColor: isDark ? '#1f1f23' : '#e2e8f0',
                                borderBottomWidth: 1,
                              },
                            ]}
                          >
                            <View style={styles.timelineItemHeader}>
                              <Text style={styles.timelineItemAction}>{b.action || 'Gestión'}</Text>
                              <Text style={[styles.timelineItemDate, { color: palette.textSubtle }]}>
                                {b.fecha}
                              </Text>
                            </View>
                            <Text style={[styles.timelineItemDesc, { color: palette.textPrimary }]}>
                              {b.description || 'Sin detalles registrados.'}
                            </Text>
                            <Text style={[styles.timelineItemAuthor, { color: palette.textSubtle }]}>
                              Registrado por: {b.asesor}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* MODAL FOOTER */}
        <View
          style={[
            styles.footer,
            {
              backgroundColor: isDark ? '#111114' : '#ffffff',
              borderTopColor: isDark ? '#27272a' : '#e4e4e7',
              paddingBottom: Math.max(insets.bottom + 8, 14),
            },
          ]}
        >
          <View style={styles.footerCountRow}>
            <Icon name="CheckCircle" size={13} color="#10b981" />
            <Text style={[styles.footerCountText, { color: palette.textPrimary }]}>
              Mostrando <Text style={{ fontWeight: '700' }}>{filteredLeads.length}</Text> de{' '}
              <Text style={{ fontWeight: '700' }}>{baseLeads.length}</Text> prospectos ({scope === 'month' ? 'del mes' : 'de la semana'}).
            </Text>
          </View>

          <Pressable
            onPress={onClose}
            style={[styles.footerCloseBtn, { backgroundColor: isDark ? '#27272a' : '#f4f4f5' }]}
          >
            <Text style={[styles.footerCloseBtnText, { color: palette.textPrimary }]}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodSubtitle: {
    fontSize: 11.5,
    marginBottom: 6,
  },
  advisorSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  advisorTitle: {
    fontSize: 16,
    fontWeight: '800',
    flexShrink: 1,
  },
  changeAdvisorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  changeAdvisorBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  advisorDropdownList: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  advisorDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150,150,150,0.1)',
  },
  advisorDropdownItemActive: {
    backgroundColor: '#f59e0b',
  },
  advisorDropdownItemText: {
    fontSize: 11.5,
  },
  helperExplanation: {
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  scopeTabsBar: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    gap: 4,
    marginBottom: 10,
  },
  scopeTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 9,
    gap: 6,
  },
  scopeTabBtnActive: {
    backgroundColor: '#f59e0b',
  },
  scopeTabText: {
    fontSize: 11,
    fontWeight: '600',
  },
  scopeTabTextActive: {
    fontWeight: '800',
    color: '#09090b',
  },
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  countPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 6,
  },
  kpiBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  filterBar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  filterPillsScroll: {
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  filterPillActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: 0,
  },
  copyPhonesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  copyPhonesText: {
    fontSize: 11,
    fontWeight: '700',
  },
  leadsList: {
    flex: 1,
  },
  leadsListContent: {
    padding: 14,
    gap: 10,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 240,
  },
  leadCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leadHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  indexPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  indexPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  leadName: {
    fontSize: 14,
    fontWeight: '800',
    flexShrink: 1,
  },
  statusTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusTagText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  sourceTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  sourceTagText: {
    fontSize: 9.5,
    fontWeight: '600',
  },
  leadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  advisorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#f59e0b',
  },
  metaText: {
    fontSize: 11,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  phoneText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10b981',
  },
  followUpToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  followUpToggleText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  openChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  openChatText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0284c7',
  },
  missingAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  missingAlertText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#f43f5e',
    flex: 1,
  },
  contactNowBtn: {
    backgroundColor: '#e11d48',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  contactNowBtnText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },
  expandedTimeline: {
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  timelineHeaderTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  emptyTimelineText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  timelineItem: {
    paddingVertical: 6,
    gap: 3,
  },
  timelineItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineItemAction: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
  },
  timelineItemDate: {
    fontSize: 10,
  },
  timelineItemDesc: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  timelineItemAuthor: {
    fontSize: 10,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  footerCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  footerCountText: {
    fontSize: 11,
  },
  footerCloseBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  footerCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
