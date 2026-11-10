import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  getDashboardMetrics,
  normalizeProject,
  reassignLead,
  recordLeadAudit,
  subscribeLeadSources,
  syncSmartHomeLeadBitacora,
  type LeadSourceItem,
} from '../services/enterprise';
import { isAdminRole, type RootStackParams } from '../types';
import { formatPhone } from '../utils/formatPhone';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ExportLeadsModal } from '../components/ExportLeadsModal';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import { Icon } from '../components/Icon';
import { LoadingView } from '../components/LoadingView';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';

type Props = NativeStackScreenProps<RootStackParams, 'Database'>;

interface UnifiedLead {
  id: string;
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  city: string;
  project: string;
  sectorEtapa: string;
  valorEstimado: number;
  source: string;
  assignedTo: string | null;
  advisorName: string | null;
  isMigratedSmarthome: boolean;
  smarthomeAsesorOriginal: string;
  smarthomeCicloVenta: string;
  smarthomeEstadoSeguimiento: string;
  smarthomeBitacoras: any[];
  status: string;
  createdAt: number;
  rawMetadata: Record<string, any>;
}

interface AdvisorOption {
  id: string;
  name: string;
}

const PRESET_SOURCES = [
  'Pauta Meta Ads (Línea 317)',
  'WhatsApp Directo Asesor',
  'SmartHome Migración',
  'CORFERIAS AGOSTO 2026',
  'FERIA VIVIENDA',
  ' Orgánico / Redes Sociales',
  'Referido Cliente',
  'Sala de Ventas / Visitante',
  'Página Web Oficial',
  'Google Ads',
  'Llamada Entrante',
];

function toMillisAny(raw: any): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw?.toMillis === 'function') return raw.toMillis();
  if (typeof raw?.seconds === 'number') return raw.seconds * 1000;
  if (typeof raw?._seconds === 'number') return raw._seconds * 1000;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapDocToUnifiedLead(
  docId: string,
  d: Record<string, any>,
  advisorsMap: Map<string, string>
): UnifiedLead {
  const meta = (d.metadata && typeof d.metadata === 'object' ? d.metadata : {}) as Record<
    string,
    any
  >;
  const isSH = Boolean(
    meta.migratedFrom === 'smarthome_excel_base_31' ||
      d.smarthomeCustomerId ||
      d.smartHomeCustomerId ||
      d.smarthomeCicloVenta
  );
  const assignedId = d.assignedTo || null;
  const resolvedAdvisor = assignedId
    ? advisorsMap.get(assignedId) || d.assignedAdvisorName || 'Asesor asignado'
    : null;

  const rawProj =
    d.project ||
    (Array.isArray(d.projectInterest) ? d.projectInterest[0] : d.projectInterest) ||
    meta.proyecto ||
    d.smarthomeProyecto ||
    meta.project ||
    '';

  const rawBitacorasList = [
    ...(Array.isArray(d.bitacoras) ? d.bitacoras : []),
    ...(Array.isArray(meta.smarthomeBitacoras) ? meta.smarthomeBitacoras : []),
    ...(Array.isArray(d.smarthomeBitacoras) ? d.smarthomeBitacoras : []),
    ...(Array.isArray(meta.bitacoras) ? meta.bitacoras : []),
  ];
  const seenBitKeys = new Set<string>();
  const bitacoras: any[] = [];
  for (const b of rawBitacorasList) {
    if (!b || typeof b !== 'object') continue;
    const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
    if (!seenBitKeys.has(k)) {
      seenBitKeys.add(k);
      bitacoras.push(b);
    }
  }

  return {
    id: docId,
    name: String(d.name || meta.nombre || 'Sin nombre').trim(),
    phone: String(d.phone || d.normalizedPhone || '').trim(),
    email: String(d.email || meta.correo || d.smarthomeCorreo || '').trim(),
    idNumber: String(
      d.documentNumber || meta.documento || meta.cedula || d.smarthomeIdentificacion || ''
    ).trim(),
    city: String(d.city || meta.ciudad || d.smarthomeCiudad || '').trim(),
    project: normalizeProject(rawProj),
    sectorEtapa: String(meta.sectorEtapa || d.smarthomeSectorEtapa || '').trim(),
    valorEstimado: Number(meta.valorEstimado || d.smarthomeValor || 0) || 0,
    source: String(
      d.fuenteUbicacion ||
        meta.fuenteUbicacion ||
        d.smarthomeMedio ||
        d.source ||
        'Desconocido'
    ).trim(),
    assignedTo: assignedId,
    advisorName: resolvedAdvisor,
    isMigratedSmarthome: isSH,
    smarthomeAsesorOriginal: String(
      d.smarthomeAsesorOriginal || d.smartHomeAdvisor || meta.asesorOriginal || ''
    ).trim(),
    smarthomeCicloVenta: String(
      d.smarthomeCicloVenta || meta.cicloVenta || (isSH ? 'Captación' : '')
    ).trim(),
    smarthomeEstadoSeguimiento: String(
      d.smarthomeEstadoSeguimiento || d.pipelineStageLabel || meta.estadoSeguimiento || ''
    ).trim(),
    smarthomeBitacoras: bitacoras,
    status: String(d.status || 'new'),
    createdAt: toMillisAny(d.createdAt) || toMillisAny(d.updatedAt),
    rawMetadata: meta,
  };
}

export function DatabaseScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const auth = useAuth();
  const { companyId, profile, user, role, platformAdmin } = auth;
  const isAdmin = Boolean(
    (auth as { isAdmin?: boolean }).isAdmin ?? (isAdminRole(role) || platformAdmin)
  );

  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [advisorsList, setAdvisorsList] = useState<AdvisorOption[]>([]);
  const [advisorsMapState, setAdvisorsMapState] = useState<Map<string, string>>(new Map());
  const [dynamicSources, setDynamicSources] = useState<LeadSourceItem[]>([]);
  const [globalStats, setGlobalStats] = useState<{
    totalContacts: number;
    activeAdvisorsAssigned: number;
    unassignedOrFormer: number;
    migratedSmarthome: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState<'all' | 'smarthome' | 'pauta'>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [advisorFilter, setAdvisorFilter] = useState('all');
  const [cycleFilter, setCycleFilter] = useState('all');
  const [visibleLimit, setVisibleLimit] = useState(100);

  // Modales
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState<UnifiedLead | null>(null);
  const [showFichaModal, setShowFichaModal] = useState(false);

  // Edición en modal de detalle
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [reassigningAdvisor, setReassigningAdvisor] = useState(false);
  const [reassignSuccess, setReassignSuccess] = useState(false);

  const [customSourceMode, setCustomSourceMode] = useState(false);
  const [customSourceText, setCustomSourceText] = useState('');
  const [savingSource, setSavingSource] = useState(false);
  const [sourceSuccess, setSourceSuccess] = useState(false);

  const [syncingBitacora, setSyncingBitacora] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  useEffect(() => {
    if (!companyId || !isAdmin) return;
    return subscribeLeadSources(companyId, (items) => {
      setDynamicSources(items.filter((i) => i.active));
    });
  }, [companyId, isAdmin]);

  const loadDatabase = useCallback(
    async (isPull = false) => {
      if (!companyId || !isAdmin) return;
      if (isPull) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        // 1. Cargar usuarios/asesores de la empresa
        const usersSnap = await firestore()
          .collection('companies')
          .doc(companyId)
          .collection('users')
          .get();

        const advMap = new Map<string, string>();
        const advOptions: AdvisorOption[] = [];
        usersSnap.docs.forEach((uDoc) => {
          const u = uDoc.data();
          const label = String(u.displayName || u.name || u.email || uDoc.id).trim();
          advMap.set(uDoc.id, label);
          if (u.active !== false && u.role !== 'viewer') {
            advOptions.push({ id: uDoc.id, name: label });
          }
        });
        advOptions.sort((a, b) => a.name.localeCompare(b.name));
        setAdvisorsList(advOptions);
        setAdvisorsMapState(advMap);

        // 2. Cargar contactos (pauta reciente + base histórica SmartHome) y métricas globales en paralelo
        const leadsCol = firestore()
          .collection('companies')
          .doc(companyId)
          .collection('leads');

        const [generalSnap, shSnap, metricsRes] = await Promise.all([
          leadsCol.limit(600).get(),
          leadsCol
            .where('metadata.migratedFrom', '==', 'smarthome_excel_base_31')
            .limit(1200)
            .get()
            .catch(() => null),
          getDashboardMetrics(companyId).catch(() => null),
        ]);

        if (metricsRes?.databaseStats) {
          setGlobalStats(metricsRes.databaseStats);
        }

        const mergedDocs = new Map<string, Record<string, any>>();
        generalSnap.docs.forEach((docSnap) => {
          mergedDocs.set(docSnap.id, docSnap.data());
        });
        if (shSnap) {
          shSnap.docs.forEach((docSnap) => {
            if (!mergedDocs.has(docSnap.id)) {
              mergedDocs.set(docSnap.id, docSnap.data());
            }
          });
        }

        const parsed: UnifiedLead[] = [];
        mergedDocs.forEach((raw, id) => {
          parsed.push(mapDocToUnifiedLead(id, raw, advMap));
        });

        parsed.sort((a, b) => {
          if (b.smarthomeBitacoras.length !== a.smarthomeBitacoras.length) {
            return b.smarthomeBitacoras.length - a.smarthomeBitacoras.length;
          }
          return b.createdAt - a.createdAt;
        });

        setLeads(parsed);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'No se pudo cargar la base de datos unificada.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, isAdmin]
  );

  useEffect(() => {
    void loadDatabase(false);
  }, [loadDatabase]);

  // Resetear límite al cambiar filtros
  useEffect(() => {
    setVisibleLimit(100);
  }, [search, originFilter, projectFilter, advisorFilter, cycleFilter]);

  const computedStats = useMemo(() => {
    if (globalStats) return globalStats;
    const totalContacts = leads.length;
    const activeAdvisorsAssigned = leads.filter((l) => Boolean(l.assignedTo)).length;
    const unassignedOrFormer = totalContacts - activeAdvisorsAssigned;
    const migratedSmarthome = leads.filter((l) => l.isMigratedSmarthome).length;
    return {
      totalContacts,
      activeAdvisorsAssigned,
      unassignedOrFormer,
      migratedSmarthome,
    };
  }, [globalStats, leads]);

  const projectOptions = useMemo<SelectOption[]>(() => {
    const counts = new Map<string, number>();
    leads.forEach((l) => {
      counts.set(l.project, (counts.get(l.project) || 0) + 1);
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return [
      { value: 'all', label: 'Todos los proyectos' },
      ...sorted.map(([proj, cnt]) => ({
        value: proj,
        label: `${proj} (${cnt})`,
      })),
    ];
  }, [leads]);

  const advisorFilterOptions = useMemo<SelectOption[]>(() => {
    return [
      { value: 'all', label: 'Todos los asesores' },
      { value: 'unassigned', label: '⚠️ Sin asignar en CRM' },
      ...advisorsList.map((a) => ({ value: a.id, label: a.name })),
    ];
  }, [advisorsList]);

  const cycleOptions = useMemo<SelectOption[]>(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.smarthomeCicloVenta) set.add(l.smarthomeCicloVenta);
    });
    return [
      { value: 'all', label: 'Todos los ciclos SH' },
      ...[...set].sort().map((c) => ({ value: c, label: c })),
    ];
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (originFilter === 'smarthome' && !l.isMigratedSmarthome) return false;
      if (originFilter === 'pauta' && l.isMigratedSmarthome) return false;
      if (projectFilter !== 'all' && l.project !== projectFilter) return false;
      if (advisorFilter === 'unassigned' && l.assignedTo) return false;
      if (
        advisorFilter !== 'all' &&
        advisorFilter !== 'unassigned' &&
        l.assignedTo !== advisorFilter
      ) {
        return false;
      }
      if (cycleFilter !== 'all' && l.smarthomeCicloVenta !== cycleFilter) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        l.idNumber.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.smarthomeAsesorOriginal.toLowerCase().includes(q)
      );
    });
  }, [leads, search, originFilter, projectFilter, advisorFilter, cycleFilter]);

  const visibleLeads = useMemo(
    () => filteredLeads.slice(0, visibleLimit),
    [filteredLeads, visibleLimit]
  );

  const hasActiveFilters =
    Boolean(search.trim()) ||
    originFilter !== 'all' ||
    projectFilter !== 'all' ||
    advisorFilter !== 'all' ||
    cycleFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setOriginFilter('all');
    setProjectFilter('all');
    setAdvisorFilter('all');
    setCycleFilter('all');
  };

  const openLeadModal = (item: UnifiedLead) => {
    setSelectedLead(item);
    setEditingName(false);
    setNameDraft(item.name);
    setCustomSourceMode(false);
    setCustomSourceText('');
    setReassignSuccess(false);
    setSourceSuccess(false);
    setSyncFeedback(null);
  };

  const refreshSingleLead = async (leadId: string) => {
    if (!companyId) return;
    try {
      const snap = await firestore()
        .collection('companies')
        .doc(companyId)
        .collection('leads')
        .doc(leadId)
        .get();
      const exists = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
      if (!exists) return;
      const raw = snap.data() || {};
      const updated = mapDocToUnifiedLead(leadId, raw, advisorsMapState);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
      setSelectedLead((prev) => (prev && prev.id === leadId ? updated : prev));
    } catch {
      // Ignorar refresco silencioso
    }
  };

  const handleSaveName = async () => {
    if (!companyId || !selectedLead || !nameDraft.trim() || savingName) return;
    const cleanName = nameDraft.trim();
    setSavingName(true);
    try {
      await firestore()
        .collection('companies')
        .doc(companyId)
        .collection('leads')
        .doc(selectedLead.id)
        .update({
          name: cleanName,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      setLeads((prev) =>
        prev.map((l) => (l.id === selectedLead.id ? { ...l, name: cleanName } : l))
      );
      setSelectedLead((prev) => (prev ? { ...prev, name: cleanName } : null));
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const handleReassignAdvisor = async (newAdvisorVal: string) => {
    if (!companyId || !selectedLead || reassigningAdvisor) return;
    const targetId = newAdvisorVal === '__none__' ? null : newAdvisorVal;
    const previousAdvisorName = selectedLead.advisorName || 'Sin asignar';
    const newAdvisorName = targetId
      ? advisorsMapState.get(targetId) || 'Asesor'
      : 'Sin asignar';
    const actorName = profile?.displayName || user?.email || 'Administrador';

    setReassigningAdvisor(true);
    setReassignSuccess(false);
    try {
      await reassignLead(companyId, selectedLead.id, targetId);
      await recordLeadAudit(
        companyId,
        selectedLead.id,
        'lead_reassigned',
        {
          previousAdvisorId: selectedLead.assignedTo,
          previousAdvisorName,
          newAdvisorId: targetId,
          newAdvisorName,
          source: 'database_modal',
        },
        actorName
      );
      setLeads((prev) =>
        prev.map((l) =>
          l.id === selectedLead.id
            ? {
                ...l,
                assignedTo: targetId,
                advisorName: targetId ? newAdvisorName : null,
              }
            : l
        )
      );
      setSelectedLead((prev) =>
        prev
          ? {
              ...prev,
              assignedTo: targetId,
              advisorName: targetId ? newAdvisorName : null,
            }
          : null
      );
      setReassignSuccess(true);
      setTimeout(() => setReassignSuccess(false), 2500);
    } finally {
      setReassigningAdvisor(false);
    }
  };

  const applySourceChange = async (newSource: string) => {
    if (!companyId || !selectedLead || !newSource.trim() || savingSource) return;
    const cleanSource = newSource.trim();
    const previousSource = selectedLead.source;
    const actorName = profile?.displayName || user?.email || 'Administrador';

    setSavingSource(true);
    setSourceSuccess(false);
    try {
      await firestore()
        .collection('companies')
        .doc(companyId)
        .collection('leads')
        .doc(selectedLead.id)
        .update({
          fuenteUbicacion: cleanSource,
          'metadata.fuenteUbicacion': cleanSource,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      await recordLeadAudit(
        companyId,
        selectedLead.id,
        'lead_source_updated',
        { previousSource, newSource: cleanSource, origin: 'database_modal' },
        actorName
      );
      setLeads((prev) =>
        prev.map((l) => (l.id === selectedLead.id ? { ...l, source: cleanSource } : l))
      );
      setSelectedLead((prev) => (prev ? { ...prev, source: cleanSource } : null));
      setCustomSourceMode(false);
      setCustomSourceText('');
      setSourceSuccess(true);
      setTimeout(() => setSourceSuccess(false), 2500);
    } finally {
      setSavingSource(false);
    }
  };

  const handleSyncSmartHome = async () => {
    if (!companyId || !selectedLead || syncingBitacora) return;
    setSyncingBitacora(true);
    setSyncFeedback(null);
    try {
      const res = await syncSmartHomeLeadBitacora(companyId, selectedLead.id);
      await refreshSingleLead(selectedLead.id);
      const count = res?.bitacorasCount ?? res?.synced ?? res?.total ?? null;
      setSyncFeedback({
        ok: true,
        text:
          count !== null
            ? `Sincronizado con SmartHome (${count} registros en bitácora).`
            : 'Bitácora actualizada desde SmartHome API.',
      });
    } catch (err) {
      setSyncFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo consultar SmartHome API para este contacto.',
      });
    } finally {
      setSyncingBitacora(false);
    }
  };

  const sourceSelectOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const list: SelectOption[] = [];
    const addOpt = (s: string, group: string) => {
      const clean = s.trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      list.push({ value: clean, label: clean, group });
    };
    if (selectedLead?.source) {
      addOpt(selectedLead.source, 'Fuente actual');
    }
    dynamicSources.forEach((ds) => addOpt(ds.name, 'Fuentes configuradas'));
    PRESET_SOURCES.forEach((ps) => addOpt(ps, 'Fuentes frecuentes'));
    list.push({
      value: '__custom__',
      label: '✍️ Escribir otra fuente manualmente...',
      group: 'Personalizado',
    });
    return list;
  }, [dynamicSources, selectedLead?.source]);

  if (!isAdmin) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
        <ScreenHeader title="Base de Datos" onBack={handleBack} />
        <EmptyState
          icon="Lock"
          title="Acceso restringido"
          description="Solo los administradores y gerentes pueden consultar la Base de Datos Unificada."
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Base de Datos"
        subtitle="Contactos unificados de pauta y migración SmartHome."
        onBack={handleBack}
        action={
          <View style={styles.rowCenter}>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setShowExportModal(true)}
              icon={<Icon name="Download" size={13} color={palette.textPrimary} />}
            >
              Exportar
            </Button>
            <Pressable
              onPress={() => void loadDatabase(true)}
              style={[
                styles.iconActionBtn,
                { backgroundColor: palette.bgElevated, borderColor: palette.border },
              ]}
            >
              <Icon name="RefreshCw" size={15} color={palette.textPrimary} />
            </Pressable>
          </View>
        }
      />

      {loading && leads.length === 0 ? (
        <LoadingView label="Unificando contactos de CRM y SmartHome..." />
      ) : (
        <FlatList
          data={visibleLeads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: 14,
            paddingBottom: Math.max(insets.bottom + 24, 32),
            gap: 10,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadDatabase(true)}
              tintColor={palette.brand}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 4 }}>
              {/* 4 KPIs Globales */}
              <View style={styles.kpiGrid}>
                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.brandBorder },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                    TOTAL BASE UNIFICADA
                  </Text>
                  <Text style={[styles.kpiValue, { color: palette.brandText }]}>
                    {computedStats.totalContacts.toLocaleString('es-CO')}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.emeraldBorder },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                    ASIGNADOS A ASESORES
                  </Text>
                  <Text style={[styles.kpiValue, { color: palette.emeraldText }]}>
                    {computedStats.activeAdvisorsAssigned.toLocaleString('es-CO')}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.amberBorder },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                    SIN ASIGNAR / EX-ASESOR
                  </Text>
                  <Text style={[styles.kpiValue, { color: palette.amberText }]}>
                    {computedStats.unassignedOrFormer.toLocaleString('es-CO')}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: palette.bgCard, borderColor: palette.skyBorder },
                  ]}
                >
                  <Text style={[styles.kpiLabel, { color: palette.textSubtle }]}>
                    HISTÓRICA SMARTHOME
                  </Text>
                  <Text style={[styles.kpiValue, { color: palette.skyText }]}>
                    {computedStats.migratedSmarthome.toLocaleString('es-CO')}
                  </Text>
                </View>
              </View>

              {/* Buscador */}
              <View
                style={[
                  styles.searchBar,
                  { backgroundColor: palette.bgCard, borderColor: palette.border },
                ]}
              >
                <Icon name="Search" size={15} color={palette.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Nombre, teléfono, cédula, ciudad o ex-asesor..."
                  placeholderTextColor={palette.placeholder}
                  style={[styles.searchInput, { color: palette.textPrimary }]}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Icon name="X" size={15} color={palette.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* Origen pills */}
              <View style={styles.originRow}>
                {(
                  [
                    { id: 'all', label: 'Todos' },
                    { id: 'smarthome', label: 'SmartHome' },
                    { id: 'pauta', label: 'Pauta Digital' },
                  ] as const
                ).map((tab) => {
                  const active = originFilter === tab.id;
                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setOriginFilter(tab.id)}
                      style={[
                        styles.originPill,
                        {
                          backgroundColor: active ? palette.brandSoft : palette.bgCard,
                          borderColor: active ? palette.brandBorder : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: active ? '700' : '500',
                          color: active ? palette.brandText : palette.textMuted,
                        }}
                      >
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Selectores Proyecto / Asesor / Ciclo */}
              <View style={styles.filtersGrid}>
                <View style={{ flex: 1 }}>
                  <SelectModal
                    value={projectFilter}
                    options={projectOptions}
                    onChange={setProjectFilter}
                    title="Filtrar por Proyecto"
                    searchable
                    compact
                    icon="Building2"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SelectModal
                    value={advisorFilter}
                    options={advisorFilterOptions}
                    onChange={setAdvisorFilter}
                    title="Filtrar por Asesor"
                    searchable
                    compact
                    icon="Users"
                  />
                </View>
              </View>

              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <SelectModal
                    value={cycleFilter}
                    options={cycleOptions}
                    onChange={setCycleFilter}
                    title="Ciclo de Venta SmartHome"
                    compact
                    icon="Layers"
                  />
                </View>
                {hasActiveFilters && (
                  <Pressable
                    onPress={clearFilters}
                    style={[
                      styles.clearBtn,
                      { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                    ]}
                  >
                    <Icon name="X" size={12} color={palette.roseText} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: palette.roseText }}>
                      Limpiar
                    </Text>
                  </Pressable>
                )}
              </View>

              {error ? (
                <View
                  style={[
                    styles.alertBox,
                    { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                  ]}
                >
                  <Text style={{ fontSize: 12, color: palette.roseText }}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.rowBetween}>
                <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                  Mostrando {visibleLeads.length} de {filteredLeads.length} contactos en memoria
                </Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openLeadModal(item)}
              style={[
                styles.leadCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <View style={styles.rowBetween}>
                <Text
                  style={[styles.leadName, { color: palette.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Badge tone={item.isMigratedSmarthome ? 'sky' : 'brand'}>
                  {item.isMigratedSmarthome ? 'SmartHome' : 'Pauta / CRM'}
                </Badge>
              </View>

              <View style={[styles.rowWrap, { marginTop: 4 }]}>
                <Text style={{ fontSize: 12, color: palette.textSecondary, fontWeight: '600' }}>
                  {formatPhone(item.phone) || 'Sin teléfono'}
                </Text>
                {item.idNumber ? (
                  <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                    · CC {item.idNumber}
                  </Text>
                ) : null}
                {item.city ? (
                  <Text style={{ fontSize: 11, color: palette.textSubtle }}>
                    · 📍 {item.city}
                  </Text>
                ) : null}
              </View>

              <View style={[styles.rowWrap, { marginTop: 8 }]}>
                <Badge tone="neutral">{item.project}</Badge>
                {item.advisorName ? (
                  <Badge tone="emerald">{`👤 ${item.advisorName}`}</Badge>
                ) : (
                  <Badge tone="amber">Sin asignar</Badge>
                )}
                {item.smarthomeCicloVenta ? (
                  <Badge tone="sky">{item.smarthomeCicloVenta}</Badge>
                ) : null}
                {item.smarthomeBitacoras.length > 0 ? (
                  <Badge tone="brand">{`${item.smarthomeBitacoras.length} bitácoras`}</Badge>
                ) : null}
              </View>

              {!item.advisorName && item.smarthomeAsesorOriginal ? (
                <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 5 }}>
                  Ex-asesor SmartHome: {item.smarthomeAsesorOriginal}
                </Text>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="Database"
              title="Sin contactos para estos filtros"
              description="Prueba cambiando la búsqueda, el proyecto o el asesor seleccionado."
            />
          }
          ListFooterComponent={
            filteredLeads.length > visibleLimit ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setVisibleLimit((prev) => prev + 100)}
                style={{ marginTop: 8 }}
              >
                {`Mostrar 100 más (${filteredLeads.length - visibleLimit} restantes)`}
              </Button>
            ) : null
          }
        />
      )}

      {/* Modal de Exportación */}
      {companyId ? (
        <ExportLeadsModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          companyId={companyId}
        />
      ) : null}

      {/* Modal de Detalle Completo del Contacto */}
      <Modal
        visible={Boolean(selectedLead)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedLead(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.modalBackdrop, { backgroundColor: palette.backdrop }]}
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: palette.bgCard,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom + 14, 18),
              },
            ]}
          >
            {selectedLead && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
                  <View style={{ flex: 1 }}>
                    {editingName ? (
                      <View style={styles.rowCenter}>
                        <TextInput
                          value={nameDraft}
                          onChangeText={setNameDraft}
                          autoFocus
                          style={[
                            styles.nameEditInput,
                            {
                              backgroundColor: palette.bgInput,
                              borderColor: palette.brandBorder,
                              color: palette.textPrimary,
                            },
                          ]}
                        />
                        <Button size="sm" onPress={handleSaveName} loading={savingName}>
                          Guardar
                        </Button>
                        <Pressable onPress={() => setEditingName(false)} hitSlop={8}>
                          <Icon name="X" size={16} color={palette.textMuted} />
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.rowCenter}>
                        <Text
                          style={[styles.modalTitle, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {selectedLead.name}
                        </Text>
                        <Pressable
                          onPress={() => {
                            setNameDraft(selectedLead.name);
                            setEditingName(true);
                          }}
                          hitSlop={8}
                        >
                          <Icon name="Pencil" size={14} color={palette.brandText} />
                        </Pressable>
                      </View>
                    )}
                    <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 2 }}>
                      {formatPhone(selectedLead.phone)}
                      {selectedLead.idNumber ? ` · CC ${selectedLead.idNumber}` : ''}
                      {selectedLead.city ? ` · ${selectedLead.city}` : ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => setSelectedLead(null)} hitSlop={10}>
                    <Icon name="X" size={20} color={palette.textMuted} />
                  </Pressable>
                </View>

                <ScrollView
                  contentContainerStyle={styles.modalContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Proyecto & Valor */}
                  <View
                    style={[
                      styles.detailCard,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.detailCardLabel, { color: palette.textSubtle }]}>
                      PROYECTO DE INTERÉS
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: palette.textPrimary }}>
                      {selectedLead.project}
                    </Text>
                    {selectedLead.sectorEtapa ? (
                      <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 2 }}>
                        Sector / Etapa: {selectedLead.sectorEtapa}
                      </Text>
                    ) : null}
                    {selectedLead.valorEstimado > 0 ? (
                      <Text style={{ fontSize: 12, color: palette.emeraldText, marginTop: 2 }}>
                        Valor estimado: ${selectedLead.valorEstimado.toLocaleString('es-CO')}
                      </Text>
                    ) : null}
                    {selectedLead.email ? (
                      <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 2 }}>
                        ✉️ {selectedLead.email}
                      </Text>
                    ) : null}
                  </View>

                  {/* Reasignar Asesor CRM */}
                  <View
                    style={[
                      styles.detailCard,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.detailCardLabel, { color: palette.textSubtle }]}>
                        ASESOR ASIGNADO EN CRM (ADMIN)
                      </Text>
                      {reassigningAdvisor ? (
                        <ActivityIndicator size="small" color={palette.brand} />
                      ) : reassignSuccess ? (
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                          ✓ ¡Guardado!
                        </Text>
                      ) : null}
                    </View>
                    <SelectModal
                      value={selectedLead.assignedTo || '__none__'}
                      options={[
                        { value: '__none__', label: 'Sin asignar en CRM' },
                        ...advisorsList.map((a) => ({ value: a.id, label: a.name })),
                      ]}
                      onChange={(val) => void handleReassignAdvisor(val)}
                      disabled={reassigningAdvisor}
                      searchable
                      title="Reasignar asesor CRM"
                      icon="Users"
                    />
                    {selectedLead.smarthomeAsesorOriginal ? (
                      <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 6 }}>
                        Asesor original en SmartHome: {selectedLead.smarthomeAsesorOriginal}
                      </Text>
                    ) : null}
                  </View>

                  {/* Ciclo SmartHome */}
                  {(selectedLead.isMigratedSmarthome ||
                    selectedLead.smarthomeCicloVenta ||
                    selectedLead.smarthomeEstadoSeguimiento) && (
                    <View
                      style={[
                        styles.detailCard,
                        { backgroundColor: palette.bgElevated, borderColor: palette.border },
                      ]}
                    >
                      <Text style={[styles.detailCardLabel, { color: palette.textSubtle }]}>
                        CICLO & ESTADO SMARTHOME
                      </Text>
                      <View style={styles.rowWrap}>
                        <Badge tone="sky">
                          {selectedLead.smarthomeCicloVenta || 'Captación'}
                        </Badge>
                        {selectedLead.smarthomeEstadoSeguimiento ? (
                          <Badge tone="brand">
                            {selectedLead.smarthomeEstadoSeguimiento}
                          </Badge>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {/* Fuente / Medio de Captación */}
                  <View
                    style={[
                      styles.detailCard,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.detailCardLabel, { color: palette.textSubtle }]}>
                        FUENTE / MEDIO DE CAPTACIÓN (ADMIN)
                      </Text>
                      {savingSource ? (
                        <ActivityIndicator size="small" color={palette.brand} />
                      ) : sourceSuccess ? (
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                          ✓ ¡Actualizada!
                        </Text>
                      ) : null}
                    </View>

                    {!customSourceMode ? (
                      <SelectModal
                        value={selectedLead.source}
                        options={sourceSelectOptions}
                        onChange={(val) => {
                          if (val === '__custom__') {
                            setCustomSourceText(selectedLead.source);
                            setCustomSourceMode(true);
                          } else {
                            void applySourceChange(val);
                          }
                        }}
                        disabled={savingSource}
                        searchable
                        title="Cambiar fuente de captación"
                        icon="Tag"
                      />
                    ) : (
                      <View style={{ gap: 8 }}>
                        <TextInput
                          value={customSourceText}
                          onChangeText={setCustomSourceText}
                          placeholder="Escribe la fuente personalizada..."
                          placeholderTextColor={palette.placeholder}
                          style={[
                            styles.nameEditInput,
                            {
                              backgroundColor: palette.bgInput,
                              borderColor: palette.borderInput,
                              color: palette.textPrimary,
                            },
                          ]}
                        />
                        <View style={styles.rowCenter}>
                          <Button
                            size="sm"
                            loading={savingSource}
                            disabled={!customSourceText.trim()}
                            onPress={() => void applySourceChange(customSourceText)}
                          >
                            Guardar fuente
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => setCustomSourceMode(false)}
                          >
                            Cancelar
                          </Button>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Bitácoras SmartHome */}
                  <View
                    style={[
                      styles.detailCard,
                      { backgroundColor: palette.bgElevated, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.detailCardLabel, { color: palette.textSubtle }]}>
                        BITÁCORAS SMARTHOME ({selectedLead.smarthomeBitacoras.length})
                      </Text>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={syncingBitacora}
                        onPress={() => void handleSyncSmartHome()}
                        icon={<Icon name="RefreshCw" size={12} color={palette.textPrimary} />}
                      >
                        Alimentar API SH
                      </Button>
                    </View>

                    {syncFeedback ? (
                      <View
                        style={[
                          styles.alertBox,
                          {
                            marginTop: 8,
                            backgroundColor: syncFeedback.ok
                              ? palette.emeraldBg
                              : palette.roseBg,
                            borderColor: syncFeedback.ok
                              ? palette.emeraldBorder
                              : palette.roseBorder,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11.5,
                            color: syncFeedback.ok ? palette.emeraldText : palette.roseText,
                          }}
                        >
                          {syncFeedback.text}
                        </Text>
                      </View>
                    ) : null}

                    {selectedLead.smarthomeBitacoras.length === 0 ? (
                      <Text style={{ fontSize: 12, color: palette.textSubtle, marginTop: 8 }}>
                        No hay bitácoras importadas aún. Usa &quot;Alimentar API SH&quot; para consultar SmartHome en vivo.
                      </Text>
                    ) : (
                      <View style={{ gap: 8, marginTop: 10 }}>
                        {selectedLead.smarthomeBitacoras.slice(0, 25).map((b: any, idx: number) => {
                          const dateStr =
                            b.fecha || b.date || b.createdAt || b.fechaRegistro || '';
                          const comment =
                            b.comentario ||
                            b.observacion ||
                            b.descripcion ||
                            b.notes ||
                            b.text ||
                            'Sin detalle';
                          const author =
                            b.asesor || b.usuario || b.authorName || b.agente || '';
                          const actionType = b.tipo || b.accion || b.medio || 'Seguimiento';

                          return (
                            <View
                              key={idx}
                              style={[
                                styles.bitacoraItem,
                                {
                                  backgroundColor: palette.bgCard,
                                  borderColor: palette.border,
                                },
                              ]}
                            >
                              <View style={styles.rowBetween}>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: '700',
                                    color: palette.brandText,
                                  }}
                                >
                                  {String(actionType)}
                                </Text>
                                <Text style={{ fontSize: 10.5, color: palette.textSubtle }}>
                                  {String(dateStr)}
                                </Text>
                              </View>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: palette.textSecondary,
                                  marginTop: 4,
                                  lineHeight: 17,
                                }}
                              >
                                {String(comment)}
                              </Text>
                              {author ? (
                                <Text
                                  style={{
                                    fontSize: 10.5,
                                    color: palette.textSubtle,
                                    marginTop: 4,
                                  }}
                                >
                                  Por: {String(author)}
                                </Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                </ScrollView>

                {/* Acciones inferiores */}
                <View style={[styles.modalFooter, { borderTopColor: palette.border }]}>
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={() => setShowFichaModal(true)}
                    style={{ flex: 1 }}
                    icon={<Icon name="ClipboardCheck" size={14} color="#ffffff" />}
                  >
                    Ficha Técnica
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      const targetId = selectedLead.id;
                      setSelectedLead(null);
                      navigation.navigate('Chat', { leadId: targetId });
                    }}
                    icon={<Icon name="MessageSquare" size={14} color={palette.textPrimary} />}
                  >
                    Chat CRM
                  </Button>
                  {selectedLead.phone ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        const digits = selectedLead.phone.replace(/\D/g, '');
                        if (digits) void Linking.openURL(`https://wa.me/${digits}`);
                      }}
                      icon={<Icon name="ExternalLink" size={14} color={palette.emeraldText} />}
                    >
                      WA
                    </Button>
                  ) : null}
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal Ficha Técnica y Seguimiento */}
      {companyId && selectedLead ? (
        <FichaTecnicaModal
          isOpen={showFichaModal}
          onClose={() => setShowFichaModal(false)}
          companyId={companyId}
          lead={{
            id: selectedLead.id,
            name: selectedLead.name,
            phone: selectedLead.phone,
            project: selectedLead.project,
            advisorName: selectedLead.advisorName,
            bitacoras: selectedLead.smarthomeBitacoras,
            metadata: selectedLead.rawMetadata,
          }}
          onSuccess={() => {
            void refreshSingleLead(selectedLead.id);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    width: '48.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
  },
  kpiLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 19,
    fontWeight: '800',
    marginTop: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  originRow: {
    flexDirection: 'row',
    gap: 8,
  },
  originPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  filtersGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  leadCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
  },
  leadName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  nameEditInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  modalContent: {
    padding: 16,
    gap: 12,
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  detailCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  bitacoraItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
});
