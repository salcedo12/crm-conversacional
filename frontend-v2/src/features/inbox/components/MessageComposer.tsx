import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { Building2, FileAudio, FileText, FileVideo, FolderOpen, Mic, Paperclip, Send, Smartphone, X } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { VoiceRecorder } from './VoiceRecorder';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { uploadMedia } from '../services/media.service';
import { convertBlobToMp3 } from '../utils/convertToMp3';
import type { MediaUploadResult } from '../services/media.service';
import { PortfolioPicker } from '@/features/library/components/PortfolioPicker';
import { itemToMedia } from '@/features/library/services/library.service';
import type { LibraryItem } from '@/features/library/types';
import { mediaLimitMessage } from '../utils/mediaLimits';

interface MessageComposerProps {
  leadId: string;
  companyId: string;
  onSend: (text: string, media?: MediaUploadResult, deliveryChannel?: DeliveryChannel) => Promise<void>;
  disabled?: boolean;
  companyLineLabel?: string;
  advisorWhatsappAvailable?: boolean;
  defaultDeliveryChannel?: DeliveryChannel;
  companyLineDisabled?: boolean;
  companyLineDisabledReason?: string;
}

export type DeliveryChannel = 'company_whatsapp' | 'advisor_whatsapp';

const ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'application/pdf',
].join(',');

export function MessageComposer({
  leadId,
  companyId,
  onSend,
  disabled = false,
  companyLineLabel = 'Ventas',
  advisorWhatsappAvailable = false,
  defaultDeliveryChannel = 'company_whatsapp',
  companyLineDisabled = false,
  companyLineDisabledReason = 'La linea oficial solo puede enviar plantillas fuera de la ventana de 24h',
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>(defaultDeliveryChannel);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [pendingMedia, setPendingMedia] = useState<MediaUploadResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPortfolios, setShowPortfolios] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();
  const isRecording = recorder.state === 'recording' || recorder.state === 'stopped';

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

  const handleSend = useCallback(async (mediaOverride?: MediaUploadResult) => {
    const mediaToSend = mediaOverride ?? pendingMedia ?? undefined;
    const content = text.trim();
    if (!content && !mediaToSend) return;

    setErrorMsg(null);
    setText('');
    setPendingMedia(null);
    setPreviewUrl(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setSending(true);
    try {
      await onSend(content, mediaToSend, deliveryChannel);
    } catch (err) {
      setText(content);
      setErrorMsg('No se pudo enviar el mensaje. Revisa tu conexion e intentalo de nuevo.');
      console.error('[Composer] send error:', err);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [text, pendingMedia, deliveryChannel, onSend]);

  const handleSendVoice = useCallback(async () => {
    if (!recorder.audioBlob) return;
    setSending(true);
    setUploading(true);
    setUploadPct(0);
    try {
      const mp3Blob = await convertBlobToMp3(recorder.audioBlob);
      const audioFile = new File([mp3Blob], `voz_${Date.now()}.mp3`, { type: 'audio/mpeg' });
      const media = await uploadMedia(audioFile, companyId, leadId, ({ percent }) => {
        setUploadPct(percent);
      });
      recorder.reset();
      await onSend('', media, deliveryChannel);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg('No se pudo enviar la nota de voz. Intentalo de nuevo.');
      console.error('[Composer] Error enviando nota de voz:', err);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }, [recorder, companyId, leadId, deliveryChannel, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('video/')) {
      setErrorMsg('Para evitar copias y controlar consumo, los videos deben enviarse desde Portafolio o como enlace.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const limitError = mediaLimitMessage(file.type || 'application/octet-stream', file.size);
    if (limitError) {
      setErrorMsg(`${limitError} Para videos largos, usa Portafolio si ya esta aprobado o envia un enlace.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }

    setUploading(true);
    setUploadPct(0);
    try {
      const result = await uploadMedia(file, companyId, leadId, ({ percent }) => {
        setUploadPct(percent);
      });
      setPendingMedia(result);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg('No se pudo subir el archivo. Revisa tu conexion e intentalo de nuevo.');
      console.error('[Composer] Error subiendo archivo:', err);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingMedia = () => {
    setPendingMedia(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handleSelectPortfolio = (item: LibraryItem) => {
    setShowPortfolios(false);
    setErrorMsg(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    // El archivo ya vive permanente en Storage: no se re-sube, solo se envía por enlace.
    setPendingMedia(itemToMedia(item));
  };

  const handleMicClick = async () => {
    setErrorMsg(null);
    try {
      await recorder.start();
    } catch {
      setErrorMsg('No se pudo acceder al microfono. Verifica los permisos del navegador.');
    }
  };

  if (disabled) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3 pb-[env(safe-area-inset-bottom)]">
        <p className="text-center text-xs text-zinc-500">Selecciona un lead para responder</p>
      </div>
    );
  }

  if (isRecording) {
    return (
      <VoiceRecorder
        state={recorder.state}
        durationSec={recorder.durationSec}
        audioLevels={recorder.audioLevels}
        audioBlob={recorder.audioBlob}
        sending={sending || uploading}
        onStop={recorder.stop}
        onCancel={recorder.cancel}
        onSend={handleSendVoice}
      />
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
      {showPortfolios && (
        <PortfolioPicker
          companyId={companyId}
          onSelect={handleSelectPortfolio}
          onClose={() => setShowPortfolios(false)}
        />
      )}

      {errorMsg && (
        <div className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-300">{errorMsg}</p>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label="Descartar aviso"
            className="shrink-0 text-red-300/70 hover:text-red-200"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {(pendingMedia || uploading) && (
        <div className="flex items-center gap-2 px-3 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2">
            {uploading ? (
              <>
                <Spinner size="sm" />
                <span className="text-xs text-zinc-400">Subiendo... {uploadPct}%</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-700">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </>
            ) : pendingMedia ? (
              <>
                {previewUrl && pendingMedia.contentType.startsWith('image/') ? (
                  <img src={previewUrl} className="h-10 w-10 rounded object-cover" alt="preview" />
                ) : pendingMedia.contentType.startsWith('video/') ? (
                  <FileVideo size={20} className="shrink-0 text-zinc-300" />
                ) : pendingMedia.contentType.startsWith('audio/') ? (
                  <FileAudio size={20} className="shrink-0 text-zinc-300" />
                ) : (
                  <FileText size={20} className="shrink-0 text-zinc-300" />
                )}
                <span className="flex-1 truncate text-xs text-zinc-300">{pendingMedia.fileName}</span>
                <button onClick={removePendingMedia} className="ml-1 text-zinc-500 transition-colors hover:text-red-400" aria-label="Quitar archivo">
                  <X size={14} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 px-2.5 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || uploading}
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Adjuntar archivo"
          aria-label="Adjuntar archivo"
        >
          <Paperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={handleFileSelect} className="hidden" />

        <button
          type="button"
          onClick={() => setShowPortfolios(true)}
          disabled={sending || uploading}
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Enviar portafolio"
          aria-label="Enviar portafolio"
        >
          <FolderOpen size={18} />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder="Escribe un mensaje..."
          className="min-w-0 flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 transition-colors focus:border-violet-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          style={{ minHeight: '40px', maxHeight: '140px' }}
        />

        {text.trim() || pendingMedia ? (
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={sending || uploading}
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-md transition-all hover:bg-violet-500 hover:shadow-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            title="Enviar mensaje"
            aria-label="Enviar mensaje"
          >
            {sending ? <Spinner size="sm" /> : <Send size={17} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={sending || uploading}
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-md transition-all hover:bg-violet-500 hover:shadow-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            title="Grabar nota de voz"
            aria-label="Grabar nota de voz"
          >
            <Mic size={18} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[10px] text-zinc-500">
        <span>Enviar por</span>
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <button
            type="button"
            onClick={() => setDeliveryChannel('company_whatsapp')}
            disabled={companyLineDisabled}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              deliveryChannel === 'company_whatsapp'
                ? 'bg-violet-600/20 text-violet-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={companyLineDisabled ? companyLineDisabledReason : 'Responder desde la linea oficial de ventas'}
          >
            <Building2 size={12} /> {companyLineLabel}
          </button>
          <button
            type="button"
            onClick={() => setDeliveryChannel('advisor_whatsapp')}
            disabled={!advisorWhatsappAvailable}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              deliveryChannel === 'advisor_whatsapp'
                ? 'bg-emerald-500/15 text-emerald-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={advisorWhatsappAvailable ? 'Responder desde tu WhatsApp conectado' : 'Conecta tu WhatsApp en Configuracion'}
          >
            <Smartphone size={12} /> Mi WhatsApp
          </button>
        </div>
        <span className="hidden sm:inline">Enter para enviar - Shift+Enter para nueva linea</span>
      </div>
    </div>
  );
}
