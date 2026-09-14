import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import {
  getSmartHomeLeadBitacoraAccess,
  postSmartHomeLeadBitacora,
  postSmartHomeLeadEvidence,
  useLeadEvidence,
  type EvidenceAttachment,
} from '../services/smartHome';
import { uploadMedia, type LocalFile } from '../services/crm';
import type { Lead } from '../types';

const MAX_EVIDENCE_FILES = 10;

interface Props {
  companyId: string;
  lead: Lead;
}

const ACTION_LABELS = [
  'CITA PROGRAMADA IA', 'Feria', 'INDECISO', 'Llamada Programa', 'Llamada Realiza',
  'Llamada Recibia', 'No Contesta', 'ORGANICO', 'VENDIDO', 'Video Llamada Programada',
  'Video Llamada Realizada', 'Visita Terreno Programada', 'Visita Terreno Realizada', 'Whatsapp Enviado'
];

const CONTEXT_LABELS = ['Comercial', 'Seguimiento', 'Agenda', 'Sala de negocios', 'Postventa'];

const timeOptions = Array.from({ length: 29 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

function parseDateInput(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}
function formatDateLabel(value: string) {
  const date = parseDateInput(value);
  return date ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(date) : value;
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(monthMs: number, count: number) {
  const date = new Date(monthMs);
  return new Date(date.getFullYear(), date.getMonth() + count, 1).getTime();
}
function buildMonthGrid(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}
function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
function formatDateInput(ms: number) {
  const date = new Date(ms);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function smartHomeDate(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  return `${date.replace(/-/g, '/')} ${time}:00`;
}
function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: string })?.message;
  return message ? `${fallback} ${message}` : fallback;
}

function SelectField({ label, value, icon, onPress, disabled }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean; }) {
  return (
    <View style={styles.eventField}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable disabled={disabled} onPress={onPress} style={[styles.selectField, disabled && styles.buttonDisabled]}>
        <Ionicons name={icon} size={16} color={colors.text} style={styles.selectIcon} />
        <Text style={styles.selectText} numberOfLines={1}>{value}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.faint} />
      </Pressable>
    </View>
  );
}

function PickerSheet({
  picker, title, value, options, onSelect, onClose,
}: {
  picker: 'date' | 'time' | 'options' | null;
  title: string;
  value: string;
  options?: string[];
  onSelect: (val: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(startOfMonth(parseDateInput(value) ?? new Date()).getTime());

  useEffect(() => {
    if (picker === 'date') setMonth(startOfMonth(parseDateInput(value) ?? new Date()).getTime());
  }, [value, picker]);

  if (!picker) return null;

  const monthDate = new Date(month);
  const monthDays = buildMonthGrid(monthDate);
  const listOptions = picker === 'time' ? timeOptions : options || [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        {picker === 'date' ? (
          <>
            <View style={styles.sheetMonthRow}>
              <Pressable onPress={() => setMonth(addMonths(month, -1))} style={styles.sheetNav}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable>
              <Text style={styles.sheetMonth}>{capitalize(new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(monthDate))}</Text>
              <Pressable onPress={() => setMonth(addMonths(month, 1))} style={styles.sheetNav}><Ionicons name="chevron-forward" size={20} color={colors.text} /></Pressable>
            </View>
            <View style={styles.sheetCalendar}>
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.sheetWeekday}>{day}</Text>)}
              {monthDays.map((day) => {
                const dayVal = formatDateInput(day.getTime());
                const selected = dayVal === value;
                const inMonth = day.getMonth() === monthDate.getMonth();
                return (
                  <Pressable key={day.toISOString()} onPress={() => { onSelect(dayVal); onClose(); }} style={[styles.sheetDay, selected && styles.sheetDayActive]}>
                    <Text style={[styles.sheetDayText, !inMonth && styles.sheetDayMuted, selected && styles.sheetDayTextActive]}>{day.getDate()}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <ScrollView style={{ maxHeight: 300 }}>
            <View style={styles.optionGrid}>
              {listOptions.map((opt) => {
                const selected = opt === value;
                return (
                  <Pressable key={opt} onPress={() => { onSelect(opt); onClose(); }} style={[styles.optionPill, selected && styles.optionPillActive]}>
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export function SmartHomeBitacoraPanel({ companyId, lead }: Props) {
  const [text, setText] = useState('');
  const [isEvent, setIsEvent] = useState(false);
  const [date, setDate] = useState(formatDateInput(Date.now()));
  const [startTime, setStartTime] = useState('07:00');
  const [actionLabel, setActionLabel] = useState(ACTION_LABELS[0]);
  const [context, setContext] = useState(CONTEXT_LABELS[0]);
  
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [bitacoraAccess, setBitacoraAccess] = useState<{ allowed: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  
  const [activePicker, setActivePicker] = useState<'date' | 'time' | 'actionLabel' | 'context' | null>(null);

  // ── Evidencia fotográfica ──────────────────────────────────────────────────
  const [evidenceFiles, setEvidenceFiles] = useState<LocalFile[]>([]);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const savedEvidence = useLeadEvidence(companyId, lead.id);

  useEffect(() => {
    setCheckingAccess(true);
    setBitacoraAccess(null);
    getSmartHomeLeadBitacoraAccess(companyId, lead.id)
      .then(setBitacoraAccess)
      .catch((err) => {
        console.warn('[SmartHomeBitacoraPanel] access error:', err);
        setBitacoraAccess({
          allowed: false,
          message: errorMessage(err, 'No se pudo validar el permiso para registrar bitácora.'),
        });
      })
      .finally(() => setCheckingAccess(false));
  }, [companyId, lead.id]);

  const canPostBitacora = bitacoraAccess?.allowed === true;
  const bitacoraBlockMessage = bitacoraAccess?.message || 'Este cliente no está asignado a ti. Solicita al administrador el cambio de asesor para registrar bitácora.';

  const publish = async () => {
    if (!text.trim() || saving || !canPostBitacora) return;
    setSaving(true);
    try {
      await postSmartHomeLeadBitacora({
        companyId,
        leadId: lead.id,
        actionLabel,
        context,
        eventContent: text.trim(),
        isAnEvent: isEvent,
        scheduledDate: isEvent ? smartHomeDate(date, startTime) : undefined,
      });
      setText('');
      setIsEvent(false);
      Alert.alert('Éxito', 'Bitácora enviada a SmartHome.');
    } catch (err) {
      console.warn('[SmartHomeBitacoraPanel] bitacora error:', err);
      Alert.alert('Error', errorMessage(err, 'No se pudo publicar en la bitácora de SmartHome.'));
    } finally {
      setSaving(false);
    }
  };

  const assetToLocalFile = (asset: ImagePicker.ImagePickerAsset): LocalFile => ({
    uri: asset.uri,
    name: asset.fileName ?? `evidencia_${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize,
  });

  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const images = assets.filter((a) => (a.type ?? 'image') === 'image');
    if (!images.length) return;
    setEvidenceFiles((prev) => [...prev, ...images.map(assetToLocalFile)].slice(0, MAX_EVIDENCE_FILES));
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permiso requerido', 'Permite el acceso a la cámara para tomar evidencia.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 });
    if (!result.canceled) addAssets(result.assets);
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permiso requerido', 'Permite el acceso a tus fotos para adjuntar evidencia.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsMultipleSelection: true, selectionLimit: MAX_EVIDENCE_FILES });
    if (!result.canceled) addAssets(result.assets);
  };

  const removeEvidenceFile = (index: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadEvidence = async () => {
    if (!evidenceFiles.length || uploadingEvidence || !canPostBitacora) return;
    setUploadingEvidence(true);
    try {
      const attachments: EvidenceAttachment[] = [];
      for (const file of evidenceFiles) {
        const res = await uploadMedia(companyId, lead.id, file);
        attachments.push({
          downloadUrl: res.downloadUrl,
          storagePath: res.storagePath,
          contentType: res.contentType,
          fileName: res.fileName,
        });
      }
      const result = await postSmartHomeLeadEvidence({
        companyId,
        leadId: lead.id,
        note: evidenceNote.trim() || undefined,
        attachments,
      });
      setEvidenceFiles([]);
      setEvidenceNote('');
      Alert.alert(
        'Evidencia guardada',
        result.sentToSmartHome
          ? 'Evidencia guardada en el CRM y enviada a SmartHome.'
          : 'Evidencia guardada en el CRM. No se pudo enviar a SmartHome.'
      );
    } catch (err) {
      console.warn('[SmartHomeBitacoraPanel] evidence error:', err);
      Alert.alert('Error', errorMessage(err, 'No se pudo subir la evidencia.'));
    } finally {
      setUploadingEvidence(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Evidencia fotográfica</Text>

      <View style={styles.evidenceButtons}>
        <Pressable
          disabled={!canPostBitacora || uploadingEvidence}
          onPress={takePhoto}
          style={[styles.evidenceButton, (!canPostBitacora || uploadingEvidence) && styles.buttonDisabled]}
        >
          <Ionicons name="camera-outline" size={16} color={colors.text} />
          <Text style={styles.evidenceButtonText}>Tomar foto</Text>
        </Pressable>
        <Pressable
          disabled={!canPostBitacora || uploadingEvidence}
          onPress={pickPhoto}
          style={[styles.evidenceButton, (!canPostBitacora || uploadingEvidence) && styles.buttonDisabled]}
        >
          <Ionicons name="image-outline" size={16} color={colors.text} />
          <Text style={styles.evidenceButtonText}>Adjuntar foto</Text>
        </Pressable>
      </View>

      {evidenceFiles.length > 0 ? (
        <>
          <View style={styles.thumbRow}>
            {evidenceFiles.map((file, index) => (
              <View key={`${file.uri}-${index}`} style={styles.thumbWrap}>
                <Image source={{ uri: file.uri }} style={styles.thumb} />
                <Pressable disabled={uploadingEvidence} onPress={() => removeEvidenceFile(index)} style={styles.thumbRemove}>
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
          <TextInput
            value={evidenceNote}
            onChangeText={setEvidenceNote}
            multiline
            placeholder="Descripción de la evidencia (opcional)..."
            placeholderTextColor={colors.faint}
            editable={!uploadingEvidence}
            style={styles.evidenceInput}
          />
          <Pressable
            disabled={uploadingEvidence || !canPostBitacora}
            onPress={uploadEvidence}
            style={[styles.evidenceUpload, (uploadingEvidence || !canPostBitacora) && styles.buttonDisabled]}
          >
            {uploadingEvidence ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={16} color="#fff" />}
            <Text style={styles.buttonText}>{uploadingEvidence ? 'Subiendo...' : `Guardar y enviar (${evidenceFiles.length})`}</Text>
          </Pressable>
        </>
      ) : null}

      {savedEvidence.length > 0 ? (
        <View style={styles.savedBlock}>
          <Text style={styles.savedLabel}>Evidencia guardada ({savedEvidence.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedRow}>
            {savedEvidence.map((item) => (
              <Image key={item.id} source={{ uri: item.downloadUrl }} style={styles.savedThumb} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Text style={[styles.title, styles.bitacoraTitle]}>Llenar bitácora del cliente</Text>
      
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        placeholder="Escribe la observación para SmartHome..."
        placeholderTextColor={colors.faint}
        editable={canPostBitacora && !saving}
        style={styles.input}
      />
      
      {checkingAccess ? (
        <View style={styles.infoBox}>
          <ActivityIndicator size="small" color={colors.sky} />
          <Text style={styles.infoText}>Validando permisos de SmartHome...</Text>
        </View>
      ) : !canPostBitacora ? (
        <View style={styles.warnBox}>
          <Ionicons name="warning" size={16} color={colors.amber} />
          <Text style={styles.warnText}>{bitacoraBlockMessage}</Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <Switch
          value={isEvent}
          onValueChange={setIsEvent}
          disabled={!canPostBitacora || saving}
          trackColor={{ false: colors.border, true: colors.sky }}
          thumbColor={colors.background}
        />
        <Text style={styles.switchLabel}>Crear evento</Text>
      </View>

      {isEvent ? (
        <View style={styles.eventGrid}>
          <SelectField label="Fecha" value={formatDateLabel(date)} icon="calendar-outline" disabled={!canPostBitacora || saving} onPress={() => setActivePicker('date')} />
          <SelectField label="Hora inicio" value={startTime} icon="time-outline" disabled={!canPostBitacora || saving} onPress={() => setActivePicker('time')} />
        </View>
      ) : null}

      <View style={styles.selectGrid}>
        <SelectField label="Etiqueta" value={actionLabel} icon="pricetag-outline" disabled={!canPostBitacora || saving} onPress={() => setActivePicker('actionLabel')} />
        <SelectField label="Contexto" value={context} icon="briefcase-outline" disabled={!canPostBitacora || saving} onPress={() => setActivePicker('context')} />
      </View>

      <Pressable
        disabled={!text.trim() || saving || !canPostBitacora}
        onPress={publish}
        style={[styles.button, (!text.trim() || saving || !canPostBitacora) && styles.buttonDisabled]}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name={isEvent ? 'calendar' : 'send'} size={16} color="#fff" />
        )}
        <Text style={styles.buttonText}>{isEvent ? 'Publicar evento' : 'Publicar bitácora'}</Text>
      </Pressable>

      <PickerSheet
        picker={activePicker === 'date' || activePicker === 'time' ? activePicker : activePicker ? 'options' : null}
        title={
          activePicker === 'date' ? 'Fecha del evento' :
          activePicker === 'time' ? 'Hora del evento' :
          activePicker === 'actionLabel' ? 'Selecciona la etiqueta' :
          'Selecciona el contexto'
        }
        value={
          activePicker === 'date' ? date :
          activePicker === 'time' ? startTime :
          activePicker === 'actionLabel' ? actionLabel :
          context
        }
        options={activePicker === 'actionLabel' ? ACTION_LABELS : CONTEXT_LABELS}
        onSelect={(val) => {
          if (activePicker === 'date') setDate(val);
          else if (activePicker === 'time') setStartTime(val);
          else if (activePicker === 'actionLabel') setActionLabel(val);
          else if (activePicker === 'context') setContext(val);
        }}
        onClose={() => setActivePicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  title: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 4 },
  bitacoraTitle: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  evidenceButtons: { flexDirection: 'row', gap: 10 },
  evidenceButton: {
    flex: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  evidenceButtonText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#000000B0', alignItems: 'center', justifyContent: 'center',
  },
  evidenceInput: {
    minHeight: 56, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.raised, color: colors.text, fontSize: 13, padding: 12, textAlignVertical: 'top',
  },
  evidenceUpload: {
    height: 44, borderRadius: 8, backgroundColor: colors.emerald, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  savedBlock: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  savedLabel: { color: colors.faint, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  savedRow: { gap: 8 },
  savedThumb: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  input: {
    minHeight: 76, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.raised, color: colors.text, fontSize: 13,
    padding: 12, textAlignVertical: 'top',
  },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(14, 165, 233, 0.2)', backgroundColor: 'rgba(14, 165, 233, 0.1)', padding: 10,
  },
  infoText: { color: colors.sky, fontSize: 11 },
  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: 10,
  },
  warnText: { color: colors.amber, fontSize: 11, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { color: colors.muted, fontSize: 11 },
  eventGrid: {
    flexDirection: 'row', gap: 10, borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)', backgroundColor: 'rgba(16, 185, 129, 0.04)', padding: 10,
  },
  selectGrid: { flexDirection: 'row', gap: 10 },
  eventField: { flex: 1, gap: 4 },
  label: { color: colors.muted, fontSize: 10 },
  selectField: {
    height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8,
  },
  selectIcon: { opacity: 0.5 },
  selectText: { flex: 1, color: colors.text, fontSize: 13 },
  button: {
    height: 44, borderRadius: 8, backgroundColor: colors.sky, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '900' },

  // Sheet styles (copied from ChatScreen for local independence)
  sheetOverlay: { flex: 1, backgroundColor: '#00000088' },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  sheetMonthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetNav: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  sheetMonth: { color: colors.text, fontSize: 14, fontWeight: '900', textTransform: 'capitalize' },
  sheetCalendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sheetWeekday: { width: `${100 / 7 - 1}%`, color: colors.muted, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  sheetDay: { width: `${100 / 7 - 1}%`, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  sheetDayActive: { backgroundColor: colors.brand },
  sheetDayText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  sheetDayMuted: { color: colors.faint },
  sheetDayTextActive: { color: colors.background },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  optionPillActive: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  optionText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  optionTextActive: { color: colors.brand, fontWeight: '900' },
});
