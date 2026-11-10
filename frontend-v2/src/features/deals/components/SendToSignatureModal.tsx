import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, PenLine, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  getSignatureOptions,
  sendDealToSignature,
  type DealDocumentKind,
  type DealSummary,
  type SignatureOptions,
} from '../services/deals.service';
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

  const select = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none';
  const title = `Firma digital - ${deal.lot ? `${deal.lot.sector} ${deal.lot.lotNumber}` : 'Negocio'}`;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><PenLine size={15} /> {title}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X size={18} /></button>
        </div>

        {!options && !error && <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin" /> Cargando plantillas y firmantes de DocuBlock…</div>}

        {options && (
          <div className="grid flex-1 gap-4 overflow-auto p-4 md:grid-cols-[260px_1fr]">
            <div className="space-y-4">
              {KINDS.map((kind) => (
                <div key={kind} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                    <input type="checkbox" checked={include[kind] && !locked[kind]} disabled={!!locked[kind]} onChange={(e) => setInclude((c) => ({ ...c, [kind]: e.target.checked }))} />
                    {LABELS[kind]}
                  </label>
                  {locked[kind] ? <p className="mt-1 text-[11px] text-zinc-500">{locked[kind]}</p> : include[kind] && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Documento</p>
                      <select className={select} value={versions[kind] ?? ''} onChange={(e) => setVersions((c) => ({ ...c, [kind]: e.target.value ? Number(e.target.value) : null }))}>
                        {kind === 'promesa' && <option value="">Generar la promesa al enviar (con los datos de la preventa)</option>}
                        {[...(deal.documents ?? [])].filter((d) => d.kind === kind).reverse().map((d) => (
                          <option key={d.version} value={d.version}>{LABELS[kind]} · v{d.version}{d.generatedAt ? ` · ${dateText(d.generatedAt)}` : ''}</option>
                        ))}
                      </select>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Plantilla</p>
                      <select className={select} value={templateIds[kind]} onChange={(e) => {
                        const id = e.target.value;
                        setTemplateIds((c) => ({ ...c, [kind]: id }));
                        setDirectoryIds((c) => ({ ...c, [kind]: defaultDirectory(options, id, deal.lot?.projectId ?? '', kind) }));
                      }}>
                        <option value="">Seleccionar</option>
                        {options.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Tipo de directorio</p>
                      <select className={select} value={directoryIds[kind]} onChange={(e) => setDirectoryIds((c) => ({ ...c, [kind]: e.target.value }))}>
                        <option value="">Seleccionar</option>
                        {options.directories.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Responsable</p>
                <select className={select} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                  <option value="">Seleccionar</option>
                  {options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <label className="flex items-start gap-2 text-xs text-zinc-300">
                <input type="checkbox" className="mt-0.5" checked={requirePhoto} onChange={(e) => setRequirePhoto(e.target.checked)} />
                <span><span className="font-semibold">Requerir documento</span><br />Validación fotográfica de clientes</span>
              </label>
            </div>

            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-zinc-100">Firmantes</p>
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
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

        <div className="border-t border-zinc-800 px-4 py-3">
          {error && <p className="mb-2 rounded-md bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</p>}
          {options && problems.length > 0 && <p className="mb-2 text-[11px] text-amber-300">{problems.join(' · ')}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-500">Al enviar, el lote pasa a TRÁMITE mientras se firma.</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
              <Button size="sm" loading={sending} disabled={!options || problems.length > 0 || !kindsToSend.length} onClick={() => void send()}>
                Enviar {kindsToSend.length === 2 ? 'preventa y promesa' : kindsToSend[0] ?? ''} a firma
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
