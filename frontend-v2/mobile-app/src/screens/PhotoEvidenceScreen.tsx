import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  searchLeadForPhotoEvidence,
  uploadEvidencePhoto,
  submitPhotoEvidence,
  listRecentPhotoEvidences,
} from '../services/photoEvidence';
import type {
  PhotoEvidenceItem,
  RootStackParams,
  SearchedLeadData,
} from '../types';

const ACTION_LABELS = [
  'Visita Terreno Realizada',
  'Visita Terreno Programada',
  'Feria',
  'CITA PROGRAMADA IA',
  'Llamada Programa',
  'Llamada Realiza',
  'No Contesta',
  'ORGANICO',
  'VENDIDO',
  'Video Llamada Programada',
  'Video Llamada Realizada',
  'Whatsapp Enviado',
  'INDECISO',
];

const CONTEXT_LABELS = ['Comercial', 'Seguimiento', 'Agenda', 'Sala de negocios', 'Postventa'];

const timeOptions = Array.from({ length: 29 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

function formatDateInput(ms: number) {
  const date = new Date(ms);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(ms: number | null) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function buildQuickDates(): { value: string; label: string }[] {
  const base = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const val = formatDateInput(d.getTime());
    const label =
      i === 0
        ? `Hoy (${val})`
        : i === 1
        ? `Mañana (${val})`
        : new Intl.DateTimeFormat('es-CO', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
          }).format(d);
    return { value: val, label };
  });
}

interface SelectedPhoto {
  uri: string;
  name?: string;
  mimeType?: string;
}

export function PhotoEvidenceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'PhotoEvidence'>>();
  const { companyId } = useAuth();
  const { palette } = useTheme();

  const [activeTab, setActiveTab] = useState<'register' | 'gallery'>('register');

  // Search state
  const [phoneNumber, setPhoneNumber] = useState(
    route.params?.phone || route.params?.lead?.phone || ''
  );
  const [searching, setSearching] = useState(false);
  const [leadData, setLeadData] = useState<SearchedLeadData | null>(null);
  const [canUpload, setCanUpload] = useState(true);
  const [permissionMessage, setPermissionMessage] = useState('');
  const [leadEvidences, setLeadEvidences] = useState<PhotoEvidenceItem[]>([]);

  // Form state
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [actionLabel, setActionLabel] = useState(ACTION_LABELS[0]);
  const [context, setContext] = useState(CONTEXT_LABELS[0]);
  const [isEvent, setIsEvent] = useState(false);
  const [eventDate, setEventDate] = useState(formatDateInput(Date.now()));
  const [eventTime, setEventTime] = useState('09:00');

  // Submission state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');

  // Gallery state
  const [galleryItems, setGalleryItems] = useState<PhotoEvidenceItem[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);

  // Lightbox & picker
  const [lightboxItem, setLightboxItem] = useState<PhotoEvidenceItem | null>(null);
  const [activePicker, setActivePicker] = useState<'action' | 'context' | 'date' | 'time' | null>(
    null
  );

  useEffect(() => {
    if (route.params?.lead) {
      const l = route.params.lead;
      setLeadData({
        id: l.id,
        name: l.name || 'Sin nombre',
        phone: l.phone,
        status: l.status,
        assignedTo: l.assignedTo ?? null,
        assignedAdvisorName: l.assignedAdvisorName || 'Asesor',
        smartHomeCustomerId: l.smartHomeCustomerId ?? null,
        smartHomeSyncError: null,
      });
      if (companyId) {
        listRecentPhotoEvidences(companyId, l.id, 20).then(setLeadEvidences).catch(() => {});
      }
    } else if (phoneNumber.trim() && companyId) {
      void doSearch(phoneNumber.trim());
    }
  }, [route.params?.lead, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'gallery' && companyId) {
      void loadGallery();
    }
  }, [activeTab, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadGallery = async () => {
    if (!companyId) return;
    setLoadingGallery(true);
    try {
      const items = await listRecentPhotoEvidences(companyId, undefined, 40);
      setGalleryItems(items);
    } catch (err) {
      console.warn('[PhotoEvidenceScreen] gallery load error:', err);
    } finally {
      setLoadingGallery(false);
    }
  };

  const doSearch = async (phoneToSearch: string) => {
    const clean = phoneToSearch.trim();
    if (!clean || !companyId || searching) return;

    setSearching(true);
    setPermissionMessage('');
    try {
      const res = await searchLeadForPhotoEvidence(companyId, clean);
      if (res.found && res.lead) {
        setLeadData(res.lead);
        setCanUpload(res.canUpload);
        setPermissionMessage(res.message);
        setLeadEvidences(res.evidences || []);
      } else {
        setLeadData(null);
        setCanUpload(false);
        setPermissionMessage(res.message || 'No se encontró ningún contacto con ese número.');
        setLeadEvidences([]);
      }
    } catch (err: any) {
      const msg =
        err?.message && !err.message.includes('NOT_FOUND')
          ? err.message
          : 'No se pudo encontrar el cliente con ese número.';
      Alert.alert('Búsqueda de cliente', msg);
      setLeadData(null);
    } finally {
      setSearching(false);
    }
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permiso requerido',
        'Meraki CRM necesita acceso a la cámara para tomar fotografías de evidencia.'
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      const asset = result.assets[0];
      setSelectedPhotos((prev) => [
        ...prev,
        {
          uri: asset.uri,
          name: asset.fileName || `cam_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        },
      ]);
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 5,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newItems = result.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName || `gal_${Date.now()}.jpg`,
          mimeType: a.mimeType || 'image/jpeg',
        }));
        setSelectedPhotos((prev) => [...prev, ...newItems]);
      }
    } catch (err) {
      console.warn('Gallery pick error:', err);
      Alert.alert('Error', 'No se pudo abrir el selector de fotos.');
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveEvidence = async () => {
    if (!companyId || !leadData) {
      Alert.alert('Atención', 'Primero debes seleccionar o buscar un cliente.');
      return;
    }
    if (selectedPhotos.length === 0) {
      Alert.alert(
        'Atención',
        'Debes tomar o seleccionar al menos una fotografía de evidencia.'
      );
      return;
    }
    if (!canUpload) {
      Alert.alert(
        'Sin autorización',
        permissionMessage || 'No tienes permisos para registrar bitácora en este cliente.'
      );
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    const total = selectedPhotos.length;

    try {
      for (let i = 0; i < total; i++) {
        const photo = selectedPhotos[i];
        setUploadStatusText(`Subiendo foto ${i + 1} de ${total}...`);
        const { downloadUrl, storagePath } = await uploadEvidencePhoto(
          companyId,
          leadData.id,
          { uri: photo.uri, fileName: photo.name, mimeType: photo.mimeType },
          (pct) => {
            const overall = Math.round(((i + pct / 100) / total) * 100);
            setUploadProgress(overall);
          }
        );

        setUploadStatusText(`Sincronizando con SmartHome (${i + 1}/${total})...`);
        await submitPhotoEvidence({
          companyId,
          leadId: leadData.id,
          photoUrl: downloadUrl,
          storagePath,
          notes: notes.trim(),
          actionLabel,
          context,
          isAnEvent: isEvent,
          scheduledDate: isEvent ? `${eventDate.replace(/-/g, '/')} ${eventTime}:00` : undefined,
        });
      }

      Alert.alert(
        '¡Éxito!',
        `${total} ${
          total === 1 ? 'evidencia registrada' : 'evidencias registradas'
        } y enviadas a la bitácora de SmartHome con éxito.`
      );
      setSelectedPhotos([]);
      setNotes('');
      setIsEvent(false);

      const refetch = await listRecentPhotoEvidences(companyId, leadData.id, 20);
      setLeadEvidences(refetch);
    } catch (err: any) {
      console.warn('[PhotoEvidenceScreen] submit error:', err);
      Alert.alert(
        'Error al guardar evidencia',
        err?.message || 'Ocurrió un error al guardar la evidencia fotográfica.'
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatusText('');
    }
  };

  const quickDates = buildQuickDates();

  return (
    <View style={[styles.safe, { backgroundColor: palette.bgCanvas }]}>
      <ScreenHeader
        title="Evidencia Fotográfica"
        subtitle="Registro de evidencias en bitácora SmartHome"
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
      />

      {/* Selector de pestañas */}
      <View
        style={[
          styles.tabsRow,
          { backgroundColor: palette.bgSurface, borderColor: palette.border },
        ]}
      >
        <Pressable
          onPress={() => setActiveTab('register')}
          style={[
            styles.tabButton,
            activeTab === 'register' && { backgroundColor: palette.brand },
          ]}
        >
          <Ionicons
            name="camera-outline"
            size={16}
            color={activeTab === 'register' ? '#ffffff' : palette.textMuted}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'register' ? '#ffffff' : palette.textMuted },
            ]}
          >
            Registrar
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('gallery')}
          style={[
            styles.tabButton,
            activeTab === 'gallery' && { backgroundColor: palette.brand },
          ]}
        >
          <Ionicons
            name="images-outline"
            size={16}
            color={activeTab === 'gallery' ? '#ffffff' : palette.textMuted}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'gallery' ? '#ffffff' : palette.textMuted },
            ]}
          >
            Galería
          </Text>
        </Pressable>
      </View>

      {activeTab === 'register' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Buscador por teléfono */}
          <View
            style={[
              styles.searchBox,
              { backgroundColor: palette.bgSurface, borderColor: palette.border },
            ]}
          >
            <Ionicons name="search" size={18} color={palette.textMuted} />
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="Número de teléfono (ej. 3001234567)"
              placeholderTextColor={palette.textPlaceholder}
              keyboardType="phone-pad"
              style={[styles.searchInput, { color: palette.textPrimary }]}
              onSubmitEditing={() => doSearch(phoneNumber)}
              returnKeyType="search"
            />
            {phoneNumber.length > 0 && (
              <Pressable onPress={() => setPhoneNumber('')} style={styles.iconBtn}>
                <Ionicons name="close-circle" size={18} color={palette.textSubtle} />
              </Pressable>
            )}
            <Pressable
              onPress={() => doSearch(phoneNumber)}
              disabled={searching || !phoneNumber.trim()}
              style={[
                styles.searchBtn,
                { backgroundColor: palette.brand },
                (!phoneNumber.trim() || searching) && styles.btnDisabled,
              ]}
            >
              {searching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.searchBtnText}>Buscar</Text>
              )}
            </Pressable>
          </View>

          {/* Tarjeta del cliente si fue encontrado */}
          {leadData ? (
            <View
              style={[
                styles.leadCard,
                { backgroundColor: palette.bgSurface, borderColor: palette.border },
              ]}
            >
              <View style={styles.leadHeader}>
                <View style={[styles.leadAvatar, { backgroundColor: palette.brandBg }]}>
                  <Ionicons name="person" size={18} color={palette.brandText} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.leadName, { color: palette.textPrimary }]}>
                    {leadData.name || 'Sin nombre'}
                  </Text>
                  <Text style={[styles.leadPhone, { color: palette.textMuted }]}>
                    {leadData.phone}
                  </Text>
                </View>
                <View style={[styles.leadBadge, { backgroundColor: palette.brandBg }]}>
                  <Text style={[styles.leadBadgeText, { color: palette.brandText }]}>
                    {leadData.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={[styles.advisorRow, { borderTopColor: palette.border }]}>
                <Ionicons name="briefcase-outline" size={14} color={palette.textMuted} />
                <Text style={[styles.advisorLabel, { color: palette.textMuted }]}>
                  Asesor asignado:{' '}
                  <Text style={[styles.advisorValue, { color: palette.textPrimary }]}>
                    {leadData.smartHomeAdvisor || leadData.assignedAdvisorName || 'Sin asignar'}
                  </Text>
                </Text>
              </View>

              {!canUpload && (
                <View
                  style={[
                    styles.permWarn,
                    { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={16} color={palette.amberText} />
                  <Text style={[styles.permWarnText, { color: palette.amberText }]}>
                    {permissionMessage ||
                      'Solo el asesor asignado o un administrador puede registrar bitácora.'}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Formulario de Fotos y Bitácora */}
          <View
            style={[
              styles.formSection,
              { backgroundColor: palette.bgSurface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>
              FOTOGRAFÍAS DE EVIDENCIA
            </Text>

            <View style={styles.mediaButtonsRow}>
              <Pressable
                onPress={pickFromCamera}
                disabled={uploading || Boolean(leadData && !canUpload)}
                style={[
                  styles.mediaActionBtn,
                  { backgroundColor: palette.brand },
                  (uploading || Boolean(leadData && !canUpload)) && styles.btnDisabled,
                ]}
              >
                <Ionicons name="camera" size={20} color="#fff" />
                <Text style={styles.mediaActionText}>Tomar foto</Text>
              </Pressable>

              <Pressable
                onPress={pickFromGallery}
                disabled={uploading || Boolean(leadData && !canUpload)}
                style={[
                  styles.mediaActionBtnSecondary,
                  {
                    backgroundColor: palette.brandBg,
                    borderColor: palette.brandBorder,
                  },
                  (uploading || Boolean(leadData && !canUpload)) && styles.btnDisabled,
                ]}
              >
                <Ionicons name="images" size={20} color={palette.brandText} />
                <Text style={[styles.mediaActionSecondaryText, { color: palette.brandText }]}>
                  Galería
                </Text>
              </Pressable>
            </View>

            {selectedPhotos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoList}>
                {selectedPhotos.map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={styles.photoThumbWrap}>
                    <Image
                      source={{ uri: photo.uri }}
                      style={[styles.photoThumb, { borderColor: palette.border }]}
                    />
                    <Pressable onPress={() => removePhoto(index)} style={styles.photoRemoveBtn}>
                      <Ionicons name="close" size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            <Text style={[styles.sectionTitle, { color: palette.textSubtle, marginTop: 12 }]}>
              DATOS DE BITÁCORA
            </Text>

            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              placeholder="Observación de la visita o gestión (se enviará a SmartHome)..."
              placeholderTextColor={palette.textPlaceholder}
              style={[
                styles.notesInput,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderStrong,
                  color: palette.textPrimary,
                },
              ]}
              editable={!uploading}
            />

            <View style={styles.selectorRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: palette.textMuted }]}>Etiqueta</Text>
                <Pressable
                  onPress={() => setActivePicker('action')}
                  disabled={uploading}
                  style={[
                    styles.pickerTrigger,
                    { backgroundColor: palette.bgInput, borderColor: palette.borderStrong },
                  ]}
                >
                  <Ionicons name="pricetag-outline" size={15} color={palette.brandText} />
                  <Text
                    style={[styles.pickerValue, { color: palette.textPrimary }]}
                    numberOfLines={1}
                  >
                    {actionLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={palette.textSubtle} />
                </Pressable>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: palette.textMuted }]}>Contexto</Text>
                <Pressable
                  onPress={() => setActivePicker('context')}
                  disabled={uploading}
                  style={[
                    styles.pickerTrigger,
                    { backgroundColor: palette.bgInput, borderColor: palette.borderStrong },
                  ]}
                >
                  <Ionicons name="folder-outline" size={15} color={palette.brandText} />
                  <Text
                    style={[styles.pickerValue, { color: palette.textPrimary }]}
                    numberOfLines={1}
                  >
                    {context}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={palette.textSubtle} />
                </Pressable>
              </View>
            </View>

            <View style={styles.switchRow}>
              <Switch
                value={isEvent}
                onValueChange={setIsEvent}
                trackColor={{ false: palette.borderStrong, true: palette.brand }}
                thumbColor="#ffffff"
              />
              <Text style={[styles.switchLabel, { color: palette.textMuted }]}>
                Registrar también como evento con fecha y hora
              </Text>
            </View>

            {isEvent && (
              <View
                style={[
                  styles.eventTimeRow,
                  { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
                ]}
              >
                <Pressable
                  onPress={() => setActivePicker('date')}
                  style={[
                    styles.timeTrigger,
                    { backgroundColor: palette.bgSurface, borderColor: palette.skyBorder },
                  ]}
                >
                  <Ionicons name="calendar-outline" size={15} color={palette.skyText} />
                  <Text style={[styles.timeValue, { color: palette.textPrimary }]}>
                    {eventDate}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActivePicker('time')}
                  style={[
                    styles.timeTrigger,
                    { backgroundColor: palette.bgSurface, borderColor: palette.skyBorder },
                  ]}
                >
                  <Ionicons name="time-outline" size={15} color={palette.skyText} />
                  <Text style={[styles.timeValue, { color: palette.textPrimary }]}>
                    {eventTime}
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable
              onPress={handleSaveEvidence}
              disabled={uploading || selectedPhotos.length === 0 || !leadData || !canUpload}
              style={[
                styles.submitBtn,
                { backgroundColor: palette.brand },
                (uploading || selectedPhotos.length === 0 || !leadData || !canUpload) &&
                  styles.btnDisabled,
              ]}
            >
              {uploading ? (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.submitBtnText}>
                    {uploadStatusText || `Subiendo... ${uploadProgress}%`}
                  </Text>
                </View>
              ) : (
                <View style={styles.uploadingRow}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Guardar evidencia en SmartHome</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Historial de evidencias previas del cliente */}
          {leadEvidences.length > 0 && (
            <View
              style={[
                styles.historySection,
                { backgroundColor: palette.bgSurface, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>
                HISTORIAL DE EVIDENCIAS ({leadEvidences.length})
              </Text>
              {leadEvidences.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setLightboxItem(item)}
                  style={[styles.historyCard, { borderBottomColor: palette.border }]}
                >
                  <Image
                    source={{ uri: item.photoUrl }}
                    style={[styles.historyThumb, { backgroundColor: palette.bgElevated }]}
                  />
                  <View style={styles.historyMeta}>
                    <View style={styles.historyRow}>
                      <Text style={[styles.historyAction, { color: palette.textPrimary }]}>
                        {item.actionLabel}
                      </Text>
                      {item.smartHomeSynced ? (
                        <View style={styles.syncedBadge}>
                          <Ionicons
                            name="checkmark-circle"
                            size={12}
                            color={palette.emeraldText}
                          />
                          <Text style={[styles.syncedText, { color: palette.emeraldText }]}>
                            SmartHome
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {item.notes ? (
                      <Text
                        style={[styles.historyNotes, { color: palette.textMuted }]}
                        numberOfLines={2}
                      >
                        {item.notes}
                      </Text>
                    ) : null}
                    <Text style={[styles.historyAuthor, { color: palette.textSubtle }]}>
                      {item.authorName} · {formatDisplayDate(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.galleryContent} keyboardShouldPersistTaps="handled">
          {loadingGallery ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={palette.brand} />
              <Text style={[styles.loadingText, { color: palette.textMuted }]}>
                Cargando evidencias recientes...
              </Text>
            </View>
          ) : galleryItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="images-outline" size={44} color={palette.textSubtle} />
              <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
                Sin evidencias registradas
              </Text>
              <Text style={[styles.emptySubtitle, { color: palette.textMuted }]}>
                Las fotografías registradas por los asesores aparecerán aquí.
              </Text>
            </View>
          ) : (
            <View style={styles.galleryGrid}>
              {galleryItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setLightboxItem(item)}
                  style={[
                    styles.galleryItem,
                    { backgroundColor: palette.bgSurface, borderColor: palette.border },
                  ]}
                >
                  <Image source={{ uri: item.photoUrl }} style={styles.galleryImage} />
                  <View style={styles.galleryItemOverlay}>
                    <Text style={styles.galleryItemName} numberOfLines={1}>
                      {item.leadName || 'Cliente'}
                    </Text>
                    <Text style={styles.galleryItemDate}>
                      {formatDisplayDate(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Lightbox Modal */}
      <Modal
        visible={!!lightboxItem}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxItem(null)}
      >
        <View style={styles.lightboxBackdrop}>
          <Pressable onPress={() => setLightboxItem(null)} style={styles.lightboxCloseBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>

          {lightboxItem && (
            <View style={styles.lightboxContent}>
              <Image
                source={{ uri: lightboxItem.photoUrl }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              <View style={[styles.lightboxDetails, { backgroundColor: palette.bgSurface }]}>
                <Text style={[styles.lightboxTitle, { color: palette.textPrimary }]}>
                  {lightboxItem.leadName || 'Cliente'}{' '}
                  {lightboxItem.leadPhone ? `(${lightboxItem.leadPhone})` : ''}
                </Text>
                <Text style={[styles.lightboxAction, { color: palette.brandText }]}>
                  {lightboxItem.actionLabel} · {lightboxItem.context}
                </Text>
                {lightboxItem.notes ? (
                  <Text style={[styles.lightboxNotes, { color: palette.textSecondary }]}>
                    {lightboxItem.notes}
                  </Text>
                ) : null}
                <Text style={[styles.lightboxAuthor, { color: palette.textSubtle }]}>
                  Registrado por {lightboxItem.authorName} ·{' '}
                  {formatDisplayDate(lightboxItem.createdAt)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Modal Picker para Etiqueta, Contexto, Fecha u Hora */}
      <Modal
        visible={!!activePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setActivePicker(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setActivePicker(null)} />
        <SafeAreaView
          edges={['bottom']}
          style={[
            styles.sheet,
            { backgroundColor: palette.bgSurface, borderTopColor: palette.border },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
              {activePicker === 'action'
                ? 'Seleccionar Etiqueta'
                : activePicker === 'context'
                ? 'Seleccionar Contexto'
                : activePicker === 'date'
                ? 'Fecha del evento'
                : 'Hora del evento'}
            </Text>
            <Pressable onPress={() => setActivePicker(null)} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={palette.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 320 }}>
            <View style={styles.optionsWrap}>
              {activePicker === 'date'
                ? quickDates.map((d) => {
                    const isSelected = d.value === eventDate;
                    return (
                      <Pressable
                        key={d.value}
                        onPress={() => {
                          setEventDate(d.value);
                          setActivePicker(null);
                        }}
                        style={[
                          styles.optionPill,
                          {
                            backgroundColor: isSelected ? palette.brandBg : palette.bgElevated,
                            borderColor: isSelected ? palette.brandBorder : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            {
                              color: isSelected ? palette.brandText : palette.textPrimary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {d.label}
                        </Text>
                      </Pressable>
                    );
                  })
                : (activePicker === 'action'
                    ? ACTION_LABELS
                    : activePicker === 'context'
                    ? CONTEXT_LABELS
                    : timeOptions
                  ).map((opt) => {
                    const isSelected =
                      activePicker === 'action'
                        ? opt === actionLabel
                        : activePicker === 'context'
                        ? opt === context
                        : opt === eventTime;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => {
                          if (activePicker === 'action') setActionLabel(opt);
                          else if (activePicker === 'context') setContext(opt);
                          else setEventTime(opt);
                          setActivePicker(null);
                        }}
                        style={[
                          styles.optionPill,
                          {
                            backgroundColor: isSelected ? palette.brandBg : palette.bgElevated,
                            borderColor: isSelected ? palette.brandBorder : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            {
                              color: isSelected ? palette.brandText : palette.textPrimary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    );
                  })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const { width } = Dimensions.get('window');
const gridItemSize = (width - 32 - 12) / 2;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  galleryContent: { padding: 16, paddingBottom: 40 },
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    height: '100%',
  },
  iconBtn: { padding: 4 },
  searchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  searchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  btnDisabled: { opacity: 0.5 },
  leadCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
    gap: 10,
  },
  leadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leadAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadName: {
    fontSize: 14,
    fontWeight: '700',
  },
  leadPhone: {
    fontSize: 12,
    marginTop: 1,
  },
  leadBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  leadBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  advisorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  advisorLabel: {
    fontSize: 11,
  },
  advisorValue: {
    fontWeight: '700',
  },
  permWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  permWarnText: {
    fontSize: 11,
    flex: 1,
  },
  formSection: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  mediaButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mediaActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  mediaActionBtnSecondary: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaActionSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  photoList: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  photoThumbWrap: {
    position: 'relative',
    marginRight: 10,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    minHeight: 74,
    textAlignVertical: 'top',
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  pickerTrigger: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  pickerValue: {
    flex: 1,
    fontSize: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  switchLabel: {
    fontSize: 12,
    flex: 1,
  },
  eventTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  timeTrigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
  },
  timeValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  submitBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historySection: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  historyCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  historyThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
  },
  historyMeta: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  syncedText: {
    fontSize: 10,
    fontWeight: '700',
  },
  historyNotes: {
    fontSize: 11,
  },
  historyAuthor: {
    fontSize: 10,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 240,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  galleryItem: {
    width: gridItemSize,
    height: gridItemSize,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  galleryItemOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    padding: 6,
  },
  galleryItemName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  galleryItemDate: {
    color: '#d4d4d8',
    fontSize: 9,
    marginTop: 1,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  lightboxContent: {
    width: '100%',
    maxHeight: '80%',
    alignItems: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '70%',
    borderRadius: 8,
  },
  lightboxDetails: {
    marginTop: 14,
    width: '100%',
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  lightboxTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  lightboxAction: {
    fontSize: 12,
    fontWeight: '600',
  },
  lightboxNotes: {
    fontSize: 12,
    marginTop: 4,
  },
  lightboxAuthor: {
    fontSize: 10,
    marginTop: 4,
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  optionText: {
    fontSize: 12,
  },
});
