import { useState, useCallback } from 'react';
import type { Lead } from '../types';

/** Gestiona el lead seleccionado en la bandeja de entrada */
export function useSelectedLead(leads: Lead[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const clear = useCallback(() => {
    setSelectedId(null);
  }, []);

  return { selected, selectedId, select, clear };
}
