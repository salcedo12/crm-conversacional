import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import {
  COUNTRY_PREFIX_OPTIONS,
  getCountryByIso,
  detectCountryFromInput,
  type CountryPrefixOption,
} from '@/features/inbox/services/contacts.service';
import { FLAG_URLS } from '@/features/inbox/utils/flagAssets';

interface CountryPhoneInputProps {
  countryIso: string;
  onCountryChange: (iso: string) => void;
  phone: string;
  onPhoneChange: (localDigits: string) => void;
  onEnter?: () => void;
  statusBorder?: 'available' | 'reclaimable' | 'locked_by_other' | 'default';
  required?: boolean;
}

function getFlagSrc(iso: string): string {
  const lower = iso.toLowerCase();
  if (FLAG_URLS[lower]) return FLAG_URLS[lower];
  return `https://flagcdn.com/w40/${lower}.png`;
}

function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function CountryPhoneInput({
  countryIso,
  onCountryChange,
  phone,
  onPhoneChange,
  onEnter,
  statusBorder = 'default',
  required = true,
}: CountryPhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCountry = useMemo(() => getCountryByIso(countryIso), [countryIso]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filteredCountries = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return COUNTRY_PREFIX_OPTIONS;
    return COUNTRY_PREFIX_OPTIONS.filter((c) => {
      const nameNorm = normalizeSearch(c.name);
      const isoNorm = c.iso.toLowerCase();
      const codeNorm = c.code.toLowerCase();
      const codeDigits = c.code.replace(/\D/g, '');
      return (
        nameNorm.includes(q) ||
        isoNorm === q ||
        codeNorm.includes(q) ||
        codeDigits.startsWith(q.replace(/\D/g, '') || '__none__')
      );
    });
  }, [search]);

  const handleInput = (rawVal: string) => {
    const detected = detectCountryFromInput(rawVal, selectedCountry.iso);
    if (detected.iso.toLowerCase() !== selectedCountry.iso.toLowerCase()) {
      onCountryChange(detected.iso);
    }
    onPhoneChange(detected.localDigits);
  };

  const handleSelectCountry = (opt: CountryPrefixOption) => {
    onCountryChange(opt.iso);
    // Ajustar longitud máxima si el nuevo país permite menos dígitos
    const clean = phone.replace(/\D/g, '').slice(0, opt.maxDigits);
    if (clean !== phone) onPhoneChange(clean);
    setOpen(false);
  };

  const borderClass =
    statusBorder === 'available'
      ? 'border-emerald-500/60 focus:border-emerald-400'
      : statusBorder === 'reclaimable'
      ? 'border-amber-500/60 focus:border-amber-400'
      : statusBorder === 'locked_by_other'
      ? 'border-rose-500/60 focus:border-rose-400'
      : 'border-zinc-700 focus:border-amber-500/60';

  const digitsCount = phone.replace(/\D/g, '').length;
  const digitRangeText =
    selectedCountry.minDigits === selectedCountry.maxDigits
      ? `${selectedCountry.minDigits} dígitos`
      : `${selectedCountry.minDigits}-${selectedCountry.maxDigits} dígitos`;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-stretch gap-1.5">
        {/* Botón Selector de País con Bandera */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title={`${selectedCountry.name} (${selectedCountry.code})`}
          className="flex items-center justify-between gap-1.5 shrink-0 rounded-xl border border-zinc-700 bg-zinc-800/95 hover:bg-zinc-800 px-2.5 py-2 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none cursor-pointer transition-colors min-w-[96px]"
        >
          <span className="flex items-center gap-1.5">
            <img
              src={getFlagSrc(selectedCountry.iso)}
              alt={selectedCountry.name}
              className="w-4 h-3 object-cover rounded-[2px] shadow-sm shrink-0"
            />
            <span className="font-semibold font-mono text-zinc-100">{selectedCountry.code}</span>
          </span>
          <ChevronDown size={13} className="text-zinc-400 shrink-0" />
        </button>

        {/* Input numérico estricto del teléfono local */}
        <input
          type="tel"
          inputMode="numeric"
          required={required}
          value={phone}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={`Ej: ${selectedCountry.placeholder}`}
          className={`flex-1 min-w-0 rounded-xl border bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 font-mono placeholder:font-sans placeholder:text-zinc-600 focus:outline-none ${borderClass}`}
        />
      </div>

      {/* Indicador de formato rígido por país */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500 px-0.5">
        <span className="truncate">
          País: <strong className="text-zinc-400">{selectedCountry.name}</strong> ({digitRangeText})
        </span>
        {digitsCount > 0 && digitsCount < selectedCountry.minDigits && (
          <span className="text-amber-400/90 font-medium shrink-0">
            Faltan {selectedCountry.minDigits - digitsCount} dígito{selectedCountry.minDigits - digitsCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Menú Desplegable con Buscador en Tiempo Real */}
      {open && (
        <div className="absolute left-0 top-11 z-50 w-72 sm:w-80 rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-72">
          {/* Buscador */}
          <div className="p-2 border-b border-zinc-800 bg-zinc-950/80 sticky top-0">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-zinc-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar país o indicativo (ej: España, +1, +34)..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Lista de Países */}
          <div className="overflow-y-auto divide-y divide-zinc-800/50">
            {filteredCountries.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500">
                No se encontró ningún país con "{search}"
              </div>
            ) : (
              filteredCountries.map((opt) => {
                const isSelected = opt.iso.toLowerCase() === selectedCountry.iso.toLowerCase();
                return (
                  <button
                    key={`${opt.iso}-${opt.code}`}
                    type="button"
                    onClick={() => handleSelectCountry(opt)}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/15 text-amber-200 font-semibold'
                        : 'text-zinc-200 hover:bg-zinc-800/80'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={getFlagSrc(opt.iso)}
                        alt={opt.name}
                        className="w-4 h-3 object-cover rounded-[2px] shadow-sm shrink-0"
                      />
                      <span className="truncate">{opt.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-[11px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                        {opt.code}
                      </span>
                      {isSelected && <Check size={13} className="text-amber-400" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
