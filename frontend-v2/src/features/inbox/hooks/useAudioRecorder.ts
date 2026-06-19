import { useState, useRef, useCallback, useEffect } from 'react';

export type RecorderState = 'idle' | 'recording' | 'stopped';

export interface AudioRecorderResult {
  state:        RecorderState;
  durationSec:  number;
  audioBlob:    Blob | null;
  audioLevels:  number[];   // últimas N muestras de volumen [0-1] para el waveform
  start:        () => Promise<void>;
  stop:         () => void;
  cancel:       () => void;
  reset:        () => void;
}

const WAVEFORM_BARS = 40;

export function useAudioRecorder(): AudioRecorderResult {
  const [state,       setState]       = useState<RecorderState>('idle');
  const [durationSec, setDurationSec] = useState(0);
  const [audioBlob,   setAudioBlob]   = useState<Blob | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const animFrameRef      = useRef<number | null>(null);
  const isCancelledRef    = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stopAnalyser = () => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    analyserRef.current?.disconnect();
    audioCtxRef.current?.close().catch(() => {});
    analyserRef.current = null;
    audioCtxRef.current = null;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Loop de animación del waveform — lee el AnalyserNode a ~30fps
  const startWaveformLoop = useCallback((analyser: AnalyserNode) => {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray    = new Uint8Array(bufferLength);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);

      // Promedio ponderado hacia frecuencias de voz (primeros 2/3 del buffer)
      const voiceEnd = Math.floor(bufferLength * 0.66);
      let sum = 0;
      for (let i = 0; i < voiceEnd; i++) sum += dataArray[i];
      const raw   = sum / voiceEnd / 255;           // 0-1
      const level = Math.min(1, raw * 2.5);          // amplificar un poco

      setAudioLevels((prev) => {
        const next = [...prev.slice(1), level];
        return next;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    try {
      isCancelledRef.current = false;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      streamRef.current = stream;

      // Web Audio API para visualización
      const audioCtx = new AudioContext();
      const source   = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize           = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = audioCtx;
      startWaveformLoop(analyser);

      // MediaRecorder para captura
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current        = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopAnalyser();
        clearTimer();
        stopStream();

        if (isCancelledRef.current) {
          setAudioBlob(null);
          setDurationSec(0);
          setAudioLevels(Array(WAVEFORM_BARS).fill(0));
          setState('idle');
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setState('stopped');
      };

      recorder.start(100);
      setState('recording');
      setDurationSec(0);
      setAudioLevels(Array(WAVEFORM_BARS).fill(0));

      timerRef.current = setInterval(() => {
        setDurationSec((s) => s + 1);
      }, 1000);

    } catch (err) {
      console.error('[AudioRecorder] Mic error:', err);
      throw err;
    }
  }, [startWaveformLoop]);

  const stop = useCallback(() => {
    isCancelledRef.current = false;
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    isCancelledRef.current = true;
    stopAnalyser();
    clearTimer();
    stopStream();
    if (mediaRecorderRef.current?.state !== 'inactive') {
      chunksRef.current = [];
      mediaRecorderRef.current?.stop();
    } else {
      setAudioBlob(null);
      setDurationSec(0);
      setAudioLevels(Array(WAVEFORM_BARS).fill(0));
      setState('idle');
    }
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setDurationSec(0);
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
    setState('idle');
  }, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      clearTimer();
      stopAnalyser();
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, durationSec, audioBlob, audioLevels, start, stop, cancel, reset };
}

/** Formatea segundos como MM:SS */
export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
