import React, { useState } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export interface FilterOption<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

interface PipelineFilterDropdownProps<T extends string = string> {
  value: T;
  onChange: (val: T) => void;
  options: FilterOption<T>[];
  icon?: React.ReactNode;
  placeholder?: string;
  searchable?: boolean;
}

export function PipelineFilterDropdown<T extends string = string>({
  value,
  onChange,
  options,
  icon,
  placeholder = 'Seleccionar...',
  searchable = false,
}: PipelineFilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOption = options.find((o) => o.id === value);
  const displayLabel = selectedOption?.label || placeholder;

  const filteredOptions = searchable && query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-all cursor-pointer shadow-sm ${
          isOpen
            ? 'border-violet-500 bg-zinc-900 text-white ring-1 ring-violet-500/30'
            : value !== 'all'
            ? 'border-violet-500/50 bg-violet-950/20 text-violet-200 hover:bg-zinc-900'
            : 'border-zinc-800 bg-zinc-950/90 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white'
        }`}
      >
        {icon && <span className="text-zinc-400 shrink-0">{icon}</span>}
        <span className="truncate max-w-[170px]">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180 text-violet-400' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop invisible para cerrar al hacer clic afuera */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setQuery('');
            }}
          />

          {/* Menú Flotante Dark con contraste óptimo */}
          <div
            className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-2xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl backdrop-blur-xl space-y-1.5 animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {searchable && (
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 mb-1">
                <Search size={13} className="text-zinc-500 shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
                  autoFocus
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-zinc-500">
                  Sin resultados para "{query}"
                </p>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = opt.id === value;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChange(opt.id);
                        setIsOpen(false);
                        setQuery('');
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-violet-600/25 text-violet-200 font-semibold border border-violet-500/30'
                          : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <span className="truncate">{opt.label}</span>
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {opt.badge !== undefined && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800">
                            {opt.badge}
                          </span>
                        )}
                        {isSelected && <Check size={14} className="text-violet-400" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
