import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import firestore from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useLibrary } from '../hooks/useLibrary';
import type { MerakiThemePalette } from '../theme/colors';
import {
  isAdminRole,
  type Lead,
  type LeadSourceMeta,
  type LibraryItem,
  type Message,
  type RootStackParams,
  type WhatsAppTemplate,
} from '../types';
import { isWindowOpen, windowClosedAgo, windowTimeLeft } from '../utils/conversationWindow';
import { formatPhone } from '../utils/formatPhone';
import {
  listTemplates,
  markLeadRead,
  sendMessage,
  setLeadAi,
  uploadMedia,
  type LocalFile,
  type UploadedMedia,
} from '../services/crm';
import {
  getMyMessagingLine,
  listAdvisors,
  listMessagingLines,
  reactToMessage,
  sendTemplateMessageWithLine,
  type Advisor,
  type MessagingLine,
} from '../services/enterprise';
import {
  listAdvisorWhatsappConnections,
  type AdvisorWhatsappStatus,
} from '../services/advisorWhatsapp';
import {
  fetchPlanosIndex,
  isPlanoItem,
  normalizeProjectName,
  planoItemId,
  planoToLibraryItem,
  timeAgo,
  type PlanoIndexItem,
} from '../services/planos';
import { LeadScoreBadge, LeadStatusBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import { Icon } from '../components/Icon';
import { LeadDrawerModal } from '../components/LeadDrawerModal';
import { StandaloneBottomNavBar } from '../components/StandaloneBottomNavBar';

type Props = NativeStackScreenProps<RootStackParams, 'Chat'>;
type DeliveryChannel = 'company_whatsapp' | 'advisor_whatsapp';
type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

const MESSAGES_PAGE_SIZE = 50;
const LONG_MESSAGE_THRESHOLD = 600;
const WAVEFORM_BARS = 30;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
const UNSUPPORTED_LABEL =
  '⚠️ El cliente envió un mensaje no compatible. Pídele que lo reenvíe como texto o archivo.';

const INBOX_NAMES: Record<string, string> = {
  '+573148209662': 'sistemas meraki',
  '+573176820728': 'Ventas 317',
  '+573232094057': 'WhatsApp Angelica',
};

const CANONICAL_PROJECT_ORDER = [
  'Laguna Mar',
  'Río Claro',
  'Sobre Montañas',
  'Sobre Montañas (Alvarado)',
  'Cañón de Arizona',
  'Llano Grande',
  'Proyectos de Ibagué',
];

const NO_PROJECT = 'Otros documentos';

const functionsInstance = getFunctions(undefined, 'us-central1');

interface MetaAdCreative {
  adId: string;
  name?: string;
  headline?: string;
  body?: string;
  mediaType: 'video' | 'image' | 'unknown';
  videoUrl?: string;
  imageUrl?: string;
  sourceUrl?: string;
}

type EnrichedMessage = Message & {
  twilioMessageSid?: string;
  wamid?: string;
  failureCode?: string | number;
  failureReason?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros (fechas, teléfonos, banderas, SLA, ventana, errores Meta)
// ─────────────────────────────────────────────────────────────────────────────

function snapExists(snap: { exists: boolean | (() => boolean) }): boolean {
  return typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
}

function toMillisSafe(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
  if (typeof ts === 'string') {
    const parsed = new Date(ts.trim().replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof ts === 'object') {
    const obj = ts as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.toDate === 'function') return obj.toDate().getTime();
    const sec = obj.seconds ?? obj._seconds;
    if (typeof sec === 'number') return sec * 1000;
  }
  return 0;
}

function digitsOnly(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return '';
  const formatted = formatPhone(phone);
  const m = formatted.match(/^\+57(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+57 ${m[1]} ${m[2]} ${m[3]}`;
  return formatted;
}

function getCountryFlag(phone?: string | null): string {
  if (!phone) return '💬';
  const clean = phone.trim().replace(/\s+/g, '');
  const d = clean.startsWith('+') ? clean.slice(1) : clean;
  if (d.startsWith('57')) return '🇨🇴';
  if (d.startsWith('52')) return '🇲🇽';
  if (d.startsWith('56')) return '🇨🇱';
  if (d.startsWith('54')) return '🇦🇷';
  if (d.startsWith('51')) return '🇵🇪';
  if (d.startsWith('593')) return '🇪🇨';
  if (d.startsWith('507')) return '🇵🇦';
  if (d.startsWith('506')) return '🇨🇷';
  if (d.startsWith('58')) return '🇻🇪';
  if (d.startsWith('34')) return '🇪🇸';
  if (d.startsWith('1')) return '🇺🇸';
  if (d.startsWith('44')) return '🇬🇧';
  if (d.startsWith('33')) return '🇫🇷';
  if (d.startsWith('49')) return '🇩🇪';
  if (d.startsWith('39')) return '🇮🇹';
  if (d.startsWith('55')) return '🇧🇷';
  return '🌎';
}

function inboxLabel(inboxId?: string | null): string {
  if (!inboxId) return 'Ventas 317';
  const normalized = formatPhone(inboxId);
  return INBOX_NAMES[normalized] ?? INBOX_NAMES[inboxId] ?? formatDisplayPhone(inboxId);
}

function channelBadgeInfo(channel?: Lead['channel']): { icon: string; label: string } | null {
  if (channel === 'messenger') return { icon: '💬', label: 'Messenger' };
  if (channel === 'instagram') return { icon: '📷', label: 'Instagram' };
  return null;
}

function formatChatTimestamp(ts: unknown): string {
  const ms = toMillisSafe(ts);
  if (!ms) return '';
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDurationMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
  const secs = Math.floor(totalSeconds);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatAudioClock(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface ManualTakeoverSlaInfo {
  status: 'compliant' | 'pending' | 'overdue';
  hoursLeft: number;
  minsLeft: number;
  label: string;
}

function getManualTakeoverSlaInfo(lead: Lead): ManualTakeoverSlaInfo | null {
  if (lead.aiEnabled) return null;

  const rawLead = lead as unknown as Record<string, unknown>;

  // Si fue marcado explícitamente como compliant o exento en base de datos
  if (lead.aiTakeoverSlaStatus === 'compliant' || (rawLead.aiTakeoverSlaStatus === 'exempt')) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
    };
  }

  const disabledMillis =
    toMillisSafe(rawLead.aiDisabledAt) ||
    toMillisSafe(lead.aiPausedAt) ||
    0;

  const lastFollowUpMillis =
    toMillisSafe(lead.lastFollowUpAt) ||
    toMillisSafe(lead.lastFichaAt) ||
    0;

  // Requisito estricto: Debe existir seguimiento/ficha técnica previa registrada.
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
    };
  }

  // Exención de históricos anteriores a hoy:
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();
  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '● Modo manual',
    };
  }

  const baseTime = disabledMillis;
  const deadlineMillis = baseTime + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || rawLead.aiTakeoverSlaStatus === 'overdue') {
    return {
      status: 'overdue',
      hoursLeft: 0,
      minsLeft: 0,
      label: '🚨 SLA 24h vencido tras apagar IA — Llenar Ficha Técnica ahora',
    };
  }

  const hoursLeft = Math.floor(diffMs / 3600_000);
  const minsLeft = Math.floor((diffMs % 3600_000) / 60_000);

  return {
    status: 'pending',
    hoursLeft,
    minsLeft,
    label: `⏳ Toma manual: ${hoursLeft}h ${minsLeft}m restantes para registrar Ficha o Cita`,
  };
}

function friendlyFailureReason(code?: string | number, rawReason?: string): string | undefined {
  const key = code !== undefined && code !== null ? String(code).trim() : '';
  switch (key) {
    case '131000':
      return 'Error temporal de WhatsApp (Meta) al entregar a este contacto. Reintenta en unos minutos; si sigue fallando, el teléfono del cliente puede estar sin conexión o haber bloqueado el número.';
    case '131016':
      return 'El servicio de WhatsApp (Meta) no está disponible en este momento. Reintenta en unos minutos.';
    case '131056':
      return 'Se enviaron demasiados mensajes seguidos a este contacto. Espera un momento antes de reintentar.';
    case '131049':
      return 'Meta bloqueó el envío por su límite de mensajes de marketing a este contacto. Usa una plantilla de Utilidad o espera respuesta del cliente.';
    case '131047':
      return 'Pasaron más de 24 h sin respuesta del cliente. Solo se pueden enviar plantillas pre-aprobadas por Meta.';
    case '131026':
      return 'El mensaje no se pudo entregar (el número puede no tener WhatsApp activo o no acepta mensajes de empresas).';
    case '132000':
    case '132001':
      return 'La plantilla no coincide con el formato aprobado por Meta (revisa variables o idioma).';
    case '470':
    case '131050':
      return 'El contacto no permite recibir mensajes de marketing de esta empresa.';
    case '131051':
      return 'Tipo de mensaje o archivo multimedia no compatible con el canal del destinatario.';
    case '131031':
      return 'La cuenta comercial de WhatsApp tiene una restricción temporal en Meta.';
    case '130472':
      return 'El número del usuario forma parte de un experimento de Meta y no recibió el mensaje.';
    default:
      return rawReason?.trim() || undefined;
  }
}

function isPlayableVideoUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  if (
    clean.includes('facebook.com/story.php') ||
    clean.includes('facebook.com/watch') ||
    clean.includes('facebook.com/posts') ||
    clean.includes('fb.me/') ||
    clean.includes('instagram.com/p/') ||
    clean.includes('instagram.com/reel/')
  ) {
    return false;
  }
  return (
    clean.includes('.mp4') ||
    clean.includes('.webm') ||
    clean.includes('.mov') ||
    clean.includes('/m366/') ||
    clean.includes('fbcdn.net')
  );
}

function asNonEmptyString(val: unknown): string | undefined {
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

function inferMediaTypeFromUrl(data: Record<string, unknown>, mediaUrl?: string): string | undefined {
  const mediaKind = asNonEmptyString(data.mediaKind);
  if (mediaKind === 'sticker') return 'image/webp';
  if (mediaKind === 'image') return 'image/jpeg';
  if (mediaKind === 'video') return 'video/mp4';
  if (mediaKind === 'audio') return 'audio/mp4';
  if (mediaKind === 'document') return 'application/pdf';

  const pathname = mediaUrl ? decodeURIComponent(mediaUrl.split('?')[0]).toLowerCase() : '';
  if (/\.(jpe?g|png|gif|webp)$/.test(pathname)) {
    return pathname.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  }
  if (/\.(mp4|3gp|mov|m4v|webm)$/.test(pathname)) return 'video/mp4';
  if (/\.(mp3|mpeg|ogg|oga|m4a|aac|wav|opus)$/.test(pathname)) return 'audio/mp4';
  if (/\.pdf$/.test(pathname)) return 'application/pdf';
  return undefined;
}

function normalizeFirestoreMessage(id: string, raw: Record<string, unknown>): EnrichedMessage {
  const mediaUrl =
    asNonEmptyString(raw.mediaUrl) ??
    asNonEmptyString(raw.mediaURL) ??
    asNonEmptyString(raw.media_url) ??
    asNonEmptyString(raw.downloadUrl) ??
    asNonEmptyString(raw.downloadURL) ??
    asNonEmptyString(raw.url);

  const mediaType =
    asNonEmptyString(raw.mediaType) ??
    asNonEmptyString(raw.mimeType) ??
    asNonEmptyString(raw.mime_type) ??
    asNonEmptyString(raw.contentType) ??
    inferMediaTypeFromUrl(raw, mediaUrl);

  const rawContent = raw.content === '[unsupported]' ? UNSUPPORTED_LABEL : raw.content;

  return {
    ...(raw as unknown as EnrichedMessage),
    id,
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaType ? { mediaType } : {}),
    content: typeof rawContent === 'string' ? rawContent : '',
  };
}

function buildRouteLabel(
  message: EnrichedMessage,
  companyLineLabel: string,
  companyLinePhone?: string | null,
  advisorWhatsappPhone?: string | null
): { isAdvisorWhatsapp: boolean; text: string } {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const deliveryChannel = asNonEmptyString(meta.deliveryChannel);
  const origin = asNonEmptyString(meta.origin);
  const businessPhone = asNonEmptyString(meta.businessPhone) ?? companyLinePhone ?? undefined;
  const advisorPhone = asNonEmptyString(meta.advisorPhone) ?? advisorWhatsappPhone ?? undefined;
  const isAdvisorWhatsapp =
    deliveryChannel === 'advisor_whatsapp' || Boolean(origin?.startsWith('advisor_whatsapp'));

  if (isAdvisorWhatsapp) {
    const suffix = advisorPhone ? ` ${formatDisplayPhone(advisorPhone)}` : '';
    return {
      isAdvisorWhatsapp: true,
      text:
        message.direction === 'outbound'
          ? `📱 Enviado desde: Mi WhatsApp${suffix}`
          : `📱 Recibido en: Mi WhatsApp${suffix}`,
    };
  }

  const phoneFmt = businessPhone ? formatDisplayPhone(businessPhone) : '';
  const named = businessPhone ? inboxLabel(businessPhone) : companyLineLabel;
  const isNamed = Boolean(named && named !== 'Sin número' && named !== phoneFmt);
  const lineTitle = isNamed ? named : 'Ventas 317';
  const suffix = phoneFmt ? ` ${phoneFmt}` : '';
  return {
    isAdvisorWhatsapp: false,
    text:
      message.direction === 'outbound'
        ? `🏢 Enviado desde: ${lineTitle}${suffix}`
        : `🏢 Recibido en: ${lineTitle}${suffix}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks locales para Lead en vivo y Mensajes paginados
// ─────────────────────────────────────────────────────────────────────────────

function useLiveLeadState(
  companyId: string | null,
  leadId: string,
  initialLead?: Lead
): { lead: Lead | null; loading: boolean; notFound: boolean } {
  const [lead, setLead] = useState<Lead | null>(initialLead ?? null);
  const [loading, setLoading] = useState<boolean>(!initialLead && Boolean(leadId));
  const [notFound, setNotFound] = useState<boolean>(!initialLead && !leadId);

  useEffect(() => {
    if (initialLead) {
      setLead((prev) => (prev?.id === initialLead.id ? prev : initialLead));
      setNotFound(false);
    }
  }, [initialLead]);

  useEffect(() => {
    if (!leadId) {
      setLoading(false);
      if (!initialLead) setNotFound(true);
      return;
    }
    if (!companyId) return;

    if (!lead) setLoading(true);
    const unsub = firestore()
      .collection('companies')
      .doc(companyId)
      .collection('leads')
      .doc(leadId)
      .onSnapshot(
        (snap) => {
          if (snapExists(snap)) {
            setLead({ id: snap.id, ...(snap.data() as Omit<Lead, 'id'>) } as Lead);
            setNotFound(false);
          } else if (!initialLead) {
            setNotFound(true);
          }
          setLoading(false);
        },
        (err) => {
          console.warn('[ChatScreen] Error escuchando lead:', err);
          setLoading(false);
        }
      );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, leadId]);

  return { lead, loading, notFound };
}

function usePaginatedMessages(companyId: string | null, leadId: string | null) {
  const [messages, setMessages] = useState<EnrichedMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(companyId && leadId));
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [pageLimit, setPageLimit] = useState<number>(MESSAGES_PAGE_SIZE);
  const prevLeadIdRef = useRef<string | null>(null);

  const loadOlder = useCallback(() => {
    setPageLimit((curr) => curr + MESSAGES_PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (!companyId || !leadId) {
      setMessages([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      prevLeadIdRef.current = leadId;
      return;
    }

    const isNewLead = prevLeadIdRef.current !== leadId;
    if (isNewLead && pageLimit !== MESSAGES_PAGE_SIZE) {
      setPageLimit(MESSAGES_PAGE_SIZE);
      return;
    }

    if (isNewLead) {
      setMessages([]);
      setHasMore(false);
      prevLeadIdRef.current = leadId;
    }

    if (pageLimit === MESSAGES_PAGE_SIZE) setLoading(true);
    else setLoadingMore(true);

    const unsub = firestore()
      .collection('companies')
      .doc(companyId)
      .collection('leads')
      .doc(leadId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(pageLimit)
      .onSnapshot(
        (snapshot) => {
          const normalized = snapshot.docs
            .map((d) => normalizeFirestoreMessage(d.id, (d.data() ?? {}) as Record<string, unknown>))
            .reverse();
          setMessages(normalized);
          setHasMore(snapshot.docs.length >= pageLimit);
          setLoading(false);
          setLoadingMore(false);
        },
        (err) => {
          console.warn('[ChatScreen] Error escuchando mensajes:', err);
          setLoading(false);
          setLoadingMore(false);
        }
      );

    return () => unsub();
  }, [companyId, leadId, pageLimit]);

  return { messages, loading, loadingMore, hasMore, loadOlder };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla Principal: ChatScreen
// ─────────────────────────────────────────────────────────────────────────────

export function ChatScreen({ route, navigation }: Props) {
  const { lead: paramLead, leadId: paramLeadId } = route.params ?? {};
  const resolvedLeadId = paramLead?.id || paramLeadId || '';

  const { companyId, user, profile, role, platformAdmin } = useAuth();
  const { palette } = useTheme();
  const isAdmin = platformAdmin || isAdminRole(role ?? profile?.role);

  const { lead: liveLead, loading: leadLoading, notFound } = useLiveLeadState(
    companyId,
    resolvedLeadId,
    paramLead
  );

  const isAssignedToOther = Boolean(
    liveLead &&
      !isAdmin &&
      liveLead.assignedTo &&
      user?.uid &&
      liveLead.assignedTo !== user.uid
  );

  const activeThreadLeadId = liveLead && !isAssignedToOther ? liveLead.id : null;
  const { messages, loading, loadingMore, hasMore, loadOlder } = usePaginatedMessages(
    companyId,
    activeThreadLeadId
  );

  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [reactionTarget, setReactionTarget] = useState<EnrichedMessage | null>(null);
  const [optimisticReactions, setOptimisticReactions] = useState<Record<string, string>>({});

  // Reloj vivo cada 30s para refrescar el contador de Ventana 24h y SLA Toma Manual
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Estado de conexión de "Mi WhatsApp" (Coexistencia WABA + Puente Baileys)
  const [advisorWhatsappAvailable, setAdvisorWhatsappAvailable] = useState(false);
  const [advisorWhatsappPhone, setAdvisorWhatsappPhone] = useState<string | null>(null);
  const [advisorWhatsappStatus, setAdvisorWhatsappStatus] = useState<AdvisorWhatsappStatus | null>(null);

  const listRef = useRef<FlatList<EnrichedMessage>>(null);
  const loadingOlderActionRef = useRef(false);
  const markedReadKeyRef = useRef<string | null>(null);

  // Reiniciar estados dependientes al cambiar de lead
  useEffect(() => {
    setOptimisticReactions({});
  }, [resolvedLeadId]);

  // Cargar asesores de la empresa (para nombres en burbujas, Ficha y LeadDrawerModal)
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    listAdvisors(companyId)
      .then((rows) => {
        if (alive) setAdvisors(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [companyId]);

  const advisorNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    advisors.forEach((a) => {
      if (a.id && a.displayName) m.set(a.id, a.displayName);
    });
    if (user?.uid && profile?.displayName && !m.has(user.uid)) {
      m.set(user.uid, profile.displayName);
    }
    return m;
  }, [advisors, user?.uid, profile?.displayName]);

  // Verificar AMBOS: Puente Baileys (listAdvisorWhatsappConnections) y Coexistencia WABA (getMyMessagingLine)
  useEffect(() => {
    if (!companyId || !user?.uid) {
      setAdvisorWhatsappAvailable(false);
      setAdvisorWhatsappPhone(null);
      setAdvisorWhatsappStatus(null);
      return;
    }

    let cancelled = false;
    const refreshAdvisorChannels = () => {
      Promise.all([
        listAdvisorWhatsappConnections(companyId, user.uid).catch(() => []),
        getMyMessagingLine(companyId).catch(() => null),
      ])
        .then(([connections, lineResponse]) => {
          if (cancelled) return;
          const connection = connections[0];
          const baileysConnected = connection?.status === 'connected';
          const coexistenceLine =
            lineResponse && typeof lineResponse === 'object' && 'line' in lineResponse
              ? lineResponse.line
              : null;

          setAdvisorWhatsappAvailable(Boolean(coexistenceLine) || baileysConnected);
          setAdvisorWhatsappStatus(
            coexistenceLine ? 'connected' : connection?.status ?? 'disconnected'
          );
          setAdvisorWhatsappPhone(
            coexistenceLine?.number ?? (baileysConnected ? connection?.phone ?? null : null)
          );
        })
        .catch(() => {
          if (!cancelled) {
            setAdvisorWhatsappAvailable(false);
            setAdvisorWhatsappPhone(null);
            setAdvisorWhatsappStatus('error');
          }
        });
    };

    refreshAdvisorChannels();
    const interval = setInterval(refreshAdvisorChannels, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [companyId, user?.uid]);

  // Marcar conversación como leída al abrir o recibir nuevos mensajes entrantes
  useEffect(() => {
    if (!companyId || !liveLead || isAssignedToOther) return;
    const inboundMs = toMillisSafe(liveLead.lastInboundAt);
    const key = `${companyId}:${liveLead.id}:${inboundMs}:${messages.length}`;
    if (markedReadKeyRef.current === key) return;
    markedReadKeyRef.current = key;
    markLeadRead(companyId, liveLead.id).catch(() => {});
  }, [companyId, liveLead, isAssignedToOther, messages.length]);

  // Manejo del botón físico Atrás en Android
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (lightboxImageUrl) {
        setLightboxImageUrl(null);
        return true;
      }
      if (reactionTarget) {
        setReactionTarget(null);
        return true;
      }
      if (templatesOpen) {
        setTemplatesOpen(false);
        return true;
      }
      if (fichaOpen) {
        setFichaOpen(false);
        return true;
      }
      if (detailsOpen) {
        setDetailsOpen(false);
        return true;
      }
      navigation.goBack();
      return true;
    });
    return () => sub.remove();
  }, [detailsOpen, fichaOpen, lightboxImageUrl, navigation, reactionTarget, templatesOpen]);

  // Auto-scroll suave al abrir el teclado
  useEffect(() => {
    const evt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(evt, () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  // Muro de Privacidad post-reasignación (advisorAssignedAt) para asesores no administradores
  // El muro protege la gestión de OTRO asesor. Si antes del corte solo hubo cliente, IA
  // y avisos del sistema, no se oculta nada: el asesor debe ver lo que la IA habló con
  // el cliente para saber en qué va la conversación.
  const assignedCutoffMs = useMemo(() => {
    if (!liveLead || isAdmin || !liveLead.advisorAssignedAt) return 0;
    const cutoff = toMillisSafe(liveLead.advisorAssignedAt);
    if (!cutoff) return 0;
    const priorHumanAdvisor = messages.some((msg) => {
      if (msg.senderType !== 'advisor') return false;
      const ms = toMillisSafe(msg.createdAt) || toMillisSafe(msg.timestamp);
      return ms > 0 && ms < cutoff;
    });
    return priorHumanAdvisor ? cutoff : 0;
  }, [liveLead, isAdmin, messages]);

  const { priorMessages, recentMessages } = useMemo(() => {
    if (!assignedCutoffMs) {
      return { priorMessages: [] as EnrichedMessage[], recentMessages: messages };
    }
    const prior: EnrichedMessage[] = [];
    const recent: EnrichedMessage[] = [];
    for (const msg of messages) {
      const ms = toMillisSafe(msg.createdAt) || toMillisSafe(msg.timestamp);
      if (ms > 0 && ms < assignedCutoffMs) {
        prior.push(msg);
      } else {
        recent.push(msg);
      }
    }
    return { priorMessages: prior, recentMessages: recent };
  }, [messages, assignedCutoffMs]);

  // Muro estricto de privacidad para asesores no administradores:
  // Los mensajes previos a su asignación están COMPLETAMENTE BLOQUEADOS.
  // Un asesor reasignado NUNCA puede ver la conversación previa de otro asesor.
  // Solo los administradores tienen acceso al historial completo.
  const displayedMessages = useMemo(() => {
    if (isAdmin) return messages;
    return recentMessages;
  }, [isAdmin, messages, recentMessages]);

  // Detectar si algún mensaje visible ya incluye la tarjeta de anuncio Meta (metadata.referral)
  const anyBubbleHasReferral = useMemo(
    () => displayedMessages.some((m) => m.direction === 'inbound' && Boolean(m.metadata?.referral)),
    [displayedMessages]
  );

  const showTopAdReferral = Boolean(
    liveLead?.sourceMeta &&
      (liveLead.sourceMeta.adId ||
        liveLead.sourceMeta.headline ||
        liveLead.sourceMeta.imageUrl ||
        liveLead.sourceMeta.videoUrl ||
        liveLead.sourceMeta.sourceUrl) &&
      !anyBubbleHasReferral
  );

  const handleLoadOlder = useCallback(() => {
    loadingOlderActionRef.current = true;
    loadOlder();
  }, [loadOlder]);

  const handleReactMessage = useCallback(
    async (msg: EnrichedMessage, emoji: string) => {
      if (!companyId || !liveLead) return;
      const currentReaction =
        optimisticReactions[msg.id] !== undefined ? optimisticReactions[msg.id] : msg.reaction ?? '';
      const nextEmoji = currentReaction === emoji ? '' : emoji;

      setReactionTarget(null);
      setOptimisticReactions((prev) => ({ ...prev, [msg.id]: nextEmoji }));

      try {
        await reactToMessage(companyId, liveLead.id, msg.id, nextEmoji);
      } catch (err) {
        setOptimisticReactions((prev) => {
          const copy = { ...prev };
          delete copy[msg.id];
          return copy;
        });
        const detail = (err as { message?: string })?.message;
        Alert.alert(
          'No se pudo reaccionar',
          detail && detail.length < 200
            ? detail
            : 'Solo se puede reaccionar a mensajes entrantes recientes de WhatsApp.'
        );
      }
    },
    [companyId, liveLead, optimisticReactions]
  );

  // ── 1. Estado de carga inicial cuando sólo se recibe { leadId } ─────────────
  if (leadLoading && !liveLead) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bgCanvas }]}>
        <View style={[styles.simpleTopBar, { borderBottomColor: palette.border, backgroundColor: palette.bgCanvas }]}>
          <Pressable
            onPress={navigation.goBack}
            hitSlop={10}
            style={[styles.iconBoxBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
          >
            <Icon name="ArrowLeft" size={18} color={palette.textPrimary} />
          </Pressable>
          <Text style={[styles.headerLeadName, { color: palette.textPrimary }]}>Cargando conversación…</Text>
        </View>
        <View style={styles.centerGuardWrap}>
          <ActivityIndicator size="large" color={palette.brand} />
          <Text style={{ fontSize: 13, color: palette.textMuted, marginTop: 12 }}>
            Abriendo expediente del prospecto…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── 2. Estado de prospecto inexistente ──────────────────────────────────────
  if (notFound || !liveLead) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bgCanvas }]}>
        <View style={[styles.simpleTopBar, { borderBottomColor: palette.border, backgroundColor: palette.bgCanvas }]}>
          <Pressable
            onPress={navigation.goBack}
            hitSlop={10}
            style={[styles.iconBoxBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
          >
            <Icon name="ArrowLeft" size={18} color={palette.textPrimary} />
          </Pressable>
          <Text style={[styles.headerLeadName, { color: palette.textPrimary }]}>Conversación</Text>
        </View>
        <View style={styles.centerGuardWrap}>
          <View style={[styles.guardCircle, { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }]}>
            <Icon name="AlertTriangle" size={28} color={palette.amber} />
          </View>
          <Text style={[styles.guardTitle, { color: palette.textPrimary }]}>Prospecto no encontrado</Text>
          <Text style={[styles.guardDesc, { color: palette.textMuted }]}>
            No pudimos localizar este contacto o ya no se encuentra disponible en la empresa activa.
          </Text>
          <Button onPress={navigation.goBack} icon={<Icon name="ArrowLeft" size={15} color="#ffffff" />}>
            Volver a mi bandeja
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ── 3. Guard de bloqueo si el lead pertenece a otro asesor ──────────────────
  if (isAssignedToOther) {
    const isTimeout =
      (liveLead.advisorReassignmentCount ?? 0) > 0 || Boolean(liveLead.lastAutoReassignedAt);
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bgCanvas }]}>
        <View style={[styles.simpleTopBar, { borderBottomColor: palette.border, backgroundColor: palette.bgCanvas }]}>
          <Pressable
            onPress={navigation.goBack}
            hitSlop={10}
            style={[styles.iconBoxBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
          >
            <Icon name="ArrowLeft" size={18} color={palette.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.headerLeadName, { color: palette.textPrimary }]}>
              {liveLead.name || formatDisplayPhone(liveLead.phone) || 'Prospecto'}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: palette.amber }}>
              Reasignado a otro asesor
            </Text>
          </View>
        </View>

        <View style={[styles.centerGuardWrap, { backgroundColor: palette.bgBody }]}>
          <View style={[styles.guardCircle, { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }]}>
            <Icon name="Clock" size={30} color={palette.amber} />
          </View>
          <Text style={[styles.guardTitle, { color: palette.textPrimary }]}>
            {isTimeout ? 'Prospecto reasignado por tiempo' : 'Prospecto no disponible'}
          </Text>
          <Text style={[styles.guardDesc, { color: palette.textMuted }]}>
            {isTimeout
              ? 'Este dato fue reasignado automáticamente porque no se realizó el primer contacto dentro de los 5 minutos reglamentarios.\n\nPor privacidad comercial entre asesores, la conversación ya no se encuentra accesible.'
              : 'Este prospecto ya no está asignado a tu cuenta. Solo puedes acceder a las conversaciones de tus propios prospectos.'}
          </Text>
          <Button onPress={navigation.goBack} icon={<Icon name="ArrowLeft" size={15} color="#ffffff" />}>
            Volver a mi bandeja
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ── Variables derivadas de canal, ventana de 24h y entregas ─────────────────
  const isWhatsapp = !liveLead.channel || liveLead.channel === 'whatsapp';
  const windowOpen = isWindowOpen(liveLead.lastInboundAt ?? null);
  const companyLineBlocked = isWhatsapp && !windowOpen;
  const leadHasPhone = Boolean(liveLead.phone && digitsOnly(liveLead.phone).length >= 7);
  const advisorAvailableForLead = advisorWhatsappAvailable && leadHasPhone;
  const canUseComposer = !isWhatsapp || windowOpen || advisorAvailableForLead;
  const defaultDeliveryChannel: DeliveryChannel =
    companyLineBlocked && advisorAvailableForLead ? 'advisor_whatsapp' : 'company_whatsapp';
  const companyLineLabel = inboxLabel(liveLead.inboxId);

  const advisorWhatsappNotice = (() => {
    if (advisorWhatsappAvailable) return null;
    if (advisorWhatsappStatus === 'stale') {
      return 'Tu WhatsApp personal perdió conexión. Puedes seguir respondiendo por Ventas 317 o reconectarlo en Configuración.';
    }
    if (advisorWhatsappStatus === 'qr_pending') {
      return 'Tu WhatsApp personal tiene un QR pendiente por escanear. Mientras tanto se enviará por Ventas 317.';
    }
    if (advisorWhatsappStatus === 'configuration_required') {
      return 'El puente de WhatsApp personal aún no está configurado en el servidor.';
    }
    if (advisorWhatsappStatus === 'error') {
      return 'No se pudo validar tu WhatsApp personal. Puedes responder por Ventas 317 y revisar Configuracion.';
    }
    return 'Tu WhatsApp personal no esta conectado. Puedes responder por Ventas 317 o conectarlo en Configuracion.';
  })();

  const resolvedAdvisorName = liveLead.assignedTo
    ? advisorNamesMap.get(liveLead.assignedTo) ?? liveLead.assignedAdvisorName
    : liveLead.assignedAdvisorName;

  const resolvedProject =
    liveLead.projectInterest?.[0] ||
    liveLead.project ||
    liveLead.firstTouch?.project ||
    liveLead.metadata?.project ||
    undefined;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.bgCanvas }]}>
      {/* Encabezado 2 filas + Barra SLA Toma Manual + Barra Meraki Gold Ventana 24h */}
      <ConversationHeaderBar
        lead={liveLead}
        companyId={companyId}
        palette={palette}
        windowOpen={windowOpen}
        onBack={navigation.goBack}
        onOpenDetails={() => setDetailsOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenFicha={() => setFichaOpen(true)}
      />

      {/* Área de Conversación + Compositor */}
      <KeyboardAvoidingView
        style={[styles.chatArea, { backgroundColor: palette.bgBody }]}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={displayedMessages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={[
            styles.messageListContent,
            displayedMessages.length === 0 && !loading ? { flexGrow: 1 } : null,
          ]}
          onContentSizeChange={() => {
            if (loadingOlderActionRef.current) {
              loadingOlderActionRef.current = false;
              return;
            }
            if (!loading) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
          ListHeaderComponent={
            <View style={{ gap: 10 }}>
              {loading && (
                <View style={styles.centerSpinner}>
                  <ActivityIndicator size="small" color={palette.brand} />
                </View>
              )}

              {!loading && hasMore && (
                <View style={{ alignItems: 'center', paddingBottom: 4 }}>
                  <Pressable
                    onPress={handleLoadOlder}
                    disabled={loadingMore}
                    style={[
                      styles.loadOlderBtn,
                      {
                        backgroundColor: palette.bgCard,
                        borderColor: palette.borderStrong,
                        opacity: loadingMore ? 0.6 : 1,
                      },
                    ]}
                  >
                    {loadingMore ? (
                      <ActivityIndicator size="small" color={palette.brand} />
                    ) : (
                      <Icon name="Clock" size={12} color={palette.textSecondary} />
                    )}
                    <Text style={{ fontSize: 11, fontWeight: '600', color: palette.textSecondary }}>
                      {loadingMore ? 'Cargando mensajes…' : 'Cargar mensajes anteriores'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {priorMessages.length > 0 && !isAdmin && (
                <PrivacyWallBanner
                  hiddenCount={priorMessages.length}
                  palette={palette}
                  onOpenFicha={() => setFichaOpen(true)}
                />
              )}

              {showTopAdReferral && liveLead.sourceMeta && (
                <AdReferralCard
                  referral={liveLead.sourceMeta}
                  companyId={companyId ?? undefined}
                  leadId={liveLead.id}
                  palette={palette}
                />
              )}
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyMessagesWrap}>
                <Text style={{ fontSize: 32, marginBottom: 6 }}>💬</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: palette.textPrimary }}>
                  Sin mensajes aún
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: palette.textMuted,
                    textAlign: 'center',
                    marginTop: 4,
                    maxWidth: 260,
                  }}
                >
                  Los mensajes de esta conversación aparecerán aquí en tiempo real.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const effectiveReaction =
              optimisticReactions[item.id] !== undefined
                ? optimisticReactions[item.id]
                : item.reaction;
            const prevMsg = index > 0 ? displayedMessages[index - 1] : null;
            const itemMs = toMillisSafe(item.createdAt) || toMillisSafe(item.timestamp);
            const prevMs = prevMsg ? toMillisSafe(prevMsg.createdAt) || toMillisSafe(prevMsg.timestamp) : 0;
            const showAssignedDivider =
              isAdmin &&
              assignedCutoffMs > 0 &&
              prevMs > 0 &&
              prevMs < assignedCutoffMs &&
              itemMs >= assignedCutoffMs;

            return (
              <View style={{ gap: 8 }}>
                {showAssignedDivider && (
                  <View style={styles.assignedDividerRow}>
                    <View style={[styles.dividerLine, { backgroundColor: palette.brandBorder }]} />
                    <View
                      style={[
                        styles.assignedDividerPill,
                        { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                      ]}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: palette.brandText }}>
                        Asignado a tu gestión
                      </Text>
                    </View>
                    <View style={[styles.dividerLine, { backgroundColor: palette.brandBorder }]} />
                  </View>
                )}

                <ChatMessageBubble
                  message={item}
                  effectiveReaction={effectiveReaction}
                  advisorName={item.advisorId ? advisorNamesMap.get(item.advisorId) : undefined}
                  companyLineLabel={companyLineLabel}
                  companyLinePhone={liveLead.inboxId}
                  advisorWhatsappPhone={advisorWhatsappPhone}
                  companyId={companyId ?? undefined}
                  leadId={liveLead.id}
                  palette={palette}
                  onOpenImage={setLightboxImageUrl}
                  onOpenReactionPicker={setReactionTarget}
                />
              </View>
            );
          }}
        />

        {/* Avisos contextuales de canal y Compositor / Pie de Ventana Cerrada */}
        {companyId ? (
          canUseComposer ? (
            <View>
              {companyLineBlocked && advisorAvailableForLead && (
                <View
                  style={[
                    styles.composerNoticeBar,
                    { backgroundColor: palette.amberBg, borderTopColor: palette.amberBorder },
                  ]}
                >
                  <Icon name="AlertTriangle" size={14} color={palette.amber} style={{ marginTop: 1 }} />
                  <Text style={[styles.composerNoticeText, { color: palette.textPrimary }]}>
                    <Text style={{ fontWeight: '700' }}>Ventana 24h cerrada</Text> para {companyLineLabel}.
                    Responde por <Text style={{ fontWeight: '700' }}>Mi WhatsApp</Text> o usa una plantilla.
                  </Text>
                  <Pressable onPress={() => setTemplatesOpen(true)} hitSlop={8}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: palette.brandText,
                        textDecorationLine: 'underline',
                      }}
                    >
                      Usar plantilla
                    </Text>
                  </Pressable>
                </View>
              )}

              {isWhatsapp && advisorWhatsappNotice && leadHasPhone && (
                <View
                  style={[
                    styles.composerNoticeBar,
                    { backgroundColor: palette.amberBg, borderTopColor: palette.amberBorder },
                  ]}
                >
                  <Icon name="AlertTriangle" size={14} color={palette.amber} style={{ marginTop: 1 }} />
                  <Text style={[styles.composerNoticeText, { color: palette.textSecondary }]}>
                    {advisorWhatsappNotice}
                  </Text>
                </View>
              )}

              {isWhatsapp && !leadHasPhone && (
                <View
                  style={[
                    styles.composerNoticeBar,
                    { backgroundColor: palette.skyBg, borderTopColor: palette.skyBorder },
                  ]}
                >
                  <Icon name="Info" size={14} color={palette.sky} style={{ marginTop: 1 }} />
                  <Text style={[styles.composerNoticeText, { color: palette.skyText }]}>
                    Este prospecto entró por <Text style={{ fontWeight: '700' }}>usuario de WhatsApp</Text> (sin número visible). Solo se puede responder por <Text style={{ fontWeight: '700' }}>{companyLineLabel}</Text>.
                  </Text>
                </View>
              )}

              <MessageComposerBar
                companyId={companyId}
                lead={liveLead}
                palette={palette}
                companyLineLabel={companyLineLabel}
                advisorWhatsappAvailable={advisorAvailableForLead}
                defaultDeliveryChannel={defaultDeliveryChannel}
                companyLineDisabled={companyLineBlocked}
              />
            </View>
          ) : (
            <ClosedWindowFooter
              palette={palette}
              onOpenTemplates={() => setTemplatesOpen(true)}
            />
          )
        ) : null}
      </KeyboardAvoidingView>

      {/* Barra inferior de navegación idéntica a iPhone Responsive Web */}
      <StandaloneBottomNavBar activeTab="Bandeja" />

      {/* Modales Compartidos y Nativos */}
      {companyId ? (
        <>
          <LeadDrawerModal
            visible={detailsOpen}
            lead={liveLead}
            companyId={companyId}
            advisors={advisors}
            onClose={() => setDetailsOpen(false)}
          />

          <FichaTecnicaModal
            isOpen={fichaOpen}
            onClose={() => setFichaOpen(false)}
            companyId={companyId}
            lead={{
              id: liveLead.id,
              name: liveLead.name,
              phone: liveLead.phone,
              project: resolvedProject,
              advisorName: resolvedAdvisorName,
              bitacoras: liveLead.bitacoras,
              metadata: liveLead.metadata,
            }}
          />

          <TemplatePickerModal
            visible={templatesOpen}
            companyId={companyId}
            lead={liveLead}
            palette={palette}
            onClose={() => setTemplatesOpen(false)}
          />
        </>
      ) : null}

      {/* Barra flotante de 6 emojis al mantener presionada una burbuja */}
      <ReactionPickerModal
        message={reactionTarget}
        activeEmoji={
          reactionTarget
            ? optimisticReactions[reactionTarget.id] !== undefined
              ? optimisticReactions[reactionTarget.id]
              : reactionTarget.reaction ?? ''
            : ''
        }
        palette={palette}
        onSelectEmoji={(emoji) => {
          if (reactionTarget) void handleReactMessage(reactionTarget, emoji);
        }}
        onClose={() => setReactionTarget(null)}
      />

      {/* Lightbox Fullscreen con Zoom para Imágenes y Stickers */}
      <ImageLightboxModal
        uri={lightboxImageUrl}
        onClose={() => setLightboxImageUrl(null)}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversationHeaderBar (2 filas compactas + SLA 24h + Ventana 24h Meraki Gold)
// ─────────────────────────────────────────────────────────────────────────────

function ConversationHeaderBar({
  lead,
  companyId,
  palette,
  windowOpen,
  onBack,
  onOpenDetails,
  onOpenTemplates,
  onOpenFicha,
}: {
  lead: Lead;
  companyId: string | null;
  palette: MerakiThemePalette;
  windowOpen: boolean;
  onBack: () => void;
  onOpenDetails: () => void;
  onOpenTemplates: () => void;
  onOpenFicha: () => void;
}) {
  const [aiEnabled, setAiEnabled] = useState(lead.aiEnabled);
  const [togglingAi, setTogglingAi] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  useEffect(() => {
    setAiEnabled(lead.aiEnabled);
  }, [lead.aiEnabled]);

  const handleToggleAi = async () => {
    if (!companyId || togglingAi) return;
    const next = !aiEnabled;
    setAiEnabled(next);
    setTogglingAi(true);
    try {
      await setLeadAi(companyId, lead.id, next);
    } catch {
      setAiEnabled(!next);
      Alert.alert('Estado de IA', 'No se pudo cambiar el estado de Victoria IA.');
    } finally {
      setTogglingAi(false);
    }
  };

  const handleCopyPhone = async () => {
    if (!lead.phone) return;
    await Clipboard.setStringAsync(lead.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1800);
  };

  const isWhatsapp = !lead.channel || lead.channel === 'whatsapp';
  const chBadge = channelBadgeInfo(lead.channel);
  const flag = getCountryFlag(lead.phone);
  const displayName = lead.name?.trim() || formatDisplayPhone(lead.phone) || 'Sin nombre';
  const formattedPhone = formatDisplayPhone(lead.phone);

  const hasMetaAd =
    lead.source === 'meta_ads' ||
    Boolean(lead.sourceMeta?.adId || lead.sourceMeta?.headline || lead.sourceMeta?.sourceUrl);
  const adHeadline =
    lead.sourceMeta?.headline ||
    lead.metadata?.metaAdName ||
    lead.firstTouch?.adName ||
    'Meta Ads';
  const isAdVideo =
    lead.sourceMeta?.mediaType === 'video' || Boolean(lead.sourceMeta?.videoUrl);
  const fallbackWebVideoLink =
    lead.sourceMeta?.videoUrl && !isPlayableVideoUrl(lead.sourceMeta.videoUrl)
      ? lead.sourceMeta.videoUrl
      : undefined;
  const adSourceUrl = lead.sourceMeta?.sourceUrl || fallbackWebVideoLink;

  const manualSla = getManualTakeoverSlaInfo({ ...lead, aiEnabled });
  const timeLeft = windowTimeLeft(lead.lastInboundAt ?? null);
  const closedAgo = windowClosedAgo(lead.lastInboundAt ?? null);

  return (
    <View style={[styles.headerContainer, { backgroundColor: palette.bgCanvas, borderBottomColor: palette.border }]}>
      {/* Fila 1: Botón Atrás + Nombre/Teléfono (1:1 con ConversationHeader.tsx en móvil) */}
      <View style={styles.headerRow1}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={[styles.iconBoxBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
        >
          <Icon name="ArrowLeft" size={18} color={palette.textPrimary} />
        </Pressable>

        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Pressable onPress={onOpenDetails} style={{ flexShrink: 1 }}>
            <Text numberOfLines={1} style={[styles.headerLeadName, { color: palette.textPrimary }]}>
              {displayName}
            </Text>
          </Pressable>

          <View style={styles.phoneAndMetaRow}>
            {lead.phone ? (
              <Pressable onPress={handleCopyPhone} hitSlop={6} style={styles.copyPhoneBtn}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: palette.textSubtle, fontWeight: '500' }}>
                  {lead.phone}
                </Text>
                {copiedPhone && (
                  <Text style={{ fontSize: 10, fontWeight: '700', color: palette.emerald }}>
                    Copiado
                  </Text>
                )}
              </Pressable>
            ) : (
              <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                {chBadge?.label || 'Usuario sin número visible'}
              </Text>
            )}

            {hasMetaAd && (
              <View style={styles.metaAdsInlineWrap}>
                <View
                  style={[
                    styles.metaAdsPill,
                    { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
                  ]}
                >
                  <Icon name="Megaphone" size={10} color={palette.sky} />
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 10, fontWeight: '600', color: palette.skyText, maxWidth: 150 }}
                  >
                    Pauta: {adHeadline}
                    {isAdVideo ? ' · 🎬' : ''}
                  </Text>
                </View>

                {adSourceUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(adSourceUrl)}
                    hitSlop={6}
                    style={[
                      styles.fbVideoLinkBtn,
                      { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
                    ]}
                  >
                    <Icon name="Play" size={9} color={palette.sky} />
                    <Text style={{ fontSize: 10, fontWeight: '700', color: palette.textSecondary }}>
                      Ver video ↗
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Fila 2: Tira de Acciones Móvil ([👤] | [⊞ Plantilla] | [📋 Ficha] | [🤖 IA pausada]) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.headerActionStrip}
      >
        <Pressable
          onPress={onOpenDetails}
          style={[
            styles.headerActionBtn,
            { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong, paddingHorizontal: 10 },
          ]}
        >
          <Icon name="User" size={14} color={palette.textSecondary} />
        </Pressable>

        {isWhatsapp && (
          <Pressable
            onPress={onOpenTemplates}
            style={[
              styles.headerActionBtn,
              { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
            ]}
          >
            <Icon name="LayoutTemplate" size={14} color={palette.textSecondary} />
            <Text style={[styles.headerActionText, { color: palette.textPrimary }]}>Plantilla</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onOpenFicha}
          style={[
            styles.headerActionBtn,
            { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
          ]}
        >
          <Icon name="ClipboardList" size={14} color={palette.brand} />
          <Text style={[styles.headerActionText, { color: palette.textPrimary }]}>Ficha</Text>
        </Pressable>

        <Pressable
          onPress={handleToggleAi}
          disabled={togglingAi}
          style={[
            styles.headerActionBtn,
            aiEnabled
              ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
              : { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
            togglingAi && { opacity: 0.65 },
          ]}
        >
          {togglingAi ? (
            <ActivityIndicator size="small" color={aiEnabled ? palette.emerald : palette.amber} />
          ) : (
            <Icon name="Bot" size={14} color={aiEnabled ? palette.emeraldText : palette.amberText} />
          )}
          <Text
            style={[
              styles.headerActionText,
              { color: aiEnabled ? palette.emeraldText : palette.amberText },
            ]}
          >
            {togglingAi ? 'Cambiando…' : aiEnabled ? 'IA activa' : 'IA pausada'}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Barra SLA 24h Toma de Control Manual (1:1 con ConversationHeader.tsx) */}
      {manualSla && (
        <View
          style={[
            styles.slaBanner,
            manualSla.status === 'compliant'
              ? { backgroundColor: palette.emeraldBg, borderTopColor: palette.emeraldBorder }
              : manualSla.status === 'overdue'
              ? { backgroundColor: palette.roseBg, borderTopColor: palette.roseBorder }
              : {
                  backgroundColor: palette.isDark ? 'rgba(46, 16, 101, 0.55)' : '#f5f3ff',
                  borderTopColor: palette.isDark ? 'rgba(139, 92, 246, 0.30)' : '#ddd6fe',
                },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.slaBannerText,
              {
                color:
                  manualSla.status === 'compliant'
                    ? palette.emeraldText
                    : manualSla.status === 'overdue'
                    ? palette.roseText
                    : palette.isDark
                    ? palette.brandLight
                    : '#5b21b6',
              },
            ]}
          >
            {manualSla.label}
          </Text>

          {manualSla.status !== 'compliant' && (
            <Pressable
              onPress={onOpenFicha}
              style={[
                styles.slaActionCta,
                {
                  backgroundColor: manualSla.status === 'overdue' ? palette.rose : palette.brand,
                },
              ]}
            >
              <Text style={styles.slaActionCtaText}>📝 Llenar Ficha Ahora</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Barra Meraki Gold (#B7871C) de Ventana Oficial de 24h de WhatsApp */}
      {isWhatsapp && lead.lastInboundAt && (
        <View
          style={[
            styles.windowStatusBar,
            windowOpen
              ? {
                  backgroundColor: palette.isDark ? 'rgba(24, 24, 27, 0.72)' : '#FAF5EA',
                  borderTopColor: palette.border,
                }
              : {
                  backgroundColor: palette.amberBg,
                  borderTopColor: palette.amberBorder,
                },
          ]}
        >
          {windowOpen ? (
            <View style={[styles.rowCenterGap6, { flex: 1, minWidth: 0 }]}>
              <View
                style={[
                  styles.merakiWindowOpenPill,
                  { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                ]}
              >
                <View style={[styles.windowDot, { backgroundColor: palette.brand }]} />
                <Text style={{ fontSize: 10.5, fontWeight: '800', color: palette.brandText }}>
                  Ventana 24h activa
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={{ fontSize: 11, fontWeight: '700', color: palette.textPrimary, flexShrink: 1 }}
              >
                {timeLeft}
              </Text>
            </View>
          ) : (
            <>
              <View style={[styles.rowCenterGap6, { flex: 1, minWidth: 0 }]}>
                <View
                  style={[
                    styles.merakiWindowOpenPill,
                    { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                  ]}
                >
                  <Text style={{ fontSize: 10.5, fontWeight: '800', color: palette.amberText }}>
                    ⚠️ Ventana 24h cerrada
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 10.5, color: palette.textSecondary, flexShrink: 1 }}
                >
                  {lead.lastInboundAt ? closedAgo : 'Usa una plantilla oficial'}
                </Text>
              </View>

              <Pressable
                onPress={onOpenTemplates}
                style={[styles.windowTemplateCta, { backgroundColor: palette.brand }]}
              >
                <Icon name="LayoutTemplate" size={11} color="#ffffff" />
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#ffffff' }}>
                  Usar plantilla
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Muro de Privacidad Estricto post-reasignación (Confidencialidad Meraki)
// ─────────────────────────────────────────────────────────────────────────────

function PrivacyWallBanner({
  hiddenCount,
  palette,
  onOpenFicha,
}: {
  hiddenCount: number;
  palette: MerakiThemePalette;
  onOpenFicha: () => void;
}) {
  return (
    <View
      style={[
        styles.privacyBannerCard,
        { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
      ]}
    >
      <View style={styles.rowCenterGap6}>
        <Icon name="Shield" size={15} color={palette.brand} />
        <Text style={{ fontSize: 12, fontWeight: '800', color: palette.brandText, flex: 1 }}>
          Conversación previa a tu asignación oculta por privacidad
        </Text>
      </View>

      <Text style={{ fontSize: 11, lineHeight: 16, color: palette.textMuted, marginTop: 4 }}>
        {hiddenCount} mensaje(s) de gestiones anteriores están protegidos por política de confidencialidad comercial. Revisa la{' '}
        <Text style={{ fontWeight: '700', color: palette.textPrimary }}>Ficha Técnica</Text> y el{' '}
        <Text style={{ fontWeight: '700', color: palette.textPrimary }}>Resumen IA</Text> para conocer todos los antecedentes del cliente.
      </Text>

      <View style={[styles.rowCenterGap6, { marginTop: 8, justifyContent: 'flex-start' }]}>
        <Pressable
          onPress={onOpenFicha}
          style={[
            styles.privacyMiniBtn,
            { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder, paddingHorizontal: 12 },
          ]}
        >
          <Icon name="ClipboardList" size={13} color={palette.brandText} />
          <Text style={{ fontSize: 11, fontWeight: '800', color: palette.brandText }}>
            Ver Ficha Técnica
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Burbuja de Mensaje + MediaMessage + AdReferralCard
// ─────────────────────────────────────────────────────────────────────────────

function renderLinkedText(text: string, textColor: string, linkColor: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  if (parts.length === 1) {
    return <Text style={[styles.bubbleBodyText, { color: textColor }]}>{text}</Text>;
  }
  return (
    <Text style={[styles.bubbleBodyText, { color: textColor }]}>
      {parts.map((part, idx) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={idx}
            onPress={() => Linking.openURL(part)}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
          >
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

const ChatMessageBubble = memo(
  function ChatMessageBubble({
    message,
    effectiveReaction,
    advisorName,
    companyLineLabel,
    companyLinePhone,
    advisorWhatsappPhone,
    companyId,
    leadId,
    palette,
    onOpenImage,
    onOpenReactionPicker,
  }: {
    message: EnrichedMessage;
    effectiveReaction?: string;
    advisorName?: string;
    companyLineLabel: string;
    companyLinePhone?: string | null;
    advisorWhatsappPhone?: string | null;
    companyId?: string;
    leadId: string;
    palette: MerakiThemePalette;
    onOpenImage: (url: string) => void;
    onOpenReactionPicker: (msg: EnrichedMessage) => void;
  }) {
    const [expanded, setExpanded] = useState(false);

    if (message.senderType === 'system') {
      return (
        <View style={styles.systemRow}>
          <View
            style={[
              styles.systemPill,
              { backgroundColor: palette.bgElevated, borderColor: palette.border },
            ]}
          >
            <Text style={{ fontSize: 11, fontStyle: 'italic', color: palette.textMuted, textAlign: 'center' }}>
              {message.content}
            </Text>
          </View>
        </View>
      );
    }

    const isOutbound = message.direction === 'outbound';
    const referral = message.metadata?.referral as LeadSourceMeta | undefined;
    const mediaInfo = resolveMediaKind(message);
    const hasMedia = Boolean(message.mediaUrl);
    const isSticker = mediaInfo === 'sticker';
    const hasContent = Boolean(message.content?.trim());
    const isLong = (message.content?.length ?? 0) > LONG_MESSAGE_THRESHOLD;
    const displayContent =
      isLong && !expanded
        ? `${message.content.slice(0, LONG_MESSAGE_THRESHOLD).trimEnd()}…`
        : message.content;

    let senderLabel = 'Lead';
    let bubbleBg = palette.inboundBubbleBg;
    let bubbleBorder = palette.inboundBubbleBorder;
    let bubbleTextColor = palette.inboundBubbleText;
    let linkColor = palette.skyText;

    if (message.senderType === 'ai') {
      senderLabel = '🤖 Victoria IA';
      bubbleBg = palette.outboundAiBg;
      bubbleBorder = palette.outboundAiBorder;
      bubbleTextColor = palette.textPrimary;
      linkColor = palette.brandText;
    } else if (message.senderType === 'advisor') {
      senderLabel = message.advisorId
        ? `✋ ${advisorName || message.advisorName || 'Asesor'}`
        : '📱 Enviado desde WhatsApp';
      bubbleBg = palette.outboundAdvisorBg;
      bubbleBorder = palette.outboundAdvisorBorder;
      bubbleTextColor = palette.textPrimary;
      linkColor = palette.skyText;
    }

    const timeStr = formatChatTimestamp(message.createdAt ?? message.timestamp);
    const route = buildRouteLabel(
      message,
      companyLineLabel,
      companyLinePhone,
      advisorWhatsappPhone
    );

    const failCode = message.failureCode ?? message.errorCode;
    const failRaw = message.failureReason ?? message.errorMessage;
    const failExplanation =
      isOutbound && message.status === 'failed'
        ? friendlyFailureReason(failCode, failRaw)
        : undefined;

    const canReactInbound = message.direction === 'inbound' && message.senderType === 'lead';

    return (
      <View
        style={[
          styles.bubbleOuterWrap,
          isSticker ? { maxWidth: 168 } : { maxWidth: '84%' },
          isOutbound ? styles.alignEnd : styles.alignStart,
        ]}
      >
        {/* Etiqueta del remitente */}
        <Text
          style={[
            styles.senderCaption,
            { color: message.senderType === 'ai' ? palette.brandText : palette.textSubtle },
          ]}
        >
          {senderLabel}
        </Text>

        {/* Tarjeta de Anuncio Meta Ads adjunta a la burbuja entrante */}
        {!isOutbound && referral && (
          <AdReferralCard
            referral={referral}
            companyId={companyId}
            leadId={leadId}
            palette={palette}
          />
        )}

        {/* Fila de Burbuja + Botón rápido de reacción */}
        <View style={[styles.bubbleRowWithAction, isOutbound && { flexDirection: 'row-reverse' }]}>
          <View style={{ position: 'relative', flexShrink: 1 }}>
            <Pressable
              delayLongPress={260}
              onLongPress={() => onOpenReactionPicker(message)}
              style={[
                isSticker
                  ? styles.stickerBubbleBox
                  : [
                      styles.chatBubbleBox,
                      {
                        backgroundColor: bubbleBg,
                        borderColor: bubbleBorder,
                        borderWidth: 1,
                      },
                    ],
              ]}
            >
              {hasMedia ? (
                <MediaMessageContent
                  message={message}
                  kind={mediaInfo}
                  outbound={isOutbound}
                  palette={palette}
                  onOpenImage={onOpenImage}
                />
              ) : isSticker ? (
                <View
                  style={[
                    styles.unavailableMediaPill,
                    { backgroundColor: palette.bgElevated, borderColor: palette.border },
                  ]}
                >
                  <Text style={{ fontSize: 11, color: palette.textMuted }}>Sticker no disponible</Text>
                </View>
              ) : null}

              {hasContent && !isSticker ? (
                <View style={hasMedia ? { marginTop: 6 } : undefined}>
                  {renderLinkedText(displayContent, bubbleTextColor, linkColor)}
                  {isLong && (
                    <Pressable onPress={() => setExpanded((v) => !v)} style={{ marginTop: 4 }}>
                      <Text
                        style={{
                          fontSize: 11.5,
                          fontWeight: '700',
                          color: palette.brandText,
                          textDecorationLine: 'underline',
                        }}
                      >
                        {expanded ? 'Ver menos' : 'Ver mensaje completo'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : null}

              {!hasMedia && !hasContent ? (
                message.mediaPending ? (
                  <Text style={{ fontSize: 12, fontStyle: 'italic', color: palette.textMuted }}>
                    {message.mediaType?.startsWith('image')
                      ? '📷 Imagen'
                      : message.mediaType?.startsWith('video')
                      ? '🎥 Video'
                      : message.mediaType?.startsWith('audio')
                      ? '🎵 Audio'
                      : message.mediaType?.includes('pdf')
                      ? '📄 Documento'
                      : '📎 Archivo'}{' '}
                    · cargando…
                  </Text>
                ) : message.mediaType ? (
                  <Text style={{ fontSize: 12, fontStyle: 'italic', color: palette.textMuted }}>
                    {message.mediaType.startsWith('image')
                      ? '📷 Imagen no disponible'
                      : message.mediaType.startsWith('video')
                      ? '🎥 Video no disponible'
                      : message.mediaType.startsWith('audio')
                      ? '🎵 Audio no disponible'
                      : message.mediaType.includes('pdf')
                      ? '📄 Documento no disponible'
                      : '📎 Archivo no disponible'}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, fontStyle: 'italic', color: palette.textMuted }}>
                    [Reacción o mensaje no compatible]
                  </Text>
                )
              ) : null}
            </Pressable>

            {/* Píldora de reacción pegada a la burbuja */}
            {effectiveReaction ? (
              <Pressable
                onPress={() => onOpenReactionPicker(message)}
                style={[
                  styles.reactionFloatingPill,
                  isOutbound ? { left: -6 } : { right: -6 },
                  { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
                ]}
              >
                <Text style={{ fontSize: 12, lineHeight: 15 }}>{effectiveReaction}</Text>
              </Pressable>
            ) : null}
          </View>

          {canReactInbound && (
            <Pressable
              onPress={() => onOpenReactionPicker(message)}
              hitSlop={8}
              style={styles.quickSmileBtn}
            >
              <Icon name="Smile" size={14} color={palette.textSubtle} />
            </Pressable>
          )}
        </View>

        {/* Hora + Ticks de entrega */}
        {(timeStr || isOutbound) && (
          <View
            style={[
              styles.metaTimestampRow,
              effectiveReaction ? { marginTop: 8 } : { marginTop: 2 },
            ]}
          >
            {timeStr ? (
              <Text style={{ fontSize: 10, color: palette.textSubtle }}>{timeStr}</Text>
            ) : null}
            {isOutbound ? (
              <>
                {timeStr ? <Text style={{ fontSize: 10, color: palette.textSubtle }}>·</Text> : null}
                <DeliveryStatusTicks status={message.status} palette={palette} />
              </>
            ) : null}
          </View>
        )}

        {/* Traducción legible en español del código de error de Meta/WhatsApp */}
        {failExplanation && (
          <View
            style={[
              styles.failureReasonBox,
              { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
            ]}
          >
            <Text style={{ fontSize: 10.5, lineHeight: 14, color: palette.roseText }}>
              {failExplanation}
            </Text>
          </View>
        )}

        {/* Etiqueta de Ruta de Línea (🏢 Ventas 317 / 📱 Mi WhatsApp) */}
        <View
          style={[
            styles.routePill,
            { backgroundColor: palette.bgCardSoft, borderColor: palette.border },
          ]}
        >
          <Text numberOfLines={1} style={{ fontSize: 9.5, color: palette.textSubtle }}>
            {route.text}
          </Text>
        </View>
      </View>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.status === next.message.status &&
    prev.message.mediaUrl === next.message.mediaUrl &&
    prev.message.mediaPending === next.message.mediaPending &&
    prev.message.content === next.message.content &&
    prev.effectiveReaction === next.effectiveReaction &&
    prev.advisorName === next.advisorName &&
    prev.palette.mode === next.palette.mode
);

function DeliveryStatusTicks({
  status,
  palette,
}: {
  status: MessageStatus;
  palette: MerakiThemePalette;
}) {
  const map: Record<MessageStatus, { icon: string; label: string; color: string; bold?: boolean }> = {
    pending: { icon: '🕓', label: 'Enviando…', color: palette.textSubtle },
    sent: { icon: '✓', label: 'Enviado', color: palette.textSubtle },
    delivered: { icon: '✓✓', label: 'Entregado', color: palette.textMuted },
    read: { icon: '✓✓', label: 'Leído', color: palette.sky, bold: true },
    failed: { icon: '⚠', label: 'No entregado', color: palette.rose, bold: true },
  };
  const cfg = map[status] ?? map.sent;
  return (
    <Text style={{ fontSize: 10, color: cfg.color, fontWeight: cfg.bold ? '700' : '500' }}>
      {cfg.icon} {cfg.label}
    </Text>
  );
}

function resolveMediaKind(message: Message): NonNullable<Message['mediaKind']> {
  const mediaKind = message.mediaKind;
  const mediaType = (message.mediaType ?? '').toLowerCase();
  const urlPath = decodeURIComponent((message.mediaUrl ?? '').split('?')[0]).toLowerCase();

  if (mediaKind === 'sticker' || (mediaType === 'image/webp' && !message.content?.trim())) {
    return 'sticker';
  }
  if (
    mediaKind === 'image' ||
    mediaType.startsWith('image/') ||
    /\.(jpe?g|png|gif|webp)$/.test(urlPath)
  ) {
    return 'image';
  }
  if (
    mediaKind === 'video' ||
    mediaType.startsWith('video/') ||
    /\.(mp4|3gp|mov|m4v|webm)$/.test(urlPath)
  ) {
    return 'video';
  }
  if (
    mediaKind === 'audio' ||
    mediaType.startsWith('audio/') ||
    /\.(mp3|m4a|aac|ogg|oga|wav|opus)$/.test(urlPath)
  ) {
    return 'audio';
  }
  if (mediaKind === 'document' || mediaType === 'application/pdf' || /\.pdf$/.test(urlPath)) {
    return 'document';
  }
  return 'file';
}

function MediaMessageContent({
  message,
  kind,
  outbound,
  palette,
  onOpenImage,
}: {
  message: Message;
  kind: NonNullable<Message['mediaKind']>;
  outbound: boolean;
  palette: MerakiThemePalette;
  onOpenImage: (url: string) => void;
}) {
  const url = message.mediaUrl!;

  if (kind === 'sticker') {
    return (
      <Pressable onPress={() => onOpenImage(url)} style={styles.stickerMediaSize}>
        <ExpoImage
          source={{ uri: url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
        />
      </Pressable>
    );
  }

  if (kind === 'image') {
    return (
      <Pressable
        onPress={() => onOpenImage(url)}
        style={[styles.imageMediaBox, { backgroundColor: palette.bgElevated }]}
      >
        <ExpoImage
          source={{ uri: url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
        <View style={styles.zoomHintPill}>
          <Ionicons name="expand-outline" size={12} color="#ffffff" />
        </View>
      </Pressable>
    );
  }

  if (kind === 'video') {
    return <InlineVideoPlayer uri={url} />;
  }

  if (kind === 'audio') {
    return <WhatsAppVoicePlayer uri={url} outbound={outbound} palette={palette} />;
  }

  const isPdf = kind === 'document';
  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={[
        styles.documentMediaCard,
        {
          backgroundColor: palette.isDark ? 'rgba(9, 9, 11, 0.55)' : palette.bgElevated,
          borderColor: palette.borderStrong,
        },
      ]}
    >
      <View
        style={[
          styles.docIconCircle,
          { backgroundColor: isPdf ? palette.brandSoft : palette.skyBg },
        ]}
      >
        <Text style={{ fontSize: 18 }}>{isPdf ? '📄' : '📎'}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 12.5, fontWeight: '700', color: palette.textPrimary }}
        >
          {message.fileName || (isPdf ? 'Documento PDF' : 'Archivo adjunto')}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 10.5, color: palette.textMuted, marginTop: 1 }}>
          Toca para abrir o descargar
        </Text>
      </View>
      <Icon name="Download" size={15} color={palette.textMuted} />
    </Pressable>
  );
}

function InlineVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <View style={styles.inlineVideoBox}>
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
      />
    </View>
  );
}

const STATIC_AUDIO_WAVE = [
  0.35, 0.6, 0.45, 0.85, 0.55, 0.95, 0.4, 0.75, 0.62, 0.3, 0.8, 0.9, 0.5, 0.68, 0.42, 0.88, 0.52,
  0.74, 0.38, 0.65, 0.82, 0.48, 0.58, 0.35,
];

function WhatsAppVoicePlayer({
  uri,
  outbound,
  palette,
}: {
  uri: string;
  outbound: boolean;
  palette: MerakiThemePalette;
}) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const playback = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);

  const playing = playback.playing;
  const duration = playback.duration || 0;
  const current = playback.currentTime || 0;
  const pct = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;

  const togglePlay = async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      if (playing) {
        player.pause();
      } else {
        if (playback.didJustFinish || (duration > 0 && current >= duration - 0.15)) {
          await player.seekTo(0);
        }
        player.play();
      }
    } catch {
      Linking.openURL(uri).catch(() => {});
    }
  };

  const cycleSpeed = () => {
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    try {
      player.setPlaybackRate(next, 'high');
    } catch {}
  };

  const accent = outbound ? palette.brand : palette.emerald;

  return (
    <View style={styles.voiceNoteWrap}>
      <Pressable
        onPress={togglePlay}
        style={[
          styles.voicePlayBtn,
          { backgroundColor: accent },
        ]}
      >
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={17}
          color="#ffffff"
          style={!playing ? { marginLeft: 2 } : undefined}
        />
      </Pressable>

      <View style={{ flex: 1, minWidth: 138, gap: 4 }}>
        <View style={styles.voiceBarsRow}>
          {STATIC_AUDIO_WAVE.map((lvl, idx) => {
            const barFilled = idx / STATIC_AUDIO_WAVE.length <= pct;
            return (
              <View
                key={idx}
                style={{
                  width: 3,
                  height: Math.max(4, Math.round(lvl * 20)),
                  borderRadius: 2,
                  backgroundColor: barFilled
                    ? accent
                    : palette.isDark
                    ? 'rgba(255,255,255,0.22)'
                    : 'rgba(13,6,10,0.18)',
                }}
              />
            );
          })}
        </View>

        <View style={styles.rowBetweenCenter}>
          <Text
            style={{
              fontSize: 10,
              color: palette.textMuted,
              fontVariant: ['tabular-nums'],
            }}
          >
            {playing || current > 0 ? formatAudioClock(current) : formatAudioClock(duration)}
            {duration > 0 ? ` / ${formatAudioClock(duration)}` : ''}
          </Text>

          <Pressable
            onPress={cycleSpeed}
            hitSlop={6}
            style={[
              styles.speedChip,
              {
                backgroundColor: palette.isDark ? 'rgba(0,0,0,0.28)' : 'rgba(13,6,10,0.08)',
              },
            ]}
          >
            <Text style={{ fontSize: 9.5, fontWeight: '800', color: palette.textSecondary }}>
              {speed}x
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdReferralCard (Creativo de Meta Ads con video MP4 o miniatura + enlace FB)
// ─────────────────────────────────────────────────────────────────────────────

function AdReferralCard({
  referral,
  companyId,
  leadId,
  palette,
}: {
  referral: LeadSourceMeta;
  companyId?: string;
  leadId?: string;
  palette: MerakiThemePalette;
}) {
  const [creative, setCreative] = useState<MetaAdCreative | null>(null);
  const [fetching, setFetching] = useState(false);

  const directPlayable = isPlayableVideoUrl(referral.videoUrl);

  useEffect(() => {
    if ((directPlayable && referral.imageUrl) || !referral.adId || !companyId) return;
    let cancelled = false;
    setFetching(true);

    (async () => {
      try {
        const cached = await firestore()
          .collection('companies')
          .doc(companyId)
          .collection('metaAdCreatives')
          .doc(referral.adId!)
          .get();

        if (!cancelled && snapExists(cached)) {
          const d = cached.data() ?? {};
          if (d.videoUrl || d.imageUrl) {
            setCreative({
              adId: referral.adId!,
              headline: d.headline,
              body: d.body,
              mediaType: d.mediaType || (d.videoUrl ? 'video' : 'image'),
              videoUrl: d.videoUrl,
              imageUrl: d.imageUrl,
              sourceUrl: d.sourceUrl,
            });
            setFetching(false);
            return;
          }
        }

        const callable = httpsCallable<
          { companyId: string; adId: string; leadId?: string },
          { creative?: MetaAdCreative }
        >(functionsInstance, 'getMetaAdCreative');
        const res = await callable({ companyId, adId: referral.adId!, leadId });
        if (!cancelled && res.data?.creative) {
          setCreative(res.data.creative);
        }
      } catch {
        // Fallback silencioso a los datos presentes en referral
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, referral.adId, referral.imageUrl, directPlayable, leadId]);

  const videoUrl = directPlayable
    ? referral.videoUrl
    : isPlayableVideoUrl(creative?.videoUrl)
    ? creative?.videoUrl
    : undefined;
  const imageUrl = referral.imageUrl || creative?.imageUrl;
  const isVideo =
    referral.mediaType === 'video' || creative?.mediaType === 'video' || Boolean(videoUrl);
  const headline = referral.headline || creative?.headline || 'Anuncio de Meta';
  const body = referral.body || creative?.body;
  const nonPlayableVideoLink =
    referral.videoUrl && !isPlayableVideoUrl(referral.videoUrl) ? referral.videoUrl : undefined;
  const sourceUrl = referral.sourceUrl || nonPlayableVideoLink || creative?.sourceUrl;

  return (
    <View
      style={[
        styles.adReferralCard,
        { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
      ]}
    >
      <View style={[styles.adReferralHeader, { borderBottomColor: palette.border }]}>
        <View style={styles.rowCenterGap6}>
          <Icon name="Megaphone" size={13} color={palette.brand} />
          <Text
            style={{
              fontSize: 10.5,
              fontWeight: '800',
              color: palette.brandText,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            Anuncio de Meta
          </Text>
        </View>

        <View style={styles.rowCenterGap6}>
          {fetching && <ActivityIndicator size="small" color={palette.brand} />}
          <View
            style={[
              styles.inlineMicroChip,
              { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
            ]}
          >
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                color: isVideo ? palette.amber : palette.sky,
              }}
            >
              {isVideo ? '🎬 Video' : '🖼️ Imagen'}
            </Text>
          </View>
        </View>
      </View>

      {videoUrl ? (
        <View style={styles.adVideoContainer}>
          <AdVideoPlayer uri={videoUrl} />
        </View>
      ) : imageUrl ? (
        <View style={styles.adImageContainer}>
          <ExpoImage
            source={{ uri: imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          {sourceUrl ? (
            <Pressable
              onPress={() => Linking.openURL(sourceUrl)}
              style={styles.adPlayOverlay}
            >
              <View style={[styles.adPlayCircle, { backgroundColor: palette.brand }]}>
                <Ionicons name="play" size={20} color="#ffffff" style={{ marginLeft: 2 }} />
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: 8, gap: 3 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: palette.textPrimary }}>
          {headline}
        </Text>
        {body ? (
          <Text
            numberOfLines={3}
            style={{ fontSize: 11, lineHeight: 16, color: palette.textMuted }}
          >
            {body}
          </Text>
        ) : null}
      </View>

      {sourceUrl ? (
        <Pressable
          onPress={() => Linking.openURL(sourceUrl)}
          style={[
            styles.adFacebookBtn,
            { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
          ]}
        >
          <Ionicons name="logo-facebook" size={13} color={palette.brandText} />
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: palette.brandText }}>
            {videoUrl ? 'Ver anuncio en Facebook ↗' : 'Ver video del anuncio en Facebook ↗'}
          </Text>
        </Pressable>
      ) : null}

      {referral.adId ? (
        <Text
          style={{
            marginTop: 5,
            textAlign: 'right',
            fontSize: 9,
            color: palette.textSubtle,
          }}
        >
          Ad ID: {referral.adId}
        </Text>
      ) : null}
    </View>
  );
}

function AdVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pie de Ventana 24h Cerrada (cuando tampoco hay Mi WhatsApp disponible)
// ─────────────────────────────────────────────────────────────────────────────

function ClosedWindowFooter({
  palette,
  onOpenTemplates,
}: {
  palette: MerakiThemePalette;
  onOpenTemplates: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.closedFooterBox,
        {
          backgroundColor: palette.bgCanvas,
          borderTopColor: palette.border,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <View style={styles.rowCenterGap6}>
        <View style={[styles.windowDot, { backgroundColor: palette.amber }]} />
        <Text style={{ fontSize: 12, fontWeight: '800', color: palette.amberText }}>
          Ventana de 24h cerrada
        </Text>
      </View>
      <Text
        style={{
          fontSize: 11.5,
          lineHeight: 16,
          color: palette.textMuted,
          textAlign: 'center',
          maxWidth: 310,
        }}
      >
        Han pasado más de 24h desde el último mensaje del prospecto. Solo puedes enviar plantillas pre-aprobadas por Meta.
      </Text>
      <Pressable
        onPress={onOpenTemplates}
        style={[styles.closedFooterBtn, { backgroundColor: palette.brand }]}
      >
        <Text style={{ fontSize: 13, fontWeight: '800', color: '#ffffff' }}>
          📋 Enviar plantilla oficial de WhatsApp
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageComposerBar + VoiceRecorder + Attachment Sheet + PortfolioPicker
// ─────────────────────────────────────────────────────────────────────────────

function MessageComposerBar({
  companyId,
  lead,
  palette,
  companyLineLabel,
  advisorWhatsappAvailable,
  defaultDeliveryChannel,
  companyLineDisabled,
}: {
  companyId: string;
  lead: Lead;
  palette: MerakiThemePalette;
  companyLineLabel: string;
  advisorWhatsappAvailable: boolean;
  defaultDeliveryChannel: DeliveryChannel;
  companyLineDisabled: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>(defaultDeliveryChannel);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [pendingMedia, setPendingMedia] = useState<UploadedMedia | null>(null);
  const [localPreviewUri, setLocalPreviewUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [portfoliosOpen, setPortfoliosOpen] = useState(false);

  // Grabadora de voz preservando RecordingPresets.HIGH_QUALITY (.m4a AAC nítido) + metering para waveform
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 120);

  const [voiceMode, setVoiceMode] = useState<'idle' | 'recording' | 'preview'>('idle');
  const [audioLevels, setAudioLevels] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0.16));
  const [frozenLevels, setFrozenLevels] = useState<number[]>([]);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationSec, setRecordedDurationSec] = useState(0);

  useEffect(() => {
    if (!companyLineDisabled || !advisorWhatsappAvailable) {
      setDeliveryChannel(defaultDeliveryChannel);
    }
  }, [defaultDeliveryChannel, companyLineDisabled, advisorWhatsappAvailable]);

  useEffect(() => {
    if (!advisorWhatsappAvailable && deliveryChannel === 'advisor_whatsapp') {
      setDeliveryChannel('company_whatsapp');
    }
    if (companyLineDisabled && advisorWhatsappAvailable && deliveryChannel === 'company_whatsapp') {
      setDeliveryChannel('advisor_whatsapp');
    }
  }, [advisorWhatsappAvailable, companyLineDisabled, deliveryChannel]);

  // Alimentar las barras del waveform en vivo mientras graba
  useEffect(() => {
    if (!recorderState.isRecording) return;
    let normalized = 0.25;
    if (typeof recorderState.metering === 'number' && Number.isFinite(recorderState.metering)) {
      // metering dBFS suele ir de -60 (silencio) a 0 (máximo)
      const clampedDb = Math.max(-55, Math.min(0, recorderState.metering));
      normalized = Math.max(0.12, Math.min(1, (clampedDb + 55) / 55));
    } else {
      const t = recorderState.durationMillis / 180;
      normalized = 0.22 + Math.abs(Math.sin(t)) * 0.45 + Math.random() * 0.2;
    }
    setAudioLevels((prev) => [...prev.slice(1), normalized]);
  }, [recorderState.isRecording, recorderState.durationMillis, recorderState.metering]);

  const handleUploadLocalFile = async (file: LocalFile, previewUri?: string) => {
    setErrorMsg(null);
    setLocalPreviewUri(previewUri ?? null);
    setUploading(true);
    setUploadPct(0);
    try {
      const uploaded = await uploadMedia(companyId, lead.id, file, setUploadPct);
      setPendingMedia(uploaded);
    } catch (err) {
      setLocalPreviewUri(null);
      const detail = err instanceof Error ? err.message : 'Revisa tu conexión e inténtalo de nuevo.';
      setErrorMsg(detail);
    } finally {
      setUploading(false);
    }
  };

  const pickFromGallery = async () => {
    setAttachSheetOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso requerido', 'Permite el acceso a tu galería para adjuntar fotos o videos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.82,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video/');
    const ext = isVideo ? 'mp4' : 'jpg';
    const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    await handleUploadLocalFile(
      {
        uri: asset.uri,
        name: asset.fileName ?? `galeria_${Date.now()}.${ext}`,
        mimeType,
        size: asset.fileSize,
      },
      !isVideo ? asset.uri : undefined
    );
  };

  const takeCameraPhoto = async () => {
    setAttachSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso requerido', 'Permite el acceso a la cámara para tomar fotografías.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.82,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    await handleUploadLocalFile(
      {
        uri: asset.uri,
        name: asset.fileName ?? `foto_${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize,
      },
      asset.uri
    );
  };

  const pickDocumentPdf = async () => {
    setAttachSheetOpen(false);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    await handleUploadLocalFile(
      {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/pdf',
        size: asset.size,
      },
      asset.mimeType?.startsWith('image/') ? asset.uri : undefined
    );
  };

  const handleSelectPortfolioItem = (item: LibraryItem) => {
    setPortfoliosOpen(false);
    setErrorMsg(null);
    setLocalPreviewUri(item.contentType.startsWith('image/') ? item.downloadUrl : null);
    setPendingMedia({
      downloadUrl: item.downloadUrl,
      storagePath: item.storagePath,
      contentType: item.contentType,
      fileName: item.fileName,
    });
  };

  const removePendingMedia = () => {
    setPendingMedia(null);
    setLocalPreviewUri(null);
  };

  const handleSendTextOrAttachment = async () => {
    const content = text.trim();
    if ((!content && !pendingMedia) || sending || uploading) return;

    const mediaSnapshot = pendingMedia;
    const previewSnapshot = localPreviewUri;
    setErrorMsg(null);
    setText('');
    setPendingMedia(null);
    setLocalPreviewUri(null);
    setSending(true);

    try {
      await sendMessage(companyId, lead.id, content, mediaSnapshot ?? undefined, deliveryChannel);
    } catch (err) {
      setText(content);
      setPendingMedia(mediaSnapshot);
      setLocalPreviewUri(previewSnapshot);
      const reason = (err as { message?: string })?.message;
      setErrorMsg(
        reason && reason.length < 220
          ? reason
          : 'No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo.'
      );
    } finally {
      setSending(false);
    }
  };

  // ── Acciones de Nota de Voz (.m4a con configuración de audio clara) ─────────
  const startVoiceRecording = async () => {
    setErrorMsg(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso requerido', 'Activa el micrófono para grabar notas de voz.');
        return;
      }
      setRecordedUri(null);
      setFrozenLevels([]);
      setAudioLevels(Array(WAVEFORM_BARS).fill(0.16));
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoiceMode('recording');
    } catch {
      setErrorMsg('No se pudo iniciar el micrófono. Verifica los permisos de la app.');
    }
  };

  const stopToPreviewVoice = async () => {
    try {
      const durationSec = Math.max(1, Math.round(recorderState.durationMillis / 1000));
      const snapshotLevels = [...audioLevels];
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      const uri = recorder.uri;
      if (!uri) {
        setVoiceMode('idle');
        return;
      }
      setRecordedDurationSec(durationSec);
      setFrozenLevels(snapshotLevels);
      setRecordedUri(uri);
      setVoiceMode('preview');
    } catch {
      setVoiceMode('idle');
    }
  };

  const cancelVoiceRecording = async () => {
    try {
      if (recorderState.isRecording) {
        await recorder.stop();
      }
    } catch {}
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    setRecordedUri(null);
    setFrozenLevels([]);
    setVoiceMode('idle');
  };

  const uploadAndSendVoiceUri = async (uri: string) => {
    setSending(true);
    setUploading(true);
    setUploadPct(0);
    try {
      const uploaded = await uploadMedia(
        companyId,
        lead.id,
        {
          uri,
          name: `voz_${Date.now()}.m4a`,
          mimeType: 'audio/mp4',
        },
        setUploadPct
      );
      await sendMessage(companyId, lead.id, '', uploaded, deliveryChannel);
      setRecordedUri(null);
      setFrozenLevels([]);
      setVoiceMode('idle');
    } catch {
      Alert.alert('No se envió la nota de voz', 'Revisa tu conexión e intenta nuevamente.');
    } finally {
      setSending(false);
      setUploading(false);
    }
  };

  const stopAndSendImmediately = async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      const uri = recorder.uri;
      if (!uri) {
        setVoiceMode('idle');
        return;
      }
      await uploadAndSendVoiceUri(uri);
    } catch {
      setVoiceMode('idle');
      Alert.alert('No se envió el audio', 'Intenta nuevamente.');
    }
  };

  // Vista activa: Grabando o Previsualizando Nota de Voz
  if (voiceMode === 'recording' || recorderState.isRecording) {
    const liveSeconds = Math.floor(recorderState.durationMillis / 1000);
    return (
      <View
        style={[
          styles.voiceRecorderContainer,
          {
            backgroundColor: palette.bgCanvas,
            borderTopColor: palette.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <Pressable
          onPress={cancelVoiceRecording}
          hitSlop={8}
          style={[styles.voiceTrashBtn, { backgroundColor: palette.roseBg }]}
        >
          <Icon name="Trash2" size={17} color={palette.rose} />
        </Pressable>

        <View style={[styles.voiceWaveformPill, { backgroundColor: palette.bgElevated }]}>
          <View style={[styles.recordingPulseDot, { backgroundColor: palette.rose }]} />
          <View style={styles.liveWaveformRow}>
            {audioLevels.map((lvl, idx) => (
              <View
                key={idx}
                style={{
                  width: 3,
                  height: Math.max(4, Math.round(lvl * 24)),
                  borderRadius: 2,
                  backgroundColor: palette.brand,
                  opacity: 0.45 + lvl * 0.55,
                }}
              />
            ))}
          </View>
          <Text style={[styles.voiceTimerText, { color: palette.textPrimary }]}>
            {formatDurationMMSS(liveSeconds)}
          </Text>
        </View>

        <Pressable
          onPress={stopToPreviewVoice}
          style={[
            styles.voiceStopBtn,
            { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
          ]}
        >
          <Icon name="Pause" size={16} color={palette.brand} />
        </Pressable>

        <Pressable
          onPress={stopAndSendImmediately}
          disabled={sending}
          style={[styles.merakiSendCircle, { backgroundColor: palette.brand }]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Icon name="Send" size={16} color="#ffffff" />
          )}
        </Pressable>
      </View>
    );
  }

  if (voiceMode === 'preview' && recordedUri) {
    return (
      <VoiceRecordedPreviewBar
        uri={recordedUri}
        levels={frozenLevels}
        durationSec={recordedDurationSec}
        sending={sending || uploading}
        palette={palette}
        bottomInset={insets.bottom}
        onCancel={cancelVoiceRecording}
        onSend={() => void uploadAndSendVoiceUri(recordedUri)}
      />
    );
  }

  const hasSendablePayload = Boolean(text.trim() || pendingMedia);

  return (
    <View
      style={[
        styles.composerContainer,
        {
          backgroundColor: palette.bgCanvas,
          borderTopColor: palette.border,
          paddingBottom: 8,
        },
      ]}
    >
      {/* Modal selector de adjuntos (Galería, Cámara, PDF, Portafolio) */}
      <AttachmentActionSheet
        visible={attachSheetOpen}
        palette={palette}
        onPickGallery={pickFromGallery}
        onTakePhoto={takeCameraPhoto}
        onPickPdf={pickDocumentPdf}
        onOpenPortfolio={() => {
          setAttachSheetOpen(false);
          setPortfoliosOpen(true);
        }}
        onClose={() => setAttachSheetOpen(false)}
      />

      {/* Modal 2 niveles Portafolio Meraki + Planos Interactivos */}
      <PortfolioPickerModal
        visible={portfoliosOpen}
        companyId={companyId}
        palette={palette}
        onSelect={handleSelectPortfolioItem}
        onClose={() => setPortfoliosOpen(false)}
      />

      {/* Alerta de error de envío/carga */}
      {errorMsg && (
        <View
          style={[
            styles.composerErrorBanner,
            { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
          ]}
        >
          <Text style={{ flex: 1, fontSize: 11.5, color: palette.roseText }}>{errorMsg}</Text>
          <Pressable onPress={() => setErrorMsg(null)} hitSlop={8}>
            <Icon name="X" size={14} color={palette.roseText} />
          </Pressable>
        </View>
      )}

      {/* Previsualización de archivo adjunto o progreso de subida */}
      {(pendingMedia || uploading) && (
        <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
          <View
            style={[
              styles.pendingAttachmentRow,
              { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
            ]}
          >
            {uploading ? (
              <>
                <ActivityIndicator size="small" color={palette.brand} />
                <Text style={{ fontSize: 11.5, color: palette.textSecondary }}>
                  Subiendo… {uploadPct}%
                </Text>
                <View style={[styles.uploadTrack, { backgroundColor: palette.bgSubtle }]}>
                  <View
                    style={{
                      height: '100%',
                      width: `${uploadPct}%`,
                      backgroundColor: palette.brand,
                    }}
                  />
                </View>
              </>
            ) : pendingMedia ? (
              <>
                {localPreviewUri && pendingMedia.contentType.startsWith('image/') ? (
                  <ExpoImage
                    source={{ uri: localPreviewUri }}
                    style={styles.pendingThumb}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.pendingFileIconBox, { backgroundColor: palette.brandSoft }]}>
                    <Icon
                      name={
                        pendingMedia.contentType.startsWith('video/')
                          ? 'Video'
                          : pendingMedia.contentType.startsWith('audio/')
                          ? 'Mic'
                          : 'FileText'
                      }
                      size={16}
                      color={palette.brand}
                    />
                  </View>
                )}
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 12, fontWeight: '600', color: palette.textPrimary }}
                >
                  {pendingMedia.fileName}
                </Text>
                <Pressable onPress={removePendingMedia} hitSlop={8}>
                  <Icon name="X" size={16} color={palette.textMuted} />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      )}

      {/* Fila principal de entrada: [📎] [📁] [TextInput] [Enviar / Mic #B7871C] */}
      <View style={styles.composerInputRow}>
        <Pressable
          disabled={sending || uploading}
          onPress={() => setAttachSheetOpen(true)}
          style={[
            styles.composerSquareBtn,
            { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
            (sending || uploading) && { opacity: 0.45 },
          ]}
        >
          <Icon name="Paperclip" size={18} color={palette.textSecondary} />
        </Pressable>

        <Pressable
          disabled={sending || uploading}
          onPress={() => setPortfoliosOpen(true)}
          style={[
            styles.composerSquareBtn,
            { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
            (sending || uploading) && { opacity: 0.45 },
          ]}
        >
          <Icon name="FolderOpen" size={18} color={palette.brandText} />
        </Pressable>

        <TextInput
          value={text}
          onChangeText={setText}
          editable={!sending}
          multiline
          maxLength={2000}
          placeholder="Escribe un mensaje…"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.composerTextInput,
            {
              backgroundColor: palette.bgInput,
              borderColor: palette.borderInput,
              color: palette.textPrimary,
            },
          ]}
        />

        {hasSendablePayload ? (
          <Pressable
            disabled={sending || uploading}
            onPress={handleSendTextOrAttachment}
            style={[
              styles.merakiSendCircle,
              { backgroundColor: palette.brand },
              (sending || uploading) && { opacity: 0.5 },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Icon name="Send" size={16} color="#ffffff" />
            )}
          </Pressable>
        ) : (
          <Pressable
            disabled={sending || uploading}
            onPress={startVoiceRecording}
            style={[
              styles.merakiSendCircle,
              { backgroundColor: palette.brand },
              (sending || uploading) && { opacity: 0.5 },
            ]}
          >
            <Icon name="Mic" size={18} color="#ffffff" />
          </Pressable>
        )}
      </View>

      {/* Selector de Canal: Enviar por [🏢 Ventas 317 | 📱 Mi WhatsApp] */}
      <View style={styles.channelToggleRow}>
        <Text style={{ fontSize: 10.5, fontWeight: '600', color: palette.textSubtle }}>
          Enviar por
        </Text>
        <View
          style={[
            styles.channelSegmentedWrap,
            { backgroundColor: palette.bgCard, borderColor: palette.border },
          ]}
        >
          <Pressable
            disabled={companyLineDisabled}
            onPress={() => setDeliveryChannel('company_whatsapp')}
            style={[
              styles.channelSegmentBtn,
              deliveryChannel === 'company_whatsapp' && {
                backgroundColor: palette.brandSoft,
                borderColor: palette.brandBorder,
                borderWidth: 1,
              },
              companyLineDisabled && { opacity: 0.4 },
            ]}
          >
            <Text style={{ fontSize: 11 }}>🏢</Text>
            <Text
              style={{
                fontSize: 11,
                fontWeight: deliveryChannel === 'company_whatsapp' ? '800' : '600',
                color:
                  deliveryChannel === 'company_whatsapp' ? palette.brandText : palette.textMuted,
              }}
            >
              {companyLineLabel === 'Sin número' ? 'Ventas 317' : companyLineLabel}
            </Text>
          </Pressable>

          <Pressable
            disabled={!advisorWhatsappAvailable}
            onPress={() => setDeliveryChannel('advisor_whatsapp')}
            style={[
              styles.channelSegmentBtn,
              deliveryChannel === 'advisor_whatsapp' && {
                backgroundColor: palette.emeraldBg,
                borderColor: palette.emeraldBorder,
                borderWidth: 1,
              },
              !advisorWhatsappAvailable && { opacity: 0.4 },
            ]}
          >
            <Text style={{ fontSize: 11 }}>📱</Text>
            <Text
              style={{
                fontSize: 11,
                fontWeight: deliveryChannel === 'advisor_whatsapp' ? '800' : '600',
                color:
                  deliveryChannel === 'advisor_whatsapp'
                    ? palette.emeraldText
                    : palette.textMuted,
              }}
            >
              Mi WhatsApp
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function VoiceRecordedPreviewBar({
  uri,
  levels,
  durationSec,
  sending,
  palette,
  bottomInset,
  onCancel,
  onSend,
}: {
  uri: string;
  levels: number[];
  durationSec: number;
  sending: boolean;
  palette: MerakiThemePalette;
  bottomInset: number;
  onCancel: () => void;
  onSend: () => void;
}) {
  const player = useAudioPlayer({ uri }, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const total = status.duration > 0 ? status.duration : Math.max(1, durationSec);
  const current = status.currentTime || 0;
  const pct = Math.max(0, Math.min(100, (current / total) * 100));

  const togglePreview = async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    });
    if (playing) {
      player.pause();
    } else {
      if (status.didJustFinish || current >= total - 0.1) {
        await player.seekTo(0);
      }
      player.play();
    }
  };

  const bars = levels.length > 0 ? levels : Array(WAVEFORM_BARS).fill(0.32);

  return (
    <View
      style={[
        styles.voiceRecorderContainer,
        {
          backgroundColor: palette.bgCanvas,
          borderTopColor: palette.border,
          paddingBottom: Math.max(bottomInset, 12),
        },
      ]}
    >
      <Pressable
        onPress={onCancel}
        disabled={sending}
        hitSlop={8}
        style={[styles.voiceTrashBtn, { backgroundColor: palette.roseBg }]}
      >
        <Icon name="Trash2" size={17} color={palette.rose} />
      </Pressable>

      <View style={[styles.voiceWaveformPill, { backgroundColor: palette.bgElevated }]}>
        <Pressable
          onPress={togglePreview}
          style={[styles.previewPlayCircle, { backgroundColor: palette.brandSoft }]}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={15}
            color={palette.brandText}
            style={!playing ? { marginLeft: 1 } : undefined}
          />
        </Pressable>

        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.liveWaveformRow}>
            {bars.map((lvl, idx) => (
              <View
                key={idx}
                style={{
                  width: 3,
                  height: Math.max(4, Math.round(lvl * 22)),
                  borderRadius: 2,
                  backgroundColor: palette.brand,
                  opacity: (idx / bars.length) * 100 <= pct ? 1 : 0.45,
                }}
              />
            ))}
          </View>
          <View style={[styles.previewProgressBar, { backgroundColor: palette.bgSubtle }]}>
            <View
              style={{
                height: '100%',
                width: `${pct}%`,
                backgroundColor: palette.brand,
              }}
            />
          </View>
        </View>

        <Text style={[styles.voiceTimerText, { color: palette.textSecondary }]}>
          {formatDurationMMSS(playing ? Math.round(current) : Math.round(total))}
        </Text>
      </View>

      <Pressable
        onPress={onSend}
        disabled={sending}
        style={[
          styles.merakiSendCircle,
          { backgroundColor: palette.brand },
          sending && { opacity: 0.6 },
        ]}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Icon name="Send" size={16} color="#ffffff" />
        )}
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AttachmentActionSheet (Galería Foto/Video, Cámara, Documento PDF, Portafolio)
// ─────────────────────────────────────────────────────────────────────────────

function AttachmentActionSheet({
  visible,
  palette,
  onPickGallery,
  onTakePhoto,
  onPickPdf,
  onOpenPortfolio,
  onClose,
}: {
  visible: boolean;
  palette: MerakiThemePalette;
  onPickGallery: () => void;
  onTakePhoto: () => void;
  onPickPdf: () => void;
  onOpenPortfolio: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  const actions = [
    {
      key: 'gallery',
      title: 'Galería (Foto o Video)',
      sub: 'Imágenes hasta 5 MB · Videos cortos hasta 16 MB',
      icon: 'Image' as const,
      tint: palette.sky,
      bg: palette.skyBg,
      onPress: onPickGallery,
    },
    {
      key: 'camera',
      title: 'Cámara Fotográfica',
      sub: 'Tomar fotografía en vivo para enviar al cliente',
      icon: 'Camera' as const,
      tint: palette.emerald,
      bg: palette.emeraldBg,
      onPress: onTakePhoto,
    },
    {
      key: 'pdf',
      title: 'Documento PDF o Imagen',
      sub: 'Cotizaciones, documentos y fichas hasta 100 MB',
      icon: 'FileText' as const,
      tint: palette.brand,
      bg: palette.brandSoft,
      onPress: onPickPdf,
    },
    {
      key: 'portfolio',
      title: 'Portafolio Meraki & Planos en Vivo',
      sub: 'Mi Tarjeta de Presentación, Brochures y Disponibilidad',
      icon: 'FolderOpen' as const,
      tint: palette.brand,
      bg: palette.brandSoft,
      onPress: onOpenPortfolio,
    },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.sheetBackdrop, { backgroundColor: palette.backdrop }]} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.bottomSheetCard,
            {
              backgroundColor: palette.bgCard,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom + 10, 20),
            },
          ]}
        >
          <View style={[styles.sheetHeaderRow, { borderBottomColor: palette.border }]}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: palette.textPrimary }}>
              Adjuntar contenido
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="X" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          <View style={{ padding: 12, gap: 8 }}>
            {actions.map((act) => (
              <Pressable
                key={act.key}
                onPress={act.onPress}
                style={[
                  styles.attachActionItem,
                  { backgroundColor: palette.bgElevated, borderColor: palette.border },
                ]}
              >
                <View style={[styles.attachIconCircle, { backgroundColor: act.bg }]}>
                  <Icon name={act.icon} size={18} color={act.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: palette.textPrimary }}>
                    {act.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 1 }}>
                    {act.sub}
                  </Text>
                </View>
                <Icon name="ChevronRight" size={16} color={palette.textSubtle} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioPickerModal (2 niveles: Mi Tarjeta + Proyectos Meraki + Planos vivos)
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioPickerModal({
  visible,
  companyId,
  palette,
  onSelect,
  onClose,
}: {
  visible: boolean;
  companyId: string;
  palette: MerakiThemePalette;
  onSelect: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user, profile, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role ?? profile?.role);
  const { items, loading } = useLibrary(visible ? companyId : null);

  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [planos, setPlanos] = useState<PlanoIndexItem[]>([]);

  useEffect(() => {
    if (!visible) setSelectedProject(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    fetchPlanosIndex().then((list) => {
      if (alive) setPlanos(list);
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  const planoGenAt = useMemo(() => {
    const m = new Map<string, string | null>();
    planos.forEach((p) => m.set(planoItemId(p.planoId), p.generatedAt));
    return m;
  }, [planos]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    const cardFolder = isAdmin ? 'Tarjetas de Presentación' : 'Mi Tarjeta de Presentación';

    items
      .filter((i) => {
        if (i.project === 'Tarjeta de Presentación' || i.kind === 'card') {
          return isAdmin || i.advisorId === user?.uid;
        }
        if ((i.visibility ?? 'general') === 'advisor') {
          return isAdmin || i.advisorId === user?.uid;
        }
        return true;
      })
      .forEach((i) => {
        const isCard = i.project === 'Tarjeta de Presentación' || i.kind === 'card';
        const key = isCard ? cardFolder : i.project?.trim() || NO_PROJECT;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(i);
      });

    if (planos.length > 0) {
      const keyByNorm = new Map<string, string>();
      [...map.keys()].forEach((k) => keyByNorm.set(normalizeProjectName(k), k));
      planos.forEach((p) => {
        const norm = normalizeProjectName(p.projectName);
        let groupKey = keyByNorm.get(norm);
        if (!groupKey) {
          groupKey = p.projectName || p.name;
          keyByNorm.set(norm, groupKey);
          map.set(groupKey, []);
        }
        map.set(groupKey, [
          planoToLibraryItem(p, companyId, groupKey),
          ...(map.get(groupKey) ?? []),
        ]);
      });
    }

    return map;
  }, [items, planos, companyId, isAdmin, user?.uid]);

  const projectNames = useMemo(() => {
    return [...groups.keys()].sort((a, b) => {
      const isCardA = a === 'Mi Tarjeta de Presentación' || a === 'Tarjetas de Presentación';
      const isCardB = b === 'Mi Tarjeta de Presentación' || b === 'Tarjetas de Presentación';
      if (isCardA && !isCardB) return -1;
      if (!isCardA && isCardB) return 1;
      if (a === NO_PROJECT) return 1;
      if (b === NO_PROJECT) return -1;

      const idxA = CANONICAL_PROJECT_ORDER.findIndex(
        (c) => normalizeProjectName(c) === normalizeProjectName(a)
      );
      const idxB = CANONICAL_PROJECT_ORDER.findIndex(
        (c) => normalizeProjectName(c) === normalizeProjectName(b)
      );
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b, 'es');
    });
  }, [groups]);

  useEffect(() => {
    if (!loading && selectedProject === null && projectNames.length === 1) {
      setSelectedProject(projectNames[0]);
    }
  }, [loading, selectedProject, projectNames]);

  const currentItems = useMemo(() => {
    const list = selectedProject ? groups.get(selectedProject) ?? [] : [];
    if (
      selectedProject === 'Tarjetas de Presentación' ||
      selectedProject === 'Mi Tarjeta de Presentación'
    ) {
      return [...list].sort((a, b) =>
        (a.advisorName || a.title).localeCompare(b.advisorName || b.title, 'es')
      );
    }
    return list;
  }, [selectedProject, groups]);

  if (!visible) return null;

  const showBack = selectedProject !== null && projectNames.length > 1;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.sheetBackdrop, { backgroundColor: palette.backdrop }]} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.portfolioSheet,
            {
              backgroundColor: palette.bgCard,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom + 8, 16),
            },
          ]}
        >
          <View style={[styles.sheetHeaderRow, { borderBottomColor: palette.border }]}>
            <View style={[styles.rowCenterGap6, { flex: 1, minWidth: 0 }]}>
              {showBack && (
                <Pressable onPress={() => setSelectedProject(null)} hitSlop={10}>
                  <Icon name="ChevronLeft" size={20} color={palette.textPrimary} />
                </Pressable>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: '800', color: palette.textPrimary }}
                >
                  {selectedProject ?? 'Portafolio Meraki & Planos'}
                </Text>
                <Text style={{ fontSize: 11, color: palette.textMuted }}>
                  {selectedProject
                    ? 'Toca un documento o plano para adjuntarlo'
                    : 'Selecciona tu tarjeta o la carpeta del proyecto'}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="X" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View style={{ paddingVertical: 36, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={palette.brand} />
                <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 8 }}>
                  Cargando biblioteca comercial…
                </Text>
              </View>
            ) : projectNames.length === 0 ? (
              <View style={{ paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: palette.textMuted, textAlign: 'center' }}>
                  No hay documentos cargados todavía. Un administrador puede subirlos en Configuración → Portafolios.
                </Text>
              </View>
            ) : selectedProject === null ? (
              projectNames.map((folderName) => {
                const isCardFolder =
                  folderName === 'Mi Tarjeta de Presentación' ||
                  folderName === 'Tarjetas de Presentación';
                const isAdminCards = folderName === 'Tarjetas de Presentación';
                const folderItems = groups.get(folderName) ?? [];
                const hasLivePlano = folderItems.some((item) => isPlanoItem(item));

                return (
                  <Pressable
                    key={folderName}
                    onPress={() => setSelectedProject(folderName)}
                    style={[
                      styles.portfolioFolderRow,
                      isCardFolder
                        ? { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }
                        : { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.attachIconCircle,
                        { backgroundColor: isCardFolder ? palette.brand : palette.brandSoft },
                      ]}
                    >
                      <Icon
                        name={isCardFolder ? 'User' : 'FolderOpen'}
                        size={18}
                        color={isCardFolder ? '#ffffff' : palette.brand}
                      />
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.rowCenterGap6}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 13.5,
                            fontWeight: '700',
                            color: isCardFolder ? palette.brandText : palette.textPrimary,
                            flexShrink: 1,
                          }}
                        >
                          {folderName}
                        </Text>
                        {isCardFolder && (
                          <View
                            style={[
                              styles.inlineMicroChip,
                              { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                            ]}
                          >
                            <Text style={{ fontSize: 9.5, fontWeight: '800', color: palette.brandText }}>
                              {isAdminCards ? 'Equipo' : 'Personal'}
                            </Text>
                          </View>
                        )}
                        {hasLivePlano && (
                          <View
                            style={[
                              styles.inlineMicroChip,
                              {
                                backgroundColor: palette.emeraldBg,
                                borderColor: palette.emeraldBorder,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 9.5, fontWeight: '800', color: palette.emeraldText }}>
                              Plano en vivo
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                        {isAdminCards
                          ? `${folderItems.length} tarjeta(s) de asesores`
                          : isCardFolder
                          ? 'Tarjeta con tu foto y presentación oficial'
                          : `${folderItems.length} documento(s)`}
                      </Text>
                    </View>

                    <Icon name="ChevronRight" size={16} color={palette.textSubtle} />
                  </Pressable>
                );
              })
            ) : (
              currentItems.map((item) => {
                const plano = isPlanoItem(item);
                const isVideo = item.kind === 'video' || item.contentType.startsWith('video/');
                const isImage = item.contentType.startsWith('image/');
                const isCard = item.project === 'Tarjeta de Presentación' || item.kind === 'card';

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onSelect(item)}
                    style={[
                      styles.portfolioFolderRow,
                      plano
                        ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
                        : { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    {isImage ? (
                      <ExpoImage
                        source={{ uri: item.downloadUrl }}
                        style={styles.portfolioImageThumb}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View
                        style={[
                          styles.attachIconCircle,
                          {
                            backgroundColor: plano
                              ? palette.emeraldBg
                              : isVideo
                              ? palette.amberBg
                              : palette.brandSoft,
                          },
                        ]}
                      >
                        <Icon
                          name={plano ? 'MapPin' : isVideo ? 'Video' : 'FileText'}
                          size={18}
                          color={plano ? palette.emerald : isVideo ? palette.amber : palette.brand}
                        />
                      </View>
                    )}

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 13, fontWeight: '700', color: palette.textPrimary }}
                      >
                        {item.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 11,
                          color: plano ? palette.emeraldText : palette.textMuted,
                          marginTop: 2,
                        }}
                      >
                        {isCard && item.advisorName
                          ? `Asesor: ${item.advisorName}`
                          : plano
                          ? timeAgo(planoGenAt.get(item.id) ?? null) || 'Disponibilidad en vivo'
                          : isVideo && (item.visibility ?? 'general') === 'advisor'
                          ? `Solo ${item.advisorName || 'asesor'} · ${formatFileSize(item.sizeBytes)}`
                          : formatFileSize(item.sizeBytes)}
                      </Text>
                    </View>

                    <Icon name="Send" size={15} color={palette.brand} />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplatePickerModal (2 pasos: 'list' -> 'preview', selector WABA, UTF-8 limpio)
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
  marketing: '📣 Marketing',
  utility: '⚙️ Utilidad / Servicio',
  authentication: '🔐 Autenticación',
};

function fillTemplateBody(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    vars[k]?.trim() ? vars[k] : `{{${k}}}`
  );
}

function TemplatePickerModal({
  visible,
  companyId,
  lead,
  palette,
  onClose,
}: {
  visible: boolean;
  companyId: string;
  lead: Lead;
  palette: MerakiThemePalette;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.uid;

  const [allTemplates, setAllTemplates] = useState<WhatsAppTemplate[]>([]);
  const [lines, setLines] = useState<MessagingLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'list' | 'preview'>('list');
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setStep('list');
    setSelected(null);
    setVariables({});
    setSearch('');
    setError(null);

    Promise.all([
      listTemplates(companyId).catch(() => [] as WhatsAppTemplate[]),
      listMessagingLines(companyId).catch(() => [] as MessagingLine[]),
    ])
      .then(([tpls, lns]) => {
        if (!alive) return;
        setAllTemplates(tpls);
        setLines(lns);
        const mine = uid ? lns.find((l) => l.advisorId === uid) : undefined;
        const def = lns.find((l) => l.isDefault);
        const initial =
          mine && digitsOnly(lead.inboxId) === digitsOnly(mine.number)
            ? mine.number
            : def?.number ?? mine?.number ?? null;
        setSelectedLine(initial);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError('No se pudieron cargar las plantillas oficiales.');
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [visible, companyId, uid, lead.inboxId]);

  const defaultLine = useMemo(() => lines.find((l) => l.isDefault) ?? null, [lines]);
  const myLine = useMemo(
    () => (uid ? lines.find((l) => l.advisorId === uid) ?? null : null),
    [lines, uid]
  );
  const canChooseLine = Boolean(myLine && defaultLine);
  const activeLineNumber = canChooseLine ? selectedLine : lead.inboxId ?? null;

  const filteredTemplates = useMemo(() => {
    const byLine = allTemplates.filter(
      (t) =>
        !activeLineNumber ||
        !t.lineNumber ||
        digitsOnly(t.lineNumber) === digitsOnly(activeLineNumber)
    );
    const q = search.trim().toLowerCase();
    if (!q) return byLine;
    return byLine.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.category && t.category.toLowerCase().includes(q))
    );
  }, [allTemplates, activeLineNumber, search]);

  const handleChangeLine = (lineNum: string) => {
    if (lineNum === selectedLine) return;
    setSelectedLine(lineNum);
    setSelected(null);
    setVariables({});
    setError(null);
    setStep('list');
  };

  const handleSelectTemplate = (tpl: WhatsAppTemplate) => {
    setSelected(tpl);
    const initVars: Record<string, string> = {};
    (tpl.variables ?? []).forEach((v) => {
      initVars[v.key] = '';
    });
    setVariables(initVars);
    setError(null);
    setStep('preview');
  };

  const handleSendTemplate = async () => {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendTemplateMessageWithLine(
        companyId,
        lead.id,
        selected.id,
        variables,
        canChooseLine ? selectedLine ?? undefined : undefined
      );
      Alert.alert(
        'Plantilla enviada',
        'El mensaje oficial fue enviado. La conversación quedará habilitada en cuanto el cliente responda.'
      );
      onClose();
    } catch (err) {
      const msg = (err as { message?: string })?.message;
      setError(
        msg || 'No se pudo enviar la plantilla. Verifica que esté aprobada por Meta y tenga todas sus variables.'
      );
    } finally {
      setSending(false);
    }
  };

  if (!visible) return null;

  const previewText = selected ? fillTemplateBody(selected.body, variables) : '';
  const allVarsFilled = Boolean(
    selected && (selected.variables ?? []).every((v) => Boolean(variables[v.key]?.trim()))
  );
  const canSend = Boolean(selected && !sending && allVarsFilled);
  const leadFirstName = lead.name?.trim().split(/\s+/)[0] || '';

  const getStatusBadge = (st: WhatsAppTemplate['status']) => {
    if (st === 'approved') {
      return {
        label: '✓ Aprobada Meta',
        bg: palette.emeraldBg,
        border: palette.emeraldBorder,
        text: palette.emeraldText,
      };
    }
    if (st === 'pending') {
      return {
        label: '⏳ En Revisión Meta',
        bg: palette.amberBg,
        border: palette.amberBorder,
        text: palette.amberText,
      };
    }
    if (st === 'rejected') {
      return {
        label: '✕ Rechazada',
        bg: palette.roseBg,
        border: palette.roseBorder,
        text: palette.roseText,
      };
    }
    return {
      label: 'Borrador Local',
      bg: palette.bgElevated,
      border: palette.borderStrong,
      text: palette.textMuted,
    };
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.bgCanvas }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header del Modal */}
        <View
          style={[
            styles.tplHeader,
            {
              backgroundColor: palette.bgCard,
              borderBottomColor: palette.border,
              paddingTop: Math.max(insets.top + 8, 14),
            },
          ]}
        >
          <View style={[styles.rowCenterGap6, { flex: 1, minWidth: 0 }]}>
            {step === 'preview' && (
              <Pressable
                onPress={() => setStep('list')}
                hitSlop={10}
                style={[
                  styles.iconBoxBtn,
                  { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
                ]}
              >
                <Icon name="ArrowLeft" size={17} color={palette.textPrimary} />
              </Pressable>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.rowCenterGap6}>
                <Icon name="LayoutTemplate" size={16} color={palette.brand} />
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: '800', color: palette.textPrimary, flexShrink: 1 }}
                >
                  Enviar Plantilla de WhatsApp
                </Text>
              </View>
              <Text numberOfLines={1} style={{ fontSize: 11, color: palette.textMuted, marginTop: 1 }}>
                Mensajes oficiales pre-aprobados por Meta
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={[
              styles.iconBoxBtn,
              { backgroundColor: palette.bgElevated, borderColor: palette.border },
            ]}
          >
            <Icon name="X" size={17} color={palette.textSecondary} />
          </Pressable>
        </View>

        {/* Barra de Selección de Línea WABA */}
        <View
          style={[
            styles.tplLineBar,
            { backgroundColor: palette.bgCardSoft, borderBottomColor: palette.border },
          ]}
        >
          {canChooseLine ? (
            <View style={[styles.rowCenterGap6, { flexWrap: 'wrap' }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: palette.textMuted }}>
                Línea de salida:
              </Text>
              <View
                style={[
                  styles.channelSegmentedWrap,
                  { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
                ]}
              >
                {[defaultLine, myLine].map((line) => {
                  if (!line) return null;
                  const active = digitsOnly(selectedLine) === digitsOnly(line.number);
                  return (
                    <Pressable
                      key={line.number}
                      onPress={() => handleChangeLine(line.number)}
                      style={[
                        styles.channelSegmentBtn,
                        active && {
                          backgroundColor: palette.brandSoft,
                          borderColor: palette.brandBorder,
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 11 }}>{line.isDefault ? '🏢' : '📱'}</Text>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: active ? '800' : '600',
                          color: active ? palette.brandText : palette.textMuted,
                        }}
                      >
                        {line.isDefault ? 'Ventas 317' : 'Mi WhatsApp'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : activeLineNumber ? (
            <View style={styles.rowCenterGap6}>
              <Text style={{ fontSize: 11, color: palette.textMuted }}>Se enviará desde:</Text>
              <View
                style={[
                  styles.inlineMicroChip,
                  { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                  🏢 {inboxLabel(activeLineNumber)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: 11, color: palette.textMuted }}>
              {filteredTemplates.length} plantilla(s) disponible(s)
            </Text>
          )}
        </View>

        {/* Cuerpo: Paso 1 ('list') vs Paso 2 ('preview') */}
        {step === 'list' ? (
          <View style={{ flex: 1 }}>
            <View style={[styles.tplSearchWrap, { borderBottomColor: palette.border }]}>
              <View
                style={[
                  styles.tplSearchBox,
                  { backgroundColor: palette.bgInput, borderColor: palette.borderInput },
                ]}
              >
                <Icon name="Search" size={14} color={palette.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar plantilla por nombre o texto…"
                  placeholderTextColor={palette.placeholder}
                  style={{ flex: 1, fontSize: 13, color: palette.textPrimary, paddingVertical: 0 }}
                />
                {search ? (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Icon name="X" size={14} color={palette.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {loading ? (
              <View style={styles.centerGuardWrap}>
                <ActivityIndicator size="large" color={palette.brand} />
                <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 10 }}>
                  Cargando plantillas de Meta…
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredTemplates}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 32 }}
                ListEmptyComponent={
                  <View style={{ paddingVertical: 44, alignItems: 'center' }}>
                    <Text style={{ fontSize: 28, marginBottom: 6 }}>🔍</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: palette.textPrimary }}>
                      No hay plantillas que coincidan
                    </Text>
                    <Text style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 4 }}>
                      Intenta con otra búsqueda o cambia de línea de salida.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const st = getStatusBadge(item.status);
                  const varCount = item.variables?.length ?? 0;
                  return (
                    <Pressable
                      onPress={() => handleSelectTemplate(item)}
                      style={[
                        styles.tplListItem,
                        { backgroundColor: palette.bgCard, borderColor: palette.border },
                      ]}
                    >
                      <View style={styles.rowBetweenCenter}>
                        <Text
                          numberOfLines={1}
                          style={{
                            flex: 1,
                            fontSize: 13.5,
                            fontWeight: '800',
                            color: palette.textPrimary,
                            marginRight: 8,
                          }}
                        >
                          {item.displayName}
                        </Text>
                        <View
                          style={[
                            styles.inlineMicroChip,
                            { backgroundColor: st.bg, borderColor: st.border },
                          ]}
                        >
                          <Text style={{ fontSize: 9.5, fontWeight: '700', color: st.text }}>
                            {st.label}
                          </Text>
                        </View>
                      </View>

                      <Text
                        numberOfLines={2}
                        style={{ fontSize: 12, lineHeight: 17, color: palette.textMuted, marginTop: 4 }}
                      >
                        {item.body}
                      </Text>

                      <View style={[styles.rowCenterGap6, { marginTop: 6 }]}>
                        <Text style={{ fontSize: 10.5, color: palette.textSubtle, fontWeight: '600' }}>
                          {TEMPLATE_CATEGORY_LABEL[item.category] || item.category}
                        </Text>
                        {varCount > 0 && (
                          <Text style={{ fontSize: 10.5, color: palette.brandText, fontWeight: '700' }}>
                            • {varCount} variable{varCount > 1 ? 's' : ''}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        ) : selected ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 28 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Navegación rápida de retorno a la lista */}
              <View style={[styles.rowBetweenCenter, { borderBottomWidth: 1, borderBottomColor: palette.border, paddingBottom: 10 }]}>
                <Pressable onPress={() => setStep('list')} style={styles.rowCenterGap6}>
                  <Icon name="ArrowLeft" size={14} color={palette.brandText} />
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: palette.brandText }}>
                    Elegir otra plantilla
                  </Text>
                </Pressable>

                {(() => {
                  const st = getStatusBadge(selected.status);
                  return (
                    <View
                      style={[
                        styles.inlineMicroChip,
                        { backgroundColor: st.bg, borderColor: st.border },
                      ]}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: st.text }}>
                        {st.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Encabezado de Plantilla */}
              <View>
                <Text style={{ fontSize: 16, fontWeight: '800', color: palette.textPrimary }}>
                  {selected.displayName}
                </Text>
                <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 2 }}>
                  Categoría:{' '}
                  <Text style={{ fontWeight: '700', color: palette.textSecondary }}>
                    {TEMPLATE_CATEGORY_LABEL[selected.category] || selected.category}
                  </Text>
                </Text>
              </View>

              {/* Variables Requeridas */}
              {(selected.variables?.length ?? 0) > 0 && (
                <View
                  style={[
                    styles.tplVarsCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.border },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: '800',
                      color: palette.textSecondary,
                      textTransform: 'uppercase',
                    }}
                  >
                    ✏️ Variables requeridas ({selected.variables.length})
                  </Text>

                  {selected.variables.map((v, idx) => (
                    <View key={v.key} style={{ gap: 5 }}>
                      <View style={styles.rowBetweenCenter}>
                        <Text style={{ fontSize: 11.5, fontWeight: '600', color: palette.textMuted }}>
                          {`{{${v.key}}}`}{' '}
                          {v.example ? (
                            <Text style={{ color: palette.textSubtle }}>(ej: {v.example})</Text>
                          ) : null}
                        </Text>

                        {idx === 0 && leadFirstName ? (
                          <Pressable
                            onPress={() =>
                              setVariables((prev) => ({ ...prev, [v.key]: leadFirstName }))
                            }
                            style={[
                              styles.inlineMicroChip,
                              { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                            ]}
                          >
                            <Text style={{ fontSize: 10, fontWeight: '700', color: palette.brandText }}>
                              + Usar «{leadFirstName}»
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>

                      <TextInput
                        value={variables[v.key] ?? ''}
                        onChangeText={(val) =>
                          setVariables((prev) => ({ ...prev, [v.key]: val }))
                        }
                        placeholder={v.example || `Valor para {{${v.key}}}`}
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.tplVarInput,
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
              )}

              {/* Vista Previa Real en el WhatsApp del Cliente */}
              <View
                style={[
                  styles.tplVarsCard,
                  { backgroundColor: palette.bgBody, borderColor: palette.border },
                ]}
              >
                <View style={[styles.rowBetweenCenter, { borderBottomWidth: 1, borderBottomColor: palette.border, paddingBottom: 8 }]}>
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: '800',
                      color: palette.textMuted,
                      textTransform: 'uppercase',
                    }}
                  >
                    📱 Vista Previa en el WhatsApp del Cliente
                  </Text>
                  <Text style={{ fontSize: 10, color: palette.textSubtle }}>Formato Oficial Meta</Text>
                </View>

                <View
                  style={[
                    styles.whatsappPreviewBubble,
                    { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
                  ]}
                >
                  {selected.headerText ? (
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '800',
                        color: palette.textPrimary,
                        paddingBottom: 6,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: palette.border,
                      }}
                    >
                      {selected.headerText}
                    </Text>
                  ) : null}

                  <Text style={{ fontSize: 13, lineHeight: 19, color: palette.textPrimary }}>
                    {previewText}
                  </Text>

                  {selected.footer ? (
                    <Text
                      style={{
                        fontSize: 11,
                        fontStyle: 'italic',
                        color: palette.textMuted,
                        paddingTop: 6,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.border,
                      }}
                    >
                      {selected.footer}
                    </Text>
                  ) : null}

                  {selected.buttons && selected.buttons.length > 0 ? (
                    <View style={{ gap: 5, paddingTop: 6 }}>
                      {selected.buttons.map((btn, bIdx) => (
                        <View
                          key={`${btn.text}-${bIdx}`}
                          style={[
                            styles.tplPreviewBtnRow,
                            { backgroundColor: palette.bgElevated, borderColor: palette.border },
                          ]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: palette.sky }}>
                            {btn.text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={[styles.rowCenterGap6, { justifyContent: 'flex-end' }]}>
                    <Text style={{ fontSize: 10, color: palette.textSubtle }}>Ahora</Text>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: palette.sky }}>✓✓</Text>
                  </View>
                </View>
              </View>

              {error && (
                <View
                  style={[
                    styles.composerErrorBanner,
                    { backgroundColor: palette.roseBg, borderColor: palette.roseBorder, marginHorizontal: 0 },
                  ]}
                >
                  <Icon name="AlertTriangle" size={15} color={palette.rose} />
                  <Text style={{ flex: 1, fontSize: 12, color: palette.roseText }}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Footer de Envío */}
            <View
              style={[
                styles.tplFooter,
                {
                  backgroundColor: palette.bgCard,
                  borderTopColor: palette.border,
                  paddingBottom: Math.max(insets.bottom + 8, 14),
                },
              ]}
            >
              <View style={[styles.rowCenterGap6, { marginBottom: 10 }]}>
                <Icon
                  name={selected.status === 'approved' ? 'Check' : 'AlertTriangle'}
                  size={14}
                  color={selected.status === 'approved' ? palette.emerald : palette.amber}
                />
                <Text style={{ flex: 1, fontSize: 11, color: palette.textMuted }}>
                  {selected.status === 'approved'
                    ? 'Plantilla aprobada por Meta. Puede enviarse fuera de las 24 horas.'
                    : 'Solo puede enviarse mientras la ventana de 24h esté activa.'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button variant="secondary" onPress={onClose} style={{ flex: 1 }}>
                  Cancelar
                </Button>
                <Pressable
                  disabled={!canSend}
                  onPress={handleSendTemplate}
                  style={[
                    styles.tplSendBtn,
                    { backgroundColor: palette.brand, flex: 2 },
                    !canSend && { opacity: 0.45 },
                  ]}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Icon name="Send" size={14} color="#ffffff" />
                  )}
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#ffffff' }}>
                    {sending ? 'Enviando…' : 'Enviar Plantilla'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReactionPickerModal (6 emojis WhatsApp + Copiar texto)
// ─────────────────────────────────────────────────────────────────────────────

function ReactionPickerModal({
  message,
  activeEmoji,
  palette,
  onSelectEmoji,
  onClose,
}: {
  message: EnrichedMessage | null;
  activeEmoji: string;
  palette: MerakiThemePalette;
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}) {
  if (!message) return null;

  const canReactToWhatsApp =
    message.direction === 'inbound' && message.senderType === 'lead';

  const copyMessageText = async () => {
    if (message.content?.trim()) {
      await Clipboard.setStringAsync(message.content.trim());
    }
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.reactionBackdrop, { backgroundColor: palette.backdrop }]}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={[
            styles.reactionPopupCard,
            { backgroundColor: palette.bgCard, borderColor: palette.borderStrong },
          ]}
        >
          {canReactToWhatsApp ? (
            <View style={styles.emojiBarRow}>
              {QUICK_REACTIONS.map((emoji) => {
                const isSelected = activeEmoji === emoji;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => onSelectEmoji(emoji)}
                    style={[
                      styles.emojiOptionBtn,
                      isSelected && {
                        backgroundColor: palette.brandSoft,
                        borderColor: palette.brandBorder,
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 24 }}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={{ fontSize: 11.5, color: palette.textMuted, paddingHorizontal: 8 }}>
              Las reacciones de WhatsApp están disponibles en mensajes entrantes del cliente.
            </Text>
          )}

          {message.content?.trim() ? (
            <Pressable
              onPress={copyMessageText}
              style={[
                styles.copyMsgActionRow,
                { borderTopColor: palette.border },
              ]}
            >
              <Icon name="Copy" size={14} color={palette.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textPrimary }}>
                Copiar texto del mensaje
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageLightboxModal (Zoom Fullscreen para imágenes y stickers)
// ─────────────────────────────────────────────────────────────────────────────

function ImageLightboxModal({
  uri,
  onClose,
}: {
  uri: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!uri) return null;

  const handleShare = () => {
    Share.share({ message: uri, url: uri }).catch(() => {
      Linking.openURL(uri).catch(() => {});
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lightboxRoot}>
        <View style={[styles.lightboxTopBar, { paddingTop: Math.max(insets.top + 8, 18) }]}>
          <Pressable onPress={() => Linking.openURL(uri)} style={styles.lightboxActionBtn}>
            <Icon name="ExternalLink" size={18} color="#ffffff" />
          </Pressable>
          <Pressable onPress={handleShare} style={styles.lightboxActionBtn}>
            <Icon name="Share2" size={18} color="#ffffff" />
          </Pressable>
          <Pressable onPress={onClose} style={styles.lightboxActionBtn}>
            <Icon name="X" size={20} color="#ffffff" />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.lightboxScrollCenter}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <ExpoImage
            source={{ uri }}
            style={styles.lightboxFullImage}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos optimizados (320px - 430px Mobile Responsive Parity)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
  },
  simpleTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  iconBoxBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerGuardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  guardCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  guardTitle: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  guardDesc: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },

  // Header 2 Filas
  headerContainer: {
    borderBottomWidth: 1,
  },
  headerRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerLeadName: {
    fontSize: 14,
    fontWeight: '800',
  },
  rowCenterGap6: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowBetweenCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phoneAndMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  copyPhoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineMicroChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  metaAdsInlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  metaAdsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  fbVideoLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  headerActionStrip: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 6,
    alignItems: 'center',
  },
  headerActionBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  headerActionText: {
    fontSize: 11.5,
    fontWeight: '700',
  },

  // SLA 24h & Meraki Gold Window Bars
  slaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  slaBannerText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '700',
    lineHeight: 14,
  },
  slaActionCta: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  slaActionCtaText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  windowStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  merakiWindowOpenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  windowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  windowTemplateCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },

  // Lista de mensajes
  messageListContent: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 10,
  },
  centerSpinner: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  loadOlderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  emptyMessagesWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },

  // Muro de Privacidad
  privacyBannerCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  privacyMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  assignedDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  assignedDividerPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },

  // Burbujas
  systemRow: {
    alignItems: 'center',
    marginVertical: 4,
  },
  systemPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '88%',
  },
  bubbleOuterWrap: {
    gap: 2,
  },
  alignEnd: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  alignStart: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  senderCaption: {
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  bubbleRowWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chatBubbleBox: {
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  stickerBubbleBox: {
    padding: 0,
  },
  bubbleBodyText: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  unavailableMediaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  reactionFloatingPill: {
    position: 'absolute',
    bottom: -9,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    elevation: 2,
  },
  quickSmileBtn: {
    padding: 4,
    opacity: 0.7,
  },
  metaTimestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  failureReasonBox: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  routePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 1,
  },

  // Media en Burbujas
  stickerMediaSize: {
    width: 124,
    height: 124,
  },
  imageMediaBox: {
    width: 216,
    height: 230,
    maxWidth: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  zoomHintPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineVideoBox: {
    width: 228,
    height: 270,
    maxWidth: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  documentMediaCard: {
    minWidth: 210,
    maxWidth: 256,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
  },
  docIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceNoteWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 196,
    paddingVertical: 2,
  },
  voicePlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 22,
  },
  speedChip: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },

  // AdReferralCard
  adReferralCard: {
    borderRadius: 13,
    borderWidth: 1,
    padding: 11,
    marginBottom: 4,
    maxWidth: 340,
  },
  adReferralHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
    borderBottomWidth: 1,
  },
  adVideoContainer: {
    marginTop: 9,
    height: 220,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  adImageContainer: {
    marginTop: 9,
    height: 168,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#09090b',
    position: 'relative',
  },
  adPlayOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adPlayCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adFacebookBtn: {
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  // Compositor & Grabadora de Voz
  composerNoticeBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  composerNoticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  closedFooterBox: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  closedFooterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 11,
    marginTop: 2,
  },
  composerContainer: {
    borderTopWidth: 1,
  },
  composerErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  pendingAttachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  uploadTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  pendingThumb: {
    width: 34,
    height: 34,
    borderRadius: 6,
  },
  pendingFileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  composerSquareBtn: {
    width: 38,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  composerTextInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 13.5,
  },
  merakiSendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  channelToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  channelSegmentedWrap: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  channelSegmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  // VoiceRecorder Bar
  voiceRecorderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  voiceTrashBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceWaveformPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
  },
  recordingPulseDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  liveWaveformRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
  },
  voiceTimerText: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 38,
    textAlign: 'right',
  },
  voiceStopBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewProgressBar: {
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  // Bottom Sheets (Adjuntos y Portafolio)
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheetCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
  },
  portfolioSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    maxHeight: '80%',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  attachActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  attachIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portfolioFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  portfolioImageThumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
  },

  // TemplatePickerModal
  tplHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  tplLineBar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  tplSearchWrap: {
    padding: 12,
    borderBottomWidth: 1,
  },
  tplSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 11,
    borderWidth: 1,
  },
  tplListItem: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  tplVarsCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 11,
  },
  tplVarInput: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  whatsappPreviewBubble: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    gap: 8,
  },
  tplPreviewBtnRow: {
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  tplFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  tplSendBtn: {
    height: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  // Reaction Picker
  reactionBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  reactionPopupCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 268,
    maxWidth: 340,
    gap: 8,
  },
  emojiBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  emojiOptionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyMsgActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 9,
    paddingBottom: 2,
    borderTopWidth: 1,
  },

  // Lightbox Fullscreen
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },
  lightboxTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  lightboxActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxScrollCenter: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  lightboxFullImage: {
    width: '100%',
    height: '82%',
  },
});
