import { useEffect, useState, useRef } from 'react';
import {
  Camera, Search, Upload, CheckCircle2, AlertTriangle, Loader2,
  User, Phone, Image as ImageIcon, ExternalLink, X,
  ShieldAlert, RefreshCw, Eye
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { formatPhone } from '@/shared/utils/formatPhone';
import { LeadStatusBadge } from '@/features/leads/components/LeadStatusBadge';
import {
  searchLeadForPhotoEvidence,
  uploadEvidencePhoto,
  submitPhotoEvidence,
  listPhotoEvidences,
  type UploadProgress,
} from '../services/photoEvidence.service';
import type { PhotoEvidenceItem, SearchedLeadData } from '../types';

const ACTION_OPTIONS = [
  'Visita Terreno Realizada',
  'Visita Terreno Programada',
  'Registro Fotográfico',
  'Feria',
  'Sala de Ventas',
  'CITA PROGRAMADA IA',
  'Llamada Realizada',
  'Whatsapp Enviado',
  'Video Llamada Realizada',
  'VENDIDO',
];

const CONTEXT_OPTIONS = ['Comercial', 'Seguimiento', 'Sala de negocios', 'Agenda', 'Postventa'];

export function PhotoEvidencePage() {
  const { companyId, profile, role, platformAdmin } = useAuth();
  const isAdmin = Boolean(platformAdmin || isAdminRole(role));

  const [activeTab, setActiveTab] = useState<'search' | 'recent'>('search');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Datos del lead encontrado
  const [lead, setLead] = useState<SearchedLeadData | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string>('');
  const [leadEvidences, setLeadEvidences] = useState<PhotoEvidenceItem[]>([]);

  // Formulario de evidencia (soporte para múltiples fotos)
  interface SelectedEvidenceFile {
    id: string;
    file: File;
    previewUrl: string;
  }
  const [selectedFiles, setSelectedFiles] = useState<SelectedEvidenceFile[]>([]);
  const [notes, setNotes] = useState('');
  const [actionLabel, setActionLabel] = useState(ACTION_OPTIONS[0]);
  const [context, setContext] = useState(CONTEXT_OPTIONS[0]);
  const [isEvent, setIsEvent] = useState(false);
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventTime, setEventTime] = useState('09:00');

  // Estados de carga y feedback
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Galería reciente general
  const [recentEvidences, setRecentEvidences] = useState<PhotoEvidenceItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Modal para ver imagen en tamaño completo
  const [lightboxImage, setLightboxImage] = useState<PhotoEvidenceItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Cargar recientes cuando se cambia a la pestaña "recent"
  useEffect(() => {
    if (activeTab === 'recent' && companyId) {
      loadRecentEvidences();
    }
  }, [activeTab, companyId]);

  const loadRecentEvidences = async () => {
    if (!companyId) return;
    setLoadingRecent(true);
    try {
      const items = await listPhotoEvidences(companyId, undefined, 30);
      setRecentEvidences(items);
    } catch (err) {
      console.error('[PhotoEvidencePage] error loading recent:', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = phoneNumber.trim();
    if (!clean || !companyId || searching) return;

    setSearching(true);
    setSearchError(null);
    setSubmitSuccess(null);
    setSubmitError(null);
    selectedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setSelectedFiles([]);
    setNotes('');

    try {
      const currentUserName = profile?.displayName || profile?.email || '';
      const res = await searchLeadForPhotoEvidence(companyId, clean, profile?.id, currentUserName, isAdmin);
      if (!res.found || !res.lead) {
        setLead(null);
        setCanUpload(false);
        setSearchError(res.message || `No se encontró ningún contacto con el número "${clean}".`);
        setLeadEvidences([]);
      } else {
        setLead(res.lead);
        setCanUpload(res.canUpload);
        setPermissionMessage(res.message);
        setLeadEvidences(res.evidences || []);
      }
    } catch (err) {
      console.error('[PhotoEvidencePage] search error:', err);
      const msg = (err as { message?: string })?.message || 'Error al buscar el contacto.';
      setSearchError(msg);
      setLead(null);
      setLeadEvidences([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAddFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const newItems: SelectedEvidenceFile[] = [];
    let errorMsg = '';

    for (const file of list) {
      if (!file.type.startsWith('image/')) {
        errorMsg = 'Algunos archivos no son imágenes válidas (JPG, PNG, WEBP).';
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        errorMsg = 'Algunas imágenes exceden el tamaño máximo permitido (10 MB).';
        continue;
      }
      newItems.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (errorMsg) setSubmitError(errorMsg);
    else setSubmitError(null);

    setSelectedFiles((prev) => {
      const combined = [...prev, ...newItems];
      if (combined.length > 10) {
        setSubmitError('Puedes subir un máximo de 10 fotografías por registro.');
        return combined.slice(0, 10);
      }
      return combined;
    });
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => {
      const target = prev[index];
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmitEvidence = async () => {
    if (!companyId || !lead || selectedFiles.length === 0 || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setUploadProgress({ percent: 0, state: 'running' });

    try {
      // 1. Subir cada imagen a Storage
      const attachments = [];
      const total = selectedFiles.length;

      for (let i = 0; i < total; i++) {
        const item = selectedFiles[i];
        const res = await uploadEvidencePhoto(
          item.file,
          companyId,
          lead.id,
          (prog) => {
            const overallPercent = Math.round(((i + (prog.percent / 100)) / total) * 100);
            setUploadProgress({ percent: overallPercent, state: 'running' });
          }
        );
        attachments.push({
          downloadUrl: res.downloadUrl,
          storagePath: res.storagePath,
          fileName: item.file.name,
          contentType: item.file.type,
        });
      }

      // 2. Enviar a SmartHome y guardar en Firestore
      const result = await submitPhotoEvidence({
        companyId,
        leadId: lead.id,
        leadName: lead.name,
        leadPhone: lead.phone,
        attachments,
        notes: notes.trim(),
        actionLabel,
        context,
        isAnEvent: isEvent,
        scheduledDate: isEvent ? `${eventDate.replace(/-/g, '/')} ${eventTime}:00` : undefined,
        authorId: profile?.id,
        authorName: profile?.displayName || profile?.email || 'Asesor',
      });

      setSubmitSuccess(
        result.smartHomeSynced
          ? `¡${attachments.length} ${attachments.length === 1 ? 'fotografía registrada' : 'fotografías registradas'} y enviadas a SmartHome con éxito!`
          : 'Evidencias guardadas en CRM (pendiente sincronización con SmartHome).'
      );

      // Limpiar formulario y revocar URLs
      selectedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      setSelectedFiles([]);
      setNotes('');
      setIsEvent(false);

      // Refrescar evidencias del lead
      const searchRes = await searchLeadForPhotoEvidence(companyId, lead.phone, profile?.id, profile?.displayName || profile?.email, isAdmin);
      if (searchRes.found && searchRes.evidences) {
        setLeadEvidences(searchRes.evidences);
      }
    } catch (err) {
      console.error('[PhotoEvidencePage] submit error:', err);
      const msg = (err as { message?: string })?.message || 'No se pudo guardar la evidencia.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-zinc-950 text-zinc-100 p-4 md:p-6">
      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white">
            <Camera className="text-violet-400" size={24} />
            Evidencia Fotográfica
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Busca un contacto por su número de teléfono, adjunta el registro fotográfico y envíalo directamente a la bitácora de SmartHome.
          </p>
        </div>

        {/* Pestañas de Vista */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-1 self-start">
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'search'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Search size={14} /> Buscar por número
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'recent'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ImageIcon size={14} /> Galería de evidencias
          </button>
        </div>
      </div>

      {activeTab === 'search' ? (
        <div className="max-w-4xl mx-auto w-full space-y-6">
          {/* ── Buscador por Teléfono ────────────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:p-5 backdrop-blur shadow-sm">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Escribe el número de teléfono (ej. 3101234567 o +57...)"
                  className="h-11 w-full rounded-lg border border-zinc-700/80 bg-zinc-950/80 pl-10 pr-10 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
                  autoFocus
                />
                {phoneNumber && (
                  <button
                    type="button"
                    onClick={() => { setPhoneNumber(''); setLead(null); setSearchError(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!phoneNumber.trim() || searching}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                <span>Buscar contacto</span>
              </button>
            </form>

            {searchError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
                <AlertTriangle size={15} className="shrink-0" />
                <span>{searchError}</span>
              </div>
            )}
          </div>

          {/* ── Detalle del Lead Encontrado ─────────────────────────────────── */}
          {lead && (
            <div className="space-y-6">
              {/* Tarjeta de Información del Cliente */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-violet-300 font-bold border border-violet-500/20 text-base">
                      {lead.name ? lead.name.slice(0, 2).toUpperCase() : <User size={20} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-zinc-100">{lead.name}</h2>
                        {['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'].includes(lead.status) && (
                          <LeadStatusBadge status={lead.status as never} />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1 font-mono text-zinc-300">
                          <Phone size={12} className="text-zinc-500" /> {formatPhone(lead.phone)}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <User size={12} className="text-zinc-500" /> Asesor asignado: <strong className="text-zinc-200">{lead.assignedAdvisorName}</strong>
                        </span>
                        {lead.smartHomeCustomerId && (
                          <>
                            <span>•</span>
                            <span className="rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                              En SmartHome
                            </span>
                          </>
                        )}
                        {lead.smartHomeStage && (
                          <>
                            <span>•</span>
                            <span className="text-zinc-300">
                              Etapa: <strong className="text-sky-300">{lead.smartHomeStage}</strong>
                            </span>
                          </>
                        )}
                        {lead.smartHomeScore !== null && lead.smartHomeScore !== undefined && (
                          <>
                            <span>•</span>
                            <span className="text-zinc-300">
                              Score: <strong className="text-emerald-400">{lead.smartHomeScore}</strong>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Aviso si no tiene permiso */}
                {!canUpload && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
                    <div>
                      <p className="font-medium">Acceso restringido para registrar evidencia:</p>
                      <p className="mt-0.5 text-amber-200/90">{permissionMessage}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Formulario de Carga de Foto y Nota (Solo si tiene permiso) ─ */}
              {canUpload && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                      <Camera size={16} className="text-violet-400" />
                      Registrar nueva evidencia fotográfica
                    </h3>
                    <span className="text-[11px] text-zinc-500">Se enviará a SmartHome</span>
                  </div>

                  {/* Selector de Fotos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-zinc-300">
                          Fotografías de la evidencia <span className="text-red-400">*</span>
                        </label>
                        {selectedFiles.length > 0 && (
                          <span className="text-[11px] font-medium text-violet-400">
                            {selectedFiles.length} {selectedFiles.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'} (máx. 10)
                          </span>
                        )}
                      </div>

                      {selectedFiles.length > 0 ? (
                        <div className="space-y-3">
                          {/* Cuadrícula de fotos seleccionadas */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto rounded-xl border border-zinc-700/80 bg-zinc-950 p-2.5">
                            {selectedFiles.map((item, idx) => (
                              <div
                                key={item.id}
                                className="group relative aspect-square rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden"
                              >
                                <img
                                  src={item.previewUrl}
                                  alt={`Foto ${idx + 1}`}
                                  className="h-full w-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-1">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFile(idx)}
                                    className="rounded-full bg-red-600/90 p-1.5 text-white hover:bg-red-500 shadow-md transition-transform transform hover:scale-110"
                                    title="Quitar esta foto"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-mono text-zinc-300">
                                  #{idx + 1}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Botones de acción para agregar más fotos o tomar otra */}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={selectedFiles.length >= 10}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                            >
                              <ImageIcon size={14} /> + Agregar fotos
                            </button>
                            <button
                              type="button"
                              onClick={() => cameraInputRef.current?.click()}
                              disabled={selectedFiles.length >= 10}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/20 py-2 text-xs font-medium text-violet-300 hover:bg-violet-600/30 disabled:opacity-40"
                            >
                              <Camera size={14} /> Tomar foto
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                selectedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
                                setSelectedFiles([]);
                              }}
                              className="px-2.5 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Limpiar todas las fotos"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files) handleAddFiles(e.dataTransfer.files);
                            }}
                            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 hover:border-violet-500/70 bg-zinc-950/60 p-6 text-center cursor-pointer transition-colors"
                          >
                            <div className="mb-2 rounded-full bg-violet-600/10 p-3 text-violet-400">
                              <Upload size={20} />
                            </div>
                            <p className="text-xs font-medium text-zinc-200">
                              Haz clic para subir o arrastra tus fotos aquí
                            </p>
                            <p className="mt-1 text-[10px] text-zinc-500">
                              Puedes seleccionar varias fotos (JPG, PNG, WEBP hasta 10MB c/u)
                            </p>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              <ImageIcon size={14} /> Seleccionar archivos
                            </button>
                            <button
                              type="button"
                              onClick={() => cameraInputRef.current?.click()}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/20 py-2 text-xs font-medium text-violet-300 hover:bg-violet-600/30"
                            >
                              <Camera size={14} /> Tomar foto con cámara
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inputs invisibles con soporte múltiple */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleAddFiles(e.target.files);
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          handleAddFiles(e.target.files);
                          if (e.target) e.target.value = '';
                        }}
                      />
                    </div>

                    {/* Campos de Texto y Opciones */}
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                          Observación / Nota de la evidencia
                        </label>
                        <textarea
                          rows={4}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Escribe la descripción de la visita, sala de negocios o detalle del registro..."
                          className="w-full rounded-lg border border-zinc-700/80 bg-zinc-950/80 p-3 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-violet-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                            Tipo de acción
                          </label>
                          <select
                            value={actionLabel}
                            onChange={(e) => setActionLabel(e.target.value)}
                            className="h-9 w-full rounded-lg border border-zinc-700/80 bg-zinc-950 px-2.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
                          >
                            {ACTION_OPTIONS.map((act) => (
                              <option key={act} value={act}>{act}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                            Contexto
                          </label>
                          <select
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            className="h-9 w-full rounded-lg border border-zinc-700/80 bg-zinc-950 px-2.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
                          >
                            {CONTEXT_OPTIONS.map((ctx) => (
                              <option key={ctx} value={ctx}>{ctx}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400 pt-1">
                        <input
                          type="checkbox"
                          checked={isEvent}
                          onChange={(e) => setIsEvent(e.target.checked)}
                          className="accent-violet-600 rounded"
                        />
                        Registrar como evento programado
                      </label>

                      {isEvent && (
                        <div className="grid grid-cols-2 gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
                          <label className="text-[10px] text-zinc-400">
                            Fecha
                            <input
                              type="date"
                              value={eventDate}
                              onChange={(e) => setEventDate(e.target.value)}
                              className="mt-1 h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none"
                            />
                          </label>
                          <label className="text-[10px] text-zinc-400">
                            Hora
                            <input
                              type="time"
                              value={eventTime}
                              onChange={(e) => setEventTime(e.target.value)}
                              className="mt-1 h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Barra de progreso de carga */}
                  {uploadProgress && uploadProgress.percent < 100 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-zinc-400">
                        <span>Subiendo fotos a Storage...</span>
                        <span>{uploadProgress.percent}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-violet-600 transition-all duration-200"
                          style={{ width: `${uploadProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {submitSuccess && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                      <CheckCircle2 size={16} className="shrink-0" />
                      <span>{submitSuccess}</span>
                    </div>
                  )}

                  {submitError && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  {/* Botón de Envío */}
                  <button
                    type="button"
                    onClick={handleSubmitEvidence}
                    disabled={selectedFiles.length === 0 || submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Enviando evidencias a SmartHome...</span>
                      </>
                    ) : (
                      <>
                        <Camera size={15} />
                        <span>
                          {selectedFiles.length > 1
                            ? `Enviar ${selectedFiles.length} fotos y observación a SmartHome`
                            : 'Enviar foto y observación a SmartHome'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* ── Historial de Evidencias de Este Cliente ─────────────────── */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <ImageIcon size={16} className="text-sky-400" />
                    Evidencias fotográficas registradas ({leadEvidences.length})
                  </h3>
                </div>

                {leadEvidences.length === 0 ? (
                  <p className="text-center py-8 text-xs text-zinc-500">
                    No hay evidencias fotográficas registradas para este cliente aún.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                    {leadEvidences.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden hover:border-zinc-700 transition-colors"
                      >
                        <div
                          className="relative h-44 w-full bg-zinc-900 cursor-pointer overflow-hidden group"
                          onClick={() => setLightboxImage(item)}
                        >
                          <img
                            src={item.photoUrl}
                            alt="Evidencia"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white gap-1.5 text-xs font-medium">
                            <Eye size={16} /> Ver foto completa
                          </div>
                          {item.smartHomeSynced && (
                            <span className="absolute top-2 right-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                              SmartHome ✓
                            </span>
                          )}
                        </div>

                        <div className="p-3 flex-1 flex flex-col justify-between text-xs">
                          <div>
                            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                              <span className="font-medium text-violet-300 truncate max-w-[120px]">
                                {item.actionLabel || 'Registro'}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                {item.createdAt ? new Date(item.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                              </span>
                            </div>
                            <p className="text-zinc-200 line-clamp-3 text-[11px] leading-relaxed">
                              {item.notes || <span className="text-zinc-500 italic">Sin observación</span>}
                            </p>
                          </div>

                          <div className="mt-2.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500">
                            <span className="truncate">Por: <strong className="text-zinc-400">{item.authorName}</strong></span>
                            <a
                              href={item.photoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={11} /> Abrir
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Pestaña: Galería Reciente General ────────────────────────────── */
        <div className="max-w-6xl mx-auto w-full space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              Últimas evidencias registradas en la empresa
            </h2>
            <button
              onClick={loadRecentEvidences}
              disabled={loadingRecent}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw size={13} className={loadingRecent ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>

          {loadingRecent ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-violet-400" />
            </div>
          ) : recentEvidences.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center text-xs text-zinc-500">
              No hay evidencias registradas en la empresa.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {recentEvidences.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden hover:border-zinc-700 transition-colors shadow-sm"
                >
                  <div
                    className="relative h-44 w-full bg-zinc-950 cursor-pointer overflow-hidden group"
                    onClick={() => setLightboxImage(item)}
                  >
                    <img
                      src={item.photoUrl}
                      alt="Evidencia"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white gap-1.5 text-xs font-medium">
                      <Eye size={16} /> Ver foto
                    </div>
                    {item.smartHomeSynced && (
                      <span className="absolute top-2 right-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                        SmartHome ✓
                      </span>
                    )}
                  </div>

                  <div className="p-3.5 flex-1 flex flex-col justify-between text-xs">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <strong className="text-zinc-100 truncate max-w-[140px]">
                          {item.leadName || 'Cliente'}
                        </strong>
                        <span className="text-[10px] text-zinc-500">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'}
                        </span>
                      </div>
                      {item.leadPhone && (
                        <p className="text-[11px] font-mono text-zinc-400 mb-2">
                          {formatPhone(item.leadPhone)}
                        </p>
                      )}
                      <p className="text-zinc-300 line-clamp-2 text-[11px] leading-relaxed">
                        {item.notes || <span className="text-zinc-500 italic">Sin observación</span>}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
                      <span className="truncate">Por: <strong className="text-zinc-400">{item.authorName}</strong></span>
                      <button
                        onClick={() => {
                          if (item.leadPhone) {
                            setPhoneNumber(item.leadPhone);
                            setActiveTab('search');
                            searchLeadForPhotoEvidence(companyId!, item.leadPhone).then((res) => {
                              if (res.found && res.lead) {
                                setLead(res.lead);
                                setCanUpload(res.canUpload);
                                setPermissionMessage(res.message);
                                setLeadEvidences(res.evidences || []);
                              }
                            });
                          }
                        }}
                        className="text-violet-400 hover:text-violet-300 font-medium"
                      >
                        Ver cliente →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal Lightbox para ver foto completa ──────────────────────────── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-3xl w-full rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 bg-zinc-950">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-zinc-100 truncate">
                  {lightboxImage.leadName || 'Evidencia fotográfica'}
                </h4>
                <p className="text-[11px] text-zinc-400">
                  {lightboxImage.authorName} • {lightboxImage.createdAt ? new Date(lightboxImage.createdAt).toLocaleString('es-CO') : '—'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={lightboxImage.photoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  <ExternalLink size={13} /> Abrir original
                </a>
                <button
                  onClick={() => setLightboxImage(null)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-2 bg-black flex items-center justify-center overflow-auto max-h-[60vh]">
              <img
                src={lightboxImage.photoUrl}
                alt="Evidencia completa"
                className="max-h-[58vh] w-auto max-w-full object-contain rounded"
              />
            </div>

            {lightboxImage.notes && (
              <div className="border-t border-zinc-800 bg-zinc-950/90 p-4">
                <p className="text-xs font-medium text-zinc-400 mb-1">Observación registrada:</p>
                <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {lightboxImage.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
