import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { listTemplates } from '../services/crm';
import {
  countBroadcastAudience,
  listBroadcasts,
  listLeadLists,
  listLeadsPage,
  sendBroadcast,
  type BroadcastAudience,
  type BroadcastRecord,
  type LeadListItemMeta,
} from '../services/enterprise';
import { isAdminRole, type RootStackParams, type WhatsAppTemplate } from '../types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { LoadingView } from '../components/LoadingView';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';

type Props = NativeStackScreenProps<RootStackParams, 'Broadcasts'>;

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'closed', label: 'Cerrado' },
];

const AUDIENCE_TYPES: { id: BroadcastAudience['type']; label: string }[] = [
  { id: 'all', label: 'Todos los leads' },
  { id: 'status', label: 'Por estado' },
  { id: 'tag', label: 'Por etiqueta' },
  { id: 'list', label: 'Por lista' },
];

const BROADCAST_STATUS_BADGE: Record<
  BroadcastRecord['status'],
  { label: string; tone: 'emerald' | 'amber' | 'sky' | 'rose' }
> = {
  queued: { label: 'En cola', tone: 'sky' },
  processing: { label: 'Procesando', tone: 'amber' },
  sending: { label: 'Enviando', tone: 'amber' },
  completed: { label: 'Completada', tone: 'emerald' },
  failed: { label: 'Con errores', tone: 'rose' },
};

function isLeadNameVar(body: string, key: string): boolean {
  const k = key.toLowerCase();
  if (k === 'nombre' || k === 'name') return true;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:hola|buen(?:os|as)\\s+\\w+|saludos|estimad[oa])\\s*,?\\s*\\{\\{\\s*${escaped}\\s*\\}\\}`,
    'i'
  ).test(body);
}

function pctText(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';
}

export function BroadcastsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const auth = useAuth();
  const { companyId, role, platformAdmin } = auth;
  const isAdmin = Boolean(
    (auth as { isAdmin?: boolean }).isAdmin ?? (isAdminRole(role) || platformAdmin)
  );

  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [leadLists, setLeadLists] = useState<LeadListItemMeta[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Composer state
  const [templateId, setTemplateId] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [audienceType, setAudienceType] = useState<BroadcastAudience['type']>('all');
  const [statusVal, setStatusVal] = useState('new');
  const [tagVal, setTagVal] = useState('');
  const [listVal, setListVal] = useState('');

  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [countingAudience, setCountingAudience] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ total: number } | null>(null);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  const loadAll = useCallback(
    async (isPull = false) => {
      if (!companyId || !isAdmin) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [tpls, bcs, lists, sampleLeads] = await Promise.all([
          listTemplates(companyId),
          listBroadcasts(companyId),
          listLeadLists(companyId).catch(() => []),
          listLeadsPage({ companyId, pageSize: 200 }).catch(() => ({
            leads: [],
            nextCursor: null,
            hasMore: false,
          })),
        ]);
        setTemplates(tpls);
        setBroadcasts(bcs);
        setLeadLists(lists);

        const tagSet = new Set<string>();
        sampleLeads.leads.forEach((l) => {
          (l.tags ?? []).forEach((tg) => {
            if (tg) tagSet.add(tg);
          });
        });
        const sortedTags = [...tagSet].sort();
        setAllTags(sortedTags);
        if (!tagVal && sortedTags[0]) setTagVal(sortedTags[0]);
        if (!listVal && lists[0]) setListVal(lists[0].id);

        const firstApproved = tpls.find((t) => t.status === 'approved');
        if (!templateId && firstApproved) {
          setTemplateId(firstApproved.id);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'No se pudieron cargar las campañas.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, isAdmin, templateId, tagVal, listVal]
  );

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'approved'),
    [templates]
  );

  const selectedTemplate = useMemo(
    () => approvedTemplates.find((t) => t.id === templateId),
    [approvedTemplates, templateId]
  );

  const autoVars = useMemo(() => {
    if (!selectedTemplate) return [];
    return selectedTemplate.variables.filter((v) =>
      isLeadNameVar(selectedTemplate.body, v.key)
    );
  }, [selectedTemplate]);

  const manualVars = useMemo(() => {
    if (!selectedTemplate) return [];
    return selectedTemplate.variables.filter(
      (v) => !isLeadNameVar(selectedTemplate.body, v.key)
    );
  }, [selectedTemplate]);

  const selectedAudience = useMemo<BroadcastAudience | null>(() => {
    if (audienceType === 'all') return { type: 'all' };
    if (audienceType === 'status') return { type: 'status', value: statusVal };
    if (audienceType === 'tag') return tagVal ? { type: 'tag', value: tagVal } : null;
    return listVal ? { type: 'list', value: listVal } : null;
  }, [audienceType, statusVal, tagVal, listVal]);

  useEffect(() => {
    let cancelled = false;
    if (!companyId || !isAdmin || !selectedAudience) {
      setAudienceCount(0);
      setCountingAudience(false);
      return;
    }
    setCountingAudience(true);
    countBroadcastAudience(companyId, selectedAudience)
      .then((total) => {
        if (!cancelled) setAudienceCount(total);
      })
      .catch(() => {
        if (!cancelled) setAudienceCount(0);
      })
      .finally(() => {
        if (!cancelled) setCountingAudience(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, isAdmin, selectedAudience]);

  const previewText = useMemo(() => {
    if (!selectedTemplate) return '';
    let out = selectedTemplate.body;
    for (const v of autoVars) {
      out = out.split(`{{${v.key}}}`).join('[nombre del lead]');
    }
    for (const v of manualVars) {
      out = out.split(`{{${v.key}}}`).join(vars[v.key] || `{{${v.key}}}`);
    }
    return out;
  }, [selectedTemplate, autoVars, manualVars, vars]);

  const canSend =
    Boolean(selectedTemplate) &&
    Boolean(selectedAudience) &&
    !countingAudience &&
    (audienceCount ?? 0) > 0 &&
    manualVars.every((v) => Boolean(vars[v.key]?.trim()));

  const handleSendBroadcast = async () => {
    if (!companyId || !selectedTemplate || !selectedAudience || sending) return;
    setSending(true);
    setError(null);
    setLastResult(null);
    try {
      const r = await sendBroadcast(companyId, selectedTemplate.id, selectedAudience, vars);
      setLastResult({ total: r.total });
      setConfirming(false);
      const updated = await listBroadcasts(companyId);
      setBroadcasts(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la campaña.');
    } finally {
      setSending(false);
    }
  };

  const formatAudienceLabel = (aud: BroadcastAudience): string => {
    if (aud.type === 'all') return 'Todos';
    if (aud.type === 'status') {
      const st = STATUS_OPTIONS.find((s) => s.value === aud.value)?.label ?? aud.value;
      return `Estado: ${st}`;
    }
    if (aud.type === 'tag') return `#${aud.value ?? ''}`;
    const foundList = leadLists.find((l) => l.id === aud.value);
    return `Lista: ${foundList?.name ?? aud.value ?? ''}`;
  };

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
        <ScreenHeader title="Campañas Masivas" onBack={handleBack} />
        <EmptyState
          icon="Lock"
          title="Acceso restringido"
          description="Solo los administradores pueden lanzar campañas masivas por WhatsApp."
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Campañas"
        subtitle="Envía una plantilla aprobada por Meta a varios leads a la vez."
        onBack={handleBack}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            onPress={() => void loadAll(true)}
            icon={<Icon name="RefreshCw" size={13} color={palette.textPrimary} />}
          >
            Actualizar
          </Button>
        }
      />

      {loading && broadcasts.length === 0 && templates.length === 0 ? (
        <LoadingView label="Cargando campañas y plantillas..." />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadAll(true)}
              tintColor={palette.brand}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* Compositor Nueva Campaña */}
          <View
            style={[
              styles.card,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <View style={styles.rowCenter}>
              <Icon name="Megaphone" size={16} color={palette.brandText} />
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
                Nueva campaña
              </Text>
            </View>

            {approvedTemplates.length === 0 ? (
              <View
                style={[
                  styles.noticeBox,
                  { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                ]}
              >
                <Text style={{ fontSize: 12, color: palette.amberText, lineHeight: 17 }}>
                  No tienes plantillas aprobadas por Meta aún. Crea o sincroniza una primero.
                </Text>
                <Button
                  size="sm"
                  variant="secondary"
                  style={{ alignSelf: 'flex-start', marginTop: 8 }}
                  onPress={() => navigation.navigate('Templates')}
                >
                  Ir a Plantillas
                </Button>
              </View>
            ) : (
              <>
                <View>
                  <Text style={[styles.label, { color: palette.textMuted }]}>Plantilla</Text>
                  <SelectModal
                    value={templateId}
                    options={approvedTemplates.map((t) => ({
                      value: t.id,
                      label: t.displayName,
                      subtitle: t.name,
                    }))}
                    onChange={(id) => {
                      setTemplateId(id);
                      setVars({});
                      setConfirming(false);
                    }}
                    searchable
                    title="Elegir plantilla aprobada"
                  />
                </View>

                {selectedTemplate && (
                  <View
                    style={[
                      styles.previewBox,
                      {
                        backgroundColor: palette.bgElevated,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.microTitle, { color: palette.textSubtle }]}>
                      VISTA PREVIA
                    </Text>
                    <Text
                      style={{
                        fontSize: 12.5,
                        color: palette.textPrimary,
                        lineHeight: 18,
                        marginTop: 4,
                      }}
                    >
                      {previewText}
                    </Text>
                  </View>
                )}

                {autoVars.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                    ✨ {autoVars.map((v) => `{{${v.key}}}`).join(', ')} se completará
                    automáticamente con el nombre de cada lead.
                  </Text>
                )}

                {manualVars.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={[styles.label, { color: palette.textMuted }]}>
                      Variables de la plantilla
                    </Text>
                    {manualVars.map((v) => (
                      <View key={v.key} style={styles.rowCenter}>
                        <Badge tone="brand">{`{{${v.key}}}`}</Badge>
                        <TextInput
                          value={vars[v.key] ?? ''}
                          onChangeText={(txt) =>
                            setVars((prev) => ({ ...prev, [v.key]: txt }))
                          }
                          placeholder={v.example || 'Valor para este envío'}
                          placeholderTextColor={palette.placeholder}
                          style={[
                            styles.input,
                            {
                              flex: 1,
                              backgroundColor: palette.bgInput,
                              borderColor: palette.borderInput,
                              color: palette.textPrimary,
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                )}

                {/* Audiencia */}
                <View style={{ gap: 8 }}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>Audiencia</Text>
                  <View style={styles.audiencePills}>
                    {AUDIENCE_TYPES.map((at) => {
                      const active = audienceType === at.id;
                      return (
                        <Pressable
                          key={at.id}
                          onPress={() => {
                            setAudienceType(at.id);
                            setConfirming(false);
                          }}
                          style={[
                            styles.audPill,
                            {
                              backgroundColor: active
                                ? palette.brandSoft
                                : palette.bgElevated,
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
                            {at.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {audienceType === 'status' && (
                    <SelectModal
                      value={statusVal}
                      options={STATUS_OPTIONS}
                      onChange={setStatusVal}
                      title="Elegir estado del lead"
                    />
                  )}

                  {audienceType === 'tag' &&
                    (allTags.length === 0 ? (
                      <Text style={{ fontSize: 12, color: palette.textSubtle }}>
                        Aún no hay etiquetas creadas en tus leads.
                      </Text>
                    ) : (
                      <SelectModal
                        value={tagVal}
                        options={allTags.map((tg) => ({ value: tg, label: `#${tg}` }))}
                        onChange={setTagVal}
                        searchable
                        title="Elegir etiqueta"
                      />
                    ))}

                  {audienceType === 'list' &&
                    (leadLists.length === 0 ? (
                      <Text style={{ fontSize: 12, color: palette.textSubtle }}>
                        Aún no hay listas de difusión creadas en Contactos.
                      </Text>
                    ) : (
                      <SelectModal
                        value={listVal}
                        options={leadLists.map((l) => ({
                          value: l.id,
                          label: `${l.name} (${l.count})`,
                        }))}
                        onChange={setListVal}
                        searchable
                        title="Elegir lista"
                      />
                    ))}

                  {/* Contador en vivo */}
                  <View style={styles.rowCenter}>
                    <Icon name="Users" size={14} color={palette.textMuted} />
                    {countingAudience ? (
                      <View style={styles.rowCenter}>
                        <ActivityIndicator size="small" color={palette.brand} />
                        <Text style={{ fontSize: 12, color: palette.textMuted }}>
                          Contando audiencia...
                        </Text>
                      </View>
                    ) : (audienceCount ?? 0) === 0 ? (
                      <Text style={{ fontSize: 12, color: palette.amberText }}>
                        Ningún lead coincide con ese filtro
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 12, color: palette.textSecondary }}>
                        Destinatarios:{' '}
                        <Text style={{ fontWeight: '800', color: palette.textPrimary }}>
                          {audienceCount}
                        </Text>{' '}
                        {audienceCount === 1 ? 'lead' : 'leads'}
                      </Text>
                    )}
                  </View>
                </View>

                {error ? (
                  <View
                    style={[
                      styles.noticeBox,
                      { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                    ]}
                  >
                    <Text style={{ fontSize: 12, color: palette.roseText }}>{error}</Text>
                  </View>
                ) : null}

                {lastResult ? (
                  <View
                    style={[
                      styles.noticeBox,
                      {
                        backgroundColor: palette.emeraldBg,
                        borderColor: palette.emeraldBorder,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 12, color: palette.emeraldText, lineHeight: 17 }}>
                      ✓ Campaña encolada ({lastResult.total} destinatarios). Se enviará en
                      segundo plano; actualiza en unos segundos para ver el avance.
                    </Text>
                  </View>
                ) : null}

                {!confirming ? (
                  <Button
                    disabled={!canSend}
                    onPress={() => setConfirming(true)}
                    icon={<Icon name="Send" size={14} color="#ffffff" />}
                  >
                    {`Enviar a ${audienceCount ?? 0} ${(audienceCount ?? 0) === 1 ? 'lead' : 'leads'}`}
                  </Button>
                ) : (
                  <View
                    style={[
                      styles.confirmBox,
                      { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                    ]}
                  >
                    <Text style={{ fontSize: 12, color: palette.textPrimary, lineHeight: 17 }}>
                      Vas a enviar{' '}
                      <Text style={{ fontWeight: '700' }}>
                        “{selectedTemplate?.displayName}”
                      </Text>{' '}
                      a <Text style={{ fontWeight: '800' }}>{audienceCount ?? 0}</Text> leads.
                      Esto genera consumo en Meta/YCloud y no se puede deshacer.
                    </Text>
                    <View style={[styles.rowCenter, { marginTop: 10 }]}>
                      <Button
                        size="sm"
                        loading={sending}
                        onPress={() => void handleSendBroadcast()}
                      >
                        Confirmar envío
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={sending}
                        onPress={() => setConfirming(false)}
                      >
                        Cancelar
                      </Button>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>

          {/* Historial de campañas */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionHeader, { color: palette.textMuted }]}>
              ENVÍOS ANTERIORES ({broadcasts.length})
            </Text>

            {broadcasts.length === 0 ? (
              <EmptyState
                icon="Send"
                title="Aún no has enviado ninguna campaña"
                description="Tus envíos masivos aparecerán aquí con métricas de entrega y lectura en tiempo real."
              />
            ) : (
              broadcasts.map((b) => {
                const st = BROADCAST_STATUS_BADGE[b.status] ?? {
                  label: b.status,
                  tone: 'sky' as const,
                };
                const total = b.total ?? 0;
                const sent = b.sent ?? 0;
                const delivered = b.delivered ?? 0;
                const read = b.read ?? 0;
                const undelivered = b.undelivered ?? 0;
                const failed = b.failed ?? 0;
                const pendingDelivery = Math.max(0, sent - delivered - undelivered);

                const cells = [
                  { label: 'Audiencia', value: total, sub: '100%', color: palette.textPrimary },
                  {
                    label: 'Enviados',
                    value: sent,
                    sub: pctText(sent, total),
                    color: palette.skyText,
                  },
                  {
                    label: 'Sin confirmar',
                    value: pendingDelivery,
                    sub: pctText(pendingDelivery, sent),
                    color: palette.amberText,
                  },
                  {
                    label: 'Leídos',
                    value: read,
                    sub: pctText(read, delivered || sent),
                    color: palette.brandText,
                  },
                  {
                    label: 'No llegaron',
                    value: undelivered,
                    sub: pctText(undelivered, sent),
                    color: palette.roseText,
                  },
                  {
                    label: 'No enviados',
                    value: failed,
                    sub: pctText(failed, total),
                    color: palette.textMuted,
                  },
                ];

                return (
                  <View
                    key={b.id}
                    style={[
                      styles.card,
                      { backgroundColor: palette.bgCard, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: palette.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {b.templateName}
                        </Text>
                        <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 2 }}>
                          {b.createdAt
                            ? new Date(b.createdAt).toLocaleString('es-CO', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Recién creada'}
                        </Text>
                      </View>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </View>

                    <View style={styles.rowWrap}>
                      <Badge tone="neutral">{formatAudienceLabel(b.audience)}</Badge>
                    </View>

                    <View style={styles.statsGrid}>
                      {cells.map((cell) => (
                        <View
                          key={cell.label}
                          style={[
                            styles.statCell,
                            {
                              backgroundColor: palette.bgElevated,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                            {cell.label}
                          </Text>
                          <View style={[styles.rowBetween, { marginTop: 3 }]}>
                            <Text
                              style={{
                                fontSize: 15,
                                fontWeight: '800',
                                color: cell.color,
                              }}
                            >
                              {cell.value}
                            </Text>
                            <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                              {cell.sub}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })
            )}
          </View>
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
    gap: 14,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 5,
  },
  microTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  audiencePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  audPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  confirmBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statCell: {
    width: '31.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
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
