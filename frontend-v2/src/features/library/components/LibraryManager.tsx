import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FileText, Pencil, Trash2, Upload, X, Check, FolderOpen, Video, Users } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import {
  addLibraryItem, renameLibraryItem, deleteLibraryItem, listenLibrary,
} from '../services/library.service';
import type { LibraryItem } from '../types';
import { formatBytes, mediaLimitFor, mediaLimitMessage } from '@/features/inbox/utils/mediaLimits';
import { listCompanyUsers, type CompanyUser } from '@/features/leads/services/advisors.service';

const NO_PROJECT = 'Sin proyecto';

const ACCEPT = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
].join(',');

const formatSize = formatBytes;

const inputClass = 'h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60';

function isVideoItem(item: LibraryItem): boolean {
  return item.kind === 'video' || item.contentType.startsWith('video/');
}

export function LibraryManager({ companyId }: { companyId: string }) {
  const [items, setItems]     = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [pendingTitle, setPendingTitle]     = useState('');
  const [pendingProject, setPendingProject] = useState('');
  const [pendingFile, setPendingFile]       = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editTitle, setEditTitle]     = useState('');
  const [editProject, setEditProject] = useState('');
  const [busyId, setBusyId]           = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = listenLibrary(companyId, (list) => {
      setItems(list);
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  // Proyectos existentes (para sugerir en el datalist).
  const projectNames = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.project?.trim()) set.add(i.project.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Items agrupados por proyecto para mostrarlos.
  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    items.filter((i) => !isVideoItem(i)).forEach((i) => {
      const key = i.project?.trim() || NO_PROJECT;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === NO_PROJECT) return 1;
      if (b[0] === NO_PROJECT) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [items]);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setError(null);
    const contentType = file.type || 'application/octet-stream';
    if (contentType.startsWith('video/')) {
      setError('Los videos se suben desde el panel Videos del equipo.');
      return;
    }
    const limitError = mediaLimitMessage(contentType, file.size);
    if (limitError) {
      setError(`${limitError} Para videos largos, usa un enlace en vez de subir el archivo.`);
      return;
    }
    if (!mediaLimitFor(contentType)) {
      setError('Tipo de archivo no soportado. Usa PDF, imagen o video MP4.');
      return;
    }
    setPendingFile(file);
    setPendingTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const cancelPending = () => {
    setPendingFile(null);
    setPendingTitle('');
    setPendingProject('');
    setError(null);
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setUploadPct(0);
    setError(null);
    try {
      await addLibraryItem(pendingFile, companyId, pendingTitle, pendingProject, ({ percent }) => setUploadPct(percent));
      cancelPending();
    } catch (err) {
      console.error('[LibraryManager] upload error:', err);
      setError('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (item: LibraryItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditProject(item.project ?? '');
  };

  const saveEdit = async (item: LibraryItem) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    setBusyId(item.id);
    try {
      await renameLibraryItem(companyId, item.id, title, editProject.trim());
      setEditingId(null);
    } catch (err) {
      console.error('[LibraryManager] rename error:', err);
      setError('No se pudo guardar el cambio.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: LibraryItem) => {
    if (!window.confirm(`¿Eliminar "${item.title}" de la biblioteca? Esta acción no se puede deshacer.`)) return;
    setBusyId(item.id);
    try {
      await deleteLibraryItem(companyId, item.id);
    } catch (err) {
      console.error('[LibraryManager] delete error:', err);
      setError('No se pudo eliminar el archivo.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <datalist id="library-projects">
        {projectNames.map((p) => <option key={p} value={p} />)}
      </datalist>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-100">Portafolios y documentos</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Sube una sola vez los archivos de cada proyecto (portafolio, licencia de parcelación,
          certificado de tradición, escrituras, permisos…). Agrúpalos por proyecto y los asesores
          podrán elegirlos y enviarlos al instante desde la Bandeja, sin volver a subirlos.
          Limites: imagen 5 MB y PDF 100 MB. Los videos se administran en el panel separado.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="shrink-0 text-red-300/70 hover:text-red-200" aria-label="Descartar aviso">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Subir nuevo */}
      <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        {!pendingFile ? (
          <>
            <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={onPickFile} className="hidden" />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} /> Subir documento
            </Button>
            <p className="mt-2 text-[11px] text-zinc-600">PDF o imagenes. Los videos van en el panel de videos.</p>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <FileText size={18} className="shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1 truncate">{pendingFile.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">{formatSize(pendingFile.size)}</span>
            </div>
            <label className="text-xs text-zinc-400">
              Proyecto / club de campo
              <input
                list="library-projects"
                value={pendingProject}
                onChange={(e) => setPendingProject(e.target.value)}
                placeholder="Ej. Río Claro (elige uno o escribe uno nuevo)"
                disabled={uploading}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="text-xs text-zinc-400">
              Nombre visible del documento
              <input
                autoFocus
                value={pendingTitle}
                onChange={(e) => setPendingTitle(e.target.value)}
                placeholder="Ej. Certificado de tradición"
                disabled={uploading}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            {uploading ? (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-xs text-zinc-400">Subiendo... {uploadPct}%</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-700">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={confirmUpload} disabled={!pendingTitle.trim()}>Guardar</Button>
                <Button variant="ghost" size="sm" onClick={cancelPending}>Cancelar</Button>
              </div>
            )}
          </div>
        )}
      </div>

      <VideoLibraryPanel companyId={companyId} items={items} />

      {/* Lista agrupada por proyecto */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">Aún no hay documentos. Sube el primero arriba.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([project, groupItems]) => (
            <div key={project}>
              <div className="mb-2 flex items-center gap-2">
                <FolderOpen size={15} className="text-amber-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{project}</h3>
                <span className="text-[11px] text-zinc-600">({groupItems.length})</span>
              </div>
              <ul className="flex flex-col gap-2">
                {groupItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                    <FileText size={18} className="shrink-0 text-violet-400" />
                    {editingId === item.id ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Nombre del documento"
                          className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
                        />
                        <input
                          list="library-projects"
                          value={editProject}
                          onChange={(e) => setEditProject(e.target.value)}
                          placeholder="Proyecto"
                          className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-300 outline-none focus:border-violet-500/60"
                        />
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-200">{item.title}</p>
                        <p className="truncate text-[11px] text-zinc-500">{item.fileName} · {formatSize(item.sizeBytes)}</p>
                      </div>
                    )}

                    {busyId === item.id ? (
                      <Spinner size="sm" />
                    ) : editingId === item.id ? (
                      <>
                        <button onClick={() => saveEdit(item)} className="text-zinc-400 hover:text-emerald-400" title="Guardar" aria-label="Guardar">
                          <Check size={16} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300" title="Cancelar" aria-label="Cancelar">
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(item)} className="text-zinc-500 hover:text-zinc-200" title="Editar" aria-label="Editar">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => remove(item)} className="text-zinc-500 hover:text-red-400" title="Eliminar" aria-label="Eliminar">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoLibraryPanel({ companyId, items }: { companyId: string; items: LibraryItem[] }) {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'general' | 'advisor'>('general');
  const [advisorId, setAdvisorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editVisibility, setEditVisibility] = useState<'general' | 'advisor'>('general');
  const [editAdvisorId, setEditAdvisorId] = useState('');
  const [busyId, setBusyId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoadingUsers(true);
    listCompanyUsers(companyId)
      .then((list) => setUsers(list.filter((user) => user.active && user.role !== 'viewer')))
      .catch((err) => {
        console.error('[VideoLibrary] users error:', err);
        setError('No se pudieron cargar los asesores.');
      })
      .finally(() => setLoadingUsers(false));
  }, [companyId]);

  const videos = useMemo(() => items.filter(isVideoItem), [items]);
  const generalVideos = videos.filter((item) => (item.visibility ?? 'general') !== 'advisor');
  const advisorVideos = videos.filter((item) => (item.visibility ?? 'general') === 'advisor');

  const advisorName = (id: string) => users.find((user) => user.id === id)?.displayName ?? '';

  const pickVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    if (fileRef.current) fileRef.current.value = '';
    setError(null);
    if (!next) return;
    if (!next.type.startsWith('video/')) {
      setError('Selecciona un video MP4.');
      return;
    }
    const limitError = mediaLimitMessage(next.type || 'video/mp4', next.size);
    if (limitError) {
      setError(limitError);
      return;
    }
    setFile(next);
    setTitle(next.name.replace(/\.[^.]+$/, ''));
  };

  const resetUpload = () => {
    setFile(null);
    setTitle('');
    setVisibility('general');
    setAdvisorId('');
    setUploadPct(0);
  };

  const uploadVideo = async () => {
    if (!file || !title.trim()) return;
    if (visibility === 'advisor' && !advisorId) {
      setError('Elige el asesor dueño del video.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await addLibraryItem(file, companyId, title, 'Videos', ({ percent }) => setUploadPct(percent), {
        kind: 'video',
        visibility,
        advisorId: visibility === 'advisor' ? advisorId : '',
        advisorName: visibility === 'advisor' ? advisorName(advisorId) : '',
      });
      resetUpload();
    } catch (err) {
      console.error('[VideoLibrary] upload error:', err);
      setError('No se pudo subir el video.');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (item: LibraryItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditVisibility((item.visibility ?? 'general') === 'advisor' ? 'advisor' : 'general');
    setEditAdvisorId(item.advisorId ?? '');
  };

  const saveEdit = async (item: LibraryItem) => {
    if (!editTitle.trim()) return;
    if (editVisibility === 'advisor' && !editAdvisorId) {
      setError('Elige el asesor dueño del video.');
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await renameLibraryItem(companyId, item.id, editTitle, item.project ?? 'Videos', {
        kind: 'video',
        visibility: editVisibility,
        advisorId: editVisibility === 'advisor' ? editAdvisorId : '',
        advisorName: editVisibility === 'advisor' ? advisorName(editAdvisorId) : '',
      });
      setEditingId(null);
    } catch (err) {
      console.error('[VideoLibrary] edit error:', err);
      setError('No se pudo guardar el video.');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (item: LibraryItem) => {
    if (!window.confirm(`Eliminar "${item.title}"?`)) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deleteLibraryItem(companyId, item.id);
    } catch (err) {
      console.error('[VideoLibrary] delete error:', err);
      setError('No se pudo eliminar el video.');
    } finally {
      setBusyId('');
    }
  };

  const renderVideoRow = (item: LibraryItem) => {
    const editing = editingId === item.id;
    return (
      <li key={item.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <Video size={18} className="shrink-0 text-amber-400" />
        {editing ? (
          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[1fr_130px_1fr]">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={inputClass} />
            <select value={editVisibility} onChange={(e) => setEditVisibility(e.target.value as 'general' | 'advisor')} className={inputClass}>
              <option value="general">Todos</option>
              <option value="advisor">Asesor</option>
            </select>
            <select value={editAdvisorId} onChange={(e) => setEditAdvisorId(e.target.value)} disabled={editVisibility === 'general'} className={inputClass}>
              <option value="">Elegir asesor</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
            </select>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-200">{item.title}</p>
            <p className="truncate text-[11px] text-zinc-500">
              {formatSize(item.sizeBytes)} - {(item.visibility ?? 'general') === 'advisor' ? `Solo ${item.advisorName || advisorName(item.advisorId ?? '') || 'asesor'}` : 'Todos los asesores'}
            </p>
          </div>
        )}
        {busyId === item.id ? <Spinner size="sm" /> : editing ? (
          <>
            <button onClick={() => saveEdit(item)} className="text-zinc-400 hover:text-emerald-400" title="Guardar" aria-label="Guardar"><Check size={16} /></button>
            <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300" title="Cancelar" aria-label="Cancelar"><X size={16} /></button>
          </>
        ) : (
          <>
            <button onClick={() => startEdit(item)} className="text-zinc-500 hover:text-zinc-200" title="Editar" aria-label="Editar"><Pencil size={15} /></button>
            <button onClick={() => remove(item)} className="text-zinc-500 hover:text-red-400" title="Eliminar" aria-label="Eliminar"><Trash2 size={15} /></button>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="mb-8 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
          <Video size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Videos del equipo</h3>
          <p className="mt-1 text-xs text-zinc-500">Sube videos aprobados. Pueden ser generales para todos o exclusivos de un asesor.</p>
        </div>
      </div>

      {error && <p className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        {!file ? (
          <>
            <input ref={fileRef} type="file" accept="video/mp4,video/3gpp" onChange={pickVideo} className="hidden" />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Subir video
            </Button>
            <p className="mt-2 text-[11px] text-zinc-600">Maximo 16 MB. Para recorridos largos, usa enlace.</p>
          </>
        ) : (
          <div className="grid gap-2 md:grid-cols-[1fr_130px_1fr_auto_auto]">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Nombre visible" disabled={uploading} />
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'general' | 'advisor')} className={inputClass} disabled={uploading}>
              <option value="general">Todos</option>
              <option value="advisor">Asesor</option>
            </select>
            <select value={advisorId} onChange={(e) => setAdvisorId(e.target.value)} disabled={uploading || visibility === 'general' || loadingUsers} className={inputClass}>
              <option value="">Elegir asesor</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
            </select>
            <Button size="sm" onClick={uploadVideo} loading={uploading} disabled={!title.trim() || (visibility === 'advisor' && !advisorId)}>
              {uploading ? `${uploadPct}%` : 'Guardar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetUpload} disabled={uploading}>Cancelar</Button>
          </div>
        )}
      </div>

      {videos.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-500">Aun no hay videos cargados.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              <Users size={15} className="text-amber-400" /> Generales ({generalVideos.length})
            </div>
            <ul className="flex flex-col gap-2">{generalVideos.map(renderVideoRow)}</ul>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              <Video size={15} className="text-amber-400" /> Por asesor ({advisorVideos.length})
            </div>
            <ul className="flex flex-col gap-2">{advisorVideos.map(renderVideoRow)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
