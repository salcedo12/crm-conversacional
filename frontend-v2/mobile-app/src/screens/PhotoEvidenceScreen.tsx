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
import { colors } from '../theme/colors';
import {
  searchLeadForPhotoEvidence,
  uploadEvidencePhoto,
  submitPhotoEvidence,
  listRecentPhotoEvidences,
} from '../services/photoEvidence';
import type {
  Lead,
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

interface SelectedPhoto {
  uri: string;
  name?: string;
  mimeType?: string;
}

export function PhotoEvidenceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'PhotoEvidence'>>();
  const { companyId, profile } = useAuth();

  const [activeTab, setActiveTab] = useState<'register' | 'gallery'>('register');

  // Search state
  const [phoneNumber, setPhoneNumber] = useState(route.params?.phone || route.params?.lead?.phone || '');
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

  // Lightbox
  const [lightboxItem, setLightboxItem] = useState<PhotoEvidenceItem | null>(null);

  // Active picker sheet
  const [activePicker, setActivePicker] = useState<'action' | 'context' | 'time' | null>(null);

  // Initial load if lead was passed
  useEffect(() => {
    if (route.params?.lead) {
      const l = route.params.lead;
      setLeadData({
        id: l.id,
        name: l.name || 'Sin nombre',
        phone: l.phone,
        status: l.status,
        assignedTo: l.assignedTo ?? null,
        assignedAdvisorName: 'Asesor',
        smartHomeCustomerId: null,
        smartHomeSyncError: null,
      });
      if (companyId) {
        // Fetch existing evidences for this lead
        listRecentPhotoEvidences(companyId, l.id, 20).then(setLeadEvidences).catch(() => {});
      }
    } else if (phoneNumber.trim() && companyId) {
      doSearch(phoneNumber.trim());
    }
  }, [route.params?.lead, companyId]);

  // Load gallery when switching to gallery tab
  useEffect(() => {
    if (activeTab === 'gallery' && companyId) {
      loadGallery();
    }
  }, [activeTab, companyId]);

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
      const msg = err?.message && !err.message.includes('NOT_FOUND') ? err.message : 'No se pudo encontrar el cliente con ese número.';
      Alert.alert('Búsqueda de cliente', msg);
      setLeadData(null);
    } finally {
      setSearching(false);
    }
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Meraki CRM necesita acceso a la cámara para tomar fotografías de evidencia.');
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
    } catch (err: any) {
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
      Alert.alert('Atención', 'Debes tomar o seleccionar al menos una fotografía de evidencia.');
      return;
    }
    if (!canUpload) {
      Alert.alert('Sin autorización', permissionMessage || 'No tienes permisos para registrar bitácora en este cliente.');
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
          photo,
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

      Alert.alert('¡Éxito!', `${total} ${total === 1 ? 'evidencia registrada' : 'evidencias registradas'} y enviadas a la bitácora de SmartHome con éxito.`);
      setSelectedPhotos([]);
      setNotes('');
      setIsEvent(false);

      // Refresh lead evidences
      const refetch = await listRecentPhotoEvidences(companyId, leadData.id, 20);
      setLeadEvidences(refetch);
    } catch (err: any) {
      console.warn('[PhotoEvidenceScreen] submit error:', err);
      Alert.alert('Error al guardar evidencia', err?.message || 'Ocurrió un error al guardar la evidencia fotográfica.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatusText('');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title="Evidencia Fotográfica"
        subtitle="Registro de evidencias en bitácora"
      />

      {/* Selector de pestañas */}
      <View style={styles.tabsRow}>
        <Pressable
          onPress={() => setActiveTab('register')}
          style={[styles.tabButton, activeTab === 'register' && styles.tabButtonActive]}
        >
          <Ionicons
            name="camera-outline"
            size={16}
            color={activeTab === 'register' ? '#fff' : colors.muted}
          />
          <Text style={[styles.tabText, activeTab === 'register' && styles.tabTextActive]}>
            Registrar
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('gallery')}
          style={[styles.tabButton, activeTab === 'gallery' && styles.tabButtonActive]}
        >
          <Ionicons
            name="images-outline"
            size={16}
            color={activeTab === 'gallery' ? '#fff' : colors.muted}
          />
          <Text style={[styles.tabText, activeTab === 'gallery' && styles.tabTextActive]}>
            Galería
          </Text>
        </Pressable>
      </View>

      {activeTab === 'register' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Buscador por teléfono */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="Número de teléfono (ej. 3001234567)"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              style={styles.searchInput}
              onSubmitEditing={() => doSearch(phoneNumber)}
              returnKeyType="search"
            />
            {phoneNumber.length > 0 && (
              <Pressable onPress={() => setPhoneNumber('')} style={styles.iconBtn}>
                <Ionicons name="close-circle" size={18} color={colors.faint} />
              </Pressable>
            )}
            <Pressable
              onPress={() => doSearch(phoneNumber)}
              disabled={searching || !phoneNumber.trim()}
              style={[styles.searchBtn, (!phoneNumber.trim() || searching) && styles.btnDisabled]}
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
            <View style={styles.leadCard}>
              <View style={styles.leadHeader}>
                <View style={styles.leadAvatar}>
                  <Ionicons name="person" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leadName}>{leadData.name || 'Sin nombre'}</Text>
                  <Text style={styles.leadPhone}>{leadData.phone}</Text>
                </View>
                <View style={styles.leadBadge}>
                  <Text style={styles.leadBadgeText}>{leadData.status.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.advisorRow}>
                <Ionicons name="briefcase-outline" size={14} color={colors.muted} />
                <Text style={styles.advisorLabel}>
                  Asesor asignado:{' '}
                  <Text style={styles.advisorValue}>
                    {leadData.smartHomeAdvisor || leadData.assignedAdvisorName || 'Sin asignar'}
                  </Text>
                </Text>
              </View>

              {!canUpload && (
                <View style={styles.permWarn}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.amber} />
                  <Text style={styles.permWarnText}>
                    {permissionMessage || 'Solo el asesor asignado o un administrador puede registrar bitácora.'}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Formulario de Fotos y Bitácora */}
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>FOTOGRAFÍAS DE EVIDENCIA</Text>

            <View style={styles.mediaButtonsRow}>
              <Pressable
                onPress={pickFromCamera}
                disabled={uploading || (leadData && !canUpload)}
                style={[styles.mediaActionBtn, (uploading || (leadData && !canUpload)) && styles.btnDisabled]}
              >
                <Ionicons name="camera" size={20} color="#fff" />
                <Text style={styles.mediaActionText}>Tomar foto</Text>
              </Pressable>

              <Pressable
                onPress={pickFromGallery}
                disabled={uploading || (leadData && !canUpload)}
                style={[styles.mediaActionBtnSecondary, (uploading || (leadData && !canUpload)) && styles.btnDisabled]}
              >
                <Ionicons name="images" size={20} color={colors.brand} />
                <Text style={styles.mediaActionSecondaryText}>Galería</Text>
              </Pressable>
            </View>

            {/* Cuadrícula de fotos seleccionadas */}
            {selectedPhotos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoList}>
                {selectedPhotos.map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={styles.photoThumbWrap}>
                    <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                    <Pressable
                      onPress={() => removePhoto(index)}
                      style={styles.photoRemoveBtn}
                    >
                      <Ionicons name="close" size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>DATOS DE BITÁCORA</Text>

            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              placeholder="Observación de la visita o gestión (se enviará a SmartHome)..."
              placeholderTextColor={colors.faint}
              style={styles.notesInput}
              editable={!uploading}
            />

            {/* Selectores de Etiqueta y Contexto */}
            <View style={styles.selectorRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Etiqueta</Text>
                <Pressable
                  onPress={() => setActivePicker('action')}
                  disabled={uploading}
                  style={styles.pickerTrigger}
                >
                  <Ionicons name="pricetag-outline" size={15} color={colors.brand} />
                  <Text style={styles.pickerValue} numberOfLines={1}>
                    {actionLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={colors.faint} />
                </Pressable>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Contexto</Text>
                <Pressable
                  onPress={() => setActivePicker('context')}
                  disabled={uploading}
                  style={styles.pickerTrigger}
                >
                  <Ionicons name="folder-outline" size={15} color={colors.brand} />
                  <Text style={styles.pickerValue} numberOfLines={1}>
                    {context}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={colors.faint} />
                </Pressable>
              </View>
            </View>

            {/* Switch de evento */}
            <View style={styles.switchRow}>
              <Switch
                value={isEvent}
                onValueChange={setIsEvent}
                trackColor={{ false: colors.border, true: colors.sky }}
                thumbColor="#fff"
              />
              <Text style={styles.switchLabel}>Registrar también como evento con fecha y hora</Text>
            </View>

            {isEvent && (
              <View style={styles.eventTimeRow}>
                <Text style={styles.eventTimeLabel}>Hora del evento:</Text>
                <Pressable
                  onPress={() => setActivePicker('time')}
                  style={styles.timeTrigger}
                >
                  <Ionicons name="time-outline" size={15} color={colors.sky} />
                  <Text style={styles.timeValue}>{eventTime}</Text>
                </Pressable>
              </View>
            )}

            {/* Botón de Enviar */}
            <Pressable
              onPress={handleSaveEvidence}
              disabled={uploading || selectedPhotos.length === 0 || !leadData || !canUpload}
              style={[
                styles.submitBtn,
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
                  <Text style={styles.submitBtnText}>
                    Guardar evidencia en SmartHome
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Historial de evidencias previas del cliente */}
          {leadEvidences.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>
                HISTORIAL DE EVIDENCIAS ({leadEvidences.length})
              </Text>
              {leadEvidences.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setLightboxItem(item)}
                  style={styles.historyCard}
                >
                  <Image source={{ uri: item.photoUrl }} style={styles.historyThumb} />
                  <View style={styles.historyMeta}>
                    <View style={styles.historyRow}>
                      <Text style={styles.historyAction}>{item.actionLabel}</Text>
                      {item.smartHomeSynced ? (
                        <View style={styles.syncedBadge}>
                          <Ionicons name="checkmark-circle" size={12} color={colors.emerald} />
                          <Text style={styles.syncedText}>SmartHome</Text>
                        </View>
                      ) : null}
                    </View>
                    {item.notes ? (
                      <Text style={styles.historyNotes} numberOfLines={2}>
                        {item.notes}
                      </Text>
                    ) : null}
                    <Text style={styles.historyAuthor}>
                      {item.authorName} · {formatDisplayDate(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        /* Pestaña de Galería general */
        <ScrollView
          contentContainerStyle={styles.galleryContent}
          keyboardShouldPersistTaps="handled"
        >
          {loadingGallery ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={styles.loadingText}>Cargando evidencias recientes...</Text>
            </View>
          ) : galleryItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="images-outline" size={44} color={colors.faint} />
              <Text style={styles.emptyTitle}>Sin evidencias registradas</Text>
              <Text style={styles.emptySubtitle}>
                Las fotografías registradas por los asesores aparecerán aquí.
              </Text>
            </View>
          ) : (
            <View style={styles.galleryGrid}>
              {galleryItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setLightboxItem(item)}
                  style={styles.galleryItem}
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

      {/* Lightbox Modal para ver foto completa */}
      <Modal
        visible={!!lightboxItem}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxItem(null)}
      >
        <View style={styles.lightboxBackdrop}>
          <Pressable
            onPress={() => setLightboxItem(null)}
            style={styles.lightboxCloseBtn}
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>

          {lightboxItem && (
            <View style={styles.lightboxContent}>
              <Image
                source={{ uri: lightboxItem.photoUrl }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              <View style={styles.lightboxDetails}>
                <Text style={styles.lightboxTitle}>
                  {lightboxItem.leadName || 'Cliente'} ({lightboxItem.leadPhone || ''})
                </Text>
                <Text style={styles.lightboxAction}>
                  {lightboxItem.actionLabel} · {lightboxItem.context}
                </Text>
                {lightboxItem.notes ? (
                  <Text style={styles.lightboxNotes}>{lightboxItem.notes}</Text>
                ) : null}
                <Text style={styles.lightboxAuthor}>
                  Registrado por {lightboxItem.authorName} ·{' '}
                  {formatDisplayDate(lightboxItem.createdAt)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Modal Picker para Etiqueta, Contexto u Hora */}
      <Modal
        visible={!!activePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setActivePicker(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setActivePicker(null)} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {activePicker === 'action'
                ? 'Seleccionar Etiqueta'
                : activePicker === 'context'
                ? 'Seleccionar Contexto'
                : 'Hora del evento'}
            </Text>
            <Pressable onPress={() => setActivePicker(null)} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 320 }}>
            <View style={styles.optionsWrap}>
              {(activePicker === 'action'
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
                    style={[styles.optionPill, isSelected && styles.optionPillActive]}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get('window');
const gridItemSize = (width - 32 - 12) / 2;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  galleryContent: { padding: 16, paddingBottom: 40 },

  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
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
  tabButtonActive: {
    backgroundColor: colors.brand,
  },
  tabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#fff',
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    height: '100%',
  },
  iconBtn: { padding: 4 },
  searchBtn: {
    backgroundColor: colors.sky,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  searchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  btnDisabled: { opacity: 0.5 },

  leadCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.brandDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  leadPhone: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  leadBadge: {
    backgroundColor: colors.raised,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  leadBadgeText: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: '800',
  },
  advisorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  advisorLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  advisorValue: {
    color: colors.text,
    fontWeight: '700',
  },
  permWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 6,
    padding: 10,
  },
  permWarnText: {
    color: colors.amber,
    fontSize: 11,
    flex: 1,
  },

  formSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  sectionTitle: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  mediaButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mediaActionBtn: {
    flex: 1,
    height: 44,
    backgroundColor: colors.brand,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  mediaActionBtnSecondary: {
    flex: 1,
    height: 44,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaActionSecondaryText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '800',
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
    borderColor: colors.border,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.red,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },

  notesInput: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
  },

  selectorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  pickerTrigger: {
    height: 40,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  pickerValue: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  switchLabel: {
    color: colors.muted,
    fontSize: 12,
    flex: 1,
  },
  eventTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(14, 165, 233, 0.2)',
  },
  eventTimeLabel: {
    color: colors.sky,
    fontSize: 12,
    fontWeight: '700',
  },
  timeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.sky,
  },
  timeValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },

  submitBtn: {
    height: 48,
    backgroundColor: colors.brand,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  historySection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  historyCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: colors.raised,
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
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  syncedText: {
    color: colors.emerald,
    fontSize: 10,
    fontWeight: '700',
  },
  historyNotes: {
    color: colors.muted,
    fontSize: 11,
  },
  historyAuthor: {
    color: colors.faint,
    fontSize: 10,
  },

  // Gallery
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  emptySubtitle: {
    color: colors.muted,
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
    backgroundColor: colors.surface,
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 6,
  },
  galleryItemName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  galleryItemDate: {
    color: colors.muted,
    fontSize: 9,
    marginTop: 1,
  },

  // Lightbox
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
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 8,
    gap: 4,
  },
  lightboxTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  lightboxAction: {
    color: colors.sky,
    fontSize: 12,
    fontWeight: '700',
  },
  lightboxNotes: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  lightboxAuthor: {
    color: colors.faint,
    fontSize: 10,
    marginTop: 4,
  },

  // Sheet
  sheetOverlay: { flex: 1, backgroundColor: '#00000088' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionPillActive: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brand,
  },
  optionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  optionTextActive: {
    color: colors.brand,
    fontWeight: '800',
  },
});
