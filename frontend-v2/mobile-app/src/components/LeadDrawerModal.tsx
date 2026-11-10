import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { useAudioPlayer } from 'expo-audio';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useLeadCalls, useLeadDoc, useLeadNotes } from '../hooks/useLeadDetails';
import {
  addLeadNote,
  analyzeLead,
  bookAppointmentManual,
  deleteLeadNote,
  listContactFields,
  listLeadAppointments,
  setLeadAi,
  setReminderDone,
  startAiCall,
  updateLead,
} from '../services/crm';
import {
  cancelAppointment,
  reassignLead,
  recordLeadAudit,
  requestWhatsappCallPermission,
  setLeadAssignmentLock,
  subscribeLeadSources,
  type Advisor,
  type LeadSourceItem,
} from '../services/enterprise';
import type { Appointment, ContactField, Lead } from '../types';
import { formatPhone } from '../utils/formatPhone';
import { Badge, LeadScoreBadge, LeadStatusBadge } from './Badge';
import { Button } from './Button';
import { FichaTecnicaModal } from './FichaTecnicaModal';
import { Icon } from './Icon';
import { MERAKI_PROJECT_OPTIONS } from './NewLeadModal';
import { SelectModal } from './SelectModal';

interface LeadDrawerModalProps {
  visible: boolean;
  lead: Lead | null;
  companyId: string;
  advisors?: Advisor[];
  allTags?: string[];
  onClose: () => void;
  onOpenChat?: (lead: Lead) => void;
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'closed', label: 'Vendido' },
];

function toMillisSafe(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    return (ts._seconds ?? ts.seconds) * 1000;
  }
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const d = new Date(ts).getTime();
    return isNaN(d) ? 0 : d;
  }
  return 0;
}

function formatShortDate(ts: any): string {
  const ms = toMillisSafe(ts);
  if (!ms) return 'Sin actividad';
  return new Date(ms).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CallAudioButton({ url }: { url: string }) {
  const { palette } = useTheme();
  const player = useAudioPlayer(url);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  return (
    <Pressable
      onPress={toggle}
      style={[styles.miniBtn, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}
    >
      <Icon name={playing ? 'Pause' : 'Play'} size={12} color={palette.brandText} />
      <Text style={{ fontSize: 11, fontWeight: '700', color: palette.brandText }}>
        {playing ? 'Pausar audio' : 'Escuchar grabación'}
      </Text>
    </Pressable>
  );
}

export function LeadDrawerModal({
  visible,
  lead: initialLead,
  companyId,
  advisors = [],
  allTags = [],
  onClose,
  onOpenChat,
}: LeadDrawerModalProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { user, profile, isAdmin } = useAuth();

  const liveLead = useLeadDoc(
    visible && initialLead ? companyId : null,
    initialLead?.id || 'none',
    initialLead || ({ id: '', companyId, phone: '', status: 'new', source: 'manual', aiEnabled: true } as any)
  );
  const lead = initialLead ? liveLead : null;

  const notes = useLeadNotes(visible && lead ? companyId : null, lead?.id || '');
  const calls = useLeadCalls(visible && lead ? companyId : null, lead?.id || '');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [status, setStatus] = useState<Lead['status']>('new');
  const [projectInterest, setProjectInterest] = useState('');
  const [fuenteUbicacion, setFuenteUbicacion] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [assignedTo, setAssignedTo] = useState('');
  const [locked, setLocked] = useState(false);

  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [customFields, setCustomFields] = useState<ContactField[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppts, setLoadingAppts] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingAi, setTogglingAi] = useState(false);
  const [callingAi, setCallingAi] = useState(false);
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  const [showFichaModal, setShowFichaModal] = useState(false);
  const [showBookModal, setShowBookModal] = useState(false);
  const [apptDate, setApptDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [apptTime, setApptTime] = useState('10:00');
  const [apptTitle, setApptTitle] = useState('Reunión Comercial Meraki');
  const [bookingAppt, setBookingAppt] = useState(false);

  const [newNoteKind, setNewNoteKind] = useState<'note' | 'reminder'>('note');
  const [newNoteText, setNewNoteText] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const initProj =
      (lead.projectInterest && lead.projectInterest[0]) ||
      (lead.metadata as any)?.project ||
      (lead.metadata as any)?.smarthomeProyectoOriginal ||
      lead.firstTouch?.project ||
      '';
    setName(lead.name ?? '');
    setPhone(lead.phone ?? '');
    setEmail(lead.email ?? '');
    setCity(lead.city ?? '');
    setDocumentNumber(lead.documentNumber ?? '');
    setStatus(lead.status || 'new');
    setProjectInterest(initProj);
    setFuenteUbicacion(lead.fuenteUbicacion || (lead.metadata as any)?.smarthomeFuenteOriginal || '');
    setTagInput((lead.tags || []).join(', '));
    setMetadata(lead.metadata || {});
    setAssignedTo(lead.assignedTo || '');
    setLocked(!!lead.assignmentLocked);
    setSuggestionDismissed(false);
    setError(null);
    setSaved(false);
  }, [lead?.id]);

  // Sincronizar en vivo metadata y status cuando se guarda una Ficha Técnica o Nota mientras el modal está abierto
  useEffect(() => {
    if (!lead) return;
    if (lead.status) setStatus(lead.status);
    if (lead.metadata) setMetadata(lead.metadata);
  }, [lead?.status, lead?.lastFollowUpAt, lead?.updatedAt]);

  useEffect(() => {
    if (!visible || !companyId) return;
    const unsub = subscribeLeadSources(companyId, (items) => {
      setSources(items.filter((s) => s.active));
    });
    listContactFields(companyId).then(setCustomFields).catch(() => {});
    return () => unsub();
  }, [visible, companyId]);

  const refreshAppointments = () => {
    if (!companyId || !lead?.id) return;
    setLoadingAppts(true);
    listLeadAppointments(companyId, lead.id)
      .then(setAppointments)
      .catch(() => {})
      .finally(() => setLoadingAppts(false));
  };

  useEffect(() => {
    if (visible && lead?.id) refreshAppointments();
  }, [visible, lead?.id, companyId]);

  const currentTags = useMemo(
    () =>
      tagInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [tagInput]
  );

  if (!visible || !lead) return null;

  const displayName = lead.name || formatPhone(lead.phone);
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const isWhatsapp = !lead.channel || lead.channel === 'whatsapp';
  const assignedAdvisor = advisors.find((a) => a.id === (assignedTo || lead.assignedTo));
  const isAdvisorDirect =
    lead.inbox === 'advisor_direct' ||
    lead.source === 'advisor_whatsapp' ||
    (lead.metadata as any)?.advisorWhatsappMirror === 'true';

  const expiresAtMs = toMillisSafe(lead.callPermission?.expiresAt);
  const lastReqMs = toMillisSafe(lead.callPermission?.lastRequestedAt);
  const hasCallPerm = !!lead.callPermission?.granted && (!expiresAtMs || expiresAtMs > Date.now());
  const requestedRecently = !!lastReqMs && Date.now() - lastReqMs < 86_400_000;

  const initProj =
    (lead.projectInterest && lead.projectInterest[0]) ||
    (lead.metadata as any)?.project ||
    (lead.metadata as any)?.smarthomeProyectoOriginal ||
    lead.firstTouch?.project ||
    '';
  const prevFuente = lead.fuenteUbicacion || (lead.metadata as any)?.smarthomeFuenteOriginal || '';

  const hasRealPhone = Boolean(lead.phone && !lead.phone.startsWith('user_') && !lead.phone.includes('CO.'));
  const isAssigned = lead.assignedTo === user?.uid;
  const canEditPhone = isAdmin || isAssigned || !hasRealPhone;

  const isDirty =
    name.trim() !== (lead.name ?? '') ||
    (canEditPhone && phone.trim() !== (lead.phone ?? '')) ||
    email.trim() !== (lead.email ?? '') ||
    city.trim() !== (lead.city ?? '') ||
    documentNumber.trim() !== (lead.documentNumber ?? '') ||
    status !== lead.status ||
    projectInterest !== initProj ||
    fuenteUbicacion !== prevFuente ||
    tagInput.trim() !== (lead.tags || []).join(', ') ||
    JSON.stringify(metadata) !== JSON.stringify(lead.metadata || {});

  const suggested = lead.aiAnalysis?.suggestedStatus;
  const suggestion =
    suggested && suggested !== 'ninguno' && suggested !== status && !suggestionDismissed
      ? {
          value: suggested as Lead['status'],
          label: STATUS_OPTIONS.find((o) => o.value === suggested)?.label || suggested,
        }
      : null;

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const newFuente = fuenteUbicacion.trim();
      await updateLead(companyId, lead.id, {
        name: name.trim() || undefined,
        ...(canEditPhone && phone.trim() ? { phone: phone.trim() } : {}),
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        documentNumber: documentNumber.trim() || undefined,
        status,
        tags: currentTags,
        metadata: {
          ...metadata,
          ...(projectInterest ? { project: projectInterest } : {}),
        },
        fuenteUbicacion: newFuente || undefined,
        projectInterest: projectInterest ? [projectInterest] : [],
      });

      if (newFuente && newFuente !== prevFuente) {
        const actor = profile?.displayName || user?.email || 'Administrador';
        await recordLeadAudit(
          companyId,
          lead.id,
          'source',
          { previousValue: prevFuente || 'Sin especificar', newValue: newFuente },
          actor
        );
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message || 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async (val: string) => {
    const prev = assignedTo;
    setAssignedTo(val);
    try {
      await reassignLead(companyId, lead.id, val || null);
      const actor = profile?.displayName || user?.email || 'Administrador';
      const newName = advisors.find((a) => a.id === val)?.displayName || 'Sin asesor';
      const oldName = advisors.find((a) => a.id === prev)?.displayName || 'Sin asesor';
      await recordLeadAudit(companyId, lead.id, 'advisor', { previousValue: oldName, newValue: newName }, actor);
    } catch {
      setAssignedTo(prev);
      setError('No se pudo reasignar el asesor.');
    }
  };

  const handleToggleLock = async () => {
    if (lockBusy) return;
    const next = !locked;
    setLocked(next);
    setLockBusy(true);
    try {
      await setLeadAssignmentLock(companyId, lead.id, next);
    } catch {
      setLocked(!next);
    } finally {
      setLockBusy(false);
    }
  };

  const handleToggleAi = async () => {
    if (togglingAi) return;
    setTogglingAi(true);
    try {
      await setLeadAi(companyId, lead.id, !lead.aiEnabled);
    } catch {
      setError('No se pudo cambiar el estado de la IA.');
    } finally {
      setTogglingAi(false);
    }
  };

  const handleStartAiCall = async () => {
    if (callingAi) return;
    setCallingAi(true);
    try {
      await startAiCall(companyId, lead.id);
      Alert.alert('Llamada IA iniciada', 'Victoria está marcando al prospecto en este momento.');
    } catch (err: any) {
      Alert.alert('Llamada IA', err?.message || 'No se pudo iniciar la llamada con IA.');
    } finally {
      setCallingAi(false);
    }
  };

  const handleWaCallOrPerm = async () => {
    if (hasCallPerm) {
      void Linking.openURL(`tel:${lead.phone}`);
      return;
    }
    if (requestingPerm || requestedRecently) return;
    setRequestingPerm(true);
    try {
      await requestWhatsappCallPermission(companyId, lead.id);
      Alert.alert('Solicitud enviada', 'Se envió la solicitud oficial de permiso de llamada por WhatsApp.');
    } catch (err: any) {
      Alert.alert('Permiso WA', err?.message || 'No se pudo enviar la solicitud de permiso.');
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      await analyzeLead(companyId, lead.id);
    } catch (err: any) {
      Alert.alert('Radiografía IA', err?.message || 'No se pudo ejecutar el análisis IA.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleBookAppointment = async () => {
    if (!apptDate || bookingAppt) return;
    setBookingAppt(true);
    try {
      const startISO = new Date(`${apptDate}T${apptTime || '10:00'}:00-05:00`).toISOString();
      await bookAppointmentManual(companyId, {
        leadId: lead.id,
        startISO,
        durationMinutes: 45,
        title: apptTitle.trim() || `Cita con ${displayName}`,
      });
      setShowBookModal(false);
      refreshAppointments();
    } catch (err: any) {
      Alert.alert('Agendar Cita', err?.message || 'No se pudo agendar la cita.');
    } finally {
      setBookingAppt(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim() || addingNote) return;
    setAddingNote(true);
    try {
      let dueAt: number | undefined;
      if (newNoteKind === 'reminder' && newReminderDate) {
        const parsed = new Date(`${newReminderDate}T10:00:00-05:00`).getTime();
        if (!isNaN(parsed)) dueAt = parsed;
      }
      await addLeadNote(companyId, lead.id, newNoteKind, newNoteText.trim(), dueAt);
      setNewNoteText('');
      setNewReminderDate('');
    } catch (err: any) {
      Alert.alert('Nota', err?.message || 'No se pudo guardar la nota.');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.drawer, { backgroundColor: palette.bgDrawer }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Sticky Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.borderDrawer,
              paddingTop: Math.max(insets.top + 8, 14),
            },
          ]}
        >
          <View style={styles.topIdentity}>
            <View style={[styles.avatar, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
              <Text style={[styles.avatarText, { color: palette.brandText }]}>{initials || '👤'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.leadTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                {displayName}
              </Text>
              {isWhatsapp && (
                <Pressable onPress={() => Linking.openURL(`tel:${lead.phone}`)} style={styles.phoneLink}>
                  <Icon name="Phone" size={12} color={palette.textMuted} />
                  <Text style={{ fontSize: 12, color: palette.textMuted }}>{formatPhone(lead.phone)}</Text>
                </Pressable>
              )}
            </View>
            <LeadScoreBadge score={lead.aiAnalysis?.score} />
            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
              hitSlop={10}
            >
              <Icon name="X" size={16} color={palette.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.headerActions}>
            <View style={styles.rowGap}>
              {onOpenChat && (
                <Button
                  size="sm"
                  onPress={() => {
                    onClose();
                    onOpenChat(lead);
                  }}
                  style={{ flex: 1 }}
                  icon={<Icon name="MessageSquare" size={14} color="#ffffff" />}
                >
                  Abrir conversación
                </Button>
              )}
              <Pressable
                onPress={handleToggleAi}
                disabled={togglingAi}
                style={[
                  styles.aiPill,
                  lead.aiEnabled
                    ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
                    : { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                ]}
              >
                <Icon name="Bot" size={14} color={lead.aiEnabled ? palette.emeraldText : palette.amberText} />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: lead.aiEnabled ? palette.emeraldText : palette.amberText,
                  }}
                >
                  {lead.aiEnabled ? 'IA activa' : 'IA pausada'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.grid4}>
              <Pressable
                onPress={() => setShowFichaModal(true)}
                style={[styles.quickBtn, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}
              >
                <Icon name="ClipboardList" size={13} color={palette.emeraldText} />
                <Text style={[styles.quickBtnText, { color: palette.emeraldText }]}>Ficha</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowBookModal(true)}
                style={[styles.quickBtn, { backgroundColor: palette.skyBg, borderColor: palette.skyBorder }]}
              >
                <Icon name="Calendar" size={13} color={palette.skyText} />
                <Text style={[styles.quickBtnText, { color: palette.skyText }]}>Agendar</Text>
              </Pressable>
              {isWhatsapp && (
                <Pressable
                  onPress={handleStartAiCall}
                  disabled={callingAi}
                  style={[styles.quickBtn, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}
                >
                  <Icon name="PhoneCall" size={13} color={palette.brandText} />
                  <Text style={[styles.quickBtnText, { color: palette.brandText }]}>Llamar IA</Text>
                </Pressable>
              )}
              {isWhatsapp && (
                <Pressable
                  onPress={handleWaCallOrPerm}
                  disabled={requestingPerm}
                  style={[
                    styles.quickBtn,
                    hasCallPerm
                      ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
                      : { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
                  ]}
                >
                  <Icon name="Phone" size={13} color={hasCallPerm ? palette.emeraldText : palette.textMuted} />
                  <Text
                    style={[
                      styles.quickBtnText,
                      { color: hasCallPerm ? palette.emeraldText : palette.textMuted },
                    ]}
                  >
                    {hasCallPerm ? 'Llamar WA' : 'Permiso WA'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Scrollable Body */}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Summary & Attribution */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowGap}>
                <LeadStatusBadge status={lead.status} size="sm" />
                <Badge
                  label={isAdvisorDirect ? '👤 Directo Asesor' : '🏢 Línea 317'}
                  color={isAdvisorDirect ? 'blue' : 'violet'}
                  size="xs"
                />
              </View>
              <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                Alta: {formatShortDate(lead.createdAt)}
              </Text>
            </View>

            <View style={[styles.infoGrid, { marginTop: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.microLabel, { color: palette.textSubtle }]}>ASESOR</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: palette.textPrimary }} numberOfLines={1}>
                  {assignedAdvisor?.displayName || lead.assignedAdvisorName || 'Sin asignar'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.microLabel, { color: palette.textSubtle }]}>ÚLTIMA ACTIVIDAD</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: palette.textPrimary }} numberOfLines={1}>
                  {formatShortDate(lead.lastMessageAt)}
                </Text>
              </View>
            </View>

            {(lead.lastFollowUpAction || lead.nextFollowUpAction) && (
              <View style={[styles.followBanner, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
                <View style={styles.rowBetween}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: palette.emeraldText }}>
                    🕒 SEGUIMIENTO COMERCIAL ACTIVO
                  </Text>
                  <Pressable onPress={() => setShowFichaModal(true)}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>+ Ficha</Text>
                  </Pressable>
                </View>
                {lead.lastFollowUpAction ? (
                  <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 3 }}>
                    Última acción: <Text style={{ fontWeight: '700' }}>{lead.lastFollowUpAction.replace(/_/g, ' ')}</Text>
                  </Text>
                ) : null}
                {lead.nextFollowUpAction ? (
                  <Text style={{ fontSize: 11, color: palette.amberText, fontWeight: '700', marginTop: 3 }}>
                    🎯 Próximo paso: {lead.nextFollowUpAction} {lead.nextFollowUpDate ? `· 📅 ${lead.nextFollowUpDate}` : ''}
                  </Text>
                ) : null}
              </View>
            )}

            {/* Attribution box */}
            <View style={[styles.attrBox, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: palette.brandText }}>
                🎯 ATRIBUCIÓN COMERCIAL & CAMPAÑA
              </Text>
              <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 4 }}>
                Primera entrada: <Text style={{ fontWeight: '700', color: palette.textPrimary }}>{lead.firstTouch?.source || lead.source}</Text>
                {lead.firstTouch?.campaign ? ` — ${lead.firstTouch.campaign}` : ''}
              </Text>
              {(lead.firstTouch?.adName || lead.sourceMeta?.headline) ? (
                <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                  Anuncio: {lead.firstTouch?.adName || lead.sourceMeta?.headline}
                </Text>
              ) : null}
              {lead.sourceMeta?.sourceUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(lead.sourceMeta!.sourceUrl!)}
                  style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <Icon name="Play" size={12} color={palette.brandText} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: palette.brandText }}>
                    Ver anuncio / video en Facebook ↗
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Editable Contact Form */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <Text style={[styles.sectionHeader, { color: palette.textSubtle }]}>DATOS DEL CONTACTO</Text>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Nombre</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={formatPhone(lead.phone)}
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            </View>

            {canEditPhone && (
              <View style={styles.field}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                  <Text style={[styles.label, { color: palette.textSecondary }]}>Teléfono / Celular</Text>
                  {!hasRealPhone && (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: palette.amber }}>
                      ⚠️ Entró con usuario WA
                    </Text>
                  )}
                </View>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="+57 300 000 0000"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
                {!hasRealPhone && (
                  <Text style={{ fontSize: 10, color: palette.textMuted, marginTop: 2 }}>
                    Ingresa el teléfono para habilitar llamadas salientes y WhatsApp directo.
                  </Text>
                )}
              </View>
            )}

            <View style={styles.rowGap}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Correo</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="correo@ejemplo.com"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Ciudad</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  placeholder="Bogotá, Ibagué..."
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Cédula / Documento</Text>
              <TextInput
                value={documentNumber}
                onChangeText={setDocumentNumber}
                placeholder="Número de identificación"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>🏡 Proyecto de interés</Text>
              <SelectModal
                value={projectInterest}
                options={[
                  { value: '', label: 'Sin especificar / Por definir' },
                  ...MERAKI_PROJECT_OPTIONS.map((p) => ({ value: p.id, label: p.label })),
                  ...(projectInterest && !MERAKI_PROJECT_OPTIONS.some((p) => p.id === projectInterest)
                    ? [{ value: projectInterest, label: `${projectInterest} (Actual)` }]
                    : []),
                ]}
                onChange={setProjectInterest}
                title="Proyecto de Interés"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>🧭 Fuente de Ubicación</Text>
              <SelectModal
                value={fuenteUbicacion}
                options={[
                  ...(fuenteUbicacion && !sources.some((s) => s.name === fuenteUbicacion)
                    ? [{ value: fuenteUbicacion, label: `${fuenteUbicacion} (Histórica)` }]
                    : []),
                  ...sources.map((s) => ({ value: s.name, label: s.name })),
                ]}
                onChange={setFuenteUbicacion}
                placeholder="Seleccionar fuente..."
                title="Fuente de Ubicación"
                searchable
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Estado comercial</Text>
              <SelectModal
                value={status}
                options={STATUS_OPTIONS}
                onChange={(v) => setStatus(v as Lead['status'])}
                title="Estado Comercial"
              />
              {suggestion && (
                <View style={[styles.attrBox, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: palette.brandText }}>
                    ✨ La IA sugiere: {suggestion.label}
                  </Text>
                  {lead.aiAnalysis?.suggestedStatusReason ? (
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 3 }}>
                      {lead.aiAnalysis.suggestedStatusReason}
                    </Text>
                  ) : null}
                  <View style={[styles.rowGap, { marginTop: 8 }]}>
                    <Button
                      size="sm"
                      onPress={async () => {
                        setStatus(suggestion.value);
                        await updateLead(companyId, lead.id, { status: suggestion.value });
                        setSuggestionDismissed(true);
                      }}
                    >
                      Aplicar cambio
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => setSuggestionDismissed(true)}>
                      Ignorar
                    </Button>
                  </View>
                </View>
              )}
            </View>

            {isAdmin && (
              <View style={styles.field}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>Asesor asignado</Text>
                <SelectModal
                  value={assignedTo}
                  options={[
                    { value: '', label: 'Sin asignar' },
                    ...advisors.map((a) => ({
                      value: a.id,
                      label: `${a.displayName}${a.googleConnected ? ' · Calendar' : ''}`,
                    })),
                  ]}
                  onChange={handleReassign}
                  title="Reasignar Asesor"
                  searchable
                />
                <Pressable
                  onPress={handleToggleLock}
                  disabled={lockBusy}
                  style={[
                    styles.lockBtn,
                    locked
                      ? { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }
                      : { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
                  ]}
                >
                  <Icon name={locked ? 'Lock' : 'Unlock'} size={14} color={locked ? palette.amberText : palette.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: locked ? palette.amberText : palette.textSecondary }}>
                      {locked ? 'Asesor fijado — no se reasignará' : 'Fijar asesor (bloquear reasignación)'}
                    </Text>
                    <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                      {locked
                        ? 'Toca para permitir la reasignación automática.'
                        : 'Evita que la reasignación automática por SLA lo mueva.'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>🏷️ Etiquetas (separadas por coma)</Text>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="interesado, proyecto, prioridad"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
              {allTags.length > 0 && (
                <View style={styles.wrapRow}>
                  {allTags
                    .filter((t) => !currentTags.includes(t))
                    .slice(0, 6)
                    .map((t) => (
                      <Pressable
                        key={t}
                        onPress={() => setTagInput([...currentTags, t].join(', '))}
                        style={[styles.tagChip, { borderColor: palette.borderStrong }]}
                      >
                        <Text style={{ fontSize: 10, color: palette.textMuted }}>+ {t}</Text>
                      </Pressable>
                    ))}
                </View>
              )}
            </View>

            {customFields.map((field) => (
              <View key={field.id} style={styles.field}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>{field.label}</Text>
                {field.type === 'select' ? (
                  <SelectModal
                    value={metadata[field.id] ?? ''}
                    options={[
                      { value: '', label: 'Sin valor' },
                      ...field.options.map((o) => ({ value: o, label: o })),
                    ]}
                    onChange={(v) => setMetadata((prev) => ({ ...prev, [field.id]: v }))}
                    title={field.label}
                  />
                ) : (
                  <TextInput
                    value={metadata[field.id] ?? ''}
                    onChangeText={(v) => setMetadata((prev) => ({ ...prev, [field.id]: v }))}
                    keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                    style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                  />
                )}
              </View>
            ))}

            {error ? (
              <View style={[styles.followBanner, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}>
                <Text style={{ fontSize: 11, color: palette.roseText }}>{error}</Text>
              </View>
            ) : null}
          </View>

          {/* Citas */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionHeader, { color: palette.textSubtle, marginBottom: 0 }]}>📅 CITAS</Text>
              <Pressable onPress={() => setShowBookModal(true)}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.skyText }}>+ Agendar</Text>
              </Pressable>
            </View>
            {loadingAppts ? (
              <ActivityIndicator size="small" color={palette.brand} style={{ marginVertical: 10 }} />
            ) : appointments.length === 0 ? (
              <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 6 }}>Sin citas programadas.</Text>
            ) : (
              appointments.map((appt) => (
                <View
                  key={appt.id}
                  style={[styles.subItem, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}
                >
                  <View style={styles.rowBetween}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.textPrimary, flex: 1 }}>
                      {appt.title}
                    </Text>
                    <Badge
                      label={appt.status === 'canceled' ? 'Cancelada' : appt.status === 'completed' ? 'Realizada' : 'Agendada'}
                      color={appt.status === 'canceled' ? 'red' : appt.status === 'completed' ? 'green' : 'yellow'}
                      size="xs"
                    />
                  </View>
                  <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                    {formatShortDate(appt.startTime)}
                  </Text>
                  <View style={[styles.rowGap, { marginTop: 6 }]}>
                    {appt.googleMeetLink ? (
                      <Pressable
                        onPress={() => Linking.openURL(appt.googleMeetLink!)}
                        style={[styles.miniBtn, { backgroundColor: palette.skyBg, borderColor: palette.skyBorder }]}
                      >
                        <Icon name="Video" size={12} color={palette.skyText} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.skyText }}>Google Meet</Text>
                      </Pressable>
                    ) : null}
                    {appt.status === 'scheduled' && (
                      <Pressable
                        onPress={async () => {
                          await cancelAppointment(companyId, appt.id);
                          refreshAppointments();
                        }}
                        style={[styles.miniBtn, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.roseText }}>Cancelar</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Bitácora, Notas & Recordatorios */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionHeader, { color: palette.textSubtle, marginBottom: 0 }]}>
                📋 BITÁCORA, NOTAS & RECORDATORIOS
              </Text>
              <Pressable onPress={() => setShowFichaModal(true)}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>+ Ficha</Text>
              </Pressable>
            </View>

            <View style={[styles.rowGap, { marginTop: 8 }]}>
              <Pressable
                onPress={() => setNewNoteKind('note')}
                style={[
                  styles.miniBtn,
                  newNoteKind === 'note'
                    ? { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }
                    : { backgroundColor: palette.bgElevated, borderColor: palette.border },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: newNoteKind === 'note' ? palette.brandText : palette.textMuted }}>
                  📝 Nota
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNewNoteKind('reminder')}
                style={[
                  styles.miniBtn,
                  newNoteKind === 'reminder'
                    ? { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }
                    : { backgroundColor: palette.bgElevated, borderColor: palette.border },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: newNoteKind === 'reminder' ? palette.amberText : palette.textMuted }}>
                  ⏰ Recordatorio
                </Text>
              </Pressable>
            </View>

            <TextInput
              value={newNoteText}
              onChangeText={setNewNoteText}
              placeholder={newNoteKind === 'reminder' ? '¿Qué debes recordar hacer?' : 'Agregar nota rápida...'}
              placeholderTextColor={palette.placeholder}
              multiline
              style={[styles.input, { marginTop: 6, backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
            />
            {newNoteKind === 'reminder' && (
              <TextInput
                value={newReminderDate}
                onChangeText={setNewReminderDate}
                placeholder="Fecha recordatorio (AAAA-MM-DD)"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { marginTop: 6, backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            )}
            <Button
              size="sm"
              variant="secondary"
              onPress={handleAddNote}
              loading={addingNote}
              disabled={!newNoteText.trim()}
              style={{ marginTop: 6 }}
            >
              Agregar {newNoteKind === 'reminder' ? 'Recordatorio' : 'Nota'}
            </Button>

            {notes.slice(0, 8).map((n) => (
              <View
                key={n.id}
                style={[styles.subItem, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
              >
                <View style={styles.rowBetween}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: palette.textSecondary }}>
                    {n.kind === 'reminder' ? '⏰ Recordatorio' : '📝 Nota'} · {n.authorName}
                  </Text>
                  <View style={styles.rowGap}>
                    {n.kind === 'reminder' && (
                      <Pressable onPress={() => setReminderDone(companyId, lead.id, n.id, !n.done)}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: n.done ? palette.emeraldText : palette.brandText }}>
                          {n.done ? '✓ Hecho' : 'Marcar hecho'}
                        </Text>
                      </Pressable>
                    )}
                    {isAdmin && (
                      <Pressable onPress={() => deleteLeadNote(companyId, lead.id, n.id)}>
                        <Icon name="Trash2" size={13} color={palette.roseText} />
                      </Pressable>
                    )}
                  </View>
                </View>
                <Text style={{ fontSize: 12, color: palette.textPrimary, marginTop: 3 }}>{n.text}</Text>
              </View>
            ))}
          </View>

          {/* Radiografía IA */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionHeader, { color: palette.textSubtle, marginBottom: 0 }]}>
                ✨ RADIOGRAFÍA IA
              </Text>
              <Pressable onPress={handleAnalyze} disabled={analyzing}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.brandText }}>
                  {analyzing ? 'Analizando...' : '🔄 Actualizar análisis'}
                </Text>
              </Pressable>
            </View>
            {lead.aiAnalysis ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <View style={styles.rowGap}>
                  <Badge
                    label={`Score: ${lead.aiAnalysis.score}/100`}
                    color={lead.aiAnalysis.score >= 66 ? 'green' : lead.aiAnalysis.score >= 33 ? 'yellow' : 'blue'}
                  />
                  <Badge
                    label={
                      lead.aiAnalysis.temperature === 'hot'
                        ? '🔥 Caliente'
                        : lead.aiAnalysis.temperature === 'warm'
                        ? '🌤️ Tibio'
                        : '❄️ Frío'
                    }
                    color={lead.aiAnalysis.temperature === 'hot' ? 'red' : lead.aiAnalysis.temperature === 'warm' ? 'yellow' : 'blue'}
                  />
                </View>
                {lead.aiAnalysis.summary ? (
                  <Text style={{ fontSize: 12, color: palette.textPrimary, lineHeight: 17 }}>
                    {lead.aiAnalysis.summary}
                  </Text>
                ) : null}
                {lead.aiAnalysis.nextBestAction || lead.aiAnalysis.nextAction ? (
                  <View style={[styles.attrBox, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                      Siguiente mejor acción: {lead.aiAnalysis.nextBestAction || lead.aiAnalysis.nextAction}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 6 }}>
                Toca "Actualizar análisis" para generar el perfil comercial con IA.
              </Text>
            )}
          </View>

          {/* Historial de Llamadas IA */}
          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <Text style={[styles.sectionHeader, { color: palette.textSubtle }]}>📞 LLAMADAS CON IA</Text>
            {calls.length === 0 ? (
              <Text style={{ fontSize: 12, color: palette.textSubtle }}>Sin llamadas registradas aún.</Text>
            ) : (
              calls.map((c) => (
                <View
                  key={c.id}
                  style={[styles.subItem, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
                >
                  <View style={styles.rowBetween}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.textPrimary }}>
                      {c.outcome || c.status}
                    </Text>
                    <Text style={{ fontSize: 10, color: palette.textSubtle }}>
                      {c.durationSec ? `${c.durationSec}s · ` : ''}
                      {formatShortDate(c.createdAt)}
                    </Text>
                  </View>
                  {c.summary ? (
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 4 }}>{c.summary}</Text>
                  ) : null}
                  {c.recordingUrl ? (
                    <View style={{ marginTop: 6 }}>
                      <CallAudioButton url={c.recordingUrl} />
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </ScrollView>

        {/* Sticky Footer Save */}
        <View
          style={[
            styles.footer,
            {
              backgroundColor: palette.bgCard,
              borderTopColor: palette.borderDrawer,
              paddingBottom: Math.max(insets.bottom + 8, 12),
            },
          ]}
        >
          <Button
            onPress={handleSave}
            disabled={!isDirty || saving}
            loading={saving}
            fullWidth
            style={isDirty ? { backgroundColor: palette.emerald, borderColor: palette.emerald } : undefined}
          >
            {saved ? '✓ Cambios guardados' : isDirty ? '💾 Guardar cambios pendientes' : 'Sin cambios pendientes'}
          </Button>
        </View>

        {/* Agendar Cita Modal */}
        <Modal visible={showBookModal} transparent animationType="fade" onRequestClose={() => setShowBookModal(false)}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: palette.backdrop }]} onPress={() => setShowBookModal(false)}>
            <Pressable
              style={[styles.bookSheet, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
              onPress={() => {}}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: palette.textPrimary }}>
                📅 Agendar Cita Comercial
              </Text>
              <TextInput
                value={apptTitle}
                onChangeText={setApptTitle}
                placeholder="Título de la cita"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
              <View style={styles.rowGap}>
                <TextInput
                  value={apptDate}
                  onChangeText={setApptDate}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { flex: 1, backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
                <TextInput
                  value={apptTime}
                  onChangeText={setApptTime}
                  placeholder="HH:MM"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { flex: 1, backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
                />
              </View>
              <View style={styles.rowGap}>
                <Button variant="secondary" onPress={() => setShowBookModal(false)} style={{ flex: 1 }}>
                  Cancelar
                </Button>
                <Button onPress={handleBookAppointment} loading={bookingAppt} style={{ flex: 1.3 }}>
                  Confirmar Cita
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Ficha Técnica Modal */}
        <FichaTecnicaModal
          isOpen={showFichaModal}
          onClose={() => setShowFichaModal(false)}
          companyId={companyId}
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            project: projectInterest || initProj || null,
            advisorName: assignedAdvisor?.displayName || lead.assignedAdvisorName || null,
            bitacoras: lead.bitacoras,
            metadata: lead.metadata,
          }}
          onSuccess={() => {
            setShowFichaModal(false);
            refreshAppointments();
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  topIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800' },
  leadTitle: { fontSize: 15, fontWeight: '800' },
  phoneLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { gap: 8 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  grid4: { flexDirection: 'row', gap: 6 },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  quickBtnText: { fontSize: 11, fontWeight: '700' },
  body: { padding: 14, gap: 12, paddingBottom: 24 },
  card: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 8 },
  infoGrid: { flexDirection: 'row', gap: 12 },
  microLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  followBanner: { marginTop: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  attrBox: { marginTop: 6, padding: 10, borderRadius: 12, borderWidth: 1 },
  sectionHeader: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 4 },
  field: { gap: 4 },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 12,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  tagChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  subItem: { padding: 10, borderRadius: 12, borderWidth: 1, marginTop: 6 },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20 },
  bookSheet: { padding: 18, borderRadius: 18, borderWidth: 1, gap: 12 },
});
