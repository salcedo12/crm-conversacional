import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_COUNTRY, placeKey, type DocuBlockPlaces } from '../hooks/useDocuBlockCities';

/**
 * País + ciudad escogidos de las listas de DocuBlock (no se escriben a mano, para que la
 * firma no falle). La ciudad se busca escribiendo ("ibag" → Ibagué) y solo se acepta una
 * de la lista del país escogido.
 */
export function PlaceSelect({ places, country, city, onChange, className }: {
  places: DocuBlockPlaces;
  country: string | undefined;
  city: string;
  onChange: (value: { country: string; city: string }) => void;
  className: string;
}) {
  const current = country || DEFAULT_COUNTRY;

  // Fichas viejas con la ciudad escrita a mano: se corrige al nombre exacto si existe.
  useEffect(() => {
    if (!places.ready || !city) return;
    const exact = places.exact(city, current);
    if (exact && exact !== city) onChange({ country: current, city: exact });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places.ready]);

  if (!places.ready) {
    return <input className={className} value={city} disabled placeholder="Cargando ciudades…" />;
  }

  return (
    <div className="space-y-1.5">
      <select
        className={className}
        value={current}
        onChange={(e) => onChange({ country: e.target.value, city: '' })}
        aria-label="País"
      >
        {places.countries.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <CityCombo
        cities={places.citiesOf(current)}
        value={city}
        invalid={!!city && !places.exact(city, current)}
        onChange={(value) => onChange({ country: current, city: value })}
        className={className}
      />
    </div>
  );
}

const MAX_SHOWN = 60;

function CityCombo({ cities, value, invalid, onChange, className }: {
  cities: string[];
  value: string;
  invalid: boolean;
  onChange: (city: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const key = placeKey(query);
    const list = key ? cities.filter((c) => placeKey(c).includes(key)) : cities;
    // Primero las que empiezan por lo escrito.
    return [...list].sort((a, b) => Number(placeKey(b).startsWith(key)) - Number(placeKey(a).startsWith(key))).slice(0, MAX_SHOWN);
  }, [cities, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (city: string) => { onChange(city); setOpen(false); setQuery(''); };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          className={`${className} pr-7 ${invalid ? 'border-amber-500/70' : ''}`}
          value={open ? query : value}
          placeholder={open ? (value || 'Buscar ciudad…') : 'Seleccionar'}
          onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); pick(matches[active]!); }
            else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
          }}
          role="combobox"
          aria-expanded={open}
          aria-label="Ciudad"
        />
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" />
      </div>
      {open && (
        <ul role="listbox" className="absolute z-[70] mt-1 max-h-64 w-full min-w-[12rem] overflow-auto overscroll-contain rounded-lg border border-zinc-700 bg-zinc-950 py-1 text-sm shadow-xl sm:max-h-56 sm:rounded-md sm:text-xs">
          {matches.length === 0 && <li className="px-3 py-2.5 text-zinc-500 sm:px-2.5 sm:py-1.5">No está en DocuBlock</li>}
          {matches.map((c, i) => (
            <li
              key={c}
              role="option"
              aria-selected={c === value}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2.5 sm:px-2.5 sm:py-1.5 ${i === active ? 'bg-violet-600/30 text-zinc-100' : 'text-zinc-300'} ${c === value ? 'font-semibold' : ''}`}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
      {invalid && !open && <p className="mt-1 text-[11px] text-amber-300">Escógela de la lista (así no existe en DocuBlock).</p>}
    </div>
  );
}
