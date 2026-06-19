import {
  useState, useRef, useCallback,
  type KeyboardEvent, type ChangeEvent,
} from 'react';
import { Button }             from '@/shared/components/Button';
import { Spinner }            from '@/shared/components/Spinner';
import { VoiceRecorder }      from './VoiceRecorder';
import { useAudioRecorder }   from '../hooks/useAudioRecorder';
import { uploadMedia }        from '../services/media.service';
import { convertBlobToMp3 }  from '../utils/convertToMp3';
import type { MediaUploadResult } from '../services/media.service';

interface MessageComposerProps {
  leadId:    string;
  companyId: string;
  onSend:    (text: string, media?: MediaUploadResult) => Promise<void>;
  disabled?: boolean;
}

// Tipos de archivo aceptados para adjuntar
const ACCEPT = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/3gpp',
  'audio/ogg', 'audio/mpeg', 'audio/mp4',
  'application/pdf',
].join(',');

export function MessageComposer({ leadId, companyId, onSend, disabled = false }: MessageComposerProps) {
  const [text,         setText]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [uploadPct,    setUploadPct]    = useState(0);
  const [pendingMedia, setPendingMedia] = useState<MediaUploadResult | null>(null);
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recorder = useAudioRecorder();

  const isRecording = recorder.state === 'recording' || recorder.state === 'stopped';

  // ── Enviar texto o media ───────────────────────────────────────────────────
  const handleSend = useCallback(async (mediaOverride?: MediaUploadResult) => {
    const mediaToSend = mediaOverride ?? pendingMedia ?? undefined;
    const content     = text.trim();

    if (!content && !mediaToSend) return;

    setText('');
    setPendingMedia(null);
    setPreviewUrl(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setSending(true);
    try {
      await onSend(content, mediaToSend);
    } catch (err) {
      setText(content);
      console.error('[Composer] send error:', err);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [text, pendingMedia, onSend]);

  // ── Enviar nota de voz ─────────────────────────────────────────────────────
  const handleSendVoice = useCallback(async () => {
    if (!recorder.audioBlob) return;
    setSending(true);
    setUploading(true);
    setUploadPct(0);
    try {
      const mp3Blob   = await convertBlobToMp3(recorder.audioBlob);
      const audioFile = new File([mp3Blob], `voz_${Date.now()}.mp3`, { type: 'audio/mpeg' });
      const media     = await uploadMedia(audioFile, companyId, leadId, ({ percent }) => {
        setUploadPct(percent);
      });
      recorder.reset();
      await onSend('', media);
    } catch (err) {
      console.error('[Composer] Error enviando nota de voz:', err);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }, [recorder, companyId, leadId, onSend]);

  // ── Enter para enviar ──────────────────────────────────────────────────────
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

  // ── Selección de archivo ───────────────────────────────────────────────────
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    } catch (err) {
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

  // ── Iniciar grabación ──────────────────────────────────────────────────────
  const handleMicClick = async () => {
    try {
      await recorder.start();
    } catch {
      alert('No se pudo acceder al micrófono. Verifica los permisos del navegador.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (disabled) {
    return (
      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950">
        <p className="text-xs text-zinc-500 text-center">Selecciona un lead para responder</p>
      </div>
    );
  }

  // ── Vista: grabando o preview de voz ──────────────────────────────────────
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

  // ── Vista normal ──────────────────────────────────────────────────────────
  return (
    <div className="border-t border-zinc-800 bg-zinc-950">
      {/* Preview de media adjunta */}
      {(pendingMedia || uploading) && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2 flex-1 min-w-0">
            {uploading ? (
              <>
                <Spinner size="sm" />
                <span className="text-xs text-zinc-400">Subiendo... {uploadPct}%</span>
                <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </>
            ) : pendingMedia ? (
              <>
                {previewUrl && pendingMedia.contentType.startsWith('image/') ? (
                  <img src={previewUrl} className="h-10 w-10 object-cover rounded" alt="preview" />
                ) : (
                  <span className="text-xl">
                    {pendingMedia.contentType.startsWith('video/') ? '🎥'
                      : pendingMedia.contentType.startsWith('audio/') ? '🎵'
                      : pendingMedia.contentType === 'application/pdf' ? '📄' : '📎'}
                  </span>
                )}
                <span className="text-xs text-zinc-300 truncate flex-1">{pendingMedia.fileName}</span>
                <button onClick={removePendingMedia} className="text-zinc-500 hover:text-red-400 transition-colors ml-1">✕</button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Barra principal */}
      <div className="px-3 py-2.5 flex items-end gap-2">
        {/* Adjuntar archivo */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || uploading}
          className="shrink-0 p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-0.5"
          title="Adjuntar archivo"
        >
          📎
        </button>
        <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={handleFileSelect} className="hidden" />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder="Escribe un mensaje... (Enter para enviar)"
          className="
            flex-1 resize-none rounded-xl bg-zinc-800 border border-zinc-700
            px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500
            focus:outline-none focus:border-violet-500/50
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors leading-relaxed
          "
          style={{ minHeight: '40px', maxHeight: '140px' }}
        />

        {/* Botón enviar texto O botón micrófono */}
        {text.trim() || pendingMedia ? (
          <Button
            onClick={() => handleSend()}
            disabled={sending || uploading}
            loading={sending}
            size="sm"
            className="shrink-0 mb-0.5"
          >
            {sending ? '' : '↑'}
          </Button>
        ) : (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={sending || uploading}
            className="
              shrink-0 h-9 w-9 rounded-full
              bg-violet-600 hover:bg-violet-500
              text-white flex items-center justify-center
              transition-all disabled:opacity-40 disabled:cursor-not-allowed
              shadow-md hover:shadow-violet-500/30 mb-0.5
            "
            title="Grabar nota de voz"
          >
            🎤
          </button>
        )}
      </div>

      <p className="px-4 pb-2 text-[10px] text-zinc-600">
        Enviando como asesor · Enter para enviar · Shift+Enter para nueva línea
      </p>
    </div>
  );
}
