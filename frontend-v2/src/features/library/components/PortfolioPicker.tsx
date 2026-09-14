import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FileText, FolderOpen, MapPin, Video, X } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { listenLibrary } from '../services/library.service';
import {
  fetchPlanosIndex,
  isPlanoItem,
  normalizeProjectName,
  planoItemId,
  planoToLibraryItem,
  timeAgo,
  type PlanoIndexItem,
} from '../services/planos.service';
import type { LibraryItem } from '../types';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';

const NO_PROJECT = 'Otros documentos';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface PortfolioPickerProps {
  companyId: string;
  onSelect:  (item: LibraryItem) => void;
  onClose:   () => void;
}

/** Modal de 2 pasos: elegir proyecto → elegir documento y enviarlo. */
export function PortfolioPicker({ companyId, onSelect, onClose }: PortfolioPickerProps) {
  const { user, role, platformAdmin } = useAuth();
  const [items, setItems]     = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<string | null>(null); // null = vista de proyectos
  const [planos, setPlanos]   = useState<PlanoIndexItem[]>([]);

  useEffect(() => {
    const unsub = listenLibrary(companyId, (list) => {
      setItems(list);
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  // Planos con disponibilidad (proyecto de disponibilidad). Aditivo: si falla, no
  // afecta la biblioteca normal.
  useEffect(() => {
    let alive = true;
    fetchPlanosIndex().then((list) => { if (alive) setPlanos(list); });
    return () => { alive = false; };
  }, []);

  // Fecha de generación por id de ítem de plano, para mostrar "actualizado hace…".
  const planoGenAt = useMemo(() => {
    const m = new Map<string, string | null>();
    planos.forEach((p) => m.set(planoItemId(p.planoId), p.generatedAt));
    return m;
  }, [planos]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    const canSeePrivateVideos = platformAdmin || isAdminRole(role);
    items.filter((i) => {
      const isVideo = i.kind === 'video' || i.contentType.startsWith('video/');
      if (!isVideo) return true;
      if ((i.visibility ?? 'general') !== 'advisor') return true;
      return canSeePrivateVideos || i.advisorId === user?.uid;
    }).forEach((i) => {
      const key = i.project?.trim() || NO_PROJECT;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    });

    // Fusionar cada plano en su grupo de proyecto (match por nombre normalizado);
    // si no hay grupo, el plano crea su propio grupo. El plano va de primero.
    if (planos.length) {
      const keyByNorm = new Map<string, string>();
      [...map.keys()].forEach((k) => keyByNorm.set(normalizeProjectName(k), k));
      planos.forEach((p) => {
        const norm = normalizeProjectName(p.projectName);
        let groupKey = keyByNorm.get(norm);
        if (!groupKey) {
          groupKey = p.name;
          keyByNorm.set(norm, groupKey);
          map.set(groupKey, []);
        }
        map.set(groupKey, [planoToLibraryItem(p, companyId, groupKey), ...(map.get(groupKey) ?? [])]);
      });
    }
    return map;
  }, [items, planos, companyId, platformAdmin, role, user?.uid]);

  const projectNames = useMemo(() => {
    return [...groups.keys()].sort((a, b) => {
      if (a === NO_PROJECT) return 1;
      if (b === NO_PROJECT) return -1;
      return a.localeCompare(b);
    });
  }, [groups]);

  // Si solo hay un proyecto, entrar directo.
  useEffect(() => {
    if (!loading && project === null && projectNames.length === 1) {
      setProject(projectNames[0]);
    }
  }, [loading, project, projectNames]);

  const currentItems = project ? (groups.get(project) ?? []) : [];
  const showBack = project !== null && projectNames.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full flex-col rounded-t-2xl border border-zinc-800 bg-zinc-900 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          {showBack && (
            <button onClick={() => setProject(null)} className="text-zinc-400 hover:text-zinc-200" aria-label="Volver a proyectos">
              <ChevronLeft size={18} />
            </button>
          )}
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
            {project ?? 'Enviar documento'}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : projectNames.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">
              No hay documentos cargados todavía. Un administrador puede subirlos en
              Configuración → Portafolios.
            </p>
          ) : project === null ? (
            /* Paso 1: proyectos */
            <ul className="flex flex-col gap-1">
              {projectNames.map((name) => (
                <li key={name}>
                  <button
                    onClick={() => setProject(name)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-800"
                  >
                    <FolderOpen size={20} className="shrink-0 text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{name}</p>
                      <p className="truncate text-[11px] text-zinc-500">{groups.get(name)!.length} documento(s)</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            /* Paso 2: documentos del proyecto */
            <ul className="flex flex-col gap-1">
              {currentItems.map((item) => {
                const plano = isPlanoItem(item);
                const video = item.kind === 'video' || item.contentType.startsWith('video/');
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => onSelect(item)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-800 ${plano ? 'border border-emerald-500/30 bg-emerald-500/5' : ''}`}
                    >
                      {plano ? (
                        <MapPin size={20} className="shrink-0 text-emerald-400" />
                      ) : video ? (
                        <Video size={20} className="shrink-0 text-amber-400" />
                      ) : (
                        <FileText size={20} className="shrink-0 text-violet-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-200">{item.title}</p>
                        <p className="truncate text-[11px] text-zinc-500">
                          {plano ? (timeAgo(planoGenAt.get(item.id) ?? null) || 'disponibilidad en vivo') : video && (item.visibility ?? 'general') === 'advisor' ? `Solo ${item.advisorName || 'asesor'} - ${formatSize(item.sizeBytes)}` : formatSize(item.sizeBytes)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
