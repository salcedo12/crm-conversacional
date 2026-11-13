import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useLeadNotes } from '../hooks/useLeadDetails';
import { deleteLeadNote } from '../services/crm';
import {
  PIPELINE_STAGES,
  reportAppointmentFicha,
} from '../services/enterprise';
import { SelectModal } from './SelectModal';
import { Icon } from './Icon';
import {
  DatePickerModal,
  TimePickerModal,
  formatDisplayDate,
  formatDisplayTime,
} from './DateTimePickerModal';

export type FollowUpActionType = string;

export interface FichaActionConfig {
  id: string;
  label: string;
  icon: string;
  desc?: string;
  defaultStageId?: string;
  active?: boolean;
}

export interface FichaNextStepConfig {
  id: string;
  label: string;
  icon: string;
  requiresSchedule: boolean;
  isDesistimiento?: boolean;
  isReferralProgram?: boolean;
  defaultStageId?: string;
  active?: boolean;
}

export interface FichaTecnicaConfig {
  actions: FichaActionConfig[];
  results: Record<string, string[]>;
  nextSteps: FichaNextStepConfig[];
}

export interface FichaTecnicaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  companyId: string;
  lead?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    project?: string | null;
    advisorName?: string | null;
    bitacoras?: any[];
    metadata?: Record<string, any>;
  };
  appointment?: {
    id?: string;
    leadId?: string;
    leadName?: string | null;
    leadPhone?: string | null;
    title?: string;
    advisorName?: string;
    project?: string;
  };
  initialTab?: 'form' | 'history';
}

const DEFAULT_FICHA_ACTIONS: FichaActionConfig[] = [
  { id: 'envio_informacion', label: 'Envío de Información', icon: '📩', desc: 'Brochure, cotización o planos por WhatsApp/Email', defaultStageId: 'envio_info', active: true },
  { id: 'llamada', label: 'Llamada Telefónica', icon: '📞', desc: 'Contacto telefónico directo con el cliente', defaultStageId: '', active: true },
  { id: 'cita_reunion', label: 'Cita / Videollamada', icon: '🎥', desc: 'Reunión virtual por Google Meet o WhatsApp', defaultStageId: 'cita', active: true },
  { id: 'visita_terreno', label: 'Visita Terreno / Sala', icon: '🏡', desc: 'Visita presencial a sala de ventas o proyecto', defaultStageId: 'visita_realizada', active: true },
  { id: 'seguimiento_general', label: 'Seguimiento General', icon: '💬', desc: 'Chat de WhatsApp o recontacto comercial', defaultStageId: '', active: true },
  { id: 'no_interesado', label: 'NO INTERESADO', icon: '❌', desc: 'Prospecto sin interés, solicitud laboral, proveedor o fuera de presupuesto', defaultStageId: 'no_interesado_otra', active: true },
];

const DEFAULT_QUICK_RESULTS: Record<string, string[]> = {
  envio_informacion: [
    'Se envió Brochure y Ficha',
    'Se enviaron Planos y Disponibilidad',
    'Se envió Cotización Formal',
    'Se envió Video del Proyecto',
  ],
  llamada: [
    'Contestó y conversamos',
    'No contestó',
    'Ocupado / Llamar luego',
    'Buzón de mensajes / Equivocado',
  ],
  cita_reunion: [
    'Asistió a la videollamada',
    'No asistió (No-Show)',
    'Reprogramó reunión',
  ],
  visita_terreno: [
    'Asistió a sala de ventas / terreno',
    'No asistió (No-Show)',
    'Reprogramó visita',
  ],
  seguimiento_general: [
    'Cliente muy interesado (Caliente)',
    'Esperando prima o desembolso',
    'Revisando con familia / cónyuge',
    'Comparando con otros proyectos',
  ],
  no_interesado: [
    'PROVEEDOR OFRECIENDO SERVICIOS',
    'SOLICITUD DE TRABAJO',
    'QUIERE COMUNICARSE CON OTRA ÁREA DIFERENTE A COMERCIAL',
    'SE LE SALE DEL PRESUPUESTO',
    'NO LE INTERESA LA UBICACIÓN',
    'NO SOLICITÓ INFORMACIÓN',
  ],
};

const DEFAULT_FICHA_NEXT_STEPS: FichaNextStepConfig[] = [
  { id: 'llamada_seguimiento', label: 'Próxima Llamada de Seguimiento', icon: '📞', requiresSchedule: true, defaultStageId: '', active: true },
  { id: 'visita_terreno', label: 'Visita a Terreno (Sala de Ventas)', icon: '🏠', requiresSchedule: true, defaultStageId: 'visita_realizada', active: true },
  { id: 'enviar_cotizacion', label: 'Enviar Cotización Detallada', icon: '📄', requiresSchedule: true, defaultStageId: 'cotizacion', active: true },
  { id: 'plan_referidos', label: 'Derivación a Plan de Referidos', icon: '🤝', requiresSchedule: false, isReferralProgram: true, defaultStageId: '', active: true },
  { id: 'cierre_pago', label: 'Cierre de Venta / Separación de Lote', icon: '💳', requiresSchedule: true, defaultStageId: 'negociacion', active: true },
  { id: 'desistimiento', label: 'Desistimiento Definitivo (Sin presupuesto)', icon: '❌', requiresSchedule: false, isDesistimiento: true, defaultStageId: 'no_interesado_dinero', active: true },
  { id: 'sin_proximo_contacto', label: 'Sin Próximo Contacto (Cierre de Gestión)', icon: '⏹️', requiresSchedule: false, isDesistimiento: true, defaultStageId: '', active: true },
  { id: 'cliente_a_futuro', label: 'CLIENTE A FUTURO', icon: '⏳', requiresSchedule: true, defaultStageId: 'prospecto', active: true },
];

const FORM_ACTION_OPTIONS = DEFAULT_FICHA_ACTIONS;

const ALL_ACTION_DISPLAY: { id: string; label: string; icon: string }[] = [
  ...DEFAULT_FICHA_ACTIONS,
  { id: 'cambio_asesor', label: 'Cambio de Asesor (Admin)', icon: '👤' },
  { id: 'cambio_fuente', label: 'Cambio de Fuente (Admin)', icon: '🧭' },
];

const QUICK_RESULTS = DEFAULT_QUICK_RESULTS;

const NEXT_ACTION_OPTIONS = DEFAULT_FICHA_NEXT_STEPS;

function getPresetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextMondayDate(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}

const DATE_PRESETS = [
  { id: 'today', label: 'Hoy', getVal: () => getPresetDate(0) },
  { id: 'tomorrow', label: 'Mañana', getVal: () => getPresetDate(1) },
  { id: 'in_2_days', label: '+2 Días', getVal: () => getPresetDate(2) },
  { id: 'in_3_days', label: '+3 Días', getVal: () => getPresetDate(3) },
  { id: 'next_mon', label: 'Próx. Lunes', getVal: () => getNextMondayDate() },
];

const TIME_PRESETS = [
  { label: '09:00 AM', value: '09:00' },
  { label: '10:30 AM', value: '10:30' },
  { label: '02:00 PM', value: '14:00' },
  { label: '03:30 PM', value: '15:30' },
  { label: '05:00 PM', value: '17:00' },
];

function formatFullDateTimeSafe(ts: any): string {
  if (!ts) return '';
  let d: Date | null = null;
  if (typeof ts.toDate === 'function') d = ts.toDate();
  else if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    d = new Date((ts._seconds ?? ts.seconds) * 1000);
  } else if (typeof ts === 'number' || typeof ts === 'string') {
    const parsed = new Date(String(ts).replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return String(ts);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFriendlySchedule(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const dateObj = new Date(y, m - 1, d);
  const todayStr = getPresetDate(0);
  const tomorrowStr = getPresetDate(1);
  let prefix = '';
  if (dateStr === todayStr) prefix = 'Hoy, ';
  else if (dateStr === tomorrowStr) prefix = 'Mañana, ';
  else {
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    prefix = `${dayNames[dateObj.getDay()]}, `;
  }
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const formattedDate = `${prefix}${d} de ${monthNames[(m || 1) - 1] || ''}`;
  let formattedTime = timeStr;
  if (timeStr && timeStr.includes(':')) {
    const [h, min] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    formattedTime = `${h12}:${String(min || 0).padStart(2, '0')} ${ampm}`;
  }
  return `${formattedDate} · ${formattedTime}`;
}

async function shareIcsInvitation(opts: {
  title: string;
  description: string;
  location: string;
  startDate: Date;
  durationMinutes: number;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const toUtcIcs = (dt: Date) =>
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(
      dt.getUTCMinutes()
    )}00Z`;
  const end = new Date(opts.startDate.getTime() + opts.durationMinutes * 60_000);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meraki CRM//Seguimiento//ES',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@merakicrm.com`,
    `DTSTAMP:${toUtcIcs(new Date())}`,
    `DTSTART:${toUtcIcs(opts.startDate)}`,
    `DTEND:${toUtcIcs(end)}`,
    `SUMMARY:${opts.title}`,
    `DESCRIPTION:${opts.description.replace(/\n/g, '\\n')}`,
    `LOCATION:${opts.location}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const fsAny = FileSystem as any;
  const dir = fsAny.cacheDirectory || fsAny.documentDirectory;
  if (dir) {
    const uri = `${dir}seguimiento_meraki_${Date.now()}.ics`;
    await fsAny.writeAsStringAsync?.(uri, ics, { encoding: fsAny.EncodingType?.UTF8 || 'utf8' });
    await Share.share(Platform.OS === 'ios' ? { url: uri, title: opts.title } : { message: ics, url: uri, title: opts.title });
  } else {
    await Share.share({ message: ics, title: opts.title });
  }
}

function isAutomatedSystemNote(note: {
  authorId?: string | null;
  authorName?: string | null;
  type?: string | null;
  actionType?: string | null;
  text?: string | null;
  source?: string | null;
}): boolean {
  if (note.authorId === 'system' || note.authorId === 'bot') return true;
  if (note.type === 'audit' || note.actionType === 'unificacion_duplicado' || note.actionType === 'traslado_comercial') return true;
  if (note.source === 'system' || note.source === 'automation') return true;
  const author = (note.authorName || '').toLowerCase();
  if (author.includes('sistema') || author.includes('unificaci')) return true;
  const text = note.text || '';
  if (
    text.includes('Prospecto Unificado Automáticamente') ||
    text.includes('Solicitud de traslado') ||
    text.includes('Traslado aprobad') ||
    text.includes('Reasignación aprobad')
  ) {
    return true;
  }
  return false;
}

export function FichaTecnicaModal({
  isOpen,
  onClose,
  onSuccess,
  companyId,
  lead,
  appointment,
  initialTab = 'form',
}: FichaTecnicaModalProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { isAdmin } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);

  const targetLeadId = lead?.id || appointment?.leadId || '';
  const leadName = lead?.name || appointment?.leadName || 'Cliente Prospecto';
  const leadPhone = lead?.phone || appointment?.leadPhone || 'Sin teléfono';
  const leadProject = lead?.project || appointment?.project || 'Proyecto Meraki';
  const advisorName = lead?.advisorName || appointment?.advisorName || 'Asesor Asignado';
  const appointmentId = appointment?.id;

  const [activeTab, setActiveTab] = useState<'form' | 'history'>(initialTab);
  const leadNotes = useLeadNotes(isOpen ? companyId : null, targetLeadId);

  const [fichaConfig, setFichaConfig] = useState<FichaTecnicaConfig>({
    actions: DEFAULT_FICHA_ACTIONS,
    results: DEFAULT_QUICK_RESULTS,
    nextSteps: DEFAULT_FICHA_NEXT_STEPS,
  });

  const [actionType, setActionType] = useState<FollowUpActionType>(
    appointmentId ? 'cita_reunion' : 'envio_informacion'
  );
  const [attended, setAttended] = useState<boolean>(true);
  const [result, setResult] = useState<string>(
    appointmentId ? 'Asistió a la videollamada' : DEFAULT_QUICK_RESULTS.envio_informacion[0]
  );
  const [nextAction, setNextAction] = useState<string>('Próxima Llamada de Seguimiento');
  const [pipelineStage, setPipelineStage] = useState<string>('');
  const [inviteReferralProgram, setInviteReferralProgram] = useState<boolean>(false);
  const [nextDate, setNextDate] = useState<string>('');
  const [nextTime, setNextTime] = useState<string>('10:00');
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [liveLeadData, setLiveLeadData] = useState<Record<string, any> | null>(null);

  const initialProject =
    lead?.project ||
    appointment?.project ||
    (liveLeadData?.projectInterest && liveLeadData.projectInterest[0]) ||
    liveLeadData?.metadata?.project ||
    '';
  const [selectedProject, setSelectedProject] = useState<string>(initialProject);

  useEffect(() => {
    const p =
      (liveLeadData?.projectInterest && liveLeadData.projectInterest[0]) ||
      liveLeadData?.metadata?.project ||
      lead?.project ||
      appointment?.project ||
      '';
    if (p) setSelectedProject(p);
  }, [liveLeadData?.projectInterest, liveLeadData?.metadata?.project, lead?.project, appointment?.project]);

  const projectOptions = useMemo(() => {
    const base = [
      { value: '', label: 'Sin definir' },
      { value: 'Cañón de Arizona', label: 'Cañón de Arizona' },
      { value: 'Río Claro', label: 'Río Claro' },
      { value: 'Laguna Mar', label: 'Laguna Mar' },
      { value: 'Sobre Montañas', label: 'Sobre Montañas de Alvarado' },
      { value: 'Llano Grande', label: 'Llano Grande' },
      { value: 'Proyectos de Ibagué', label: 'Proyectos de Ibagué' },
    ];
    if (selectedProject && !base.some((b) => b.value === selectedProject)) {
      base.push({ value: selectedProject, label: `${selectedProject} (Actual)` });
    }
    return base;
  }, [selectedProject]);

  const handleProjectChange = async (newProj: string) => {
    setSelectedProject(newProj);
    if (!companyId || !targetLeadId) return;
    try {
      await firestore().collection('companies').doc(companyId).collection('leads').doc(targetLeadId).update({
        projectInterest: newProj ? [newProj] : [],
        'metadata.project': newProj,
      });
    } catch (e) {
      console.warn('[FichaTecnicaModal] Error actualizando proyecto:', e);
    }
  };
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<{
    synced: boolean;
    directCalendarUrl?: string;
    title: string;
    dateStr: string;
    leadName: string;
    actionLabel: string;
  } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    const unsub = firestore()
      .collection('companies')
      .doc(companyId)
      .collection('configs')
      .doc('fichaTecnica')
      .onSnapshot(
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as any;
            setFichaConfig({
              actions: Array.isArray(data?.actions) && data.actions.length > 0 ? data.actions : DEFAULT_FICHA_ACTIONS,
              results: data?.results && typeof data.results === 'object' ? data.results : DEFAULT_QUICK_RESULTS,
              nextSteps: Array.isArray(data?.nextSteps) && data.nextSteps.length > 0 ? data.nextSteps : DEFAULT_FICHA_NEXT_STEPS,
            });
          }
        },
        (err) => {
          console.warn('[FichaTecnicaModal mobile] config onSnapshot error:', err);
        }
      );
    return () => unsub();
  }, [companyId]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setActionType(appointmentId ? 'cita_reunion' : 'envio_informacion');
      setResult(appointmentId ? 'Asistió a la videollamada' : (fichaConfig.results['envio_informacion']?.[0] || DEFAULT_QUICK_RESULTS.envio_informacion[0]));
      setError(null);
      setSyncSuccess(null);
    }
  }, [isOpen, initialTab, appointmentId]);

  useEffect(() => {
    if (!isOpen || !companyId || !targetLeadId) return;
    const unsub = firestore()
      .collection('companies')
      .doc(companyId)
      .collection('leads')
      .doc(targetLeadId)
      .onSnapshot((snap) => {
        if (snap.exists()) setLiveLeadData(snap.data() || null);
      });
    return () => unsub();
  }, [isOpen, companyId, targetLeadId]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 120);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const fichaNotes = leadNotes.filter(
    (n) => n.type === 'ficha_tecnica' || n.text?.includes('FICHA TÉCNICA') || n.kind === 'note' || n.kind === 'ficha'
  );
  const humanFichaNotes = fichaNotes.filter((n) => !isAutomatedSystemNote(n));
  const totalFollowUpsCount = humanFichaNotes.length;

  const lastNote = humanFichaNotes[0];
  const lastFollowUpSummary = lastNote
    ? {
        title: lastNote.actionType
          ? fichaConfig.actions.find((a) => a.id === lastNote.actionType)?.label ||
            ALL_ACTION_DISPLAY.find((a) => a.id === lastNote.actionType)?.label ||
            lastNote.actionType
          : 'Seguimiento',
        result: lastNote.result || '',
        author: lastNote.authorName || 'Asesor',
        date: lastNote.createdAt ? formatFullDateTimeSafe(lastNote.createdAt) : '',
        next: lastNote.nextAction || '',
      }
    : null;

  const isNoInteresado =
    actionType === 'no_interesado' ||
    actionType.toLowerCase().includes('no_interesado') ||
    actionType.toLowerCase().includes('desistimiento') ||
    fichaConfig.actions.find((a) => a.id === actionType)?.label?.toLowerCase().includes('no interesado') ||
    fichaConfig.actions.find((a) => a.id === actionType)?.label?.toLowerCase().includes('descarte') ||
    false;

  const deduceNoInteresadoStage = (resText: string, defaultStage?: string) => {
    const norm = (resText || '').toLowerCase();
    if (norm.includes('presupuesto') || norm.includes('dinero') || norm.includes('costo') || norm.includes('caro')) {
      return 'no_interesado_dinero';
    } else if (norm.includes('ubicacion') || norm.includes('ubicación') || norm.includes('lejos') || norm.includes('zona')) {
      return 'no_interesado_ubicacion';
    } else if (defaultStage) {
      return defaultStage;
    }
    return 'no_interesado_otra';
  };

  const handleActionTypeChange = (newType: FollowUpActionType) => {
    setActionType(newType);
    const availableResults = fichaConfig.results[newType] || DEFAULT_QUICK_RESULTS[newType] || [];
    const firstResult = availableResults.length > 0 ? availableResults[0] : '';
    if (firstResult) {
      setResult(firstResult);
    }
    const actionObj = fichaConfig.actions.find((a) => a.id === newType);
    const isNoInt =
      newType === 'no_interesado' ||
      newType.toLowerCase().includes('no_interesado') ||
      newType.toLowerCase().includes('desistimiento') ||
      actionObj?.label?.toLowerCase().includes('no interesado') ||
      actionObj?.label?.toLowerCase().includes('descarte') ||
      false;

    if (isNoInt) {
      setNextAction('Sin Próximo Contacto (No Interesado)');
      setNextDate('');
      const stage = deduceNoInteresadoStage(firstResult, actionObj?.defaultStageId);
      setPipelineStage(stage);
    } else {
      if (actionObj?.defaultStageId) {
        setPipelineStage(actionObj.defaultStageId);
      } else {
        if (newType === 'cita_reunion') {
          setPipelineStage('cita');
        } else if (newType === 'visita_terreno') {
          setPipelineStage('visita_realizada');
        } else if (newType === 'envio_informacion') {
          setPipelineStage('envio_info');
        }
      }
      if (nextAction.includes('No Interesado') || nextAction.includes('Sin Próximo Contacto')) {
        setNextAction('Próxima Llamada de Seguimiento');
      }
    }
    if (newType === 'cita_reunion' || newType === 'visita_terreno') {
      setAttended(true);
    }
  };

  const handleResultChange = (newResult: string) => {
    setResult(newResult);
    if (isNoInteresado) {
      const actionObj = fichaConfig.actions.find((a) => a.id === actionType);
      const stage = deduceNoInteresadoStage(newResult, actionObj?.defaultStageId);
      setPipelineStage(stage);
    }
  };

  const handleNextActionChange = (actionLabel: string, actionId: string) => {
    setNextAction(actionLabel);
    const stepObj = fichaConfig.nextSteps.find((s) => s.id === actionId || s.label === actionLabel);
    if (stepObj?.defaultStageId) {
      setPipelineStage(stepObj.defaultStageId);
    } else {
      if (actionId === 'cierre_pago') setPipelineStage('negociacion');
      else if (actionId === 'enviar_cotizacion') setPipelineStage('cotizacion');
      else if (actionId === 'visita_terreno') setPipelineStage('visita_realizada');
      else if (actionId === 'plan_referidos') setInviteReferralProgram(true);
      else if (actionId === 'desistimiento') {
        setPipelineStage('no_interesado_dinero');
        setNextDate('');
      } else if (actionId === 'sin_proximo_contacto') {
        setNextDate('');
      }
    }

    if (stepObj?.isReferralProgram || actionId === 'plan_referidos') {
      setInviteReferralProgram(true);
    }
    if (
      stepObj?.requiresSchedule === false ||
      stepObj?.isDesistimiento ||
      actionId === 'desistimiento' ||
      actionId === 'sin_proximo_contacto'
    ) {
      setNextDate('');
    }
  };

  const handleDeleteNote = (noteId: string) => {
    if (!isAdmin || !companyId || !targetLeadId) return;
    Alert.alert(
      'Eliminar seguimiento',
      '¿Deseas eliminar este registro de seguimiento del historial? (Acción exclusiva de Administrador)',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setDeletingNoteId(noteId);
            try {
              await deleteLeadNote(companyId, targetLeadId, noteId);
            } catch (err) {
              console.error('[FichaTecnicaModal] delete note error:', err);
            } finally {
              setDeletingNoteId(null);
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    const effectiveNextAction = isNoInteresado
      ? (nextAction && !nextAction.includes('Llamada') && !nextAction.includes('Visita') && !nextAction.includes('Cotización')
          ? nextAction
          : 'Sin Próximo Contacto (No Interesado)')
      : nextAction;

    if (!effectiveNextAction) {
      setError('Por favor selecciona la conclusión o próximo paso.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const formattedNextDate = (!isNoInteresado && nextDate) ? `${nextDate} ${nextTime}` : undefined;

      const STANDARD_ACTION_TYPES = ['envio_informacion', 'llamada', 'cita_reunion', 'visita_terreno', 'seguimiento_general'];
      const safeActionType = (STANDARD_ACTION_TYPES.includes(actionType) ? actionType : 'seguimiento_general') as any;
      const selectedActionObj = fichaConfig.actions.find((a) => a.id === actionType);
      const actionLabelPrefix =
        !STANDARD_ACTION_TYPES.includes(actionType) && selectedActionObj
          ? `[${selectedActionObj.label.toUpperCase()}] `
          : '';

      const finalResult =
        actionLabelPrefix +
        (actionType === 'cita_reunion' || actionType === 'visita_terreno'
          ? attended
            ? 'Asistió'
            : 'No asistió (No-Show)'
          : result);

      const apiRes = await reportAppointmentFicha(companyId, {
        leadId: targetLeadId || undefined,
        appointmentId: appointmentId || undefined,
        actionType: safeActionType,
        result: finalResult,
        attended: actionType === 'cita_reunion' || actionType === 'visita_terreno' ? attended : true,
        nextAction: effectiveNextAction,
        nextActionDate: formattedNextDate,
        notes: notes.trim() || undefined,
        pipelineStage: pipelineStage || undefined,
        inviteReferralProgram: inviteReferralProgram || effectiveNextAction.includes('Plan de Referidos'),
        project: selectedProject || undefined,
      });

      if ((inviteReferralProgram || effectiveNextAction.includes('Plan de Referidos')) && leadPhone && leadPhone !== 'Sin teléfono') {
        const cleanDigits = leadPhone.replace(/\D/g, '');
        if (cleanDigits.length >= 8) {
          const firstName = (leadName || '').trim().split(' ')[0] || 'Hola';
          const projName = selectedProject || leadProject || 'nuestros proyectos campestres';
          const refText = `¡Hola ${firstName}! \u{1F44B} Qué gusto haber conversado contigo sobre ${projName}.\n\nQuiero dejarte una invitación especial: ¿sabías que puedes generar ingresos adicionales con Grupo Constructor Meraki sin comprar lote y sin experiencia en ventas? \u{1F680}\n\nCon nuestro Plan de Referidos, ganas hasta $3.000.000 COP por cada amigo o familiar que recomiendes y adquiera su lote campestre con nosotros:\n\u{2705} Sin límite de referidos.\n\u{2705} Pago directo a tu cuenta tras cumplirse los requisitos de pago.\n\u{2705} Registro 100% online.\n\n\u{1F449} Mira cómo funciona y registra tus referidos en nuestra web oficial:\nhttps://grupoconstructormeraki.com.co/referidos\n\n¡Quedo atento por si tienes a alguien en mente hoy mismo! \u{1F91D}`;
          let targetPhone = cleanDigits;
          if (targetPhone.length === 10 && targetPhone.startsWith('3')) {
            targetPhone = `57${targetPhone}`;
          }
          void Linking.openURL(`https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(refText)}`);
        }
      }

      if (formattedNextDate) {
        setSyncSuccess({
          synced: !!apiRes?.googleSync?.synced,
          directCalendarUrl: apiRes?.googleSync?.directCalendarUrl,
          title: `${actionType === 'visita_terreno' ? '📍 Visita a Terreno' : '📅 Cita / Reunión'}: ${effectiveNextAction} - ${leadName}`,
          dateStr: formattedNextDate,
          leadName,
          actionLabel: effectiveNextAction,
        });
        onSuccess?.();
      } else {
        onSuccess?.();
        onClose();
      }
    } catch (err: any) {
      let msg = err?.message || 'No se pudo guardar la ficha técnica.';
      if (typeof msg === 'string') {
        if (msg.includes('invalid-argument')) msg = msg.replace(/^.*invalid-argument[:\s]*/i, '');
        else if (msg === 'INTERNAL' || err?.code === 'functions/internal') {
          msg = 'No se pudo registrar la ficha en el servidor. Verifica los campos obligatorios e inténtalo de nuevo.';
        }
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const isConcludedChoice =
    nextAction.includes('Desistimiento') ||
    nextAction.includes('Sin Próximo Contacto') ||
    nextAction.includes('Plan de Referidos') ||
    pipelineStage.startsWith('no_interesado');

  const pipelineOptions = [
    { value: '', label: 'Mantener etapa actual / Auto-deducir según gestión' },
    ...PIPELINE_STAGES.map((s) => ({
      value: s.id,
      label: `${s.label} (${s.probabilityLabel})`,
      group: `Fase ${s.group.toUpperCase()}`,
    })),
  ];

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      {syncSuccess ? (
        <View style={[styles.successScreen, { backgroundColor: palette.bgCanvas, paddingTop: insets.top + 20 }]}>
          <View style={[styles.successCard, { backgroundColor: palette.bgCard, borderColor: palette.emeraldBorder }]}>
            <View style={[styles.successIconWrap, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
              <Icon name="Check" size={30} color={palette.emerald} />
            </View>
            <Text style={[styles.successTitle, { color: palette.textPrimary }]}>¡Gestión Registrada con Éxito!</Text>
            <Text style={[styles.successSub, { color: palette.textMuted }]}>
              Ficha técnica y bitácora guardadas para <Text style={{ color: palette.textPrimary, fontWeight: '700' }}>{syncSuccess.leadName}</Text>.
            </Text>

            <View style={[styles.syncInfoBox, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
              <View style={styles.rowCenter}>
                <Icon name="Calendar" size={15} color={syncSuccess.synced ? palette.emerald : palette.amber} />
                <Text style={[styles.syncBoxTitle, { color: palette.textPrimary }]} numberOfLines={2}>
                  {syncSuccess.title}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 4 }}>
                📅 Programado para: <Text style={{ color: palette.textPrimary, fontWeight: '700' }}>{syncSuccess.dateStr}</Text>
              </Text>
              <View
                style={[
                  styles.syncAlertBox,
                  {
                    backgroundColor: syncSuccess.synced ? palette.emeraldBg : palette.amberBg,
                    borderColor: syncSuccess.synced ? palette.emeraldBorder : palette.amberBorder,
                  },
                ]}
              >
                <Text style={{ fontSize: 11, color: syncSuccess.synced ? palette.emeraldText : palette.amberText, lineHeight: 16 }}>
                  {syncSuccess.synced
                    ? '🔔 Sincronizado con Google Calendar: Se creó el evento en tu calendario y sonará en tu celular.'
                    : '⏰ Recordatorio agendado en CRM: Abre Google Calendar o comparte la invitación .ics abajo.'}
                </Text>
              </View>
            </View>

            <View style={{ width: '100%', gap: 8, marginTop: 8 }}>
              {syncSuccess.directCalendarUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(syncSuccess.directCalendarUrl!)}
                  style={[styles.actionFullBtn, { backgroundColor: '#2563eb' }]}
                >
                  <Icon name="ExternalLink" size={14} color="#ffffff" />
                  <Text style={styles.actionFullBtnText}>Abrir en Google Calendar</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => {
                  const parts = syncSuccess.dateStr.split(' ');
                  const d = new Date(`${parts[0]}T${parts[1] || '10:00'}:00-05:00`);
                  void shareIcsInvitation({
                    title: syncSuccess.title,
                    description: `Seguimiento comercial con ${syncSuccess.leadName}. Agendado desde CRM Meraki.`,
                    location: leadProject,
                    startDate: isNaN(d.getTime()) ? new Date() : d,
                    durationMinutes: syncSuccess.title.includes('Visita') ? 120 : 45,
                  });
                }}
                style={[styles.actionFullBtn, { backgroundColor: palette.bgElevated, borderWidth: 1, borderColor: palette.borderStrong }]}
              >
                <Icon name="Download" size={14} color={palette.textPrimary} />
                <Text style={[styles.actionFullBtnText, { color: palette.textPrimary }]}>Descargar Invitación .ics para Celular</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSyncSuccess(null);
                  onClose();
                }}
                style={[styles.actionFullBtn, { backgroundColor: palette.emerald }]}
              >
                <Text style={styles.actionFullBtnText}>Listo / Continuar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={[styles.container, { backgroundColor: palette.bgCanvas }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Top Header */}
          <View
            style={[
              styles.header,
              {
                backgroundColor: palette.bgCard,
                borderBottomColor: palette.border,
                paddingTop: Math.max(insets.top + 8, 14),
              },
            ]}
          >
            <Text style={[styles.headerTitle, { color: palette.textPrimary }]} numberOfLines={1}>
              📋 Ficha Técnica & Seguimiento
            </Text>
            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: palette.bgElevated }]}
              hitSlop={10}
            >
              <Icon name="X" size={16} color={palette.textSecondary} />
            </Pressable>
          </View>

          {/* Lead Summary Bar */}
          <View style={[styles.summaryBar, { backgroundColor: palette.bgCardSoft, borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowCenter}>
                <Text style={[styles.leadName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {leadName}
                </Text>
                {appointmentId ? (
                  <View style={[styles.citaBadge, { backgroundColor: palette.skyBg, borderColor: palette.skyBorder }]}>
                    <Text style={{ fontSize: 10, color: palette.skyText, fontWeight: '700' }}>Cita Calendario</Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.rowCenter, { marginTop: 4, flexWrap: 'wrap', gap: 6 }]}>
                <Text style={{ fontSize: 11, color: palette.textMuted }}>
                  📞 {leadPhone}
                </Text>
                <Text style={{ fontSize: 11, color: palette.textSubtle }}>•</Text>
                <View style={{ minWidth: 120 }}>
                  <SelectModal
                    value={selectedProject}
                    options={projectOptions}
                    onChange={handleProjectChange}
                    compact
                    title="Actualizar Proyecto"
                    icon="Building2"
                  />
                </View>
              </View>
            </View>
            <View style={[styles.advisorBox, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
              <Text style={[styles.advisorLabel, { color: palette.textSubtle }]}>ASESOR</Text>
              <Text style={[styles.advisorVal, { color: palette.emeraldText }]} numberOfLines={1}>
                {advisorName}
              </Text>
            </View>
          </View>

          {/* Tabs: Diligenciar Ficha vs Historial */}
          <View style={[styles.tabsRow, { backgroundColor: palette.bgCard, borderBottomColor: palette.border }]}>
            <Pressable
              onPress={() => setActiveTab('form')}
              style={[
                styles.tabBtn,
                activeTab === 'form' && { borderBottomColor: palette.emerald, backgroundColor: palette.emeraldBg },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'form' ? palette.emeraldText : palette.textMuted },
                ]}
              >
                📝 Diligenciar Ficha
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('history')}
              style={[
                styles.tabBtn,
                activeTab === 'history' && { borderBottomColor: palette.emerald, backgroundColor: palette.emeraldBg },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'history' ? palette.emeraldText : palette.textMuted },
                ]}
              >
                📜 Historial {totalFollowUpsCount > 0 ? `(${totalFollowUpsCount})` : ''}
              </Text>
            </Pressable>
          </View>

          {/* Scrollable Body */}
          <ScrollView
            ref={scrollViewRef}
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.scrollContent,
              activeTab === 'form' && {
                paddingBottom: keyboardHeight > 0 ? keyboardHeight + 160 : 320,
              },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 'form' ? (
              <>
                {lastFollowUpSummary && (
                  <View style={[styles.lastBanner, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: palette.emeraldText, textTransform: 'uppercase' }}>
                        🕒 Último Seguimiento Realizado
                      </Text>
                      <Text style={{ fontSize: 12, color: palette.textPrimary, marginTop: 2 }}>
                        <Text style={{ fontWeight: '700', color: palette.emeraldText }}>{lastFollowUpSummary.title}</Text>
                        {lastFollowUpSummary.result ? ` (${lastFollowUpSummary.result})` : ''}
                        <Text style={{ color: palette.textSubtle, fontSize: 11 }}>
                          {' '}· {lastFollowUpSummary.author} ({lastFollowUpSummary.date})
                        </Text>
                      </Text>
                      {lastFollowUpSummary.next ? (
                        <Text style={{ fontSize: 11, color: palette.amberText, marginTop: 3, fontWeight: '600' }}>
                          🎯 Próximo paso previo: {lastFollowUpSummary.next}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => setActiveTab('history')}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                        Ver ({totalFollowUpsCount}) →
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Selector de Proyecto de Interés */}
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                    PROYECTO DE INTERÉS
                  </Text>
                  <SelectModal
                    value={selectedProject}
                    options={projectOptions}
                    onChange={handleProjectChange}
                    title="Seleccionar Proyecto de Interés"
                    icon="Building2"
                  />
                </View>

                {/* 1. Tipo de Gestión */}
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                    1. ¿QUÉ GESTIÓN REALIZASTE CON ESTE PROSPECTO?
                  </Text>
                  <View style={styles.grid2}>
                    {fichaConfig.actions
                      .filter((opt) => opt.active !== false)
                      .map((opt, idx, arr) => {
                        const selected = actionType === opt.id;
                        const fullRow = idx === arr.length - 1 && arr.length % 2 === 1;
                        return (
                          <Pressable
                            key={opt.id}
                            onPress={() => handleActionTypeChange(opt.id)}
                            style={[
                              styles.actionCard,
                              fullRow ? { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 } : { width: '48.5%' },
                              {
                                backgroundColor: selected ? palette.emeraldBg : palette.bgCard,
                                borderColor: selected ? palette.emerald : palette.border,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 16 }}>{opt.icon}</Text>
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: '700',
                                color: selected ? palette.emeraldText : palette.textSecondary,
                                flexShrink: 1,
                              }}
                            >
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </View>
                </View>

                {/* 2. Resultado */}
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>2. RESULTADO DE LA GESTIÓN</Text>
                  {actionType === 'cita_reunion' || actionType === 'visita_terreno' ? (
                    <View style={styles.rowGap}>
                      <Pressable
                        onPress={() => setAttended(true)}
                        style={[
                          styles.attendBtn,
                          {
                            backgroundColor: attended ? palette.emeraldBg : palette.bgCard,
                            borderColor: attended ? palette.emerald : palette.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '800', color: attended ? palette.emeraldText : palette.textMuted }}>
                          ✓ SÍ ASISTIÓ
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setAttended(false)}
                        style={[
                          styles.attendBtn,
                          {
                            backgroundColor: !attended ? palette.roseBg : palette.bgCard,
                            borderColor: !attended ? palette.rose : palette.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '800', color: !attended ? palette.roseText : palette.textMuted }}>
                          ✕ NO ASISTIÓ
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ gap: 6 }}>
                      {(fichaConfig.results[actionType] || DEFAULT_QUICK_RESULTS[actionType] || [result]).map((qRes) => {
                        const selected = result === qRes;
                        return (
                          <Pressable
                            key={qRes}
                            onPress={() => handleResultChange(qRes)}
                            style={[
                              styles.quickResultRow,
                              {
                                backgroundColor: selected ? palette.emeraldBg : palette.bgCard,
                                borderColor: selected ? palette.emerald : palette.border,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: selected ? '700' : '500',
                                color: selected ? palette.emeraldText : palette.textSecondary,
                              }}
                            >
                              • {qRes}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>

                {isNoInteresado ? (
                  <View style={[styles.concludedCard, { backgroundColor: palette.bgCard, borderColor: palette.roseBorder || palette.border, marginBottom: 12 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.roseText || palette.rose }}>
                      🛑 Sin Próximo Contacto (Caso Concluido / Descarte)
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 4, lineHeight: 16 }}>
                      Al registrar como no interesado, no se requiere próximo paso comercial ni fecha de agendamiento. El prospecto se archivará en la etapa No Interesado del embudo sin tareas pendientes.
                    </Text>
                  </View>
                ) : (
                  <>

                {/* 3. Conclusión y Próximo Paso */}
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                    3. CONCLUSIÓN & PRÓXIMO PASO COMERCIAL
                  </Text>
                  <View style={{ gap: 6, marginBottom: 10 }}>
                    {fichaConfig.nextSteps
                      .filter((opt) => opt.active !== false)
                      .map((opt) => {
                        const selected = nextAction === opt.label;
                        return (
                          <Pressable
                            key={opt.id}
                            onPress={() => handleNextActionChange(opt.label, opt.id)}
                            style={[
                              styles.nextOptRow,
                              {
                                backgroundColor: selected ? palette.amberBg : palette.bgCard,
                                borderColor: selected ? palette.brand : palette.border,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: selected ? '700' : '500',
                                color: selected ? palette.brandText : palette.textSecondary,
                                flex: 1,
                              }}
                            >
                              {opt.icon} {opt.label}
                            </Text>
                            {selected && <Text style={{ color: palette.brand, fontSize: 12 }}>●</Text>}
                          </Pressable>
                        );
                      })}
                  </View>

                  {isConcludedChoice ? (
                    <View style={{ gap: 8 }}>
                      <View style={[styles.concludedCard, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: palette.textPrimary }}>
                          🛑 Sin Próximo Contacto (Caso Concluido / Descarte)
                        </Text>
                        <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 4, lineHeight: 16 }}>
                          No se programará recordatorio a futuro. La ficha quedará guardada en la bitácora y el prospecto avanzará en el embudo sin tareas pendientes.
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => setInviteReferralProgram((v) => !v)}
                        style={[
                          styles.referralCard,
                          { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                        ]}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: palette.emerald,
                              backgroundColor:
                                inviteReferralProgram || nextAction.includes('Plan de Referidos')
                                  ? palette.emerald
                                  : 'transparent',
                            },
                          ]}
                        >
                          {(inviteReferralProgram || nextAction.includes('Plan de Referidos')) && (
                            <Icon name="Check" size={12} color="#ffffff" />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: palette.emeraldText }}>
                            🎁 Invitar al Plan de Referidos Meraki ($3.000.000 COP)
                          </Text>
                          <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 3, lineHeight: 15 }}>
                            Se etiquetará como Plan de Referidos y se abrirá WhatsApp con el mensaje oficial para que refiera amigos o familiares.
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={[styles.scheduleCard, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
                      <View style={styles.rowBetween}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.brandText }}>
                          ⏰ AGENDAR PRÓXIMO CONTACTO (OPCIONAL)
                        </Text>
                        {nextDate ? (
                          <Pressable onPress={() => setNextDate('')}>
                            <Text style={{ fontSize: 10, color: palette.roseText, fontWeight: '600' }}>✕ Quitar</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      <Text style={{ fontSize: 10, color: palette.textSubtle, marginTop: 6 }}>Fecha rápida:</Text>
                      <View style={styles.wrapRow}>
                        {DATE_PRESETS.map((p) => {
                          const val = p.getVal();
                          const selected = nextDate === val;
                          return (
                            <Pressable
                              key={p.id}
                              onPress={() => setNextDate(val)}
                              style={[
                                styles.presetChip,
                                {
                                  backgroundColor: selected ? palette.brandSoft : palette.bgElevated,
                                  borderColor: selected ? palette.brand : palette.borderStrong,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: selected ? '700' : '500',
                                  color: selected ? palette.brandText : palette.textSecondary,
                                }}
                              >
                                {p.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={{ fontSize: 10, color: palette.textSubtle, marginTop: 8 }}>Hora habitual:</Text>
                      <View style={styles.wrapRow}>
                        {TIME_PRESETS.map((t) => {
                          const selected = nextTime === t.value;
                          return (
                            <Pressable
                              key={t.value}
                              onPress={() => setNextTime(t.value)}
                              style={[
                                styles.presetChip,
                                {
                                  backgroundColor: selected ? palette.brandSoft : palette.bgElevated,
                                  borderColor: selected ? palette.brand : palette.borderStrong,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: selected ? '700' : '500',
                                  color: selected ? palette.brandText : palette.textSecondary,
                                }}
                              >
                                {t.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {/* Selectores interactivos de Fecha y Hora (Toca para seleccionar sin teclado) */}
                      <View style={[styles.rowGap, { marginTop: 10 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 10, color: palette.textSubtle, marginBottom: 4, fontWeight: '600' }}>
                            Fecha de seguimiento:
                          </Text>
                          <Pressable
                            onPress={() => setShowDatePicker(true)}
                            style={[
                              styles.pickerTriggerBtn,
                              {
                                backgroundColor: palette.bgInput,
                                borderColor: nextDate ? '#10b981' : palette.borderInput,
                              },
                            ]}
                          >
                            <Icon name="Calendar" size={14} color={nextDate ? '#10b981' : palette.textMuted} />
                            <Text
                              style={[
                                styles.pickerTriggerText,
                                { color: nextDate ? palette.textPrimary : palette.placeholder },
                                nextDate ? { fontWeight: '700' } : null,
                              ]}
                              numberOfLines={1}
                            >
                              {nextDate ? formatDisplayDate(nextDate) : 'Elegir fecha...'}
                            </Text>
                          </Pressable>
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 10, color: palette.textSubtle, marginBottom: 4, fontWeight: '600' }}>
                            Hora de contacto:
                          </Text>
                          <Pressable
                            onPress={() => setShowTimePicker(true)}
                            style={[
                              styles.pickerTriggerBtn,
                              {
                                backgroundColor: palette.bgInput,
                                borderColor: nextTime ? '#10b981' : palette.borderInput,
                              },
                            ]}
                          >
                            <Icon name="Clock" size={14} color={nextTime ? '#10b981' : palette.textMuted} />
                            <Text
                              style={[
                                styles.pickerTriggerText,
                                { color: nextTime ? palette.textPrimary : palette.placeholder },
                                nextTime ? { fontWeight: '700' } : null,
                              ]}
                              numberOfLines={1}
                            >
                              {nextTime ? formatDisplayTime(nextTime) : 'Elegir hora...'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>

                      {/* Modales de selección interactiva nativa */}
                      <DatePickerModal
                        visible={showDatePicker}
                        value={nextDate}
                        onClose={() => setShowDatePicker(false)}
                        onSelect={(ymd) => setNextDate(ymd)}
                        title="Seleccionar Fecha de Seguimiento"
                      />
                      <TimePickerModal
                        visible={showTimePicker}
                        value={nextTime}
                        onClose={() => setShowTimePicker(false)}
                        onSelect={(t) => setNextTime(t)}
                        title="Seleccionar Hora de Contacto"
                      />

                      {nextDate ? (
                        <View style={[styles.previewBadge, { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }]}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: palette.amberText }}>
                            🔔 Agendado para: {formatFriendlySchedule(nextDate, nextTime)}
                          </Text>
                          <Text style={{ fontSize: 10, color: palette.textMuted, marginTop: 2 }}>
                            📅 Sincronización automática con Google Calendar
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>

                {/* 5. Etapa en el Embudo */}
                <View style={styles.section}>
                  <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                    5. ETAPA EN EL EMBUDO COMERCIAL (PIPELINE)
                  </Text>
                  <SelectModal
                    value={pipelineStage}
                    options={pipelineOptions}
                    onChange={setPipelineStage}
                    title="Seleccionar etapa del embudo"
                  />
                </View>
              </>
            )}

            {/* 6. Observaciones */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                {isNoInteresado ? '3. OBSERVACIONES / COMENTARIOS (OPCIONAL)' : '6. RESUMEN DE LA CONVERSACIÓN (BITÁCORA)'}
              </Text>
              <TextInput
                multiline
                numberOfLines={4}
                value={notes}
                onChangeText={setNotes}
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 250);
                }}
                placeholder={
                  isNoInteresado
                    ? 'Escribe notas adicionales sobre la respuesta del prospecto (opcional)...'
                    : 'Escribe los acuerdos clave, presupuesto, dudas del cliente, terreno de interés...'
                }
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.textArea,
                  {
                    backgroundColor: palette.bgInput,
                    borderColor: palette.borderInput,
                    color: palette.textPrimary,
                    minHeight: 110,
                  },
                ]}
              />
            </View>
          </>
        ) : (
              /* Pestaña Historial */
              <View style={{ gap: 12 }}>
                <View style={styles.rowBetween}>
                  <Text style={{ fontSize: 12, color: palette.textSubtle }}>
                    Historial de seguimientos del CRM
                  </Text>
                  <Pressable
                    onPress={() => setActiveTab('form')}
                    style={[styles.pickBtn, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>+ Nueva Ficha</Text>
                  </Pressable>
                </View>

                {totalFollowUpsCount === 0 ? (
                  <View style={styles.emptyHistory}>
                    <Text style={{ fontSize: 28 }}>📜</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textSecondary, marginTop: 6 }}>
                      No hay seguimientos registrados aún
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textSubtle, textAlign: 'center', marginTop: 4 }}>
                      Registra una nueva gestión diligenciando la Ficha Técnica oficial.
                    </Text>
                  </View>
                ) : (
                  <>
                    {fichaNotes.map((n) => {
                      const aType = n.actionType || 'seguimiento_general';
                      const opt =
                        fichaConfig.actions.find((o) => o.id === aType) ||
                        ALL_ACTION_DISPLAY.find((o) => o.id === aType);
                      return (
                        <View
                          key={n.id}
                          style={[styles.historyCard, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
                        >
                          <View style={styles.rowBetween}>
                            <View style={[styles.wrapRow, { flex: 1 }]}>
                              <View style={[styles.presetChip, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.brandText }}>
                                  {opt?.icon || '💬'} {opt?.label || 'Seguimiento'}
                                </Text>
                              </View>
                              {n.result ? (
                                <View style={[styles.presetChip, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}>
                                  <Text style={{ fontSize: 10, color: palette.textSecondary }}>{n.result}</Text>
                                </View>
                              ) : null}
                            </View>
                            {isAdmin && (
                              <Pressable
                                onPress={() => handleDeleteNote(n.id)}
                                disabled={deletingNoteId === n.id}
                                hitSlop={8}
                              >
                                <Icon name="Trash2" size={14} color={palette.roseText} />
                              </Pressable>
                            )}
                          </View>

                          <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 4 }}>
                            <Text style={{ fontWeight: '700', color: palette.textSecondary }}>{n.authorName}</Text>
                            {n.createdAt ? ` · ${formatFullDateTimeSafe(n.createdAt)}` : ''}
                          </Text>

                          {n.text ? (
                            <View style={[styles.noteBodyBox, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: palette.textMuted, marginBottom: 2 }}>
                                📝 Resumen de la Conversación (Bitácora):
                              </Text>
                              <Text style={{ fontSize: 12, color: palette.textPrimary, lineHeight: 17 }}>
                                {n.text.replace(/^📋 FICHA TÉCNICA[^\n]*\n?/i, '')}
                              </Text>
                            </View>
                          ) : null}

                          {n.nextAction ? (
                            <View style={[styles.previewBadge, { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }]}>
                              <Text style={{ fontSize: 11, color: palette.amberText }}>
                                🎯 Próximo Paso: <Text style={{ fontWeight: '700' }}>{n.nextAction}</Text>
                                {n.nextActionDate ? ` · 📅 ${n.nextActionDate}` : ''}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          {/* Sticky Footer */}
          {activeTab === 'form' && (
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: palette.bgCard,
                  borderTopColor: palette.border,
                  paddingBottom: Math.max(insets.bottom + 8, 12),
                },
              ]}
            >
              {error ? (
                <View style={[styles.errorBox, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}>
                  <Text style={{ fontSize: 11, color: palette.roseText, fontWeight: '600' }}>⚠️ {error}</Text>
                </View>
              ) : null}
              <Pressable
                disabled={saving}
                onPress={handleSave}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: isNoInteresado ? palette.rose : palette.emerald,
                    opacity: saving ? 0.6 : 1,
                  },
                ]}
              >
                {saving ? (
                  <>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.saveBtnText}>
                      {isNoInteresado ? 'Guardando Descarte...' : 'Guardando Ficha y Programando...'}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.saveBtnText}>
                    {isNoInteresado ? '🛑 Guardar Ficha & Registrar Descarte' : '💾 Guardar Ficha & Registrar en Bitácora'}
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  leadName: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  citaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 6,
  },
  advisorBox: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 130,
  },
  advisorLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  advisorVal: { fontSize: 11, fontWeight: '700' },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 12, fontWeight: '700' },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 28 },
  lastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  section: { gap: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginBottom: 4 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  actionCard: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  attendBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  quickResultRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  evidenceBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 14,
  },
  evidenceImg: { width: 220, height: 130, borderRadius: 10 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  nextOptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  concludedCard: { padding: 12, borderRadius: 14, borderWidth: 1 },
  referralCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  scheduleCard: { padding: 12, borderRadius: 14, borderWidth: 1 },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  smallInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  pickerTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 42,
  },
  pickerTriggerText: {
    flex: 1,
    fontSize: 12,
  },
  previewBadge: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 82,
    fontSize: 12,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  errorBox: { padding: 10, borderRadius: 10, borderWidth: 1 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  saveBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  emptyHistory: { paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 },
  historyCard: { padding: 12, borderRadius: 14, borderWidth: 1 },
  noteBodyBox: { marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  historyThumb: { width: 110, height: 80, borderRadius: 10 },
  successScreen: { flex: 1, paddingHorizontal: 20, justifyContent: 'center' },
  successCard: { padding: 22, borderRadius: 22, borderWidth: 1, alignItems: 'center', gap: 10 },
  successIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  successSub: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  syncInfoBox: { width: '100%', padding: 14, borderRadius: 16, borderWidth: 1, marginTop: 4 },
  syncBoxTitle: { fontSize: 12, fontWeight: '700', flex: 1 },
  syncAlertBox: { marginTop: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  actionFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 12,
  },
  actionFullBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  lightboxImg: { width: '100%', height: '82%' },
  lightboxClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    backgroundColor: 'rgba(24,24,27,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
