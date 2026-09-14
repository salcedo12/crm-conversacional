import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Lead } from '../types';

/**
 * Escucha en tiempo real UN lead por id. Se usa como respaldo en la Bandeja
 * cuando se abre `?lead=<id>` de un lead que NO está en la lista cargada/filtrada
 * (p. ej. un lead Vendido/cerrado que la pestaña de estado oculta, o uno fuera de
 * la página cargada). Así el chat se abre igual al llegar desde el informe/búsqueda.
 *
 * `leadId` null desactiva el listener (sin lecturas).
 */
export function useLeadById(companyId: string | null, leadId: string | null) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId || !leadId) { setLead(null); setLoading(false); return; }
    setLoading(true);
    const ref = doc(db, 'companies', companyId, 'leads', leadId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLead(snap.exists() ? ({ id: snap.id, ...snap.data() } as Lead) : null);
        setLoading(false);
      },
      () => { setLead(null); setLoading(false); },
    );
    return unsub;
  }, [companyId, leadId]);

  return { lead, loading };
}
