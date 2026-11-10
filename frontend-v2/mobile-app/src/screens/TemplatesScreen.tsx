import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { listTemplates, uploadMedia } from '../services/crm';
import {
  createTemplate,
  deleteTemplate,
  listMessagingLines,
  syncTemplates,
  type MessagingLine,
} from '../services/enterprise';
import { isAdminRole, type RootStackParams, type WhatsAppTemplate } from '../types';
import { formatPhone } from '../utils/formatPhone';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon, type LucideIconName } from '../components/Icon';
import { LoadingView } from '../components/LoadingView';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';

type Props = NativeStackScreenProps<RootStackParams, 'Templates'>;

type HeaderType = 'none' | 'text' | 'image' | 'video' | 'document';
type TemplateCategory = 'marketing' | 'utility' | 'authentication';
type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

interface TemplateButtonDraft {
  type: ButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  example?: string;
}

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'marketing', label: 'Marketing (promos, seguimiento)' },
  { value: 'utility', label: 'Utilidad (confirmaciones, avisos)' },
  { value: 'authentication', label: 'Autenticación (códigos OTP)' },
];

const HEADER_OPTIONS: { value: HeaderType; label: string }[] = [
  { value: 'none', label: 'Sin encabezado' },
  { value: 'text', label: 'Texto' },
  { value: 'image', label: 'Imagen' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'PDF' },
];

const BUTTON_TYPE_OPTIONS: SelectOption[] = [
  { value: 'QUICK_REPLY', label: 'Respuesta rápida' },
  { value: 'URL', label: 'Abrir enlace (URL)' },
  { value: 'PHONE_NUMBER', label: 'Llamar a teléfono' },
  { value: 'COPY_CODE', label: 'Copiar código' },
];

const STATUS_BADGE: Record<
  string,
  { label: string; tone: 'emerald' | 'sky' | 'amber' | 'rose' }
> = {
  approved: { label: 'Aprobada', tone: 'emerald' },
  local: { label: 'Solo local', tone: 'sky' },
  pending: { label: 'En revisión', tone: 'amber' },
  rejected: { label: 'Rechazada', tone: 'rose' },
};

const CAT_ICON: Record<string, LucideIconName> = {
  marketing: 'Megaphone',
  utility: 'Bell',
  authentication: 'Lock',
};

function toSnakeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function extractBodyVariables(body: string): string[] {
  const seen = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    seen.add(m[1].trim());
  }
  return [...seen];
}

export function TemplatesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const auth = useAuth();
  const { companyId, role, platformAdmin } = auth;
  const isAdmin = Boolean(
    (auth as { isAdmin?: boolean }).isAdmin ?? (isAdminRole(role) || platformAdmin)
  );

  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [lines, setLines] = useState<MessagingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Estado del formulario de creación
  const [selectedLine, setSelectedLine] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [category, setCategory] = useState<TemplateCategory>('marketing');
  const [headerType, setHeaderType] = useState<HeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [body, setBody] = useState('Hola {{1}}, te escribimos de Meraki...');
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<TemplateButtonDraft[]>([]);
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  const load = useCallback(
    async (isPull = false) => {
      if (!companyId || !isAdmin) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [tpls, msgLines] = await Promise.all([
          listTemplates(companyId),
          listMessagingLines(companyId).catch(() => []),
        ]);
        setTemplates(tpls);
        setLines(msgLines);
        if (msgLines.length > 0 && !selectedLine) {
          const def = msgLines.find((l) => l.isDefault) || msgLines[0];
          if (def) setSelectedLine(def.number);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'No se pudieron cargar las plantillas.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, isAdmin, selectedLine]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const detectedVars = useMemo(() => extractBodyVariables(body), [body]);

  const previewBody = useMemo(() => {
    return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, k: string) => {
      const key = k.trim();
      return examples[key]?.trim() || `[${key}]`;
    });
  }, [body, examples]);

  const resetForm = () => {
    setDisplayName('');
    setName('');
    setNameEdited(false);
    setCategory('marketing');
    setHeaderType('none');
    setHeaderText('');
    setHeaderMediaUrl('');
    setHeaderFileName('');
    setBody('Hola {{1}}, te escribimos de Meraki...');
    setExamples({});
    setFooter('');
    setButtons([]);
    setFormError(null);
  };

  const handleSync = async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const n = await syncTemplates(companyId);
      setSyncNotice(`${n} sincronizada${n === 1 ? '' : 's'} desde YCloud`);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar con YCloud.');
    } finally {
      setSyncing(false);
    }
  };

  const handlePickHeaderMedia = async () => {
    if (!companyId || uploadingMedia) return;
    setFormError(null);

    try {
      let localFile: { uri: string; name: string; mimeType: string; size?: number } | null =
        null;

      if (headerType === 'document') {
        const res = await DocumentPicker.getDocumentAsync({
          type: 'application/pdf',
          copyToCacheDirectory: true,
        });
        if (res.canceled || !res.assets?.[0]) return;
        const asset = res.assets[0];
        localFile = {
          uri: asset.uri,
          name: asset.name || 'documento.pdf',
          mimeType: asset.mimeType || 'application/pdf',
          size: asset.size,
        };
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setFormError('Concede permiso a la galería para elegir imagen o video.');
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: headerType === 'video' ? ['videos'] : ['images'],
          quality: 0.85,
        });
        if (res.canceled || !res.assets?.[0]) return;
        const asset = res.assets[0];
        const fallbackExt = headerType === 'video' ? 'mp4' : 'jpg';
        const fallbackMime = headerType === 'video' ? 'video/mp4' : 'image/jpeg';
        localFile = {
          uri: asset.uri,
          name: asset.fileName || `header_${Date.now()}.${fallbackExt}`,
          mimeType: asset.mimeType || fallbackMime,
          size: asset.fileSize,
        };
      }

      if (!localFile) return;

      setUploadingMedia(true);
      setUploadPct(0);
      const uploaded = await uploadMedia(companyId, 'templates', localFile, (pct) =>
        setUploadPct(pct)
      );
      setHeaderMediaUrl(uploaded.downloadUrl);
      setHeaderFileName(uploaded.fileName);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al subir archivo multimedia.');
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!companyId || savingForm) return;
    setFormError(null);

    if (!displayName.trim() || !name.trim() || !body.trim()) {
      setFormError('Completa el nombre visible, el identificador y el cuerpo del mensaje.');
      return;
    }
    if (headerType === 'text' && !headerText.trim()) {
      setFormError('Escribe el texto del encabezado o elige "Sin encabezado".');
      return;
    }
    if (
      (headerType === 'image' || headerType === 'video' || headerType === 'document') &&
      !headerMediaUrl
    ) {
      setFormError('Sube el archivo multimedia del encabezado antes de guardar.');
      return;
    }
    const missingExample = detectedVars.find((k) => !examples[k]?.trim());
    if (missingExample) {
      setFormError(
        `Meta exige un ejemplo para cada variable. Falta el ejemplo de {{${missingExample}}}.`
      );
      return;
    }

    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      if (b.type !== 'COPY_CODE' && !b.text.trim()) {
        setFormError(`Escribe el texto del botón #${i + 1}.`);
        return;
      }
      if (b.type === 'URL' && (!b.url || !/^https?:\/\//i.test(b.url))) {
        setFormError(`El botón #${i + 1} requiere una URL válida con https://`);
        return;
      }
      if (b.type === 'PHONE_NUMBER' && !b.phoneNumber?.trim()) {
        setFormError(`El botón #${i + 1} requiere un número de teléfono.`);
        return;
      }
      if (b.type === 'COPY_CODE' && !b.example?.trim()) {
        setFormError(`El botón #${i + 1} requiere un código de ejemplo.`);
        return;
      }
    }

    setSavingForm(true);
    try {
      await createTemplate(
        companyId,
        {
          name: name.trim(),
          displayName: displayName.trim(),
          category,
          language: 'es',
          headerType,
          headerText: headerType === 'text' ? headerText.trim() : undefined,
          headerMediaUrl:
            headerType === 'image' || headerType === 'video' || headerType === 'document'
              ? headerMediaUrl
              : undefined,
          body: body.trim(),
          footer: footer.trim() || undefined,
          buttons: buttons.map((b) => ({
            type: b.type,
            text: b.type === 'COPY_CODE' ? 'Copiar código' : b.text.trim(),
            ...(b.type === 'URL' ? { url: b.url?.trim() } : {}),
            ...(b.type === 'PHONE_NUMBER' ? { phoneNumber: b.phoneNumber?.trim() } : {}),
            ...(b.type === 'COPY_CODE' ? { example: b.example?.trim() } : {}),
          })),
          variables: detectedVars.map((k) => ({ key: k, example: examples[k]?.trim() ?? '' })),
        },
        selectedLine || undefined
      );
      resetForm();
      setCreating(false);
      await load(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear la plantilla.');
    } finally {
      setSavingForm(false);
    }
  };

  const confirmDelete = (tpl: WhatsAppTemplate) => {
    if (!companyId) return;
    Alert.alert(
      'Eliminar plantilla',
      `¿Eliminar la plantilla "${tpl.displayName}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTemplate(companyId, tpl.id);
              await load(true);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'No se pudo eliminar la plantilla.'
              );
            }
          },
        },
      ]
    );
  };

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
        <ScreenHeader title="Plantillas" onBack={handleBack} />
        <EmptyState
          icon="Lock"
          title="Acceso restringido"
          description="Solo los administradores pueden crear o sincronizar plantillas oficiales de Meta."
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Plantillas"
        subtitle="Aprobadas por Meta para iniciar o retomar conversaciones."
        onBack={handleBack}
        action={
          <View style={styles.rowCenter}>
            <Button
              size="sm"
              variant="secondary"
              loading={syncing}
              onPress={() => void handleSync()}
              icon={<Icon name="RefreshCw" size={13} color={palette.textPrimary} />}
            >
              Sync YCloud
            </Button>
            <Button
              size="sm"
              variant={creating ? 'secondary' : 'primary'}
              onPress={() => {
                if (creating) resetForm();
                setCreating((prev) => !prev);
              }}
              icon={
                <Icon
                  name={creating ? 'X' : 'Plus'}
                  size={13}
                  color={creating ? palette.textPrimary : '#ffffff'}
                />
              }
            >
              {creating ? 'Cerrar' : 'Nueva'}
            </Button>
          </View>
        }
      />

      {loading && templates.length === 0 ? (
        <LoadingView label="Cargando plantillas de WhatsApp..." />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={palette.brand}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* Aviso aprobación Meta */}
          <View
            style={[
              styles.infoBox,
              { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
            ]}
          >
            <Text style={{ fontSize: 12, color: palette.textSecondary, lineHeight: 17 }}>
              Las plantillas que creas aquí se envían automáticamente a{' '}
              <Text style={{ fontWeight: '700', color: palette.amberText }}>
                YCloud → Meta
              </Text>{' '}
              para aprobación (1 min a 2 horas). Pulsa «Sync YCloud» para actualizar su estado.
            </Text>
          </View>

          {syncNotice ? (
            <View
              style={[
                styles.infoBox,
                { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
              ]}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: palette.emeraldText }}>
                ✓ {syncNotice}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View
              style={[
                styles.infoBox,
                { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
              ]}
            >
              <Text style={{ fontSize: 12, color: palette.roseText }}>{error}</Text>
            </View>
          ) : null}

          {/* Formulario de creación de plantilla */}
          {creating && (
            <View
              style={[
                styles.formCard,
                { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
              ]}
            >
              <Text style={[styles.formTitle, { color: palette.textPrimary }]}>
                Crear nueva plantilla Meta
              </Text>

              {lines.length > 1 && (
                <View>
                  <Text style={[styles.label, { color: palette.textMuted }]}>
                    Línea de envío (WABA)
                  </Text>
                  <SelectModal
                    value={selectedLine}
                    options={lines.map((l) => ({
                      value: l.number,
                      label: `${formatPhone(l.number)}${l.isDefault ? ' (Principal)' : ''}`,
                    }))}
                    onChange={setSelectedLine}
                    title="Línea de WhatsApp"
                  />
                </View>
              )}

              <View>
                <Text style={[styles.label, { color: palette.textMuted }]}>Nombre visible</Text>
                <TextInput
                  value={displayName}
                  onChangeText={(val) => {
                    setDisplayName(val);
                    if (!nameEdited) setName(toSnakeName(val));
                  }}
                  placeholder="Ej. Bienvenida Río Claro"
                  placeholderTextColor={palette.placeholder}
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

              <View style={styles.gridTwo}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>Categoría</Text>
                  <SelectModal
                    value={category}
                    options={CATEGORY_OPTIONS}
                    onChange={(v) => setCategory(v as TemplateCategory)}
                    title="Categoría Meta"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>
                    ID Meta (snake_case)
                  </Text>
                  <TextInput
                    value={name}
                    onChangeText={(v) => {
                      setNameEdited(true);
                      setName(v.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                    }}
                    placeholder="bienvenida_rio_claro"
                    placeholderTextColor={palette.placeholder}
                    autoCapitalize="none"
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
              </View>

              {/* Tipo de Encabezado */}
              <View>
                <Text style={[styles.label, { color: palette.textMuted }]}>
                  Encabezado (opcional)
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6 }}
                >
                  {HEADER_OPTIONS.map((opt) => {
                    const active = headerType === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          setHeaderType(opt.value);
                          setHeaderMediaUrl('');
                          setHeaderFileName('');
                          setFormError(null);
                        }}
                        style={[
                          styles.headerPill,
                          {
                            backgroundColor: active ? palette.brandSoft : palette.bgElevated,
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
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {headerType === 'text' && (
                  <TextInput
                    value={headerText}
                    onChangeText={setHeaderText}
                    maxLength={60}
                    placeholder="Título corto (máx. 60 caracteres)"
                    placeholderTextColor={palette.placeholder}
                    style={[
                      styles.input,
                      {
                        marginTop: 8,
                        backgroundColor: palette.bgInput,
                        borderColor: palette.borderInput,
                        color: palette.textPrimary,
                      },
                    ]}
                  />
                )}

                {(headerType === 'image' ||
                  headerType === 'video' ||
                  headerType === 'document') && (
                  <View style={{ marginTop: 8 }}>
                    {!headerMediaUrl ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={uploadingMedia}
                        onPress={() => void handlePickHeaderMedia()}
                        icon={<Icon name="Upload" size={13} color={palette.textPrimary} />}
                      >
                        {uploadingMedia
                          ? `Subiendo ${uploadPct}%...`
                          : headerType === 'image'
                            ? 'Subir imagen (JPG/PNG)'
                            : headerType === 'video'
                              ? 'Subir video (MP4)'
                              : 'Subir documento PDF'}
                      </Button>
                    ) : (
                      <View
                        style={[
                          styles.uploadedMediaBox,
                          {
                            backgroundColor: palette.bgElevated,
                            borderColor: palette.border,
                          },
                        ]}
                      >
                        {headerType === 'image' ? (
                          <Image
                            source={{ uri: headerMediaUrl }}
                            style={styles.headerThumb}
                          />
                        ) : (
                          <Icon
                            name={headerType === 'video' ? 'Video' : 'FileText'}
                            size={18}
                            color={palette.brandText}
                          />
                        )}
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: palette.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {headerFileName || 'Archivo subido'}
                        </Text>
                        <Pressable
                          onPress={() => {
                            setHeaderMediaUrl('');
                            setHeaderFileName('');
                          }}
                        >
                          <Text style={{ fontSize: 12, color: palette.roseText }}>Quitar</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Cuerpo */}
              <View>
                <Text style={[styles.label, { color: palette.textMuted }]}>
                  Cuerpo del mensaje (usa {'{{1}}'}, {'{{2}}'} para variables)
                </Text>
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  multiline
                  numberOfLines={4}
                  style={[
                    styles.textArea,
                    {
                      backgroundColor: palette.bgInput,
                      borderColor: palette.borderInput,
                      color: palette.textPrimary,
                    },
                  ]}
                />
              </View>

              {/* Ejemplos de variables */}
              {detectedVars.length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.label, { color: palette.textMuted }]}>
                    Ejemplos para revisión de Meta (obligatorio)
                  </Text>
                  {detectedVars.map((k) => (
                    <View key={k} style={styles.rowCenter}>
                      <Badge tone="brand">{`{{${k}}}`}</Badge>
                      <TextInput
                        value={examples[k] ?? ''}
                        onChangeText={(val) =>
                          setExamples((prev) => ({ ...prev, [k]: val }))
                        }
                        placeholder="Ej. Carlos"
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

              {/* Pie de página */}
              <View>
                <Text style={[styles.label, { color: palette.textMuted }]}>
                  Pie de página (opcional, máx. 60 caracteres)
                </Text>
                <TextInput
                  value={footer}
                  onChangeText={setFooter}
                  maxLength={60}
                  placeholder="Ej. Responde STOP para no recibir más mensajes"
                  placeholderTextColor={palette.placeholder}
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

              {/* Botones interactivos */}
              <View style={{ gap: 8 }}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.label, { color: palette.textMuted, marginBottom: 0 }]}>
                    Botones interactivos (máx. 3)
                  </Text>
                  {buttons.length < 3 && (
                    <Pressable
                      onPress={() =>
                        setButtons((prev) => [
                          ...prev,
                          { type: 'QUICK_REPLY', text: '' },
                        ])
                      }
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '700',
                          color: palette.brandText,
                        }}
                      >
                        + Agregar botón
                      </Text>
                    </Pressable>
                  )}
                </View>

                {buttons.map((b, i) => (
                  <View
                    key={i}
                    style={[
                      styles.btnDraftBox,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowCenter}>
                      <View style={{ flex: 1 }}>
                        <SelectModal
                          value={b.type}
                          options={BUTTON_TYPE_OPTIONS}
                          compact
                          title="Tipo de botón"
                          onChange={(t) =>
                            setButtons((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { type: t as ButtonType, text: x.text } : x
                              )
                            )
                          }
                        />
                      </View>
                      <Pressable
                        onPress={() =>
                          setButtons((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        hitSlop={8}
                      >
                        <Icon name="Trash2" size={15} color={palette.roseText} />
                      </Pressable>
                    </View>

                    {b.type !== 'COPY_CODE' && (
                      <TextInput
                        value={b.text}
                        onChangeText={(txt) =>
                          setButtons((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, text: txt } : x))
                          )
                        }
                        maxLength={25}
                        placeholder="Texto del botón (máx. 25)"
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.input,
                          {
                            backgroundColor: palette.bgInput,
                            borderColor: palette.borderInput,
                            color: palette.textPrimary,
                          },
                        ]}
                      />
                    )}

                    {b.type === 'URL' && (
                      <TextInput
                        value={b.url ?? ''}
                        onChangeText={(u) =>
                          setButtons((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, url: u } : x))
                          )
                        }
                        autoCapitalize="none"
                        placeholder="https://tu-sitio.com/proyecto"
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.input,
                          {
                            backgroundColor: palette.bgInput,
                            borderColor: palette.borderInput,
                            color: palette.textPrimary,
                          },
                        ]}
                      />
                    )}

                    {b.type === 'PHONE_NUMBER' && (
                      <TextInput
                        value={b.phoneNumber ?? ''}
                        onChangeText={(ph) =>
                          setButtons((prev) =>
                            prev.map((x, idx) =>
                              idx === i ? { ...x, phoneNumber: ph } : x
                            )
                          )
                        }
                        keyboardType="phone-pad"
                        placeholder="+573001234567"
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.input,
                          {
                            backgroundColor: palette.bgInput,
                            borderColor: palette.borderInput,
                            color: palette.textPrimary,
                          },
                        ]}
                      />
                    )}

                    {b.type === 'COPY_CODE' && (
                      <TextInput
                        value={b.example ?? ''}
                        onChangeText={(ex) =>
                          setButtons((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, example: ex } : x))
                          )
                        }
                        maxLength={15}
                        placeholder="Código de ejemplo (ej. PROMO25)"
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.input,
                          {
                            backgroundColor: palette.bgInput,
                            borderColor: palette.borderInput,
                            color: palette.textPrimary,
                          },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </View>

              {/* Vista previa estilo burbuja WhatsApp */}
              <View
                style={[
                  styles.previewWrap,
                  { backgroundColor: palette.bgElevated, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.sectionMicro, { color: palette.textSubtle }]}>
                  VISTA PREVIA EN WHATSAPP
                </Text>
                <View
                  style={[
                    styles.waBubble,
                    {
                      backgroundColor: palette.emeraldBg,
                      borderColor: palette.emeraldBorder,
                    },
                  ]}
                >
                  {headerType === 'text' && headerText ? (
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '700',
                        color: palette.textPrimary,
                        marginBottom: 4,
                      }}
                    >
                      {headerText}
                    </Text>
                  ) : null}
                  {headerType === 'image' && headerMediaUrl ? (
                    <Image source={{ uri: headerMediaUrl }} style={styles.previewImage} />
                  ) : null}
                  {(headerType === 'video' || headerType === 'document') && headerMediaUrl ? (
                    <Text
                      style={{
                        fontSize: 11.5,
                        fontWeight: '600',
                        color: palette.brandText,
                        marginBottom: 4,
                      }}
                    >
                      📎 {headerFileName || headerType.toUpperCase()}
                    </Text>
                  ) : null}
                  <Text
                    style={{
                      fontSize: 13,
                      color: palette.textPrimary,
                      lineHeight: 18,
                    }}
                  >
                    {previewBody}
                  </Text>
                  {footer ? (
                    <Text
                      style={{
                        fontSize: 11,
                        color: palette.textSubtle,
                        marginTop: 6,
                      }}
                    >
                      {footer}
                    </Text>
                  ) : null}
                  {buttons.length > 0 && (
                    <View
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.emeraldBorder,
                        gap: 4,
                      }}
                    >
                      {buttons.map((b, idx) => (
                        <Text
                          key={idx}
                          style={{
                            textAlign: 'center',
                            fontSize: 12,
                            fontWeight: '700',
                            color: palette.skyText,
                            paddingVertical: 3,
                          }}
                        >
                          {b.type === 'COPY_CODE'
                            ? '📋 Copiar código'
                            : b.text || 'Botón'}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {formError ? (
                <Text style={{ fontSize: 12, color: palette.roseText }}>{formError}</Text>
              ) : null}

              <View style={styles.rowEnd}>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    resetForm();
                    setCreating(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  loading={savingForm}
                  disabled={uploadingMedia}
                  onPress={() => void handleCreateTemplate()}
                >
                  Guardar y enviar a Meta
                </Button>
              </View>
            </View>
          )}

          {/* Lista de plantillas */}
          {templates.length === 0 ? (
            <EmptyState
              icon="LayoutTemplate"
              title="No tienes plantillas aún"
              description="Pulsa «Nueva» para crear una plantilla o «Sync YCloud» para traer las ya aprobadas en tu cuenta."
            />
          ) : (
            <View style={{ gap: 10 }}>
              {templates.map((t) => {
                const st = STATUS_BADGE[t.status] ?? STATUS_BADGE.local;
                const iconName = CAT_ICON[t.category] ?? 'LayoutTemplate';
                return (
                  <View
                    key={t.id}
                    style={[
                      styles.tplCard,
                      { backgroundColor: palette.bgCard, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <View style={[styles.rowCenter, { flex: 1 }]}>
                        <Icon name={iconName} size={15} color={palette.brandText} />
                        <Text
                          style={[styles.tplTitle, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {t.displayName}
                        </Text>
                      </View>
                      <Pressable onPress={() => confirmDelete(t)} hitSlop={10}>
                        <Icon name="Trash2" size={15} color={palette.textSubtle} />
                      </Pressable>
                    </View>

                    <View style={[styles.rowWrap, { marginTop: 6 }]}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {t.lineNumber ? (
                        <Badge tone="neutral">{formatPhone(t.lineNumber)}</Badge>
                      ) : null}
                      {t.name ? (
                        <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                          {t.name}
                        </Text>
                      ) : null}
                    </View>

                    <Text
                      style={{
                        fontSize: 12.5,
                        color: palette.textSecondary,
                        marginTop: 8,
                        lineHeight: 18,
                      }}
                    >
                      {t.body}
                    </Text>

                    {(t.variables?.length > 0 ||
                      (t.headerType && t.headerType !== 'none') ||
                      t.footer ||
                      (t.buttons && t.buttons.length > 0)) && (
                      <View style={[styles.rowWrap, { marginTop: 8 }]}>
                        {t.headerType && t.headerType !== 'none' ? (
                          <Badge tone="neutral">{`Encabezado: ${t.headerType}`}</Badge>
                        ) : null}
                        {t.footer ? <Badge tone="neutral">Pie de página</Badge> : null}
                        {t.buttons && t.buttons.length > 0 ? (
                          <Badge tone="sky">{`${t.buttons.length} botón(es)`}</Badge>
                        ) : null}
                        {t.variables?.map((v) => (
                          <Badge key={v.key} tone="brand">{`{{${v.key}}}`}</Badge>
                        ))}
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
  infoBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  formTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
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
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  gridTwo: {
    flexDirection: 'row',
    gap: 10,
  },
  headerPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  uploadedMediaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  headerThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  btnDraftBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  previewWrap: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  sectionMicro: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  waBubble: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
  },
  previewImage: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginBottom: 6,
  },
  tplCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
  },
  tplTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
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
  rowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
});
