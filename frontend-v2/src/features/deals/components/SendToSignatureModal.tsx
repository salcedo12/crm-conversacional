import { useEffect, useMemo, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  getSignatureOptions,
  sendDealToSignature,
  type DealDocumentKind,
  type DealSummary,
  type SignatureOptions,
} from '../services/deals.service';
import { DealField, DealSheet, dealInputCls } from './DealSheet';
import { AVALADOR, defaultDirectory, defaultTemplate, defaultTypeSigns } from './signatureDefaults';

const KINDS: DealDocumentKind[] = ['preventa', 'promesa'];

const lastVersion = (deal: DealSummary, kind: DealDocumentKind) =>
  [...(deal.documents ?? [])].filter((d) => d.kind === kind).at(-1)?.version ?? null;

const dateText = (ms: number) => new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const LABELS: Record<DealDocumentKind, string> = { preventa: 'Contrato de preventa', promesa: 'Promesa de compraventa' };

interface Row {
  source:    'buyer' | 'docublock_user';
  refId:     string;
  name:      string;
  role:      string;
  checked:   boolean;
  iteration: number;
  typeSigns: Partial<Record<DealDocumentKind, string>>;
  disabledReason?: string;
}

/**
 * "Enviar a firma" (igual a la pantalla de SmartHome): plantilla y directorio por documento,
 * responsable, validación fotográfica y firmantes — compradores marcados en secuencia 1 y
 * los administrativos de Meraki (usuarios de DocuBlock) desmarcados en secuencia 2.
 * Se envían los dos documentos a la vez: primero la preventa y enseguida la promesa.
 */
export function SendToSignatureModal({ companyId, deal, onClose, onSent }: {
  companyId: string;
  deal: DealSummary;
  onClose: () => void;
  onSent: () => void;
}) {
  const [options, setOptions] = useState<SignatureOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [include, setInclude] = useState<Record<DealDocumentKind, boolean>>({ preventa: true, promesa: true });
  const [templateIds, setTemplateIds] = useState<Record<DealDocumentKind, string>>({ preventa: '', promesa: '' });
  const [directoryIds, setDirectoryIds] = useState<Record<DealDocumentKind, string>>({ preventa: '', promesa: '' });
  const [versions, setVersions] = useState<Record<DealDocumentKind, number | null>>(() => ({
    preventa: lastVersion(deal, 'preventa'),
    promesa: lastVersion(deal, 'promesa'),
  }));
  const [responsibleId, setResponsibleId] = useState('');
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  // Documentos que ya están en firma o firmados no se vuelven a enviar.
  const locked = useMemo(() => {
    const latest = (kind: DealDocumentKind) => [...(deal.documents ?? [])].reverse().find((d) => d.kind === kind);
    const out: Partial<Record<DealDocumentKind, string>> = {};
    for (const kind of KINDS) {
      const s = latest(kind)?.signatureStatus;
      if (s === 'firmado') out[kind] = 'Ya está firmado';
      else if (s === 'en_firma' || s === 'firmado_parcial') out[kind] = 'Ya está en firma';
    }
    return out;
  }, [deal.documents]);

  useEffect(() => {
    let cancelled = false;
    getSignatureOptions(companyId)
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        const projectId = deal.lot?.projectId ?? '';
        const tpl = { preventa: defaultTemplate(opts, 'preventa'), promesa: defaultTemplate(opts, 'promesa') };
        setTemplateIds(tpl);
        setDirectoryIds({ preventa: defaultDirectory(opts, tpl.preventa, projectId, 'preventa'), promesa: defaultDirectory(opts, tpl.promesa, projectId, 'promesa') });
        setInclude({ preventa: !locked.preventa, promesa: !locked.promesa });
        const buyers = [...deal.buyers].sort((a, b) => a.order - b.order)
          .map((b) => deal.buyerProfiles.find((p) => p.id === b.clientId))
          .filter((p): p is NonNullable<typeof p> => !!p);
        setRows([
          ...buyers.map((p, i) => ({ source: 'buyer' as const, refId: p.id, name: `${p.firstNames} ${p.lastNames}`.trim(), role: i === 0 ? 'Comprador titular' : `Comprador ${i + 1}`, checked: true, iteration: 1, typeSigns: {} })),
          // Firmantes de la empresa: solo los de la lista (como en SmartHome), con su rol.
          ...opts.users.filter((u) => u.signer).map((u) => ({ source: 'docublock_user' as const, refId: u.id, name: u.name, role: u.role, checked: false, iteration: 2, typeSigns: {}, disabledReason: u.complete ? undefined : 'Le faltan datos en DocuBlock (cédula, correo o celular)' })),
        ]);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'No se pudieron cargar las opciones de DocuBlock.'));
    return () => { cancelled = true; };
    // Solo al abrir: si el negocio se recarga (p. ej. tras un error), se conserva lo escogido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, deal.id]);

  const signerTypesOf = (kind: DealDocumentKind) => options?.templates.find((t) => t.id === templateIds[kind])?.signerTypes ?? [];

  // Tipos sugeridos al cambiar plantilla o marcar firmantes (el usuario puede cambiarlos).
  const autoAssign = (current: Row[], kinds = KINDS): Row[] => {
    const next = current.map((r) => ({ ...r, typeSigns: { ...r.typeSigns } }));
    for (const kind of kinds) {
      const types = signerTypesOf(kind);
      if (!types.length) continue;
      const buyers = next.filter((r) => r.checked && r.source === 'buyer');
      const meraki = next.filter((r) => r.checked && r.source === 'docublock_user');
      const d = defaultTypeSigns(types, buyers.length, meraki.length);
      buyers.forEach((r, i) => { r.typeSigns[kind] = d.buyers[i] ?? ''; });
      meraki.forEach((r, i) => { r.typeSigns[kind] = d.meraki[i] ?? AVALADOR; });
    }
    return next;
  };

  useEffect(() => {
    if (options) setRows((current) => autoAssign(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, templateIds.preventa, templateIds.promesa]);

  const toggle = (index: number) => setRows((current) => autoAssign(current.map((r, i) => (i === index ? { ...r, checked: !r.checked } : r))));
  const patch = (index: number, value: Partial<Row>) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...value } : r)));

  const kindsToSend = KINDS.filter((k) => include[k] && !locked[k]);
  const checked = rows.filter((r) => r.checked);
  const problems: string[] = [];
  for (const kind of kindsToSend) {
    if (!templateIds[kind]) problems.push(`Escoge la plantilla de la ${kind}`);
    if (!directoryIds[kind]) problems.push(`Escoge el directorio de la ${kind}`);
    if (checked.some((r) => !r.typeSigns[kind])) problems.push(`Falta el tipo de firmante en la ${kind}`);
  }
  if (!checked.length) problems.push('Marca al menos un firmante');

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await sendDealToSignature(companyId, deal.id, {
        documents: kindsToSend.map((kind) => ({ kind, version: versions[kind], templateId: templateIds[kind], directoryId: directoryIds[kind] })),
        signers: checked.map((r) => ({ source: r.source, refId: r.refId, iteration: r.iteration, typeSigns: Object.fromEntries(kindsToSend.map((k) => [k, r.typeSigns[k] ?? ''])) })),
        responsibleId: responsibleId || undefined,
        requirePhoto,
      });
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar a firma.');
      onSent(); // si algo alcanzó a enviarse, refrescar el negocio
    } finally {
      setSending(false);
    }
  };

  const select = `${dealInputCls} sm:bg-zinc-950 sm:focus:border-violet-500`;
  const sendLabel = `Enviar ${kindsToSend.length === 2 ? 'preventa y promesa' : kindsToSend[0] ?? ''} a firma`;

  return (
    <DealSheet
      title="Firma digital"
      subtitle={deal.lot ? `${deal.lot.sector} · Lote ${deal.lot.lotNumber}` : 'Negocio'}
      icon={<PenLine size={18} />}
      onClose={onClose}
      width="2xl"
      layer="top"
      footer={
        <div className="space-y-2">
          {error && <p className="rounded-md bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</p>}
          {options && problems.length > 0 && <p className="text-xs text-amber-300 sm:text-[11px]">{problems.join(' · ')}</p>}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500 sm:text-[11px]">Al enviar, el lote pasa a TRÁMITE mientras se firma.</p>
            <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex">
              <Button variant="ghost" onClick={onClose} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">Cancelar</Button>
              <Button loading={sending} disabled={!options || problems.length > 0 || !kindsToSend.length} onClick={() => void send()} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
                <span className="sm:hidden">Enviar a firma</span>
                <span className="hidden sm:inline">{sendLabel}</span>
              </Button>
            </div>
          </div>
        </div>
      }
    >
      {!options && !error && <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin" /> Cargando plantillas y firmantes de DocuBlock…</div>}

      {options && (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <div className="space-y-4">
            {KINDS.map((kind) => (
              <div key={kind} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <label className="flex min-h-[32px] items-center gap-2.5 text-sm font-semibold text-zinc-200 sm:min-h-0 sm:text-xs">
                  <input type="checkbox" className="h-5 w-5 sm:h-3.5 sm:w-3.5" checked={include[kind] && !locked[kind]} disabled={!!locked[kind]} onChange={(e) => setInclude((c) => ({ ...c, [kind]: e.target.checked }))} />
                  {LABELS[kind]}
                </label>
                {locked[kind] ? <p className="mt-1 text-xs text-zinc-500 sm:text-[11px]">{locked[kind]}</p> : include[kind] && (
                  <div className="mt-2 space-y-2">
                    <DealField label="Documento">
                      <select className={select} value={versions[kind] ?? ''} onChange={(e) => setVersions((c) => ({ ...c, [kind]: e.target.value ? Number(e.target.value) : null }))}>
                        {kind === 'promesa' && <option value="">Generar la promesa al enviar (con los datos de la preventa)</option>}
                        {[...(deal.documents ?? [])].filter((d) => d.kind === kind).reverse().map((d) => (
                          <option key={d.version} value={d.version}>{LABELS[kind]} · v{d.version}{d.generatedAt ? ` · ${dateText(d.generatedAt)}` : ''}</option>
                        ))}
                      </select>
                    </DealField>
                    <DealField label="Plantilla">
                      <select className={select} value={templateIds[kind]} onChange={(e) => {
                        const id = e.target.value;
                        setTemplateIds((c) => ({ ...c, [kind]: id }));
                        setDirectoryIds((c) => ({ ...c, [kind]: defaultDirectory(options, id, deal.lot?.projectId ?? '', kind) }));
                      }}>
                        <option value="">Seleccionar</option>
                        {options.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </DealField>
                    <DealField label="Tipo de directorio">
                      <select className={select} value={directoryIds[kind]} onChange={(e) => setDirectoryIds((c) => ({ ...c, [kind]: e.target.value }))}>
                        <option value="">Seleccionar</option>
                        {options.directories.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </DealField>
                  </div>
                )}
              </div>
            ))}
            <DealField label="Responsable">
              <select className={select} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                <option value="">Seleccionar</option>
                {options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </DealField>
            <label className="flex items-start gap-2.5 rounded-xl border border-zinc-800 p-3 text-sm text-zinc-300 sm:border-0 sm:p-0 sm:text-xs">
              <input type="checkbox" className="mt-0.5 h-5 w-5 sm:h-3.5 sm:w-3.5" checked={requirePhoto} onChange={(e) => setRequirePhoto(e.target.checked)} />
              <span><span className="font-semibold">Requerir documento</span><br />Validación fotográfica de clientes</span>
            </label>
          </div>

          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold text-zinc-100">Firmantes</p>

            {/* Celular: una tarjeta por firmante (la tabla no cabe a lo ancho). */}
            <div className="space-y-2 sm:hidden">
              {rows.map((r, i) => (
                <div key={`${r.source}-${r.refId}`} className={`rounded-xl border p-3 ${r.checked ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={r.checked} disabled={!!r.disabledReason} onChange={() => toggle(i)} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold ${r.checked ? 'text-zinc-100' : 'text-zinc-400'}`}>{r.name}</span>
                      <span className="block text-xs text-zinc-500">{r.role}</span>
                      {r.disabledReason && <span className="mt-0.5 block text-xs text-amber-400">{r.disabledReason}</span>}
                    </span>
                  </label>
                  {r.checked && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-zinc-400">Secuencia</span>
                        <Stepper value={r.iteration} onChange={(v) => patch(i, { iteration: v })} />
                      </div>
                      {kindsToSend.map((k) => (
                        <DealField key={k} label={`Tipo de firmante · ${k}`}>
                          <select className={select} value={r.typeSigns[k] ?? ''} onChange={(e) => patch(i, { typeSigns: { ...r.typeSigns, [k]: e.target.value } })}>
                            <option value="">—</option>
                            {signerTypesOf(k).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                          </select>
                        </DealField>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Computador: tabla como en SmartHome. */}
            <div className="hidden overflow-x-auto rounded-lg border border-zinc-800 sm:block">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/60 text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Rol</th>
                    <th className="px-2 py-2">Nombre</th>
                    <th className="px-2 py-2">Secuencia</th>
                    {kindsToSend.map((k) => <th key={k} className="px-2 py-2">Tipo · {k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.source}-${r.refId}`} className={`border-t border-zinc-800 ${r.checked ? 'text-zinc-100' : 'text-zinc-400'}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={r.checked} disabled={!!r.disabledReason} title={r.disabledReason} onChange={() => toggle(i)} /></td>
                      <td className="px-2 py-1.5">{r.role}</td>
                      <td className="px-2 py-1.5">{r.name}{r.disabledReason && <span className="block text-[10px] text-amber-400">{r.disabledReason}</span>}</td>
                      <td className="px-2 py-1.5">
                        <input type="number" min={1} max={10} value={r.iteration} onChange={(e) => patch(i, { iteration: Math.max(1, Number(e.target.value) || 1) })} className="w-12 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs" />
                      </td>
                      {kindsToSend.map((k) => (
                        <td key={k} className="px-2 py-1.5">
                          <select className={`${select} min-w-[9rem]`} value={r.typeSigns[k] ?? ''} disabled={!r.checked} onChange={(e) => patch(i, { typeSigns: { ...r.typeSigns, [k]: e.target.value } })}>
                            <option value="">—</option>
                            {signerTypesOf(k).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </DealSheet>
  );
}

/** − 1 + para la secuencia de firma (más fácil que un campo numérico en el celular). */
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const btn = 'flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 text-lg text-zinc-200 disabled:opacity-40';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} aria-label="Bajar secuencia">−</button>
      <span className="w-6 text-center text-base font-semibold text-zinc-100">{value}</span>
      <button type="button" className={btn} disabled={value >= 10} onClick={() => onChange(Math.min(10, value + 1))} aria-label="Subir secuencia">+</button>
    </div>
  );
}