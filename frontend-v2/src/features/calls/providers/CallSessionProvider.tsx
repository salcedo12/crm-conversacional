import { createContext, useContext, type ReactNode } from 'react';
import { useWhatsappCallSession } from '../hooks/useWhatsappCallSession';

type CallSessionValue = ReturnType<typeof useWhatsappCallSession>;

const CallSessionContext = createContext<CallSessionValue | null>(null);

/**
 * Un único RTCPeerConnection/estado de llamada compartido por toda la app
 * (banner de llamada entrante en el layout + botón "Llamar" en el LeadDrawer
 * deben operar sobre la MISMA sesión, no una cada uno).
 */
export function CallSessionProvider({ children }: { children: ReactNode }) {
  const session = useWhatsappCallSession();
  return <CallSessionContext.Provider value={session}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSessionValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error('useCallSession debe usarse dentro de <CallSessionProvider>');
  return ctx;
}
