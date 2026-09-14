import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CalendarClock, CheckCircle2, ImagePlus, Loader2, NotebookPen, RefreshCw, Send, UploadCloud, UserRound, X } from 'lucide-react';
import type { Lead } from '@/features/inbox/types';
import { uploadMedia } from '@/features/inbox/services/media.service';
import {
  changeSmartHomeLeadAdvisor,
  changeSmartHomeLeadStage,
  getSmartHomeLeadBitacoraAccess,
  listSmartHomeAdvisors,
  listSmartHomeStages,
  postSmartHomeLeadBitacora,
  postSmartHomeLeadEvidence,
  useLeadEvidence,
  type EvidenceAttachment,
  type SmartHomeAdvisor,
  type SmartHomeStage,
} from '../services/smartHome.service';

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5 MB (coincide con storage.rules para imágenes)
const MAX_EVIDENCE_FILES = 10;

interface Props {
  companyId: string;
  lead: Lead;
  canAdmin: boolean;
}

const ACTION_LABELS = [
  'CITA PROGRAMADA IA',
  'Feria',
  'INDECISO',
  'Llamada Programa',
  'Llamada Realiza',
  'Llamada Recibia',
  'No Contesta',
  'ORGANICO',
  'VENDIDO',
  'Video Llamada Programada',
  'Video Llamada Realizada',
  'Visita Terreno Programada',
  'Visita Terreno Realizada',
  'Whatsapp Enviado',
];

const CONTEXT_LABELS = ['Comercial', 'Seguimiento', 'Agenda', 'Sala de negocios', 'Postventa'];

function smartHomeDate(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  return `${date.replace(/-/g, '/')} ${time}:00`;
}

function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: string })?.message;
  return message ? `${fallback} ${message}` : fallback;
}

export function SmartHomeActionsPanel({ companyId, lead, canAdmin }: Props) {
  const [advisors, setAdvisors] = useState<SmartHomeAdvisor[]>([]);
  const [stages, setStages] = useState<SmartHomeStage[]>([]);
  const [selectedAdvisor, setSelectedAdvisor] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [text, setText] = useState('');
  const [isEvent, setIsEvent] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('07:00');
  const [actionLabel, setActionLabel] = useState(ACTION_LABELS[0]);
  const [context, setContext] = useState(CONTEXT_LABELS[0]);
  const [loading, setLoading] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [bitacoraAccess, setBitacoraAccess] = useState<{ allowed: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // ── Evidencia fotográfica ──────────────────────────────────────────────────
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const { evidence: savedEvidence } = useLeadEvidence(companyId, lead.id);

  const previews = useMemo(
    () => evidenceFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [evidenceFiles]
  );
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const addEvidenceFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const incoming = Array.from(list);
    const rejected = incoming.filter((f) => !f.type.startsWith('image/') || f.size > MAX_EVIDENCE_BYTES);
    const accepted = incoming.filter((f) => f.type.startsWith('image/') && f.size <= MAX_EVIDENCE_BYTES);
    if (rejected.length) {
      setError('Algunas fotos se omitieron: solo imágenes de máximo 5 MB.');
    }
    setEvidenceFiles((prev) => [...prev, ...accepted].slice(0, MAX_EVIDENCE_FILES));
  };

  const removeEvidenceFile = (index: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadEvidence = async () => {
    if (!evidenceFiles.length || uploadingEvidence || !canPostBitacora) return;
    setUploadingEvidence(true);
    setError(null);
    setOk(null);
    try {
      const attachments: EvidenceAttachment[] = [];
      for (const file of evidenceFiles) {
        const res = await uploadMedia(file, companyId, lead.id);
        attachments.push({
          downloadUrl: res.downloadUrl,
          storagePath: res.storagePath,
          contentType: res.contentType,
          fileName: res.fileName,
        });
      }
      const result = await postSmartHomeLeadEvidence({
        companyId,
        leadId: lead.id,
        note: evidenceNote.trim() || undefined,
        attachments,
      });
      setEvidenceFiles([]);
      setEvidenceNote('');
      setOk(
        result.sentToSmartHome
          ? 'Evidencia guardada en el CRM y enviada a SmartHome.'
          : 'Evidencia guardada en el CRM. No se pudo enviar a SmartHome.'
      );
    } catch (err) {
      console.error('[SmartHomeActionsPanel] evidence error:', err);
      setError(errorMessage(err, 'No se pudo subir la evidencia.'));
    } finally {
      setUploadingEvidence(false);
    }
  };

  useEffect(() => {
    if (!canAdmin) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listSmartHomeAdvisors(companyId),
      listSmartHomeStages(companyId).catch(() => [] as SmartHomeStage[]),
    ])
      .then(([advisorRows, stageRows]) => {
        setAdvisors(advisorRows);
        setStages(stageRows);
      })
      .catch((err) => {
        console.error('[SmartHomeActionsPanel] load error:', err);
        setError('No se pudo cargar la configuracion de SmartHome.');
      })
      .finally(() => setLoading(false));
  }, [canAdmin, companyId]);

  useEffect(() => {
    setCheckingAccess(true);
    setBitacoraAccess(null);
    getSmartHomeLeadBitacoraAccess(companyId, lead.id)
      .then(setBitacoraAccess)
      .catch((err) => {
        console.error('[SmartHomeActionsPanel] access error:', err);
        setBitacoraAccess({
          allowed: false,
          message: errorMessage(err, 'No se pudo validar el permiso para registrar bitacora.'),
        });
      })
      .finally(() => setCheckingAccess(false));
  }, [companyId, lead.id]);

  const groupedStages = useMemo(() => {
    const groups = new Map<string, SmartHomeStage[]>();
    stages.forEach((stage) => {
      const key = stage.cycleName || 'Ciclo de venta';
      groups.set(key, [...(groups.get(key) ?? []), stage]);
    });
    return [...groups.entries()];
  }, [stages]);
  const canPostBitacora = bitacoraAccess?.allowed === true;
  const bitacoraBlockMessage = bitacoraAccess?.message || 'Este cliente no esta asignado a ti. Solicita al administrador el cambio de asesor para registrar bitacora.';

  const runChangeAdvisor = async () => {
    if (!selectedAdvisor || saving) return;
    setSaving('advisor');
    setError(null);
    setOk(null);
    try {
      await changeSmartHomeLeadAdvisor(companyId, lead.id, selectedAdvisor);
      setOk('Asesor de SmartHome actualizado.');
    } catch (err) {
      console.error('[SmartHomeActionsPanel] advisor error:', err);
      setError(errorMessage(err, 'No se pudo cambiar el asesor en SmartHome.'));
    } finally {
      setSaving(null);
    }
  };

  const runChangeStage = async () => {
    if (!selectedStage || saving) return;
    setSaving('stage');
    setError(null);
    setOk(null);
    try {
      await changeSmartHomeLeadStage(companyId, lead.id, selectedStage);
      setOk('Etapa de SmartHome actualizada.');
    } catch (err) {
      console.error('[SmartHomeActionsPanel] stage error:', err);
      setError(errorMessage(err, 'No se pudo cambiar la etapa en SmartHome.'));
    } finally {
      setSaving(null);
    }
  };

  const publish = async () => {
    if (!text.trim() || saving || !canPostBitacora) return;
    setSaving('bitacora');
    setError(null);
    setOk(null);
    try {
      await postSmartHomeLeadBitacora({
        companyId,
        leadId: lead.id,
        actionLabel,
        context,
        eventContent: text.trim(),
        isAnEvent: isEvent,
        scheduledDate: isEvent ? smartHomeDate(date, startTime) : undefined,
      });
      setText('');
      setIsEvent(false);
      setOk('Bitacora enviada a SmartHome.');
    } catch (err) {
      console.error('[SmartHomeActionsPanel] bitacora error:', err);
      setError(errorMessage(err, 'No se pudo publicar en la bitacora de SmartHome.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      {canAdmin && (
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-800/25 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <UserRound size={13} /> Administrar SmartHome
            </p>
            {loading && <Loader2 size={13} className="animate-spin text-zinc-500" />}
          </div>

          <div className="grid gap-2">
            <div className="flex gap-2">
              <select value={selectedAdvisor} onChange={(e) => setSelectedAdvisor(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-500/60">
                <option value="">Asesor SmartHome</option>
                {advisors.map((advisor) => <option key={advisor.userId} value={advisor.userId}>{advisor.name || advisor.email}</option>)}
              </select>
              <button onClick={runChangeAdvisor} disabled={!selectedAdvisor || saving !== null} title="Cambiar asesor SmartHome" className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40">
                {saving === 'advisor' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            </div>

            <div className="flex gap-2">
              <select value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-500/60">
                <option value="">Etapa SmartHome</option>
                {groupedStages.map(([cycleName, rows]) => (
                  <optgroup key={cycleName} label={cycleName}>
                    {rows.map((stage) => <option key={stage.stageId} value={stage.stageId}>{stage.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <button onClick={runChangeStage} disabled={!selectedStage || saving !== null} title="Cambiar etapa SmartHome" className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40">
                {saving === 'stage' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md border border-zinc-800 bg-zinc-800/25 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
          <Camera size={13} /> Evidencia fotografica
        </p>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { addEvidenceFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { addEvidenceFiles(e.target.files); e.target.value = ''; }}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={!canPostBitacora || uploadingEvidence}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Camera size={14} /> Tomar foto
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            disabled={!canPostBitacora || uploadingEvidence}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ImagePlus size={14} /> Adjuntar foto
          </button>
        </div>

        {previews.length > 0 && (
          <div className="mt-2 grid grid-cols-4 gap-2">
            {previews.map((preview, index) => (
              <div key={preview.url} className="group relative aspect-square overflow-hidden rounded-md border border-zinc-700">
                <img src={preview.url} alt={preview.file.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeEvidenceFile(index)}
                  disabled={uploadingEvidence}
                  title="Quitar"
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-90 hover:bg-red-600 disabled:opacity-40"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {previews.length > 0 && (
          <>
            <textarea
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              rows={2}
              placeholder="Descripcion de la evidencia (opcional)..."
              className="mt-2 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-sky-500/60"
              disabled={uploadingEvidence}
            />
            <button
              onClick={uploadEvidence}
              disabled={uploadingEvidence || !canPostBitacora}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploadingEvidence ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              {uploadingEvidence ? 'Subiendo...' : `Guardar y enviar (${previews.length})`}
            </button>
          </>
        )}

        {!checkingAccess && !canPostBitacora && (
          <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
            {bitacoraBlockMessage}
          </p>
        )}

        {savedEvidence.length > 0 && (
          <div className="mt-3 border-t border-zinc-800 pt-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Evidencia guardada ({savedEvidence.length})</p>
            <div className="grid grid-cols-4 gap-2">
              {savedEvidence.map((item) => (
                <a
                  key={item.id}
                  href={item.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`${item.fileName}${item.note ? ` — ${item.note}` : ''}`}
                  className="aspect-square overflow-hidden rounded-md border border-zinc-700 hover:border-sky-500/60"
                >
                  <img src={item.downloadUrl} alt={item.fileName} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-800/25 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
          <NotebookPen size={13} /> Llenar bitacora del cliente
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Escribe la observacion para SmartHome..."
          className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-sky-500/60"
          disabled={!canPostBitacora}
        />
        {checkingAccess && (
          <p className="mt-2 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-200">
            Validando permisos de SmartHome...
          </p>
        )}
        {!checkingAccess && !canPostBitacora && (
          <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
            {bitacoraBlockMessage}
          </p>
        )}

        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400">
          <input type="checkbox" checked={isEvent} onChange={(e) => setIsEvent(e.target.checked)} disabled={!canPostBitacora} className="accent-sky-500 disabled:opacity-50" />
          Crear evento
        </label>

        {isEvent && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/[0.04] p-2">
            <label className="text-[10px] text-zinc-500">
              Fecha
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canPostBitacora} className="mt-1 h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none disabled:opacity-50" />
            </label>
            <label className="text-[10px] text-zinc-500">
              Hora inicio
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={!canPostBitacora} className="mt-1 h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none disabled:opacity-50" />
            </label>
          </div>
        )}

        <div className="mt-2 grid gap-2">
          <select value={actionLabel} onChange={(e) => setActionLabel(e.target.value)} disabled={!canPostBitacora} className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-500/60 disabled:opacity-50">
            {ACTION_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
          <select value={context} onChange={(e) => setContext(e.target.value)} disabled={!canPostBitacora} className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-500/60 disabled:opacity-50">
            {CONTEXT_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>

        <button onClick={publish} disabled={!text.trim() || saving !== null || !canPostBitacora} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40">
          {saving === 'bitacora' ? <Loader2 size={14} className="animate-spin" /> : isEvent ? <CalendarClock size={14} /> : <Send size={14} />}
          {isEvent ? 'Publicar evento' : 'Publicar bitacora'}
        </button>
      </div>

      {ok && <p className="flex items-center gap-1.5 text-[11px] text-emerald-300"><CheckCircle2 size={12} /> {ok}</p>}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
