import { useEffect, useState } from 'react';
import { getDocuBlockPlaces, type DocuBlockCountry } from '../services/deals.service';

/**
 * Países y ciudades tal como los escribe DocuBlock (con tildes). La ficha del comprador
 * los escoge de una lista, para que la firma no falle (en SmartHome "Ibague" contra
 * "Ibagué" rechazaba el envío). Se cargan una vez por sesión.
 */

export const DEFAULT_COUNTRY = 'Colombia';

let cache: Promise<DocuBlockCountry[]> | null = null;

export const placeKey = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function useDocuBlockPlaces(companyId: string | null | undefined) {
  const [countries, setCountries] = useState<DocuBlockCountry[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    cache ??= getDocuBlockPlaces(companyId).catch(() => { cache = null; return []; });
    void cache.then((list) => { if (!cancelled) setCountries(list); });
    return () => { cancelled = true; };
  }, [companyId]);

  const citiesOf = (country: string | undefined) =>
    countries.find((c) => c.name === (country || DEFAULT_COUNTRY))?.cities ?? [];

  /** Nombre exacto de DocuBlock para lo que ya tenía la ficha ("ibague" → "Ibagué"), o null. */
  const exact = (value: string, country: string | undefined): string | null => {
    const key = placeKey(value);
    if (!key) return null;
    const same = citiesOf(country).filter((c) => placeKey(c) === key);
    return same.find((c) => /[^\u0000-\u007f]/.test(c)) ?? same[0] ?? null;
  };

  return { countries, ready: countries.length > 0, citiesOf, exact };
}

export type DocuBlockPlaces = ReturnType<typeof useDocuBlockPlaces>;
