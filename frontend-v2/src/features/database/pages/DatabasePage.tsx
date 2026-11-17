import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, getDocs, getDoc, limit, query, where, doc, updateDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { Spinner } from '@/shared/components/Spinner';
import { ExportLeadsModal } from '@/features/dashboard/components/ExportLeadsModal';
import { syncSmartHomeLeadBitacora } from '@/features/leads/services/smartHome.service';
import { reassignLead } from '@/features/leads/services/advisors.service';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';
import { subscribeLeadSources } from '@/features/config/services/leadSources.service';
import { recordLeadAudit } from '@/features/leads/services/leadAudit.service';
import {
  Database, Search, UserCheck, AlertTriangle,
  Phone, Eye, RefreshCw, X, FileSpreadsheet,
  Pencil, Check, Loader2, ClipboardList, Compass
} from 'lucide-react';

export function normalizeProject(raw: unknown): string {
  if (!raw) return 'Sin especificar';
  const s = String(raw).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Cañón de Arizona
  if (s.includes('arizona') || s.includes('canon') || s.includes('canion')) {
    return 'Cañón de Arizona';
  }

  // 2. Llano Grande
  if (s.includes('llano grande') || s.includes('llanogrande')) {
    return 'Llano Grande';
  }

  // 3. Múltiples proyectos / portafolio conjunto
  if (
    s.includes('tres') || s.includes('los 3') || s.includes('varios') ||
    (s.includes('melgar') && s.includes('mariquita')) ||
    (s.includes('melgar') && s.includes('alvarado')) ||
    (s.includes('alvarado') && s.includes('mariquita')) ||
    s.includes('diferentes ubicaciones') || s.includes('todos')
  ) {
    return 'Portafolio (Varios Proyectos)';
  }

  // 4. Laguna Mar (Melgar)
  if (
    s.includes('laguna') || s.includes('santorini') || s.includes('canarias') ||
    s.includes('melgar') || s.includes('bungalow')
  ) {
    return 'Laguna Mar';
  }

  // 5. Río Claro (Mariquita)
  if (s.includes('rio claro') || s.includes('mariquita')) {
    return 'Río Claro';
  }

  // 6. Sobre Montañas (Alvarado)
  if (s.includes('montana') || s.includes('montanas') || s.includes('alvarado') || s.includes('al varado')) {
    return 'Sobre Montañas (Alvarado)';
  }

  // 7. General
  if (s.includes('campestre') || s.includes('lote') || s.includes('terreno') || s.includes('vivienda')) {
    return 'Lotes Campestres (Interés General)';
  }

  return 'Otros / Por Clasificar';
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city?: string;
  idNumber?: string;
  status: string;
  source: string;
  fuenteUbicacion?: string;
  assignedTo?: string | null;
  assignedAdvisorName?: string;
  projectInterest?: string | string[];
  tags?: string[];
  createdAt?: unknown;
  metadata?: {
    fuenteUbicacion?: string;
    migratedFrom?: string;
    importedFromSmartHome?: boolean;
    smarthomeFuenteOriginal?: string;
    smarthomeMedioAtencion?: string;
    smarthomeCicloVenta?: string;
    smarthomeSecuenciaCiclo?: string;
    smarthomeEstadoSeguimiento?: string;
    smarthomeAsesorOriginal?: string;
    smarthomeProyectoOriginal?: string;
    smarthomeEtapaOriginal?: string;
    smarthomeModuloOriginal?: string;
    smarthomeSector?: string;
    smarthomeValorInmueble?: string;
    smarthomeProspectId?: string;
    smarthomeBitacoras?: { action: string; count: number; lastDate: string; description: string }[];
    [key: string]: any;
  };
  customFields?: Record<string, string>;
}

export function DatabasePage() {
  const { companyId, role, platformAdmin, user, profile } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);

  if (!isAdmin) {
    return <Navigate to="/dashboard/leads" replace />;
  }

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [advisors, setAdvisors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedAdvisor, setSelectedAdvisor] = useState('all');
  const [selectedCycle, setSelectedCycle] = useState('all');
  const [selectedOrigin, setSelectedOrigin] = useState<'all' | 'smarthome' | 'pauta'>('all');
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(null);
  const [fichaLead, setFichaLead] = useState<ContactRow | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newNameVal, setNewNameVal] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [syncingBitacora, setSyncingBitacora] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [searchingRemote, setSearchingRemote] = useState(false);

  // Reasignación manual de asesor (para administradores)
  const [reassignAdvisorId, setReassignAdvisorId] = useState<string>('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);

  // Fuentes de captación y edición de Fuente/Medio (para administradores)
  const [leadSourcesList, setLeadSourcesList] = useState<{ id: string; name: string }[]>([]);
  const [newFuenteVal, setNewFuenteVal] = useState<string>('');
  const [customFuenteMode, setCustomFuenteMode] = useState<boolean>(false);
  const [savingFuente, setSavingFuente] = useState<boolean>(false);
  const [fuenteMsg, setFuenteMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    return subscribeLeadSources(companyId, (items) => {
      setLeadSourcesList(items.filter((s) => s.active));
    });
  }, [companyId]);

  useEffect(() => {
    if (selectedContact) {
      setNewNameVal(selectedContact.name || '');
      setEditingName(false);
      setSyncMsg(null);
      setReassignAdvisorId(selectedContact.assignedTo || '');
      setReassignMsg(null);

      const currentFuente = selectedContact.fuenteUbicacion || selectedContact.metadata?.smarthomeFuenteOriginal || selectedContact.source || '';
      setNewFuenteVal(currentFuente);
      setCustomFuenteMode(false);
      setFuenteMsg(null);
    }
  }, [selectedContact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveFuente = async () => {
    if (!selectedContact || !companyId || savingFuente) return;
    const trimmed = newFuenteVal.trim();
    if (!trimmed) return;
    const prevFuente = selectedContact.fuenteUbicacion || selectedContact.metadata?.smarthomeFuenteOriginal || selectedContact.source || 'Sin especificar';
    setSavingFuente(true);
    setFuenteMsg(null);
    try {
      const docRef = doc(db, 'companies', companyId, 'leads', selectedContact.id);
      await updateDoc(docRef, {
        fuenteUbicacion: trimmed,
        'metadata.fuenteUbicacion': trimmed,
        updatedAt: serverTimestamp(),
      });

      const adminName = profile?.displayName || profile?.email || user?.displayName || user?.email || 'Administrador';
      const adminId = user?.uid || '';

      // Registrar auditoría en bitácora y subcolección de notas
      const auditRes = await recordLeadAudit({
        companyId,
        leadId: selectedContact.id,
        adminId,
        adminName,
        changeType: 'source',
        previousValue: prevFuente,
        newValue: trimmed,
      });

      setSelectedContact((prev) =>
        prev
          ? {
              ...prev,
              fuenteUbicacion: trimmed,
              metadata: {
                ...(prev.metadata || {}),
                fuenteUbicacion: trimmed,
                smarthomeBitacoras: auditRes.updatedBitacoras as any,
              },
            }
          : null
      );

      setContacts((prev) =>
        prev.map((c) =>
          c.id === selectedContact.id
            ? {
                ...c,
                fuenteUbicacion: trimmed,
                metadata: {
                  ...(c.metadata || {}),
                  fuenteUbicacion: trimmed,
                  smarthomeBitacoras: auditRes.updatedBitacoras as any,
                },
              }
            : c
        )
      );

      setFuenteMsg(`✅ Fuente actualizada y registrada en bitácora por ${adminName}`);
      setTimeout(() => setFuenteMsg(null), 4000);
    } catch (err) {
      console.error('[DatabasePage] Error guardando fuente:', err);
      setFuenteMsg('❌ Error al actualizar la fuente.');
    } finally {
      setSavingFuente(false);
    }
  };

  const handleReassignContact = async () => {
    if (!selectedContact || !companyId || !reassignAdvisorId || reassigning) return;
    setReassigning(true);
    setReassignMsg(null);
    try {
      await reassignLead(companyId, selectedContact.id, reassignAdvisorId);
      const advObj = advisors.find((a) => a.id === reassignAdvisorId);
      const newName = advObj?.name || 'Asesor CRM';
      const prevAdvisor = selectedContact.assignedAdvisorName || selectedContact.metadata?.smarthomeAsesorOriginal || 'Sin asesor';
      const adminName = profile?.displayName || profile?.email || user?.displayName || user?.email || 'Administrador';
      const adminId = user?.uid || '';

      // Registrar auditoría en bitácora y subcolección de notas
      const auditRes = await recordLeadAudit({
        companyId,
        leadId: selectedContact.id,
        adminId,
        adminName,
        changeType: 'advisor',
        previousValue: prevAdvisor,
        newValue: newName,
      });

      setSelectedContact((prev) =>
        prev
          ? {
              ...prev,
              assignedTo: reassignAdvisorId,
              assignedAdvisorName: newName,
              metadata: {
                ...(prev.metadata || {}),
                smarthomeBitacoras: auditRes.updatedBitacoras as any,
              },
            }
          : null
      );

      setContacts((prev) =>
        prev.map((c) =>
          c.id === selectedContact.id
            ? {
                ...c,
                assignedTo: reassignAdvisorId,
                assignedAdvisorName: newName,
                metadata: {
                  ...(c.metadata || {}),
                  smarthomeBitacoras: auditRes.updatedBitacoras as any,
                },
              }
            : c
        )
      );

      setReassignMsg(`✅ Asignado con éxito a ${newName} (Registrado en bitácora por ${adminName})`);
    } catch (err: any) {
      console.error('[DatabasePage] Error al reasignar prospecto:', err);
      setReassignMsg('❌ Error al reasignar prospecto.');
    } finally {
      setReassigning(false);
    }
  };

  const handleSyncBitacoraFromApi = async () => {
    if (!selectedContact || !companyId || syncingBitacora) return;
    setSyncingBitacora(true);
    setSyncMsg(null);
    try {
      const res = await syncSmartHomeLeadBitacora(companyId, selectedContact.id);
      if (res.ok && res.bitacoras) {
        setSelectedContact((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            metadata: {
              ...(prev.metadata || {}),
              smarthomeBitacoras: res.bitacoras,
              smarthomeProspectId: res.summary?.prospectId || prev.metadata?.smarthomeProspectId,
              smarthomeAsesorOriginal: res.summary?.advisor || prev.metadata?.smarthomeAsesorOriginal,
              smarthomeCicloVenta: res.summary?.saleCycle || prev.metadata?.smarthomeCicloVenta,
              smarthomeEstadoSeguimiento: res.summary?.stage || prev.metadata?.smarthomeEstadoSeguimiento,
            },
          };
        });
        setContacts((prev) =>
          prev.map((c) =>
            c.id === selectedContact.id
              ? {
                  ...c,
                  metadata: {
                    ...(c.metadata || {}),
                    smarthomeBitacoras: res.bitacoras,
                    smarthomeProspectId: res.summary?.prospectId || c.metadata?.smarthomeProspectId,
                    smarthomeAsesorOriginal: res.summary?.advisor || c.metadata?.smarthomeAsesorOriginal,
                    smarthomeCicloVenta: res.summary?.saleCycle || c.metadata?.smarthomeCicloVenta,
                    smarthomeEstadoSeguimiento: res.summary?.stage || c.metadata?.smarthomeEstadoSeguimiento,
                  },
                }
              : c
          )
        );
        setSyncMsg(`✅ ${res.message}`);
      } else {
        setSyncMsg(`⚠️ ${res.message || 'No se encontraron eventos en SmartHome para este teléfono.'}`);
      }
    } catch (err) {
      console.error('[DatabasePage] Error syncing bitacora from API:', err);
      setSyncMsg('❌ Error consultando la API de SmartHome.');
    } finally {
      setSyncingBitacora(false);
    }
  };

  const handleSaveContactName = async () => {
    if (!selectedContact || !companyId || savingName) return;
    const trimmed = newNameVal.trim();
    if (!trimmed || trimmed === selectedContact.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const docRef = doc(db, 'companies', companyId, 'leads', selectedContact.id);
      await updateDoc(docRef, {
        name: trimmed,
        updatedAt: serverTimestamp(),
      });
      setSelectedContact((prev) => (prev ? { ...prev, name: trimmed } : null));
      setContacts((prev) =>
        prev.map((c) => (c.id === selectedContact.id ? { ...c, name: trimmed } : c))
      );
      setEditingName(false);
    } catch (err) {
      console.error('[DatabasePage] Error actualizando nombre:', err);
    } finally {
      setSavingName(false);
    }
  };

  // Carga inicial de usuarios y muestra de contactos
  const loadData = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // 1. Usuarios
      const usersSnap = await getDocs(collection(db, 'companies', companyId, 'users'));
      const advMap = new Map<string, string>();
      const advList: { id: string; name: string }[] = [];
      usersSnap.docs.forEach((d) => {
        const u = d.data();
        const name = u.displayName || u.email || d.id;
        advMap.set(d.id, name);
        advList.push({ id: d.id, name });
      });
      setAdvisors(advList);

      // 2. Cargar muestra representativa: operativos recientes ordenados por última actualización + base histórica SmartHome
      let leadsSnap;
      try {
        leadsSnap = await getDocs(query(collection(db, 'companies', companyId, 'leads'), orderBy('updatedAt', 'desc'), limit(800)));
      } catch {
        leadsSnap = await getDocs(query(collection(db, 'companies', companyId, 'leads'), limit(800)));
      }
      const migratedSnap = await getDocs(
        query(
          collection(db, 'companies', companyId, 'leads'),
          where('metadata.migratedFrom', '==', 'smarthome_excel_base_31'),
          limit(1200)
        )
      );

      const seen = new Set<string>();
      const combinedDocs = [...leadsSnap.docs, ...migratedSnap.docs].filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      const mergeContactBitacoras = (data: Record<string, any>) => {
        const raw = [
          ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
          ...(Array.isArray(data.metadata?.smarthomeBitacoras) ? data.metadata.smarthomeBitacoras : []),
          ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
        ];
        const seenB = new Set<string>();
        const merged: any[] = [];
        for (const b of raw) {
          if (!b || typeof b !== 'object') continue;
          const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
          if (!seenB.has(k)) {
            seenB.add(k);
            merged.push(b);
          }
        }
        return merged;
      };

      const rows: ContactRow[] = combinedDocs.map((docSnap) => {
        const data = docSnap.data();
        const assignedTo = data.assignedTo ?? null;
        const mergedBitacoras = mergeContactBitacoras(data);
        return {
          id: docSnap.id,
          name: data.name || 'Sin Nombre',
          phone: data.phone || '',
          email: data.email || '',
          city: data.city || '',
          idNumber: data.idNumber || '',
          status: data.status || 'new',
          source: data.source || 'manual',
          fuenteUbicacion: data.fuenteUbicacion || data.metadata?.fuenteUbicacion,
          assignedTo,
          assignedAdvisorName: assignedTo ? (advMap.get(assignedTo) || 'Asesor CRM') : undefined,
          projectInterest: data.projectInterest,
          tags: data.tags || [],
          createdAt: data.createdAt,
          metadata: {
            ...(data.metadata || {}),
            smarthomeBitacoras: mergedBitacoras,
          },
          customFields: data.customFields,
        };
      });

      setContacts(rows);
    } catch (err) {
      console.error('[DatabasePage] Error cargando base de datos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Búsqueda remota en Firestore si el término tiene al menos 3 caracteres
  useEffect(() => {
    const term = search.trim();
    if (!term || term.length < 3 || !companyId) return;

    const timer = setTimeout(async () => {
      setSearchingRemote(true);
      try {
        const cleanDigits = term.replace(/\D/g, '');
        const queries: any[] = [];
        const leadsCol = collection(db, 'companies', companyId, 'leads');

        if (cleanDigits.length >= 7) {
          const tail = cleanDigits.slice(-10);
          // Todas las formas en que puede estar guardado el teléfono: con o sin +, con indicativo
          // propio (+1, +34…) o asumido Colombia (+57), y los últimos 10 dígitos.
          const variants = Array.from(new Set([
            term,
            cleanDigits,
            `+${cleanDigits}`,
            tail,
            `+57${tail}`,
            `57${tail}`,
          ].filter(Boolean)));
          queries.push(getDocs(query(leadsCol, where('phoneTail', '==', tail), limit(15))));
          queries.push(getDocs(query(leadsCol, where('phone', 'in', variants), limit(15))));
          queries.push(getDocs(query(leadsCol, where('normalizedPhone', 'in', variants), limit(15))));
        } else if (cleanDigits.length >= 3) {
          queries.push(getDocs(query(leadsCol, where('phone', '==', term), limit(15))));
        }

        // Búsqueda por nombre en mayúsculas / inicial
        const upper = term.toUpperCase();
        queries.push(getDocs(query(leadsCol, where('name', '>=', upper), where('name', '<=', upper + '\uf8ff'), limit(20))));

        const results = await Promise.all(queries);
        const newDocs: ContactRow[] = [];
        const existingIds = new Set(contacts.map((c) => c.id));

        results.forEach((snap) => {
          snap.docs.forEach((d: any) => {
            if (!existingIds.has(d.id)) {
              existingIds.add(d.id);
              const data = d.data();
              const assignedTo = data.assignedTo ?? null;
              const rawB = [
                ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
                ...(Array.isArray(data.metadata?.smarthomeBitacoras) ? data.metadata.smarthomeBitacoras : []),
                ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
              ];
              const seenB = new Set<string>();
              const mergedB = rawB.filter((b: any) => {
                if (!b || typeof b !== 'object') return false;
                const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
                if (seenB.has(k)) return false;
                seenB.add(k);
                return true;
              });
              newDocs.push({
                id: d.id,
                name: data.name || 'Sin Nombre',
                phone: data.phone || '',
                email: data.email || '',
                city: data.city || '',
                idNumber: data.idNumber || '',
                status: data.status || 'new',
                source: data.source || 'manual',
                fuenteUbicacion: data.fuenteUbicacion || data.metadata?.fuenteUbicacion,
                assignedTo,
                assignedAdvisorName: data.assignedAdvisorName || data.assignedToName || (assignedTo ? 'Asesor CRM' : undefined),
                projectInterest: data.projectInterest,
                tags: data.tags || [],
                createdAt: data.createdAt,
                metadata: {
                  ...(data.metadata || {}),
                  smarthomeBitacoras: mergedB,
                },
                customFields: data.customFields,
              });
            }
          });
        });

        if (newDocs.length > 0) {
          setContacts((prev) => [...newDocs, ...prev]);
        }
      } catch (err) {
        console.warn('[DatabasePage] Error en búsqueda remota:', err);
      } finally {
        setSearchingRemote(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [search, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Proyectos únicos normalizados
  const uniqueProjects = useMemo(() => {
    const CANONICAL_ORDER = [
      'Laguna Mar',
      'Cañón de Arizona',
      'Río Claro',
      'Llano Grande',
      'Sobre Montañas (Alvarado)',
      'Portafolio (Varios Proyectos)',
      'Lotes Campestres (Interés General)',
    ];
    const set = new Set<string>();
    contacts.forEach((c) => {
      const raw = Array.isArray(c.projectInterest)
        ? c.projectInterest[0]
        : c.projectInterest || c.customFields?.proyecto || c.metadata?.smarthomeProyectoOriginal;
      const clean = normalizeProject(raw);
      if (clean && clean !== 'Sin especificar' && clean !== 'Otros / Por Clasificar') {
        set.add(clean);
      }
    });
    return CANONICAL_ORDER.filter((p) => set.has(p));
  }, [contacts]);

  // Ciclos de venta únicos
  const uniqueCycles = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => {
      const cycle = c.metadata?.smarthomeCicloVenta || c.status;
      if (cycle) set.add(cycle);
    });
    return Array.from(set).sort();
  }, [contacts]);

  // Asesores presentes
  const uniqueAdvisors = useMemo(() => {
    const map = new Map<string, string>();
    contacts.forEach((c) => {
      if (c.assignedTo) {
        map.set(c.assignedTo, c.assignedAdvisorName || c.assignedTo);
      }
    });
    return Array.from(map.entries());
  }, [contacts]);

  // Filtrado de contactos en vivo
  const filteredContacts = useMemo(() => {
    const queryTerm = search.toLowerCase().trim();
    return contacts.filter((c) => {
      // Búsqueda de texto
      if (queryTerm) {
        const qDigits = queryTerm.replace(/\D/g, '');
        const cPhoneDigits = (c.phone || '').replace(/\D/g, '');
        const matchesName = c.name.toLowerCase().includes(queryTerm);
        // Compara también por los últimos 10 dígitos: "+1 312…" y "+57 312…" se guardan distinto
        const qTail = qDigits.length >= 10 ? qDigits.slice(-10) : '';
        const matchesPhone =
          c.phone.includes(queryTerm) ||
          (qDigits.length >= 3 && cPhoneDigits.includes(qDigits)) ||
          (qTail !== '' && cPhoneDigits.endsWith(qTail));
        const matchesId = c.idNumber?.toLowerCase().includes(queryTerm);
        const matchesCity = c.city?.toLowerCase().includes(queryTerm);
        const matchesEx = c.metadata?.smarthomeAsesorOriginal?.toLowerCase().includes(queryTerm);
        if (!matchesName && !matchesPhone && !matchesId && !matchesCity && !matchesEx) return false;
      }

      // Origen
      const isMigrated = Boolean(
        c.metadata?.migratedFrom ||
        c.tags?.includes('smarthome_migracion') ||
        c.source === 'smarthome' ||
        c.metadata?.importedFromSmartHome
      );
      if (selectedOrigin === 'smarthome' && !isMigrated) return false;
      if (selectedOrigin === 'pauta' && isMigrated) return false;

      // Proyecto
      if (selectedProject !== 'all') {
        const raw = Array.isArray(c.projectInterest)
          ? c.projectInterest[0]
          : c.projectInterest || c.customFields?.proyecto || c.metadata?.smarthomeProyectoOriginal;
        const clean = normalizeProject(raw);
        if (clean !== selectedProject) return false;
      }

      // Asesor
      if (selectedAdvisor === 'unassigned') {
        if (c.assignedTo) return false;
      } else if (selectedAdvisor !== 'all') {
        if (c.assignedTo !== selectedAdvisor) return false;
      }

      // Ciclo
      if (selectedCycle !== 'all') {
        const cycle = c.metadata?.smarthomeCicloVenta || c.status;
        if (cycle !== selectedCycle) return false;
      }

      return true;
    });
  }, [contacts, search, selectedOrigin, selectedProject, selectedAdvisor, selectedCycle]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">
      {/* ── Encabezado ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 gap-4 flex-wrap bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-amber-400" />
            <h1 className="text-base font-semibold text-zinc-100">Base de Datos Unificada</h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              SmartHome + CRM
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Repositorio maestro de 13.090 prospectos históricos y activos · Buscador, bitácoras y exportación a Excel
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg border border-emerald-600/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 transition-colors font-semibold shadow-sm"
          >
            <FileSpreadsheet className="h-4 w-4" />
            📥 Exportar Excel (.xlsx)
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Recargar
          </button>
        </div>
      </div>

      {companyId && (
        <ExportLeadsModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          companyId={companyId}
        />
      )}

      <div className="flex flex-col gap-5 p-6">
        {/* ── Tarjetas Resumen Global de la Base de Datos ───────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="text-[11px] font-medium text-zinc-400">Total Base Unificada</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">13.090</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">100% de registros consolidados</p>
          </div>
          <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/10 p-4">
            <p className="text-[11px] font-medium text-emerald-400">Asignados a Asesores CRM</p>
            <p className="text-2xl font-semibold text-emerald-200 mt-1 tabular-nums">8.508</p>
            <p className="text-[10px] text-emerald-500/80 mt-0.5">72.2% con cuenta activa de asesor</p>
          </div>
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-4">
            <p className="text-[11px] font-medium text-amber-400">Sin Asignar / Ex-Asesores</p>
            <p className="text-2xl font-semibold text-amber-200 mt-1 tabular-nums">3.279</p>
            <p className="text-[10px] text-amber-500/80 mt-0.5">Listos para reasignación masiva</p>
          </div>
          <div className="rounded-xl border border-sky-800/40 bg-sky-950/10 p-4">
            <p className="text-[11px] font-medium text-sky-400">Base Histórica SmartHome</p>
            <p className="text-2xl font-semibold text-sky-200 mt-1 tabular-nums">11.787</p>
            <p className="text-[10px] text-sky-500/80 mt-0.5">16.827 bitácoras y acciones preservadas</p>
          </div>
        </div>

        {/* ── Barra de Búsqueda y Filtros ───────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Input Buscador */}
            <div className="flex-1 min-w-[260px] relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar por Nombre, Teléfono, Cédula o Ex-Asesor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
              {searchingRemote && (
                <Loader2 className="absolute right-9 top-2.5 h-4 w-4 text-amber-400 animate-spin" />
              )}
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filtro Origen */}
            <select
              value={selectedOrigin}
              onChange={(e) => setSelectedOrigin(e.target.value as 'all' | 'smarthome' | 'pauta')}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">Origen: Todos</option>
              <option value="smarthome">Base SmartHome Migrada (11.787)</option>
              <option value="pauta">Pauta Digital Operativa (1.303)</option>
            </select>

            {/* Filtro Proyecto */}
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 max-w-[200px]"
            >
              <option value="all">Proyecto: Todos ({uniqueProjects.length})</option>
              {uniqueProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            {/* Filtro Asesor */}
            <select
              value={selectedAdvisor}
              onChange={(e) => setSelectedAdvisor(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 max-w-[200px]"
            >
              <option value="all">Asesor: Todos</option>
              <option value="unassigned">⚠️ Solo Sin Asignar / Ex-Asesores</option>
              {uniqueAdvisors.map(([uid, name]) => (
                <option key={uid} value={uid}>{name}</option>
              ))}
            </select>

            {/* Filtro Ciclo SmartHome */}
            <select
              value={selectedCycle}
              onChange={(e) => setSelectedCycle(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">Ciclo SmartHome: Todos</option>
              {uniqueCycles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800">
            <span>
              Mostrando <strong className="text-zinc-200">{filteredContacts.length}</strong> de {contacts.length} contactos cargados en vista previa
            </span>
            <span>
              Para exportar los 13.090 registros completos sin límite, usa el botón <strong>"Exportar Excel (.xlsx)"</strong> arriba.
            </span>
          </div>
        </div>

        {/* ── Tabla de Contactos ────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-3">
            <Spinner />
            <p className="text-xs text-zinc-500">Cargando base de datos unificada...</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 border border-zinc-800 rounded-xl bg-zinc-900/20 text-center">
            <p className="text-sm font-medium text-zinc-300">No se encontraron prospectos con los filtros seleccionados.</p>
            <p className="text-xs text-zinc-500 mt-1">Prueba limpiando los filtros o buscando por otro término.</p>
          </div>
        ) : (
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400">
                    <th className="py-3 px-4 font-medium">Prospecto</th>
                    <th className="py-3 px-4 font-medium">Teléfono / Ciudad</th>
                    <th className="py-3 px-4 font-medium">Proyecto & Sector</th>
                    <th className="py-3 px-4 font-medium">Asesor Asignado</th>
                    <th className="py-3 px-4 font-medium">Ciclo SmartHome</th>
                    <th className="py-3 px-4 font-medium">Bitácora Resumen</th>
                    <th className="py-3 px-4 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredContacts.slice(0, 100).map((c) => {
                    const isMigrated = Boolean(c.metadata?.migratedFrom);
                    const rawP = Array.isArray(c.projectInterest)
                      ? c.projectInterest[0]
                      : c.projectInterest || c.customFields?.proyecto || c.metadata?.smarthomeProyectoOriginal || 'No indicado';
                    const proj = normalizeProject(rawP);
                    const bitacoras = c.metadata?.smarthomeBitacoras || [];

                    return (
                      <tr key={c.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-zinc-100">{c.name}</p>
                          {c.idNumber && (
                            <p className="text-[10px] text-zinc-500 mt-0.5">CC: {c.idNumber}</p>
                          )}
                          {isMigrated && (
                            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              SmartHome
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-zinc-300">
                          <div className="flex items-center gap-1 font-mono text-[11px]">
                            <Phone className="h-3 w-3 text-emerald-400" />
                            <a
                              href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline text-emerald-300"
                            >
                              {c.phone}
                            </a>
                          </div>
                          {c.city && <p className="text-[10px] text-zinc-500 mt-0.5">{c.city}</p>}
                        </td>

                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800 text-zinc-200 border border-zinc-700/60">
                            {proj}
                          </span>
                          {c.metadata?.smarthomeSector && (
                            <p className="text-[10px] text-zinc-500 mt-1">Sector: {c.metadata.smarthomeSector}</p>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          {c.assignedTo ? (
                            <span className="text-zinc-200 font-medium flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="truncate max-w-[140px]">{c.assignedAdvisorName}</span>
                            </span>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 font-medium">
                                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                                Sin Asignar
                              </span>
                              {c.metadata?.smarthomeAsesorOriginal && (
                                <p className="text-[10px] text-zinc-500 mt-1">
                                  Ex: {c.metadata.smarthomeAsesorOriginal}
                                </p>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-950/40 border border-violet-800/50 text-violet-300">
                            {c.metadata?.smarthomeCicloVenta || c.status}
                          </span>
                          {c.metadata?.smarthomeEstadoSeguimiento && (
                            <p className="text-[10px] text-zinc-500 mt-1">
                              {c.metadata.smarthomeEstadoSeguimiento}
                            </p>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[180px]">
                          {bitacoras.length > 0 ? (
                            <p className="text-[11px] text-zinc-400 truncate" title={bitacoras.map((b) => b.description).join(' | ')}>
                              {bitacoras[0].description} {bitacoras.length > 1 ? `(+${bitacoras.length - 1} más)` : ''}
                            </p>
                          ) : (
                            <span className="text-[10px] text-zinc-600">Sin bitácoras previas</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => setSelectedContact(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors text-[11px]"
                          >
                            <Eye className="h-3 w-3" />
                            Ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredContacts.length > 100 && (
              <div className="p-3 text-center text-xs text-zinc-500 border-t border-zinc-800 bg-zinc-900/40">
                Mostrando primeros 100 de {filteredContacts.length} resultados filtrados. Para ver o exportar la totalidad, usa el botón <strong>"Exportar Excel (.xlsx)"</strong>.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal de Ficha Técnica / Detalle del Contacto ──────────────────── */}
      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 sm:p-6 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex-1 pr-4">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newNameVal}
                      onChange={(e) => setNewNameVal(e.target.value)}
                      placeholder="Nombre del cliente..."
                      className="px-2.5 py-1 text-sm bg-zinc-950 border border-amber-500/80 rounded-md text-zinc-100 focus:outline-none w-full max-w-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveContactName();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                    />
                    <button
                      onClick={handleSaveContactName}
                      disabled={savingName}
                      className="px-2.5 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded font-medium disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      {savingName ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-zinc-100">{selectedContact.name}</h3>
                    <button
                      onClick={() => {
                        setNewNameVal(selectedContact.name || '');
                        setEditingName(true);
                      }}
                      title="Editar nombre del cliente"
                      className="p-1 rounded text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="text-xs text-zinc-400 mt-0.5 font-mono">{selectedContact.phone} · ID: {selectedContact.id}</p>
              </div>
              <button
                onClick={() => setSelectedContact(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                <p className="text-[10px] text-zinc-500 font-semibold uppercase">Proyecto / Inmueble</p>
                <p className="text-zinc-200 font-medium mt-1">
                  {selectedContact.metadata?.smarthomeProyectoOriginal || selectedContact.customFields?.proyecto || 'No indicado'}
                </p>
                {selectedContact.metadata?.smarthomeSector && (
                  <p className="text-[11px] text-amber-400 mt-0.5">Sector: {selectedContact.metadata.smarthomeSector}</p>
                )}
                {selectedContact.metadata?.smarthomeValorInmueble && (
                  <p className="text-[11px] text-emerald-400 mt-0.5">Valor: {selectedContact.metadata.smarthomeValorInmueble}</p>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase">Asignación & Asesor</p>
                  {isAdmin && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-zinc-200 font-medium mt-1">
                  {selectedContact.assignedTo ? (
                    <span className="text-emerald-300 flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>Asesor CRM: {selectedContact.assignedAdvisorName}</span>
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Sin Asignar (Pendiente Reasignar)</span>
                    </span>
                  )}
                </p>
                {selectedContact.metadata?.smarthomeAsesorOriginal && (
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Asesor Original SmartHome: <strong>{selectedContact.metadata.smarthomeAsesorOriginal}</strong>
                  </p>
                )}

                {isAdmin && (
                  <div className="mt-2.5 pt-2 border-t border-zinc-800/80">
                    <label className="block text-[10px] font-bold text-zinc-400 mb-1">
                      Cambiar / Asignar a Nuevo Asesor:
                    </label>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <select
                        value={reassignAdvisorId}
                        onChange={(e) => setReassignAdvisorId(e.target.value)}
                        disabled={reassigning}
                        className="w-full sm:flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500 cursor-pointer"
                      >
                        <option value="">Seleccionar Asesor...</option>
                        {advisors.map((adv) => (
                          <option key={adv.id} value={adv.id}>
                            {adv.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleReassignContact}
                        disabled={reassigning || !reassignAdvisorId || reassignAdvisorId === selectedContact.assignedTo}
                        className="w-full sm:w-auto justify-center px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm active:scale-95"
                      >
                        {reassigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                        <span>Asignar Asesor</span>
                      </button>
                    </div>
                    {reassignMsg && (
                      <p className="text-[11px] text-emerald-400 mt-1 font-medium">{reassignMsg}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                <p className="text-[10px] text-zinc-500 font-semibold uppercase">Ciclo & Estado SmartHome</p>
                <p className="text-zinc-200 font-medium mt-1">
                  Ciclo: <span className="text-violet-400">{selectedContact.metadata?.smarthomeCicloVenta || selectedContact.status}</span>
                </p>
                {selectedContact.metadata?.smarthomeEstadoSeguimiento && (
                  <p className="text-[11px] text-zinc-400 mt-0.5">Seguimiento: {selectedContact.metadata.smarthomeEstadoSeguimiento}</p>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase flex items-center gap-1">
                    <Compass className="h-3 w-3 text-emerald-400" /> Fuente & Medio
                  </p>
                  {isAdmin && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-zinc-200 font-medium mt-1">
                  Fuente: <span className="text-emerald-400 font-semibold">{selectedContact.fuenteUbicacion || selectedContact.metadata?.smarthomeFuenteOriginal || selectedContact.source || 'Sin especificar'}</span>
                </p>
                {selectedContact.metadata?.smarthomeMedioAtencion && (
                  <p className="text-[11px] text-zinc-400 mt-0.5">Medio: {selectedContact.metadata.smarthomeMedioAtencion}</p>
                )}

                {isAdmin && (
                  <div className="mt-2.5 pt-2 border-t border-zinc-800/80">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold text-zinc-400">
                        Cambiar Fuente / Medio:
                      </label>
                      <button
                        type="button"
                        onClick={() => setCustomFuenteMode(!customFuenteMode)}
                        className="text-[10px] text-emerald-400 hover:underline cursor-pointer"
                      >
                        {customFuenteMode ? '← Seleccionar de lista' : '+ Escribir otra fuente'}
                      </button>
                    </div>

                    {customFuenteMode ? (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="text"
                          value={newFuenteVal}
                          onChange={(e) => setNewFuenteVal(e.target.value)}
                          placeholder="Ej: Trabajo de campo, Feria, etc."
                          className="w-full sm:flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={handleSaveFuente}
                          disabled={savingFuente || !newFuenteVal.trim()}
                          className="w-full sm:w-auto justify-center px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          {savingFuente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          <span>Actualizar Fuente</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <select
                          value={newFuenteVal}
                          onChange={(e) => setNewFuenteVal(e.target.value)}
                          disabled={savingFuente}
                          className="w-full sm:flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500 cursor-pointer"
                        >
                          <option value="">Seleccionar Fuente...</option>
                          <optgroup label="Canales Principales">
                            <option value="Trabajo de campo">Trabajo de campo</option>
                            <option value="Feria">Feria</option>
                            <option value="Línea WhatsApp 317">Línea WhatsApp 317</option>
                            <option value="Redes Sociales">Redes Sociales</option>
                            <option value="Referidos">Referidos</option>
                            <option value="Página Web">Página Web</option>
                            <option value="Base de datos fría">Base de datos fría</option>
                          </optgroup>
                          {leadSourcesList.length > 0 && (
                            <optgroup label="Fuentes y Campañas Configuradas">
                              {leadSourcesList.map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {newFuenteVal && !leadSourcesList.some((s) => s.name === newFuenteVal) && (
                            <option value={newFuenteVal}>Actual: {newFuenteVal}</option>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={handleSaveFuente}
                          disabled={savingFuente || !newFuenteVal || newFuenteVal === (selectedContact.fuenteUbicacion || selectedContact.metadata?.smarthomeFuenteOriginal)}
                          className="w-full sm:w-auto justify-center px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          {savingFuente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          <span>Actualizar Fuente</span>
                        </button>
                      </div>
                    )}
                    {fuenteMsg && (
                      <p className="text-[11px] text-emerald-400 mt-1 font-medium">{fuenteMsg}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Bitácoras históricas y sincronización en vivo */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-zinc-200">Historial de Bitácoras SmartHome</h4>
                <button
                  onClick={handleSyncBitacoraFromApi}
                  disabled={syncingBitacora}
                  className="px-2.5 py-1 text-[11px] rounded bg-sky-950/60 border border-sky-500/40 text-sky-300 hover:bg-sky-900/40 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  title="Consultar la API de SmartHome y traer los seguimientos en tiempo real"
                >
                  {syncingBitacora ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {syncingBitacora ? 'Consultando API...' : 'Alimentar con API SmartHome'}
                </button>
              </div>

              {syncMsg && (
                <div className="p-2 mb-2 rounded text-xs bg-zinc-950 border border-zinc-800 text-zinc-300">
                  {syncMsg}
                </div>
              )}

              {selectedContact.metadata?.smarthomeBitacoras && selectedContact.metadata.smarthomeBitacoras.length > 0 ? (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {selectedContact.metadata.smarthomeBitacoras.map((b, idx) => (
                    <div key={idx} className="p-2 rounded bg-zinc-950 border border-zinc-800/80 text-xs flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <span className="text-amber-400 font-semibold text-[11px]">{b.action}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {b.lastDate ? `Fecha: ${b.lastDate}` : (b.count ? `${b.count} veces` : '')}
                        </span>
                      </div>
                      {b.description && (
                        <p className="text-[11px] text-zinc-300 leading-relaxed font-normal">{b.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">
                  No hay bitácoras registradas localmente. Pulsa <strong>"Alimentar con API SmartHome"</strong> para consultar el historial en vivo.
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setFichaLead(selectedContact)}
                className="w-full sm:w-auto justify-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                📝 Ficha Técnica & Seguimiento
              </button>
              <a
                href={`https://wa.me/${selectedContact.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto justify-center px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                Abrir en WhatsApp
              </a>
              <button
                onClick={() => setSelectedContact(null)}
                className="w-full sm:w-auto justify-center px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {fichaLead && companyId && (
        <FichaTecnicaModal
          isOpen={!!fichaLead}
          onClose={() => setFichaLead(null)}
          companyId={companyId}
          lead={{
            id: fichaLead.id,
            name: fichaLead.name,
            phone: fichaLead.phone,
            project: (Array.isArray(fichaLead.projectInterest) ? fichaLead.projectInterest[0] : fichaLead.projectInterest) || fichaLead.metadata?.smarthomeProyectoOriginal || null,
            advisorName: fichaLead.assignedAdvisorName || fichaLead.metadata?.smarthomeAsesorOriginal || null,
          }}
          onSuccess={async () => {
            const updatedId = fichaLead.id;
            setFichaLead(null);
            try {
              const freshSnap = await getDoc(doc(db, 'companies', companyId, 'leads', updatedId));
              if (freshSnap.exists()) {
                const freshData = freshSnap.data();
                const freshBitacoras = freshData.metadata?.smarthomeBitacoras || freshData.bitacoras || [];
                setSelectedContact((prev) => {
                  if (!prev) return null;
                  return {
                    ...prev,
                    metadata: {
                      ...(prev.metadata || {}),
                      ...(freshData.metadata || {}),
                      smarthomeBitacoras: freshBitacoras,
                    },
                  };
                });
                setContacts((prev) =>
                  prev.map((c) =>
                    c.id === updatedId
                      ? {
                          ...c,
                          metadata: {
                            ...(c.metadata || {}),
                            ...(freshData.metadata || {}),
                            smarthomeBitacoras: freshBitacoras,
                          },
                        }
                      : c
                  )
                );
              }
            } catch (e) {
              console.error('[DatabasePage] error refreshing contact after ficha:', e);
            }
          }}
        />
      )}
    </div>
  );
}
