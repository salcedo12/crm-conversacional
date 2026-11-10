import { useState } from 'react';
import { Loader2, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import type { Lead } from '@/features/inbox/types';
import {
  findClientByIdentification,
  GENDER_LABELS,
  IDENTIFICATION_LABELS,
  MARITAL_LABELS,
  MAX_BUYERS,
  missingClientFields,
  normalizeMobile,
  saveDealBuyers,
  type ClientInput,
  type ClientProfile,
  type DealSummary,
  type IdentificationKind,
} from '../services/deals.service';
import { useDocuBlockPlaces } from '../hooks/useDocuBlockCities';
import { PlaceSelect } from './PlaceSelect';

interface DealBuyersModalProps {
  companyId: string;
  deal:      DealSummary;
  lead:      Lead;
  onClose:   () => void;
  onSaved:   () => void;
}

const EMPTY_BUYER: ClientInput = {
  personKind: 'natural',
  firstNames: '',
  lastNames: '',
  residenceCity: '',
  address: '',
  identificationKind: 'CC',
  identificationNumber: '',
  expeditionCity: '',
  expeditionDate: '',
  mobile: '',
  email: '',
};

function profileToInput(p: ClientProfile): ClientInput {
  const { id: _id, leadIds: _leads, createdAt: _c, updatedAt: _u, ...input } = p;
  return { ...EMPTY_BUYER, ...input };
}

/** Primer comprador a partir del lead: "Carlos Andrés Prueba Uno" → 2 nombres + apellidos. */
function buyerFromLead(lead: Lead): ClientInput {
  const words = (lead.name ?? '').trim().split(/\s+/).filter(Boolean);
  const cut = words.length >= 3 ? 2 : Math.min(1, words.length);
  const email = typeof lead.metadata?.email === 'string' ? lead.metadata.email : '';
  return {
    ...EMPTY_BUYER,
    firstNames: words.slice(0, cut).join(' ').toUpperCase(),
    lastNames: words.slice(cut).join(' ').toUpperCase(),
    mobile: lead.phone?.startsWith('+') ? lead.phone : '',
    email,
  };
}

const inputCls =
  'w-full rounded-md border border-zinc-700 bg-zinc-800/90 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500';

export function DealBuyersModal({ companyId, deal, lead, onClose, onSaved }: DealBuyersModalProps) {
  // Ciudades con el nombre exacto de DocuBlock (si no coinciden, la firma falla).
  const docublock = useDocuBlockPlaces(companyId);
  const [buyers, setBuyers] = useState<ClientInput[]>(() =>
    deal.buyerProfiles.length ? deal.buyerProfiles.map(profileToInput) : [buyerFromLead(lead)],
  );
  const [found, setFound] = useState<Record<number, ClientProfile | null>>({});
  const [searching, setSearching] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<ClientInput>) =>
    setBuyers((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const lookup = async (index: number) => {
    const b = buyers[index];
    if (b.identificationNumber.trim().length < 3) return;
    setSearching(index);
    try {
      const client = await findClientByIdentification(companyId, b.identificationKind, b.identificationNumber);
      setFound((prev) => ({ ...prev, [index]: client }));
    } catch {
      setFound((prev) => ({ ...prev, [index]: null }));
    } finally {
      setSearching(null);
    }
  };

  const missing = buyers.map(missingClientFields);
  const canSave = missing.every((m) => m.length === 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDealBuyers(companyId, deal.id, buyers.map((b) => ({
        ...b,
        mobile: normalizeMobile(b.mobile),
        ...(b.personKind === 'juridica' ? { birthDate: undefined, maritalStatus: undefined, gender: undefined } : {}),
      })));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los compradores.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Compradores del negocio</h2>
            <p className="text-[11px] text-zinc-500">Estos datos pasan a la preventa, la promesa y la firma electrónica.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {buyers.map((b, i) => {
            const natural = b.personKind === 'natural';
            const match = found[i];
            return (
              <section key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                    <UserRound size={13} className="text-emerald-400" />
                    {i === 0 ? 'Comprador titular' : `Comprador ${i + 1}`}
                  </p>
                  {buyers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setBuyers((prev) => prev.filter((_, j) => j !== i))}
                      className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                    >
                      <Trash2 size={12} /> Quitar
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Tipo de cliente">
                    <select className={inputCls} value={b.personKind} onChange={(e) => update(i, { personKind: e.target.value as ClientInput['personKind'] })}>
                      <option value="natural">Persona natural</option>
                      <option value="juridica">Persona jurídica</option>
                    </select>
                  </Field>
                  <Field label="Tipo de identificación">
                    <select
                      className={inputCls}
                      value={b.identificationKind}
                      onChange={(e) => update(i, { identificationKind: e.target.value as IdentificationKind })}
                    >
                      {Object.entries(IDENTIFICATION_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="Número de identificación">
                    <div className="flex gap-1.5">
                      <input
                        className={inputCls}
                        value={b.identificationNumber}
                        onChange={(e) => update(i, { identificationNumber: e.target.value })}
                        onBlur={() => lookup(i)}
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        onClick={() => lookup(i)}
                        className="rounded-md border border-zinc-700 px-2 text-zinc-400 hover:text-zinc-200"
                        title="Buscar ficha guardada"
                        aria-label="Buscar ficha guardada"
                      >
                        {searching === i ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                      </button>
                    </div>
                  </Field>
                </div>

                {match && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
                    <span>Ya existe una ficha de {match.firstNames} {match.lastNames}.</span>
                    <button
                      type="button"
                      onClick={() => { update(i, profileToInput(match)); setFound((prev) => ({ ...prev, [i]: null })); }}
                      className="font-semibold underline underline-offset-2 hover:text-emerald-100"
                    >
                      Usar esa ficha
                    </button>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={natural ? 'Nombres' : 'Razón social'}>
                    <input className={inputCls} value={b.firstNames} onChange={(e) => update(i, { firstNames: e.target.value })} />
                  </Field>
                  {natural && (
                    <Field label="Apellidos">
                      <input className={inputCls} value={b.lastNames} onChange={(e) => update(i, { lastNames: e.target.value })} />
                    </Field>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {natural && (
                    <>
                      <Field label="Fecha de nacimiento">
                        <input type="date" className={inputCls} value={b.birthDate ?? ''} onChange={(e) => update(i, { birthDate: e.target.value || undefined })} />
                      </Field>
                      <Field label="Estado civil">
                        <select className={inputCls} value={b.maritalStatus ?? ''} onChange={(e) => update(i, { maritalStatus: (e.target.value || undefined) as ClientInput['maritalStatus'] })}>
                          <option value="">Seleccionar</option>
                          {Object.entries(MARITAL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                      </Field>
                      <Field label="Género">
                        <select className={inputCls} value={b.gender ?? ''} onChange={(e) => update(i, { gender: (e.target.value || undefined) as ClientInput['gender'] })}>
                          <option value="">Seleccionar</option>
                          {Object.entries(GENDER_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                      </Field>
                    </>
                  )}
                  <Field label="País y ciudad de expedición">
                    <PlaceSelect places={docublock} country={b.expeditionCountry} city={b.expeditionCity} className={inputCls} onChange={(v) => update(i, { expeditionCountry: v.country, expeditionCity: v.city })} />
                  </Field>
                  <Field label="Fecha de expedición">
                    <input type="date" className={inputCls} value={b.expeditionDate} onChange={(e) => update(i, { expeditionDate: e.target.value })} />
                  </Field>
                  <Field label="País y ciudad de residencia">
                    <PlaceSelect places={docublock} country={b.residenceCountry} city={b.residenceCity} className={inputCls} onChange={(v) => update(i, { residenceCountry: v.country, residenceCity: v.city })} />
                  </Field>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Dirección" className="sm:col-span-1">
                    <input className={inputCls} value={b.address} onChange={(e) => update(i, { address: e.target.value })} />
                  </Field>
                  <Field label="Celular">
                    <input
                      className={inputCls}
                      value={b.mobile}
                      placeholder="+57 300 000 0000"
                      onChange={(e) => update(i, { mobile: e.target.value })}
                      onBlur={() => update(i, { mobile: normalizeMobile(b.mobile) })}
                      inputMode="tel"
                    />
                  </Field>
                  <Field label="Correo">
                    <input type="email" className={inputCls} value={b.email} onChange={(e) => update(i, { email: e.target.value })} />
                  </Field>
                </div>

                {missing[i].length > 0 && (
                  <p className="mt-3 text-[11px] text-amber-300/90">Falta: {missing[i].join(', ')}.</p>
                )}
              </section>
            );
          })}

          {buyers.length < MAX_BUYERS && (
            <button
              type="button"
              onClick={() => setBuyers((prev) => [...prev, { ...EMPTY_BUYER }])}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-300"
            >
              <Plus size={13} /> Agregar comprador
            </button>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-zinc-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          {error ? <p className="text-xs text-red-300">{error}</p> : <span className="text-[11px] text-zinc-500">{buyers.length} de {MAX_BUYERS} compradores</span>}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave} className="!bg-emerald-600 hover:!bg-emerald-500">
              Guardar compradores
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

