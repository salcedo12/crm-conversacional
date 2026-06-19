import { useRef, useState, useEffect } from 'react';
import { Spinner }       from '@/shared/components/Spinner';
import { formatDuration } from '../hooks/useAudioRecorder';
import type { RecorderState } from '../hooks/useAudioRecorder';

interface VoiceRecorderProps {
  state:        RecorderState;
  durationSec:  number;
  audioLevels:  number[];
  audioBlob:    Blob | null;
  sending:      boolean;
  onStop:       () => void;
  onCancel:     () => void;
  onSend:       () => void;
}

// ─── Waveform en tiempo real ──────────────────────────────────────────────────

function LiveWaveform({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-center gap-[2px] h-8 flex-1 px-1">
      {levels.map((level, i) => {
        const height = Math.max(3, Math.round(level * 28));
        const opacity = 0.4 + level * 0.6;
        return (
          <div
            key={i}
            className="rounded-full bg-violet-400 transition-none flex-shrink-0"
            style={{
              width:   '3px',
              height:  `${height}px`,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Waveform estático del preview ───────────────────────────────────────────

function StaticWaveform({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-center gap-[2px] h-8 flex-1 px-1">
      {levels.map((level, i) => {
        const height = Math.max(3, Math.round(level * 28));
        return (
          <div
            key={i}
            className="rounded-full bg-violet-500/70 flex-shrink-0"
            style={{ width: '3px', height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function VoiceRecorder({
  state, durationSec, audioLevels, audioBlob,
  sending, onStop, onCancel, onSend,
}: VoiceRecorderProps) {

  // Guardar snapshot del waveform cuando se detiene (para el preview)
  const [frozenLevels, setFrozenLevels] = useState<number[]>([]);
  const prevState = useRef<RecorderState>('idle');

  useEffect(() => {
    if (prevState.current === 'recording' && state === 'stopped') {
      setFrozenLevels([...audioLevels]);
    }
    prevState.current = state;
  }, [state, audioLevels]);

  // Preview URL del audio grabado
  const previewUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;

  // ── Estado: grabando ────────────────────────────────────────────────────────
  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-950 border-t border-zinc-800">

        {/* Botón cancelar */}
        <button
          onClick={onCancel}
          className="shrink-0 p-1.5 rounded-full text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Cancelar"
        >
          🗑
        </button>

        {/* Waveform animado */}
        <div className="flex-1 flex items-center gap-2 bg-zinc-800/60 rounded-2xl px-3 py-1.5">
          {/* Indicador rojo pulsante */}
          <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />

          <LiveWaveform levels={audioLevels} />

          {/* Timer */}
          <span className="shrink-0 text-xs font-mono text-zinc-300 tabular-nums min-w-[36px] text-right">
            {formatDuration(durationSec)}
          </span>
        </div>

        {/* Botón detener */}
        <button
          onClick={onStop}
          className="shrink-0 h-10 w-10 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-colors shadow-lg"
          title="Detener y enviar"
        >
          <span className="text-base">⏹</span>
        </button>
      </div>
    );
  }

  // ── Estado: preview (grabación lista para enviar) ───────────────────────────
  if (state === 'stopped' && audioBlob) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-950 border-t border-zinc-800">

        {/* Botón descartar */}
        <button
          onClick={onCancel}
          className="shrink-0 p-1.5 rounded-full text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Descartar"
        >
          🗑
        </button>

        {/* Preview del audio */}
        <div className="flex-1 flex items-center gap-2 bg-zinc-800/60 rounded-2xl px-3 py-1.5 min-w-0">
          {/* Botón play nativo oculto — usamos el elemento audio para control */}
          <audio
            src={previewUrl ?? ''}
            className="hidden"
            id="voice-preview"
          />
          <AudioPreviewPlayer src={previewUrl ?? ''} levels={frozenLevels} durationSec={durationSec} />
        </div>

        {/* Botón enviar */}
        <button
          onClick={onSend}
          disabled={sending}
          className="shrink-0 h-10 w-10 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white flex items-center justify-center transition-colors shadow-lg"
          title="Enviar nota de voz"
        >
          {sending ? <Spinner size="sm" /> : <span className="text-base">↑</span>}
        </button>
      </div>
    );
  }

  return null;
}

// ─── Mini reproductor para el preview ────────────────────────────────────────

function AudioPreviewPlayer({
  src, levels, durationSec,
}: { src: string; levels: number[]; durationSec: number }) {
  const audioRef  = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); }
    else         { el.play().catch(() => {}); }
  };

  const totalSec = durationSec || 1;

  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <audio
        ref={audioRef}
        src={src}
        onPlay={()   => setPlaying(true)}
        onPause={()  => { setPlaying(false); }}
        onEnded={()  => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
      />

      {/* Play/Pause */}
      <button
        onClick={toggle}
        className="shrink-0 h-7 w-7 rounded-full bg-violet-600/40 hover:bg-violet-600/60 text-violet-200 flex items-center justify-center transition-colors"
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* Barra de progreso + waveform */}
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <StaticWaveform levels={levels.length > 0 ? levels : Array(40).fill(0.3)} />
        {/* Barra de progreso */}
        <div className="h-0.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 transition-all duration-100"
            style={{ width: `${(current / totalSec) * 100}%` }}
          />
        </div>
      </div>

      {/* Duración */}
      <span className="shrink-0 text-xs font-mono text-zinc-400 tabular-nums">
        {formatDuration(playing ? Math.round(current) : durationSec)}
      </span>
    </div>
  );
}
