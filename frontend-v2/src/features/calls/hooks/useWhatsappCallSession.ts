import { useCallback, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import {
  preAcceptWhatsappCall,
  acceptWhatsappCall,
  rejectWhatsappCall,
  terminateWhatsappCall,
  startWhatsappCall,
  type Call,
} from '@/features/leads/services/calls.service';

export type CallSessionState = 'idle' | 'connecting' | 'in-call' | 'ended';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** No hay trickle ICE documentado en la Calling API de ycloud — se espera a que
 *  termine la recolección de candidatos antes de mandar el SDP completo. */
function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Salvaguarda: no bloquear indefinidamente si el navegador no llega a 'complete'.
    setTimeout(resolve, 4000);
  });
}

/**
 * Maneja el ciclo de vida de RTCPeerConnection para una llamada de voz de
 * WhatsApp (entrante por ahora). Un solo hook, montado a nivel global, para
 * que sobreviva la navegación entre páginas.
 */
export function useWhatsappCallSession() {
  const [state, setState]           = useState<CallSessionState>('idle');
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [muted, setMuted]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const pcRef           = useRef<RTCPeerConnection | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const remoteAudioRef  = useRef<HTMLAudioElement | null>(null);
  const callUnsubRef    = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    callUnsubRef.current?.();
    callUnsubRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setActiveCall(null);
    setMuted(false);
    setState('idle');
  }, []);

  const watchCallDoc = useCallback((companyId: string, leadId: string, callId: string) => {
    callUnsubRef.current?.();
    callUnsubRef.current = onSnapshot(
      doc(db, 'companies', companyId, 'leads', leadId, 'calls', callId),
      (snap) => {
        const data = snap.data() as Call | undefined;
        if (!data) return;
        setActiveCall({ ...data, id: snap.id });

        // Saliente: el SDP answer llega async por webhook una vez el cliente contesta.
        const pc = pcRef.current;
        if (pc && data.sdpAnswer && !pc.currentRemoteDescription) {
          pc.setRemoteDescription({ type: 'answer', sdp: data.sdpAnswer }).catch((err) => {
            console.error('[useWhatsappCallSession] setRemoteDescription error:', err);
          });
        }

        if (data.status === 'in-progress') setState('in-call');
        if (['completed', 'failed', 'rejected', 'missed'].includes(data.status)) {
          cleanup();
        }
      }
    );
  }, [cleanup]);

  const setupPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.ontrack = (event) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = event.streams[0];
    };
    pcRef.current = pc;
    return pc;
  }, []);

  const answerInboundCall = useCallback(async (companyId: string, call: Call) => {
    setError(null);
    setState('connecting');
    setActiveCall(call);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const pc = setupPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription({ type: 'offer', sdp: call.sdpOffer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      const sdpAnswer = pc.localDescription?.sdp;
      if (!sdpAnswer) throw new Error('No se pudo generar la respuesta SDP.');

      await preAcceptWhatsappCall({ companyId, leadId: call.leadId, callId: call.id, sdpAnswer });
      await acceptWhatsappCall({ companyId, leadId: call.leadId, callId: call.id });

      watchCallDoc(companyId, call.leadId, call.id);
      setState('in-call');
    } catch (err) {
      console.error('[useWhatsappCallSession] answer error:', err);
      setError('No se pudo contestar la llamada.');
      cleanup();
    }
  }, [cleanup, setupPeerConnection, watchCallDoc]);

  const startOutboundCall = useCallback(async (
    companyId: string,
    lead: { id: string; name?: string; phone: string }
  ) => {
    setError(null);
    setState('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const pc = setupPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const sdpOffer = pc.localDescription?.sdp;
      if (!sdpOffer) throw new Error('No se pudo generar la oferta SDP.');

      const callId = await startWhatsappCall(companyId, lead.id, sdpOffer);
      watchCallDoc(companyId, lead.id, callId);
    } catch (err) {
      console.error('[useWhatsappCallSession] outbound error:', err);
      setError('No se pudo iniciar la llamada.');
      cleanup();
    }
  }, [cleanup, setupPeerConnection, watchCallDoc]);

  const rejectInboundCall = useCallback(async (companyId: string, call: Call) => {
    try {
      await rejectWhatsappCall({ companyId, leadId: call.leadId, callId: call.id });
    } catch (err) {
      console.error('[useWhatsappCallSession] reject error:', err);
    }
  }, []);

  const hangUp = useCallback(async () => {
    const call = activeCall;
    if (call) {
      try {
        await terminateWhatsappCall({ companyId: call.companyId, leadId: call.leadId, callId: call.id });
      } catch (err) {
        console.error('[useWhatsappCallSession] terminate error:', err);
      }
    }
    cleanup();
  }, [activeCall, cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }, [muted]);

  return {
    state,
    activeCall,
    error,
    muted,
    remoteAudioRef,
    answerInboundCall,
    rejectInboundCall,
    startOutboundCall,
    hangUp,
    toggleMute,
  };
}
