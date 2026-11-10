import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  generateLossInsight,
  getDashboardMetrics,
  type AiInsights,
  type DashboardMetrics,
} from '../services/enterprise';
import { ExportLeadsModal } from '../components/ExportLeadsModal';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { Icon } from '../components/Icon';
import type { RootStackParams } from '../types';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: 'Nuevo', color: '#0ea5e9' },
  active: { label: 'Activo', color: '#B7871C' },
  qualified: { label: 'Calificado', color: '#f59e0b' },
  scheduled: { label: 'Agendado', color: '#06b6d4' },
  lost: { label: 'Perdido', color: '#ef4444' },
  closed: { label: 'Vendido', color: '#10b981' },
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp Orgánico (317)',
  meta_ads: 'Meta Ads (FB/IG)',
  google_ads: 'Google Ads',
  web: 'Sitio Web',
  advisor_whatsapp: 'WhatsApp Directo Asesor',
  manual: 'Manual',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram DM',
};

const LOSS_LABEL: Record<string, string> = {
  precio: 'Precio / presupuesto',
  ubicacion: 'Ubicación / zona',
  competencia: 'Competencia',
  sin_respuesta: 'Dejó de responder',
  tiempo: 'No es el momento',
  no_califica: 'No califica',
  atencion: 'Atención / demora',
  otro: 'Otro',
  ninguno: 'Sin riesgo claro',
};

const QUICK_PILLS = [
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: '7d', label: 'Últimos 7 días' },
  { key: '14d', label: 'Últimas 2 semanas' },
  { key: '2026-10', label: 'Octubre 2026 (Mes actual)' },
  { key: '2026-09', label: 'Septiembre 2026' },
  { key: '2026-08', label: 'Agosto 2026' },
  { key: 'all', label: 'Todo el Período (Ago - Oct)' },
];

export function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { palette } = useTheme();
  const { companyId, profile, isAdmin } = useAuth();

  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrendDay, setSelectedTrendDay] = useState<{ date: string; count: number } | null>(null);

  const canExport = isAdmin;

  const load = useCallback(
    async (forceRefresh = false, isPull = false) => {
      if (!companyId) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getDashboardMetrics(companyId, forceRefresh);
        setData(res);
        setSelectedMonth((prev) => {
          if (prev && res.monthsData && res.monthsData[prev]) return prev;
          if (res.monthsData && res.monthsData[currentMonthKey]) return currentMonthKey;
          return res.defaultMonth || res.availableMonths?.[0]?.key || 'all';
        });
      } catch (err) {
        console.warn('[DashboardScreen] error:', err);
        setError('No se pudieron cargar las métricas.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, currentMonthKey]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const activeMetrics = useMemo(() => {
    if (!data) return null;
    if (selectedMonth && selectedMonth !== 'all' && data.monthsData?.[selectedMonth]) {
      return data.monthsData[selectedMonth];
    }
    if (selectedMonth === 'all' && data.monthsData?.['all']) {
      return data.monthsData['all'];
    }
    return data;
  }, [data, selectedMonth]);

  const periodOptions = useMemo<SelectOption[]>(() => {
    if (!data?.availableMonths?.length) return [];
    return data.availableMonths.map((m) => {
      let group = '📅 Mes a Mes (Pauta Activa)';
      if (m.group === 'dias' || ['today', 'yesterday', '7d', '14d', '30d'].includes(m.key)) {
        group = '⚡ Días y Semanas';
      } else if (m.key === 'all') {
        group = '🚀 Histórico Completo de Pauta';
      }
      return {
        value: m.key,
        label: `${m.label} (${m.count} leads)`,
        group,
      };
    });
  }, [data]);

  return (
    <View style={[styles.root, { backgroundColor: palette.bgCanvas }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true, true)}
            tintColor={palette.brand}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header (réplica exacta de DashboardPage.tsx) */}
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top + 10, 16),
              borderBottomColor: palette.border,
              backgroundColor: palette.bgCanvas,
            },
          ]}
        >
          <View style={styles.headerTitleBlock}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>
                Resumen Comercial de Pauta
              </Text>
              <View
                style={[
                  styles.activeCampaignPill,
                  {
                    backgroundColor: palette.emeraldBg,
                    borderColor: palette.emeraldBorder,
                  },
                ]}
              >
                <Text style={[styles.activeCampaignText, { color: palette.emeraldText }]}>
                  Campañas Activas
                </Text>
              </View>
            </View>
            <Text style={[styles.subtitle, { color: palette.textSubtle }]}>
              Hola{profile?.displayName ? `, ${profile.displayName}` : ''} · Indicadores de
              captación digital, conversión y citas
            </Text>
          </View>

          <View style={styles.controlsRow}>
            {periodOptions.length > 0 && (
              <SelectModal
                value={selectedMonth}
                options={periodOptions}
                onChange={setSelectedMonth}
                title="Seleccionar período"
                icon="Calendar"
                compact
                style={{ minWidth: 168, flexShrink: 1 }}
              />
            )}

            {canExport && (
              <Pressable
                onPress={() => navigation.navigate('Database')}
                style={[
                  styles.actionChip,
                  {
                    backgroundColor: palette.amberBg,
                    borderColor: palette.amberBorder,
                  },
                ]}
              >
                <Icon name="Database" size={13} color={palette.amberText} />
                <Text style={[styles.actionChipText, { color: palette.amberText }]}>
                  Base de Datos (13k)
                </Text>
              </Pressable>
            )}

            {canExport && (
              <Pressable
                onPress={() => setExportOpen(true)}
                style={[
                  styles.actionChip,
                  {
                    backgroundColor: palette.emeraldBg,
                    borderColor: palette.emeraldBorder,
                  },
                ]}
              >
                <Text style={[styles.actionChipText, { color: palette.emeraldText }]}>
                  📥 Exportar (.csv / .xlsx)
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => load(true)}
              style={[
                styles.actionChip,
                {
                  backgroundColor: palette.bgElevated,
                  borderColor: palette.borderStrong,
                },
              ]}
            >
              <Text style={[styles.actionChipText, { color: palette.textSecondary }]}>
                ↻ Actualizar
              </Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={palette.brand} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Text style={{ color: palette.roseText, fontSize: 13 }}>{error}</Text>
            <Pressable
              onPress={() => load(true)}
              style={[
                styles.actionChip,
                {
                  backgroundColor: palette.bgElevated,
                  borderColor: palette.borderStrong,
                  marginTop: 10,
                },
              ]}
            >
              <Text style={[styles.actionChipText, { color: palette.textSecondary }]}>
                Reintentar
              </Text>
            </Pressable>
          </View>
        ) : activeMetrics ? (
          <View style={styles.body}>
            {/* Pestañas de Filtro Rápido (Días, Semanas, Meses) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickPillsScroll}
            >
              {QUICK_PILLS.map((pill) => {
                const count =
                  data?.monthsData?.[pill.key]?.totalLeads ??
                  data?.availableMonths?.find((m) => m.key === pill.key)?.count;
                const isSelected = selectedMonth === pill.key;
                return (
                  <Pressable
                    key={pill.key}
                    onPress={() => setSelectedMonth(pill.key)}
                    style={[
                      styles.quickPill,
                      isSelected
                        ? {
                            backgroundColor: '#10b981',
                            borderColor: '#10b981',
                          }
                        : {
                            backgroundColor: palette.bgSurface,
                            borderColor: palette.border,
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.quickPillLabel,
                        {
                          color: isSelected ? '#09090b' : palette.textMuted,
                          fontWeight: isSelected ? '700' : '600',
                        },
                      ]}
                    >
                      {pill.label}
                    </Text>
                    {typeof count === 'number' && (
                      <View
                        style={[
                          styles.quickPillCount,
                          {
                            backgroundColor: isSelected
                              ? 'rgba(9, 9, 11, 0.2)'
                              : palette.bgElevated,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.quickPillCountText,
                            { color: isSelected ? '#09090b' : palette.textMuted },
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Banner Informativo: Pauta vs Base Histórica */}
            <View
              style={[
                styles.infoBanner,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.infoBannerRow}>
                <View style={[styles.greenDot, { backgroundColor: palette.emerald }]} />
                <Text style={[styles.infoBannerText, { color: palette.textSecondary }]}>
                  Mostrando{' '}
                  <Text style={{ color: palette.emeraldText, fontWeight: '700' }}>
                    {activeMetrics.totalLeads} leads de pauta operativa Línea 317
                  </Text>{' '}
                  (
                  {selectedMonth === 'all'
                    ? 'Todo el período (Agosto - Octubre 2026)'
                    : activeMetrics.label || selectedMonth}
                  ).
                </Text>
              </View>
              {canExport && (
                <View style={styles.infoBannerActionRow}>
                  <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                    ¿Buscas los 11.787 contactos históricos de SmartHome?
                  </Text>
                  <Pressable onPress={() => navigation.navigate('Database')}>
                    <Text style={{ color: palette.amberText, fontSize: 11, fontWeight: '700' }}>
                      Ver Base de Datos ➔
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Tarjetas KPI Principales (Cuadrícula 2x2 móvil idéntica a grid-cols-2) */}
            <View style={styles.kpiGrid}>
              <KpiCard
                label="Leads Pauta Línea 317"
                value={activeMetrics.totalLeads}
                hint={
                  selectedMonth === 'all'
                    ? `+${activeMetrics.newLeads7d} esta semana`
                    : activeMetrics.label || ''
                }
              />
              <KpiCard
                label="Conversión Pauta"
                value={`${activeMetrics.conversionRate}%`}
                hint="agendados + cerrados"
              />
              <KpiCard
                label="Citas próximas"
                value={activeMetrics.appointments?.upcoming ?? 0}
                hint={`${activeMetrics.appointments?.total ?? 0} en total`}
              />
              <KpiCard
                label="Nuevos (30d)"
                value={activeMetrics.newLeads30d}
                hint="últimos 30 días"
              />
            </View>

            {/* Separación de Canales: Línea 317 vs WhatsApp Asesores */}
            {activeMetrics.inboxBreakdown && (
              <View style={styles.channelStack}>
                <View
                  style={[
                    styles.channelCard,
                    {
                      backgroundColor: palette.emeraldBg,
                      borderColor: palette.emeraldBorder,
                    },
                  ]}
                >
                  <Text style={[styles.channelLabel, { color: palette.emeraldText }]}>
                    🏢 Línea Central 317 (Corporativa)
                  </Text>
                  <Text style={[styles.channelValue, { color: palette.textPrimary }]}>
                    {activeMetrics.inboxBreakdown.central317Count}
                  </Text>
                  <Text style={[styles.channelHint, { color: palette.textSubtle }]}>
                    Pauta Meta/Google, Sitio Web y WhatsApp 317
                  </Text>
                </View>

                <View
                  style={[
                    styles.channelCard,
                    {
                      backgroundColor: palette.amberBg,
                      borderColor: palette.amberBorder,
                    },
                  ]}
                >
                  <Text style={[styles.channelLabel, { color: palette.amberText }]}>
                    👤 WhatsApp Directo Asesores
                  </Text>
                  <Text style={[styles.channelValue, { color: palette.textPrimary }]}>
                    {activeMetrics.inboxBreakdown.advisorDirectCount}
                  </Text>
                  <Text style={[styles.channelHint, { color: palette.textSubtle }]}>
                    QR / enlaces propios del asesor (separados del 317)
                  </Text>
                </View>

                <View
                  style={[
                    styles.channelCard,
                    {
                      backgroundColor: palette.brandBg,
                      borderColor: palette.brandBorder,
                    },
                  ]}
                >
                  <Text style={[styles.channelLabel, { color: palette.brandText }]}>
                    🔄 Contactos de Pauta del Período
                  </Text>
                  <Text style={[styles.channelValue, { color: palette.textPrimary }]}>
                    {activeMetrics.inboxBreakdown.allContactsTotal}
                  </Text>
                  <Text style={[styles.channelHint, { color: palette.textSubtle }]}>
                    Contactos registrados en este rango
                  </Text>
                </View>
              </View>
            )}

            {/* Análisis IA de leads */}
            {activeMetrics.aiInsights && companyId && (
              <AiInsightsSection
                insights={activeMetrics.aiInsights}
                companyId={companyId}
                canGenerate={isAdmin}
              />
            )}

            {/* Leads por estado (Línea 317) */}
            <Panel title="Leads por estado (Línea 317)">
              <View style={styles.barsList}>
                {(activeMetrics.leadsByStatus || []).map((s) => {
                  const meta = STATUS_META[s.status] ?? { label: s.status, color: '#52525b' };
                  const pct =
                    activeMetrics.totalLeads > 0 ? (s.count / activeMetrics.totalLeads) * 100 : 0;
                  return (
                    <View key={s.status} style={styles.barRow}>
                      <Text
                        numberOfLines={1}
                        style={[styles.barLabel, { color: palette.textMuted, width: 78 }]}
                      >
                        {meta.label}
                      </Text>
                      <View
                        style={[
                          styles.barTrack,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <View
                          style={[
                            styles.barFill,
                            { width: `${Math.min(pct, 100)}%`, backgroundColor: meta.color },
                          ]}
                        />
                      </View>
                      <Text style={[styles.barCount, { color: palette.textSecondary }]}>
                        {s.count}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Panel>

            {/* Leads por asesor */}
            <Panel title="Leads por asesor">
              {!activeMetrics.leadsByAdvisor?.length ? (
                <Text style={{ color: palette.textSubtle, fontSize: 12 }}>Sin datos.</Text>
              ) : (
                <View style={styles.barsList}>
                  {activeMetrics.leadsByAdvisor.map((a) => {
                    const max = Math.max(
                      ...activeMetrics.leadsByAdvisor.map((x) => x.count),
                      1
                    );
                    const pct = (a.count / max) * 100;
                    return (
                      <View key={a.advisorId ?? a.name} style={styles.barRow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.barLabel, { color: palette.textMuted, width: 108 }]}
                        >
                          {a.name}
                        </Text>
                        <View
                          style={[
                            styles.barTrack,
                            { backgroundColor: palette.bgElevated },
                          ]}
                        >
                          <View
                            style={[
                              styles.barFill,
                              { width: `${Math.min(pct, 100)}%`, backgroundColor: palette.brand },
                            ]}
                          />
                        </View>
                        <Text style={[styles.barCount, { color: palette.textSecondary }]}>
                          {a.count}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Panel>

            {/* Nuevos leads (últimos 14 días) */}
            <Panel
              title="Nuevos leads (últimos 14 días)"
              rightLabel={
                selectedTrendDay
                  ? `${selectedTrendDay.date}: ${selectedTrendDay.count} leads`
                  : undefined
              }
            >
              <View style={styles.trendRow}>
                {(activeMetrics.dailyNewLeads || []).map((d) => {
                  const max = Math.max(
                    ...(activeMetrics.dailyNewLeads || []).map((x) => x.count),
                    1
                  );
                  const h = (d.count / max) * 100;
                  const day = d.date.slice(8, 10);
                  const isActive = selectedTrendDay?.date === d.date;
                  return (
                    <Pressable
                      key={d.date}
                      onPress={() => setSelectedTrendDay(d)}
                      style={styles.trendCol}
                    >
                      <View style={styles.trendBarArea}>
                        <View
                          style={[
                            styles.trendBar,
                            {
                              height: `${Math.max(h, 4)}%`,
                              backgroundColor: isActive ? palette.brandLight : palette.brand,
                              opacity: isActive ? 1 : 0.78,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.trendDayText, { color: palette.textSubtle }]}>
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Panel>

            {/* Citas */}
            <Panel title="Citas">
              <View style={styles.citasStatsRow}>
                <View style={styles.citaStatCol}>
                  <Text style={[styles.citaStatVal, { color: palette.emeraldText }]}>
                    {activeMetrics.appointments?.upcoming ?? 0}
                  </Text>
                  <Text style={[styles.citaStatLabel, { color: palette.textSubtle }]}>
                    Próximas
                  </Text>
                </View>
                <View style={styles.citaStatCol}>
                  <Text style={[styles.citaStatVal, { color: palette.skyText }]}>
                    {activeMetrics.appointments?.completed ?? 0}
                  </Text>
                  <Text style={[styles.citaStatLabel, { color: palette.textSubtle }]}>
                    Completadas
                  </Text>
                </View>
                <View style={styles.citaStatCol}>
                  <Text style={[styles.citaStatVal, { color: palette.roseText }]}>
                    {activeMetrics.appointments?.canceled ?? 0}
                  </Text>
                  <Text style={[styles.citaStatLabel, { color: palette.textSubtle }]}>
                    Canceladas
                  </Text>
                </View>
              </View>
            </Panel>

            {/* Citas por asesor */}
            <Panel title="Citas por asesor">
              {!activeMetrics.appointmentsByAdvisor?.length ? (
                <Text style={{ color: palette.textSubtle, fontSize: 12 }}>
                  Sin citas registradas.
                </Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {activeMetrics.appointmentsByAdvisor.map((adv) => {
                    const max = Math.max(
                      ...activeMetrics.appointmentsByAdvisor.map((x) => x.total),
                      1
                    );
                    const pct = (adv.total / max) * 100;
                    return (
                      <View key={adv.advisorId ?? adv.name} style={{ gap: 5 }}>
                        <View style={styles.advisorApptTop}>
                          <Text
                            numberOfLines={1}
                            style={{ color: palette.textSecondary, fontSize: 12, flex: 1 }}
                          >
                            {adv.name}
                          </Text>
                          <Text
                            style={{
                              color: palette.textPrimary,
                              fontSize: 12,
                              fontWeight: '600',
                            }}
                          >
                            {adv.total}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.barTrack,
                            { backgroundColor: palette.bgElevated },
                          ]}
                        >
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: palette.emerald,
                              },
                            ]}
                          />
                        </View>
                        <View style={styles.advisorApptMeta}>
                          <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                            <Text style={{ color: palette.emeraldText }}>{adv.upcoming}</Text>{' '}
                            próximas
                          </Text>
                          <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                            <Text style={{ color: palette.skyText }}>{adv.completed}</Text>{' '}
                            completadas
                          </Text>
                          <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                            <Text style={{ color: palette.roseText }}>{adv.canceled}</Text>{' '}
                            canceladas
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </Panel>

            {/* Atribución por Fuente (Línea 317) */}
            <Panel title="Atribución por Fuente (Línea 317)">
              {!activeMetrics.leadsBySource?.length ? (
                <Text style={{ color: palette.textSubtle, fontSize: 12 }}>Sin datos.</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  <View style={styles.sourceWrap}>
                    {activeMetrics.leadsBySource.map((s) => (
                      <View
                        key={s.source}
                        style={[
                          styles.sourceChip,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <Text style={{ fontSize: 12, color: palette.textSecondary }}>
                          {SOURCE_LABEL[s.source] ?? s.source}:{' '}
                          <Text style={{ color: palette.textPrimary, fontWeight: '600' }}>
                            {s.count}
                          </Text>
                        </Text>
                      </View>
                    ))}
                  </View>

                  {!!activeMetrics.firstTouchBySource?.length && (
                    <View
                      style={[
                        styles.firstTouchBlock,
                        { borderTopColor: palette.border },
                      ]}
                    >
                      <Text style={[styles.firstTouchTitle, { color: palette.textSubtle }]}>
                        1RA FUENTE HISTÓRICA (FIRST TOUCH INMUTABLE)
                      </Text>
                      <View style={styles.sourceWrap}>
                        {activeMetrics.firstTouchBySource.map((ft) => (
                          <View
                            key={ft.source}
                            style={[
                              styles.firstTouchChip,
                              {
                                backgroundColor: palette.bgCanvas,
                                borderColor: palette.border,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 11, color: palette.textMuted }}>
                              {SOURCE_LABEL[ft.source] ?? ft.source}:{' '}
                              <Text style={{ color: palette.emeraldText, fontWeight: '600' }}>
                                {ft.count}
                              </Text>
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </Panel>

            {/* Proyectos de Interés */}
            <Panel title="Proyectos de Interés">
              {!activeMetrics.leadsByProject?.length ? (
                <Text style={{ color: palette.textSubtle, fontSize: 12 }}>
                  Sin proyectos identificados aún.
                </Text>
              ) : (
                <View style={styles.barsList}>
                  {activeMetrics.leadsByProject.slice(0, 8).map((p) => {
                    const max = Math.max(
                      ...(activeMetrics.leadsByProject || []).map((x) => x.count),
                      1
                    );
                    const pct = (p.count / max) * 100;
                    return (
                      <View key={p.project} style={styles.barRow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.barLabel, { color: palette.textSecondary, width: 140 }]}
                        >
                          🏡 {p.project}
                        </Text>
                        <View
                          style={[
                            styles.barTrack,
                            { backgroundColor: palette.bgElevated },
                          ]}
                        >
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: palette.amber,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.barCount, { color: palette.textPrimary }]}>
                          {p.count}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Panel>

            {activeMetrics.generatedAt ? (
              <Text style={[styles.updatedFooter, { color: palette.textSubtle }]}>
                Actualizado {new Date(activeMetrics.generatedAt).toLocaleString('es-CO')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {companyId && (
        <ExportLeadsModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          companyId={companyId}
        />
      )}
    </View>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.kpiCard,
        {
          backgroundColor: palette.bgSurface,
          borderColor: palette.border,
        },
      ]}
    >
      <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: palette.textPrimary }]}>{value}</Text>
      {hint ? (
        <Text style={[styles.kpiHint, { color: palette.textSubtle }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Panel({
  title,
  rightLabel,
  children,
}: {
  title: string;
  rightLabel?: string;
  children: React.ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: palette.bgSurface,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.panelHeader}>
        <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>{title}</Text>
        {rightLabel ? (
          <Text style={{ fontSize: 11, color: palette.brandText, fontWeight: '600' }}>
            {rightLabel}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function AiInsightsSection({
  insights,
  companyId,
  canGenerate,
}: {
  insights: AiInsights;
  companyId: string;
  canGenerate: boolean;
}) {
  const { palette } = useTheme();
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { analyzedCount, avgScore, temperature, lostTotal, lostAnalyzed, lossReasons } = insights;
  const maxLoss = Math.max(...(lossReasons || []).map((r) => r.count), 1);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await generateLossInsight(companyId);
      setInsight(r.insight);
    } catch (err) {
      const message = (err as { message?: string })?.message;
      setError(message || 'No se pudo generar la recomendación.');
    } finally {
      setLoading(false);
    }
  };

  if (!analyzedCount) {
    return (
      <View
        style={[
          styles.panel,
          { backgroundColor: palette.bgSurface, borderColor: palette.border },
        ]}
      >
        <View style={[styles.titleRow, { marginBottom: 8 }]}>
          <Icon name="Sparkles" size={15} color={palette.brandText} />
          <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>
            Análisis IA de leads
          </Text>
        </View>
        <Text style={{ fontSize: 12, color: palette.textSubtle, lineHeight: 18 }}>
          Aún no hay leads calificados por la IA. Usa “Analizar lead con IA” en la ficha de un
          lead, o espera al análisis automático nocturno.
        </Text>
      </View>
    );
  }

  const avgColor =
    avgScore >= 66
      ? palette.emeraldText
      : avgScore >= 33
      ? palette.amberText
      : palette.skyText;

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: palette.bgSurface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.panelHeader, { marginBottom: 14 }]}>
        <View style={styles.titleRow}>
          <Icon name="Sparkles" size={15} color={palette.brandText} />
          <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>
            Análisis IA de leads
          </Text>
        </View>
        <Text style={{ fontSize: 10, color: palette.textSubtle }}>
          {analyzedCount} calificados
        </Text>
      </View>

      {/* Score promedio + Temperatura (2x2 en móvil) */}
      <View style={styles.aiTilesGrid}>
        <View style={[styles.aiTile, { backgroundColor: palette.bgElevated }]}>
          <Text style={{ fontSize: 11, color: palette.textSubtle }}>Score promedio</Text>
          <Text style={[styles.aiTileValue, { color: avgColor }]}>{avgScore}</Text>
        </View>
        <View style={[styles.aiTile, { backgroundColor: palette.bgElevated }]}>
          <Text style={{ fontSize: 11, color: palette.textSubtle }}>🔥 Calientes</Text>
          <Text style={[styles.aiTileValue, { color: palette.emeraldText }]}>
            {temperature?.hot ?? 0}
          </Text>
        </View>
        <View style={[styles.aiTile, { backgroundColor: palette.bgElevated }]}>
          <Text style={{ fontSize: 11, color: palette.textSubtle }}>🌡️ Tibios</Text>
          <Text style={[styles.aiTileValue, { color: palette.amberText }]}>
            {temperature?.warm ?? 0}
          </Text>
        </View>
        <View style={[styles.aiTile, { backgroundColor: palette.bgElevated }]}>
          <Text style={{ fontSize: 11, color: palette.textSubtle }}>❄️ Fríos</Text>
          <Text style={[styles.aiTileValue, { color: palette.skyText }]}>
            {temperature?.cold ?? 0}
          </Text>
        </View>
      </View>

      {/* Razones de pérdida */}
      <View style={{ marginTop: 16 }}>
        <View style={[styles.panelHeader, { marginBottom: 10 }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: palette.textSubtle }}>
            📉 POR QUÉ SE PIERDEN LOS LEADS
          </Text>
          <Text style={{ fontSize: 10, color: palette.textSubtle }}>
            {lostAnalyzed} de {lostTotal} perdidos analizados
          </Text>
        </View>

        {!lossReasons?.length ? (
          <Text style={{ fontSize: 12, color: palette.textSubtle }}>
            Sin motivos de pérdida registrados todavía.
          </Text>
        ) : (
          <View style={styles.barsList}>
            {lossReasons.map((r) => {
              const pct = (r.count / maxLoss) * 100;
              const share = lostAnalyzed > 0 ? Math.round((r.count / lostAnalyzed) * 100) : 0;
              return (
                <View key={r.category} style={styles.barRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.barLabel, { color: palette.textMuted, width: 126 }]}
                  >
                    {LOSS_LABEL[r.category] ?? r.category}
                  </Text>
                  <View style={[styles.barTrack, { backgroundColor: palette.bgElevated }]}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.min(pct, 100)}%`, backgroundColor: '#ef4444' },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.barCount,
                      { color: palette.textSecondary, width: 54 },
                    ]}
                  >
                    {r.count} · {share}%
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Recomendación ejecutiva IA */}
      {canGenerate && (
        <View
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: palette.border,
          }}
        >
          {insight ? (
            <View
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: palette.brandBorder,
                backgroundColor: palette.brandBg,
                padding: 12,
                gap: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: palette.brandText,
                  letterSpacing: 0.4,
                }}
              >
                💡 RECOMENDACIÓN EJECUTIVA
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 18,
                  color: palette.textPrimary,
                }}
              >
                {insight}
              </Text>
              <Pressable onPress={generate} disabled={loading} style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: palette.brandText }}>
                  {loading ? 'Regenerando…' : 'Regenerar'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={generate}
              disabled={loading}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: palette.brandBorder,
                backgroundColor: palette.brandBg,
                paddingHorizontal: 14,
                paddingVertical: 8,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator size="small" color={palette.brandText} />
              ) : (
                <Icon name="Sparkles" size={14} color={palette.brandText} />
              )}
              <Text style={{ fontSize: 12, fontWeight: '600', color: palette.brandText }}>
                {loading ? 'Analizando…' : 'Generar recomendación IA'}
              </Text>
            </Pressable>
          )}
          {error ? (
            <Text style={{ marginTop: 6, fontSize: 11, color: palette.roseText }}>{error}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerTitleBlock: {
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  activeCampaignPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  activeCampaignText: {
    fontSize: 10,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  centerBox: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: 16,
    gap: 14,
  },
  quickPillsScroll: {
    gap: 6,
    paddingRight: 8,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickPillLabel: {
    fontSize: 12,
  },
  quickPillCount: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  quickPillCountText: {
    fontSize: 10,
    fontWeight: '700',
  },
  infoBanner: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  infoBannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  infoBannerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '48.2%',
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  kpiLabel: {
    fontSize: 11,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 4,
  },
  kpiHint: {
    fontSize: 10,
    marginTop: 2,
  },
  channelStack: {
    gap: 10,
  },
  channelCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  channelLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  channelValue: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 4,
  },
  channelHint: {
    fontSize: 10,
    marginTop: 2,
  },
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  aiTilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  aiTile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 8,
    padding: 11,
  },
  aiTileValue: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 4,
  },
  barsList: {
    gap: 10,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barLabel: {
    fontSize: 12,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barCount: {
    width: 34,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '500',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 116,
    gap: 4,
  },
  trendCol: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    gap: 4,
  },
  trendBarArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  trendDayText: {
    fontSize: 9,
  },
  citasStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  citaStatCol: {
    alignItems: 'center',
  },
  citaStatVal: {
    fontSize: 22,
    fontWeight: '600',
  },
  citaStatLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  advisorApptTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  advisorApptMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sourceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sourceChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
  },
  firstTouchBlock: {
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 6,
  },
  firstTouchTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  firstTouchChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  updatedFooter: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
});
