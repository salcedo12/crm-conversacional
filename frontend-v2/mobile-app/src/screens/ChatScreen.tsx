import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import {
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { useAuth } from '../providers/AuthProvider';
import { useLeadCalls, useLeadDoc, useLeadNotes } from '../hooks/useLeadDetails';
import { useLibrary } from '../hooks/useLibrary';
import { useMessages } from '../hooks/useMessages';
import { colors } from '../theme/colors';
import type { Appointment, ContactField, Lead, LeadAnalysis, LeadNote, LibraryItem, Message, RecentCall, RootStackParams, WhatsAppTemplate } from '../types';
import { initials, shortTime, timestampMs } from '../utils/format';
import { isWindowOpen, windowClosedAgo, windowTimeLeft } from '../utils/conversationWindow';
import {
  addLeadNote,
  analyzeLead,
  deleteLeadNote,
  listContactFields,
  listLeadAppointments,
  markLeadRead,
  sendMessage,
  sendTemplateMessage,
  setLeadAi,
  setReminderDone,
  startAiCall,
  listTemplates,
  updateLead,
  uploadMedia,
  type LocalFile,
  type UploadedMedia,
} from '../services/crm';
import { cancelLeadReminderNotification, scheduleLeadReminderNotification } from '../services/notifications';
import {
  fetchPlanosIndex,
  isPlanoItem,
  normalizeProjectName,
  planoItemId,
  planoToLibraryItem,
  timeAgo,
  type PlanoIndexItem,
} from '../services/planos';
import { SmartHomeBitacoraPanel } from '../components/SmartHomeBitacoraPanel';
type Props = NativeStackScreenProps<RootStackParams, 'Chat'>;
const reminderTimeOptions = Array.from({ length: 29 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
});

export function ChatScreen({ route, navigation }: Props) {
  const { lead } = route.params;
  const { companyId } = useAuth();
  const liveLead = useLeadDoc(companyId, lead.id, lead);
  const { messages, loading } = useMessages(companyId, liveLead.id);
  const [aiEnabled, setAiEnabled] = useState(liveLead.aiEnabled);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const isWhatsapp = !liveLead.channel || liveLead.channel === 'whatsapp';
  const windowOpen = !isWhatsapp || isWindowOpen(liveLead.lastInboundAt);

  useEffect(() => {
    if (companyId) markLeadRead(companyId, liveLead.id).catch(console.warn);
  }, [companyId, liveLead.id, messages.length]);

  useEffect(() => setAiEnabled(liveLead.aiEnabled), [liveLead.aiEnabled]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (templatesOpen) {
        setTemplatesOpen(false);
        return true;
      }

      if (detailsOpen) {
        setDetailsOpen(false);
        return true;
      }

      navigation.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [detailsOpen, navigation, templatesOpen]);

  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });

    return () => subscription.remove();
  }, []);

  const toggleAi = async () => {
    if (!companyId) return;
    const next = !aiEnabled;
    setAiEnabled(next);
    try { await setLeadAi(companyId, liveLead.id, next); }
    catch { setAiEnabled(!next); }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-zinc-950">
      <View className="flex-row items-center border-b border-zinc-800 bg-zinc-950 px-3 py-2.5 gap-2">
        <Pressable onPress={navigation.goBack} hitSlop={10} className="w-10 h-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 active:bg-zinc-800">
          <Ionicons name="arrow-back" size={18} color="#e4e4e7" />
        </Pressable>
        <Pressable onPress={() => setDetailsOpen(true)} className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text numberOfLines={1} className="text-sm font-semibold text-zinc-100">{liveLead.name || 'Sin nombre'}</Text>
          </View>
          <Text numberOfLines={1} className="text-xs text-zinc-500">{liveLead.phone}</Text>
        </Pressable>
        
        <View className="flex-row items-center gap-1.5">
          <Pressable onPress={() => setDetailsOpen(true)} className="h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800/70 active:bg-zinc-700">
            <Ionicons name="person" size={14} color="#d4d4d8" />
          </Pressable>
          {isWhatsapp && (
            <Pressable onPress={() => setTemplatesOpen(true)} className="h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800/60 active:bg-zinc-700">
              <Ionicons name="clipboard-outline" size={14} color="#d4d4d8" />
            </Pressable>
          )}
          <Pressable onPress={toggleAi} className={`h-9 px-3 flex-row items-center justify-center gap-1.5 rounded-full border ${aiEnabled ? 'border-amber-500/30 bg-amber-500/10 active:bg-amber-500/20' : 'border-zinc-700 bg-zinc-800 active:bg-zinc-700'}`}>
            <View className={`w-1.5 h-1.5 rounded-full ${aiEnabled ? 'bg-amber-500' : 'bg-zinc-500'}`} />
            <Text className={`text-xs font-medium ${aiEnabled ? 'text-amber-500' : 'text-zinc-400'}`}>
              {aiEnabled ? 'IA activa' : 'IA pausada'}
            </Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} className="flex-1 bg-[#0d0d0f]">
        {isWhatsapp ? (
          <View className={`flex-row items-center justify-between gap-3 px-3 py-1.5 border-t ${windowOpen ? 'border-green-500/10 bg-green-500/5' : 'border-amber-500/10 bg-amber-500/5'}`}>
            <View className="flex-row flex-1 min-w-0 items-center gap-1.5">
              <View className={`w-1.5 h-1.5 rounded-full ${windowOpen ? 'bg-green-400' : 'bg-amber-400'}`} />
              <Text numberOfLines={1} className={`text-[11px] ${windowOpen ? 'text-green-400' : 'text-amber-400'}`}>
                {windowOpen ? `Ventana abierta - ${windowTimeLeft(liveLead.lastInboundAt)}` : `Ventana cerrada - ${windowClosedAgo(liveLead.lastInboundAt)}`}
              </Text>
            </View>
            {!windowOpen ? <Pressable onPress={() => setTemplatesOpen(true)}><Text className="text-[11px] text-amber-400 underline">Usar plantilla</Text></Pressable> : null}
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12, gap: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: !loading })}
          ListEmptyComponent={!loading ? <Text className="text-zinc-500 text-xs text-center mt-6">Todavía no hay mensajes en esta conversación.</Text> : null}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        />
        {companyId ? <Composer companyId={companyId} lead={liveLead} disabled={!windowOpen} onOpenTemplates={() => setTemplatesOpen(true)} /> : null}
      </KeyboardAvoidingView>
      {companyId ? (
        <>
          <LeadDetailsModal visible={detailsOpen} companyId={companyId} lead={liveLead} onClose={() => setDetailsOpen(false)} />
          <TemplateModal visible={templatesOpen} companyId={companyId} leadId={liveLead.id} inboxId={liveLead.inboxId} onClose={() => setTemplatesOpen(false)} />
        </>
      ) : null}
    </SafeAreaView>
  );
}

type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

const STATUS_CONFIG: Record<MessageStatus, { label: string; icon: string; color: string }> = {
  pending:   { label: 'Enviando…',    icon: '🕓', color: '#71717a' },
  sent:      { label: 'Enviado',      icon: '✓',  color: '#71717a' },
  delivered: { label: 'Entregado',    icon: '✓✓', color: '#a1a1aa' },
  read:      { label: 'Leído',        icon: '✓✓', color: '#38bdf8' },
  failed:    { label: 'No entregado', icon: '⚠',  color: '#f87171' },
};

function DeliveryStatus({ status }: { status: MessageStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent;
  return (
    <Text style={{ fontSize: 10, color: cfg.color, fontWeight: status === 'failed' ? '600' : '400' }}>
      {cfg.icon} {cfg.label}
    </Text>
  );
}

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'outbound';
  
  const isAdvisorWhatsapp = message.metadata?.deliveryChannel === 'advisor_whatsapp' || (message.metadata?.origin as string)?.startsWith('advisor_whatsapp');
  
  let senderLabel = 'Lead';
  let bubbleStyle = styles.bubbleLead;
  
  if (message.senderType === 'ai') {
    senderLabel = '🤖 Victoria IA';
    bubbleStyle = styles.bubbleAi;
  } else if (message.senderType === 'advisor') {
    senderLabel = message.advisorId ? `✋ ${message.advisorName || 'Asesor'}` : '📱 Enviado desde WhatsApp';
    bubbleStyle = styles.bubbleAdvisor;
  }
  
  const phone = (message.metadata?.businessPhone as string) || (message.metadata?.advisorPhone as string) || '';
  const routeText = isAdvisorWhatsapp 
    ? (outbound ? 'Enviado desde: Mi WhatsApp' : 'Recibido en: Mi WhatsApp') 
    : (outbound ? 'Enviado desde: Ventas 317' : 'Recibido en: Ventas 317');
    
  const routeLabel = phone ? `${routeText} +${phone.replace(/\D/g, '')}` : routeText;

  return (
    <View className={`flex-col gap-0.5 max-w-[85%] ${outbound ? 'self-end items-end' : 'self-start items-start'}`}>
      <Text className={`text-[10px] text-zinc-500 px-1 ${outbound ? 'text-right' : 'text-left'}`}>{senderLabel}</Text>
      
      <View className={`flex-row items-end gap-1 shrink ${outbound ? 'flex-row-reverse' : 'flex-row'}`}>
        <View className={`shrink rounded-2xl px-3 py-2.5 ${message.senderType === 'lead' ? 'bg-zinc-700' : message.senderType === 'ai' ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-[#1c2438] border border-[#2b354f]'}`}>
          {message.mediaUrl ? <MessageMedia message={message} outbound={outbound} /> : null}
          {message.content ? <Text className={`text-sm leading-relaxed ${message.senderType === 'lead' ? 'text-zinc-100' : message.senderType === 'ai' ? 'text-amber-100' : 'text-zinc-100'}`}>{message.content}</Text> : null}
          {message.mediaPending ? <Text className="text-xs italic text-zinc-400 mt-1">Adjunto cargando...</Text> : null}
        </View>
        {message.reaction && (
          <View className="absolute -bottom-2 -right-1 rounded-full border border-zinc-700 bg-zinc-900 px-1 py-0.5 shadow">
            <Text className="text-xs leading-none">{message.reaction}</Text>
          </View>
        )}
      </View>

      {message.createdAt && (
        <View className={`flex-row items-center gap-1 mt-0.5 px-1 ${outbound ? 'self-end' : 'self-start'}`}>
          <Text className="text-[10px] text-zinc-600">{shortTime(message.createdAt)}</Text>
          {outbound ? (
            <>
              <Text className="text-zinc-600 text-[10px]">·</Text>
              <DeliveryStatus status={message.status} />
            </>
          ) : null}
        </View>
      )}
      
      {message.senderType !== 'system' ? (
        <View className={`max-w-full rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 mt-0.5 ${outbound ? 'self-end' : 'self-start'}`}>
          <Text className="text-[10px] text-zinc-500">{routeLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.status === next.message.status &&
    prev.message.mediaPending === next.message.mediaPending &&
    prev.message.reaction === next.message.reaction
  );
});

function MessageMedia({ message, outbound }: { message: Message; outbound: boolean }) {
  const media = getMediaInfo(message);
  const openMedia = () => Linking.openURL(message.mediaUrl!);

  if (media.kind === 'sticker') {
    return (
      <Pressable onPress={openMedia} className="w-[120px] h-[120px] max-w-full">
        <ExpoImage
          source={{ uri: message.mediaUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
        />
      </Pressable>
    );
  }

  if (media.kind === 'image') {
    return (
      <Pressable onPress={openMedia} className="w-[200px] h-[200px] max-w-full rounded-xl overflow-hidden mb-1">
        <ExpoImage
          source={{ uri: message.mediaUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      </Pressable>
    );
  }

  if (media.kind === 'video') {
    return <InlineVideo uri={message.mediaUrl!} />;
  }

  if (media.kind === 'audio') {
    return <InlineAudio uri={message.mediaUrl!} outbound={outbound} />;
  }

  return (
    <Pressable onPress={openMedia} className={`min-w-[220px] max-w-full flex-row items-center gap-3 p-3 rounded-xl border mb-1 ${outbound ? 'bg-[#0f1422] border-[#2b354f]' : 'bg-zinc-800/50 border-zinc-700'}`}>
      <View className={`w-10 h-10 rounded-lg items-center justify-center shrink-0 ${outbound ? 'bg-[#1c2438]' : 'bg-zinc-700/50'}`}>
        <Ionicons name={media.kind === 'document' ? 'document-text' : 'attach'} size={20} color={outbound ? '#94a3b8' : '#a1a1aa'} />
      </View>
      <View className="flex-1 mr-2">
        <Text numberOfLines={1} className={`text-sm font-medium ${outbound ? 'text-zinc-100' : 'text-zinc-200'}`}>{message.fileName || (media.kind === 'document' ? 'Documento PDF' : 'Archivo adjunto')}</Text>
        <Text numberOfLines={1} className={`text-[11px] mt-0.5 ${outbound ? 'text-zinc-400' : 'text-zinc-400'}`}>{message.fileName ? 'Toca para abrir' : (message.mediaType || 'Toca para abrir')}</Text>
      </View>
      <Ionicons name="open-outline" size={14} color={outbound ? '#475569' : '#52525b'} className="shrink-0" />
    </Pressable>
  );
}

function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <View className="w-[220px] h-[300px] max-w-full rounded-xl overflow-hidden bg-black/20 mb-1">
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

function InlineAudio({ uri, outbound }: { uri: string; outbound: boolean }) {
  const player = useAudioPlayer({ uri }, { updateInterval: 500 });
  const playback = useAudioPlayerStatus(player);
  const playing = playback.playing;
  const duration = playback.duration || 0;

  const toggle = async () => {
    await setAudioModeAsync({ playsInSilentMode: true });
    if (playing) {
      player.pause();
      return;
    }
    player.play();
  };

  return (
    <Pressable onPress={toggle} className="flex-row items-center gap-3 py-1 min-w-[180px]">
      <View className={`w-9 h-9 rounded-full items-center justify-center ${outbound ? 'bg-[#0f1422] border border-[#2b354f]' : 'bg-brand-500/20'}`}>
        <Ionicons name={playing ? 'pause' : 'play'} size={16} color={outbound ? '#94a3b8' : '#C4B5FD'} style={!playing ? { marginLeft: 2 } : {}} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between mb-1">
          <Text className={`text-xs font-medium ${outbound ? 'text-zinc-100' : 'text-zinc-100'}`}>Nota de voz</Text>
          <Text className={`text-[10px] ${outbound ? 'text-zinc-400' : 'text-zinc-400'}`}>{formatAudioSeconds(playback.currentTime)} / {formatAudioSeconds(duration)}</Text>
        </View>
        <View className={`h-1 rounded-full overflow-hidden ${outbound ? 'bg-[#0f1422]' : 'bg-zinc-600/50'}`}>
          <View className={`h-full rounded-full ${outbound ? 'bg-zinc-400' : 'bg-brand-400'}`} style={{ width: audioProgressWidth(playback.currentTime, duration) as `${number}%` }} />
        </View>
      </View>
    </Pressable>
  );
}

function getMediaInfo(message: Message): { kind: NonNullable<Message['mediaKind']> } {
  const mediaKind = message.mediaKind;
  const mediaType = (message.mediaType ?? '').toLowerCase();
  const urlPath = decodeURIComponent((message.mediaUrl ?? '').split('?')[0]).toLowerCase();

  if (mediaKind === 'sticker' || (mediaType === 'image/webp' && !message.content?.trim())) return { kind: 'sticker' };
  if (mediaKind === 'image' || mediaType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/.test(urlPath)) return { kind: 'image' };
  if (mediaKind === 'video' || mediaType.startsWith('video/') || /\.(mp4|3gp|mov|m4v|webm)$/.test(urlPath)) return { kind: 'video' };
  if (mediaKind === 'audio' || mediaType.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|wav|opus)$/.test(urlPath)) return { kind: 'audio' };
  if (mediaKind === 'document' || mediaType === 'application/pdf' || /\.pdf$/.test(urlPath)) return { kind: 'document' };
  return { kind: 'file' };
}

function Composer({ companyId, lead, disabled, onOpenTemplates }: { companyId: string; lead: Lead; disabled: boolean; onOpenTemplates: () => void }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState<'company_whatsapp' | 'advisor_whatsapp'>('company_whatsapp');
  // Un lead que entró por USUARIO (sin número visible) solo lo alcanza la línea que
  // contactó (el 317): su identidad de WhatsApp está atada a esa WABA. Ni el WhatsApp
  // personal (Baileys, solo teléfonos) ni la coexistencia (otra WABA) pueden escribirle.
  const leadHasPhone = !!lead.phone;
  useEffect(() => {
    if (!leadHasPhone && deliveryChannel === 'advisor_whatsapp') setDeliveryChannel('company_whatsapp');
  }, [leadHasPhone, deliveryChannel]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState<UploadedMedia | null>(null);
  const [portfoliosOpen, setPortfoliosOpen] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const chooseAttachment = () => Alert.alert('Adjuntar', 'Selecciona el tipo de archivo', [
    { text: 'Foto o GIF', onPress: pickMedia },
    { text: 'PDF o documento', onPress: pickDocument },
    { text: 'Portafolio guardado', onPress: () => setPortfoliosOpen(true) },
    { text: 'Cancelar', style: 'cancel' },
  ]);

  // Un portafolio de la biblioteca ya vive permanente en Storage: no se re-sube,
  // solo se marca como adjunto pendiente y se envia por su enlace.
  const selectPortfolio = (item: LibraryItem) => {
    setPortfoliosOpen(false);
    setPending({
      downloadUrl: item.downloadUrl,
      storagePath: item.storagePath,
      contentType: item.contentType,
      fileName: item.fileName,
    });
  };

  const upload = async (file: LocalFile) => {
    setUploading(true);
    setProgress(0);
    try {
      setPending(await uploadMedia(companyId, lead.id, file, setProgress));
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Revisa tu conexion e intenta nuevamente.';
      Alert.alert('No se pudo adjuntar', detail);
    } finally {
      setUploading(false);
    }
  };

  async function pickMedia() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permiso requerido', 'Permite el acceso a fotos para adjuntar imagenes.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.82, allowsEditing: false });
    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset.type === ('video' as any)) {
        Alert.alert('Usa Portafolio', 'Para controlar consumo y evitar copias, los videos deben enviarse desde Portafolio o como enlace.');
        return;
      }
      const fallbackExt = asset.type === ('video' as any) ? 'mp4' : 'jpg';
      const fallbackMime = asset.type === ('video' as any) ? 'video/mp4' : 'image/jpeg';
      await upload({
        uri: asset.uri,
        name: asset.fileName ?? `media_${Date.now()}.${fallbackExt}`,
        mimeType: asset.mimeType ?? fallbackMime,
        size: asset.fileSize,
      });
    }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (!result.canceled) {
      const asset = result.assets[0];
      await upload({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.size,
      });
    }
  }

  const startRecording = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permiso requerido', 'Activa el microfono para enviar notas de voz.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopAndSendRecording = async () => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setSending(true);
    try {
      const media = await uploadMedia(companyId, lead.id, { uri, name: `voz_${Date.now()}.m4a`, mimeType: 'audio/mp4' }, setProgress);
      await sendMessage(companyId, lead.id, '', media, deliveryChannel);
    } catch {
      Alert.alert('No se envio el audio', 'Intenta nuevamente.');
    } finally {
      setSending(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
  };

  const submit = async () => {
    const content = text.trim();
    if ((!content && !pending) || sending || uploading) return;
    setText('');
    const media = pending;
    setPending(null);
    setSending(true);
    try { await sendMessage(companyId, lead.id, content, media ?? undefined, deliveryChannel); }
    catch (err) {
      setText(content);
      setPending(media);
      // Mostrar el motivo real del backend (p. ej. "lead entró por usuario: usa la
      // Línea de Ventas") en vez de un genérico que invita a reintentar en vano.
      const reason = (err as { message?: string })?.message;
      Alert.alert('No se envió', reason && reason.length < 240 ? reason : 'El mensaje quedó pendiente. Intenta nuevamente.');
    } finally { setSending(false); }
  };

  if (recorderState.isRecording) {
    const seconds = Math.floor(recorderState.durationMillis / 1000);
    return (
      <View style={[styles.recordingBar, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.recordingDot} />
        <Text style={styles.recordingTime}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text>
        <Text style={styles.recordingLabel}>Grabando nota de voz</Text>
        <Pressable onPress={() => recorder.stop()} style={styles.cancelRecording}><Ionicons name="trash-outline" size={21} color={colors.red} /></Pressable>
        <Pressable onPress={stopAndSendRecording} style={styles.sendRecording}><Ionicons name="send" size={19} color={colors.background} /></Pressable>
      </View>
    );
  }

  const isDeliveryDisabled = disabled && deliveryChannel === 'company_whatsapp';

  return (
    <View className={`border-t border-zinc-800 bg-zinc-950`} style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
      {isDeliveryDisabled ? (
        <View className="mx-3 mt-3 flex-row items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
          <View className="flex-1 mr-4">
            <Text className="text-sm font-semibold text-amber-500 mb-1">Ventana de 24h cerrada</Text>
            <Text className="text-xs text-amber-500/80 leading-relaxed">Usa una plantilla aprobada para reactivar la conversación.</Text>
          </View>
          <Pressable onPress={onOpenTemplates} className="h-10 px-4 shrink-0 flex-row items-center justify-center gap-2 rounded-lg bg-amber-600 active:bg-amber-700">
            <Ionicons name="document-text-outline" size={16} color="#fff" />
            <Text className="text-sm font-medium text-white">Plantilla</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-center gap-2 px-4 pt-3 pb-1">
        <Text className="text-[10px] text-zinc-500">Enviar por</Text>
        <View className="flex-row rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <Pressable onPress={() => setDeliveryChannel('company_whatsapp')} className={`flex-row items-center gap-1 rounded-md px-2 py-1 ${deliveryChannel === 'company_whatsapp' ? 'bg-brand-600/20' : ''}`}>
            <Ionicons name="business" size={12} color={deliveryChannel === 'company_whatsapp' ? '#ddd6fe' : '#71717a'} />
            <Text className={`text-[11px] font-medium ${deliveryChannel === 'company_whatsapp' ? 'text-brand-200' : 'text-zinc-500'}`}>Línea de Ventas</Text>
          </Pressable>
          <Pressable disabled={!leadHasPhone} onPress={() => setDeliveryChannel('advisor_whatsapp')} className={`flex-row items-center gap-1 rounded-md px-2 py-1 ${deliveryChannel === 'advisor_whatsapp' ? 'bg-emerald-500/15' : ''} ${!leadHasPhone ? 'opacity-40' : ''}`}>
            <Ionicons name="phone-portrait" size={12} color={deliveryChannel === 'advisor_whatsapp' ? '#a7f3d0' : '#71717a'} />
            <Text className={`text-[11px] font-medium ${deliveryChannel === 'advisor_whatsapp' ? 'text-emerald-200' : 'text-zinc-500'}`}>Mi WhatsApp</Text>
          </Pressable>
        </View>
      </View>

      {!leadHasPhone ? (
        <View className="mx-4 mb-1 flex-row items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2">
          <Ionicons name="information-circle-outline" size={15} color="#7dd3fc" className="mt-0.5" />
          <Text className="flex-1 text-[11px] leading-relaxed text-sky-200">
            Este lead entró por usuario de WhatsApp (sin número). Solo se puede responder por la Línea de Ventas.
          </Text>
        </View>
      ) : null}

      {(pending || uploading) ? (
        <View className="mx-3 mb-2 flex-row items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
          <Ionicons name={pending?.contentType.startsWith('image/') ? 'image' : 'document-text'} size={20} color="#a1a1aa" className="mr-2 shrink-0" />
          <Text numberOfLines={1} className="flex-1 text-xs text-zinc-300 mx-2">{uploading ? `Subiendo archivo... ${progress}%` : pending?.fileName}</Text>
          {!uploading ? (
            <Pressable onPress={() => setPending(null)} className="p-1 active:opacity-50" hitSlop={10}>
              <Ionicons name="close" size={16} color="#71717a" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <PortfolioModal visible={portfoliosOpen} companyId={companyId} onSelect={selectPortfolio} onClose={() => setPortfoliosOpen(false)} />
      
      <View className="flex-row items-end gap-2 px-3 py-2">
        <Pressable disabled={sending || uploading || isDeliveryDisabled} onPress={chooseAttachment} className="h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 active:bg-zinc-800 disabled:opacity-40" hitSlop={5}>
          <Ionicons name="attach" size={20} color="#d4d4d8" />
        </Pressable>
        <Pressable disabled={sending || uploading || isDeliveryDisabled} onPress={() => setPortfoliosOpen(true)} className="h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 active:bg-zinc-800 disabled:opacity-40" hitSlop={5}>
          <Ionicons name="folder-open-outline" size={20} color="#d4d4d8" />
        </Pressable>
        
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!isDeliveryDisabled}
          multiline
          maxLength={2000}
          placeholder="Escribe un mensaje..."
          placeholderTextColor="#71717a"
          className="flex-1 min-h-[40px] max-h-[140px] rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 disabled:opacity-40"
          style={{ textAlignVertical: 'center' }}
        />
        
        {text.trim() || pending ? (
          <Pressable disabled={sending || uploading || isDeliveryDisabled} onPress={submit} className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 active:bg-brand-500 disabled:opacity-40">
            <Ionicons name="send" size={16} color="#ffffff" style={{ marginLeft: 2 }} />
          </Pressable>
        ) : (
          <Pressable disabled={sending || uploading || isDeliveryDisabled} onPress={startRecording} className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 active:bg-brand-500 disabled:opacity-40">
            <Ionicons name="mic" size={18} color="#ffffff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function LeadDetailsModal({ visible, companyId, lead, onClose }: { visible: boolean; companyId: string; lead: Lead; onClose: () => void }) {
  const notes = useLeadNotes(companyId, lead.id);
  const calls = useLeadCalls(companyId, lead.id);
  const [name, setName] = useState(lead.name ?? '');
  const [status, setStatus] = useState<Lead['status']>(lead.status);
  const [tags, setTags] = useState((lead.tags ?? []).join(', '));
  const [metadata, setMetadata] = useState<Record<string, string>>(lead.metadata ?? {});
  const [fields, setFields] = useState<ContactField[]>([]);
  const [noteKind, setNoteKind] = useState<'note' | 'reminder'>('note');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(formatDateInput(Date.now() + 60 * 60 * 1000));
  const [dueTime, setDueTime] = useState(formatTimeInput(Date.now() + 60 * 60 * 1000));
  const [reminderPicker, setReminderPicker] = useState<'date' | 'time' | null>(null);
  const [analysis, setAnalysis] = useState<LeadAnalysis | undefined>(lead.aiAnalysis);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(lead.name ?? '');
    setStatus(lead.status);
    setTags((lead.tags ?? []).join(', '));
    setMetadata(lead.metadata ?? {});
    setAnalysis(lead.aiAnalysis);
  }, [lead.id, lead.name, lead.status, lead.tags, lead.metadata, lead.aiAnalysis]);

  useEffect(() => {
    if (!visible) return;
    listContactFields(companyId).then(setFields).catch((error) => {
      console.warn('[LeadDetailsModal] contact fields', error);
      setFields([]);
    });
    listLeadAppointments(companyId, lead.id).then(setAppointments).catch((error) => {
      console.warn('[LeadDetailsModal] appointments', error);
      setAppointments([]);
    });
  }, [companyId, visible, lead.id]);

  const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  const displayName = name.trim() || lead.name || lead.phone || 'Lead';

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateLead(companyId, lead.id, {
        name: name.trim() || undefined,
        status,
        tags: tagList,
        metadata,
      });
      Alert.alert('Guardado', 'Datos del contacto actualizados.');
    } catch {
      Alert.alert('No se pudo guardar', 'Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    const text = note.trim();
    if (!text || busy) return;
    const dueAt = noteKind === 'reminder' ? parseReminderMillis(dueDate, dueTime) : undefined;
    if (noteKind === 'reminder' && !dueAt) {
      Alert.alert('Fecha invalida', 'Escribe una fecha y hora valida para el recordatorio.');
      return;
    }
    setBusy(true);
    try {
      const noteId = await addLeadNote(companyId, lead.id, noteKind, text, dueAt);
      if (noteKind === 'reminder' && dueAt) {
        const scheduled = await scheduleLeadReminderNotification({
          noteId,
          companyId,
          leadId: lead.id,
          leadName: displayName,
          text,
          dueAt,
        }).catch((error) => {
          console.warn('[LeadDetailsModal] local reminder', error);
          return false;
        });
        Alert.alert(
          'Recordatorio guardado',
          scheduled
            ? `Te avisare el ${formatDateTime(dueAt)}.`
            : 'El recordatorio quedo guardado, pero Android no permitio programar la notificacion local. Revisa permisos de notificaciones de la app.'
        );
      } else {
        Alert.alert('Nota guardada', 'La nota quedo registrada en el contacto.');
      }
      setNote('');
      setNoteKind('note');
    } catch (error: any) {
      Alert.alert('No se pudo agregar', String(error?.message ?? 'Revisa tu conexion.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleReminder = async (item: LeadNote) => {
    if (item.kind !== 'reminder') return;
    const next = !item.done;
    try {
      await setReminderDone(companyId, lead.id, item.id, next);
      if (next) await cancelLeadReminderNotification(item.id).catch(() => undefined);
    } catch {
      Alert.alert('No se pudo actualizar', 'Intenta nuevamente.');
    }
  };

  const removeNote = async (item: LeadNote) => {
    Alert.alert('Eliminar', 'Quieres eliminar esta nota?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLeadNote(companyId, lead.id, item.id);
            if (item.kind === 'reminder') await cancelLeadReminderNotification(item.id).catch(() => undefined);
          } catch {
            Alert.alert('No se pudo eliminar', 'Intenta nuevamente.');
          }
        },
      },
    ]);
  };

  const runAnalysis = async () => {
    if (busy) return;
    setBusy(true);
    try { setAnalysis(await analyzeLead(companyId, lead.id)); }
    catch (error: any) { Alert.alert('No se pudo analizar', String(error?.message ?? 'Intenta nuevamente.')); }
    finally { setBusy(false); }
  };

  const callWithAi = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startAiCall(companyId, lead.id);
      Alert.alert('Llamada iniciada', 'El resumen, la transcripcion y la grabacion apareceran aqui cuando Dapta actualice la llamada.');
    } catch (error: any) {
      Alert.alert('No se pudo llamar', String(error?.message ?? 'Revisa configuracion de Dapta.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.modalTitle}>{displayName}</Text>
              <Text style={styles.modalSub}>{lead.phone || 'Lead sin telefono'}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Section title="Datos del contacto">
              <Field label="Nombre" value={name} onChangeText={setName} placeholder={lead.phone} />
              <Text style={styles.label}>Estado comercial</Text>
              <View style={styles.statusGrid}>
                {(['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'] as Lead['status'][]).map((item) => (
                  <Pressable key={item} onPress={() => setStatus(item)} style={[styles.statusPick, status === item && styles.statusPickActive]}>
                    <Text style={[styles.statusPickText, status === item && { color: colors.emerald }]}>{statusLabel(item)}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Etiquetas" value={tags} onChangeText={setTags} placeholder="interesado, prioridad, proyecto" />
              {tagList.length > 0 ? <View style={styles.chips}>{tagList.map((tag) => <Text key={tag} style={styles.chip}>#{tag}</Text>)}</View> : null}
              {fields.length > 0 ? (
                <View style={styles.customFieldsBlock}>
                  <Text style={styles.subsectionTitle}>Campos personalizados</Text>
                  {fields.map((field) => (
                    <View key={field.id}>
                      <Text style={styles.label}>{field.label}</Text>
                      {field.type === 'select' ? (
                        <View style={styles.statusGrid}>
                          {['', ...field.options].map((option) => (
                            <Pressable key={option || 'empty'} onPress={() => setMetadata((prev) => ({ ...prev, [field.id]: option }))} style={[styles.statusPick, (metadata[field.id] ?? '') === option && styles.statusPickActive]}>
                              <Text style={[styles.statusPickText, (metadata[field.id] ?? '') === option && { color: colors.emerald }]}>{option || 'Sin valor'}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <Field
                          label=""
                          value={metadata[field.id] ?? ''}
                          onChangeText={(value) => setMetadata((prev) => ({ ...prev, [field.id]: value }))}
                          placeholder={field.type === 'date' ? 'YYYY-MM-DD' : undefined}
                          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                        />
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
              <Pressable disabled={busy} onPress={save} style={styles.primaryWide}><Ionicons name="save-outline" size={17} color={colors.background} /><Text style={styles.primaryText}>Guardar cambios</Text></Pressable>
            </Section>

            <Section title="Notas y recordatorios">
              <View style={styles.segmentRow}>
                <Pressable onPress={() => setNoteKind('note')} style={[styles.segment, noteKind === 'note' && styles.segmentActive]}><Ionicons name="document-text-outline" size={15} color={noteKind === 'note' ? colors.emerald : colors.muted} /><Text style={[styles.segmentText, noteKind === 'note' && { color: colors.emerald }]}>Nota</Text></Pressable>
                <Pressable onPress={() => setNoteKind('reminder')} style={[styles.segment, noteKind === 'reminder' && styles.segmentActive]}><Ionicons name="alarm-outline" size={15} color={noteKind === 'reminder' ? colors.emerald : colors.muted} /><Text style={[styles.segmentText, noteKind === 'reminder' && { color: colors.emerald }]}>Recordatorio</Text></Pressable>
              </View>
              <TextInput value={note} onChangeText={setNote} multiline placeholder={noteKind === 'note' ? 'Escribe una nota interna...' : 'Ej: llamar para confirmar visita'} placeholderTextColor={colors.faint} style={styles.noteInput} />
              {noteKind === 'reminder' ? (
                <View style={styles.row}>
                  <SelectField label="Fecha" value={formatDateLabel(dueDate)} icon="calendar-outline" onPress={() => setReminderPicker('date')} />
                  <SelectField label="Hora" value={dueTime} icon="time-outline" onPress={() => setReminderPicker('time')} />
                </View>
              ) : null}
              <Pressable disabled={busy || !note.trim()} onPress={addNote} style={styles.secondaryButtonFull}><Ionicons name={noteKind === 'note' ? 'add' : 'alarm-outline'} size={17} color={colors.text} /><Text style={styles.secondaryText}>{noteKind === 'note' ? 'Agregar nota' : 'Agregar recordatorio'}</Text></Pressable>
              {notes.length === 0 ? <Text style={styles.muted}>Aun no hay notas ni recordatorios.</Text> : notes.map((item) => (
                <NoteRow key={item.id} note={item} onToggle={() => toggleReminder(item)} onDelete={() => removeNote(item)} />
              ))}
            </Section>
            <ReminderPickerSheet
              picker={reminderPicker}
              date={dueDate}
              time={dueTime}
              onDate={setDueDate}
              onTime={setDueTime}
              onClose={() => setReminderPicker(null)}
            />

            <Section title="Citas">
              {appointments.length === 0 ? <Text style={styles.muted}>Sin citas agendadas.</Text> : appointments.map((appointment) => (
                <AppointmentRow key={appointment.id} appointment={appointment} />
              ))}
            </Section>

            <Section title="Radiografia IA">
              {analysis ? <AnalysisBlock analysis={analysis} /> : <Text style={styles.muted}>Aun no hay analisis para este lead.</Text>}
              <Pressable disabled={busy} onPress={runAnalysis} style={styles.secondaryButtonFull}><Ionicons name="sparkles-outline" size={17} color={colors.text} /><Text style={styles.secondaryText}>{analysis ? 'Actualizar radiografia' : 'Analizar lead'}</Text></Pressable>
            </Section>

            <Section title="Llamadas IA">
              <Pressable disabled={busy || !lead.phone} onPress={callWithAi} style={styles.primaryWide}><Ionicons name="call-outline" size={17} color={colors.background} /><Text style={styles.primaryText}>Iniciar llamada IA</Text></Pressable>
              {calls.length === 0 ? <Text style={styles.muted}>Aun no hay llamadas registradas para este lead.</Text> : calls.map((call) => <CallRow key={call.id} call={call} />)}
            </Section>

            <Section title="SmartHome">
              <SmartHomeBitacoraPanel companyId={companyId} lead={lead} />
            </Section>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function NoteRow({ note, onToggle, onDelete }: { note: LeadNote; onToggle: () => void; onDelete: () => void }) {
  const dueMs = timestampMs(note.dueAt);
  const overdue = note.kind === 'reminder' && !note.done && dueMs > 0 && dueMs < Date.now();
  return (
    <View style={[styles.noteRow, overdue && styles.noteRowOverdue]}>
      <Pressable disabled={note.kind !== 'reminder'} onPress={onToggle} style={styles.noteIconButton}>
        <Ionicons name={note.kind === 'reminder' ? (note.done ? 'checkmark-circle' : 'alarm-outline') : 'document-text-outline'} size={17} color={note.done ? colors.faint : overdue ? colors.red : colors.emerald} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.noteText, note.done && { textDecorationLine: 'line-through', color: colors.faint }]}>{note.text}</Text>
        <Text style={styles.noteMeta}>{note.kind === 'reminder' && dueMs ? `${formatDateTime(dueMs)} · ` : ''}{note.authorName} · {shortTime(note.createdAt)}{overdue ? ' · vencido' : ''}</Text>
      </View>
      <Pressable onPress={onDelete} hitSlop={8} style={styles.noteIconButton}><Ionicons name="trash-outline" size={17} color={colors.red} /></Pressable>
    </View>
  );
}
function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const status = appointmentStatus(appointment.status);
  return (
    <View style={styles.apptCard}>
      <View style={styles.apptHeader}>
        <Text numberOfLines={1} style={styles.apptTitle}>{appointment.title}</Text>
        <Text style={[styles.apptStatus, { color: status.color }]}>{status.label}</Text>
      </View>
      <Text style={styles.apptWhen}>{formatAppointmentRange(appointment.startTime, appointment.endTime)}</Text>
      {appointment.googleMeetLink ? <MeetLink link={appointment.googleMeetLink} /> : null}
    </View>
  );
}

function MeetLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View style={styles.meetRow}>
      <Ionicons name="videocam" size={15} color={colors.emerald} />
      <Text numberOfLines={1} style={styles.meetLinkText}>{link}</Text>
      <Pressable onPress={() => Linking.openURL(link)} hitSlop={8} style={styles.meetAction}><Ionicons name="open-outline" size={16} color={colors.emerald} /></Pressable>
      <Pressable onPress={copy} hitSlop={8} style={styles.meetAction}><Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? colors.emerald : colors.muted} /></Pressable>
    </View>
  );
}

function appointmentStatus(status: Appointment['status']): { label: string; color: string } {
  if (status === 'canceled') return { label: 'Cancelada', color: colors.faint };
  if (status === 'completed') return { label: 'Realizada', color: colors.cyan };
  return { label: 'Agendada', color: colors.emerald };
}

function formatAppointmentRange(start: number, end: number) {
  const day = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const time = (ms: number) => new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(ms);
  return `${day} · ${time(start)}–${time(end)}`;
}

function TemplateModal({ visible, companyId, leadId, inboxId, onClose }: { visible: boolean; companyId: string; leadId: string; inboxId?: string; onClose: () => void }) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Solo plantillas aprobadas Y de la línea del lead (las plantillas son por WABA:
    // la línea del asesor ve las suyas y el 317 las suyas). Si el lead no tiene inbox,
    // se muestran todas para no dejar la lista vacía.
    listTemplates(companyId)
      .then((rows) => setTemplates(rows.filter((t) =>
        t.status === 'approved' && (!inboxId || !t.lineNumber || t.lineNumber === inboxId))))
      .catch(() => Alert.alert('Plantillas', 'No se pudieron cargar.'));
  }, [companyId, visible, inboxId]);

  const selectTemplate = (template: WhatsAppTemplate) => {
    setSelected(template);
    const next: Record<string, string> = {};
    template.variables?.forEach((variable) => { next[variable.key] = ''; });
    setVariables(next);
  };

  const send = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await sendTemplateMessage(companyId, leadId, selected.id, variables);
      Alert.alert('Plantilla enviada', 'La conversaciÃ³n quedÃ³ reactivada cuando el cliente responda.');
      onClose();
    } catch {
      Alert.alert('No se pudo enviar', 'Verifica que la plantilla estÃ© aprobada y tenga variables completas.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <View><Text style={styles.modalTitle}>Enviar plantilla</Text><Text style={styles.modalSub}>Mensajes aprobados por Meta</Text></View>
          <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          {templates.map((template) => (
            <Pressable key={template.id} onPress={() => selectTemplate(template)} style={[styles.templateCard, selected?.id === template.id && { borderColor: colors.emerald }]}>
              <Text style={styles.templateName}>{template.displayName}</Text>
              <Text numberOfLines={3} style={styles.templateBody}>{template.body}</Text>
            </Pressable>
          ))}
          {selected?.variables?.map((variable) => (
            <Field key={variable.key} label={`{{${variable.key}}}`} value={variables[variable.key] ?? ''} onChangeText={(value) => setVariables((prev) => ({ ...prev, [variable.key]: value }))} placeholder={variable.example} />
          ))}
          {/* Exigir que TODAS las variables tengan valor: WhatsApp rechaza parámetros vacíos. */}
          <Pressable disabled={!selected || sending || !(selected?.variables ?? []).every((v) => (variables[v.key] ?? '').trim())} onPress={send} style={styles.primaryWide}><Ionicons name="send-outline" size={17} color={colors.background} /><Text style={styles.primaryText}>Enviar plantilla</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const NO_PROJECT = 'Otros documentos';

function PortfolioModal({ visible, companyId, onSelect, onClose }: { visible: boolean; companyId: string; onSelect: (item: LibraryItem) => void; onClose: () => void }) {
  const { user, profile } = useAuth();
  const { items, loading } = useLibrary(visible ? companyId : null);
  const [project, setProject] = useState<string | null>(null);
  const [planos, setPlanos] = useState<PlanoIndexItem[]>([]);

  useEffect(() => { if (!visible) setProject(null); }, [visible]);

  useEffect(() => {
    let alive = true;
    fetchPlanosIndex().then((list) => { if (alive) setPlanos(list); });
    return () => { alive = false; };
  }, []);

  const planoGenAt = useRef(new Map<string, string | null>());
  useEffect(() => {
    const m = new Map<string, string | null>();
    planos.forEach((p) => m.set(planoItemId(p.planoId), p.generatedAt));
    planoGenAt.current = m;
  }, [planos]);

  const sizeLabel = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const groups = new Map<string, LibraryItem[]>();
  items.filter((i) => {
    const isVideo = i.kind === 'video' || i.contentType?.startsWith('video/');
    if (!isVideo) return true;
    if ((i.visibility ?? 'general') !== 'advisor') return true;
    return profile?.role === 'admin' || profile?.role === 'manager' || i.advisorId === user?.uid;
  }).forEach((i) => {
    const key = i.project?.trim() || NO_PROJECT;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });

  if (planos.length) {
    const keyByNorm = new Map<string, string>();
    [...groups.keys()].forEach((k) => keyByNorm.set(normalizeProjectName(k), k));
    planos.forEach((p) => {
      const norm = normalizeProjectName(p.projectName);
      let groupKey = keyByNorm.get(norm);
      if (!groupKey) {
        groupKey = p.name;
        keyByNorm.set(norm, groupKey);
        groups.set(groupKey, []);
      }
      groups.set(groupKey, [planoToLibraryItem(p, companyId, groupKey), ...(groups.get(groupKey) ?? [])]);
    });
  }

  const projectNames = [...groups.keys()].sort((a, b) => {
    if (a === NO_PROJECT) return 1;
    if (b === NO_PROJECT) return -1;
    return a.localeCompare(b);
  });
  const currentItems = project ? (groups.get(project) ?? []) : [];
  const showBack = project !== null && projectNames.length > 1;

  const close = () => { setProject(null); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          {showBack ? (
            <Pressable onPress={() => setProject(null)} hitSlop={10} style={{ marginRight: 8 }}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.modalTitle}>{project ?? 'Enviar documento'}</Text>
            <Text style={styles.modalSub}>{project ? 'Elige un documento' : 'Elige un proyecto'}</Text>
          </View>
          <Pressable onPress={close} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          {loading ? (
            <Text style={styles.muted}>Cargando...</Text>
          ) : items.length === 0 && planos.length === 0 ? (
            <Text style={styles.muted}>No hay documentos cargados todavia. Un administrador puede subirlos desde el CRM web, en Configuracion, Portafolios.</Text>
          ) : project === null ? (
            projectNames.map((name) => (
              <Pressable key={name} onPress={() => setProject(name)} style={styles.templateCard}>
                <View style={styles.portfolioRow}>
                  <Ionicons name="folder-open" size={22} color={colors.amber} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.templateName}>{name}</Text>
                    <Text numberOfLines={1} style={styles.templateBody}>{groups.get(name)!.length} documento(s)</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                </View>
              </Pressable>
            ))
          ) : (
            currentItems.map((item) => {
              const plano = isPlanoItem(item);
              const isVideo = item.kind === 'video' || item.contentType?.startsWith('video/');
              return (
              <Pressable key={item.id} onPress={() => { onSelect(item); setProject(null); }} style={[styles.templateCard, plano && { borderColor: '#10B98150', backgroundColor: '#10B98108' }]}>
                <View style={styles.portfolioRow}>
                  <Ionicons name={plano ? 'map' : isVideo ? 'videocam' : 'document-text'} size={22} color={plano ? '#34D399' : isVideo ? colors.amber : colors.emerald} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.templateName}>{item.title}</Text>
                    <Text numberOfLines={1} style={styles.templateBody}>{plano ? (timeAgo(planoGenAt.current.get(item.id) ?? null) || 'disponibilidad en vivo') : isVideo && (item.visibility ?? 'general') === 'advisor' ? `Solo ${item.advisorName || 'asesor'} - ${sizeLabel(item.sizeBytes)}` : sizeLabel(item.sizeBytes)}</Text>
                  </View>
                  <Ionicons name="send" size={17} color={colors.muted} />
                </View>
              </Pressable>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function statusLabel(status: Lead['status']) {
  return ({
    new: 'Nuevo',
    active: 'Activo',
    qualified: 'Calificado',
    scheduled: 'Agendado',
    lost: 'Perdido',
    closed: 'Vendido',
  } satisfies Record<Lead['status'], string>)[status] ?? status;
}

function formatDateInput(ms: number) {
  const date = new Date(ms);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTimeInput(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseReminderMillis(dateText: string, timeText: string) {
  const value = new Date(`${dateText.trim()}T${timeText.trim()}:00`);
  const ms = value.getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
}) {
  return (
    <View style={{ flex: 1 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.faint} keyboardType={keyboardType} style={styles.fieldInput} />
    </View>
  );
}

function SelectField({ label, value, icon, onPress }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.selectField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.selectInput}>
        <Ionicons name={icon} size={16} color={colors.muted} />
        <Text numberOfLines={1} style={styles.selectValue}>{value}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

function ReminderPickerSheet({
  picker,
  date,
  time,
  onDate,
  onTime,
  onClose,
}: {
  picker: 'date' | 'time' | null;
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(startOfMonth(parseDateInput(date) ?? new Date()).getTime());

  useEffect(() => {
    if (picker === 'date') setMonth(startOfMonth(parseDateInput(date) ?? new Date()).getTime());
  }, [date, picker]);

  if (!picker) return null;

  const monthDate = new Date(month);
  const monthDays = buildMonthGrid(monthDate);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{picker === 'date' ? 'Fecha del recordatorio' : 'Hora del recordatorio'}</Text>
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
                const value = formatDateInput(day.getTime());
                const selected = value === date;
                const inMonth = day.getMonth() === monthDate.getMonth();
                return (
                  <Pressable key={day.toISOString()} onPress={() => { onDate(value); onClose(); }} style={[styles.sheetDay, selected && styles.sheetDayActive]}>
                    <Text style={[styles.sheetDayText, !inMonth && styles.sheetDayMuted, selected && styles.sheetDayTextActive]}>{day.getDate()}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.optionGrid}>
            {reminderTimeOptions.map((value) => {
              const selected = value === time;
              return (
                <Pressable key={value} onPress={() => { onTime(value); onClose(); }} style={[styles.optionPill, selected && styles.optionPillActive]}>
                  <Text style={[styles.optionText, selected && styles.optionTextActive]}>{value}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function AnalysisBlock({ analysis }: { analysis: LeadAnalysis }) {
  const nextAction = analysis.nextAction || analysis.nextBestAction;
  const analyzedAt = typeof analysis.analyzedAt === 'number' ? analysis.analyzedAt : timestampMs(analysis.analyzedAt);
  return (
    <View style={styles.analysisBox}>
      <View style={styles.analysisHeader}>
        <Text style={styles.analysisScore}>{analysis.score ?? 0}/100</Text>
        <Text style={styles.temperatureChip}>{temperatureLabel(analysis.temperature)}</Text>
      </View>
      <Text style={styles.analysisText}>{analysis.summary || 'Sin resumen.'}</Text>
      {(analysis.budget || analysis.interestArea) ? (
        <View style={styles.chips}>
          {analysis.budget ? <Text style={styles.chip}>Presupuesto: {analysis.budget}</Text> : null}
          {analysis.interestArea ? <Text style={styles.chip}>Zona: {analysis.interestArea}</Text> : null}
        </View>
      ) : null}
      {nextAction ? <AnalysisPart title="Proximo paso" body={nextAction} detail={analysis.nextActionReason} /> : null}
      {analysis.interestLevel ? <AnalysisPart title="Nivel de interes" body={analysis.interestLevel} /> : null}
      <BulletBlock title="Senales de compra" items={analysis.buyingSignals} />
      <BulletBlock title="Objeciones / frenos" items={analysis.objections} />
      {analysis.lossRisk ? <AnalysisPart title="Riesgo de perdida" body={analysis.lossRisk} /> : null}
      <BulletBlock title="Por que este puntaje" items={analysis.scoreReasons} />
      {analysis.recommendedMessage ? <AnalysisPart title="Mensaje sugerido" body={analysis.recommendedMessage} /> : null}
      {analyzedAt ? <Text style={styles.analysisFoot}>Analizado {formatDateTime(analyzedAt)} - {analysis.messageCount ?? 0} mensajes</Text> : null}
    </View>
  );
}

function temperatureLabel(value?: LeadAnalysis['temperature']) {
  if (value === 'hot') return 'Caliente';
  if (value === 'cold') return 'Frio';
  return 'Tibio';
}

function AnalysisPart({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <View style={styles.analysisPart}>
      <Text style={styles.analysisPartTitle}>{title}</Text>
      <Text style={styles.analysisText}>{body}</Text>
      {detail ? <Text style={styles.analysisMuted}>{detail}</Text> : null}
    </View>
  );
}

function BulletBlock({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <View style={styles.analysisPart}>
      <Text style={styles.analysisPartTitle}>{title}</Text>
      {items.map((item, index) => <Text key={`${title}-${index}`} style={styles.analysisText}>- {item}</Text>)}
    </View>
  );
}

function CallRow({ call }: { call: RecentCall }) {
  const [open, setOpen] = useState(false);
  const player = useAudioPlayer(call.recordingUrl ? { uri: call.recordingUrl } : null, { updateInterval: 500 });
  const playback = useAudioPlayerStatus(player);
  const hasDetails = !!(call.summary || call.transcript || call.recordingUrl || call.outcome);
  const duration = call.durationSec ? formatCallDuration(call.durationSec) : formatAudioSeconds(playback.duration);
  const current = formatAudioSeconds(playback.currentTime);

  const togglePlayback = async () => {
    if (!call.recordingUrl) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      if (playback.playing) {
        player.pause();
      } else {
        if (playback.didJustFinish) player.seekTo(0);
        player.play();
      }
    } catch {
      Alert.alert('No se pudo reproducir', 'Intenta abrir la grabacion mas tarde.');
    }
  };

  return (
    <View style={styles.callCard}>
      <Pressable disabled={!hasDetails} onPress={() => setOpen((value) => !value)} style={styles.callSummaryRow}>
        <View style={styles.callIcon}>
          <Ionicons name={callStatusIcon(call.status)} size={18} color={callStatusColor(call.status)} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.callTitle}>{callStatusLabel(call.status)}{duration ? ` · ${duration}` : ''}</Text>
          {call.summary ? <Text numberOfLines={open ? undefined : 2} style={styles.callText}>{call.summary}</Text> : <Text style={styles.callText}>Sin resumen todavia.</Text>}
          {call.outcome ? <Text style={styles.callOutcome}>{call.outcome}</Text> : null}
        </View>
        {hasDetails ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.faint} /> : null}
      </Pressable>

      {open ? (
        <View style={styles.callDetails}>
          {call.recordingUrl ? (
            <View style={styles.audioBox}>
              <Pressable onPress={togglePlayback} style={styles.playButton}>
                <Ionicons name={playback.playing ? 'pause' : 'play'} size={16} color={colors.background} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.audioTitle}>Grabacion</Text>
                <Text style={styles.audioTime}>{current}{duration ? ` / ${duration}` : ''}</Text>
                <View style={styles.audioTrack}>
                  <View style={[styles.audioProgress, { width: audioProgressWidth(playback.currentTime, playback.duration) as `${number}%` }]} />
                </View>
              </View>
            </View>
          ) : <Text style={styles.muted}>Esta llamada aun no tiene grabacion.</Text>}

          {call.transcript ? (
            <View style={styles.callTextBlock}>
              <Text style={styles.callBlockTitle}>Transcripcion</Text>
              <Text style={styles.callTranscript}>{call.transcript}</Text>
            </View>
          ) : <Text style={styles.muted}>Aun no hay transcripcion para esta llamada.</Text>}
        </View>
      ) : null}
    </View>
  );
}

function callStatusLabel(status: string) {
  return ({
    initiated: 'Marcando',
    ringing: 'Sonando',
    connecting: 'Conectando',
    'in-progress': 'En curso',
    missed: 'Perdida',
    rejected: 'Rechazada',
    completed: 'Completada',
    'no-answer': 'Sin respuesta',
    voicemail: 'Buzon de voz',
    busy: 'Ocupado',
    failed: 'Fallida',
    transferred: 'Transferida',
  } as Record<string, string>)[status] ?? (status || 'Llamada');
}

function callStatusIcon(status: string): keyof typeof Ionicons.glyphMap {
  if (status === 'completed' || status === 'in-progress') return 'call-outline';
  if (status === 'missed' || status === 'no-answer') return 'call-outline';
  if (status === 'failed' || status === 'rejected' || status === 'busy') return 'call-outline';
  return 'call-outline';
}

function callStatusColor(status: string) {
  if (status === 'completed' || status === 'in-progress') return colors.emerald;
  if (status === 'failed' || status === 'rejected') return colors.red;
  if (status === 'missed' || status === 'no-answer' || status === 'busy') return colors.amber;
  return colors.cyan;
}

function formatCallDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatAudioSeconds(seconds?: number) {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '0:00';
  return formatCallDuration(Math.floor(seconds));
}

function audioProgressWidth(current?: number, duration?: number) {
  if (!current || !duration || duration <= 0) return '0%';
  const pct = Math.max(0, Math.min(100, (current / duration) * 100));
  return `${pct}%`;
}

const styles = StyleSheet.create({
  composerWrap: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  templateOnly: { padding: 12, backgroundColor: '#0B5F4D', flexDirection: 'row', alignItems: 'center', gap: 10 },
  templateOnlyTitle: { color: colors.emerald, fontSize: 13, fontWeight: '900' },
  templateOnlyText: { color: colors.emerald, fontSize: 11, marginTop: 2 },
  templateButton: { backgroundColor: colors.emerald, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  templateButtonText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  channelSelector: { flexDirection: 'row', padding: 8, gap: 8 },
  channelBtn: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6, backgroundColor: colors.raised },
  channelBtnActiveCompany: { backgroundColor: colors.brand },
  channelBtnActiveAdvisor: { backgroundColor: colors.emerald },
  channelText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  channelTextActive: { color: colors.background, fontWeight: '900' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.raised, marginHorizontal: 8, borderRadius: 6 },
  pendingText: { flex: 1, color: colors.text, fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8 },
  composerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 100, backgroundColor: colors.raised, borderRadius: 18, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, color: colors.text, fontSize: 14 },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  messageTime: { color: colors.faint, fontSize: 10 },
  stickerWrap: { width: 140, height: 140, borderRadius: 12, overflow: 'hidden' },
  sticker: { width: '100%', height: '100%' },
  mediaWrap: { width: 220, height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised },
  imageMedia: { width: '100%', height: '100%' },
  videoFrame: { width: 220, height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised },
  videoMedia: { width: '100%', height: '100%' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.raised, width: 240 },
  fileCopy: { flex: 1 },
  fileText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  fileMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  messageAudioButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.emerald, alignItems: 'center', justifyContent: 'center' },
  messageAudioButtonOutbound: { backgroundColor: colors.brand },
  messageAudioMain: { flex: 1, marginLeft: 10 },
  messageAudioTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  messageAudioTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8, overflow: 'hidden' },
  messageAudioProgress: { height: '100%', backgroundColor: colors.emerald },
  messageAudioTime: { color: colors.muted, fontSize: 10, marginTop: 4 },
  safe: { flex: 1, backgroundColor: colors.background },
  chatBody: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 82, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  headerCopy: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  phone: { color: colors.muted, fontSize: 12, marginTop: 2 },
  ai: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  aiActive: { backgroundColor: colors.brandDark, borderColor: colors.brandBorder },
  aiDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  aiText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  windowBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 6 },
  windowOpen: { backgroundColor: colors.emeraldDark },
  windowClosed: { backgroundColor: colors.raised },
  windowText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  windowAction: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  messages: { padding: 12, gap: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageRowOutbound: { flexDirection: 'row-reverse' },
  messageContainer: { maxWidth: '85%', marginBottom: 6 },
  senderLabel: { color: colors.muted, fontSize: 10, paddingHorizontal: 4, marginBottom: 2 },
  routeLabel: { color: colors.faint, fontSize: 9, paddingHorizontal: 4, marginTop: 2 },
  bubble: { padding: 12, borderRadius: 16 },
  bubbleOutbound: { borderBottomRightRadius: 4 },
  bubbleInbound: { borderBottomLeftRadius: 4 },
  bubbleLead: { backgroundColor: '#3F3F46' },
  bubbleAi: { backgroundColor: '#5B21B666', borderColor: '#7C3AED66', borderWidth: 1 },
  bubbleAdvisor: { backgroundColor: '#1E3A8A66', borderColor: '#2563EB66', borderWidth: 1 },
  audioFile: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.raised, borderRadius: 12, padding: 10, width: 240 },
  recordingBar: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.red },
  recordingTime: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  recordingLabel: { flex: 1, color: colors.muted, fontSize: 10 },
  cancelRecording: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendRecording: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.emerald },
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  modalSub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 14, gap: 14, paddingBottom: 34 },
  section: { gap: 10, padding: 13, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  label: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  fieldInput: { minHeight: 44, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, color: colors.text, paddingHorizontal: 12, fontSize: 13 },
  selectField: { flex: 1, gap: 6 },
  selectInput: { minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  statusPick: { height: 32, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.raised },
  statusPickActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldDark },
  statusPickText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, color: colors.muted, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '700' },
  customFieldsBlock: { gap: 9, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  subsectionTitle: { color: colors.faint, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  primaryWide: { minHeight: 44, borderRadius: 8, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  primaryText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 39, flex: 1, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryButtonFull: { minHeight: 42, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8 },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segment: { flex: 1, minHeight: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segmentActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldDark },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  noteInput: { minHeight: 74, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, color: colors.text, padding: 12, fontSize: 13, textAlignVertical: 'top' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
  noteRowOverdue: { backgroundColor: '#2A1111', borderRadius: 7, paddingHorizontal: 8, borderTopWidth: 0 },
  noteIconButton: { width: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  noteText: { color: colors.text, fontSize: 12, lineHeight: 17 },
  noteMeta: { color: colors.faint, fontSize: 10, marginTop: 2 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  analysisBox: { borderRadius: 7, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, padding: 11, gap: 6 },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  analysisScore: { color: colors.emerald, fontSize: 13, fontWeight: '900' },
  temperatureChip: { borderRadius: 999, borderWidth: 1, borderColor: '#0B5F4D', backgroundColor: colors.emeraldDark, color: colors.emerald, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  analysisText: { color: colors.text, fontSize: 12, lineHeight: 17 },
  analysisMuted: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  analysisPart: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 },
  analysisPartTitle: { color: colors.faint, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  analysisFoot: { color: colors.faint, fontSize: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  callCard: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, overflow: 'hidden' },
  callSummaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10 },
  callIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  callDetails: { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, padding: 10 },
  audioBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 10 },
  audioTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  audioTime: { color: colors.muted, fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] },
  audioTrack: { height: 4, borderRadius: 999, backgroundColor: colors.border, marginTop: 7, overflow: 'hidden' },
  audioProgress: { height: 4, borderRadius: 999, backgroundColor: colors.emerald },
  callTextBlock: { gap: 5 },
  callBlockTitle: { color: colors.faint, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  callTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  callText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  callOutcome: { alignSelf: 'flex-start', marginTop: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, color: colors.muted, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  callTranscript: { color: colors.text, fontSize: 11, lineHeight: 17 },
  playButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.emerald, alignItems: 'center', justifyContent: 'center' },
  apptCard: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, padding: 11, gap: 6 },
  apptHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  apptTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, fontWeight: '800' },
  apptStatus: { fontSize: 10, fontWeight: '900' },
  apptWhen: { color: colors.muted, fontSize: 11, textTransform: 'capitalize' },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 7, borderWidth: 1, borderColor: '#0B5F4D', backgroundColor: colors.emeraldDark, paddingHorizontal: 9, paddingVertical: 7, marginTop: 2 },
  meetLinkText: { flex: 1, minWidth: 0, color: colors.emerald, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  meetAction: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  templateCard: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  templateName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  templateBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  portfolioRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  optionPill: { minWidth: 74, minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  optionPillActive: { borderColor: colors.brandBorder, backgroundColor: colors.brandDark },
  optionText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  optionTextActive: { color: colors.brand },
});

