import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { getMarketingMetrics, type MarketingRange } from '../services/enterprise';
import { isAdminRole, type RootStackParams } from '../types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { LoadingView } from '../components/LoadingView';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';

type Props = NativeStackScreenProps<RootStackParams, 'Marketing'>;

type SortKey = 'quality' | 'conversion' | 'volume' | 'spend' | 'cpc';
type StatusFilter = 'all' | 'active' | 'paused';

const RANGES: { id: MarketingRange; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
];

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp directo',
  meta_ads: 'Meta Ads',
  facebook: 'Messenger',
  instagram: 'Instagram',
  manual: 'Manual',
  import: 'Importado',
  web: 'Sitio Web',
  google_ads: 'Google Ads',
};

const LOSS_LABEL: Record<string, string> = {
  price: 'Precio',
  competitor: 'Competencia',
  timing: 'No es momento',
  no_response: 'Sin respuesta',
  not_qualified: 'No califica',
  other: 'Otro',
};

function fmtMoney(n: number | null | undefined, currency = 'COP'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = currency === 'COP' || n >= 100 ? Math.round(n) : Number(n.toFixed(2));
  return `$${rounded.toLocaleString('es-CO')} ${currency}`;
}

export function MarketingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const auth = useAuth();
  const { companyId, role, platformAdmin } = auth;
  const isAdmin = Boolean(
    (auth as { isAdmin?: boolean }).isAdmin ?? (isAdminRole(role) || platformAdmin)
  );

  const [range, setRange] = useState<MarketingRange>('all');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortKey>('quality');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [ticketStr, setTicketStr] = useState('');

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  const load = useCallback(
    async (r: MarketingRange, isPull = false) => {
      if (!companyId || !isAdmin) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getMarketingMetrics(companyId, r);
        setData(res);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron calcular las métricas de marketing.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, isAdmin]
  );

  useEffect(() => {
    void load(range, false);
  }, [load, range]);

  const campaigns = useMemo<string[]>(() => {
    if (!data?.ads) return [];
    const set = new Set<string>();
    (data.ads as any[]).forEach((a) => {
      if (a.campaign) set.add(String(a.campaign));
    });
    return [...set].sort();
  }, [data]);

  const campaignOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Todas las campañas' },
      ...campaigns.map((c) => ({ value: c, label: c })),
    ],
    [campaigns]
  );

  const sortedAds = useMemo<any[]>(() => {
    if (!data?.ads) return [];
    const filtered = (data.ads as any[]).filter((a) => {
      if (campaignFilter && a.campaign !== campaignFilter) return false;
      if (statusFilter === 'active') return a.status === 'ACTIVE';
      if (statusFilter === 'paused') return a.status && a.status !== 'ACTIVE';
      return true;
    });
    const inf = (v: number | null | undefined) =>
      v === null || v === undefined ? Number.POSITIVE_INFINITY : v;
    return filtered.sort((a, b) => {
      if (sort === 'conversion') {
        return (b.conversionRate || 0) - (a.conversionRate || 0) || (b.leads || 0) - (a.leads || 0);
      }
      if (sort === 'volume') {
        return (b.leads || 0) - (a.leads || 0);
      }
      if (sort === 'spend') {
        return (b.spend ?? -1) - (a.spend ?? -1);
      }
      if (sort === 'cpc') {
        return inf(a.cpc) - inf(b.cpc);
      }
      return (
        (b.avgScore || 0) - (a.avgScore || 0) ||
        (b.conversionRate || 0) - (a.conversionRate || 0) ||
        (b.leads || 0) - (a.leads || 0)
      );
    });
  }, [data, sort, statusFilter, campaignFilter]);

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
        <ScreenHeader title="Marketing" onBack={handleBack} />
        <EmptyState
          icon="Lock"
          title="Acceso restringido"
          description="Solo los administradores y gerentes pueden ver la analítica de pautas y ROAS."
        />
      </View>
    );
  }

  const totals = data?.totals ?? {
    ads: 0,
    activeAds: 0,
    leads: 0,
    hot: 0,
    avgScore: 0,
    scheduleRate: 0,
    scheduled: 0,
    conversionRate: 0,
    closed: 0,
    spend: 0,
    avgCpc: null,
  };
  const showCosts = Boolean(data?.spendAvailable);
  const currency = data?.currency || 'COP';
  const ticket = Number(ticketStr.replace(/\D/g, '')) || 0;
  const roas =
    showCosts && ticket > 0 && totals.spend > 0
      ? (totals.closed * ticket) / totals.spend
      : null;

  const bySource: any[] = data?.bySource ?? [];
  const byForm: any[] = data?.byForm ?? [];
  const insights: any[] = data?.insights ?? [];
  const maxSource = Math.max(1, ...bySource.map((s) => s.leads || 0));
  const maxForm = Math.max(1, ...byForm.map((f) => f.leads || 0));

  const renderScoreBadge = (score: number, analyzed: number) => {
    if (!analyzed) {
      return <Text style={{ fontSize: 11, color: palette.textSubtle }}>—</Text>;
    }
    const tone: 'emerald' | 'amber' | 'neutral' =
      score >= 70 ? 'emerald' : score >= 40 ? 'amber' : 'neutral';
    return <Badge tone={tone}>{`Score ${score}`}</Badge>;
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Marketing"
        subtitle="Qué pautas traen leads que compran, no solo volumen."
        onBack={handleBack}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            onPress={() => void load(range, true)}
            icon={<Icon name="RefreshCw" size={13} color={palette.textPrimary} />}
          >
            Actualizar
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingView label="Calculando rendimiento de anuncios..." />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(range, true)}
              tintColor={palette.brand}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* Selector de rango */}
          <View
            style={[
              styles.rangeBar,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            {RANGES.map((r) => {
              const active = range === r.id;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setRange(r.id)}
                  style={[
                    styles.rangeBtn,
                    active && { backgroundColor: palette.brand },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: active ? '#ffffff' : palette.textMuted,
                    }}
                  >
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <View
              style={[
                styles.alertBox,
                { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
              ]}
            >
              <Text style={{ fontSize: 12, color: palette.roseText }}>{error}</Text>
            </View>
          ) : null}

          {/* Aviso de integración de costos */}
          {data && !showCosts && (
            <View
              style={[
                styles.alertBox,
                { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
              ]}
            >
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: palette.amberText }}>
                    Costos de Meta Marketing API no conectados
                  </Text>
                  <Text
                    style={{
                      fontSize: 11.5,
                      color: palette.textSecondary,
                      marginTop: 3,
                      lineHeight: 16,
                    }}
                  >
                    {data.spendNote ||
                      'Conecta el Token y Cuenta Publicitaria de Meta en Configuración > Pautas para ver gasto real, CPL, costo por cierre y ROAS.'}
                  </Text>
                </View>
              </View>
              <Button
                size="sm"
                variant="secondary"
                style={{ alignSelf: 'flex-start', marginTop: 8 }}
                onPress={() => navigation.navigate('Config', { initialTab: 'pautas' })}
                icon={<Icon name="Settings" size={13} color={palette.textPrimary} />}
              >
                Configurar Meta Ads
              </Button>
            </View>
          )}

          {/* Recomendaciones IA / Insights */}
          {insights.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionHeader, { color: palette.textMuted }]}>
                RECOMENDACIONES ESTRATÉGICAS
              </Text>
              {insights.map((ins, i) => {
                const bg =
                  ins.kind === 'scale'
                    ? palette.emeraldBg
                    : ins.kind === 'pause'
                      ? palette.roseBg
                      : ins.kind === 'watch'
                        ? palette.amberBg
                        : palette.bgCard;
                const border =
                  ins.kind === 'scale'
                    ? palette.emeraldBorder
                    : ins.kind === 'pause'
                      ? palette.roseBorder
                      : ins.kind === 'watch'
                        ? palette.amberBorder
                        : palette.border;
                const badgeColor =
                  ins.kind === 'scale'
                    ? 'emerald'
                    : ins.kind === 'pause'
                      ? 'rose'
                      : ins.kind === 'watch'
                        ? 'amber'
                        : 'neutral';
                const badgeLabel =
                  ins.kind === 'scale'
                    ? 'ESCALAR'
                    : ins.kind === 'pause'
                      ? 'PAUSAR'
                      : ins.kind === 'watch'
                        ? 'REVISAR'
                        : 'INFO';

                return (
                  <View
                    key={i}
                    style={[styles.insightCard, { backgroundColor: bg, borderColor: border }]}
                  >
                    <View style={styles.rowWrap}>
                      <Badge tone={badgeColor}>{badgeLabel}</Badge>
                      {ins.adName ? (
                        <Text
                          style={{ fontSize: 11, color: palette.textSubtle, flex: 1 }}
                          numberOfLines={1}
                        >
                          {ins.adName}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '700',
                        color: palette.textPrimary,
                        marginTop: 6,
                      }}
                    >
                      {ins.title}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: palette.textSecondary,
                        marginTop: 2,
                        lineHeight: 17,
                      }}
                    >
                      {ins.detail}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* KPIs principales */}
          <View style={styles.kpiGrid}>
            <View
              style={[
                styles.kpiCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                ANUNCIOS ACTIVOS
              </Text>
              <Text style={[styles.kpiVal, { color: palette.textPrimary }]}>
                {showCosts ? `${totals.activeAds}/${totals.ads}` : totals.ads}
              </Text>
              <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                {showCosts ? 'activos / con datos' : 'con leads atribuidos'}
              </Text>
            </View>

            <View
              style={[
                styles.kpiCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                LEADS DE ANUNCIOS
              </Text>
              <Text style={[styles.kpiVal, { color: palette.textPrimary }]}>{totals.leads}</Text>
              <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                {totals.hot} calientes 🔥
              </Text>
            </View>

            <View
              style={[
                styles.kpiCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                SCORE PROMEDIO
              </Text>
              <Text style={[styles.kpiVal, { color: palette.brandText }]}>
                {totals.avgScore || '—'}
              </Text>
              <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>/100 · Calidad IA</Text>
            </View>

            <View
              style={[
                styles.kpiCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>AGENDAN %</Text>
              <Text style={[styles.kpiVal, { color: palette.skyText }]}>
                {totals.scheduleRate}%
              </Text>
              <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                {totals.scheduled} citas
              </Text>
            </View>

            <View
              style={[
                styles.kpiCard,
                { backgroundColor: palette.bgCard, borderColor: palette.emeraldBorder },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>CIERRAN %</Text>
              <Text style={[styles.kpiVal, { color: palette.emeraldText }]}>
                {totals.conversionRate}%
              </Text>
              <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                {totals.closed} cierres
              </Text>
            </View>

            {showCosts && (
              <>
                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                    GASTO TOTAL
                  </Text>
                  <Text
                    style={[styles.kpiVal, { color: palette.textPrimary, fontSize: 16 }]}
                    numberOfLines={1}
                  >
                    {fmtMoney(totals.spend, currency)}
                  </Text>
                  <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                    {totals.avgCpc
                      ? `C/cierre ${fmtMoney(totals.avgCpc, currency)}`
                      : 'Sin cierres aún'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    {
                      backgroundColor: palette.bgCard,
                      borderColor: roas && roas >= 3 ? palette.emeraldBorder : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>ROAS</Text>
                  <Text
                    style={[
                      styles.kpiVal,
                      {
                        color:
                          roas && roas >= 3 ? palette.emeraldText : palette.textPrimary,
                      },
                    ]}
                  >
                    {roas !== null ? `${roas.toFixed(1)}x` : '—'}
                  </Text>
                  <Text style={[styles.kpiSub, { color: palette.textSubtle }]}>
                    {ticket > 0
                      ? `Est. ${fmtMoney(totals.closed * ticket, currency)}`
                      : 'Ingresa ticket abajo'}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Ticket promedio para cálculo ROAS */}
          {showCosts && (
            <View
              style={[
                styles.ticketBox,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={{ fontSize: 12, color: palette.textMuted, flex: 1 }}>
                Ticket promedio por cierre ({currency}):
              </Text>
              <TextInput
                value={ticketStr}
                onChangeText={setTicketStr}
                keyboardType="number-pad"
                placeholder="Ej. 85000000"
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.ticketInput,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderInput,
                    color: palette.textPrimary,
                  },
                ]}
              />
            </View>
          )}

          {/* Ranking de Anuncios */}
          <View
            style={[
              styles.panel,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>
              Ranking de anuncios ({sortedAds.length})
            </Text>

            {/* Controles de ordenamiento */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, marginTop: 8 }}
            >
              {(
                [
                  { id: 'quality', label: 'Calidad' },
                  { id: 'conversion', label: 'Cierre %' },
                  { id: 'volume', label: 'Volumen' },
                  ...(showCosts
                    ? [
                        { id: 'spend', label: 'Gasto' },
                        { id: 'cpc', label: 'Costo/cierre' },
                      ]
                    : []),
                ] as { id: SortKey; label: string }[]
              ).map((s) => {
                const active = sort === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSort(s.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgElevated,
                        borderColor: active ? palette.brandBorder : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11.5,
                        fontWeight: active ? '700' : '500',
                        color: active ? palette.brandText : palette.textMuted,
                      }}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Filtro estado + campaña */}
            {(showCosts || campaigns.length > 0) && (
              <View style={[styles.rowWrap, { marginTop: 8 }]}>
                {showCosts &&
                  (
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'active', label: 'Activos' },
                      { id: 'paused', label: 'Pausados' },
                    ] as const
                  ).map((st) => {
                    const active = statusFilter === st.id;
                    return (
                      <Pressable
                        key={st.id}
                        onPress={() => setStatusFilter(st.id)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active ? palette.skyBg : palette.bgElevated,
                            borderColor: active ? palette.skyBorder : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: active ? '700' : '500',
                            color: active ? palette.skyText : palette.textMuted,
                          }}
                        >
                          {st.label}
                        </Text>
                      </Pressable>
                    );
                  })}

                {campaigns.length > 0 && (
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <SelectModal
                      value={campaignFilter}
                      options={campaignOptions}
                      onChange={setCampaignFilter}
                      title="Filtrar por campaña"
                      compact
                      searchable
                    />
                  </View>
                )}
              </View>
            )}

            {sortedAds.length === 0 ? (
              <Text
                style={{
                  fontSize: 12,
                  color: palette.textSubtle,
                  textAlign: 'center',
                  paddingVertical: 20,
                }}
              >
                Aún no hay leads con anuncio identificado en este rango.
              </Text>
            ) : (
              <View style={{ gap: 10, marginTop: 12 }}>
                {sortedAds.map((a, idx) => (
                  <View
                    key={a.key || `${a.adName}-${idx}`}
                    style={[
                      styles.adCard,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <View style={[styles.rowCenter, { flex: 1 }]}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '800',
                            color: palette.brandText,
                          }}
                        >
                          #{idx + 1}
                        </Text>
                        {a.status ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor:
                                a.status === 'ACTIVE'
                                  ? palette.emerald
                                  : palette.textSubtle,
                            }}
                          />
                        ) : null}
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: '700',
                            color: palette.textPrimary,
                            flex: 1,
                          }}
                          numberOfLines={2}
                        >
                          {a.adName || 'Anuncio sin nombre'}
                        </Text>
                      </View>
                      {renderScoreBadge(a.avgScore || 0, a.analyzed || 0)}
                    </View>

                    {a.campaign || a.formName ? (
                      <Text
                        style={{ fontSize: 11, color: palette.textSubtle, marginTop: 3 }}
                        numberOfLines={1}
                      >
                        {[a.campaign, a.formName ? `Form: ${a.formName}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}

                    <View style={[styles.adMetricsRow, { marginTop: 8 }]}>
                      <View style={styles.adMetricCell}>
                        <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                          Leads
                        </Text>
                        <Text style={[styles.adMetricVal, { color: palette.textPrimary }]}>
                          {a.leads || 0}
                          {a.hot > 0 ? ` (${a.hot}🔥)` : ''}
                        </Text>
                      </View>

                      <View style={styles.adMetricCell}>
                        <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                          Agendan
                        </Text>
                        <Text style={[styles.adMetricVal, { color: palette.skyText }]}>
                          {a.scheduleRate || 0}% ({a.scheduled || 0})
                        </Text>
                      </View>

                      <View style={styles.adMetricCell}>
                        <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                          Cierran
                        </Text>
                        <Text
                          style={[
                            styles.adMetricVal,
                            {
                              color:
                                (a.closed || 0) > 0
                                  ? palette.emeraldText
                                  : palette.textMuted,
                            },
                          ]}
                        >
                          {a.conversionRate || 0}% ({a.closed || 0})
                        </Text>
                      </View>
                    </View>

                    {showCosts && (
                      <View
                        style={[
                          styles.adMetricsRow,
                          {
                            marginTop: 6,
                            paddingTop: 6,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: palette.border,
                          },
                        ]}
                      >
                        <View style={styles.adMetricCell}>
                          <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                            Gasto
                          </Text>
                          <Text style={[styles.adMetricVal, { color: palette.textSecondary }]}>
                            {fmtMoney(a.spend, currency)}
                          </Text>
                        </View>
                        <View style={styles.adMetricCell}>
                          <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                            CPL / CTR
                          </Text>
                          <Text style={[styles.adMetricVal, { color: palette.textSecondary }]}>
                            {fmtMoney(a.cpl, currency)} · {a.ctr !== null && a.ctr !== undefined ? `${a.ctr}%` : '—'}
                          </Text>
                        </View>
                        <View style={styles.adMetricCell}>
                          <Text style={[styles.adMetricLabel, { color: palette.textSubtle }]}>
                            Costo/Cierre
                          </Text>
                          <Text
                            style={[
                              styles.adMetricVal,
                              {
                                color: a.cpc ? palette.emeraldText : palette.textSubtle,
                              },
                            ]}
                          >
                            {fmtMoney(a.cpc, currency)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {a.topLoss ? (
                      <Text style={{ fontSize: 11, color: palette.roseText, marginTop: 6 }}>
                        Motivo principal de pérdida:{' '}
                        {LOSS_LABEL[a.topLoss] ?? a.topLoss}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Calidad y cierre por fuente */}
          <View
            style={[
              styles.panel,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>
              Calidad y cierre por fuente
            </Text>
            {bySource.length === 0 ? (
              <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 8 }}>
                Sin datos en este rango.
              </Text>
            ) : (
              <View style={{ gap: 10, marginTop: 10 }}>
                {bySource.map((s, idx) => {
                  const pctWidth = Math.max(4, Math.round(((s.leads || 0) / maxSource) * 100));
                  return (
                    <View key={s.source || `source-${idx}`} style={{ gap: 4 }}>
                      <View style={styles.rowBetween}>
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: '600',
                            color: palette.textPrimary,
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {SOURCE_LABEL[s.source] ?? s.source}
                        </Text>
                        <View style={styles.rowCenter}>
                          {renderScoreBadge(s.avgScore || 0, s.analyzed || 0)}
                          <Text
                            style={{
                              fontSize: 11.5,
                              fontWeight: '700',
                              color:
                                (s.closed || 0) > 0
                                  ? palette.emeraldText
                                  : palette.textSubtle,
                            }}
                          >
                            {s.conversionRate || 0}%
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '700',
                              color: palette.textSecondary,
                              minWidth: 28,
                              textAlign: 'right',
                            }}
                          >
                            {s.leads || 0}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.progressTrack,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${pctWidth}%`, backgroundColor: palette.brand },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Leads por formulario Meta Lead Ads */}
          <View
            style={[
              styles.panel,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.panelTitle, { color: palette.textPrimary }]}>
              Leads por formulario (Meta Lead Ads)
            </Text>
            {byForm.length === 0 ? (
              <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 8 }}>
                Aún no han entrado leads por formulario en este rango.
              </Text>
            ) : (
              <View style={{ gap: 10, marginTop: 10 }}>
                {byForm.map((f, idx) => {
                  const pctWidth = Math.max(4, Math.round(((f.leads || 0) / maxForm) * 100));
                  return (
                    <View key={f.formId || `form-${idx}`} style={{ gap: 4 }}>
                      <View style={styles.rowBetween}>
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: '600',
                            color: palette.textPrimary,
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {f.label || `Form ${f.formId}`}
                        </Text>
                        <View style={styles.rowCenter}>
                          {renderScoreBadge(f.avgScore || 0, f.leads || 0)}
                          <Text
                            style={{
                              fontSize: 11.5,
                              fontWeight: '700',
                              color:
                                (f.closed || 0) > 0
                                  ? palette.emeraldText
                                  : palette.textSubtle,
                            }}
                          >
                            {f.conversionRate || 0}%
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '700',
                              color: palette.textSecondary,
                              minWidth: 28,
                              textAlign: 'right',
                            }}
                          >
                            {f.leads || 0}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.progressTrack,
                          { backgroundColor: palette.bgElevated },
                        ]}
                      >
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${pctWidth}%`, backgroundColor: palette.emerald },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Pie de cobertura de atribución */}
          {data?.coverage ? (
            <Text style={{ fontSize: 11, color: palette.textSubtle, lineHeight: 16 }}>
              Atribución por anuncio: {data.coverage.withAdAttribution} de{' '}
              {data.coverage.totalLeadsInRange} leads totales ({data.coverage.attributionRate}
              %) traen ID de anuncio.
              {data.generatedAt
                ? ` · Actualizado ${new Date(data.generatedAt).toLocaleTimeString('es-CO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  rangeBar: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  insightCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    width: '48.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  kpiVal: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 11,
    marginTop: 2,
  },
  ticketBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ticketInput: {
    width: 135,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    textAlign: 'right',
    fontWeight: '600',
  },
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  adCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  adMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  adMetricCell: {
    flex: 1,
  },
  adMetricLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  adMetricVal: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
});
