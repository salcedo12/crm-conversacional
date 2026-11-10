import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon, type LucideIconName } from '../components/Icon';
import { Button } from '../components/Button';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useBranding } from '../providers/BrandingProvider';
import { useLibrary } from '../hooks/useLibrary';
import { fetchAiConfig, persistAiConfig, type AiConfigDraft } from '../services/aiConfig';
import {
  createCompanyUser,
  createLeadSource,
  deleteLeadFormTemplate,
  deleteLibraryAsset,
  getMetaAdsConfig,
  getPushNotificationStatus,
  getSchedulingConfig,
  getSlaConfig,
  listBlockedAdvisors,
  listCompanyUsers,
  listLeadFormTemplates,
  listPlatformCompanies,
  saveChannelRoute,
  saveContactFields,
  saveMetaAdsConfig,
  savePlatformCompany,
  saveSchedulingConfig,
  saveSlaConfig,
  sendTestPushToDevice,
  setLeadFormTemplate,
  subscribeLeadSources,
  testAiAssistant,
  testMetaAdsConnection,
  toggleLeadSourceActive,
  unblockAdvisorManual,
  updateCompanyUser,
  updateLeadSourceName,
  uploadLibraryAsset,
  type LeadSourceItem,
  type PlatformCompany,
} from '../services/enterprise';
import type { RootStackParams } from '../types';

type Tab =
  | 'marca'
  | 'ia'
  | 'conexiones'
  | 'agenda'
  | 'sla'
  | 'pautas'
  | 'fuentes'
  | 'portafolios'
  | 'usuarios'
  | 'campos'
  | 'empresas';

interface TabDef {
  key: Tab;
  label: string;
  icon: LucideIconName;
  adminOnly?: boolean;
  platformOnly?: boolean;
}

const TABS: TabDef[] = [
  { key: 'marca', label: 'Marca', icon: 'Building2', adminOnly: true },
  { key: 'ia', label: 'Asistente IA', icon: 'Bot', adminOnly: true },
  { key: 'conexiones', label: 'Conexiones', icon: 'Phone' },
  { key: 'agenda', label: 'Agenda', icon: 'Calendar', adminOnly: true },
  { key: 'sla', label: 'Protocolo SLA', icon: 'Clock', adminOnly: true },
  { key: 'pautas', label: 'Pautas', icon: 'Megaphone', adminOnly: true },
  { key: 'fuentes', label: 'Fuentes de Origen', icon: 'Tag', adminOnly: true },
  { key: 'portafolios', label: 'Portafolios', icon: 'FolderOpen', adminOnly: true },
  { key: 'usuarios', label: 'Usuarios', icon: 'Users', adminOnly: true },
  { key: 'campos', label: 'Campos', icon: 'Sliders', adminOnly: true },
  { key: 'empresas', label: 'Empresas', icon: 'Layers', adminOnly: true, platformOnly: true },
];

export function ConfigScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute();
  const initialTab = (route.params as RootStackParams['Config'])?.initialTab as Tab | undefined;

  const { companyId, profile, platformAdmin, isAdmin, signOut } = useAuth();
  const { palette } = useTheme();
  const resolvedCompanyId = companyId ?? 'grupo_meraki_real';

  const visibleTabs = TABS.filter((t) => {
    if (t.platformOnly) return platformAdmin;
    return !t.adminOnly || isAdmin;
  });

  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab || (isAdmin ? 'marca' : 'conexiones')
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bgCanvas }]}>
      <ScreenHeader
        title="Configuración"
        subtitle={profile?.displayName ? `Gestionado por ${profile.displayName}` : undefined}
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
        action={
          <Pressable
            onPress={() => void signOut()}
            style={[styles.signOutBtn, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}
          >
            <Icon name="LogOut" size={13} color={palette.roseText} />
            <Text style={[styles.signOutBtnText, { color: palette.roseText }]}>Salir</Text>
          </Pressable>
        }
      />

      {/* Barra de pestañas horizontal */}
      <View style={[styles.tabBar, { borderBottomColor: palette.border, backgroundColor: palette.bgCanvas }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {visibleTabs.map((t) => {
            const isSelected = activeTab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setActiveTab(t.key)}
                style={[
                  styles.tabItem,
                  isSelected && {
                    borderBottomColor: palette.brand,
                    backgroundColor: palette.brandBg,
                  },
                ]}
              >
                <Icon
                  name={t.icon}
                  size={14}
                  color={isSelected ? palette.brandText : palette.textSubtle}
                />
                <Text
                  style={[
                    styles.tabItemText,
                    {
                      color: isSelected ? palette.brandText : palette.textSubtle,
                      fontWeight: isSelected ? '700' : '500',
                    },
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Contenido según pestaña */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {activeTab === 'marca' && <MarcaSection />}
        {activeTab === 'ia' && <IaSection companyId={resolvedCompanyId} />}
        {activeTab === 'conexiones' && <ConexionesSection companyId={resolvedCompanyId} />}
        {activeTab === 'agenda' && <AgendaSection companyId={resolvedCompanyId} />}
        {activeTab === 'sla' && <SlaSection companyId={resolvedCompanyId} />}
        {activeTab === 'pautas' && <PautasSection companyId={resolvedCompanyId} />}
        {activeTab === 'fuentes' && <FuentesSection companyId={resolvedCompanyId} />}
        {activeTab === 'portafolios' && <PortafoliosSection companyId={resolvedCompanyId} />}
        {activeTab === 'usuarios' && <UsuariosSection companyId={resolvedCompanyId} />}
        {activeTab === 'campos' && <CamposSection companyId={resolvedCompanyId} />}
        {activeTab === 'empresas' && platformAdmin && <EmpresasSection />}
      </ScrollView>
    </View>
  );
}

// ── 1. MARCA ─────────────────────────────────────────────────────────────────
function MarcaSection() {
  const { palette } = useTheme();
  const { branding, draft, update, save, reset, isDirty, status } = useBranding();

  const handleSave = async () => {
    try {
      await save();
      Alert.alert('Éxito', 'Identidad de marca guardada.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la marca.');
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Identidad de Marca</Text>
      <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
        Personaliza el nombre de la aplicación, el lema y los colores corporativos.
      </Text>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Nombre de la aplicación</Text>
        <TextInput
          value={draft.appName}
          onChangeText={(v) => update('appName', v)}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Lema / Subtítulo</Text>
        <TextInput
          value={draft.tagline}
          onChangeText={(v) => update('tagline', v)}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>URL del Logo</Text>
        <TextInput
          value={draft.logoUrl}
          onChangeText={(v) => update('logoUrl', v)}
          placeholder="https://..."
          placeholderTextColor={palette.textPlaceholder}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Color Principal (Hex)</Text>
        <TextInput
          value={draft.primaryColor}
          onChangeText={(v) => update('primaryColor', v)}
          placeholder="#B7871C"
          placeholderTextColor={palette.textPlaceholder}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.actionsRow}>
        <Button variant="secondary" onPress={reset} disabled={!isDirty || status === 'saving'}>
          Restablecer
        </Button>
        <Button onPress={handleSave} loading={status === 'saving'} disabled={!isDirty || status === 'saving'}>
          Guardar Cambios
        </Button>
      </View>
    </View>
  );
}

// ── 2. ASISTENTE IA ──────────────────────────────────────────────────────────
function IaSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AiConfigDraft | null>(null);

  // Playground test chat
  const [testMsg, setTestMsg] = useState('');
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAiConfig(companyId)
      .then((cfg) => {
        setDraft({
          enabled: cfg.enabled,
          assistantName: cfg.assistantName,
          businessName: cfg.businessName,
          basePrompt: cfg.basePrompt,
          tone: cfg.tone,
          knowledgeBase: cfg.knowledgeBase,
          fallbackMessage: cfg.fallbackMessage,
          maxContextMessages: cfg.maxContextMessages,
          transferKeywords: cfg.transferKeywords || [],
          blockedTopics: cfg.blockedTopics || [],
          followUpSequence: cfg.followUpSequence || [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await persistAiConfig(companyId, draft);
      Alert.alert('Éxito', 'Configuración de IA actualizada.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestChat = async () => {
    if (!testMsg.trim() || testing) return;
    setTesting(true);
    setTestReply(null);
    try {
      const reply = await testAiAssistant(companyId, testMsg.trim(), [], draft);
      setTestReply(reply);
    } catch {
      setTestReply('Error al probar la IA. Verifica los parámetros.');
    } finally {
      setTesting(false);
    }
  };

  if (loading || !draft) {
    return <ActivityIndicator size="large" color={palette.brand} style={{ paddingVertical: 40 }} />;
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Asistente IA (Victoria)</Text>
            <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
              Habilita la atención autónoma nocturna y respuesta instantánea a prospectos.
            </Text>
          </View>
          <Switch
            value={draft.enabled}
            onValueChange={(val) => setDraft({ ...draft, enabled: val })}
            trackColor={{ false: palette.borderStrong, true: palette.brand }}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Nombre del Asistente</Text>
          <TextInput
            value={draft.assistantName}
            onChangeText={(v) => setDraft({ ...draft, assistantName: v })}
            style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Prompt Base / Rol</Text>
          <TextInput
            value={draft.basePrompt}
            onChangeText={(v) => setDraft({ ...draft, basePrompt: v })}
            multiline
            numberOfLines={4}
            style={[styles.input, styles.textArea, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Base de Conocimiento (Proyectos y Precios)</Text>
          <TextInput
            value={draft.knowledgeBase}
            onChangeText={(v) => setDraft({ ...draft, knowledgeBase: v })}
            multiline
            numberOfLines={5}
            style={[styles.input, styles.textArea, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Mensaje de Transferencia (Fallback)</Text>
          <TextInput
            value={draft.fallbackMessage}
            onChangeText={(v) => setDraft({ ...draft, fallbackMessage: v })}
            multiline
            numberOfLines={2}
            style={[styles.input, styles.textArea, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <Button onPress={handleSave} loading={saving}>
          Guardar Reglas IA
        </Button>
      </View>

      {/* Probar Asistente IA en vivo */}
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>💬 Probar Asistente en Vivo</Text>
        <TextInput
          value={testMsg}
          onChangeText={setTestMsg}
          placeholder="Escribe una pregunta para la IA..."
          placeholderTextColor={palette.textPlaceholder}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
        <Button onPress={handleTestChat} loading={testing} disabled={!testMsg.trim() || testing}>
          Enviar Prueba
        </Button>
        {testReply && (
          <View style={[styles.replyBox, { backgroundColor: palette.brandBg, borderColor: palette.brandBorder }]}>
            <Text style={[styles.replyLabel, { color: palette.brandText }]}>Victoria:</Text>
            <Text style={[styles.replyText, { color: palette.textPrimary }]}>{testReply}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── 3. CONEXIONES ────────────────────────────────────────────────────────────
function ConexionesSection({ companyId }: { companyId: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { palette } = useTheme();
  const [pushStatus, setPushStatus] = useState<any>(null);
  const [testingPush, setTestingPush] = useState(false);

  useEffect(() => {
    getPushNotificationStatus(companyId).then(setPushStatus).catch(() => {});
  }, [companyId]);

  const handleTestPush = async () => {
    setTestingPush(true);
    try {
      await sendTestPushToDevice(companyId);
      Alert.alert('Éxito', 'Notificación push de prueba enviada.');
    } catch {
      Alert.alert('Error', 'No se pudo enviar la notificación.');
    } finally {
      setTestingPush(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {/* WhatsApp del Asesor */}
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <View style={styles.cardHeaderRow}>
          <Icon name="Phone" size={20} color={palette.brandText} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>WhatsApp Directo del Asesor</Text>
            <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
              Conecta tu número personal vía código QR para responder desde tu línea.
            </Text>
          </View>
        </View>
        <Button onPress={() => navigation.navigate('AdvisorWhatsapp')}>
          Administrar Conexión WhatsApp
        </Button>
      </View>

      {/* Notificaciones Push FCM */}
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>🔔 Notificaciones Push en Móvil</Text>
        <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
          Estado del servicio Firebase Cloud Messaging para alertas de prospectos y citas.
        </Text>
        {pushStatus && (
          <View style={[styles.statusBox, { backgroundColor: palette.bgElevated }]}>
            <Text style={{ color: palette.textSecondary, fontSize: 12 }}>
              FCM activo · Dispositivos registrados:{' '}
              <Text style={{ color: palette.emeraldText, fontWeight: '700' }}>
                {pushStatus.registeredTokens ?? pushStatus.tokenCount ?? (pushStatus.devices ? pushStatus.devices.length : 1)}
              </Text>
            </Text>
          </View>
        )}
        <Button variant="secondary" onPress={handleTestPush} loading={testingPush}>
          Enviar Notificación de Prueba
        </Button>
      </View>
    </View>
  );
}

// ── 4. AGENDA / HORARIO ──────────────────────────────────────────────────────
function AgendaSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [slotDuration, setSlotDuration] = useState('60');

  useEffect(() => {
    getSchedulingConfig(companyId)
      .then((cfg) => {
        if (cfg) {
          setStartTime(cfg.startTime || '08:00');
          setEndTime(cfg.endTime || '18:00');
          setSlotDuration(String(cfg.slotDuration || '60'));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSchedulingConfig(companyId, {
        startTime,
        endTime,
        slotDuration: parseInt(slotDuration, 10) || 60,
      });
      Alert.alert('Éxito', 'Horario de agenda guardado.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar el horario.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color={palette.brand} style={{ paddingVertical: 40 }} />;
  }

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Horario de Atención y Citas</Text>
      <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
        Define la franja horaria en la que el Asistente IA puede programar visitas y citas.
      </Text>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Hora de Inicio (HH:MM)</Text>
        <TextInput
          value={startTime}
          onChangeText={setStartTime}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Hora de Fin (HH:MM)</Text>
        <TextInput
          value={endTime}
          onChangeText={setEndTime}
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Duración por Cita (minutos)</Text>
        <TextInput
          value={slotDuration}
          onChangeText={setSlotDuration}
          keyboardType="numeric"
          style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
      </View>

      <Button onPress={handleSave} loading={saving}>
        Guardar Horario
      </Button>
    </View>
  );
}

// ── 5. SLA ───────────────────────────────────────────────────────────────────
function SlaSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slaHours, setSlaHours] = useState('24');
  const [blockedAdvisors, setBlockedAdvisors] = useState<any[]>([]);

  useEffect(() => {
    Promise.allSettled([getSlaConfig(companyId), listBlockedAdvisors(companyId)])
      .then(([cfgRes, blkRes]) => {
        if (cfgRes.status === 'fulfilled' && cfgRes.value) {
          setSlaHours(String(cfgRes.value.takeoverHours || '24'));
        }
        if (blkRes.status === 'fulfilled' && blkRes.value) {
          setBlockedAdvisors(blkRes.value);
        }
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSlaConfig(companyId, { takeoverHours: parseInt(slaHours, 10) || 24 });
      Alert.alert('Éxito', 'Protocolo SLA guardado.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la configuración de SLA.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (advisorId: string) => {
    try {
      await unblockAdvisorManual(companyId, advisorId);
      setBlockedAdvisors((prev) => prev.filter((a) => a.id !== advisorId));
      Alert.alert('Éxito', 'Asesor desbloqueado.');
    } catch {
      Alert.alert('Error', 'No se pudo desbloquear al asesor.');
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color={palette.brand} style={{ paddingVertical: 40 }} />;
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Protocolo de Tiempos SLA</Text>
        <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
          Tiempo máximo permitido para registrar Ficha Técnica tras apagar la IA.
        </Text>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Horas de SLA Toma Manual</Text>
          <TextInput
            value={slaHours}
            onChangeText={setSlaHours}
            keyboardType="numeric"
            style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <Button onPress={handleSave} loading={saving}>
          Guardar SLA
        </Button>
      </View>

      {/* Asesores Bloqueados */}
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
          🚨 Asesores con Recepción Pausada ({blockedAdvisors.length})
        </Text>
        {blockedAdvisors.length === 0 ? (
          <Text style={{ color: palette.emeraldText, fontSize: 12 }}>
            Todos los asesores están al día con sus fichas técnicas.
          </Text>
        ) : (
          blockedAdvisors.map((adv) => (
            <View key={adv.id} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '600' }}>
                  {adv.displayName || adv.email}
                </Text>
                <Text style={{ color: palette.roseText, fontSize: 11 }}>
                  {adv.blockedReason || 'SLA de 24h vencido'}
                </Text>
              </View>
              <Button size="sm" variant="secondary" onPress={() => handleUnblock(adv.id)}>
                Desbloquear
              </Button>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

// ── 6. PAUTAS (META ADS) ─────────────────────────────────────────────────────
function PautasSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    Promise.allSettled([getMetaAdsConfig(companyId), listLeadFormTemplates(companyId)])
      .then(([cfg, tmpl]) => {
        if (cfg.status === 'fulfilled' && cfg.value) {
          setAppId(cfg.value.appId || '');
          setAccessToken(cfg.value.accessToken || '');
        }
        if (tmpl.status === 'fulfilled' && tmpl.value) {
          setTemplates(tmpl.value);
        }
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMetaAdsConfig(companyId, { appId, accessToken });
      Alert.alert('Éxito', 'Configuración de Meta Ads guardada.');
    } catch {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      await testMetaAdsConnection(companyId);
      Alert.alert('Conexión Exitosa', 'Meta Ads responde correctamente.');
    } catch {
      Alert.alert('Error', 'No se pudo conectar con Meta Ads.');
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color={palette.brand} style={{ paddingVertical: 40 }} />;
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Integración Meta Ads</Text>
        <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
          Conecta Facebook / Instagram Lead Ads para recepción directa en el CRM.
        </Text>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>App ID</Text>
          <TextInput
            value={appId}
            onChangeText={setAppId}
            style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: palette.textMuted }]}>Access Token</Text>
          <TextInput
            value={accessToken}
            onChangeText={setAccessToken}
            secureTextEntry
            style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
          />
        </View>

        <View style={styles.actionsRow}>
          <Button variant="secondary" onPress={handleTest}>Probar</Button>
          <Button onPress={handleSave} loading={saving}>Guardar</Button>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
          Mapeo de Formularios de Clientes Potenciales ({templates.length})
        </Text>
        {templates.length === 0 ? (
          <Text style={{ color: palette.textSubtle, fontSize: 12 }}>Sin formularios mapeados.</Text>
        ) : (
          templates.map((t) => (
            <View key={t.formId} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '600' }}>
                  {t.formName || t.formId}
                </Text>
                <Text style={{ color: palette.textSubtle, fontSize: 11 }}>Plantilla: {t.templateId}</Text>
              </View>
              <Pressable onPress={() => void deleteLeadFormTemplate(companyId, t.formId)} hitSlop={8}>
                <Icon name="Trash2" size={16} color={palette.roseText} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

// ── 7. FUENTES DE ORIGEN ─────────────────────────────────────────────────────
function FuentesSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    return subscribeLeadSources(companyId, setSources);
  }, [companyId]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await createLeadSource(companyId, newName.trim());
      setNewName('');
    } catch {
      Alert.alert('Error', 'No se pudo crear la fuente.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Fuentes de Captación ({sources.length})</Text>
      <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
        Canales y orígenes para clasificar los prospectos ingresantes.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Nombre de la nueva fuente..."
          placeholderTextColor={palette.textPlaceholder}
          style={[styles.input, { flex: 1, backgroundColor: palette.bgInput, borderColor: palette.borderStrong, color: palette.textPrimary }]}
        />
        <Button onPress={handleCreate} loading={creating} disabled={!newName.trim()}>
          Crear
        </Button>
      </View>

      <View style={{ gap: 8, marginTop: 10 }}>
        {sources.map((src) => (
          <View key={src.id} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '600' }}>{src.name}</Text>
              {src.description ? <Text style={{ color: palette.textSubtle, fontSize: 11 }}>{src.description}</Text> : null}
            </View>
            <Switch
              value={src.active}
              onValueChange={(val) => void toggleLeadSourceActive(companyId, src.id, val)}
              trackColor={{ false: palette.borderStrong, true: palette.brand }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 8. PORTAFOLIOS / BIBLIOTECA ──────────────────────────────────────────────
function PortafoliosSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const { items, loading } = useLibrary(companyId);
  const [uploading, setUploading] = useState(false);

  const handlePickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const file = res.assets[0];
      setUploading(true);
      await uploadLibraryAsset(companyId, file.uri, file.name, file.mimeType || 'application/pdf', {
        title: file.name,
        project: 'General',
        kind: 'document',
        visibility: 'general',
      });
      Alert.alert('Éxito', 'Archivo subido al portafolio.');
    } catch {
      Alert.alert('Error', 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Portafolios y Folletos ({items.length})</Text>
          <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
            Documentos y presentaciones disponibles para envío por WhatsApp.
          </Text>
        </View>
        <Button size="sm" onPress={handlePickFile} loading={uploading}>
          + Subir
        </Button>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={palette.brand} style={{ paddingVertical: 20 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: palette.textSubtle, fontSize: 12 }}>Sin documentos en el portafolio.</Text>
      ) : (
        items.map((item) => (
          <View key={item.id} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '600' }}>{item.title}</Text>
              <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                {item.project || 'General'} · {(item.sizeBytes / 1024).toFixed(0)} KB
              </Text>
            </View>
            <Pressable onPress={() => void deleteLibraryAsset(companyId, item.id, item.storagePath)} hitSlop={8}>
              <Icon name="Trash2" size={16} color={palette.roseText} />
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

// ── 9. USUARIOS ──────────────────────────────────────────────────────────────
function UsuariosSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCompanyUsers(companyId)
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Equipo y Asesores ({users.length})</Text>
      {loading ? (
        <ActivityIndicator size="small" color={palette.brand} style={{ paddingVertical: 20 }} />
      ) : (
        users.map((u) => (
          <View key={u.id} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '600' }}>
                {u.displayName || u.email}
              </Text>
              <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                {u.role || 'advisor'} · {u.email}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: u.active ? palette.emeraldBg : palette.roseBg }]}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: u.active ? palette.emeraldText : palette.roseText }}>
                {u.active ? 'Activo' : 'Inactivo'}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// ── 10. CAMPOS PERSONALIZADOS ────────────────────────────────────────────────
function CamposSection({ companyId }: { companyId: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Campos de Contacto Adicionales</Text>
      <Text style={[styles.cardDesc, { color: palette.textSubtle }]}>
        Campos personalizados para el formulario de ficha y exportaciones.
      </Text>
      <View style={[styles.statusBox, { backgroundColor: palette.bgElevated }]}>
        <Text style={{ color: palette.textSecondary, fontSize: 12 }}>
          Campos estándar activos: Cédula / Documento, Ciudad de Residencia, Proyecto de Interés, Fuente Detallada.
        </Text>
      </View>
    </View>
  );
}

// ── 11. EMPRESAS (platformAdmin) ─────────────────────────────────────────────
function EmpresasSection() {
  const { palette } = useTheme();
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPlatformCompanies()
      .then(setCompanies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={[styles.card, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
        Empresas en la Plataforma ({companies.length})
      </Text>
      {loading ? (
        <ActivityIndicator size="small" color={palette.brand} style={{ paddingVertical: 20 }} />
      ) : (
        companies.map((c) => (
          <View key={c.id} style={[styles.itemRow, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.textPrimary, fontSize: 13, fontWeight: '700' }}>{c.name}</Text>
              <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                ID: {c.id} · {c.environment} · {c.channelRoutes.length} rutas
              </Text>
            </View>
            {c.smartHomeEnabled && (
              <View style={[styles.badge, { backgroundColor: palette.skyBg }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: palette.skyText }}>SmartHome</Text>
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: { borderBottomWidth: 1 },
  tabScroll: { paddingHorizontal: 12 },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemText: { fontSize: 12 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  cardDesc: { fontSize: 11, lineHeight: 16 },
  formGroup: { gap: 4 },
  label: { fontSize: 11, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusBox: { padding: 10, borderRadius: 8 },
  replyBox: { padding: 10, borderRadius: 8, borderWidth: 1, gap: 4 },
  replyLabel: { fontSize: 11, fontWeight: '700' },
  replyText: { fontSize: 12, lineHeight: 17 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  signOutBtnText: { fontSize: 11, fontWeight: '700' },
});
