import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { listRecentCalls } from '../services/crm';
import { getAutoCallConfig, saveAutoCallConfig } from '../services/enterprise';
import type { RecentCall, RootStackParams } from '../types';
import { formatPhone } from '../utils/formatPhone';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon, type LucideIconName } from '../components/Icon';
import { LoadingView } from '../components/LoadingView';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';

type Props = NativeStackScreenProps<RootStackParams, 'Calls'>;

interface NormalizedAutoCallConfig {
  enabled: boolean;
  windowStartHour: number;
  windowEndHour: number;
  retryOffsetsHours: number[];
  followUpInterestedEnabled: boolean;
  followUpInterestedHours: number;
  dailyCap: number;
}

const DEFAULT_AUTO_CALL: NormalizedAutoCallConfig = {
  enabled: false,
  windowStartHour: 8,
  windowEndHour: 20,
  retryOffsetsHours: [24, 48, 72],
  followUpInterestedEnabled: true,
  followUpInterestedHours: 24,
  dailyCap: 25,
};

const START_HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));

const END_HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, i) => {
  const h = i + 1;
  return {
    value: String(h),
    label: `${String(h).padStart(2, '0')}:00`,
  };
});

const STATUS_META: Record<
  string,
  { label: string; tone: 'emerald' | 'rose' | 'amber' | 'neutral'; icon: LucideIconName }
> = {
  completed: { label: 'Completada', tone: 'emerald', icon: 'Phone' },
  failed: { label: 'Fallida', tone: 'rose', icon: 'PhoneOff' },
  no_answer: { label: 'No contestó', tone: 'neutral', icon: 'PhoneOff' },
  busy: { label: 'Ocupado', tone: 'amber', icon: 'PhoneOff' },
  canceled: { label: 'Cancelada', tone: 'neutral', icon: 'PhoneOff' },
  in_progress: { label: 'En curso', tone: 'amber', icon: 'PhoneIncoming' },
  ringing: { label: 'Timbrando', tone: 'amber', icon: 'PhoneIncoming' },
  initiated: { label: 'Iniciando', tone: 'neutral', icon: 'PhoneIncoming' },
};

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCallDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeAutoCall(raw: any): NormalizedAutoCallConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_AUTO_CALL;
  const retries = Array.isArray(raw.retryOffsetsHours)
    ? raw.retryOffsetsHours
    : Array.isArray(raw.retryHours)
      ? raw.retryHours
      : [24, 48, 72];
  return {
    enabled: Boolean(raw.enabled),
    windowStartHour:
      typeof raw.windowStartHour === 'number'
        ? raw.windowStartHour
        : typeof raw.startHour === 'number'
          ? raw.startHour
          : 8,
    windowEndHour:
      typeof raw.windowEndHour === 'number'
        ? raw.windowEndHour
        : typeof raw.endHour === 'number'
          ? raw.endHour
          : 20,
    retryOffsetsHours: [
      Number(retries[0] ?? 24) || 24,
      Number(retries[1] ?? 48) || 48,
      Number(retries[2] ?? 72) || 72,
    ],
    followUpInterestedEnabled:
      typeof raw.followUpInterestedEnabled === 'boolean' ? raw.followUpInterestedEnabled : true,
    followUpInterestedHours:
      typeof raw.followUpInterestedHours === 'number'
        ? raw.followUpInterestedHours
        : typeof raw.followUpDelayHours === 'number'
          ? raw.followUpDelayHours
          : 24,
    dailyCap:
      typeof raw.dailyCap === 'number'
        ? raw.dailyCap
        : typeof raw.maxCallsPerDay === 'number'
          ? raw.maxCallsPerDay
          : 25,
  };
}

function CallAudioPlayer({ url }: { url: string }) {
  const { palette } = useTheme();
  const player = useAudioPlayer(url);
  const [playing, setPlaying] = useState(false);

  const togglePlay = () => {
    try {
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        player.play();
        setPlaying(true);
      }
    } catch {
      void Linking.openURL(url);
    }
  };

  return (
    <View style={styles.audioRow}>
      <Pressable
        onPress={togglePlay}
        style={[
          styles.audioBtn,
          { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
        ]}
      >
        <Icon name={playing ? 'Pause' : 'Play'} size={14} color={palette.brandText} />
        <Text style={[styles.audioBtnText, { color: palette.brandText }]}>
          {playing ? 'Pausar grabación' : 'Reproducir grabación'}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => void Linking.openURL(url)}
        style={[
          styles.audioOpenBtn,
          { backgroundColor: palette.bgElevated, borderColor: palette.border },
        ]}
      >
        <Icon name="ExternalLink" size={13} color={palette.textMuted} />
      </Pressable>
    </View>
  );
}

function AutoCallPanel({
  companyId,
  canManage,
}: {
  companyId: string;
  canManage: boolean;
}) {
  const { palette } = useTheme();
  const [cfg, setCfg] = useState<NormalizedAutoCallConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getAutoCallConfig(companyId)
      .then((data) => {
        if (alive) setCfg(normalizeAutoCall(data));
      })
      .catch(() => {
        if (alive) setError('No se pudo cargar la configuración de llamadas automáticas.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const setRetry = (idx: number, rawVal: string) => {
    if (!cfg) return;
    const num = Math.max(1, Math.min(240, Number(rawVal.replace(/[^0-9]/g, '')) || 1));
    const next = [...cfg.retryOffsetsHours];
    next[idx] = num;
    setCfg({ ...cfg, retryOffsetsHours: next });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!cfg || !canManage) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveAutoCallConfig(companyId, {
        enabled: cfg.enabled,
        windowStartHour: cfg.windowStartHour,
        windowEndHour: cfg.windowEndHour,
        retryOffsetsHours: cfg.retryOffsetsHours,
        followUpInterestedEnabled: cfg.followUpInterestedEnabled,
        followUpInterestedHours: cfg.followUpInterestedHours,
        dailyCap: cfg.dailyCap,
      } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View
        style={[
          styles.autoPanel,
          { backgroundColor: palette.bgCard, borderColor: palette.border },
        ]}
      >
        <View style={styles.rowCenter}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ fontSize: 12, color: palette.textSubtle }}>
            Cargando configuración de llamadas automáticas...
          </Text>
        </View>
      </View>
    );
  }

  if (!cfg) {
    return error ? (
      <View
        style={[
          styles.alertBox,
          { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
        ]}
      >
        <Text style={{ fontSize: 12, color: palette.roseText }}>{error}</Text>
      </View>
    ) : null;
  }

  return (
    <View
      style={[
        styles.autoPanel,
        { backgroundColor: palette.bgCard, borderColor: palette.border },
      ]}
    >
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.autoHeaderRow}
      >
        <View style={{ flex: 1 }}>
          <View style={styles.rowWrap}>
            <Icon name="Bot" size={16} color={palette.brandText} />
            <Text style={[styles.autoTitle, { color: palette.textPrimary }]}>
              Llamadas automáticas con IA
            </Text>
            <Badge tone={cfg.enabled ? 'emerald' : 'neutral'}>
              {cfg.enabled ? 'Activas' : 'Pausadas'}
            </Badge>
          </View>
          <Text style={[styles.autoSubtitle, { color: palette.textSubtle }]}>
            Horario {String(cfg.windowStartHour).padStart(2, '0')}:00–
            {String(cfg.windowEndHour).padStart(2, '0')}:00 · Tope {cfg.dailyCap}/día · Reintentos{' '}
            {cfg.retryOffsetsHours.join('h / ')}h
          </Text>
        </View>
        <Icon
          name={expanded ? 'ChevronUp' : 'ChevronDown'}
          size={18}
          color={palette.textMuted}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.autoBody, { borderTopColor: palette.border }]}>
          <Text style={{ fontSize: 12, color: palette.textMuted, lineHeight: 17 }}>
            Programa reintentos cuando el cliente no contesta y un seguimiento si mostró interés sin cita agendada.
          </Text>

          <View
            style={[
              styles.switchRow,
              { backgroundColor: palette.bgElevated, borderColor: palette.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textPrimary }}>
                Activar llamadas automáticas
              </Text>
              <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 2 }}>
                {canManage
                  ? 'Habilita la cola inteligente de marcación por voz IA.'
                  : 'Modo lectura (solo administradores pueden modificar).'}
              </Text>
            </View>
            <Switch
              value={cfg.enabled}
              disabled={!canManage}
              onValueChange={(val) => {
                setCfg({ ...cfg, enabled: val });
                setSaved(false);
              }}
              trackColor={{ false: palette.borderStrong, true: palette.brand }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.gridTwo}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Hora inicio</Text>
              <SelectModal
                value={String(cfg.windowStartHour)}
                options={START_HOUR_OPTIONS}
                disabled={!canManage}
                title="Hora de inicio"
                onChange={(v) => {
                  setCfg({ ...cfg, windowStartHour: Number(v) });
                  setSaved(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Hora fin</Text>
              <SelectModal
                value={String(cfg.windowEndHour)}
                options={END_HOUR_OPTIONS}
                disabled={!canManage}
                title="Hora de fin"
                onChange={(v) => {
                  setCfg({ ...cfg, windowEndHour: Number(v) });
                  setSaved(false);
                }}
              />
            </View>
          </View>

          <View>
            <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>
              Tope diario de llamadas
            </Text>
            <TextInput
              value={String(cfg.dailyCap)}
              editable={canManage}
              keyboardType="number-pad"
              onChangeText={(t) => {
                const n = Math.max(1, Math.min(500, Number(t.replace(/[^0-9]/g, '')) || 1));
                setCfg({ ...cfg, dailyCap: n });
                setSaved(false);
              }}
              style={[
                styles.input,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderInput,
                  color: palette.textPrimary,
                },
              ]}
            />
          </View>

          <View>
            <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>
              Reintentos sin respuesta (horas después)
            </Text>
            <View style={styles.gridThree}>
              {[0, 1, 2].map((idx) => (
                <View key={idx} style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, color: palette.textSubtle, marginBottom: 4 }}>
                    Reintento {idx + 1} (h)
                  </Text>
                  <TextInput
                    value={String(cfg.retryOffsetsHours[idx] ?? 24)}
                    editable={canManage}
                    keyboardType="number-pad"
                    onChangeText={(v) => setRetry(idx, v)}
                    style={[
                      styles.input,
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

          <View
            style={[
              styles.followUpBox,
              { backgroundColor: palette.bgElevated, borderColor: palette.border },
            ]}
          >
            <View style={styles.rowBetween}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: palette.textPrimary, flex: 1 }}>
                Seguimiento automático a interesados
              </Text>
              <Switch
                value={cfg.followUpInterestedEnabled}
                disabled={!canManage}
                onValueChange={(val) => {
                  setCfg({ ...cfg, followUpInterestedEnabled: val });
                  setSaved(false);
                }}
                trackColor={{ false: palette.borderStrong, true: palette.brand }}
                thumbColor="#ffffff"
              />
            </View>
            <View style={[styles.rowCenter, { marginTop: 8 }]}>
              <Text style={{ fontSize: 12, color: palette.textMuted }}>Llamar a las</Text>
              <TextInput
                value={String(cfg.followUpInterestedHours)}
                editable={canManage && cfg.followUpInterestedEnabled}
                keyboardType="number-pad"
                onChangeText={(t) => {
                  const n = Math.max(1, Math.min(240, Number(t.replace(/[^0-9]/g, '')) || 1));
                  setCfg({ ...cfg, followUpInterestedHours: n });
                  setSaved(false);
                }}
                style={[
                  styles.smallNumberInput,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderInput,
                    color: palette.textPrimary,
                    opacity: cfg.followUpInterestedEnabled ? 1 : 0.5,
                  },
                ]}
              />
              <Text style={{ fontSize: 12, color: palette.textMuted, flex: 1 }}>
                horas si no hay cita agendada
              </Text>
            </View>
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

          {canManage && (
            <View style={styles.rowBetween}>
              {saved ? (
                <View style={styles.rowCenter}>
                  <Icon name="Check" size={14} color={palette.emeraldText} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: palette.emeraldText }}>
                    Configuración guardada
                  </Text>
                </View>
              ) : (
                <View />
              )}
              <Button size="sm" onPress={handleSave} loading={saving}>
                Guardar
              </Button>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function CallsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const auth = useAuth();
  const { companyId, role, platformAdmin } = auth;
  const canManageAutoCall = Boolean(platformAdmin || role === 'admin');

  const [calls, setCalls] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed' | 'active'>('all');

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  const loadCalls = useCallback(
    async (isPull = false) => {
      if (!companyId) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const list = await listRecentCalls(companyId, 80);
        setCalls(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las llamadas.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    void loadCalls(false);
  }, [loadCalls]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (statusFilter === 'completed' && c.status !== 'completed') return false;
      if (
        statusFilter === 'failed' &&
        !['failed', 'no_answer', 'busy', 'canceled'].includes(c.status)
      ) {
        return false;
      }
      if (
        statusFilter === 'active' &&
        !['in_progress', 'ringing', 'initiated'].includes(c.status)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        (c.leadName && c.leadName.toLowerCase().includes(q)) ||
        (c.leadPhone && c.leadPhone.toLowerCase().includes(q)) ||
        (c.summary && c.summary.toLowerCase().includes(q)) ||
        (c.outcome && c.outcome.toLowerCase().includes(q))
      );
    });
  }, [calls, search, statusFilter]);

  const completedCount = useMemo(
    () => calls.filter((c) => c.status === 'completed').length,
    [calls]
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Llamadas IA"
        subtitle="Historial de llamadas hechas por tu asistente de voz."
        onBack={handleBack}
        badge={
          calls.length > 0 ? (
            <Badge tone="brand">{calls.length}</Badge>
          ) : undefined
        }
        action={
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void loadCalls(true)}
            loading={refreshing}
            icon={<Icon name="RefreshCw" size={13} color={palette.textPrimary} />}
          >
            Actualizar
          </Button>
        }
      />

      {loading && calls.length === 0 ? (
        <LoadingView label="Cargando llamadas recientes..." />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadCalls(true)}
              tintColor={palette.brand}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {companyId ? (
            <AutoCallPanel companyId={companyId} canManage={canManageAutoCall} />
          ) : null}

          {/* Buscador y filtros rápidos */}
          <View
            style={[
              styles.searchBar,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Icon name="Search" size={15} color={palette.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar por cliente, teléfono o resumen..."
              placeholderTextColor={palette.placeholder}
              style={[styles.searchInput, { color: palette.textPrimary }]}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Icon name="X" size={15} color={palette.textMuted} />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterPillsRow}
          >
            {(
              [
                { id: 'all', label: `Todas (${calls.length})` },
                { id: 'completed', label: `Completadas (${completedCount})` },
                {
                  id: 'failed',
                  label: `Sin respuesta / Fallidas (${
                    calls.filter((c) =>
                      ['failed', 'no_answer', 'busy', 'canceled'].includes(c.status)
                    ).length
                  })`,
                },
                {
                  id: 'active',
                  label: `En curso (${
                    calls.filter((c) =>
                      ['in_progress', 'ringing', 'initiated'].includes(c.status)
                    ).length
                  })`,
                },
              ] as const
            ).map((f) => {
              const active = statusFilter === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setStatusFilter(f.id)}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: active ? palette.brandSoft : palette.bgCard,
                      borderColor: active ? palette.brandBorder : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: active ? '700' : '500',
                      color: active ? palette.brandText : palette.textMuted,
                    }}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

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

          {filteredCalls.length === 0 ? (
            <EmptyState
              icon="PhoneCall"
              title="Aún no hay llamadas registradas"
              description="Puedes iniciar una llamada IA abriendo un lead en la Bandeja y tocando el botón de teléfono en el detalle del contacto."
            />
          ) : (
            <View style={{ gap: 10 }}>
              {filteredCalls.map((c) => {
                const meta = STATUS_META[c.status] ?? {
                  label: c.status || 'Llamada',
                  tone: 'neutral' as const,
                  icon: 'Phone' as LucideIconName,
                };
                const open = expandedId === c.id;
                const iconBg =
                  meta.tone === 'emerald'
                    ? palette.emeraldBg
                    : meta.tone === 'rose'
                      ? palette.roseBg
                      : meta.tone === 'amber'
                        ? palette.amberBg
                        : palette.bgElevated;
                const iconColor =
                  meta.tone === 'emerald'
                    ? palette.emeraldText
                    : meta.tone === 'rose'
                      ? palette.roseText
                      : meta.tone === 'amber'
                        ? palette.amberText
                        : palette.textMuted;

                return (
                  <View
                    key={c.id}
                    style={[
                      styles.callCard,
                      { backgroundColor: palette.bgCard, borderColor: palette.border },
                    ]}
                  >
                    <Pressable
                      onPress={() => setExpandedId(open ? null : c.id)}
                      style={styles.callHeader}
                    >
                      <View
                        style={[
                          styles.statusIconWrap,
                          {
                            backgroundColor: iconBg,
                            borderColor:
                              meta.tone === 'emerald'
                                ? palette.emeraldBorder
                                : meta.tone === 'rose'
                                  ? palette.roseBorder
                                  : meta.tone === 'amber'
                                    ? palette.amberBorder
                                    : palette.border,
                          },
                        ]}
                      >
                        <Icon name={meta.icon} size={15} color={iconColor} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.rowBetween}>
                          <Text
                            style={[styles.leadName, { color: palette.textPrimary }]}
                            numberOfLines={1}
                          >
                            {c.leadName || formatPhone(c.leadPhone)}
                          </Text>
                          <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                            {formatCallDate(c.createdAt)}
                          </Text>
                        </View>

                        {c.leadName && c.leadPhone ? (
                          <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 1 }}>
                            {formatPhone(c.leadPhone)}
                          </Text>
                        ) : null}

                        <View style={[styles.rowWrap, { marginTop: 6 }]}>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <Text style={{ fontSize: 11, color: palette.textMuted }}>
                            ⏱ {formatDuration(c.durationSec)}
                          </Text>
                          {c.outcome ? (
                            <Badge tone="brand">{c.outcome}</Badge>
                          ) : null}
                          {c.callType === 'whatsapp' ? (
                            <Badge tone="sky">WhatsApp</Badge>
                          ) : null}
                        </View>

                        {c.summary && !open ? (
                          <Text
                            style={{
                              fontSize: 12,
                              color: palette.textMuted,
                              marginTop: 6,
                              lineHeight: 17,
                            }}
                            numberOfLines={2}
                          >
                            {c.summary}
                          </Text>
                        ) : null}
                      </View>

                      <Icon
                        name={open ? 'ChevronUp' : 'ChevronDown'}
                        size={16}
                        color={palette.textSubtle}
                      />
                    </Pressable>

                    {open && (
                      <View
                        style={[
                          styles.callExpanded,
                          { borderTopColor: palette.border, backgroundColor: palette.bgCardSoft },
                        ]}
                      >
                        <View style={styles.rowBetween}>
                          <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                            {c.advisorName ? `Asesor: ${c.advisorName}` : 'Asistente de voz IA'}
                          </Text>
                          {c.leadId ? (
                            <Pressable
                              onPress={() =>
                                navigation.navigate('Chat', { leadId: c.leadId })
                              }
                              style={styles.goChatBtn}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: '700',
                                  color: palette.brandText,
                                }}
                              >
                                Ir al chat →
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>

                        {c.summary ? (
                          <View style={{ gap: 4 }}>
                            <Text style={[styles.sectionMicro, { color: palette.textSubtle }]}>
                              RESUMEN
                            </Text>
                            <Text
                              style={{
                                fontSize: 12.5,
                                color: palette.textSecondary,
                                lineHeight: 18,
                              }}
                            >
                              {c.summary}
                            </Text>
                          </View>
                        ) : null}

                        {c.recordingUrl ? (
                          <View style={{ gap: 4 }}>
                            <Text style={[styles.sectionMicro, { color: palette.textSubtle }]}>
                              GRABACIÓN
                            </Text>
                            <CallAudioPlayer url={c.recordingUrl} />
                          </View>
                        ) : null}

                        {c.transcript ? (
                          <View style={{ gap: 4 }}>
                            <Text style={[styles.sectionMicro, { color: palette.textSubtle }]}>
                              TRANSCRIPCIÓN
                            </Text>
                            <ScrollView
                              nestedScrollEnabled
                              style={[
                                styles.transcriptBox,
                                {
                                  backgroundColor: palette.bgElevated,
                                  borderColor: palette.border,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: palette.textSecondary,
                                  lineHeight: 18,
                                }}
                              >
                                {c.transcript}
                              </Text>
                            </ScrollView>
                          </View>
                        ) : null}

                        {!c.summary && !c.transcript && !c.recordingUrl ? (
                          <Text style={{ fontSize: 12, color: palette.textSubtle }}>
                            Sin detalles adicionales aún.
                          </Text>
                        ) : null}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
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
  autoPanel: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  autoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 14,
  },
  autoTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  autoSubtitle: {
    fontSize: 11,
    marginTop: 4,
  },
  autoBody: {
    borderTopWidth: 1,
    padding: 14,
    gap: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  gridTwo: {
    flexDirection: 'row',
    gap: 10,
  },
  gridThree: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  smallNumberInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    width: 58,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  followUpBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  filterPillsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  callCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  callHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 13,
  },
  statusIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  leadName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  callExpanded: {
    borderTopWidth: 1,
    padding: 13,
    gap: 12,
  },
  sectionMicro: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  transcriptBox: {
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flex: 1,
  },
  audioBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  audioOpenBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goChatBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
