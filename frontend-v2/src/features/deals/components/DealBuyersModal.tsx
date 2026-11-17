import { useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, Plus, Search, Trash2, UserRound, Users } from 'lucide-react';
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
import { DealField as Field, DealSheet, DealSheetFooter, dealInputCls as inputCls } from './DealSheet';

interface DealBuyersModalProps {
  companyId:       string;
  deal:            DealSummary;
  /** Lead del negocio (para prellenar el titular). Desde Negocios puede no estar cargado aún. */
  lead?:           Pick<Lead, 'name' | 'phone' | 'metadata'> | null;
  /** Compradores de otro negocio del mismo cliente para prellenar si este negocio está vacío. */
  fallbackBuyers?: ClientProfile[];
  onClose:         () => void;
  onSaved:         () => void;
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

export function profileToInput(p: ClientProfile): ClientInput {
  const { id: _id, leadIds: _leads, createdAt: _c, updatedAt: _u, ...input } = p;
  return { ...EMPTY_BUYER, ...input };
}

/** Primer comprador a partir del lead: "Carlos Andrés Prueba Uno" → 2 nombres + apellidos. */
function buyerFromLead(lead: Partial<Pick<Lead, 'name' | 'phone' | 'metadata'>>): ClientInput {
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

/** Comprador en edición con una llave estable (para abrir/cerrar y quitar sin mezclar fichas). */
interface BuyerDraft { key: number; data: ClientInput }

export function DealBuyersModal({ companyId, deal, lead, fallbackBuyers, onClose, onSaved }: DealBuyersModalProps) {
  // Ciudades con el nombre exacto de DocuBlock (si no coinciden, la firma falla).
  const docublock = useDocuBlockPlaces(companyId);
  const nextKey = useRef(0);
  const initialProfiles = deal.buyerProfiles.length
    ? deal.buyerProfiles
    : fallbackBuyers && fallbackBuyers.length
    ? fallbackBuyers
    : null;

  const [buyers, setBuyers] = useState<BuyerDraft[]>(() =>
    (initialProfiles
      ? initialProfiles.map(profileToInput)
      : [buyerFromLead(lead ?? { name: deal.leadName })]
    ).map((data) => ({ key: nextKey.current++, data })),
  );
  // Abiertos al empezar: los que tienen datos pendientes (o el titular si todo está completo).
  const [open, setOpen] = useState<Set<number>>(() => {
    const pending = buyers.filter((b) => missingClientFields(b.data).length > 0).map((b) => b.key);
    return new Set(pending.length ? pending : [buyers[0]!.key]);
  });
  const [found, setFound] = useState<Record<number, ClientProfile | null>>({});
  const [searching, setSearching] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<ClientInput>) =>
    setBuyers((prev) => prev.map((b) => (b.key === key ? { ...b, data: { ...b.data, ...patch } } : b)));

  const toggle = (key: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const lookup = async (key: number) => {
    const b = buyers.find((x) => x.key === key)?.data;
    if (!b || b.identificationNumber.trim().length < 3) return;
    setSearching(key);
    try {
      const client = await findClientByIdentification(companyId, b.identificationKind, b.identificationNumber);
      setFound((prev) => ({ ...prev, [key]: client }));
    } catch {
      setFound((prev) => ({ ...prev, [key]: null }));
    } finally {
      setSearching(null);
    }
  };

  const addBuyer = () => {
    const key = nextKey.current++;
    setBuyers((prev) => [...prev, { key, data: { ...EMPTY_BUYER } }]);
    setOpen((prev) => new Set(prev).add(key));
    // Llevar al nuevo comprador a la vista (en celular queda debajo del pliegue).
    window.setTimeout(() => document.getElementById(`buyer-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const removeBuyer = (key: number, label: string) => {
    if (!window.confirm(`¿Quitar a ${label} de este negocio?`)) return;
    setBuyers((prev) => prev.filter((b) => b.key !== key));
  };

  const missing = buyers.map((b) => missingClientFields(b.data));
  const pendingCount = missing.filter((m) => m.length > 0).length;
  const canSave = pendingCount === 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDealBuyers(companyId, deal.id, buyers.map(({ data: b }) => ({
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
    <DealSheet
      title="Compradores del negocio"
      subtitle="Estos datos pasan a la preventa, la promesa y la firma electrónica."
      icon={<Users size={18} />}
      onClose={onClose}
      width="lg"
      bodyClassName="space-y-3"
      footer={
        <DealSheetFooter
          error={error}
          info={canSave
            ? <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 size={13} /> {buyers.length} de {MAX_BUYERS} compradores · datos completos</span>
            : <span className="text-amber-300/90">Faltan datos en {pendingCount === 1 ? '1 comprador' : `${pendingCount} compradores`}</span>}
          actions={<>
            <Button variant="ghost" onClick={onClose} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={!canSave} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
              Guardar compradores
            </Button>
          </>}
        />
      }
    >
      {buyers.map(({ key, data: b }, i) => {
        const natural = b.personKind === 'natural';
        const match = found[key];
        const isOpen = open.has(key);
        const label = i === 0 ? 'Comprador titular' : `Comprador ${i + 1}`;
        const fullName = `${b.firstNames} ${natural ? b.lastNames : ''}`.trim();
        const pending = missing[i]!;
        return (
          <section key={key} id={`buyer-${key}`} className="scroll-mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
            {/* Encabezado plegable: nombre, documento y si le faltan datos. */}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/60"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${pending.length ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                {pending.length ? <UserRound size={16} /> : <CheckCircle2 size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
                <span className="block truncate text-sm font-semibold text-zinc-100">{fullName || 'Sin nombre'}</span>
                <span className="block truncate text-xs text-zinc-500">
                  {b.identificationNumber ? `${b.identificationKind} ${b.identificationNumber}` : 'Sin documento'}
                  {pending.length > 0 && <span className="text-amber-300/90"> · faltan {pending.length} dato{pending.length === 1 ? '' : 's'}</span>}
                </span>
              </span>
              <ChevronDown size={18} className={`shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="space-y-4 border-t border-zinc-800 px-4 pb-4 pt-3">
                <Group title="Identificación">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Tipo de cliente">
                      <select className={inputCls} value={b.personKind} onChange={(e) => update(key, { personKind: e.target.value as ClientInput['personKind'] })}>
                        <option value="natural">Persona natural</option>
                        <option value="juridica">Persona jurídica</option>
                      </select>
                    </Field>
                    <Field label="Tipo de identificación">
                      <select
                        className={inputCls}
                        value={b.identificationKind}
                        onChange={(e) => update(key, { identificationKind: e.target.value as IdentificationKind })}
                      >
                        {Object.entries(IDENTIFICATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Número de identificación">
                      <div className="flex gap-2 sm:gap-1.5">
                        <input
                          className={inputCls}
                          value={b.identificationNumber}
                          onChange={(e) => update(key, { identificationNumber: e.target.value })}
                          onBlur={() => lookup(key)}
                          inputMode={b.identificationKind === 'PAS' ? 'text' : 'numeric'}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => lookup(key)}
                          className="flex w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 sm:w-8 sm:rounded-md"
                          title="Buscar ficha guardada"
                          aria-label="Buscar ficha guardada"
                        >
                          {searching === key ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                        </button>
                      </div>
                    </Field>
                  </div>

                  {match && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200 sm:text-[11px]">
                      <span>Ya existe una ficha de {match.firstNames} {match.lastNames}.</span>
                      <button
                        type="button"
                        onClick={() => { update(key, profileToInput(match)); setFound((prev) => ({ ...prev, [key]: null })); }}
                        className="rounded-md bg-emerald-500/20 px-3 py-1.5 font-semibold hover:bg-emerald-500/30"
                      >
                        Usar esa ficha
                      </button>
                    </div>
                  )}
                </Group>

                <Group title={natural ? 'Datos personales' : 'Empresa'}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={natural ? 'Nombres' : 'Razón social'}>
                      <input className={inputCls} value={b.firstNames} autoCapitalize="characters" autoComplete="off"
                        onChange={(e) => update(key, { firstNames: e.target.value })} />
                    </Field>
                    {natural && (
                      <Field label="Apellidos">
                        <input className={inputCls} value={b.lastNames} autoCapitalize="characters" autoComplete="off"
                          onChange={(e) => update(key, { lastNames: e.target.value })} />
                      </Field>
                    )}
                  </div>
                  {natural && (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Field label="Fecha de nacimiento" className="col-span-2 sm:col-span-1">
                        <input type="date" className={inputCls} value={b.birthDate ?? ''} onChange={(e) => update(key, { birthDate: e.target.value || undefined })} />
                      </Field>
                      <Field label="Estado civil">
                        <select className={inputCls} value={b.maritalStatus ?? ''} onChange={(e) => update(key, { maritalStatus: (e.target.value || undefined) as ClientInput['maritalStatus'] })}>
                          <option value="">Seleccionar</option>
                          {Object.entries(MARITAL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </Field>
                      <Field label="Género">
                        <select className={inputCls} value={b.gender ?? ''} onChange={(e) => update(key, { gender: (e.target.value || undefined) as ClientInput['gender'] })}>
                          <option value="">Seleccionar</option>
                          {Object.entries(GENDER_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </Field>
                    </div>
                  )}
                </Group>

                <Group title="Expedición y residencia">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="País y ciudad de expedición">
                      <PlaceSelect places={docublock} country={b.expeditionCountry} city={b.expeditionCity} className={inputCls} onChange={(v) => update(key, { expeditionCountry: v.country, expeditionCity: v.city })} />
                    </Field>
                    <Field label="Fecha de expedición">
                      <input type="date" className={inputCls} value={b.expeditionDate} onChange={(e) => update(key, { expeditionDate: e.target.value })} />
                    </Field>
                    <Field label="País y ciudad de residencia">
                      <PlaceSelect places={docublock} country={b.residenceCountry} city={b.residenceCity} className={inputCls} onChange={(v) => update(key, { residenceCountry: v.country, residenceCity: v.city })} />
                    </Field>
                  </div>
                </Group>

                <Group title="Contacto">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Dirección">
                      <input className={inputCls} value={b.address} autoComplete="off" onChange={(e) => update(key, { address: e.target.value })} />
                    </Field>
                    <Field label="Celular">
                      <input
                        className={inputCls}
                        value={b.mobile}
                        placeholder="+57 300 000 0000"
                        onChange={(e) => update(key, { mobile: e.target.value })}
                        onBlur={() => update(key, { mobile: normalizeMobile(b.mobile) })}
                        inputMode="tel"
                        type="tel"
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Correo">
                      <input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="off" className={inputCls} value={b.email}
                        onChange={(e) => update(key, { email: e.target.value })} />
                    </Field>
                  </div>
                </Group>

                {pending.length > 0 && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 sm:text-[11px]">
                    Falta: {pending.join(', ')}.
                  </p>
                )}

                {buyers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBuyer(key, fullName || label)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-xs text-red-400 hover:text-red-300 sm:min-h-0 sm:text-[11px]"
                  >
                    <Trash2 size={13} /> Quitar este comprador
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {buyers.length < MAX_BUYERS && (
        <button
          type="button"
          onClick={addBuyer}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700 px-3 py-3 text-sm text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-300 sm:w-auto sm:justify-start sm:py-2 sm:text-xs"
        >
          <Plus size={15} /> Agregar comprador ({buyers.length}/{MAX_BUYERS})
        </button>
      )}
    </DealSheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-zinc-300 sm:text-[11px]">{title}</p>
      {children}
    </div>
  );
}
