import { useState, useEffect, useCallback } from 'react';
import {
  getWhatsappConnection,
  exchangeWhatsappCode,
  disconnectWhatsapp,
} from '../services/whatsapp.service';

interface ConnectionState {
  connected:    boolean;
  phoneNumber?: string;
  displayName?: string;
  wabaId?:      string;
  connectedAt?: number;
}

type Status = 'idle' | 'loading' | 'connecting' | 'success' | 'error';

export function useWhatsappConnection(companyId: string | null) {
  const [connection, setConnection] = useState<ConnectionState>({ connected: false });
  const [status,     setStatus]     = useState<Status>('idle');
  const [error,      setError]      = useState<string | null>(null);

  // Cargar estado al montar
  useEffect(() => {
    if (!companyId) return;
    setStatus('loading');
    getWhatsappConnection(companyId)
      .then((c) => { setConnection(c); setStatus('idle'); })
      .catch((err) => { console.error(err); setStatus('idle'); });
  }, [companyId]);

  const connect = useCallback(async (codeOrToken: string, redirectUri?: string, isCode?: boolean) => {
    if (!companyId) return;
    setStatus('connecting');
    setError(null);
    try {
      const result = await exchangeWhatsappCode(companyId, codeOrToken, redirectUri, isCode);
      setConnection({
        connected:   true,
        phoneNumber: result.phoneNumber,
        displayName: result.displayName,
        wabaId:      result.wabaId,
        connectedAt: Date.now(),
      });
      setStatus('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error conectando WhatsApp';
      setError(msg);
      setStatus('error');
    }
  }, [companyId]);

  const disconnect = useCallback(async () => {
    if (!companyId) return;
    setStatus('loading');
    try {
      await disconnectWhatsapp(companyId);
      setConnection({ connected: false });
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setStatus('idle');
    }
  }, [companyId]);

  return { connection, status, error, connect, disconnect };
}
